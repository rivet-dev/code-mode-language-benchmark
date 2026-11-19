```bash
#!/usr/bin/env bash

declare -A TITLE=()
declare -A PARENT=()
declare -A FETCHED=()

# Fetch a task at most once per run. Returns 0 if the task data is cached.
fetch() {
    local id=$1 out
    if [[ -n ${FETCHED[$id]+x} ]]; then
        [[ ${FETCHED[$id]} == ok ]]
        return
    fi
    if ! out=$(get_task "$id" 2>/dev/null); then
        FETCHED[$id]=fail
        return 1
    fi
    FETCHED[$id]=ok
    TITLE[$id]=$(jq -r '.title // ""' <<<"$out")
    PARENT[$id]=$(jq -r '.parent_id // ""' <<<"$out")
    return 0
}

# Print the breadcrumb (root > ... > task) for a task ID.
breadcrumb() {
    local start=$1 cur=$1 p c path=""
    local -a chain=()
    local -A onchain=()

    while :; do
        [[ -n ${onchain[$cur]+x} ]] && break   # cycle guard
        fetch "$cur" || break
        onchain[$cur]=1
        chain+=("$cur")
        p=${PARENT[$cur]}
        [[ -z $p ]] && break
        cur=$p
    done

    local first=1
    for (( i = ${#chain[@]} - 1; i >= 0; i-- )); do
        c=${chain[i]}
        if (( first )); then
            path=${TITLE[$c]}
            first=0
        else
            path+=" > ${TITLE[$c]}"
        fi
    done

    printf '%s: %s\n' "$start" "$path"
}

mapfile -t ids < <(list_open_tasks 2>/dev/null | jq -r '.[]')

for id in "${ids[@]}"; do
    breadcrumb "$id"
done
```
