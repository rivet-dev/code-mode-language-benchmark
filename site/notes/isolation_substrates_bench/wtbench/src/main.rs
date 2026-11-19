//! Wasmtime embedding microbenchmarks: compile time, instantiation latency, per-instance memory
//! (virtual vs resident), host-call overhead (sync and async), suspended async fiber cost, and
//! epoch vs fuel interruption overhead.

use anyhow::Result;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Instant;
use tokio::sync::Semaphore;
use wasmtime::*;

const WAT: &str = r#"
(module
  (import "host" "add" (func $add (param i32 i32) (result i32)))
  (memory (export "memory") 1)
  (data (i32.const 1024) "initialized data so the module has a copy-on-write memory image")
  (func (export "noop"))
  (func (export "call_host") (param $n i32) (result i32)
    (local $i i32) (local $acc i32)
    (block $done
      (loop $l
        (br_if $done (i32.ge_u (local.get $i) (local.get $n)))
        (local.set $acc (call $add (local.get $acc) (i32.const 1)))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $l)))
    (local.get $acc))
  (func (export "spin") (param $n i32) (result i32)
    (local $i i32) (local $x i32)
    (local.set $x (i32.const 123456789))
    (block $done
      (loop $l
        (br_if $done (i32.ge_u (local.get $i) (local.get $n)))
        (local.set $x (i32.xor (local.get $x) (i32.shl (local.get $x) (i32.const 13))))
        (local.set $x (i32.xor (local.get $x) (i32.shr_u (local.get $x) (i32.const 17))))
        (local.set $x (i32.xor (local.get $x) (i32.shl (local.get $x) (i32.const 5))))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $l)))
    (local.get $x))
  (func (export "touch") (param $pages i32)
    (local $i i32)
    (block $done
      (loop $l
        (br_if $done (i32.ge_u (local.get $i) (local.get $pages)))
        (i32.store8 (i32.mul (local.get $i) (i32.const 4096)) (i32.const 1))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $l)))))
"#;

#[derive(Clone, Copy, Debug)]
struct Mem {
	vm_size_kb: i64,
	vm_rss_kb: i64,
	rss_anon_kb: i64,
}

fn mem() -> Mem {
	let s = std::fs::read_to_string("/proc/self/status").unwrap_or_default();
	let get = |k: &str| -> i64 {
		s.lines()
			.find(|l| l.starts_with(k))
			.and_then(|l| l.split_whitespace().nth(1))
			.and_then(|v| v.parse().ok())
			.unwrap_or(0)
	};
	Mem { vm_size_kb: get("VmSize:"), vm_rss_kb: get("VmRSS:"), rss_anon_kb: get("RssAnon:") }
}

fn delta_per(a: Mem, b: Mem, n: usize) -> String {
	let n = n as f64;
	format!(
		"VmSize {:.1} KiB/inst, RSS {:.1} KiB/inst, RssAnon {:.1} KiB/inst",
		(b.vm_size_kb - a.vm_size_kb) as f64 / n,
		(b.vm_rss_kb - a.vm_rss_kb) as f64 / n,
		(b.rss_anon_kb - a.rss_anon_kb) as f64 / n
	)
}

fn pooling(n: u32) -> PoolingAllocationConfig {
	let mut p = PoolingAllocationConfig::default();
	p.total_core_instances(n).total_memories(n).total_tables(n).total_stacks(n);
	p.max_memory_size(1 << 20);
	p
}

fn engine(kind: &str, alloc_pool: Option<u32>) -> Result<Engine> {
	let mut c = Config::new();
	match kind {
		"cranelift" => {}
		"cranelift+epoch" => {
			c.epoch_interruption(true);
		}
		"cranelift+fuel" => {
			c.consume_fuel(true);
		}
		"winch" => {
			c.strategy(Strategy::Winch);
		}
		"pulley" => {
			c.target("pulley64")?;
		}
		other => anyhow::bail!("unknown engine kind {other}"),
	}
	if let Some(n) = alloc_pool {
		c.allocation_strategy(InstanceAllocationStrategy::Pooling(pooling(n)));
	}
	Ok(Engine::new(&c)?)
}

