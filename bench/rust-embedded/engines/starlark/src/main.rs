//! Starlark (Meta's starlark-rust): one `Globals` plus one `Module` per session. Modules only
//! exist inside `Module::with_temp_heap`, so live sessions nest by recursion for the memory phase.

use std::time::{Duration, Instant};

use anyhow::Context as _;
use bench_common::{emit, measure_memory_nested, measure_start, measure_tool_calls, on_big_stack, tick, Info, BATCH};
use starlark::const_frozen_string;
use starlark::environment::{Globals, GlobalsBuilder, Module};
use starlark::eval::Evaluator;
use starlark::starlark_module;
use starlark::syntax::{AstModule, Dialect};
use starlark::values::dict::{AllocDict, DictRef};
use starlark::values::{Heap, Value};

const GUEST: &str = r#"
def run(start, count):
    for id in range(start, start + count):
        reply = call({"id": id, "tool": "lookup", "args": {"s": "hello from the sandbox"}})
        if reply["id"] != id:
            fail("reply mismatch")
"#;

const MAX_CALLSTACK: usize = 100;
const MAX_HEAP: usize = 64 << 20;
const MAX_TICKS: u64 = 1_000_000_000;

#[starlark_module]
fn tools(builder: &mut GlobalsBuilder) {
	/// Host `call(x)`: reads `x["id"]` and `x["args"]["s"]`, returns `{"id", "ok": True, "value": len(s)}`.
	fn call<'v>(x: Value<'v>, heap: Heap<'v>) -> anyhow::Result<Value<'v>> {
		tick();
		let call = DictRef::from_value(x).context("call expects a dict")?;
		let id = call.get_str("id").context("call['id'] is missing")?;
		let args = call.get_str("args").context("call['args'] is missing")?;
		let args = DictRef::from_value(args).context("call['args'] must be a dict")?;
		let text = args.get_str("s").context("call['args']['s'] is missing")?;
		let length = text.unpack_str().context("call['args']['s'] must be a string")?.len() as i32;
		Ok(heap.alloc(AllocDict([
			(const_frozen_string!("id").to_value(), id),
			(const_frozen_string!("ok").to_value(), Value::new_bool(true)),
			(const_frozen_string!("value").to_value(), heap.alloc(length)),
		])))
	}
}

fn new_globals() -> Globals {
	GlobalsBuilder::standard().with(tools).build()
}

fn limited_evaluator<'v, 'a, 'e>(module: &'a Module<'v>, max_heap: usize) -> Evaluator<'v, 'a, 'e> {
	let mut eval = Evaluator::new(module);
	eval.set_max_callstack_size(MAX_CALLSTACK).expect("callstack limit");
	eval.set_max_heap_size(max_heap).expect("heap limit");
	eval.set_max_tick_count(MAX_TICKS).expect("tick limit");
	eval
}

fn eval_source<'v>(module: &Module<'v>, globals: &Globals, name: &str, source: String, max_heap: usize) -> Option<i32> {
	let ast = AstModule::parse(name, source, &Dialect::Standard).expect("parse");
	let mut eval = limited_evaluator(module, max_heap);
	let value = eval.eval_module(ast, globals).expect("evaluate");
	value.unpack_i32()
}

/// The first response: `1 + 1` evaluated in the session's module.
fn first_response(module: &Module<'_>, globals: &Globals) {
	let two = eval_source(module, globals, "session.star", "1 + 1".to_owned(), MAX_HEAP);
	assert_eq!(two, Some(2));
}

/// One statement per batch keeps calls in function bodies while letting starlark-rust run its
/// garbage collector, which only runs between top-level module statements.
fn batched_calls(start: i64, count: i64) -> String {
	let mut source = String::new();
	let mut next = start;
	let end = start + count;
	while next < end {
		let size = (end - next).min(BATCH as i64);
		source.push_str(&format!("run({next}, {size})\n"));
		next += size;
	}
	source
}

fn main() {
	let mut info = Info {
		key: "starlark",
		language: "Starlark",
		crate_name: "starlark",
		version: "0.14.2",
		call_kind: "sync",
		limits_enabled: format!(
			"Evaluator::set_max_callstack_size({MAX_CALLSTACK}), set_max_heap_size({}MiB, best-effort), \
			 set_max_tick_count({MAX_TICKS}) on every evaluator; Dialect::Standard (no while loops, no recursion); \
			 hermetic by design (no I/O builtins)",
			MAX_HEAP >> 20
		),
		notes: vec![
			"Session = Globals (standard + our call module) + Module; an Evaluator is created per evaluation and \
			 is not kept. Modules only exist inside Module::with_temp_heap, so the memory phase nests sessions by \
			 recursion after pre-touching the stack it uses (memoryExtraStackBytes <= 0 means no stack was counted)."
				.into(),
			"Host fn is a #[starlark_module] native fn(Value, Heap) -> Value; reply dict keys are static frozen \
			 strings."
				.into(),
			"starlark-rust only collects garbage between top-level module statements, never inside a function, so \
			 the tool-call module is one top-level `run(start, 1000)` statement per batch of 1,000 calls (same \
			 session, guest loop in the function body)."
				.into(),
		],
	};

	let (memory, start, tool, single) = on_big_stack(|| {
		eprintln!("[starlark] memory");
		let memory = measure_memory_nested(&|inside| {
			Module::with_temp_heap(|module| {
				let globals = new_globals();
				first_response(&module, &globals);
				inside();
			})
		});

		eprintln!("[starlark] start");
		let start = measure_start(|| {
			let started = Instant::now();
			let mut elapsed = Duration::ZERO;
			Module::with_temp_heap(|module| {
				let globals = new_globals();
				first_response(&module, &globals);
				elapsed = started.elapsed();
			});
			elapsed
		});

		eprintln!("[starlark] tool calls");
		let (tool, single) = Module::with_temp_heap(|module| {
			let globals = new_globals();
			first_response(&module, &globals);
			eval_source(&module, &globals, "guest.star", GUEST.to_owned(), MAX_HEAP);
			let tool = measure_tool_calls(|start, count| {
				eval_source(&module, &globals, "calls.star", batched_calls(start, count), MAX_HEAP);
			});
			// Secondary: the whole loop as one statement, so no collection happens until it returns.
			let single = measure_tool_calls(|start, count| {
				eval_source(&module, &globals, "calls.star", format!("run({start}, {count})\n"), 4 << 30);
			});
			(tool, single)
		});
		(memory, start, tool, single)
	});

	info.notes.push(format!(
		"Secondary measurement, the whole loop as a single top-level statement (no GC until it returns; heap limit \
		 raised to 4GiB because garbage accumulates): toolCallWallUs={:.4}, toolCallCpuUs={:.4} over {} calls.",
		single.wall_us, single.cpu_us, single.measured_calls
	));
	emit(&info, &memory, &start, &tool);
}
