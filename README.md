# bit

Package manager for **H#**, **Hacker Lang** and **HackerScript** (successor of `bytes`).
Written 100% in H#, statically linked. Library index: [`index/repository.json`](index/repository.json) · website: **bit.io** (`website/`, TypeScript).

```bash
bit init myapp --lang h#      # h# | hl | hs   (--lib for a library)
cd myapp
bit                           # does everything Bit.hk describes
```

A bare `bit` reads `Bit.hk` → installs missing dependencies → builds with `[default-build]` → optionally runs the result.

## Bit.hk

```
[package]
-> name        => myapp
-> version     => 0.1.0
-> lang        => h#              ;; h# | hl | hs   (several: h#, hs)   default: auto

[layout]                          ;; optional — otherwise auto-detected
-> src => src                     ;; src/ *.h# = H#   |   cmd/ + lib/ *.hcs = HackerScript
-> hl-entry => main.hl            ;; Hacker Lang must be told where its code is

[build]
-> link     => static             ;; the only mode; `dynamic` is rejected
-> target   => h#                 ;; language toolchain: h# | hl | hs   (a platform also works)
-> platform => linux-aarch64      ;; cross-compilation platform
-> mem-mode => ...                ;; passed to h#
-> flags    => ...                ;; extra flags for the compiler

[edition]                         ;; H# ONLY — read when `lang => h#`, ignored (with a warning) for hl / hs
-> edition   => 2026              ;; default edition for files without `using "<year>"` (passed as `h# --edition`)
-> toolchain => 0.9               ;; minimum H#: `h# --version` must report 0.9 or newer (older = error)

[lib]
-> output => hlib                 ;; hlib (default) | so | a | obj

! what a bare `bit` / `bit build` does
[default-build]
! profile: release | debug  (release when the section exists)
-> profile => release
-> target  => h#
! emit: bin | hlib | so | a | obj
-> emit    => bin
-> before  => echo start
-> after   => echo done
! run the result (args => "...")
-> run     => true

[dependencies]
! newest index entry
-> mold => *
! branch / tag / commit
-> tui  => rev v1.0
-> x    => git https://github.com/you/x v2
! a dependency with options is a map (a key is a value OR a map, never both)
-> mine
--> path => ../mine
--> output => a

! custom commands: `bit deploy`
[commands]
-> deploy
--> run => scp cache/build/release/myapp server:/opt/
--> description => Copy the release build to the server
-> hello => echo hello

[hooks]
-> pre-build  => ...
-> post-build => ...