fn new_store(engine: &Engine) -> Store<()> {
	let mut store = Store::new(engine, ());
	store.set_epoch_deadline(u64::MAX / 2);
	let _ = store.set_fuel(u64::MAX / 2);
	store
}

fn sync_linker(engine: &Engine) -> Result<Linker<()>> {
	let mut linker = Linker::new(engine);
	linker.func_wrap("host", "add", |a: i32, b: i32| a.wrapping_add(b))?;
	Ok(linker)
}

fn bench_sync(kind: &str) -> Result<()> {
	let engine = engine(kind, None)?;
	let t = Instant::now();
	let module = Module::new(&engine, WAT)?;
	let compile_ms = t.elapsed().as_secs_f64() * 1e3;
	let pre = sync_linker(&engine)?.instantiate_pre(&module)?;

	let mut store = new_store(&engine);
	let inst = pre.instantiate(&mut store)?;
	let call_host = inst.get_typed_func::<i32, i32>(&mut store, "call_host")?;
	let noop = inst.get_typed_func::<(), ()>(&mut store, "noop")?;
	let spin = inst.get_typed_func::<i32, i32>(&mut store, "spin")?;

	let n = 10_000_000;
	call_host.call(&mut store, 1000)?;
	let t = Instant::now();
	call_host.call(&mut store, n)?;
	let host_call_ns = t.elapsed().as_secs_f64() * 1e9 / n as f64;

	let m = 2_000_000;
	let t = Instant::now();
	for _ in 0..m {
		noop.call(&mut store, ())?;
	}
	let entry_ns = t.elapsed().as_secs_f64() * 1e9 / m as f64;

	let s = 300_000_000;
	spin.call(&mut store, 1000)?;
	let t = Instant::now();
	let x = spin.call(&mut store, s)?;
	let spin_ms = t.elapsed().as_secs_f64() * 1e3;

	println!(
		"[{kind}] compile {compile_ms:.2} ms | wasm->host sync call {host_call_ns:.2} ns | host->wasm call {entry_ns:.1} ns | spin(300M xorshift) {spin_ms:.1} ms (x={x})"
	);
	Ok(())
}

fn bench_instantiate(kind: &str, pool: bool) -> Result<()> {
	let n_live: usize = 10_000;
	let m0 = mem();
	let engine = engine(kind, if pool { Some(n_live as u32 + 100) } else { None })?;
	let m_engine = mem();
	let module = Module::new(&engine, WAT)?;
	let pre = sync_linker(&engine)?.instantiate_pre(&module)?;

	for _ in 0..200 {
		let mut store = new_store(&engine);
		pre.instantiate(&mut store)?;
	}
	let iters = 20_000;
	let t = Instant::now();
	for _ in 0..iters {
		let mut store = new_store(&engine);
		pre.instantiate(&mut store)?;
	}
	let inst_us = t.elapsed().as_secs_f64() * 1e6 / iters as f64;

	// Keep many instances alive, each dirtying one 4 KiB page of linear memory.
	let before = mem();
	let mut live = Vec::with_capacity(n_live);
	for _ in 0..n_live {
		let mut store = new_store(&engine);
		let inst = pre.instantiate(&mut store)?;
		let touch = inst.get_typed_func::<i32, ()>(&mut store, "touch")?;
		touch.call(&mut store, 1)?;
		live.push((store, inst));
	}
	let after = mem();
	println!(
		"[{kind} {}] engine VmSize +{:.1} GiB at creation | instantiate+drop {inst_us:.2} us | {n_live} live instances: {}",
		if pool { "pooling" } else { "on-demand" },
		(m_engine.vm_size_kb - m0.vm_size_kb) as f64 / 1024.0 / 1024.0,
		delta_per(before, after, n_live)
	);
	drop(live);
	Ok(())
}

