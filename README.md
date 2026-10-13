# bit

Package manager for **H#**, **Hacker Lang** and **HackerScript** (successor of `bytes`).
Written 100% in H#, statically linked. Library index: [`index/repository.json`](index/repository.json) · website: **bit.io** (`website/`, TypeScript — README, API docs, source browser, releases, offline mode; `npm test` runs the unit tests, `tests/e2e.py` the browser smoke test).

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

## Where a library comes from — repositories, directories, files

A `target` in `index/repository.json` (also `bit install <spec>` and `git =>` dependencies) is not
limited to a whole git repository:

| `target` | what is installed |
|---|---|
| `https://github.com/org/repo` | the whole repository |
| `https://github.com/org/repo/tree/v1.2/crates/x` | **one directory** of it, at ref `v1.2` |
| `https://github.com/org/repo#crates/x` | the same, fragment spelling (also `"dir": "crates/x"`) |
| `https://github.com/org/repo/blob/main/src/x.h#` | **one file** of it (also `"file": "src/x.h#"`) |
| `https://raw.githubusercontent.com/org/repo/main/x.hl` | a file, downloaded as it is |
| `https://example.org/dl/x.h#` | any https url that ends in a source file (`"type": "file"` forces it) |
| `/path/dir`, `./dir`, `~/dir`, `file:///dir` | a directory on disk (copied); a path to a file works too |

`tree/blob/raw` urls of GitHub, GitLab (`/-/tree/…`), Codeberg/Gitea (`/src/branch/…`) and Bitbucket
(`/src/<ref>/…`) are understood. The segment after `tree/` is the ref; a branch with a `/` in its name
needs the explicit `rev` + `dir` keys. A branch `main` / `master` / `HEAD` in a url means "the default
branch" (no pin). A `#` that ends a file name (`x.h#`) is part of the name; `%23` also works.

```json
{ "name": "libhammer", "target": "https://github.com/HackerOS-Linux-System/hammer/tree/main/libhammer", ... }
{ "name": "colors",    "target": "https://github.com/org/mono", "dir": "libs/colors", "rev": "v1.0.0", ... }
{ "name": "util",      "target": "https://github.com/org/repo/blob/v1.0.0/src/util.h#", ... }
```

* **Directory / file of a repository** are fetched with a sparse, blob-less clone (only that path is
  downloaded; older git or servers fall back to a normal clone). The commit, tag ranges, `Bit.lock`
  (`dir`) and checksums work as for a whole repository.
* **A single file** becomes a tiny library: the file plus a generated `Bit.hk`
  (`lang` from the extension — `.h#`, `.hl`, `.hcs`; `[layout] lib-entry` = the file).
* **Downloads and local paths** have no commit: the content hash (40 hex chars) is the version id.
  Local paths work offline; they are meant for development, not for the public index (CI requires https).
* `bit install` / `bit upgrade` of a library installed this way remember the directory/file.

## Repository

