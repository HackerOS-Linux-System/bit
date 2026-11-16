#!/usr/bin/env lua
-- scripts/build-desktop-app.lua
--
-- Used by .github/workflows/build-desktop-app.yml and by the [commands] of app/desktop/Bit.hk.
--
-- Builds the bit.io desktop app for HackerOS (and any Linux with Wayland or X11):
--   app/desktop   H# (src/*.h#) + the `gui` library (HackerScript) through hlib, one Bit.hk
--
--   lua scripts/build-desktop-app.lua check             layout + rule checks (no toolchain needed)
--   lua scripts/build-desktop-app.lua sync              copy index/repository.json and images/icon.png into app/desktop/data
--   lua scripts/build-desktop-app.lua version           print the version that would be built
--   lua scripts/build-desktop-app.lua build             sync + `bit build --release` in app/desktop
--   lua scripts/build-desktop-app.lua package           build + tar.gz and .deb in dist/desktop
--   lua scripts/build-desktop-app.lua smoke             start the built app headless for a few seconds
--   lua scripts/build-desktop-app.lua install           install the release build into --prefix
--   lua scripts/build-desktop-app.lua uninstall         remove it again
--
-- Options:
--   --out DIR        where the artifacts go            (default: dist/desktop)
--   --prefix DIR     install / uninstall prefix        (default: /usr/local)
--   --skip-build     package / install: use the binary that is already in app/desktop/cache/build/release
--   --no-sync        skip copying the index snapshot and the icon
--   --quiet          print nothing but errors (used by hooks)
--
-- Environment:
--   BIT_VERSION_NAME   override the version (default: [package] version of app/desktop/Bit.hk)
--   BIT_BIN            the `bit` executable to use (default: bit on PATH)
--
-- The program calls the gui library ONLY through hlib (`use "hlib -> gui"`): `check` fails when a
-- source file declares an `extern` or when a HackerScript adapter appears in app/desktop.
--
-- Exit code: 0 = success, 1 = a step failed, 2 = bad usage.

package.path = (arg[0]:match("^(.*)/[^/]*$") or ".") .. "/?.lua;" .. package.path
local C = require("common")

-- ── paths ────────────────────────────────────────────────────────────────────

local ROOT = (arg[0]:match("^(.*)/[^/]*$") or ".") .. "/.."
local function path(...) return ROOT .. "/" .. table.concat({ ... }, "/") end

local P = {
  index   = path("index", "repository.json"),
  icon    = path("images", "icon.png"),
  license = path("LICENSE"),
  app     = path("app", "desktop"),
}
P.bit_hk  = P.app .. "/Bit.hk"
P.src     = P.app .. "/src"
P.data    = P.app .. "/data"
P.pack    = P.app .. "/packaging"
P.binary  = P.app .. "/cache/build/release/bit-io-desktop"

local APP_NAME = "bit-io-desktop"

-- ── options ──────────────────────────────────────────────────────────────────

local opts = {
  command = nil,
  out = os.getenv("DESKTOP_OUT_DIR") or "dist/desktop",
  prefix = "/usr/local",
  skip_build = false,
  sync = true,
  quiet = false,
}

do
  local i = 1
  while i <= #arg do
    local a = arg[i]
    if a == "--out" then i = i + 1; opts.out = arg[i] or opts.out
    elseif a == "--prefix" then i = i + 1; opts.prefix = arg[i] or opts.prefix
    elseif a == "--skip-build" then opts.skip_build = true
    elseif a == "--no-sync" then opts.sync = false
    elseif a == "--quiet" then opts.quiet = true
    elseif a == "-h" or a == "--help" then opts.command = "help"
    elseif not opts.command and not a:match("^%-") then opts.command = a
    else
      io.stderr:write("unknown option: " .. tostring(a) .. "\n")
      os.exit(2)
    end
    i = i + 1
  end
end

-- ── helpers ──────────────────────────────────────────────────────────────────

local sq = C.sq

