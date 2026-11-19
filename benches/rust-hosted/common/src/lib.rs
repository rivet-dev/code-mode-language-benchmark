//! Shared harness so every engine binary applies the same three definitions.
//!
//! start: a fresh session through the value of `1 + 1` read back in Rust.
//! memory: resident growth per live session, each kept alive after its first response.
//! tool call: guest code loops calling a host `call(x)`; the host function calls [`tick`],
//! which records batch means the same way the C Lua harness does in its host loop.

use std::cell::RefCell;
use std::fmt::Write as _;
use std::time::{Duration, Instant};

/// Calls per timed batch.
pub const BATCH: u64 = 1_000;

const START_MAX_RUNS: usize = 2_000;
const START_MIN_RUNS: usize = 40;
const MEMORY_MIN_SESSIONS: usize = 50;
const MEMORY_GROWTH_BUDGET: i64 = 3 << 30;
const MEMORY_HARD_STOP: i64 = 6 << 30;
const MEMORY_TIME_BUDGET: Duration = Duration::from_secs(120);
const TOOL_CALIBRATION_CALLS: i64 = 2_000;
const TOOL_MIN_WARMUP: u64 = 20 * BATCH;

/// `BENCH_QUICK=1` shrinks every phase for smoke tests; results from it are not reported.
fn quick() -> bool {
	static QUICK: std::sync::OnceLock<bool> = std::sync::OnceLock::new();
	*QUICK.get_or_init(|| std::env::var_os("BENCH_QUICK").is_some())
}

fn memory_target_sessions() -> usize {
	if quick() { 60 } else { 1_000 }
}

fn start_time_budget() -> Duration {
	if quick() { Duration::from_secs(1) } else { Duration::from_secs(15) }
}

fn tool_time_budget() -> Duration {
	if quick() { Duration::from_millis(200) } else { Duration::from_secs(4) }
}

fn tool_batch_bounds() -> (u64, u64) {
	if quick() { (10, 50) } else { (100, 1_000) }
}

/// Static description of one engine row.
pub struct Info {
	pub key: &'static str,
	pub language: &'static str,
	pub crate_name: &'static str,
	pub version: &'static str,
	pub call_kind: &'static str,
	pub limits_enabled: String,
	pub notes: Vec<String>,
}

pub struct MemoryResult {
	pub bytes_per_session: f64,
	pub sessions: usize,
	pub stopped_by: &'static str,
	pub extra_stack_bytes: i64,
}

pub struct StartResult {
	pub median_us: f64,
	pub runs: usize,
}

pub struct ToolResult {
	pub wall_us: f64,
	/// Total measured wall time divided by calls, so pauses that the median skips still show.
	pub wall_mean_us: f64,
	/// Mean per-call time of the slowest batch.
	pub slowest_batch_us: f64,
	pub cpu_us: f64,
	pub measured_calls: u64,
	pub warmup_calls: u64,
	pub batches: usize,
}

pub fn monotonic() -> Instant {
	Instant::now()
}

/// Process CPU time across all threads, in nanoseconds.
pub fn process_cpu_ns() -> f64 {
	let mut now = libc::timespec { tv_sec: 0, tv_nsec: 0 };
	// SAFETY: `now` is a valid, writable timespec.
	let status = unsafe { libc::clock_gettime(libc::CLOCK_PROCESS_CPUTIME_ID, &mut now) };
	assert_eq!(status, 0, "clock_gettime(CLOCK_PROCESS_CPUTIME_ID) failed");
	now.tv_sec as f64 * 1e9 + now.tv_nsec as f64
}

/// Resident set size from /proc/self/statm, in bytes.
pub fn resident_bytes() -> i64 {
	let statm = std::fs::read_to_string("/proc/self/statm").expect("read /proc/self/statm");
	let mut fields = statm.split_whitespace();
	let _size = fields.next();
	let resident: i64 = fields.next().expect("statm resident").parse().expect("statm parse");
	// SAFETY: sysconf has no preconditions.
	let page = unsafe { libc::sysconf(libc::_SC_PAGESIZE) } as i64;
	resident * page
}

/// Returns freed heap pages to the kernel so later growth is not served from reused memory.
pub fn trim_heap() {
	// SAFETY: malloc_trim has no preconditions.
	unsafe {
		libc::malloc_trim(0);
	}
}

fn median(values: &mut [f64]) -> f64 {
	values.sort_by(|a, b| a.partial_cmp(b).expect("no NaN samples"));
	values[values.len() / 2]
}

// ---------------------------------------------------------------------------
// Tool-call batch timer, driven from inside each engine's host function.

