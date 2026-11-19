//! Roto: statically typed and compiled to machine code with Cranelift. One `Runtime` plus one
//! compiled package per session. Roto records cannot cross into Rust, so the call travels as
//! registered Rust record types built by host constructors.

use bench_common::{run_owned, tick, Info};
use roto::load::FileTree;
use roto::value::{RotoString, Val};
use roto::{library, Runtime, TypedFunc};

const FIRST_RESPONSE: &str = "fn main() -> i64 {\n    1 + 1\n}\n";

const GUEST: &str = r#"
fn run(start: i64, count: i64) -> i64 {
    let mismatches = 0;
    let id = start;
    let end = start + count;
    while id < end {
        let reply = call(Call.new(id, "lookup", Args.new("hello from the sandbox")));
        if reply.id() != id {
            mismatches = mismatches + 1;
        }
        id = id + 1;
    }
    mismatches
}
"#;

#[derive(Clone, PartialEq)]
struct Args {
	s: RotoString,
}

#[derive(Clone, PartialEq)]
struct Call {
	id: i64,
	tool: RotoString,
	args: Val<Args>,
}

#[derive(Clone, Copy, PartialEq)]
struct Reply {
	id: i64,
	ok: bool,
	value: i64,
}

type RunFn = TypedFunc<roto::runtime::context::NoCtx, fn(i64, i64) -> i64>;

struct Session {
	runtime: Runtime<roto::runtime::context::NoCtx>,
	_first: roto::Blob<roto::runtime::context::NoCtx>,
	guest: Option<(roto::Blob<roto::runtime::context::NoCtx>, RunFn)>,
}

fn new_runtime() -> Runtime<roto::runtime::context::NoCtx> {
	let lib = library! {
		#[clone] type Args = Val<Args>;
		#[clone] type Call = Val<Call>;
		#[copy] type Reply = Val<Reply>;

		impl Val<Args> {
			fn new(s: RotoString) -> Val<Args> {
				Val(Args { s })
			}
		}

		impl Val<Call> {
			fn new(id: i64, tool: RotoString, args: Val<Args>) -> Val<Call> {
				Val(Call { id, tool, args })
			}
		}

		impl Val<Reply> {
			fn id(reply: Val<Reply>) -> i64 {
				reply.id
			}

			fn ok(reply: Val<Reply>) -> bool {
				reply.ok
			}

			fn value(reply: Val<Reply>) -> i64 {
				reply.value
			}
		}

		/// Host tool call: returns `{ id, ok: true, value: len(args.s) }`.
		fn call(call: Val<Call>) -> Val<Reply> {
			tick();
			debug_assert_eq!(&*call.tool, "lookup");
			Val(Reply {
				id: call.id,
				ok: true,
				value: call.args.s.len() as i64,
			})
		}
	};
	Runtime::from_lib(lib).expect("runtime")
}

fn compile(runtime: &Runtime<roto::runtime::context::NoCtx>, name: &str, source: &str) -> roto::Blob<roto::runtime::context::NoCtx> {
	match runtime.compile(FileTree::test_file(name, source, 0)) {
		Ok(package) => package,
		Err(report) => panic!("roto compile failed: {report}"),
	}
}

fn new_session() -> Session {
	let runtime = new_runtime();
	let mut first = compile(&runtime, "session.roto", FIRST_RESPONSE);
	let main = first
		.get_function::<fn() -> i64>("main")
		.expect("main");
	assert_eq!(main.call(), 2);
	Session {
		runtime,
		_first: first,
		guest: None,
	}
}

fn main() {
	let info = Info {
		key: "roto",
		language: "Roto",
		crate_name: "roto",
		version: "0.13.0",
		call_kind: "sync",
		limits_enabled: "none available: Roto has no instruction, time, or memory limit API; it is sandboxed by \
			construction (only registered Rust functions and types are reachable, no I/O in the standard library)"
			.into(),
		notes: vec![
			"Roto is statically typed and JIT-compiled with Cranelift, so `1 + 1` means compiling \
			 `fn main() -> i64 { 1 + 1 }` to machine code: session = Runtime::from_lib(our library) + compile + call."
				.into(),
			"Roto has no maps, and its records cannot be passed to Rust functions, so the call argument is the \
			 closest structure: registered Rust types built by host constructors, \
			 call(Call.new(id, \"lookup\", Args.new(\"hello from the sandbox\"))). That is three native calls per \
			 tool call (two constructors plus call); the reply is a registered Reply type read through native \
			 accessor methods (reply.id())."
				.into(),
			"Roto has no exceptions, so the guest counts id mismatches and the host asserts zero.".into(),
		],
	};
	run_owned(
		info,
		new_session,
		|session| {
			let mut package = compile(&session.runtime, "guest.roto", GUEST);
			let run = package
				.get_function::<fn(i64, i64) -> i64>("run")
				.expect("run");
			session.guest = Some((package, run));
		},
		|session, start, count| {
			let (_, run) = session.guest.as_ref().expect("guest loaded");
			assert_eq!(run.call(start, count), 0, "reply id mismatches");
		},
	);
}
