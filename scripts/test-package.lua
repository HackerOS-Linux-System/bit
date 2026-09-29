#!/usr/bin/env lua
-- scripts/test-package.lua
--
-- Used by .github/workflows/test-package.yml.
-- Health-checks libraries listed in index/repository.json with the freshly
-- built `bit` (BIT_BIN, default: `bit` on PATH). For every package:
--
--   1. clone it (at the index `rev`, if any) and verify the pinned checksum
--   2. manifest present (Bit.hk); no `extern dynamic` in H# sources
--   3. `bit check`                       type-check every module
--   4. `bit build`                       debug build
--   5. `bit test`                        only when Bit.hk defines [commands] -> test
--
--   lua scripts/test-package.lua                  # the whole index (unreachable repos are skipped)
--   lua scripts/test-package.lua --packages a,b   # exactly these (unreachable = failure)
--   lua scripts/test-package.lua --changed        # new/changed since BASE_SHA
--
-- Environment: BASE_SHA, PACKAGES (csv), BIT_BIN, INDEX_FILE, WORK_DIR,
-- STRICT=1 (skipped / legacy-manifest packages become failures).
--
-- Exit code: 0 = no failures, 1 = at least one package failed.

package.path = (arg[0]:match("^(.*)/[^/]*$") or ".") .. "/?.lua;" .. package.path
local C = require("common")

local opts = {
  base = os.getenv("BASE_SHA") or "",
  packages = C.split_csv(os.getenv("PACKAGES")),
  all = true,
  index = os.getenv("INDEX_FILE") or "index/repository.json",
  work = os.getenv("WORK_DIR") or ((os.getenv("RUNNER_TEMP") or "/tmp") .. "/bit-test-package"),
  strict = (os.getenv("STRICT") or "") == "1",
}

do
  local i = 1
  while i <= #arg do
    local a = arg[i]
    if a == "--all" then opts.all = true
    elseif a == "--changed" then opts.all = false
    elseif a == "--packages" then i = i + 1; opts.packages = C.split_csv(arg[i])
    elseif a == "--base" then i = i + 1; opts.base = arg[i] or ""
    elseif a == "--index" then i = i + 1; opts.index = arg[i]
    elseif a == "--work-dir" then i = i + 1; opts.work = arg[i]
    elseif a == "--strict" then opts.strict = true
    elseif a == "-h" or a == "--help" then
      print("usage: test-package.lua [--all | --changed | --packages a,b] [--base <git-ref>] [--index file] [--strict]")
      os.exit(0)
    else
      io.stderr:write("unknown option: " .. tostring(a) .. "\n")
      os.exit(2)
    end
    i = i + 1
  end
end
if #opts.packages > 0 then opts.all = false end

if not C.file_exists(opts.index) then
  C.error("index file not found: " .. opts.index)
  os.exit(2)
end

local head = C.read_index({ file = opts.index })
if #head == 0 then
  C.error(opts.index .. " has no libraries (or is not valid JSON)")
  os.exit(2)
end

local candidates, why = C.pick_candidates(opts, head)
print(("bit CI: testing %d package(s) (%s)"):format(#candidates, why))
if #candidates == 0 then
  C.summary("### test-package\nNothing to test.")
  os.exit(0)
end

local BIT = C.bit_bin()
-- an unreachable repository is only a hard failure when the package was asked for by name
local skip_unreachable = opts.all and not opts.strict

C.run("rm -rf " .. C.sq(opts.work))
C.run("mkdir -p " .. C.sq(opts.work))

-- Runs one bit sub-command inside the package; returns true on success.
local function bit_in(dir, env, args)
  return C.run("cd " .. C.sq(dir) .. " && " .. env .. C.sq(BIT) .. " " .. args)
end

local function has_test_command(dir, env)
  local out = C.capture("cd " .. C.sq(dir) .. " && " .. env .. C.sq(BIT) .. " commands")
  for line in (out .. "\n"):gmatch("([^\n]*)\n") do
    if line:match("^%s*test%s") or line:match("^%s*test$") then return true end
  end
  return false
end

-- returns status ("ok" | "warn" | "skip" | "fail"), detail, steps-string
local function test_one(e)
  if e.name:match("^[A-Za-z0-9][A-Za-z0-9._-]*$") == nil or #e.name > 64 then return "fail", "invalid name", "" end
  if not e.target:match("^https://") then return "fail", "target is not an https:// URL", "" end

  local dir = opts.work .. "/src/" .. e.name
  if not C.clone(e.target, e.rev, dir) then
    if skip_unreachable then return "skip", "repository not reachable: " .. e.target, "" end
    return "fail", "cannot clone " .. e.target, ""
  end

  local sum = C.dir_checksum(dir)
  if e.checksum ~= "" and e.checksum:gsub("^sha256:", "") ~= sum then
    return "fail", "checksum pinned in the index does not match the source", "clone"
  end

  local manifest, legacy = C.manifest_of(dir)
  if not manifest then return "fail", "no Bit.hk in the repository", "clone" end
  if legacy then
    local msg = manifest .. " is a legacy manifest — migrate to Bit.hk"
    if opts.strict then return "fail", msg, "clone" end
    return "warn", msg, "clone"
  end

  local offenders = C.capture("grep -rIl --include='*.h#' 'extern dynamic' " .. C.sq(dir) ..
                              " 2>/dev/null | grep -v '/.git/' | head -3")
  if offenders ~= "" then
    return "fail", "uses `extern dynamic` (bit links statically): " .. offenders:gsub("\n", ", "), "clone"
  end

  local env = C.bit_env(opts.work .. "/env/" .. e.name, opts.index)
  if not bit_in(dir, env, "check") then return "fail", "`bit check` failed", "clone" end
  if not bit_in(dir, env, "build") then return "fail", "`bit build` failed", "clone, check" end
  if has_test_command(dir, env) then
    if not bit_in(dir, env, "test") then return "fail", "`bit test` failed", "clone, check, build" end
    return "ok", "check, build and test passed", "clone, check, build, test"
  end
  return "ok", "check and build passed (no test command in Bit.hk)", "clone, check, build"
end

local rows, failed, warned, skipped = {}, 0, 0, 0
for _, e in ipairs(candidates) do
  C.group("test " .. e.name)
  local status, detail, steps = test_one(e)
  C.endgroup()

  local mark = ({ ok = "✅", warn = "⚠️", skip = "⏭️", fail = "❌" })[status]
  print(("%s  %-24s %s"):format(mark, e.name, detail))
  if status == "fail" then failed = failed + 1; C.error(e.name .. ": " .. detail)
  elseif status == "warn" then warned = warned + 1; C.warning(e.name .. ": " .. detail)
  elseif status == "skip" then skipped = skipped + 1 end
  rows[#rows + 1] = ("| %s | `%s` | %s | %s |"):format(mark, e.name, detail, steps)
end

C.summary("### test-package\n\n| | package | result | steps run |\n|---|---|---|---|\n" .. table.concat(rows, "\n") ..
          ("\n\n%d passed, %d warning(s), %d skipped, %d failed."):format(
            #candidates - failed - warned - skipped, warned, skipped, failed))

if failed > 0 then
  print(("\n%d package(s) failed"):format(failed))
  os.exit(1)
end
print("\nno failures")
