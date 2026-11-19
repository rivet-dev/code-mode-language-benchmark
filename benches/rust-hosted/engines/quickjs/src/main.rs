//! Native QuickJS (quickjs-ng via rquickjs): one `Runtime` plus one full `Context` per session.

use bench_common::{run_owned, tick, Info};
use rquickjs::{Context, Ctx, Function, Object, Runtime, Value};

const GUEST: &str = r#"
function run(start, count) {
  for (let id = start; id < start + count; id++) {
    const reply = call({ id, tool: "lookup", args: { s: "hello from the sandbox" } });
    if (reply.id !== id) throw new Error("reply mismatch");
  }
}
"#;

const MEMORY_LIMIT: usize = 64 << 20;
const STACK_LIMIT: usize = 1 << 20;

struct Session {
	context: Context,
	_runtime: Runtime,
}

/// Host `call(x)`: reads `x.id` and `x.args.s`, returns `{ id, ok: true, value: s.length }`.
fn host_call<'js>(ctx: Ctx<'js>, call: Object<'js>) -> rquickjs::Result<Object<'js>> {
	tick();
	let id: Value = call.get("id")?;
	let args: Object = call.get("args")?;
	let text: rquickjs::String = args.get("s")?;
	let length = text.to_string()?.len();
	let reply = Object::new(ctx)?;
	reply.set("id", id)?;
	reply.set("ok", true)?;
	reply.set("value", length as i32)?;
	Ok(reply)
}

fn new_session() -> Session {
	let runtime = Runtime::new().expect("runtime");
	runtime.set_memory_limit(MEMORY_LIMIT);
	runtime.set_max_stack_size(STACK_LIMIT);
	runtime.set_interrupt_handler(Some(Box::new(|| false)));
	let context = Context::full(&runtime).expect("context");
	context.with(|ctx| {
		let call = Function::new(ctx.clone(), host_call).expect("function");
		ctx.globals().set("call", call).expect("set call");
		let two: i32 = ctx.eval("1 + 1").expect("evaluate 1 + 1");
		assert_eq!(two, 2);
	});
	Session {
		context,
		_runtime: runtime,
	}
}

fn main() {
	let info = Info {
		key: "quickjs",
		language: "JavaScript",
		crate_name: "rquickjs",
		version: "0.14.0",
		call_kind: "sync",
		limits_enabled: format!(
			"Runtime::set_memory_limit({}MiB), set_max_stack_size({}MiB), set_interrupt_handler (returns false); \
			 Context::full has no I/O modules",
			MEMORY_LIMIT >> 20,
			STACK_LIMIT >> 20
		),
		notes: vec![
			"Native QuickJS: rquickjs-sys 0.14.0 bundles quickjs-ng 0.16.2 (not Bellard QuickJS), compiled by cc \
			 with the crate's default flags; a native comparison point for QuickJS compiled to Wasm."
				.into(),
			"Session = new Runtime (own GC heap and memory limit) + Context::full + global call; runtimes are \
			 not shared across sessions."
				.into(),
			"Host fn is Function::new(ctx, fn(Ctx, Object) -> Result<Object>); reading args.s copies it into a Rust \
			 String to take its length (rquickjs exposes no borrowed length), about 22 bytes per call."
				.into(),
		],
	};
	run_owned(
		info,
		new_session,
		|session| {
			session.context.with(|ctx| {
				ctx.eval::<(), _>(GUEST).expect("load guest");
			});
		},
		|session, start, count| {
			session.context.with(|ctx| {
				let run: Function = ctx.globals().get("run").expect("run");
				run.call::<_, ()>((start as i32, count as i32)).expect("guest run");
			});
		},
	);
}
