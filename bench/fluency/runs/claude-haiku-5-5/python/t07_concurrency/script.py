import concurrent.futures

import tools


def check(host):
    try:
        result = tools.probe(host)
        return host, result, None
    except tools.ToolError as e:
        return host, None, e.code


def main():
    hosts = list(tools.list_hosts())

    # At most 3 probe calls are in flight at any moment.
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as executor:
        results = list(executor.map(check, hosts))

    bad_lines = []
    healthy = 0
    max_latency = 0

    for host, result, error_code in results:
        if error_code is not None:
            bad_lines.append((host, str(error_code)))
            continue

        status = result["status"]
        if status == 200:
            healthy += 1
            max_latency = max(max_latency, result["latency_ms"])
        else:
            bad_lines.append((host, str(status)))

    for host, status in sorted(bad_lines, key=lambda item: item[0]):
        print(f"{host} {status}")

    print(f"healthy={healthy} max_latency={max_latency}")


if __name__ == "__main__":
    main()
