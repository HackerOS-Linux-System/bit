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

-- Returns { {name=, target=, lang=, rev=, checksum=, dir=, kind=, raw=<compact json>}, ... }
-- `source` is { file = path } or { cmd = "<shell producing the JSON>" }.
function M.read_index(source)
  local filter = [[jq -r '.libraries[] | [.name, (.target // .url // .git // ""), (.lang // ""), (.rev // ""), (.checksum // ""), (.dir // .subdir // .directory // .file // .path // ""), (.type // .kind // ""), tojson] | @tsv']]
  local cmd
  if source.file then
    cmd = filter .. " " .. M.sq(source.file)
  else
    cmd = source.cmd .. " | " .. filter
  end
  local list = {}
  for _, l in ipairs(M.lines(cmd)) do
    local name, target, lang, rev, checksum, dir, kind, raw =
      l:match("^([^\t]*)\t([^\t]*)\t([^\t]*)\t([^\t]*)\t([^\t]*)\t([^\t]*)\t([^\t]*)\t(.*)$")
    if name then
      list[#list + 1] = { name = name, target = target, lang = lang, rev = rev, checksum = checksum,
                          dir = dir, kind = kind, raw = raw }
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

-- ── where a package comes from (mirror of bit's src/locator.h#) ──────────────
--
-- An entry's `target` is a git repository, ONE DIRECTORY of one (`.../tree/<ref>/<dir>`, `url#dir`,
-- the `dir` key), ONE FILE of one (`.../blob/<ref>/<file>`, the `file` key) or a file that is
-- downloaded as it is (raw.githubusercontent.com, any https url that ends in a source file,
-- `"type": "file"`). Returns { kind = "git" | "http", url =, rev =, dir = }.

local FILE_EXTS = { ".h#", ".hl", ".hcs", ".hlib", ".hk", ".h", ".c", ".rs", ".lua", ".sh", ".md", ".txt", ".json", ".toml" }

