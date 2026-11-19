```python
import sys

import tools


def main() -> None:
    rates = tools.get_rates()["rates"]
    expenses = tools.list_expenses()

    def to_eur(expense) -> float:
        amount = float(expense["amount"])
        currency = expense["currency"]
        if currency == "EUR":
            return amount
        return amount / float(rates[currency])

    totals: dict[str, float] = {}
    total = 0.0
    best_id = None
    best_amount = None

    for expense in expenses:
        eur = to_eur(expense)
        category = expense["category"]
        totals[category] = totals.get(category, 0.0) + eur
        total += eur
        if best_amount is None or eur > best_amount:
            best_amount = eur
            best_id = expense["id"]

    for category in sorted(totals):
        print(f"{category} {totals[category]:.2f}")

    print(f"TOTAL {total:.2f}")
    if best_id is not None:
        print(f"MAX {best_id} {best_amount:.2f}")


if __name__ == "__main__":
    try:
        main()
    except tools.ToolError as err:
        print(f"error: {err.code}: {err.message}", file=sys.stderr)
        sys.exit(1)
```