local function say(s)
  if not opts.quiet then io.write(s) end
end

local function fail(msg)
  C.error(msg)
  io.stderr:write("error: " .. msg .. "\n")
  os.exit(1)
end

-- Runs a command; a failure ends the script.
local function must(cmd, what)
  say("$ " .. cmd .. "\n")
  io.flush()
  local ok, code = C.run(cmd)
  if not ok then fail((what or cmd) .. " failed (exit " .. tostring(code) .. ")") end
end

local function have(tool)
  local _, ok = C.capture("command -v " .. sq(tool))
  return ok
end

local function read_file(p)
  local f = io.open(p, "rb")
  if not f then return nil end
  local s = f:read("*a")
  f:close()
  return s
end

local function write_file(p, content)
  local f = assert(io.open(p, "wb"))
  f:write(content)
  f:close()
end

local function env(name)
  local v = os.getenv(name)
  if v == nil or v == "" then return nil end
  return v
end

local function abs(p)
  if p:sub(1, 1) == "/" then return p end
  return C.capture("pwd") .. "/" .. p
end

local function out_dir()
  local d = abs(opts.out)
  must("mkdir -p " .. sq(d))
  return d
end

local function sha256_of(file)
  if have("sha256sum") then
    return (C.capture("sha256sum " .. sq(file) .. " | cut -d' ' -f1"))
  end
  return (C.capture("shasum -a 256 " .. sq(file) .. " | cut -d' ' -f1"))
end

local function checksum_file(file)
  local sum = sha256_of(file)
  local name = file:match("([^/]+)$")
  write_file(file .. ".sha256", sum .. "  " .. name .. "\n")
  say(string.format("  %s  %s\n", sum, name))
  return sum
end

local function size_of(file)
  local f = io.open(file, "rb")
  if not f then return 0 end
  local n = f:seek("end")
  f:close()
  return n
end

local function arch()
  local m = C.capture("uname -m")
  if m == "x86_64" or m == "amd64" then return "x86_64", "amd64" end
  if m == "aarch64" or m == "arm64" then return "aarch64", "arm64" end
  if m == "riscv64" then return "riscv64", "riscv64" end
  return m, m
end

local function expand_home(p)
  if p:sub(1, 1) == "~" then return (os.getenv("HOME") or "") .. p:sub(2) end
  return p
end

-- ── version ──────────────────────────────────────────────────────────────────

-- `[package] <key> => value` of app/desktop/Bit.hk
local function manifest_value(key)
  local text = read_file(P.bit_hk) or ""
  local in_package = false
  for line in (text:gsub("\r", "") .. "\n"):gmatch("(.-)\n") do
    local l = line:gsub("^%s+", ""):gsub("%s+$", "")
    local sec = l:match("^%[(.+)%]$")
    if sec then
      in_package = (sec:lower() == "package")
    elseif in_package then
      local v = l:match("^%-%>%s*" .. key .. "%s*=>%s*(.-)%s*$")
      if v then return v end
    end
  end
  return nil
end

local function version()
  local name = env("BIT_VERSION_NAME") or manifest_value("version") or "0.1.0"
  return { name = name }
end

-- ── sync: index snapshot + icon (generated at build time, never committed) ────
--
-- Single sources of truth, shared with the phone apps:
--   index/repository.json   -> offline snapshot shipped inside the app
--   images/icon.png         -> launcher icon
-- app/desktop/.gitignore lists the copies.

local function cmd_sync()
  if not C.file_exists(P.index) then fail("missing " .. P.index) end
  if not C.file_exists(P.icon) then fail("missing " .. P.icon) end
  C.group("Copy the index snapshot and the icon into app/desktop/data")
  if have("jq") then
    local ok = C.run("jq -e '.libraries | type == \"array\" and length > 0' " .. sq(P.index) .. " >/dev/null 2>&1")
    if not ok then C.warning("index/repository.json is not strict JSON - the app still parses it, but fix the file") end
  end
  must("mkdir -p " .. sq(P.data))
  must("cp " .. sq(P.index) .. " " .. sq(P.data .. "/repository.json"))
  must("cp " .. sq(P.icon) .. " " .. sq(P.data .. "/icon.png"))
  C.endgroup()