struct Timer {
	index: u64,
	warmup: u64,
	batch_started: Instant,
	measured_started: Instant,
	cpu_started_ns: f64,
	batch_means_ns: Vec<f64>,
}

thread_local! {
	static TIMER: RefCell<Timer> = RefCell::new(Timer {
		index: 0,
		warmup: u64::MAX,
		batch_started: Instant::now(),
		measured_started: Instant::now(),
		cpu_started_ns: 0.0,
		batch_means_ns: Vec::new(),
	});
}

/// Called once at the top of every host `call(x)`, like the C harness's host loop.
#[inline]
pub fn tick() {
	TIMER.with(|cell| {
		let mut timer = cell.borrow_mut();
		let index = timer.index;
		timer.index = index + 1;
		if index < timer.warmup {
			return;
		}
		if index == timer.warmup {
			timer.cpu_started_ns = process_cpu_ns();
			timer.batch_started = Instant::now();
			timer.measured_started = timer.batch_started;
			return;
		}
		if (index - timer.warmup) % BATCH == 0 {
			let now = Instant::now();
			let mean = (now - timer.batch_started).as_nanos() as f64 / BATCH as f64;
			timer.batch_means_ns.push(mean);
			timer.batch_started = now;
		}
	});
}

/// Number of host calls seen since the timer was last reset.
pub fn calls_seen() -> u64 {
	TIMER.with(|cell| cell.borrow().index)
}

fn timer_reset(warmup: u64, expected_batches: usize) {
	TIMER.with(|cell| {
		let mut timer = cell.borrow_mut();
		timer.index = 0;
		timer.warmup = warmup;
		timer.batch_means_ns = Vec::with_capacity(expected_batches + 1);
	});
}

/// Closes the final batch; returns (batch means in ns, process CPU ns and wall ns since the first
/// measured call, calls).
fn timer_finish() -> (Vec<f64>, f64, f64, u64) {
	let cpu_now = process_cpu_ns();
	let now = Instant::now();
	TIMER.with(|cell| {
		let mut timer = cell.borrow_mut();
		let mean = (now - timer.batch_started).as_nanos() as f64 / BATCH as f64;
		timer.batch_means_ns.push(mean);
		let means = std::mem::take(&mut timer.batch_means_ns);
		let cpu = cpu_now - timer.cpu_started_ns;
		let wall = (now - timer.measured_started).as_nanos() as f64;
		let calls = timer.index;
		timer.warmup = u64::MAX;
		(means, cpu, wall, calls)
	})
}

// ---------------------------------------------------------------------------
// Phases.

/// Memory for engines whose sessions are owned values.
pub fn measure_memory<S>(mut new_session: impl FnMut() -> S) -> MemoryResult {
	// One warm-up session absorbs one-time process initialization such as lazily built
	// global tables; it is dropped and trimmed before the baseline is read.
	drop(new_session());
	let mut sessions: Vec<S> = Vec::with_capacity(memory_target_sessions());
	trim_heap();
	let before = resident_bytes();
	let started = Instant::now();
	let mut stopped_by = "target";
	while sessions.len() < memory_target_sessions() {
		sessions.push(new_session());
		let growth = resident_bytes() - before;
		if growth > MEMORY_HARD_STOP {
			stopped_by = "hard memory stop";
			break;
		}
		if sessions.len() >= MEMORY_MIN_SESSIONS {
			if growth > MEMORY_GROWTH_BUDGET {
				stopped_by = "memory budget";
				break;
			}
			if started.elapsed() > MEMORY_TIME_BUDGET {
				stopped_by = "time budget";
				break;
			}
		}
	}
	let after = resident_bytes();
	let count = sessions.len();
	drop(sessions);
	trim_heap();
	MemoryResult {
		bytes_per_session: (after - before) as f64 / count as f64,
		sessions: count,
		stopped_by,
		extra_stack_bytes: 0,
	}
}

/// Session creator for engines whose sessions only live inside a closure.
/// It must create a fresh session, get its first response, then call `inside` while it is alive.
pub type ScopedSession<'a> = dyn Fn(&mut dyn FnMut()) + 'a;

const NESTED_STACK_RESERVE: usize = 64 << 20;

