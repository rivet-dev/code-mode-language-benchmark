#!/usr/bin/env bash
# Usage: check.sh <engine>... ; runs cargo check per engine in its own target dir, in parallel.
B=bench/rust-embedded
for e in "$@"; do
  ( cd $B/engines/$e && CARGO_TARGET_DIR=$B/target/$e cargo check --release --message-format short > $B/logs/check-$e.log 2>&1; echo "exit=$?" >> $B/logs/check-$e.log ) &
done
wait
