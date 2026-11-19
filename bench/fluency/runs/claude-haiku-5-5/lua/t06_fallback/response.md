```lua
local function error_code(e)
  if type(e) == "table" and e.code ~= nil then
    return tostring(e.code)
  end
  return tostring(e)
end

local resolved = 0
local unresolved = 0

local ids = tools.list_user_ids()

for _, id in ipairs(ids) do
  local sid = tostring(id)
  local ok, profile = pcall(tools.get_profile, id)

  if ok then
    print(sid .. " | " .. tostring(profile.display_name) .. " | " .. tostring(profile.email) .. " | primary")
    resolved = resolved + 1
  else
    local code = error_code(profile)

    if code == "NOT_FOUND" then
      local ok2, legacy = pcall(tools.get_legacy_profile, id)

      if ok2 then
        local display = tostring(legacy.name.first) .. " " .. tostring(legacy.name.last)
        local email = legacy.mail
        if email == nil then
          email = "-"
        end
        print(sid .. " | " .. display .. " | " .. tostring(email) .. " | legacy")
        resolved = resolved + 1
      else
        print(sid .. " | unresolved | " .. error_code(legacy))
        unresolved = unresolved + 1
      end
    else
      print(sid .. " | unresolved | " .. code)
      unresolved = unresolved + 1
    end
  end
end

print("resolved=" .. resolved .. " unresolved=" .. unresolved)
```
