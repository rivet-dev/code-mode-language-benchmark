import tools


def main():
    resolved = 0
    unresolved = 0

    for user_id in tools.list_user_ids():
        try:
            profile = tools.get_profile(user_id)
        except tools.ToolError as err:
            if err.code != "NOT_FOUND":
                print(f"{user_id} | unresolved | {err.code}")
                unresolved += 1
                continue

            try:
                legacy = tools.get_legacy_profile(user_id)
            except tools.ToolError as legacy_err:
                print(f"{user_id} | unresolved | {legacy_err.code}")
                unresolved += 1
                continue

            display_name = f"{legacy['name']['first']} {legacy['name']['last']}"
            email = legacy["mail"] if legacy["mail"] is not None else "-"
            print(f"{user_id} | {display_name} | {email} | legacy")
            resolved += 1
            continue

        print(f"{user_id} | {profile['display_name']} | {profile['email']} | primary")
        resolved += 1

    print(f"resolved={resolved} unresolved={unresolved}")


if __name__ == "__main__":
    main()
