```bash
#!/usr/bin/env bash
set -u

metrics=(cpu mem disk net gpu)
total=0
errfile=$(mktemp) || exit 1
trap 'rm -f "$errfile"' EXIT

for name in "${metrics[@]}"; do
    attempts=0
    ok=0
    code=""

    while (( attempts < 4 )); do
        attempts=$((attempts + 1))

        if out=$(fetch_metric "$name" 2>"$errfile"); then
            value=$(jq -r '.value' <<<"$out" 2>/dev/null)
            if [[ $value =~ ^-?[0-9]+$ ]]; then
                ok=1
                break
            fi
            # Success exit status but unusable payload: treat as permanent failure.
            code="UNKNOWN"
            break
        fi

        code=$(jq -r '.code // empty' "$errfile" 2>/dev/null)
        [[ -n $code ]] || code="UNKNOWN"

        # Only UNAVAILABLE is transient; anything else is permanent.
        if [[ $code != "UNAVAILABLE" ]]; then
            break
        fi
    done

    if (( ok )); then
        printf '%s ok %s attempts=%d\n' "$name" "$value" "$attempts"
        total=$((total + value))
    else
        printf '%s failed %s attempts=%d\n' "$name" "$code" "$attempts"
    fi
done

printf 'total=%d\n' "$total"
```