end

local function maybe_sync()
  if opts.sync then cmd_sync() end
end

-- ── check ────────────────────────────────────────────────────────────────────

local REQUIRED = {
  "app/desktop/Bit.hk",
  "app/desktop/.gitignore",
  "app/desktop/README.md",
  "app/desktop/src/main.h#",
  "app/desktop/src/util.h#",
  "app/desktop/src/jsonx.h#",
  "app/desktop/src/hk.h#",
  "app/desktop/src/model.h#",
  "app/desktop/src/store.h#",
  "app/desktop/src/markdown.h#",
  "app/desktop/src/highlight.h#",
  "app/desktop/src/langs.h#",
  "app/desktop/src/apidoc.h#",
  "app/desktop/src/diff.h#",
  "app/desktop/src/state.h#",
  "app/desktop/src/load.h#",
  "app/desktop/src/ui.h#",
  "app/desktop/src/screens.h#",
  "app/desktop/data/docs.md",
  "app/desktop/packaging/bit-io-desktop.desktop",
  "app/desktop/packaging/bit-io-desktop.sh",
  -- shared inputs (copied into the app at build time - the app keeps no icon / index of its own)
  "index/repository.json",
  "images/icon.png",
}

local function cmd_check()
  local problems = 0
  local function bad(msg) C.error(msg); problems = problems + 1 end

  C.group("Desktop app layout")
  for _, rel in ipairs(REQUIRED) do
    if C.file_exists(path(rel)) then
      say("  ok       " .. rel .. "\n")
    else
      bad("missing " .. rel)
    end
  end
  C.endgroup()

  C.group("Rules")
  -- 1. One Bit.hk: H#, depends on gui.
  local hk = read_file(P.bit_hk) or ""
  local before = problems
  if not hk:match("%->%s*lang%s*=>%s*h#") then bad("app/desktop/Bit.hk: [package] lang must be h#") end
  if not hk:match("%[dependencies%][^%[]*%->%s*gui%s*=>") then bad("app/desktop/Bit.hk: [dependencies] must list gui") end
  if problems == before then say("  ok       Bit.hk: H# program, depends on gui\n") end

  -- 2. gui only through hlib: no extern, no HackerScript adapters, `use "hlib -> gui"` in every file that calls it.
  local n = 0
  for _, l in ipairs(C.lines("grep -rnE '^[[:space:]]*extern[[:space:]]' " .. sq(P.src) .. " --include='*.h#'")) do
    if l ~= "" then bad("extern declaration (use hlib instead): " .. l); n = n + 1 end
  end
  for _, l in ipairs(C.lines("find " .. sq(P.app) .. " -name '*.hcs' -o -name '*.hl' 2>/dev/null")) do
    if l ~= "" then bad("adapter file in the desktop app (the gui API is used directly): " .. l); n = n + 1 end
  end
  local declared = {}
  for _, f in ipairs(C.lines("grep -rlE '^use \"hlib -> gui\"' " .. sq(P.src) .. " --include='*.h#'")) do declared[f] = true end
  for _, f in ipairs(C.lines("grep -rlE '\\b(app_new|App_frame1|Element_set_)' " .. sq(P.src) .. " --include='*.h#'")) do
    if f ~= "" and not declared[f] then bad(f .. " calls the gui API but has no `use \"hlib -> gui\"`"); n = n + 1 end
  end
  if n == 0 then say("  ok       gui is used only through `use \"hlib -> gui\"` (no extern, no adapters)\n") end

  -- 3. Version: Bit.hk and the VERSION constant of main.h# agree.
  local main = read_file(P.src .. "/main.h#") or ""
  local const_version = main:match('const VERSION: string = "([^"]+)"')
  local hk_version = manifest_value("version")
  if not const_version then
    bad("app/desktop/src/main.h#: no `const VERSION: string = \"...\"`")
  elseif const_version ~= hk_version then
    bad(string.format("version mismatch: Bit.hk says %s, main.h# says %s", tostring(hk_version), const_version))
  else
    say("  ok       version " .. hk_version .. " in Bit.hk and main.h#\n")
  end

  -- 4. Known H# 0.9 pitfalls the sources are written around.
  n = 0
  for _, l in ipairs(C.lines("grep -rnE '\\b(if|while)\\b.*(==|!=|<=|>=|<|>)[[:space:]]*-?[0-9]{3,}\\b' " .. sq(P.src) ..
    " --include='*.h#' | grep -vE 'const [A-Z_0-9]+:'")) do
    if l ~= "" then
      bad("literal of 128+ in an if/while condition (mis-compiled by some H# 0.9 builds - use a const): " .. l)
      n = n + 1
    end
  end
  for _, l in ipairs(C.lines("grep -rnE '^pub const ' " .. sq(P.src) .. " --include='*.h#'")) do
    if l ~= "" then bad("`pub const` reads as 0 from another module in some H# 0.9 builds - use a pub fn: " .. l); n = n + 1 end
  end
  if n == 0 then say("  ok       no known H# pitfalls (big literals in conditions, cross-module pub const)\n") end

  -- 4a. `array_push(x, <if ... then ... else ...>)` evaluates to the wrong value in some H# 0.9 builds.
  n = 0
  for _, l in ipairs(C.lines("grep -rnE 'array_push\\(.*\\bthen\\b' " .. sq(P.src) .. " --include='*.h#'")) do
    if l ~= "" then bad("if-expression inside array_push (bind it to a `let` first): " .. l); n = n + 1 end
  end
  if n == 0 then say("  ok       no if-expression inside array_push\n") end

  -- 4b. Ownership rule of the hlib facade: List_*_get / Option_*_get / Typ_get_<handle field> return a pointer
  -- BORROWED from their container; freeing it ("free(): invalid pointer") crashes the app.
  n = 0
  for _, l in ipairs(C.lines("grep -rnE '\\bMessage_free\\(' " .. sq(P.src) .. " --include='*.h#' | grep -v ';;'")) do
    if l ~= "" then
      bad("Message_free on a message from List_Message_get (borrowed from the list - List_Message_free releases it): " .. l)
      n = n + 1
    end
  end
  if n == 0 then say("  ok       no free of a pointer borrowed from a list\n") end

  -- 5. The app must not carry its own icon / index snapshot in git.
  local tracked = 0
  for _, f in ipairs(C.lines("git -C " .. sq(ROOT) .. " ls-files -- app/desktop/data/repository.json app/desktop/data/icon.png")) do
    if f ~= "" then
      C.warning("generated file is tracked in git: " .. f .. " (git rm --cached it; `bit` copies it at build time)")
      tracked = tracked + 1
    end
  end
  if tracked == 0 then say("  ok       no duplicated icon / index snapshot tracked in git\n") end

  -- 6. The launcher script.
  if C.file_exists(P.pack .. "/bit-io-desktop.sh") then
    if C.run("sh -n " .. sq(P.pack .. "/bit-io-desktop.sh")) then
      say("  ok       packaging/bit-io-desktop.sh parses\n")
    else
      bad("packaging/bit-io-desktop.sh has a syntax error")
    end
  end

  -- 7. With a `bit` around, let it type-check the modules too.
  local bit = env("BIT_BIN") or (have("bit") and "bit" or nil)
  if bit then
    if C.run("cd " .. sq(P.app) .. " && " .. sq(bit) .. " check >/dev/null 2>&1") then
      say("  ok       `bit check` passes\n")
    else
      bad("`bit check` failed in app/desktop")
    end
  else
    say("  skipped  `bit check` (bit is not installed)\n")
  end

  local v = version()
  say("  version  " .. v.name .. "\n")
  C.endgroup()

  if problems > 0 then
    C.summary("### Desktop app check\n\n:x: " .. problems .. " problem(s)")
    os.exit(1)
  end
  C.summary("### Desktop app check\n\n:white_check_mark: layout OK - version `" .. v.name .. "`")
  say("OK\n")
