//! Steel (Scheme): one `Engine::new_sandboxed()` per session.

use bench_common::{run_owned, tick, Info};
use steel::gc::Gc;
use steel::rvals::{SteelHashMap, SteelString, SteelVal};
use steel::steel_vm::engine::Engine;
use steel::steel_vm::register_fn::RegisterFn;

const GUEST: &str = r#"
(define (run start count)
  (define end (+ start count))
  (define (loop id)
    (if (< id end)
        (let ((reply (call (hash 'id id 'tool "lookup" 'args (hash 's "hello from the sandbox")))))
          (if (= (hash-ref reply 'id) id)
              (loop (+ id 1))
              (error! "reply mismatch")))
        #t))
  (loop start))
"#;

struct Keys {
	id: SteelVal,
	args: SteelVal,
	s: SteelVal,
	ok: SteelVal,
	value: SteelVal,
}

thread_local! {
	static KEYS: Keys = Keys {
		id: SteelVal::SymbolV(SteelString::from("id")),
		args: SteelVal::SymbolV(SteelString::from("args")),
		s: SteelVal::SymbolV(SteelString::from("s")),
		ok: SteelVal::SymbolV(SteelString::from("ok")),
		value: SteelVal::SymbolV(SteelString::from("value")),
	};
}

/// Host `(call x)`: reads `'id` and `'args`/`'s`, returns `(hash 'id id 'ok #t 'value (string-length s))`.
fn host_call(call: SteelVal) -> Result<SteelVal, String> {
	tick();
	KEYS.with(|keys| {
		let SteelVal::HashMapV(call) = &call else {
			return Err("call expects a hash".to_string());
		};
		let id = call.get(&keys.id).cloned().ok_or("call 'id is missing")?;
		let Some(SteelVal::HashMapV(args)) = call.get(&keys.args) else {
			return Err("call 'args must be a hash".to_string());
		};
		let Some(SteelVal::StringV(text)) = args.get(&keys.s) else {
			return Err("call 'args 's must be a string".to_string());
		};
		let length = text.len();
		let mut reply = im_rc::HashMap::new();
		reply.insert(keys.id.clone(), id);
		reply.insert(keys.ok.clone(), SteelVal::BoolV(true));
		reply.insert(keys.value.clone(), SteelVal::IntV(length as isize));
		Ok(SteelVal::HashMapV(SteelHashMap::from(Gc::new(reply))))
	})
}

fn new_session() -> Engine {
	let mut engine = Engine::new_sandboxed();
	engine.register_fn("call", host_call);
	let values = engine.run("(+ 1 1)").expect("evaluate 1 + 1");
	match values.last() {
		Some(SteelVal::IntV(2)) => {}
		other => panic!("(+ 1 1) returned {other:?}"),
	}
	engine
}

fn main() {
	let info = Info {
		key: "steel",
		language: "Scheme (Steel)",
		crate_name: "steel-core",
		version: "0.8.3",
		call_kind: "sync",
		limits_enabled: "Engine::new_sandboxed() (no I/O primitives, dylib loading blocked) with the crate's \
			`sandbox` feature (bounded equality recursion); no instruction or memory limit exists: \
			Engine::with_interrupted stores a flag that the 0.8.3 VM never reads"
			.into(),
		notes: vec![
			"Session = Engine::new_sandboxed(): deep-clones a per-thread bootstrap kernel image, builds a macro \
			 Kernel, then compiles and runs the prelude; plus register_fn(call). The kernel image itself is built \
			 once per thread and is excluded by the warm-up session and warm-up runs."
				.into(),
			"Host fn is register_fn(\"call\", fn(SteelVal) -> Result<SteelVal, String>); call and reply are \
			 immutable im-rc hash maps keyed by symbols (preallocated on the host side)."
				.into(),
			"Guest loop is a tail-recursive local function; call_function_by_name_with_args runs it.".into(),
		],
	};
	run_owned(
		info,
		new_session,
		|engine| {
			engine.run(GUEST).expect("load guest");
		},
		|engine, start, count| {
			let result = engine
				.call_function_by_name_with_args(
					"run",
					vec![SteelVal::IntV(start as isize), SteelVal::IntV(count as isize)],
				)
				.expect("guest run");
			assert!(matches!(result, SteelVal::BoolV(true)), "guest returned {result:?}");
		},
	);
}
