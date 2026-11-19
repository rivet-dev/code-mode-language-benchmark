# Sandbox side of the tool-call benchmark for dash (POSIX sh): one call at a time over stdio.
# It formats the call and cuts the reply's id out with parameter expansion.
calls=$1 warmup=$2 batch=$3
total=$((warmup + calls))
id=0

while [ "$id" -lt "$total" ]; do
	if [ "$id" -ge "$warmup" ] && [ $(((id - warmup) % batch)) -eq 0 ]; then
		printf 'mark\n'
	fi
	printf '{"id":%d,"tool":"lookup","args":{"s":"hello from the sandbox"}}\n' "$id"
	IFS= read -r reply
	got=${reply#*\"id\":}
	got=${got%%,*}
	[ "$got" -eq "$id" ] || exit 4
	id=$((id + 1))
done

printf 'mark\ndone\n'
read -r _
