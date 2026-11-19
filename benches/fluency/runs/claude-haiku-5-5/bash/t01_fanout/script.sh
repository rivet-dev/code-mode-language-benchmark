#!/usr/bin/env bash
set -euo pipefail
export LC_ALL=C

warehouses=$(list_warehouses)

mapfile -t warehouse_ids < <(jq -r '.[]' <<< "$warehouses")

rows=""
for wh in "${warehouse_ids[@]}"; do
    inv=$(get_inventory "$wh")
    rows+=$(jq -r '.[] | "\(.sku)\t\(.qty)"' <<< "$inv")$'\n'
done

printf '%s' "$rows" |
    awk -F'\t' 'NF == 2 { total[$1] += $2 }
                END { for (s in total) if (total[s] >= 50) printf "%s\t%d\n", s, total[s] }' |
    sort -t$'\t' -k2,2nr -k1,1 |
    tr '\t' ' '
