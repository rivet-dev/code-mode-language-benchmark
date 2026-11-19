# Sandbox side of the tool-call benchmark for bash: one call at a time over stdio.
# bash has no JSON parser, so it formats the call and matches the reply's id with a regex.
calls=$1 warmup=$2 batch=$3
total=$((warmup + calls))

for ((id = 0; id < total; id++)); do
	if ((id >= warmup && (id - warmup) % batch == 0)); then
		printf 'mark\n'
	fi
	printf '{"id":%d,"tool":"lookup","args":{"s":"hello from the sandbox"}}\n' "$id"
	IFS= read -r reply
	[[ $reply =~ \"id\":([0-9]+) ]] || exit 3
	((BASH_REMATCH[1] == id)) || exit 4
done

printf 'mark\ndone\n'
read -r _
