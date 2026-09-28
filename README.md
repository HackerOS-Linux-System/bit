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

[lib]
-> output => hlib                 ;; hlib (default) | so | a | obj

[default-build]                   ;; what a bare `bit` / `bit build` does
-> profile => release             ;; release | debug  (release when the section exists)
-> target  => h#
-> emit    => bin                 ;; bin | hlib | so | a | obj
-> before  => echo start
-> after   => echo done
-> run     => true                ;; run the result (args => "...")

[dependencies]
-> mold => *                      ;; newest index entry
-> tui  => rev v1.0               ;; branch / tag / commit
-> x    => git https://github.com/you/x v2
-> mine => path ../mine
--> output => a                   ;; per-dependency lib output override

[commands]                        ;; custom commands: `bit deploy`
-> deploy => scp cache/build/release/myapp server:/opt/
--> description => Copy the release build to the server
-> serve  => ./cache/build/debug/myapp --port {args}

[hooks]
-> pre-build  => ...
-> post-build => ...

[workspace]
-> members => [core, cli]
```

`[Default build]`, `[default_build]` and `[default-build]` are the same section.

## Layout — `cache/` instead of `build/`

Like virus, a project works inside `cache/` (shared by a whole workspace, found by walking up to the nearest `Bit.hk`):

```
cache/libs/     links to the libraries the project uses
cache/source/   fetched sources
cache/env/      toolchain helpers
cache/build/    outputs: cache/build/<debug|release>/
```

Libraries are installed to `~/.hackeros/libs/<name>/<commit>/` (`current` → active commit). `BIT_HOME` and `BIT_DIR` override the locations.

## Static linking, checksums

- Everything is linked statically: `h#` is never invoked with `--dynamic`, HackerScript output is built with `crt-static` for a musl target, `link => dynamic` and `extern dynamic` are rejected.
- On install bit hashes the library (`sha256` over the sorted per-file hashes, relative paths, `.git/` and `.bit/` excluded → same source, same checksum anywhere), compares it with the optional `checksum` pin from the index and records it in `~/.hackeros/bit/bit.lock`.
- The project's `Bit.lock` pins commit + checksum of every dependency; a mismatch fails the build. `bit verify` re-checks all installed libraries.

## Commands

```
bit                                   everything Bit.hk says
bit init [name] [--lang h#|hl|hs] [--lib]
bit build [--release] [--target h#|hl|hs] [--platform P] [--emit bin|hlib|so|a|obj]
bit run [-- args]     bit check       bit clean [--all]     bit cache
bit install [name|git-url ...] [--output hlib|so|a|obj] [--target h#|hl|hs] [--no-build] [--force]
bit add <name> [rev]  bit remove <name> [--global]   bit upgrade [name]
bit search [text|all] [--lang hl]     bit info <name>       bit list      bit update
bit verify [name]     bit doctor      bit langs
bit commands          bit x <name>    bit <custom>          bit publish
```

## Index

`https://github.com/HackerOS-Linux-System/bit/blob/main/index/repository.json` (fetched raw). Entry:

```json
{ "name": "mold", "target": "https://github.com/…", "description": "…", "tags": [], "author": "…",
  "lang": "hsharp", "rev": "v1.2", "checksum": "sha256:…" }
```

`lang`, `rev`, `checksum` are optional. Env overrides: `BIT_INDEX_FILE`, `BIT_INDEX_URL`, `BIT_EXTRA_INDEXES`.
Publish with `bit publish` (validates `Bit.hk`, prints the entry) + a pull request; CI validates the index.

## Build

```bash
h# compile src/main.h# -o cache/build/release/bit --release     # or: hl build.hl
# once you have bit:  bit
cd website && npm ci && npm run build                           # bit.io → website/dist
```

Toolchain overrides: `BIT_HSHARP`, `BIT_HL`, `BIT_HACKERC`.

## Repository

```
src/        bit (H#): main, cli, build, installer, workflow, project, index, lock, checksum, hk, json, ui, util, scaffold, commands
website/    bit.io — TypeScript, built with tsc → dist/
index/      repository.json
.github/workflows/build-website.yml
```