end

local function cmd_version()
  local v = version()
  io.write("name=" .. v.name .. "\n")
  local gh = env("GITHUB_OUTPUT")
  if gh then
    local f = io.open(gh, "a")
    if f then f:write("name=" .. v.name .. "\n"); f:close() end
  end
end

-- ── build ────────────────────────────────────────────────────────────────────

local function bit_cmd()
  local b = env("BIT_BIN") or (have("bit") and "bit" or nil)
  if not b then fail("`bit` not found (install it, or set BIT_BIN) - it builds the gui dependency and links it into the app") end
  return b
end

local function cmd_build()
  maybe_sync()
  local v = version()
  C.group("bit build --release (bit-io-desktop " .. v.name .. ")")
  -- bit builds `gui` (HackerScript -> gui.hlib with the C-ABI facade; the first build takes a few minutes)
  -- and then the H# program; the result is app/desktop/cache/build/release/bit-io-desktop
  must("cd " .. sq(P.app) .. " && " .. sq(bit_cmd()) .. " build --release")
  C.endgroup()
  if not C.file_exists(P.binary) then fail("the build produced no " .. P.binary) end
  say(string.format("  %s  (%.1f MB)\n", P.binary, size_of(P.binary) / 1048576))
end

local function ensure_binary()
  if opts.skip_build then
    if not C.file_exists(P.binary) then fail("--skip-build, but " .. P.binary .. " does not exist") end
  else
    cmd_build()
  end
