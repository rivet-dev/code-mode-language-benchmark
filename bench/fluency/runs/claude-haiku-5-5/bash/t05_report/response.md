```bash
#!/usr/bin/env bash
set -uo pipefail

# Formats an integer amount of cents as D.CC into REPLY.
fmt_cents() {
    local c=$1
    printf -v REPLY '%d.%02d' $((c / 100)) $((c % 100))
}

inv=$(get_invoice INV-2041) || exit 1
[[ -n $inv ]] || exit 1

id=$(jq -er '.id' <<<"$inv") || exit 1
customer=$(jq -er '.customer' <<<"$inv") || exit 1
tax_bp=$(jq -er '.tax_bp' <<<"$inv") || exit 1

# Emit each line as description, quantity, unit price, separated by the
# ASCII unit separator (0x1f), which is safe to hold in a bash variable.
lines=$(jq -j '.lines[] | (.description, "\u001f", (.quantity|tostring), "\u001f", (.unit_price_cents|tostring), "\u001f")' <<<"$inv") || exit 1

printf 'Invoice %s for %s\n' "$id" "$customer"

subtotal=0
while IFS= read -r -d $'\x1f' desc \
   && IFS= read -r -d $'\x1f' qty \
   && IFS= read -r -d $'\x1f' price; do
    amount=$(( qty * price ))
    subtotal=$(( subtotal + amount ))
    fmt_cents "$amount"
    printf '%-14s%3d %9s\n' "$desc" "$qty" "$REPLY"
done <<<"$lines"

# Tax in cents, rounded half up to the nearest cent.
tax=$(( (subtotal * tax_bp + 5000) / 10000 ))
total=$(( subtotal + tax ))

fmt_cents "$subtotal"
printf '%-18s%9s\n' 'Subtotal' "$REPLY"
fmt_cents "$tax"
printf '%-18s%9s\n' 'Tax' "$REPLY"
fmt_cents "$total"
printf '%-18s%9s\n' 'Total' "$REPLY"
```
