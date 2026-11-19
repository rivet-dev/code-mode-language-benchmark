//! Diagnostic: where does a Luau session's resident memory go?
use mlua::{Lua, Table, VmState};

fn rss() -> i64 {
	let s = std::fs::read_to_string("/proc/self/statm").unwrap();
	s.split_whitespace().nth(1).unwrap().parse::<i64>().unwrap() * 4096
}

fn make(variant: u32) -> Lua {
	let lua = Lua::new();
	if variant >= 1 {
		lua.set_memory_limit(64 << 20).unwrap();
		lua.set_interrupt(|_| Ok(VmState::Continue));
		let call = lua.create_function(|_, _t: Table| Ok(())).unwrap();
		lua.globals().set("call", call).unwrap();
	}
	if variant >= 2 {
		lua.sandbox(true).unwrap();
	}
	if variant >= 3 {
		let two: i64 = lua.load("return 1 + 1").eval().unwrap();
		assert_eq!(two, 2);
	}
	lua
}

fn main() {
	for variant in 0..4 {
		drop(make(variant));
		unsafe { libc::malloc_trim(0) };
		let before = rss();
		let states: Vec<Lua> = (0..1000).map(|_| make(variant)).collect();
		let after = rss();
		let used: usize = states.iter().map(|l| l.used_memory()).sum::<usize>() / states.len();
		println!("variant {variant}: rss/session={} lua used_memory={}", (after - before) / 1000, used);
		drop(states);
		unsafe { libc::malloc_trim(0) };
	}
}
