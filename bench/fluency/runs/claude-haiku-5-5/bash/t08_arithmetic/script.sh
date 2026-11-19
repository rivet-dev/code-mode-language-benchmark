#!/usr/bin/env bash
set -u

rates=$(get_rates) || exit 1
expenses=$(list_expenses) || exit 1

report=$(jq -r -n --argjson rates "$rates" --argjson exp "$expenses" '
  def rate($c): if $c == "EUR" then 1 else $rates.rates[$c] end;
  ($exp | map({id: .id, category: .category, eur: (.amount / rate(.currency))})) as $list
  | ($list | group_by(.category) | map({category: .[0].category, total: (map(.eur) | add)})) as $cats
  | (reduce $list[] as $e (null; if . == null or $e.eur > .eur then $e else . end)) as $max
  | ($list | map(.eur) | add // 0) as $total
  | ( $cats[] | "C\t\(.category)\t\(.total)" ),
    "T\t\($total)",
    (if $max then "M\t\($max.id)\t\($max.eur)" else empty end)
') || exit 1

printf '%s\n' "$report" | LC_ALL=C awk -F'\t' '
  $1 == "C" { printf "%s %.2f\n", $2, $3 + 0; next }
  $1 == "T" { printf "TOTAL %.2f\n", $2 + 0; next }
  $1 == "M" { printf "MAX %s %.2f\n", $2, $3 + 0 }
'