end

-- The gui library reaches the program as a shared object (the hlib C-ABI facade). `ldd` says where
-- the linker found it; it has to travel with the binary.
local function find_facade()
  local found = {}
  for _, l in ipairs(C.lines("ldd " .. sq(P.binary))) do
    local name, where = l:match("^%s*(%S+)%s*=>%s*(/%S+)")
    if name and where and (name:lower():match("gui") or where:lower():match("hlib%-cache")) then
      found[#found + 1] = where
    end
  end
  if #found == 0 then
    -- not recorded by ldd (static, or looked up through the rpath): search the hlib cache
    for _, l in ipairs(C.lines("find \"$HOME/.hackeros\" -path '*hlib-cache*' -name '*gui*.so' 2>/dev/null | head -n 3")) do
      if l ~= "" then found[#found + 1] = l end
    end
  end
  return found
end

-- ── stage: the files of one installation ─────────────────────────────────────
--
--   <root>/bin/bit-io-desktop                  launcher (sets LD_LIBRARY_PATH / BIT_IO_DATA)
--   <root>/lib/bit-io/bit-io-desktop           the H# binary
--   <root>/lib/bit-io/<gui facade>.so          the gui library
--   <root>/share/bit-io/{repository.json,docs.md,icon.png}
--   <root>/share/applications/bit-io-desktop.desktop
--   <root>/share/icons/hicolor/256x256/apps/bit-io.png

local function stage(root, exec_path)
  local function put(src, dest, mode)
    must("install -Dm" .. mode .. " " .. sq(src) .. " " .. sq(root .. "/" .. dest))
  end
  put(P.pack .. "/bit-io-desktop.sh", "bin/" .. APP_NAME, "755")
  put(P.binary, "lib/bit-io/" .. APP_NAME, "755")
  local facade = find_facade()
  for _, so in ipairs(facade) do
    put(so, "lib/bit-io/" .. so:match("([^/]+)$"), "755")
  end
  put(P.data .. "/docs.md", "share/bit-io/docs.md", "644")
  put(P.data .. "/repository.json", "share/bit-io/repository.json", "644")
  put(P.data .. "/icon.png", "share/bit-io/icon.png", "644")
  put(P.data .. "/icon.png", "share/icons/hicolor/256x256/apps/bit-io.png", "644")
  local desktop = read_file(P.pack .. "/bit-io-desktop.desktop") or ""
  if exec_path then
    desktop = desktop:gsub("Exec=bit%-io%-desktop", function() return "Exec=" .. exec_path end)
  end
  must("mkdir -p " .. sq(root .. "/share/applications"))
  write_file(root .. "/share/applications/bit-io-desktop.desktop", desktop)
  if #facade == 0 then
    C.warning("no gui shared object found next to the binary (ldd lists none) - the package assumes it is linked in statically")
  end
end

-- ── package ──────────────────────────────────────────────────────────────────

local function cmd_package()
  maybe_sync()
  ensure_binary()
  local v = version()
  local out = out_dir()
  local march, darch = arch()
  local base = string.format("%s-%s-linux-%s", APP_NAME, v.name, march)
  local work = abs("cache/desktop-pack")
  must("rm -rf " .. sq(work) .. " && mkdir -p " .. sq(work))

  -- tar.gz: a prefix tree (bin/ lib/ share/) that can be unpacked into /usr/local or ~/.local
  C.group("Package " .. base .. ".tar.gz")
  local tree = work .. "/" .. base
  stage(tree, nil)
  if C.file_exists(P.license) then must("cp " .. sq(P.license) .. " " .. sq(tree .. "/LICENSE")) end
  write_file(tree .. "/README.txt", string.format([[bit.io Desktop %s

Copy the three folders into a prefix and run bin/bit-io-desktop:
  sudo cp -r bin lib share /usr/local/        (or  cp -r bin lib share ~/.local/)

Needs: curl and a Wayland or X11 session.
Optional: wl-clipboard or xclip (copy buttons), xdg-utils (opening links).
]], v.name))
  local tarball = out .. "/" .. base .. ".tar.gz"
  must("tar -C " .. sq(work) .. " -czf " .. sq(tarball) .. " " .. sq(base))
  checksum_file(tarball)
  C.endgroup()

  -- .deb
  local deb
  if have("dpkg-deb") then
    C.group("Package " .. base .. ".deb")
    local root = work .. "/deb"
    stage(root .. "/usr", "bit-io-desktop")
    must("mkdir -p " .. sq(root .. "/DEBIAN"))
    local kb = tonumber((C.capture("du -sk " .. sq(root .. "/usr") .. " | cut -f1"))) or 0
    write_file(root .. "/DEBIAN/control", string.format([[Package: %s
Version: %s
Section: devel
Priority: optional
Architecture: %s
Installed-Size: %d
Depends: libc6, curl, xdg-utils
Recommends: wl-clipboard | xclip
Maintainer: HackerOS Team <hackeros068@gmail.com>
Homepage: https://github.com/HackerOS-Linux-System/bit
Description: bit.io package browser for the HackerOS desktop
 Browse the bit package index (H#, Hacker Lang, HackerScript libraries): READMEs, manifests,
 source files, releases and GitHub stats, with an offline cache. Written in H#; the interface
 is the gui library (HackerScript) used through hlib.
]], APP_NAME, v.name, darch, kb))
    deb = out .. "/" .. base .. ".deb"
    must("dpkg-deb --build --root-owner-group " .. sq(root) .. " " .. sq(deb) .. " >/dev/null")
    must("dpkg-deb --info " .. sq(deb) .. " | head -n 12")
    checksum_file(deb)
    C.endgroup()
  else
    C.warning("dpkg-deb not found - skipping the .deb")
  end

  local rows = "| `" .. base .. ".tar.gz` | " .. string.format("%.1f MB", size_of(tarball) / 1048576) .. " |"
  if deb then rows = rows .. "\n| `" .. base .. ".deb` | " .. string.format("%.1f MB", size_of(deb) / 1048576) .. " |" end
  C.summary("### Desktop build\n\nVersion `" .. v.name .. "` (" .. march .. ")\n\n| File | Size |\n| --- | --- |\n" .. rows)
end

-- ── smoke ────────────────────────────────────────────────────────────────────

-- The app has to start, open its window (headless backend) and keep running until the timeout.
local function cmd_smoke()
  if not C.file_exists(P.binary) then fail("no binary - run `build` first (" .. P.binary .. ")") end
  C.group("Headless start")
  local home = abs("cache/smoke-home")
  must("rm -rf " .. sq(home) .. " && mkdir -p " .. sq(home))
  local facade = find_facade()
  local libdir = ""
  if #facade > 0 then libdir = "LD_LIBRARY_PATH=" .. sq(facade[1]:match("^(.*)/[^/]*$") or ".") .. " " end
  local cmd = string.format("cd %s && HOME=%s BIT_IO_DATA=%s GUI_BACKEND=headless %stimeout 6 %s",
    sq(P.app), sq(home), sq(P.data), libdir, sq(P.binary))
  say("$ " .. cmd .. "\n")
  local ok, code = C.run(cmd)
  -- 124 = still running when `timeout` stopped it: the success case for a GUI program
  if not ok and code ~= 124 then fail("the app exited early with code " .. tostring(code)) end
  say("  ok       the app stayed up for 6 seconds\n")
  C.endgroup()
end

-- ── install / uninstall ──────────────────────────────────────────────────────

local function cmd_install()
  maybe_sync()
  ensure_binary()
  local prefix = abs(expand_home(opts.prefix))
  C.group("Install into " .. prefix)
  stage(prefix, prefix .. "/bin/" .. APP_NAME)
  if have("update-desktop-database") then C.run("update-desktop-database " .. sq(prefix .. "/share/applications") .. " >/dev/null 2>&1") end
  if have("gtk-update-icon-cache") then C.run("gtk-update-icon-cache -q " .. sq(prefix .. "/share/icons/hicolor") .. " >/dev/null 2>&1") end
  C.endgroup()
  say("Installed. Start it with `" .. prefix .. "/bin/" .. APP_NAME .. "` or from the application menu.\n")
end

local function cmd_uninstall()
  local prefix = abs(expand_home(opts.prefix))
  C.group("Remove from " .. prefix)
  for _, rel in ipairs({
    "bin/" .. APP_NAME,
    "lib/bit-io",
    "share/bit-io",
    "share/applications/bit-io-desktop.desktop",
    "share/icons/hicolor/256x256/apps/bit-io.png",
  }) do
    must("rm -rf " .. sq(prefix .. "/" .. rel))
  end
  C.endgroup()
end

-- ── main ─────────────────────────────────────────────────────────────────────

local function usage()
  print([[usage: build-desktop-app.lua <command> [options]

commands:
  check               layout + rule checks (gui only through hlib, versions, known H# pitfalls)
  sync                copy index/repository.json + images/icon.png into app/desktop/data
  version             print the version that would be built
  build               sync + `bit build --release` in app/desktop
  package             build + tar.gz and .deb in dist/desktop
  smoke               start the built app headless for a few seconds
  install             install the release build into --prefix (default /usr/local)
  uninstall           remove it again

options:
  --out DIR           output directory (default: dist/desktop)
  --prefix DIR        install prefix (default: /usr/local; ~/.local for a per-user install)
  --skip-build        package / install the binary that is already built
  --no-sync           skip copying the index snapshot and the icon
  --quiet             print only errors]])
end

local commands = {
  check = cmd_check,
  sync = cmd_sync,
  version = cmd_version,
  build = cmd_build,
  package = cmd_package,
  smoke = cmd_smoke,
  install = cmd_install,
  uninstall = cmd_uninstall,
  help = function() usage() end,
}

if not opts.command then
  usage()
  os.exit(2)
end

local fn = commands[opts.command]
if not fn then
  io.stderr:write("unknown command: " .. opts.command .. "\n")
  usage()
  os.exit(2)
end

fn()
