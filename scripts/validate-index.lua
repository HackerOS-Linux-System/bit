#!/usr/bin/env lua
-- scripts/validate-index.lua
--
-- Pin policy for index/repository.json (used by build-website.yml and test.yml):
--
--   * an entry that is NEW (not in the base revision) or whose `target` CHANGED
--     must carry a `rev` that is immutable: a version tag (v1.2.3 / 1.2) or a
--     full 40-character commit id. A branch name is not a pin.
--   * a tag `rev` must exist in the repository (git ls-remote), unless --offline.
--   * `checksum`, when present, must look like sha256:<64 hex> (or 64 hex).
--   * entries that were already in the index without a pin are grandfathered:
--     they only produce a warning (use --strict to make that an error).
--
--   lua scripts/validate-index.lua [--base <git-ref>] [--index file] [--strict] [--offline]
--
-- Environment: BASE_SHA, INDEX_FILE.   Exit code: 0 = ok, 1 = policy violated.

package.path = (arg[0]:match("^(.*)/[^/]*$") or ".") .. "/?.lua;" .. package.path
local C = require("common")

local opts = {
  base = os.getenv("BASE_SHA") or "",
  index = os.getenv("INDEX_FILE") or "index/repository.json",
  strict = false,
  offline = false,
}

do
  local i = 1
  while i <= #arg do
    local a = arg[i]
    if a == "--base" then i = i + 1; opts.base = arg[i] or ""
    elseif a == "--index" then i = i + 1; opts.index = arg[i]
    elseif a == "--strict" then opts.strict = true
    elseif a == "--offline" then opts.offline = true
    elseif a == "-h" or a == "--help" then
      print("usage: validate-index.lua [--base <git-ref>] [--index file] [--strict] [--offline]")
      os.exit(0)
    else
      io.stderr:write("unknown option: " .. tostring(a) .. "\n")
      os.exit(2)
    end
    i = i + 1
  end
end

if not C.file_exists(opts.index) then
  C.error("index file not found: " .. opts.index)
  os.exit(2)
end

local head = C.read_index({ file = opts.index })
if #head == 0 then
  C.error(opts.index .. " has no libraries (or is not valid JSON)")
  os.exit(2)
end

-- the base revision: entries there are "existing"
local base_cmd = C.index_at(opts.base)
if not base_cmd then base_cmd = C.index_at("HEAD~1") end
local before = base_cmd and C.index_by_name(C.read_index({ cmd = base_cmd })) or nil

local function is_tag(rev)
  return rev:match("^[vV]?%d+%.%d+[%w%.%-%+]*$") ~= nil
end

local function is_full_commit(rev)
  return rev:match("^%x+$") ~= nil and #rev == 40
end

local function tag_exists(url, tag)
  local out = C.capture("GIT_TERMINAL_PROMPT=0 git ls-remote --tags --refs " .. C.sq(url) ..
                        " " .. C.sq("refs/tags/" .. tag))
  return out ~= ""
end

local errors, warnings = 0, 0
local rows = {}

local function fail(name, msg)
  errors = errors + 1
  C.error("index: " .. name .. ": " .. msg)
  rows[#rows + 1] = ("| ❌ | `%s` | %s |"):format(name, msg)
end

local function warn(name, msg)
  warnings = warnings + 1
  C.warning("index: " .. name .. ": " .. msg)
  rows[#rows + 1] = ("| ⚠️ | `%s` | %s |"):format(name, msg)
end

for _, e in ipairs(head) do
  local old = before and before[e.name:lower()] or nil
  local enforced = (before ~= nil) and (old == nil or old.target ~= e.target)
  if before == nil then enforced = false end          -- nothing to compare with: legacy rules only

  if e.checksum ~= "" then
    local sum = e.checksum:gsub("^sha256:", "")
    if not (sum:match("^%x+$") and #sum == 64) then
      fail(e.name, "`checksum` must be sha256:<64 hex characters>")
    end
  end

  if e.rev == "" then
    if enforced then
      fail(e.name, (old == nil and "new entry" or "changed target") ..
           " needs a pinned `rev` (a version tag such as v1.0.0, or a full commit id)")
    elseif opts.strict then
      fail(e.name, "no pinned `rev` (--strict)")
    else
      warn(e.name, "no pinned `rev` (grandfathered — pin it when you next touch the entry)")
    end
  else
    if not (is_tag(e.rev) or is_full_commit(e.rev)) then
      local msg = "`rev` = '" .. e.rev .. "' is not a pin: use a version tag (v1.2.3) or a full 40-character commit id, not a branch"
      if enforced or opts.strict then fail(e.name, msg) else warn(e.name, msg) end
    elseif is_tag(e.rev) and not opts.offline and (enforced or opts.strict) then
      if not tag_exists(e.target, e.rev) then
        fail(e.name, "tag '" .. e.rev .. "' does not exist in " .. e.target)
      end
    end
  end
end

local checked = before and "new/changed entries must be pinned" or "no base revision — legacy rules only"
print(("index: %d entries, %d error(s), %d warning(s) (%s)"):format(#head, errors, warnings, checked))
if #rows > 0 then
  C.summary("### index pin policy\n\n| | entry | problem |\n|---|---|---|\n" .. table.concat(rows, "\n") ..
            ("\n\n%d error(s), %d warning(s)."):format(errors, warnings))
end
os.exit(errors > 0 and 1 or 0)
