local M = {}

-- ── shell ────────────────────────────────────────────────────────────────────

function M.sq(s)
  return "'" .. tostring(s):gsub("'", "'\\''") .. "'"
end

-- Runs a command; returns ok(boolean), exit code.
function M.run(cmd)
  local ok, _, code = os.execute(cmd)
  return ok == true, code or 1
end

-- stdout of a command (trimmed), plus success flag.
function M.capture(cmd)
  local p = io.popen(cmd .. " 2>/dev/null")
  if not p then return "", false end
  local out = p:read("*a") or ""
  local ok = p:close()
  return (out:gsub("^%s+", ""):gsub("%s+$", "")), ok == true
end

function M.lines(cmd)
  local out = {}
  local p = io.popen(cmd .. " 2>/dev/null")
  if not p then return out end
  for l in p:lines() do out[#out + 1] = l end
  p:close()
  return out
end

function M.file_exists(path)
  local f = io.open(path, "r")
  if f then f:close() return true end
  return false
end

function M.script_dir()
  local src = debug.getinfo(1, "S").source:gsub("^@", "")
  return src:match("^(.*)/[^/]*$") or "."
end

-- ── CI output ────────────────────────────────────────────────────────────────

function M.group(title) io.write("::group::" .. title .. "\n") end
function M.endgroup() io.write("::endgroup::\n") end
function M.error(msg) io.write("::error::" .. msg .. "\n") end
function M.warning(msg) io.write("::warning::" .. msg .. "\n") end

function M.summary(text)
  local path = os.getenv("GITHUB_STEP_SUMMARY")
  if not path or path == "" then return end
  local f = io.open(path, "a")
  if f then f:write(text, "\n") f:close() end
end

-- ── the library index (parsed with jq — Lua has no JSON in its stdlib) ───────

-- Returns { {name=, target=, lang=, rev=, checksum=, raw=<compact json>}, ... }
-- `source` is { file = path } or { cmd = "<shell producing the JSON>" }.
function M.read_index(source)
  local filter = [[jq -r '.libraries[] | [.name, .target, (.lang // ""), (.rev // ""), (.checksum // ""), tojson] | @tsv']]
  local cmd
  if source.file then
    cmd = filter .. " " .. M.sq(source.file)
  else
    cmd = source.cmd .. " | " .. filter
  end
  local list = {}
  for _, l in ipairs(M.lines(cmd)) do
    local name, target, lang, rev, checksum, raw = l:match("^([^\t]*)\t([^\t]*)\t([^\t]*)\t([^\t]*)\t([^\t]*)\t(.*)$")
    if name then
      list[#list + 1] = { name = name, target = target, lang = lang, rev = rev, checksum = checksum, raw = raw }
    end
  end
  return list
end

function M.index_by_name(list)
  local t = {}
  for _, e in ipairs(list) do t[e.name:lower()] = e end
  return t
end

-- ── fetching a package ───────────────────────────────────────────────────────

-- Clones `url` (optionally at `rev`, a branch/tag/commit) into `dest`.
function M.clone(url, rev, dest)
  M.run("rm -rf " .. M.sq(dest))
  local base = "git clone --quiet "
  if rev == "" then
    for _ = 1, 3 do
      if M.run(base .. "--depth=1 " .. M.sq(url) .. " " .. M.sq(dest)) then return true end
      M.run("sleep 3")
    end
    return false
  end
  if M.run(base .. "--depth=1 --branch " .. M.sq(rev) .. " " .. M.sq(url) .. " " .. M.sq(dest) .. " 2>/dev/null") then
    return true
  end
  M.run("rm -rf " .. M.sq(dest))
  return M.run(base .. M.sq(url) .. " " .. M.sq(dest)) and
         M.run("git -C " .. M.sq(dest) .. " checkout --quiet " .. M.sq(rev))
end

function M.commit_of(dir)
  return (M.capture("git -C " .. M.sq(dir) .. " rev-parse HEAD"))
end

-- Same algorithm as bit's src/checksum.h# (`dir_checksum`): sha256 over the
-- sorted per-file sha256 list, .git/ and .bit/ excluded.
function M.dir_checksum(dir)
  local cmd = "cd " .. M.sq(dir) .. " && find . -type f -not -path './.git/*' -not -path './.bit/*' -print0 " ..
              "| LC_ALL=C sort -z | xargs -0 sha256sum | sha256sum | cut -d' ' -f1"
  return (M.capture(cmd))
end

-- Which manifest does the package carry?  Returns name or nil.
function M.manifest_of(dir)
  for _, m in ipairs({ "Bit.hk", "bit.hk" }) do
    if M.file_exists(dir .. "/" .. m) then return m, false end
  end
  for _, m in ipairs({ "Bytes.hk", "bytes.hk", "Virus.hk" }) do
    if M.file_exists(dir .. "/" .. m) then return m, true end   -- legacy
  end
  return nil, false
end

-- Environment that keeps a bit run hermetic and pointed at *this* index.
function M.bit_env(workdir, index_file)
  return "BIT_HOME=" .. M.sq(workdir .. "/libs") .. " BIT_DIR=" .. M.sq(workdir .. "/state") ..
         " BIT_INDEX_FILE=" .. M.sq(index_file) .. " NO_COLOR=1 "
end

function M.bit_bin()
  local b = os.getenv("BIT_BIN")
  if b and b ~= "" then return b end
  return "bit"
end

-- ── base-vs-head comparison of the index ─────────────────────────────────────

function M.is_zero_sha(s)
  return s == nil or s == "" or s:match("^0+$") ~= nil
end

-- Reads index/repository.json as it was at `ref` ("" if unavailable).
function M.index_at(ref)
  if M.is_zero_sha(ref) then return nil end
  local cmd = "git show " .. M.sq(ref .. ":index/repository.json")
  local out, ok = M.capture(cmd)
  if not ok or out == "" then return nil end
  return cmd
end

function M.split_csv(s)
  local out = {}
  for part in (s or ""):gmatch("[^,%s]+") do out[#out + 1] = part end
  return out
end

-- Selects the entries a script should work on.
--   opts.packages  explicit names          opts.all   whole index
--   opts.base      git ref to diff against (falls back to HEAD~1, then the whole index)
--   opts.index     path of the index file  (already read into `head`)
-- Returns list, human readable reason.
function M.pick_candidates(opts, head)
  if #opts.packages > 0 then
    local by = M.index_by_name(head)
    local out = {}
    for _, n in ipairs(opts.packages) do
      local e = by[n:lower()]
      if e then out[#out + 1] = e
      else M.error("'" .. n .. "' is not in " .. opts.index); os.exit(2) end
    end
    return out, "requested packages"
  end
  if opts.all then return head, "whole index" end

  local base_ref = opts.base
  local base_cmd = M.index_at(base_ref)
  if not base_cmd then
    base_ref = "HEAD~1"
    base_cmd = M.index_at(base_ref)
  end
  if not base_cmd then return head, "no earlier revision to compare with - whole index" end

  local before = M.index_by_name(M.read_index({ cmd = base_cmd }))
  local out = {}
  for _, e in ipairs(head) do
    local old = before[e.name:lower()]
    if not old or old.raw ~= e.raw then out[#out + 1] = e end
  end
  return out, "new or changed since " .. base_ref
end

return M