local function is_file_name(name)
  local low = name:lower()
  for _, ext in ipairs(FILE_EXTS) do
    if low:sub(-#ext) == ext then return true end
  end
  return false
end

local function segments(path)
  local out = {}
  for seg in path:gmatch("[^/]+") do out[#out + 1] = seg end
  return out
end

local function join(segs, from, stop)
  local out = {}
  for i = from, stop do out[#out + 1] = segs[i] end
  return table.concat(out, "/")
end

local function decode(s) return (s:gsub("%%23", "#"):gsub("%%20", " ")) end

-- a branch called main / master / HEAD in a url means "the default branch": no rev
local function branch_value(b)
  if b == "main" or b == "master" or b == "HEAD" then return "" end
  return b
end

local function forge_parse(base)
  local rest = base:gsub("^https?://", ""):gsub("%?.*$", "")
  local segs = segments(rest)
  local n = #segs
  if n < 5 then return nil end
  local host = segs[1]:lower()
  local function found(repo_end, branch_at, path_from)
    return { kind = "git", url = "https://" .. join(segs, 1, repo_end),
             rev = branch_value(decode(segs[branch_at])), dir = decode(join(segs, path_from, n)) }
  end
  -- GitLab: group/sub/repo/-/tree|blob|raw/<ref>/<path>
  for i = 3, n - 2 do
    if segs[i] == "-" and (segs[i + 1] == "tree" or segs[i + 1] == "blob" or segs[i + 1] == "raw") then
      return found(i - 1, i + 2, i + 3)
    end
  end
  for j = 4, n - 1 do
    local s = segs[j]
    local nx = segs[j + 1]
    -- Codeberg / Gitea / Forgejo: src|raw/branch|tag|commit/<ref>/<path>
    if (s == "src" or s == "raw") and j + 2 <= n and (nx == "branch" or nx == "tag" or nx == "commit") then
      return found(j - 1, j + 2, j + 3)
    end
    -- GitHub (and Gitea): tree|blob|raw/<ref>/<path>
    if s == "tree" or s == "blob" or s == "raw" then return found(j - 1, j + 1, j + 2) end
    -- Bitbucket: src/<ref>/<path>
    if s == "src" and host:find("bitbucket", 1, true) then return found(j - 1, j + 1, j + 2) end
  end
  return nil
end

function M.resolve_target(e)
  local t = decode(e.target or "")
  local base, frag = t, ""
  local h = t:find("#", 1, true)
  if h then
    base, frag = t:sub(1, h - 1), t:sub(h + 1)
    if frag == "" and base:sub(-2) == ".h" then base = base .. "#" end   -- `lib.h#` is a file name
  end
  local rest = base:gsub("^https?://", ""):gsub("%?.*$", "")
  local host = (rest:match("^[^/]+") or ""):lower()
  local last = rest:match("([^/]+)/*$") or ""

  local r
  if host == "raw.githubusercontent.com" or host == "gist.githubusercontent.com" then
    r = { kind = "http", url = base, rev = "", dir = "" }
  else
    r = forge_parse(base)
    if r then
      if r.dir == "" then r.dir = frag end
    elseif base:match("^https?://") and is_file_name(last) then
      r = { kind = "http", url = base, rev = "", dir = "" }
    else
      r = { kind = "git", url = base, rev = "", dir = frag }
    end
  end

  -- the explicit keys of the entry win over what the url says
  if e.kind == "file" or e.kind == "http" or e.kind == "url" or e.kind == "download" then
    r = { kind = "http", url = r.url, rev = "", dir = "" }
  end
  if r.kind == "git" and e.dir and e.dir ~= "" then r.dir = e.dir end
  if e.rev and e.rev ~= "" then r.rev = e.rev end
  if r.kind ~= "git" then r.dir = "" end
  return r
end

-- Clones only `sub` (a directory or a file) of a repository: sparse + blob-less, so a monorepo is
-- not fetched whole. Falls back to the ordinary clone (same result, the caller picks `sub` out).
function M.clone_sub(url, rev, dest, sub)
  M.run("rm -rf " .. M.sq(dest))
  local br = (rev ~= "") and ("--branch " .. M.sq(rev) .. " ") or ""
  local cmd = "( git clone --quiet --depth=1 --filter=blob:none --sparse " .. br .. M.sq(url) .. " " .. M.sq(dest) ..
              " && git -C " .. M.sq(dest) .. " sparse-checkout set --no-cone " .. M.sq("/" .. sub) .. " ) 2>/dev/null"
  if M.run(cmd) then return true end
  return M.clone(url, rev, dest)
end

local function lang_of_file(fname)
  local low = fname:lower()
  if low:sub(-3) == ".h#" then return "h#" end
  if low:sub(-3) == ".hl" then return "hl" end
  if low:sub(-4) == ".hcs" then return "hs" end
  return nil
end

-- A lone file becomes a tiny library (same as bit): a directory with the file and, for H# / Hacker
-- Lang / HackerScript sources, a generated Bit.hk naming it as the library entry.
local function wrap_file(path, name, out)
  local fname = path:match("([^/]+)$")
  M.run("rm -rf " .. M.sq(out) .. " && mkdir -p " .. M.sq(out))
  if not M.run("cp -f " .. M.sq(path) .. " " .. M.sq(out .. "/" .. fname)) then return false end
  local lang = lang_of_file(fname)
  if lang then
    local f = io.open(out .. "/Bit.hk", "w")
    if not f then return false end
    f:write("[package]\n-> name => " .. name .. "\n-> version => 0.0.0\n-> lang => " .. lang ..
            "\n\n[layout]\n-> lib-entry => " .. fname .. "\n")
    f:close()
  end
  return true
end

-- Fetches an index entry into `dest` the way `bit install` does: the whole repository, ONE DIRECTORY
-- of it, ONE FILE of it, or a downloaded file. Returns ok, commit-or-content-id, error message.
function M.fetch(e, dest)
  local r = M.resolve_target(e)
  local stage = dest .. ".stage"
  M.run("rm -rf " .. M.sq(dest) .. " " .. M.sq(stage))

  if r.kind == "http" then
    M.run("mkdir -p " .. M.sq(stage))
    local fname = decode(r.url:gsub("%?.*$", ""):match("([^/]+)$") or "")
    if fname == "" then return false, "", "the url names no file: " .. r.url end
    local url = r.url:gsub("#", "%%23")
    if not M.run("curl -fsSL --retry 3 --connect-timeout 15 " .. M.sq(url) .. " -o " .. M.sq(stage .. "/" .. fname)) then
      return false, "", "cannot download " .. r.url
    end
    local id = M.dir_checksum(stage):sub(1, 40)
    if not wrap_file(stage .. "/" .. fname, e.name, dest) then return false, "", "cannot prepare " .. fname end
    M.run("rm -rf " .. M.sq(stage))
    return true, id, ""
  end

  if r.dir == "" then
    if not M.clone(r.url, r.rev, dest) then
      return false, "", "cannot clone " .. r.url .. (r.rev ~= "" and (" @ " .. r.rev) or "")
    end
    return true, M.commit_of(dest), ""
  end

  if not M.clone_sub(r.url, r.rev, stage, r.dir) then
    return false, "", "cannot clone " .. r.url .. (r.rev ~= "" and (" @ " .. r.rev) or "")
  end
  local commit = M.commit_of(stage)
  local held = stage .. "/" .. r.dir
  local ok
  if M.capture("test -d " .. M.sq(held) .. " && echo dir") == "dir" then
    ok = M.run("mv " .. M.sq(held) .. " " .. M.sq(dest))
  elseif M.capture("test -f " .. M.sq(held) .. " && echo file") == "file" then
    ok = wrap_file(held, e.name, dest)
  else
    M.run("rm -rf " .. M.sq(stage))
    return false, commit, "the repository has no directory or file '" .. r.dir .. "'"
  end
  M.run("rm -rf " .. M.sq(stage))
  if not ok then return false, commit, "cannot place " .. r.dir end
  return true, commit, ""
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
