import tools


def main():
    cache = {}

    def fetch(task_id):
        if task_id not in cache:
            cache[task_id] = tools.get_task(task_id)
        return cache[task_id]

    lines = []
    for task_id in tools.list_open_tasks():
        titles = []
        seen = set()
        current = task_id
        while True:
            task = fetch(current)
            titles.append(task["title"])
            seen.add(current)
            parent_id = task["parent_id"]
            if parent_id is None or parent_id in seen:
                break
            current = parent_id
        lines.append(f"{task_id}: " + " > ".join(reversed(titles)))

    print("\n".join(lines))


if __name__ == "__main__":
    main()
