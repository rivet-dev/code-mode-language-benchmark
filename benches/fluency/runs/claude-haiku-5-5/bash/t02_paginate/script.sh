#!/usr/bin/env bash
set -u

tmp=$(mktemp) || exit 1
trap 'rm -f "$tmp"' EXIT

# Collect every event (one JSON object per line) across all pages.
cursor=""
first=1
while :; do
  if (( first )); then
    out=$(list_events) || exit 1
    first=0
  else
    out=$(list_events "$cursor") || exit 1
  fi

  printf '%s\n' "$out" | jq -c '.events[]' >> "$tmp" || exit 1

  nc_type=$(printf '%s\n' "$out" | jq -r '.next_cursor | type') || exit 1
  [[ $nc_type == "null" ]] && break

  cursor=$(printf '%s\n' "$out" | jq -r '.next_cursor') || exit 1
done

# Total number of events.
jq -s 'length' "$tmp" || exit 1

# Per-user delete counts, sorted by count descending, then user ascending.
jq -rs '
  [.[] | select(.action == "delete")]
  | group_by(.user)
  | map({user: .[0].user, n: length})
  | sort_by([-.n, .user])
  | .[]
  | "\(.user) \(.n)"
' "$tmp" || exit 1
