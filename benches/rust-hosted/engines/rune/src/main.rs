//! Rune: one compile `Context` + `RuntimeContext` per session, a compiled `Unit`, and a `Vm`.

use std::sync::Arc;

use bench_common::{run_owned, tick, Info};
use rune::alloc::limit;
use rune::alloc::String as RuneString;
use rune::runtime::{budget, Object, RuntimeContext, VmResult};
use rune::termcolor::{ColorChoice, StandardStream};
use rune::{Context, Diagnostics, Module, Source, Sources, Unit, Vm};

const GUEST: &str = r#"
pub fn run(start, count) {
    let end = start + count;
    for id in start..end {
        let reply = call(#{ id: id, tool: "lookup", args: #{ s: "hello from the sandbox" } });
        if reply.id != id {
            panic("reply mismatch");
        }
    }
}
"#;

const INSTRUCTION_BUDGET: usize = 1_000_000_000;
const MEMORY_LIMIT: usize = 64 << 20;

struct Session {
	context: Context,
	runtime: Arc<RuntimeContext>,
	vm: Vm,
}

/// Host `call(x)`: reads `x.id` and `x.args.s`, returns `#{ id, ok: true, value: len(s) }`.
fn host_call(call: &Object) -> VmResult<Object> {
	tick();
	let Some(id) = call.get("id") else {
		return VmResult::panic("call.id is missing");
	};
	let id: i64 = rune::vm_try!(id.as_integer::<i64>());
	let Some(args) = call.get("args") else {
		return VmResult::panic("call.args is missing");
	};
	let args = rune::vm_try!(args.borrow_ref::<Object>());
	let Some(text) = args.get("s") else {
		return VmResult::panic("call.args.s is missing");
	};
	let length = rune::vm_try!(text.borrow_string_ref()).len();
	let mut reply = rune::vm_try!(Object::with_capacity(3));
	rune::vm_try!(reply.insert_value(rune::vm_try!(RuneString::try_from("id")), id));
	rune::vm_try!(reply.insert_value(rune::vm_try!(RuneString::try_from("ok")), true));
	rune::vm_try!(reply.insert_value(rune::vm_try!(RuneString::try_from("value")), length as i64));
	VmResult::Ok(reply)
}

fn compile(context: &Context, source: &str) -> Unit {
	let mut sources = Sources::new();
	sources
		.insert(Source::memory(source).expect("source"))
		.expect("insert source");
	let mut diagnostics = Diagnostics::new();
	let result = rune::prepare(&mut sources)
		.with_context(context)
		.with_diagnostics(&mut diagnostics)
		.build();
	if !diagnostics.is_empty() {
		let mut writer = StandardStream::stderr(ColorChoice::Never);
		diagnostics.emit(&mut writer, &sources).expect("emit diagnostics");
	}
	result.expect("compile")
}

/// Runs `body` under the session's instruction budget and memory limit.
fn limited<T>(body: impl FnOnce() -> T) -> T {
	budget::with(INSTRUCTION_BUDGET, limit::with(MEMORY_LIMIT, body)).call()
}

fn new_session() -> Session {
	let mut context = Context::with_default_modules().expect("context");
	let mut module = Module::new();
	module.function("call", host_call).build().expect("register call");
	context.install(module).expect("install module");
	let runtime = Arc::new(context.runtime().expect("runtime context"));
	let unit = compile(&context, "pub fn main() { 1 + 1 }");
	let mut vm = Vm::new(runtime.clone(), Arc::new(unit));
	let two = limited(|| vm.call(["main"], ())).expect("evaluate 1 + 1");
	let two: i64 = rune::from_value(two).expect("integer");
	assert_eq!(two, 2);
	Session {
		context,
		runtime,
		vm,
	}
}

fn main() {
	let info = Info {
		key: "rune",
		language: "Rune",
		crate_name: "rune",
		version: "0.14.2",
		call_kind: "sync",
		limits_enabled: format!(
			"runtime::budget::with({INSTRUCTION_BUDGET} instructions) and alloc::limit::with({}MiB) around every \
			 Vm call; Context::with_default_modules (no fs/process/net modules)",
			MEMORY_LIMIT >> 20
		),
		notes: vec![
			"Session = Context::with_default_modules() + module with call + RuntimeContext + compiled Unit + Vm; \
			 nothing shared across sessions, so start includes building the default-module context and compiling \
			 `pub fn main() { 1 + 1 }`."
				.into(),
			"Host fn is Module::function(\"call\", fn(&Object) -> VmResult<Object>); Rune objects key on \
			 heap-allocated rune::alloc::String, so each reply allocates three key strings (the guest's object \
			 literals do the same)."
				.into(),
			"Tool-call guest is compiled into a second Unit in the same Context/RuntimeContext and run by its own Vm."
				.into(),
		],
	};
	run_owned(
		info,
		new_session,
		|session| {
			let unit = compile(&session.context, GUEST);
			session.vm = Vm::new(session.runtime.clone(), Arc::new(unit));
		},
		|session, start, count| {
			let vm = &mut session.vm;
			limited(|| vm.call(["run"], (start, count))).expect("guest run");
		},
	);
}
