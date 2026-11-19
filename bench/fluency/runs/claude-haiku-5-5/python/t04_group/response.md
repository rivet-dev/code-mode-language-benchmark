```python
import sys
from datetime import date

import tools

CUTOFF = date(2021, 1, 1)


def main() -> int:
    try:
        employees = tools.list_employees()
    except tools.ToolError as e:
        print(f"tool error {e.code}: {e.message}", file=sys.stderr)
        return 1

    groups: dict[str, list[dict]] = {}
    for emp in employees:
        if emp["active"] is not True:
            continue
        if date.fromisoformat(emp["hired"]) < CUTOFF:
            continue
        groups.setdefault(emp["dept"], []).append(emp)

    rows = []
    for dept, members in groups.items():
        count = len(members)
        avg = sum(m["salary"] for m in members) // count
        names = sorted(m["name"] for m in members)
        rows.append((dept, count, avg, names))

    rows.sort(key=lambda r: (-r[1], r[0]))

    lines = [
        f"{dept} count={count} avg_salary={avg} names={','.join(names)}"
        for dept, count, avg, names in rows
    ]
    if lines:
        print("\n".join(lines))
    return 0


if __name__ == "__main__":
    sys.exit(main())
```
