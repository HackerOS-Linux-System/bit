#!/usr/bin/env lua
-- scripts/build-new-package.lua
--
-- Used by .github/workflows/build-new-package.yml.
-- Finds the library entries that a push / pull request added or changed in
-- index/repository.json, fetches each one and builds it with the freshly
-- built `bit` (BIT_BIN, default: `bit` on PATH), the same way a user would.
--
--   lua scripts/build-new-package.lua                    # entries new/changed since BASE_SHA
--   lua scripts/build-new-package.lua --packages a,b     # exactly these names
--   lua scripts/build-new-package.lua --all              # every entry of the index
--
-- Environment: BASE_SHA (git ref to compare with), PACKAGES (csv), BIT_BIN,
-- INDEX_FILE (default index/repository.json), WORK_DIR, STRICT=1 (legacy
-- manifests such as Bytes.hk become failures instead of warnings).
--
-- Exit code: 0 = everything built, 1 = at least one package failed.

package.path = (arg[0]:match("^(.*)/[^/]*$") or ".") .. "/?.lua;" .. package.path
local C = require("common")

-- ── options ──────────────────────────────────────────────────────────────────

local opts = {
  base = os.getenv("BASE_SHA") or "",
  packages = C.split_csv(os.getenv("PACKAGES")),
  all = false,
  index = os.getenv("INDEX_FILE") or "index/repository.json",
  work = os.getenv("WORK_DIR") or ((os.getenv("RUNNER_TEMP") or "/tmp") .. "/bit-build-new-package"),
  strict = (os.getenv("STRICT") or "") == "1",
}

do
  local i = 1
  while i <= #arg do
    local a = arg[i]
    if a == "--all" then opts.all = true
    elseif a == "--packages" then i = i + 1; opts.packages = C.split_csv(arg[i])
    elseif a == "--base" then i = i + 1; opts.base = arg[i] or ""
    elseif a == "--index" then i = i + 1; opts.index = arg[i]
    elseif a == "--work-dir" then i = i + 1; opts.work = arg[i]
    elseif a == "--strict" then opts.strict = true
    elseif a == "-h" or a == "--help" then
      print("usage: build-new-package.lua [--all | --packages a,b | --base <git-ref>] [--index file] [--strict]")
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

-- ── which entries to build ───────────────────────────────────────────────────

local head = C.read_index({ file = opts.index })
if #head == 0 then
  C.error(opts.index .. " has no libraries (or is not valid JSON)")
  os.exit(2)
end

local candidates, why = C.pick_candidates(opts, head)
print(("bit CI: %d package(s) to build (%s)"):format(#candidates, why))
if #candidates == 0 then
  C.summary("### build-new-package\nNo library entry was added or changed — nothing to build.")
  os.exit(0)
end

-- ── build one package ────────────────────────────────────────────────────────

local BIT = C.bit_bin()
C.run("rm -rf " .. C.sq(opts.work))
C.run("mkdir -p " .. C.sq(opts.work))

local function name_ok(n) return n:match("^[A-Za-z0-9][A-Za-z0-9._-]*$") ~= nil and #n <= 64 end

-- returns status ("ok" | "warn" | "fail"), detail, commit, checksum
local function build_one(e)
  if not name_ok(e.name) then return "fail", "invalid name" end
  if not e.target:match("^https://") then return "fail", "target is not an https:// URL" end

  local dir = opts.work .. "/src/" .. e.name
  local state = opts.work .. "/state/" .. e.name
  C.run("mkdir -p " .. C.sq(state))

  if not C.clone(e.target, e.rev, dir) then
    return "fail", "cannot clone " .. e.target .. (e.rev ~= "" and (" @ " .. e.rev) or "")
  end
  local commit = C.commit_of(dir)
  local sum = C.dir_checksum(dir)

  if e.checksum ~= "" and e.checksum:gsub("^sha256:", "") ~= sum then
    return "fail", "checksum pinned in the index does not match the fetched source", commit, sum
  end

  local manifest, legacy = C.manifest_of(dir)
  if not manifest then
    return "fail", "no Bit.hk in the repository (bit needs a manifest)", commit, sum
  end
  if legacy then
    local msg = manifest .. " is a legacy manifest — add a Bit.hk (bit builds Bit.hk projects)"
    if opts.strict then return "fail", msg, commit, sum end
    return "warn", msg, commit, sum
  end

  -- static-linking rule of bit: `extern dynamic` is not allowed in H# sources
  local offenders = C.capture("grep -rIl --include='*.h#' 'extern dynamic' " .. C.sq(dir) ..
                              " 2>/dev/null | grep -v '/.git/' | head -3")
  if offenders ~= "" then
    return "fail", "uses `extern dynamic` (bit links statically): " .. offenders:gsub("\n", ", "), commit, sum
  end

  local env = C.bit_env(opts.work .. "/env/" .. e.name, opts.index)
  local cmd = "cd " .. C.sq(dir) .. " && " .. env .. C.sq(BIT) .. " build --release"
  local ok = C.run(cmd)
  if not ok then return "fail", "`bit build --release` failed", commit, sum end

  local produced = C.capture("find " .. C.sq(dir .. "/cache/build/release") ..
                             " -maxdepth 1 -type f 2>/dev/null | head -1")
  if produced == "" then return "fail", "build succeeded but cache/build/release is empty", commit, sum end
  return "ok", "built", commit, sum
end

local rows, failed, warned = {}, 0, 0
for _, e in ipairs(candidates) do
  C.group("build " .. e.name)
  local status, detail, commit, sum = build_one(e)
  C.endgroup()

  local mark = status == "ok" and "✅" or (status == "warn" and "⚠️" or "❌")
  print(("%s  %-24s %s"):format(mark, e.name, detail))
  if status == "fail" then failed = failed + 1; C.error(e.name .. ": " .. detail)
  elseif status == "warn" then warned = warned + 1; C.warning(e.name .. ": " .. detail) end

  rows[#rows + 1] = ("| %s | `%s` | %s | `%s` | `%s` |"):format(
    mark, e.name, detail,
    (commit or ""):sub(1, 12), sum and sum ~= "" and ("sha256:" .. sum:sub(1, 16) .. "…") or "")
end

C.summary("### build-new-package\n\n| | package | result | commit | checksum |\n|---|---|---|---|---|\n" ..
          table.concat(rows, "\n") ..
          ("\n\n%d built, %d warning(s), %d failed."):format(#candidates - failed - warned, warned, failed))

if failed > 0 then
  print(("\n%d package(s) failed"):format(failed))
  os.exit(1)
end
print("\nall packages OK")