```
src/        bit (H#): main, cli, help, build, installer, locator, bitpkg, workflow, project, index, lock, checksum, hk, ui, util, scaffold, commands, semver, net, task, native
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

## `.bit` packages — prebuilt libraries (SquashFS)

Cargo ships a `.crate` (a tarball of *sources*): it has to be unpacked and **every dependency is compiled on your
machine**. bit has its own format instead: a **`.bit`** is a **SquashFS image holding the library already compiled**.
It is **never unpacked** — bit mounts it read-only (squashfuse, no root needed; or a loop mount as root) — and nothing
is compiled, so a fresh `bit install` is a download plus a mount.

```
mylib-1.2.0-linux-x86_64.bit          (+ mylib-1.2.0-linux-x86_64.bit.sha256)
├── mylib.hlib  →  .bit/out/mylib.hlib      compiled library (+ libmylib.a / .so / mylib.o if asked for)
├── Bit.hk, src/…                           sources (optional) — `use "bit -> mylib"` keeps working
├── README.md  LICENSE  docs/               (optional)
└── .bit/package.hk  .bit/SHA256SUMS        commit, platform, compiler, checksum of every file
```

The layout is exactly what the H# compiler already searches in an installed library (`<lib>/<name>.hlib`,
`<lib>/.bit/out/`), so `use "hlib -> mylib"` finds it with no compiler change.

**Where it comes from.** bit assumes the package is an asset of the library's **GitHub (or Codeberg) release**:
`<repo>/releases/download/<tag>/<name>-<version>-<platform>.bit`. `bit pack` produces it, you attach it to the release.

```sh
# author
bit pack                          # builds the library, writes dist/<name>-<version>-<platform>.bit + .sha256
bit pack --platform linux-aarch64 --out dist
gh release upload v1.2.0 dist/*   # a ready workflow: scripts/templates/release-bit.yml

# user
bit install --prebuilt mylib      # release asset if there is one, otherwise build from source
bit install --prebuilt-only mylib # never build from source
bit pkg                           # installed .bit packages and whether they are mounted
bit pkg mount --all               # mounts are gone after a reboot; bit re-opens them by itself on install/build
bit pkg info|ls|verify FILE.bit   # inspect without unpacking          bit pkg extract FILE.bit [dir]  (escape hatch)
```

Turn it on for a project in **Bit.hk**, or per command (`--prebuilt`, `--prebuilt-only`, `--no-prebuilt`), or for the
user (`bit settings set prebuilt auto`, `BIT_PREBUILT=off|auto|only`). Precedence: flag / environment / `bit settings`
> `[prebuilt]` > off.

```
[prebuilt]                          ! consumer side — applies to [dependencies]
-> enable   => true
-> mode     => auto                 ! auto = fall back to source · only = never build from source
-> asset    => {name}-{version}-{platform}.bit
-> platform => linux-x86_64         ! default: this machine
-> verify   => auto                 ! auto = check <asset>.sha256 when present · require · off
-> mount    => auto                 ! auto | fuse | kernel | extract (extract = unpack, last resort)

[pack]                              ! author side — what `bit pack` puts in the .bit
-> contents    => [hlib, sources, docs]   ! hlib a so obj sources docs
-> compression => zstd              ! zstd | xz | gzip | lz4 | lzo
-> level       => 15
-> block-size  => 131072
-> output      => dist
-> files       => [data/extra.bin]

[dependencies]
-> tui => ^1.2
-> mine
--> git => https://github.com/you/mine
--> prebuilt => false               ! this one is always built from source
```

`bit pack` needs `mksquashfs` (squashfs-tools); using a package needs `squashfuse` **or** squashfs-tools (`unsquashfs`) —
or run bit as root for a kernel loop mount. A package is recorded in `bit.lock` with `output = bit` and the sha256 of
the image; `bit verify` re-checks it. Only libraries that are not in a sub-directory of their repository can be packed.

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

bit is written in H# and built on these libraries, none of which is re-implemented inside bit:

| what | where it comes from |
|---|---|
| `.hk` manifests | **hk-parser** (`bit-io/hk-parser`; Rust staticlib with a C ABI, linked with `extern static`) |
| progress bars | **progress-bar** (`bit-io/progress-bar`, pure H#) |
| colours of `bit help` / `bit --version` | **colors** (`bit-io/colors`, pure H#: named colours, gradients; honours `NO_COLOR`, `TERM=dumb`, `COLORTERM`, downgrades to 256/16 colours) |
| JSON | H# `std -> json` (in compiled H# it reads flat objects only, so `bit.lock` is JSON Lines and the index is cut into one chunk per library before `json::get_str`) |

`scripts/bootstrap-ci.sh` sets everything up: it installs H# with the official
`install-utils.sh` + `install.sh` from the H-Sharp repository, puts hk-parser, progress-bar, nidus and colors in
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

The diagnostics are produced in a **child process** (`bit __hk-diag <Bit.hk>`, an internal command), so a failure in
the renderer can never take `bit` down: if the nidus child fails, bit falls back to a plain layout (`bit __hk-lint`),
and as a last resort prints a single line. `BIT_HK_DIAG=inproc` renders in-process instead — handy when debugging
the renderer itself.
