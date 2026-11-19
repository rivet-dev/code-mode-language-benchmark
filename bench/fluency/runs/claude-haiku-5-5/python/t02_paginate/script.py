import tools


def main() -> None:
    total = 0
    delete_counts: dict[str, int] = {}
    cursor = None
    seen_cursors = set()

    while True:
        page = tools.list_events(cursor)
        events = page["events"]
        total += len(events)

        for event in events:
            if event["action"] == "delete":
                user = event["user"]
                delete_counts[user] = delete_counts.get(user, 0) + 1

        cursor = page["next_cursor"]
        if cursor is None:
            break
        if cursor in seen_cursors:
            # Guard against a cursor cycle that would never terminate.
            break
        seen_cursors.add(cursor)

    lines = [str(total)]
    for user, count in sorted(delete_counts.items(), key=lambda item: (-item[1], item[0])):
        lines.append(f"{user} {count}")

    print("\n".join(lines))


if __name__ == "__main__":
    main()
