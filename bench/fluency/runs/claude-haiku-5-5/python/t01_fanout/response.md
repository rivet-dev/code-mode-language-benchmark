```python
import tools


def main() -> None:
    totals: dict[str, int] = {}

    # Deduplicate warehouse IDs so a repeated ID doesn't double-count stock.
    for warehouse_id in dict.fromkeys(tools.list_warehouses()):
        for item in tools.get_inventory(warehouse_id):
            sku = item["sku"]
            totals[sku] = totals.get(sku, 0) + item["qty"]

    rows = [(sku, qty) for sku, qty in totals.items() if qty >= 50]
    rows.sort(key=lambda r: (-r[1], r[0]))

    for sku, qty in rows:
        print(f"{sku} {qty}")


if __name__ == "__main__":
    main()
```