/// Memory for engines with scoped sessions: sessions nest by recursion so all stay alive.
/// The stack region the recursion will use is touched before the baseline is read, so stack
/// pages are not counted as session memory. Runs on a thread with a large stack.
pub fn measure_memory_nested(with_session: &ScopedSession<'_>) -> MemoryResult {
	struct State {
		before: i64,
		started: Instant,
		count: usize,
		after: i64,
		stopped_by: &'static str,
		top_of_stack: usize,
		deepest_stack: usize,
	}

	fn nest(with_session: &ScopedSession<'_>, state: &mut State) {
		with_session(&mut || {
			state.count += 1;
			let marker = 0u8;
			let address = std::hint::black_box(&marker) as *const u8 as usize;
			state.deepest_stack = state.deepest_stack.min(address);
			let growth = resident_bytes() - state.before;
			let mut stop = None;
			if growth > MEMORY_HARD_STOP {
				stop = Some("hard memory stop");
			} else if state.count >= memory_target_sessions() {
				stop = Some("target");
			} else if state.count >= MEMORY_MIN_SESSIONS {
				if growth > MEMORY_GROWTH_BUDGET {
					stop = Some("memory budget");
				} else if state.started.elapsed() > MEMORY_TIME_BUDGET {
					stop = Some("time budget");
				}
			}
			match stop {
				Some(reason) => {
					// Read while every session is still alive.
					state.after = resident_bytes();
					state.stopped_by = reason;
				}
				None => nest(with_session, state),
			}
		});
	}

	#[inline(never)]
	fn touch_stack() {
		let mut block = [0u8; NESTED_STACK_RESERVE];
		for index in (0..block.len()).step_by(4096) {
			block[index] = 1;
		}
		std::hint::black_box(&mut block);
	}

	// Warm-up session for one-time initialization, as in `measure_memory`.
	with_session(&mut || {});
	touch_stack();
	trim_heap();
	let marker = 0u8;
	let top = std::hint::black_box(&marker) as *const u8 as usize;
	let mut state = State {
		before: resident_bytes(),
		started: Instant::now(),
		count: 0,
		after: 0,
		stopped_by: "target",
		top_of_stack: top,
		deepest_stack: top,
	};
	nest(with_session, &mut state);
	trim_heap();
	let used_stack = state.top_of_stack.saturating_sub(state.deepest_stack);
	MemoryResult {
		bytes_per_session: (state.after - state.before) as f64 / state.count as f64,
		sessions: state.count,
		stopped_by: state.stopped_by,
		extra_stack_bytes: used_stack as i64 - NESTED_STACK_RESERVE as i64,
	}
}

/// Runs `body` on a thread with a stack big enough for `measure_memory_nested`.
pub fn on_big_stack<T: Send + 'static>(body: impl FnOnce() -> T + Send + 'static) -> T {
	std::thread::Builder::new()
		.stack_size(1 << 30)
		.spawn(body)
		.expect("spawn big-stack thread")
		.join()
		.expect("big-stack thread panicked")
}

/// Start time. `cycle` creates a fresh session, returns the time from creation through the
/// first response, then drops the session outside the timed region.
pub fn measure_start(mut cycle: impl FnMut() -> Duration) -> StartResult {
	let probe_started = Instant::now();
	let probes = 5;
	for _ in 0..probes {
		cycle();
	}
	let per_cycle = probe_started.elapsed() / probes;
	let budget_runs = (start_time_budget().as_secs_f64() / per_cycle.as_secs_f64().max(1e-9)) as usize;
	let runs = budget_runs.clamp(START_MIN_RUNS, START_MAX_RUNS);
	let warmup = if per_cycle > Duration::from_millis(50) { 5 } else { 20 };
	for _ in 0..warmup {
		cycle();
	}
	let mut samples: Vec<f64> = (0..runs).map(|_| cycle().as_nanos() as f64).collect();
	StartResult {
		median_us: median(&mut samples) / 1e3,
		runs,
	}
}

/// Tool calls in one already-created session. `run_calls(start, count)` makes the guest loop
/// `count` times calling the host function, whose body calls [`tick`].
pub fn measure_tool_calls(mut run_calls: impl FnMut(i64, i64)) -> ToolResult {
	timer_reset(u64::MAX, 0);
	let calibration_started = Instant::now();
	run_calls(0, TOOL_CALIBRATION_CALLS);
	let per_call = calibration_started.elapsed().as_secs_f64() / TOOL_CALIBRATION_CALLS as f64;
	assert_eq!(calls_seen(), TOOL_CALIBRATION_CALLS as u64, "calibration call count");

	let affordable = (tool_time_budget().as_secs_f64() / (per_call * BATCH as f64)) as u64;
	let (min_batches, max_batches) = tool_batch_bounds();
	let batches = affordable.clamp(min_batches, max_batches);
	let measured = batches * BATCH;
	let warmup = (measured / 10).max(TOOL_MIN_WARMUP);

	timer_reset(warmup, batches as usize);
	run_calls(TOOL_CALIBRATION_CALLS, (warmup + measured) as i64);
	let (mut means, cpu_ns, wall_ns, calls) = timer_finish();
	assert_eq!(calls, warmup + measured, "guest stopped early");
	assert_eq!(means.len() as u64, batches, "batch count");
	let slowest_batch_us = means.iter().cloned().fold(0.0, f64::max) / 1e3;
	ToolResult {
		wall_us: median(&mut means) / 1e3,
		wall_mean_us: wall_ns / measured as f64 / 1e3,
		slowest_batch_us,
		cpu_us: cpu_ns / measured as f64 / 1e3,
		measured_calls: measured,
		warmup_calls: warmup,
		batches: batches as usize,
	}
}

