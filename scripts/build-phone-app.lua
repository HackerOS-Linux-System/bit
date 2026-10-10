#!/usr/bin/env lua
-- scripts/build-phone-app.lua
--
-- Used by .github/workflows/build-phone-app.yml (Android, ubuntu) and
-- .github/workflows/build-phone-app-macos.yml (iOS, macos-latest).
--
-- Builds the native bit.io phone apps:
--   app/phones/android   Kotlin + Jetpack Compose   -> .apk + .aab
--   app/phones/ios       Swift + SwiftUI (XcodeGen) -> .ipa
--
--   lua scripts/build-phone-app.lua check            layout + seed-data sanity checks
--   lua scripts/build-phone-app.lua sync [--icons]   copy index/repository.json into both apps
--                                                    (+ regenerate icons from images/icon.png)
--   lua scripts/build-phone-app.lua version          print the version that would be built
--   lua scripts/build-phone-app.lua android          sync + Gradle release build (APK + AAB)
--   lua scripts/build-phone-app.lua ios              sync + xcodegen + xcodebuild (IPA, macOS only)
--   lua scripts/build-phone-app.lua all              android, then ios
--
-- Options:
--   --out DIR        where the artifacts go            (default: dist/phone)
--   --debug          debug build instead of release (android only)
--   --no-sync        skip copying the index snapshot
--
-- Environment:
--   BIT_VERSION_NAME / BIT_VERSION_CODE   override the computed version
--                                         (default: [package] version of Bit.hk, run number of the CI job)
--   Android signing (all optional - without a keystore the release is signed with the debug key):
--     BIT_KEYSTORE_BASE64   base64 of the .jks / .p12
--     BIT_KEYSTORE_PASSWORD, BIT_KEY_ALIAS, BIT_KEY_PASSWORD
--   iOS signing (all optional - without them an UNSIGNED .ipa is produced, to be re-signed
--   with AltStore / Sideloadly / `codesign` / fastlane resign):
--     IOS_CERT_P12_BASE64, IOS_CERT_PASSWORD   distribution or development certificate (.p12)
--     IOS_PROVISION_PROFILE_BASE64             .mobileprovision for org.hackeros.bitio
--     IOS_TEAM_ID                              Apple developer team id
--     IOS_EXPORT_METHOD                        ad-hoc (default) | development | app-store | enterprise
--
-- Exit code: 0 = success, 1 = a step failed, 2 = bad usage.

package.path = (arg[0]:match("^(.*)/[^/]*$") or ".") .. "/?.lua;" .. package.path
local C = require("common")

-- ── paths ────────────────────────────────────────────────────────────────────

local ROOT = (arg[0]:match("^(.*)/[^/]*$") or ".") .. "/.."
local function path(...) return ROOT .. "/" .. table.concat({ ... }, "/") end

local P = {
  index    = path("index", "repository.json"),
  icon     = path("images", "icon.png"),
  bit_hk   = path("Bit.hk"),
  android  = path("app", "phones", "android"),
  ios      = path("app", "phones", "ios"),
}
P.android_seed = P.android .. "/src/main/assets/repository.json"
P.ios_seed     = P.ios .. "/BitIO/Resources/repository.json"

local BUNDLE_ID = "org.hackeros.bitio"

-- ── options ──────────────────────────────────────────────────────────────────

local opts = {
  command = nil,
  out = os.getenv("PHONE_OUT_DIR") or "dist/phone",
  debug = false,
  sync = true,
  icons = false,
}

do
  local i = 1
  while i <= #arg do
    local a = arg[i]
    if a == "--out" then i = i + 1; opts.out = arg[i] or opts.out
    elseif a == "--debug" then opts.debug = true
    elseif a == "--no-sync" then opts.sync = false
    elseif a == "--icons" then opts.icons = true
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

local function fail(msg)
  C.error(msg)
  io.stderr:write("error: " .. msg .. "\n")
  os.exit(1)
end

-- Runs a command; a failure ends the script.
local function must(cmd, what)
  io.write("$ " .. cmd .. "\n")
  io.flush()
  local ok, code = C.run(cmd)
  if not ok then fail((what or cmd) .. " failed (exit " .. tostring(code) .. ")") end
end

