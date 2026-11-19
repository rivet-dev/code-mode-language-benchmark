import tools


def money(cents):
    sign = "-" if cents < 0 else ""
    cents = abs(cents)
    return f"{sign}{cents // 100}.{cents % 100:02d}"


def main():
    inv = tools.get_invoice("INV-2041")

    out = [f"Invoice {inv['id']} for {inv['customer']}"]

    subtotal = 0
    for line in inv["lines"]:
        line_total = line["quantity"] * line["unit_price_cents"]
        subtotal += line_total
        out.append(
            f"{line['description']:<14}{line['quantity']:>3} {money(line_total):>9}"
        )

    # Round half up to the nearest cent using integer arithmetic.
    tax = (subtotal * inv["tax_bp"] + 5000) // 10000
    total = subtotal + tax

    out.append(f"{'Subtotal':<18}{money(subtotal):>9}")
    out.append(f"{'Tax':<18}{money(tax):>9}")
    out.append(f"{'Total':<18}{money(total):>9}")

    print("\n".join(out))


if __name__ == "__main__":
    main()