/// Memory first (fresh process), then start, then tool calls, then one JSON line on stdout.
pub fn run_owned<S>(
	info: Info,
	mut new_session: impl FnMut() -> S,
	load_guest: impl FnOnce(&mut S),
	mut run_calls: impl FnMut(&mut S, i64, i64),
) {
	eprintln!("[{}] memory", info.key);
	let memory = measure_memory(&mut new_session);
	eprintln!("[{}] start", info.key);
	let start = measure_start(|| {
		let started = Instant::now();
		let session = new_session();
		let elapsed = started.elapsed();
		drop(session);
		elapsed
	});
	eprintln!("[{}] tool calls", info.key);
	let mut session = new_session();
	load_guest(&mut session);
	let tool = measure_tool_calls(|start, count| run_calls(&mut session, start, count));
	drop(session);
	emit(&info, &memory, &start, &tool);
}

fn json_string(out: &mut String, value: &str) {
	out.push('"');
	for character in value.chars() {
		match character {
			'"' => out.push_str("\\\""),
			'\\' => out.push_str("\\\\"),
			'\n' => out.push_str("\\n"),
			'\t' => out.push_str("\\t"),
			control if (control as u32) < 0x20 => {
				let _ = write!(out, "\\u{:04x}", control as u32);
			}
			other => out.push(other),
		}
	}
	out.push('"');
}

pub fn emit(info: &Info, memory: &MemoryResult, start: &StartResult, tool: &ToolResult) {
	let mut out = String::new();
	out.push('{');
	let field = |out: &mut String, name: &str| {
		if !out.ends_with('{') {
			out.push(',');
		}
		json_string(out, name);
		out.push(':');
	};
	field(&mut out, "key");
	json_string(&mut out, info.key);
	field(&mut out, "language");
	json_string(&mut out, info.language);
	field(&mut out, "crate");
	json_string(&mut out, info.crate_name);
	field(&mut out, "version");
	json_string(&mut out, info.version);
	field(&mut out, "startUs");
	let _ = write!(out, "{:.3}", start.median_us);
	field(&mut out, "startRuns");
	let _ = write!(out, "{}", start.runs);
	field(&mut out, "memoryBytesPerSession");
	let _ = write!(out, "{:.0}", memory.bytes_per_session);
	field(&mut out, "memorySessions");
	let _ = write!(out, "{}", memory.sessions);
	field(&mut out, "memoryStoppedBy");
	json_string(&mut out, memory.stopped_by);
	field(&mut out, "memoryExtraStackBytes");
	let _ = write!(out, "{}", memory.extra_stack_bytes);
	field(&mut out, "toolCallWallUs");
	let _ = write!(out, "{:.4}", tool.wall_us);
	field(&mut out, "toolCallWallMeanUs");
	let _ = write!(out, "{:.4}", tool.wall_mean_us);
	field(&mut out, "toolCallSlowestBatchUs");
	let _ = write!(out, "{:.4}", tool.slowest_batch_us);
	field(&mut out, "toolCallCpuUs");
	let _ = write!(out, "{:.4}", tool.cpu_us);
	field(&mut out, "toolCallMeasuredCalls");
	let _ = write!(out, "{}", tool.measured_calls);
	field(&mut out, "toolCallWarmupCalls");
	let _ = write!(out, "{}", tool.warmup_calls);
	field(&mut out, "toolCallBatches");
	let _ = write!(out, "{}", tool.batches);
	field(&mut out, "toolCallBatchSize");
	let _ = write!(out, "{}", BATCH);
	field(&mut out, "callKind");
	json_string(&mut out, info.call_kind);
	field(&mut out, "limitsEnabled");
	json_string(&mut out, &info.limits_enabled);
	field(&mut out, "notes");
	out.push('[');
	for (index, note) in info.notes.iter().enumerate() {
		if index > 0 {
			out.push(',');
		}
		json_string(&mut out, note);
	}
	out.push(']');
	out.push('}');
	println!("{out}");
}
