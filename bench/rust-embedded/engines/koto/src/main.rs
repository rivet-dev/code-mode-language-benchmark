//! Koto: one `Koto` runtime per session, with the `io` and `os` modules removed from its prelude.

use std::time::Duration;

use bench_common::{run_owned, tick, Info};
use koto::prelude::*;

const GUEST: &str = r#"
export run = |start, count|
  for id in start..(start + count)
    reply = call {id: id, tool: 'lookup', args: {s: 'hello from the sandbox'}}
    if reply.id != id
      throw 'reply mismatch'
"#;

const EXECUTION_LIMIT: Duration = Duration::from_secs(600);

thread_local! {
	static KEYS: [KString; 3] = [KString::from("id"), KString::from("ok"), KString::from("value")];
}

/// Host `call(x)`: reads `x.id` and `x.args.s`, returns `{id, ok: true, value: size(s)}`.
fn host_call(ctx: &mut CallContext) -> koto::runtime::Result<KValue> {
	tick();
	let call = match ctx.args() {
		[KValue::Map(call)] => call.clone(),
		unexpected => return unexpected_args("|Map|", unexpected),
	};
	let Some(id) = call.get("id") else {
		return runtime_error!("call.id is missing");
	};
	let length = match call.get("args") {
		Some(KValue::Map(args)) => match args.get("s") {
			Some(KValue::Str(text)) => text.len(),
			_ => return runtime_error!("call.args.s must be a string"),
		},
		_ => return runtime_error!("call.args must be a map"),
	};
	let reply = KMap::with_capacity(3);
	KEYS.with(|[id_key, ok_key, value_key]| {
		reply.insert(id_key.clone(), id);
		reply.insert(ok_key.clone(), true);
		reply.insert(value_key.clone(), length as i64);
	});
	Ok(reply.into())
}

fn new_session() -> Koto {
	let settings = KotoSettings::default().with_execution_limit(EXECUTION_LIMIT);
	let mut koto = Koto::with_settings(settings);
	koto.prelude().remove("io");
	koto.prelude().remove("os");
	koto.prelude().add_fn("call", host_call);
	match koto.compile_and_run("1 + 1").expect("evaluate 1 + 1") {
		KValue::Number(two) if i64::from(two) == 2 => {}
		other => panic!("1 + 1 returned {}", other.type_as_string()),
	}
	koto
}

fn main() {
	let info = Info {
		key: "koto",
		language: "Koto",
		crate_name: "koto",
		version: "0.16.1",
		call_kind: "sync",
		limits_enabled: format!(
			"KotoSettings::with_execution_limit({}s) (wall-clock deadline checked between instructions); io and os \
			 modules removed from the prelude (Koto's default prelude has file I/O and os.command); no memory or \
			 instruction-count limit API; `import` can still load .koto files from disk (no setting disables it)",
			EXECUTION_LIMIT.as_secs()
		),
		notes: vec![
			"Session = Koto::with_settings (fresh core-library prelude per runtime) minus io/os, plus prelude call."
				.into(),
			"Host fn is KMap::add_fn(\"call\", |ctx| ...) on the prelude; reply keys reuse preallocated KStrings."
				.into(),
			"Guest is an exported Koto function invoked with Koto::call_function.".into(),
		],
	};
	run_owned(
		info,
		new_session,
		|koto| {
			koto.compile_and_run(GUEST).expect("load guest");
		},
		|koto, start, count| {
			let run = koto.exports().get("run").expect("exported run");
			koto.call_function(run, &[KValue::from(start), KValue::from(count)])
				.expect("guest run");
		},
	);
}
