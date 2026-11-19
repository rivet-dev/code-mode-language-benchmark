import json


def run(text):
    orders = json.loads(text)
    by_region = {}
    by_customer = {}
    orders_with_more_than_3_items = 0
    for order in orders:
        items = order["items"]
        if len(items) > 3:
            orders_with_more_than_3_items += 1
        total = 0.0
        for item in items:
            total += item["qty"] * item["price"]
        region = order["region"]
        by_region[region] = by_region.get(region, 0.0) + total
        customer = order["customer"]
        by_customer[customer] = by_customer.get(customer, 0.0) + total
    ranked = sorted(by_customer.items(), key=lambda kv: (-kv[1], kv[0]))[:5]
    result = {
        "revenueByRegion": {region: round(total, 2) for region, total in by_region.items()},
        "topCustomers": [{"customer": c, "revenue": round(r, 2)} for c, r in ranked],
        "ordersWithMoreThan3Items": orders_with_more_than_3_items,
    }
    return json.dumps(result)
