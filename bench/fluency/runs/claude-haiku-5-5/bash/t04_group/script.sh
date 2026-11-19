#!/usr/bin/env bash
set -euo pipefail

json=$(list_employees) || exit 1

printf '%s\n' "$json" | jq -r '
  map(select(.active == true and .hired >= "2021-01-01"))
  | group_by(.dept)
  | map({
      dept: .[0].dept,
      count: length,
      avg: (((map(.salary) | add) / length) | floor),
      names: (map(.name) | sort | join(","))
    })
  | sort_by([-.count, .dept])
  | .[]
  | "\(.dept) count=\(.count) avg_salary=\(.avg) names=\(.names)"
'
