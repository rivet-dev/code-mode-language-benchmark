```bash
#!/usr/bin/env bash
set -u

dir=$(mktemp -d) || exit 1
trap 'rm -rf "$dir"' EXIT

mapfile -t hosts < <(list_hosts 2>/dev/null | jq -r '.[]' 2>/dev/null)

# probe_one IDX HOST
# Writes "HOST STATUS LATENCY" to "$dir/IDX". A host whose probe never
# succeeds is recorded with status 0 (not 200) and latency 0.
probe_one() {
    local idx=$1 h=$2 res="" attempt status lat
    for attempt in 1 2 3; do
        if res=$(probe "$h" 2>/dev/null) && [[ -n $res ]]; then
            break
        fi
        res=""
        sleep 0.1
    done

    status=0
    lat=0
    if [[ -n $res ]]; then
        status=$(jq -r '.status // 0' <<<"$res" 2>/dev/null) || status=0
        lat=$(jq -r '.latency_ms // 0' <<<"$res" 2>/dev/null) || lat=0
    fi
    printf '%s %s %s\n' "$h" "${status:-0}" "${lat:-0}" > "$dir/$idx"
}

# Keep at most 3 probe jobs in flight. The counter is an upper bound on
# the number of unfinished jobs, so it never lets more than 3 run at once.
running=0
for i in "${!hosts[@]}"; do
    while (( running >= 3 )); do
        wait -n || true
        (( running-- ))
    done
    probe_one "$i" "${hosts[i]}" &
    (( running++ ))
done
wait

rows=$(cat "$dir"/* 2>/dev/null)

if [[ -n $rows ]]; then
    printf '%s\n' "$rows" | awk '$2 != 200 { print $1, $2 }' | LC_ALL=C sort -k1,1
    printf '%s\n' "$rows" | awk '
        BEGIN { n = 0; m = 0 }
        $2 == 200 {
            n++
            if (n == 1 || $3 > m) m = $3
        }
        END { printf "healthy=%d max_latency=%d\n", n, m }
    '
else
    echo "healthy=0 max_latency=0"
fi
```
