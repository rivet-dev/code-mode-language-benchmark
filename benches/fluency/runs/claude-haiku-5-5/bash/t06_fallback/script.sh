#!/usr/bin/env bash
set -u

resolved=0
unresolved=0

# Runs a tool command. Sets globals: out (stdout), err (stderr), rc (exit status).
call() {
  local errf
  out=""
  err=""
  rc=1
  if ! errf=$(mktemp); then
    err='{"code": "INTERNAL", "message": "mktemp failed"}'
    return
  fi
  out=$("$@" 2>"$errf")
  rc=$?
  err=$(<"$errf")
  rm -f -- "$errf"
}

# Extracts the error code from the global err variable.
error_code() {
  local code
  code=$(jq -r '.code // empty' <<<"$err" 2>/dev/null)
  [[ -n $code ]] || code=UNKNOWN
  printf '%s' "$code"
}

ids_json=$(list_user_ids 2>/dev/null) || ids_json='[]'
mapfile -t ids < <(jq -r '.[]' <<<"$ids_json" 2>/dev/null)

for id in "${ids[@]}"; do
  call get_profile "$id"
  if (( rc == 0 )); then
    display_name=$(jq -r '.display_name' <<<"$out" 2>/dev/null)
    email=$(jq -r '.email' <<<"$out" 2>/dev/null)
    printf '%s | %s | %s | primary\n' "$id" "$display_name" "$email"
    ((resolved++))
    continue
  fi

  code=$(error_code)
  if [[ $code == NOT_FOUND ]]; then
    call get_legacy_profile "$id"
    if (( rc == 0 )); then
      display_name=$(jq -r '.name.first + " " + .name.last' <<<"$out" 2>/dev/null)
      email=$(jq -r 'if .mail == null then "-" else .mail end' <<<"$out" 2>/dev/null)
      printf '%s | %s | %s | legacy\n' "$id" "$display_name" "$email"
      ((resolved++))
      continue
    fi
    code=$(error_code)
  fi

  printf '%s | unresolved | %s\n' "$id" "$code"
  ((unresolved++))
done

printf 'resolved=%d unresolved=%d\n' "$resolved" "$unresolved"
