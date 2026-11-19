//! Boa (JavaScript in Rust): one `Context` per session.

use bench_common::{run_owned, tick, Info};
use boa_engine::object::ObjectInitializer;
use boa_engine::property::Attribute;
use boa_engine::{js_string, Context, JsArgs, JsNativeError, JsResult, JsValue, NativeFunction, Source};

const GUEST: &str = r#"
function run(start, count) {
  for (let id = start; id < start + count; id++) {
    const reply = call({ id, tool: "lookup", args: { s: "hello from the sandbox" } });
    if (reply.id !== id) throw new Error("reply mismatch");
  }
}
"#;

const LOOP_ITERATION_LIMIT: u64 = 1_000_000_000;
const RECURSION_LIMIT: usize = 512;
const STACK_SIZE_LIMIT: usize = 10 * 1024;

/// Host `call(x)`: reads `x.id` and `x.args.s`, returns `{ id, ok: true, value: s.length }`.
fn host_call(_this: &JsValue, args: &[JsValue], ctx: &mut Context) -> JsResult<JsValue> {
	tick();
	let call = args
		.get_or_undefined(0)
		.as_object()
		.ok_or_else(|| JsNativeError::typ().with_message("call expects an object"))?;
	let id = call.get(js_string!("id"), ctx)?;
	let call_args = call.get(js_string!("args"), ctx)?;
	let call_args = call_args
		.as_object()
		.ok_or_else(|| JsNativeError::typ().with_message("call.args must be an object"))?;
	let text = call_args.get(js_string!("s"), ctx)?;
	let length = text
		.as_string()
		.ok_or_else(|| JsNativeError::typ().with_message("call.args.s must be a string"))?
		.len();
	let reply = ObjectInitializer::new(ctx)
		.property(js_string!("id"), id, Attribute::all())
		.property(js_string!("ok"), true, Attribute::all())
		.property(js_string!("value"), length as i32, Attribute::all())
		.build();
	Ok(reply.into())
}

fn new_session() -> Context {
	let mut ctx = Context::default();
	let limits = ctx.runtime_limits_mut();
	limits.set_loop_iteration_limit(LOOP_ITERATION_LIMIT);
	limits.set_recursion_limit(RECURSION_LIMIT);
	limits.set_stack_size_limit(STACK_SIZE_LIMIT);
	ctx.register_global_callable(js_string!("call"), 1, NativeFunction::from_fn_ptr(host_call))
		.expect("register call");
	let two = ctx.eval(Source::from_bytes("1 + 1")).expect("evaluate 1 + 1");
	assert_eq!(two.as_number(), Some(2.0));
	ctx
}

fn main() {
	let info = Info {
		key: "boa",
		language: "JavaScript",
		crate_name: "boa_engine",
		version: "0.22.0",
		call_kind: "sync",
		limits_enabled: format!(
			"RuntimeLimits: loop_iteration_limit={LOOP_ITERATION_LIMIT}, recursion_limit={RECURSION_LIMIT}, \
			 stack_size_limit={STACK_SIZE_LIMIT}; no memory limit API; Context::default has no I/O (no boa_runtime)"
		),
		notes: vec![
			"Session = Context::default() (full realm with intrinsics, default features float16/xsum/temporal) + \
			 runtime limits + global call."
				.into(),
			"Host fn is NativeFunction::from_fn_ptr registered with register_global_callable; reply built with \
			 ObjectInitializer and static js_string! keys."
				.into(),
		],
	};
	run_owned(
		info,
		new_session,
		|ctx| {
			ctx.eval(Source::from_bytes(GUEST)).expect("load guest");
		},
		|ctx, start, count| {
			let run = ctx.global_object().get(js_string!("run"), ctx).expect("run");
			let run = run.as_callable().expect("run is callable");
			run.call(
				&JsValue::undefined(),
				&[JsValue::new(start as i32), JsValue::new(count as i32)],
				ctx,
			)
			.expect("guest run");
		},
	);
}