-- Like must(), but the (very chatty) output goes to a log file; the tail is printed.
local function must_logged(cmd, log, what)
  io.write("$ " .. cmd .. "\n")
  io.flush()
  local ok, code = C.run(cmd .. " > " .. sq(log) .. " 2>&1")
  io.write(C.capture("tail -n " .. (ok and "15" or "80") .. " " .. sq(log)) .. "\n")
  if not ok then fail((what or cmd) .. " failed (exit " .. tostring(code) .. ") - full log: " .. log) end
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
  local cwd = C.capture("pwd")
  return cwd .. "/" .. p
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

-- Writes <artifact>.sha256 next to the artifact and prints the digest.
local function checksum_file(file)
  local sum = sha256_of(file)
  local name = file:match("([^/]+)$")
  write_file(file .. ".sha256", sum .. "  " .. name .. "\n")
  io.write(string.format("  %s  %s\n", sum, name))
  return sum
end

local function size_of(file)
  local f = io.open(file, "rb")
  if not f then return 0 end
  local n = f:seek("end")
  f:close()
  return n
end

-- ── version ──────────────────────────────────────────────────────────────────

-- `[package] version => x.y.z` of the root Bit.hk (the phone apps follow bit's own version).
local function bit_version()
  local text = read_file(P.bit_hk) or ""
  local in_package = false
  for line in (text:gsub("\r", "") .. "\n"):gmatch("(.-)\n") do
    local l = line:gsub("^%s+", ""):gsub("%s+$", "")
    local sec = l:match("^%[(.+)%]$")
    if sec then
      in_package = (sec:lower() == "package")
    elseif in_package then
      local v = l:match("^%-%>%s*version%s*=>%s*([%w%.%-%+]+)")
      if v then return v end
    end
  end
  return "0.1.0"
end

local function version()
  local name = env("BIT_VERSION_NAME") or bit_version()
  local code = tonumber(env("BIT_VERSION_CODE") or "")
  if not code then
    code = tonumber(env("GITHUB_RUN_NUMBER") or "")
  end
  if not code then
    code = tonumber((C.capture("git -C " .. sq(ROOT) .. " rev-list --count HEAD"))) or 1
  end
  -- store-friendly: marketing version must be dotted numerics for iOS
  local ios_name = name:match("^(%d+%.%d+%.%d+)") or name:match("^(%d+%.%d+)") or "0.1.0"
  return { name = name, code = math.floor(code), ios_name = ios_name }
end

-- ── sync: seed data + icons ──────────────────────────────────────────────────

local function sync_seed()
  C.group("Sync the library index snapshot into both apps")
  if not C.file_exists(P.index) then fail("missing " .. P.index) end
  -- the snapshot must be valid JSON (trailing commas are tolerated by the apps, but keep it strict)
  local ok = C.run("jq -e '.libraries | type == \"array\" and length > 0' " .. sq(P.index) .. " >/dev/null 2>&1")
  if not ok then C.warning("index/repository.json is not strict JSON - the apps still parse it, but fix the file") end
  for _, dest in ipairs({ P.android_seed, P.ios_seed }) do
    must("mkdir -p " .. sq(dest:match("^(.*)/[^/]*$")))
    must("cp " .. sq(P.index) .. " " .. sq(dest))
  end
  C.endgroup()
end

local function image_tool()
  if have("magick") then return "magick" end
  if have("convert") then return "convert" end
  return nil
end

-- Regenerates the launcher icons from images/icon.png (committed copies are used otherwise).
local function sync_icons()
  C.group("Regenerate icons from images/icon.png")
  local tool = image_tool()
  if not tool then
    C.warning("ImageMagick not found - keeping the committed icons")
    C.endgroup()
    return
  end
  local res = P.android .. "/src/main/res"
  local sizes = { mdpi = 48, hdpi = 72, xhdpi = 96, xxhdpi = 144, xxxhdpi = 192 }
  for density, px in pairs(sizes) do
    local dir = res .. "/mipmap-" .. density
    must("mkdir -p " .. sq(dir))
    must(string.format("%s %s -resize %dx%d %s", tool, sq(P.icon), px, px, sq(dir .. "/ic_launcher.png")))
  end
  must("mkdir -p " .. sq(res .. "/drawable-nodpi"))
  must(string.format("%s %s %s", tool, sq(P.icon), sq(res .. "/drawable-nodpi/bit_icon.png")))

  local assets = P.ios .. "/BitIO/Assets.xcassets"
  -- iOS app icons must be opaque: flatten on white
  must(string.format("%s %s -resize 1024x1024 -background white -alpha remove -alpha off %s",
    tool, sq(P.icon), sq(assets .. "/AppIcon.appiconset/AppIcon-1024.png")))
  must(string.format("%s %s %s", tool, sq(P.icon), sq(assets .. "/AppLogo.imageset/logo.png")))
  C.endgroup()
end

local function sync_all()
  if opts.sync then sync_seed() end
  if opts.icons then sync_icons() end
end

-- ── check ────────────────────────────────────────────────────────────────────

local REQUIRED = {
  -- android
  "app/phones/android/build.gradle.kts",
  "app/phones/android/settings.gradle.kts",
  "app/phones/android/src/main/AndroidManifest.xml",
  "app/phones/android/src/main/kotlin/org/hackeros/bitio/MainActivity.kt",
  "app/phones/android/src/main/kotlin/org/hackeros/bitio/BitApplication.kt",
  "app/phones/android/src/main/kotlin/org/hackeros/bitio/ui/BitApp.kt",
  "app/phones/android/src/main/res/mipmap-xxxhdpi/ic_launcher.png",
  "app/phones/android/src/main/assets/repository.json",
  -- ios
  "app/phones/ios/project.yml",
  "app/phones/ios/BitIO/BitIOApp.swift",
  "app/phones/ios/BitIO/Views/RootView.swift",
  "app/phones/ios/BitIO/Assets.xcassets/AppIcon.appiconset/Contents.json",
  "app/phones/ios/BitIO/Assets.xcassets/AppIcon.appiconset/AppIcon-1024.png",
  "app/phones/ios/BitIO/Resources/repository.json",
  -- shared inputs
  "index/repository.json",
  "images/icon.png",
}

local function cmd_check()
  C.group("Phone app layout")
  local problems = 0
  for _, rel in ipairs(REQUIRED) do
    if C.file_exists(path(rel)) then
      io.write("  ok       " .. rel .. "\n")
    else
      C.error("missing " .. rel)
      problems = problems + 1
    end
  end
  C.endgroup()

  C.group("Rules")
  -- No WebView: the whole point of these apps is a native UI.
  local hits = C.lines("grep -rIlE 'import android\\.webkit|androidx\\.webkit|import WebKit|WKWebView\\(|SFSafariViewController|[^A-Za-z]WebView\\(' " ..
    sq(P.android .. "/src") .. " " .. sq(P.ios .. "/BitIO") .. " 2>/dev/null")
  local found = 0
  for _, f in ipairs(hits) do
    if f ~= "" then
      C.error("web view reference in " .. f .. " - the phone apps must stay native")
      problems = problems + 1
      found = found + 1
    end
  end
  if found == 0 then io.write("  ok       no WebView anywhere\n") end

  -- Seed snapshots should match the index (otherwise run `build-phone-app.lua sync`).
  for name, seed in pairs({ android = P.android_seed, ios = P.ios_seed }) do
    if read_file(seed) ~= read_file(P.index) then
      C.warning(name .. " seed repository.json differs from index/repository.json (run: lua scripts/build-phone-app.lua sync)")
    else
      io.write("  ok       " .. name .. " seed matches index/repository.json\n")
    end
  end

  -- iOS app icon must have no alpha channel.
  local tool = image_tool()
  if tool and have("identify") then
    local alpha = C.capture("identify -format '%[channels]' " ..
      sq(P.ios .. "/BitIO/Assets.xcassets/AppIcon.appiconset/AppIcon-1024.png"))
    if alpha:lower():match("a$") then
      C.error("AppIcon-1024.png has an alpha channel - App Store / IPA validation rejects it")
      problems = problems + 1
    else
      io.write("  ok       AppIcon-1024.png is opaque (" .. alpha .. ")\n")
    end
  end

  local v = version()
  io.write(string.format("  version  %s (code %d, iOS %s)\n", v.name, v.code, v.ios_name))
  C.endgroup()

  if problems > 0 then
    C.summary("### Phone app check\n\n:x: " .. problems .. " problem(s)")
    os.exit(1)
  end
  C.summary("### Phone app check\n\n:white_check_mark: layout OK - version `" .. v.name .. "` (build " .. v.code .. ")")
  io.write("OK\n")
end

local function cmd_version()
  local v = version()
  io.write(string.format("name=%s\ncode=%d\nios_name=%s\n", v.name, v.code, v.ios_name))
  local gh = env("GITHUB_OUTPUT")
  if gh then
    local f = io.open(gh, "a")
    if f then
      f:write(string.format("name=%s\ncode=%d\nios_name=%s\n", v.name, v.code, v.ios_name))
      f:close()
    end
  end
end

-- ── android ──────────────────────────────────────────────────────────────────

local function gradle_cmd()
  local wrapper = P.android .. "/gradlew"
  if C.file_exists(wrapper) then return "sh " .. sq(wrapper) end
  if have("gradle") then return "gradle" end
  fail("Gradle not found (install it or commit a gradle wrapper into app/phones/android)")
end

local function cmd_android()
  local v = version()
  local out = out_dir()
  sync_all()

  C.group("Android " .. v.name .. " (build " .. v.code .. ")")
  local prefix = ""
  local keystore_b64 = env("BIT_KEYSTORE_BASE64")
  local signed = false
  if keystore_b64 then
    local tmp = env("RUNNER_TEMP") or "/tmp"
    local ks = tmp .. "/bit-release.jks"
    local f = assert(io.open(tmp .. "/bit-release.jks.b64", "wb"))
    f:write(keystore_b64)
    f:close()
    must("base64 -d < " .. sq(tmp .. "/bit-release.jks.b64") .. " > " .. sq(ks))
    os.remove(tmp .. "/bit-release.jks.b64")
    prefix = "BIT_KEYSTORE_FILE=" .. sq(ks) .. " "
    signed = true
    io.write("release keystore decoded\n")
  else
    C.warning("BIT_KEYSTORE_BASE64 not set - signing the release build with the debug key (fine for sideloading, not for the Play Store)")
  end

  local variant = opts.debug and "Debug" or "Release"
  local tasks = opts.debug and "assembleDebug" or "assembleRelease bundleRelease"
  must(string.format("%s%s -p %s --no-daemon --stacktrace -PversionName=%s -PversionCode=%d %s",
    prefix, gradle_cmd(), sq(P.android), sq(v.name), v.code, tasks), "Gradle " .. variant .. " build")
  C.endgroup()

  C.group("Collect artifacts")
  local kind = opts.debug and "debug" or "release"
  local apk_src = C.capture("ls " .. sq(P.android .. "/build/outputs/apk/" .. kind) .. "/*.apk | head -n1")
  if apk_src == "" then fail("no APK produced") end
  local label = signed and "android" or "android-debugkey"
  if opts.debug then label = "android-debug" end
  local apk = string.format("%s/bit-io-%s-%s.apk", out, v.name, label)
  must("cp " .. sq(apk_src) .. " " .. sq(apk))
  checksum_file(apk)
  local rows = { string.format("| `%s` | %.1f MB |", apk:match("([^/]+)$"), size_of(apk) / 1048576) }

  if not opts.debug then
    local aab_src = C.capture("ls " .. sq(P.android .. "/build/outputs/bundle/release") .. "/*.aab | head -n1")
    if aab_src == "" then fail("no AAB produced") end
    local aab = string.format("%s/bit-io-%s-%s.aab", out, v.name, label)
    must("cp " .. sq(aab_src) .. " " .. sq(aab))
    checksum_file(aab)
    rows[#rows + 1] = string.format("| `%s` | %.1f MB |", aab:match("([^/]+)$"), size_of(aab) / 1048576)
  end
  C.endgroup()

  C.summary("### Android build\n\nVersion `" .. v.name .. "` (build " .. v.code .. ")" ..
    (signed and "" or " - **signed with the debug key**") ..
    "\n\n| File | Size |\n| --- | --- |\n" .. table.concat(rows, "\n"))
end

-- ── ios ──────────────────────────────────────────────────────────────────────

-- Imports the distribution certificate into a throw-away keychain and installs the profile.
-- Returns { identity=, profile_name=, keychain= } or nil when no signing material is configured.
local function setup_ios_signing()
  local p12, pass, prof, team = env("IOS_CERT_P12_BASE64"), env("IOS_CERT_PASSWORD"), env("IOS_PROVISION_PROFILE_BASE64"), env("IOS_TEAM_ID")
  if not (p12 and pass and prof and team) then return nil end

  local tmp = env("RUNNER_TEMP") or "/tmp"
  local keychain = tmp .. "/bit-signing.keychain-db"
  local kc_pass = "bit-ci-" .. tostring(os.time())

  write_file(tmp .. "/bit-cert.b64", p12)
  write_file(tmp .. "/bit-prof.b64", prof)
  must("base64 -D -i " .. sq(tmp .. "/bit-cert.b64") .. " -o " .. sq(tmp .. "/bit-cert.p12") ..
       " 2>/dev/null || base64 -d < " .. sq(tmp .. "/bit-cert.b64") .. " > " .. sq(tmp .. "/bit-cert.p12"))
  must("base64 -D -i " .. sq(tmp .. "/bit-prof.b64") .. " -o " .. sq(tmp .. "/bit.mobileprovision") ..
       " 2>/dev/null || base64 -d < " .. sq(tmp .. "/bit-prof.b64") .. " > " .. sq(tmp .. "/bit.mobileprovision"))
  os.remove(tmp .. "/bit-cert.b64")
  os.remove(tmp .. "/bit-prof.b64")

  must("security create-keychain -p " .. sq(kc_pass) .. " " .. sq(keychain))
  must("security set-keychain-settings -lut 21600 " .. sq(keychain))
  must("security unlock-keychain -p " .. sq(kc_pass) .. " " .. sq(keychain))
  must("security import " .. sq(tmp .. "/bit-cert.p12") .. " -k " .. sq(keychain) ..
       " -P " .. sq(pass) .. " -A -t cert -f pkcs12")
  must("security set-key-partition-list -S apple-tool:,apple: -k " .. sq(kc_pass) .. " " .. sq(keychain) .. " >/dev/null")
  must("security list-keychains -d user -s " .. sq(keychain) .. " $(security list-keychains -d user | tr -d '\"')")

  local identity = C.capture("security find-identity -v -p codesigning " .. sq(keychain) ..
    " | sed -n 's/.*\"\\(.*\\)\"/\\1/p' | head -n1")
  if identity == "" then fail("no code-signing identity found in the imported certificate") end

  local decoded = tmp .. "/bit.mobileprovision.plist"
  must("security cms -D -i " .. sq(tmp .. "/bit.mobileprovision") .. " > " .. sq(decoded))
  local uuid = C.capture("/usr/libexec/PlistBuddy -c 'Print :UUID' " .. sq(decoded))
  local name = C.capture("/usr/libexec/PlistBuddy -c 'Print :Name' " .. sq(decoded))
  if uuid == "" or name == "" then fail("could not read the provisioning profile") end
  local dest = (os.getenv("HOME") or "~") .. "/Library/MobileDevice/Provisioning Profiles"
  must("mkdir -p " .. sq(dest))
  must("cp " .. sq(tmp .. "/bit.mobileprovision") .. " " .. sq(dest .. "/" .. uuid .. ".mobileprovision"))

  io.write("signing identity: " .. identity .. "\nprovisioning profile: " .. name .. " (" .. uuid .. ")\n")
  return { identity = identity, profile_name = name, keychain = keychain, team = team }
end

local function cleanup_ios_signing(sign)
  if sign then C.run("security delete-keychain " .. sq(sign.keychain) .. " >/dev/null 2>&1") end
end

local function cmd_ios()
  if C.capture("uname -s") ~= "Darwin" then
    fail("the iOS build needs macOS (Xcode) - run it from the macos-latest workflow")
  end
  local v = version()
  local out = out_dir()
  sync_all()

  C.group("Generate the Xcode project (XcodeGen)")
  if not have("xcodegen") then must("brew install xcodegen", "installing XcodeGen") end
  must("cd " .. sq(P.ios) .. " && xcodegen generate --spec project.yml --project .", "xcodegen")
  C.endgroup()

  local build = P.ios .. "/build"
  local archive = build .. "/BitIO.xcarchive"
  must("rm -rf " .. sq(build) .. " && mkdir -p " .. sq(build))

  local sign = setup_ios_signing()
  local base = string.format(
    "xcodebuild -project %s -scheme BitIO -configuration Release -sdk iphoneos " ..
    "-destination 'generic/platform=iOS' -archivePath %s " ..
    "MARKETING_VERSION=%s CURRENT_PROJECT_VERSION=%d",
    sq(P.ios .. "/BitIO.xcodeproj"), sq(archive), sq(v.ios_name), v.code)

  local ipa
  if sign then
    C.group("Archive + export (signed)")
    must_logged(base .. string.format(
      " CODE_SIGN_STYLE=Manual DEVELOPMENT_TEAM=%s CODE_SIGN_IDENTITY=%s PROVISIONING_PROFILE_SPECIFIER=%s " ..
      "OTHER_CODE_SIGN_FLAGS=%s archive",
      sq(sign.team), sq(sign.identity), sq(sign.profile_name), sq("--keychain " .. sign.keychain)),
      build .. "/archive.log", "xcodebuild archive")
    local method = env("IOS_EXPORT_METHOD") or "ad-hoc"
    local plist = build .. "/ExportOptions.plist"
    write_file(plist, string.format([[<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>method</key><string>%s</string>
  <key>teamID</key><string>%s</string>
  <key>signingStyle</key><string>manual</string>
  <key>signingCertificate</key><string>%s</string>
  <key>provisioningProfiles</key>
  <dict><key>%s</key><string>%s</string></dict>
  <key>compileBitcode</key><false/>
  <key>stripSwiftSymbols</key><true/>
</dict>
</plist>
]], method, sign.team, sign.identity, BUNDLE_ID, sign.profile_name))
    must_logged(string.format("xcodebuild -exportArchive -archivePath %s -exportPath %s -exportOptionsPlist %s",
      sq(archive), sq(build .. "/export"), sq(plist)), build .. "/export.log", "xcodebuild -exportArchive")
    local produced = C.capture("ls " .. sq(build .. "/export") .. "/*.ipa | head -n1")
    if produced == "" then fail("export produced no .ipa") end
    ipa = string.format("%s/bit-io-%s-ios-%s.ipa", out, v.name, method)
    must("cp " .. sq(produced) .. " " .. sq(ipa))
    C.endgroup()
  else
    C.warning("no iOS signing secrets - building an UNSIGNED .ipa (re-sign it with AltStore / Sideloadly / codesign)")
    C.group("Archive (unsigned)")
    must_logged(base .. " CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO CODE_SIGN_IDENTITY= archive",
      build .. "/archive.log", "xcodebuild archive")
    C.endgroup()

    C.group("Package the .ipa")
    local app = archive .. "/Products/Applications/BitIO.app"
    if not C.file_exists(app .. "/Info.plist") then fail("archive has no BitIO.app") end
    local payload = build .. "/ipa"
    must("rm -rf " .. sq(payload) .. " && mkdir -p " .. sq(payload .. "/Payload"))
    must("cp -R " .. sq(app) .. " " .. sq(payload .. "/Payload/BitIO.app"))
    ipa = string.format("%s/bit-io-%s-ios-unsigned.ipa", out, v.name)
    must("rm -f " .. sq(ipa) .. " && cd " .. sq(payload) .. " && zip -qry " .. sq(ipa) .. " Payload")
    C.endgroup()
  end
  cleanup_ios_signing(sign)

  C.group("Verify the .ipa")
  must("unzip -l " .. sq(ipa) .. " | grep -q 'Payload/BitIO.app/Info.plist'", "ipa structure")
  must("unzip -l " .. sq(ipa) .. " | tail -n 1")
  checksum_file(ipa)
  C.endgroup()

  C.summary("### iOS build\n\nVersion `" .. v.ios_name .. "` (build " .. v.code .. ") - " ..
    (sign and "signed" or "**unsigned** (re-sign before installing)") ..
    "\n\n| File | Size |\n| --- | --- |\n| `" .. ipa:match("([^/]+)$") .. "` | " ..
    string.format("%.1f MB", size_of(ipa) / 1048576) .. " |")
end

-- ── main ─────────────────────────────────────────────────────────────────────

local function usage()
  print([[usage: build-phone-app.lua <command> [options]

commands:
  check               layout + seed-data sanity checks
  sync [--icons]      copy index/repository.json into both apps (and regenerate icons)
  version             print the version that would be built
  android             Gradle release build (APK + AAB)
  ios                 XcodeGen + xcodebuild (IPA, macOS only)
  all                 android, then ios

options:
  --out DIR           output directory (default: dist/phone)
  --debug             android: debug build
  --no-sync           skip copying the index snapshot
  --icons             regenerate launcher icons from images/icon.png]])
end

local commands = {
  check = cmd_check,
  sync = function() opts.sync = true; sync_all() end,
  version = cmd_version,
  android = cmd_android,
  ios = cmd_ios,
  all = function() cmd_android(); cmd_ios() end,
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
