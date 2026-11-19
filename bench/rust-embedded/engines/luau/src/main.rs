//! Luau through mlua: one `Lua` state per session, sandboxed, with an interrupt and a memory limit.

use std::time::Instant;

use bench_common::{emit, measure_memory, measure_start, measure_tool_calls, tick, Info};
use mlua::{Function, Lua, Table, VmState};

const GUEST: &str = r#"
return function(start, count)
  for id = start, start + count - 1 do
    local reply = call({ id = id, tool = "lookup", args = { s = "hello from the sandbox" } })
    if reply.id ~= id then error("reply mismatch") end
  end
end
"#;

const MEMORY_LIMIT: usize = 64 << 20;

struct Session {
	lua: Lua,
}

fn new_session() -> Session {
	let lua = Lua::new();
	lua.set_memory_limit(MEMORY_LIMIT).expect("memory limit");
	lua.set_interrupt(|_| Ok(VmState::Continue));
	let call = lua
		.create_function(|lua, call: Table| {
			tick();
			let id: i64 = call.get("id")?;
			let args: Table = call.get("args")?;
			let text: mlua::LuaString = args.get("s")?;
			let length = text.as_bytes().len();
			let reply = lua.create_table_with_capacity(0, 3)?;
			reply.set("id", id)?;
			reply.set("ok", true)?;
			reply.set("value", length)?;
			Ok(reply)
		})
		.expect("create call");
	lua.globals().set("call", call).expect("set call");
	lua.sandbox(true).expect("sandbox");
	let two: i64 = lua.load("return 1 + 1").eval().expect("evaluate 1 + 1");
	assert_eq!(two, 2);
	Session { lua }
}

fn main() {
	let info = Info {
		key: "luau",
		language: "Luau",
		crate_name: "mlua (features luau, vendored)",
		version: "0.12.2",
		call_kind: "sync",
		limits_enabled: format!(
			"Lua::new() (ALL_SAFE libs), sandbox(true), set_interrupt (returns Continue), set_memory_limit({}MiB)",
			MEMORY_LIMIT >> 20
		),
		notes: vec![
			"Session = Lua::new() + memory limit + interrupt + global call + sandbox(true); call is registered \
			 before sandbox(true) so it sits in the read-only globals."
				.into(),
			"Host fn is lua.create_function(|lua, Table| -> Table); fields read with Table::get and the reply \
			 built with create_table_with_capacity(0, 3), mirroring the C harness's lua_getfield/lua_setfield."
				.into(),
			"Bundled Luau from luau0-src 0.22.0+luau740.".into(),
		],
	};
	eprintln!("[luau] memory");
	let memory = measure_memory(new_session);
	eprintln!("[luau] start");
	let start = measure_start(|| {
		let started = Instant::now();
		let session = new_session();
		let elapsed = started.elapsed();
		drop(session);
		elapsed
	});
	eprintln!("[luau] tool calls");
	let session = new_session();
	let run: Function = session.lua.load(GUEST).eval().expect("load guest");
	let tool = measure_tool_calls(|start, count| run.call::<()>((start, count)).expect("guest run"));
	// Secondary: the same session with the interrupt callback removed, then also without the memory
	// limit. With a limit set, mlua wraps every allocating table operation in a protected call.
	session.lua.remove_interrupt();
	let without_interrupt = measure_tool_calls(|start, count| run.call::<()>((start, count)).expect("guest run"));
	session.lua.set_memory_limit(0).expect("clear memory limit");
	let without_limits = measure_tool_calls(|start, count| run.call::<()>((start, count)).expect("guest run"));
	drop(run);
	drop(session);
	let mut info = info;
	info.notes.push(format!(
		"Secondary measurements in the same session (sandbox kept): after remove_interrupt() \
		 toolCallWallUs={:.4}, toolCallCpuUs={:.4}; after also set_memory_limit(0) toolCallWallUs={:.4}, \
		 toolCallCpuUs={:.4} (1,000,000 calls each). With a memory limit set, mlua runs each allocating table \
		 operation (create_table, set) as a protected call so an allocation failure cannot unwind through Rust.",
		without_interrupt.wall_us, without_interrupt.cpu_us, without_limits.wall_us, without_limits.cpu_us
	));
	emit(&info, &memory, &start, &tool);
}
