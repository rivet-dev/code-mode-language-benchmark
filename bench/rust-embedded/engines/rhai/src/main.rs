//! Rhai: one `Engine` per session (it owns registered functions and limits) plus a `Scope`.

use bench_common::{run_owned, tick, Info};
use rhai::module_resolvers::DummyModuleResolver;
use rhai::{Dynamic, Engine, ImmutableString, Map, Scope, AST};

const GUEST: &str = r#"
fn run(start, count) {
    let end = start + count;
    for id in start..end {
        let reply = call_tool(#{ id: id, tool: "lookup", args: #{ s: "hello from the sandbox" } });
        if reply.id != id {
            throw "reply mismatch";
        }
    }
}
"#;

const MAX_OPERATIONS: u64 = 1_000_000_000;

struct Session {
	engine: Engine,
	scope: Scope<'static>,
	guest: Option<AST>,
}

/// Host `call(x)`: reads `x.id` and `x.args.s`, returns `#{ id, ok: true, value: len(s) }`.
fn host_call(call: Map) -> Result<Map, Box<rhai::EvalAltResult>> {
	tick();
	let id = call
		.get("id")
		.and_then(|value| value.as_int().ok())
		.ok_or("call.id must be an integer")?;
	let args = call
		.get("args")
		.and_then(|value| value.read_lock::<Map>())
		.ok_or("call.args must be a map")?;
	let length = args
		.get("s")
		.and_then(|value| value.read_lock::<ImmutableString>().map(|s| s.len()))
		.ok_or("call.args.s must be a string")?;
	let mut reply = Map::new();
	reply.insert("id".into(), Dynamic::from_int(id));
	reply.insert("ok".into(), Dynamic::from_bool(true));
	reply.insert("value".into(), Dynamic::from_int(length as i64));
	Ok(reply)
}

fn new_session() -> Session {
	let mut engine = Engine::new();
	// Engine::new installs a file module resolver; a sandbox gets none.
	engine.set_module_resolver(DummyModuleResolver::new());
	engine.set_max_modules(0);
	engine.set_max_operations(MAX_OPERATIONS);
	engine.set_max_call_levels(64);
	engine.set_max_expr_depths(64, 32);
	engine.set_max_string_size(1 << 20);
	engine.set_max_array_size(100_000);
	engine.set_max_map_size(10_000);
	engine.set_max_variables(1_000);
	engine.set_max_functions(1_000);
	engine.on_print(|_| {});
	engine.on_debug(|_, _, _| {});
	// `call` is a Rhai built-in (it invokes function pointers), so the host function is `call_tool`.
	engine.register_fn("call_tool", host_call);
	let mut scope = Scope::new();
	let two: i64 = engine.eval_with_scope(&mut scope, "1 + 1").expect("evaluate 1 + 1");
	assert_eq!(two, 2);
	Session {
		engine,
		scope,
		guest: None,
	}
}

fn main() {
	let info = Info {
		key: "rhai",
		language: "Rhai",
		crate_name: "rhai",
		version: "1.27.0",
		call_kind: "sync",
		limits_enabled: format!(
			"max_operations={MAX_OPERATIONS}, max_call_levels=64, max_expr_depths=64/32, max_string_size=1MiB, \
			 max_array_size=100000, max_map_size=10000, max_variables=1000, max_functions=1000, max_modules=0, \
			 DummyModuleResolver (Engine::new installs a FileModuleResolver), print/debug discarded"
		),
		notes: vec![
			"Session = Engine::new() (standard package rebuilt per engine) + limits + registered call + Scope; \
			 the engine is not shared across sessions."
				.into(),
			"Host fn is register_fn(\"call_tool\", fn(Map) -> Result<Map>); the map argument is moved in, reply map keys \
			 are inline SmartStrings."
				.into(),
			"Guest is a script function called once with call_fn(run, start, count).".into(),
			"The host function is named call_tool: `call` is reserved in Rhai for calling function pointers.".into(),
		],
	};
	run_owned(
		info,
		new_session,
		|session| {
			session.guest = Some(session.engine.compile(GUEST).expect("compile guest"));
		},
		|session, start, count| {
			let ast = session.guest.as_ref().expect("guest loaded");
			session
				.engine
				.call_fn::<()>(&mut session.scope, ast, "run", (start, count))
				.expect("guest run");
		},
	);
}
