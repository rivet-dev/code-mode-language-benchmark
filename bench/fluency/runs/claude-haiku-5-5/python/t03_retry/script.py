import tools

METRICS = ["cpu", "mem", "disk", "net", "gpu"]
MAX_ATTEMPTS = 4

lines = []
total = 0

for name in METRICS:
    attempts = 0
    while True:
        attempts += 1
        try:
            result = tools.fetch_metric(name)
            value = result["value"]
            lines.append(f"{name} ok {value} attempts={attempts}")
            total += value
            break
        except tools.ToolError as err:
            code = getattr(err, "code", "")
            if code == "UNAVAILABLE" and attempts < MAX_ATTEMPTS:
                continue
            lines.append(f"{name} failed {code} attempts={attempts}")
            break

lines.append(f"total={total}")
print("\n".join(lines))
