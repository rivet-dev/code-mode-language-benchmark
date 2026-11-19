#!/usr/bin/env bash
# Usage: build.sh <engine>... ; cargo build --release per engine in its own target dir, in parallel.
B=bench/rust-embedded
for e in "$@"; do
  ( cd $B/engines/$e && CARGO_TARGET_DIR=$B/target/$e cargo build --release --message-format short > $B/logs/build-$e.log 2>&1; echo "exit=$?" >> $B/logs/build-$e.log ) &
done
wait
