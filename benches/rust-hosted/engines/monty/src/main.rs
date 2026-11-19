//! Monty (pydantic's Python subset): one `MontyRepl` per session. Host functions are not Rust
//! callbacks: execution suspends at each external call and the host resumes it with the reply.

use std::time::Duration;

use bench_common::{run_owned, tick, Info};
use monty::{MontyRepl, ReplProgress};
use monty_types::{CallArgs, CompileOptions, MontyObject, PrintWriter, ResourceLimits, ResourceTracker};

#[global_allocator]
static ALLOCATOR: monty_alloc::LimitedAllocator = monty_alloc::LimitedAllocator;

const GUEST: &str = r#"
def run(start, count):
    for id in range(start, start + count):
        reply = call({"id": id, "tool": "lookup", "args": {"s": "hello from the sandbox"}})
        if reply["id"] != id:
            raise ValueError("reply mismatch")
"#;

const MAX_FEED: Duration = Duration::from_secs(600);
const MAX_TURN: Duration = Duration::from_secs(10);
const MAX_MEMORY: usize = 1 << 30;
const MAX_SUSPENSIONS: usize = 10_000_000;

struct Session {
	repl: Option<MontyRepl>,
	suspensions: usize,
}

fn limits() -> ResourceLimits {
	let mut limits = ResourceLimits::default();
	limits.max_feed_duration = Some(MAX_FEED);
	limits.max_turn_duration = Some(MAX_TURN);
	limits.max_memory = Some(MAX_MEMORY);
	limits.max_suspensions = MAX_SUSPENSIONS;
	limits
}

fn no_inputs() -> Vec<(String, MontyObject)> {
	Vec::new()
}

fn new_session() -> Session {
	let mut repl = MontyRepl::new("session.py", ResourceTracker::new(limits()), CompileOptions::default());
	let two = repl
		.feed_run("1 + 1", no_inputs(), PrintWriter::Disabled)
		.expect("evaluate 1 + 1");
	assert_eq!(two, MontyObject::int(2));
	Session {
		repl: Some(repl),
		suspensions: 0,
	}
}

/// Builds `{"id": id, "ok": True, "value": len(s)}` from the suspended call's argument.
fn reply_for(args: &CallArgs) -> MontyObject {
	let call = args.arg(0).expect("call takes one argument");
	let pairs = call.pairs().expect("call argument must be a dict");
	let mut id = None;
	let mut length = None;
	for (key, value) in &pairs {
		match key.as_str() {
			Some("id") => id = value.as_int(),
			Some("args") => {
				for (inner_key, inner_value) in value.pairs().expect("args must be a dict") {
					if inner_key.as_str() == Some("s") {
						length = inner_value.as_str().map(str::len);
					}
				}
			}
			_ => {}
		}
	}
	let id = id.expect("call['id'] must be an int");
	let length = length.expect("call['args']['s'] must be a str");
	MontyObject::dict([
		(MontyObject::string("id"), MontyObject::int(id)),
		(MontyObject::string("ok"), MontyObject::bool(true)),
		(MontyObject::string("value"), MontyObject::int(length as i64)),
	])
}

fn main() {
	// Arms monty-alloc's accounting baseline (no hard ceiling) so the soft max_memory limit is enforced.
	monty_alloc::set_hard_limit(None).expect("monty-alloc installed");
	let info = Info {
		key: "monty",
		language: "Python (Monty subset)",
		crate_name: "monty",
		version: "1.6.0",
		call_kind: "async",
		limits_enabled: format!(
			"ResourceLimits: max_feed_duration={}s, max_turn_duration={}s, max_recursion_depth=1000 (default), \
			 max_memory=1GiB with monty-alloc as the global allocator (process-wide accounting), \
			 max_suspensions={MAX_SUSPENSIONS} enforced by the host loop; no ambient filesystem, env or network",
			MAX_FEED.as_secs(),
			MAX_TURN.as_secs()
		),
		notes: vec![
			"Session = MontyRepl::new with a limited ResourceTracker, then feed_run(\"1 + 1\").".into(),
			"Host calls are suspensions, not callbacks: `call` is an undefined global, so each call pauses the VM \
			 with ReplProgress::FunctionCall and the host resumes it with the reply (like the Lua coroutine yield \
			 harness); callKind async means suspend/resume."
				.into(),
			"The argument crosses as a MontyObject graph read through ObjectRef::pairs (allocates a Vec per dict), \
			 and the reply is an owned MontyObject dict with three String keys, so every call copies in both \
			 directions."
				.into(),
			"monty's memory limit counts every allocation in the process (monty-alloc is a global counting \
			 allocator built for one session per worker process via monty-pool), so in-process it bounds all \
			 sessions together; the 1GiB value leaves room for the 1,000-session memory phase."
				.into(),
		],
	};
	run_owned(
		info,
		new_session,
		|session| {
			let repl = session.repl.as_mut().expect("session");
			repl.feed_run(GUEST, no_inputs(), PrintWriter::Disabled)
				.expect("load guest");
		},
		|session, start, count| {
			let repl = session.repl.take().expect("session");
			let code = format!("run({start}, {count})");
			let mut progress = match repl.feed_start(&code, no_inputs(), PrintWriter::Disabled) {
				Ok(progress) => progress,
				Err(error) => panic!("feed_start failed: {}", error.error),
			};
			loop {
				match progress {
					ReplProgress::FunctionCall(call) => {
						tick();
						session.suspensions += 1;
						assert!(session.suspensions <= MAX_SUSPENSIONS, "suspension budget exhausted");
						assert_eq!(call.function_name, "call");
						let reply = reply_for(&call.args);
						progress = match call.resume(reply, PrintWriter::Disabled) {
							Ok(progress) => progress,
							Err(error) => panic!("resume failed: {}", error.error),
						};
					}
					ReplProgress::Complete { repl, .. } => {
						session.repl = Some(repl);
						break;
					}
					ReplProgress::OsCall(_) | ReplProgress::ResolveFutures(_) | ReplProgress::NameLookup(_) => {
						panic!("unexpected suspension kind");
					}
				}
			}
		},
	);
}