[workspace]
-> members => [core, cli]
```

`Bit.hk` is parsed by the **hk-parser** library (bit.io), so its grammar is hk-parser's: `!` starts a
comment (whole lines only), `-> key => value`, one more dash per nesting level (`-->`, `--->`), arrays
as `[a, b]`.

Toolchain overrides: `BIT_HSHARP`, `BIT_HL`, `BIT_HACKERC`.

## Repository

```
src/        bit (H#): main, cli, build, installer, workflow, project, index, lock, checksum, hk, ui, util, scaffold, commands, semver, net, task, native
scripts/    CI: build-new-package.lua, test-package.lua, validate-index.lua (+ common.lua, bootstrap-ci.sh)
website/    bit.io — TypeScript, built with tsc → dist/
index/      repository.json
.github/workflows/
  build.yml               build bit (release, static) + release binary on tags
  test.yml                CI scripts, h# check of every module, bit end-to-end smoke test
  build-new-package.yml   build library entries added/changed in index/repository.json
  test-package.yml        check/build/test the libraries of the index (weekly + on changes)
  build-website.yml       build & deploy bit.io
```

## Dependencies, versions and lock files

```
[dependencies]
-> regex => ^1.2                ! newest v1.x tag of the library (>= 1.2.0, < 2.0.0)
-> tui   => ~1.2.3              ! >= 1.2.3, < 1.3.0
-> json  => >=1.0 <2.0
-> mold  => 1.x                 ! also 1.2.x, =1.2.3, *
-> old   => rev v0.9.1          ! exactly this tag / branch / commit
-> mine
--> git => https://github.com/you/mine     ! options as a map ...
--> version => ^0.3                          ! ... a range for a git dependency
```

Ranges are resolved against the library's git tags (`v1.2.3` or `1.2.3`; pre-releases are ignored).
The result is written to the project's **`Bit.lock`** (JSON Lines: name, resolved tag, commit,
checksum, and the range it came from). Commit it.

| command | does |
|---|---|
| `bit install` | installs the dependencies; a locked entry that was resolved from the same range is reused |
| `bit install --locked` | exactly what `Bit.lock` says — fails if a dependency is missing from it (CI) |
| `bit outdated` | locked → newest-in-range → newest overall, for every dependency |
| `bit upgrade [name]` | re-resolves the ranges, fetches the newest matches, rewrites `Bit.lock` (`--dry-run` = `outdated`) |
| `bit migrate [--check]` | rewrites an old-syntax `Bit.hk` and old lock files (`--check`: change nothing, exit 1 if needed) |

Old `Bit.hk` files (`;;` comments, `key = value`, a value plus `-->` sub-keys) are still read, in
compatibility mode with a warning; old lock files are converted the first time they are read
(the previous copy is kept as `<lock>.old`).

## Native parts

A library with native code says how to build it:

```
[build]
-> native          => cargo build --release --lib
-> native-lib-path => target/release            ! default for cargo: target/release
-> native-skip-if  => target/release/libhk_parser.a   ! dependencies: skip when present
```

Before `bit build` compiles anything, it builds the native part of the project and of every
dependency (transitively; dependencies once, the project every time), and exports all
`native-lib-path` directories on `LIBRARY_PATH`. With `--platform` and a `cargo` command,
`--target <triple>` is added automatically.

## Network

Every clone / `ls-remote` / index download goes through one policy:

| | |
|---|---|
| retries | `BIT_RETRIES` (default 3), exponential back-off 2s, 4s, 8s |
| timeout | `BIT_TIMEOUT` seconds (default 120; stalled connections are cut, git never prompts) |
| offline | `--offline` or `BIT_OFFLINE=1`: installed libraries + cached index only; `Bit.lock` pins make ranges resolvable offline |
| parallel | `--jobs N` / `BIT_JOBS` (default 4): missing dependencies are cloned concurrently, then installed in order |
| feedback | a spinner (with git's clone percentage) for clones and every build step — plain lines in CI or with `--verbose` |

## Index policy

`index/repository.json` entries added from now on (or whose `target` changes) must carry a pinned
`rev` — a version tag or a full commit id, not a branch — and may carry `checksum`
(`sha256:<64 hex>`). `scripts/validate-index.lua` enforces it (in `build-website.yml` and
`test.yml`); older unpinned entries only warn. Pull requests from forks that touch the index
wait for a maintainer to approve the `external-packages` environment before
`build-new-package.yml` / `test-package.yml` build their code.

## Building bit itself

bit is written in H# and built on three libraries, none of which is re-implemented inside bit:

| what | where it comes from |
|---|---|
| `.hk` manifests | **hk-parser** (`bit-io/hk-parser`; Rust staticlib with a C ABI, linked with `extern static`) |
| progress bars | **progress-bar** (`bit-io/progress-bar`, pure H#) |
| JSON | H# `std -> json` (in compiled H# it reads flat objects only, so `bit.lock` is JSON Lines and the index is cut into one chunk per library before `json::get_str`) |

`scripts/bootstrap-ci.sh` sets everything up: it installs H# with the official
`install-utils.sh` + `install.sh` from the H-Sharp repository, puts hk-parser and progress-bar in
`~/.hackeros/H#/build/cache/packages/` and builds `libhk_parser.a` (add it to `LIBRARY_PATH`). Then:

```sh
bash scripts/bootstrap-ci.sh
h# compile src/main.h# -o cache/build/release/bit --release
```

## H# editions and toolchain (`[edition]`)

For `lang => h#` projects the optional `[edition]` section pins two things:

```
[package]
-> lang => h#

[edition]
-> edition   => 2026     ;; default edition for source files that don't say `using "2026"`
-> toolchain => 0.9      ;; minimum H# version
```

- **`edition`** is handed to `h#` as `--edition <year>` for `bit build`, `check` and `test`
  (and to `h# lib build`, which records it in the `.hlib` manifest). A file's own `using "<year>"`
  still wins for that file; a dependency keeps *its own* `[edition]`. Without the key, `h#` uses the
  newest edition it knows. A malformed value (`2O26`, `26`) is reported by bit, naming `Bit.hk`;
  an edition the compiler doesn't know is reported by `h#` with the list of supported ones.
- **`toolchain`** is a *minimum*, not a pin. Before building, checking or testing, bit runs
  `h# --version` (honouring `BIT_HSHARP`) and compares: the same version or a **newer** one is fine,
  an **older** one stops the build with
  `this project needs H# 1.1 or newer (toolchain => 1.1), but `h# --version` reports 0.9.0`.
  Values are plain versions (`1.1`, `v1.1.2`) — ranges are not accepted here.
- Both keys apply **only to H#**. With `lang => hl` / `hs` (or no `lang`), the section is ignored and
  `bit check` / `bit build` say so. `bit new` writes `[edition] -> edition => 2026` for H# projects.

## Where libraries live, and what runs before the build (`[directories]`)

Available for **every** language (`h#`, `hl`, `hs`):

```
[directories]
-> file         => default      ! default | home | root | project
-> before-build => gen.sh       ! a script, a command line, or a list: [gen.sh, "cargo build -p bindings"]
```

| `file` | libraries are |
|---|---|
| `default` | as before: in `~/.hackeros/libs` (the home of whoever runs bit — `/root/…` for root), linked into `<project>/cache/libs/` |
| `home` | always in the current user's `~/.hackeros/libs` |
| `root` | always in `/root/.hackeros/libs` |
| `project` | **only** inside the project: `<project>/cache/libs/<name>/` holds the sources directly — no `<commit>/` level, no `current` link, nothing installed or linked anywhere else |

An explicit `BIT_HOME` in the environment beats `file`. An unknown value is an error that suggests the closest one.

**`before-build`** tells bit what to run *before* it builds the project (before `pre-build` and before the native
part) — generating bindings for a Rust / C / other native part, for example. It runs in the project root; a script
is started by its extension (`.sh .bash` → bash, `.zsh`, `.h#` → `h# preview`, `.hl`, `.py`, `.lua`, `.js`, `.rb`, `.pl`),
any other file runs itself if executable (else `sh`), and anything that looks like a command line runs as written.
A missing script, or a non-zero exit, stops the build. For a library this also runs when bit builds it after
`bit install`.

## Manifest diagnostics (nidus)

`Bit.hk` problems are shown with **nidus** (bit.io) — the offending text underlined, an error code, a hint —
instead of being swallowed:

```
error[bit::hk::unexpected_symbol]: unexpected `$` in Bit.hk
warning[bit::hk::unknown_option]: unknown option `versoin` in [package]      did you mean `version`?
warning[bit::hk::unknown_section]: unknown section [dependancies]              did you mean `dependencies`?
error[bit::hk::bad_value]: `hmoe` is not a valid value for `file` in [directories]
```

Errors (stray symbols, unclosed `[` / `"`, missing `=>`, bad nesting, invalid values) stop the command; warnings
(unknown section or option, duplicates, the old `;;` / `key = value` syntax) are shown and ignored. Every
manifest is reported once per run.