async fn bench_async(pool: bool) -> Result<()> {
	let k: usize = 10_000;
	let engine = engine("cranelift", if pool { Some(k as u32 + 100) } else { None })?;
	let module = Module::new(&engine, WAT)?;

	// Immediately-ready async host function.
	let mut ready = Linker::new(&engine);
	ready.func_wrap_async("host", "add", |_c: Caller<'_, ()>, (a, b): (i32, i32)| {
		Box::new(async move { a.wrapping_add(b) })
	})?;
	let pre_ready = ready.instantiate_pre(&module)?;
	let mut store = new_store(&engine);
	let inst = pre_ready.instantiate_async(&mut store).await?;
	let call_host = inst.get_typed_func::<i32, i32>(&mut store, "call_host")?;
	let noop = inst.get_typed_func::<(), ()>(&mut store, "noop")?;
	let n = 2_000_000;
	call_host.call_async(&mut store, 1000).await?;
	let t = Instant::now();
	call_host.call_async(&mut store, n).await?;
	let ready_ns = t.elapsed().as_secs_f64() * 1e9 / n as f64;
	let m = 200_000;
	let t = Instant::now();
	for _ in 0..m {
		noop.call_async(&mut store, ()).await?;
	}
	let entry_ns = t.elapsed().as_secs_f64() * 1e9 / m as f64;

	// Async host function that suspends the guest fiber once per call.
	let mut yielding = Linker::new(&engine);
	yielding.func_wrap_async("host", "add", |_c: Caller<'_, ()>, (a, b): (i32, i32)| {
		Box::new(async move {
			tokio::task::yield_now().await;
			a.wrapping_add(b)
		})
	})?;
	let pre_yield = yielding.instantiate_pre(&module)?;
	let mut store = new_store(&engine);
	let inst = pre_yield.instantiate_async(&mut store).await?;
	let call_host = inst.get_typed_func::<i32, i32>(&mut store, "call_host")?;
	let n = 500_000;
	let t = Instant::now();
	call_host.call_async(&mut store, n).await?;
	let yield_ns = t.elapsed().as_secs_f64() * 1e9 / n as f64;

	// K guests, each suspended inside a pending async host call.
	let gate = Arc::new(Semaphore::new(0));
	let entered = Arc::new(AtomicUsize::new(0));
	let mut blocking = Linker::new(&engine);
	{
		let gate = gate.clone();
		let entered = entered.clone();
		blocking.func_wrap_async("host", "add", move |_c: Caller<'_, ()>, (a, b): (i32, i32)| {
			let gate = gate.clone();
			let entered = entered.clone();
			Box::new(async move {
				entered.fetch_add(1, Ordering::SeqCst);
				let permit = gate.acquire().await;
				drop(permit);
				a.wrapping_add(b)
			})
		})?;
	}
	let pre_block = Arc::new(blocking.instantiate_pre(&module)?);
	let before = mem();
	let mut tasks = Vec::with_capacity(k);
	for _ in 0..k {
		let engine = engine.clone();
		let pre = pre_block.clone();
		tasks.push(tokio::spawn(async move {
			let mut store = new_store(&engine);
			let inst = pre.instantiate_async(&mut store).await?;
			let f = inst.get_typed_func::<i32, i32>(&mut store, "call_host")?;
			f.call_async(&mut store, 1).await
		}));
	}
	while entered.load(Ordering::SeqCst) < k {
		tokio::task::yield_now().await;
	}
	let during = mem();
	gate.add_permits(k);
	for t in tasks {
		t.await??;
	}
	println!(
		"[async {}] wasm->host ready-future call {ready_ns:.1} ns | host->wasm call_async {entry_ns:.0} ns | suspend+resume per host call {yield_ns:.0} ns | {k} guests suspended in host call: {}",
		if pool { "pooling" } else { "on-demand" },
		delta_per(before, during, k)
	);
	Ok(())
}

fn main() -> Result<()> {
	for kind in ["cranelift", "cranelift+epoch", "cranelift+fuel", "winch", "pulley"] {
		if let Err(e) = bench_sync(kind) {
			println!("[{kind}] sync bench failed: {e:#}");
		}
	}
	for kind in ["cranelift", "pulley"] {
		for pool in [false, true] {
			if let Err(e) = bench_instantiate(kind, pool) {
				println!("[{kind} pool={pool}] instantiate bench failed: {e:#}");
			}
		}
	}
	let rt = tokio::runtime::Builder::new_current_thread().enable_all().build()?;
	for pool in [false, true] {
		if let Err(e) = rt.block_on(bench_async(pool)) {
			println!("[async pool={pool}] failed: {e:#}");
		}
	}
	Ok(())
}
