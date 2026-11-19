const inv = await tools.get_invoice("INV-2041");

// Format integer cents as dollars with exactly 2 decimals.
const fmt = (cents) => {
  const neg = cents < 0;
  const a = Math.abs(cents);
  const s = `${Math.floor(a / 100)}.${String(a % 100).padStart(2, "0")}`;
  return neg ? `-${s}` : s;
};

const out = [`Invoice ${inv.id} for ${inv.customer}`];

let subtotal = 0;
for (const line of inv.lines) {
  const total = line.quantity * line.unit_price_cents;
  subtotal += total;
  out.push(
    `${line.description.padEnd(14)}${String(line.quantity).padStart(3)} ${fmt(total).padStart(9)}`
  );
}

// Round half up to the nearest cent using integer arithmetic.
const tax = Math.floor((subtotal * inv.tax_bp + 5000) / 10000);
const total = subtotal + tax;

const summary = (label, cents) => `${label.padEnd(18)}${fmt(cents).padStart(9)}`;
out.push(summary("Subtotal", subtotal));
out.push(summary("Tax", tax));
out.push(summary("Total", total));

console.log(out.join("\n"));
