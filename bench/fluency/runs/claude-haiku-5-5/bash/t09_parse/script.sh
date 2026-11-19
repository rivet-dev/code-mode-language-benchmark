#!/usr/bin/env bash
set -uo pipefail
set -f
export LC_ALL=C

raw=$(read_log) || exit 1
log=$(jq -r '.' <<< "$raw") || exit 1

re_kv='^(.*) \{([^{}]*)\}$'
re_body='^([^ ]+) ([^ ]+) ([^:]+):'

declare -A err_count=()
declare -A err_codes=()
declare -A seen=()
best=-1
best_comp=""
best_took=""

while IFS= read -r line || [[ -n $line ]]; do
  [[ $line =~ ^[[:space:]]*$ ]] && continue

  body=$line
  kv=""
  if [[ $line =~ $re_kv ]]; then
    body=${BASH_REMATCH[1]}
    kv=${BASH_REMATCH[2]}
  fi

  [[ $body =~ $re_body ]] || continue
  level=${BASH_REMATCH[2]}
  comp=${BASH_REMATCH[3]}

  code=""
  took=""
  if [[ -n $kv ]]; then
    read -ra pairs <<< "$kv"
    for p in "${pairs[@]}"; do
      k=${p%%=*}
      v=${p#*=}
      case $k in
        code) code=$v ;;
        took) took=$v ;;
      esac
    done
  fi

  if [[ $level == ERROR ]]; then
    err_count[$comp]=$(( ${err_count[$comp]:-0} + 1 ))
    if [[ -n $code ]]; then
      s="$comp"$'\x1f'"$code"
      if [[ -z ${seen[$s]:-} ]]; then
        seen[$s]=1
        err_codes[$comp]+="$code"$'\n'
      fi
    fi
  fi

  if [[ -n $took ]]; then
    num=${took%ms}
    if [[ $num =~ ^[0-9]+$ ]] && (( 10#$num > best )); then
      best=$((10#$num))
      best_comp=$comp
      best_took=$took
    fi
  fi
done <<< "$log"

while IFS= read -r c; do
  [[ -z $c ]] && continue
  codes=$(printf '%s' "${err_codes[$c]:-}" | sort -u | paste -sd, -)
  printf '%s errors=%d codes=%s\n' "$c" "${err_count[$c]}" "$codes"
done < <(printf '%s\n' "${!err_count[@]}" | sort)

if [[ -n $best_comp ]]; then
  printf 'slowest %s %s\n' "$best_comp" "$best_took"
fi
