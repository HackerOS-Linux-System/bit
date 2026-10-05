#!/usr/bin/env bash
# scripts/bootstrap-ci.sh — everything a CI job needs before it can build `bit`:
#
#   1. H#  (compiler + std) and the bytes/vira/fast utils, installed with the
#      official scripts from the H-Sharp repository:
#         install-remove/Every-Linux/install-utils.sh
#         install-remove/Every-Linux/install.sh
#   2. the two libraries bit is built on, from bit.io:
#         hk-parser     (.hk manifests; Rust staticlib with a C ABI → libhk_parser.a)
#         progress-bar  (pure H#)
#      They are placed where the H# compiler resolves `use "bytes -> <name>"`:
#         ~/.hackeros/H#/build/cache/packages/<name>
#
# Environment (all optional):
#   HSHARP_RAW        base URL of the H-Sharp install scripts
#   HK_PARSER_REPO    default https://github.com/bit-io/hk-parser
#   PROGRESS_BAR_REPO default https://github.com/bit-io/progress-bar
#   NIDUS_REPO        default https://github.com/bit-io/nidus
#   HK_PARSER_REF / PROGRESS_BAR_REF   branch, tag or commit (default: the default branch)
#   SKIP_HSHARP=1     skip step 1 (H# already installed)
set -euo pipefail

HSHARP_RAW="${HSHARP_RAW:-https://raw.githubusercontent.com/HackerOS-Linux-System/H-Sharp/main/install-remove/Every-Linux}"
HK_PARSER_REPO="${HK_PARSER_REPO:-https://github.com/bit-io/hk-parser}"
PROGRESS_BAR_REPO="${PROGRESS_BAR_REPO:-https://github.com/bit-io/progress-bar}"
NIDUS_REPO="${NIDUS_REPO:-https://github.com/bit-io/nidus}"
PKG_CACHE="$HOME/.hackeros/H#/build/cache/packages"

say() { printf '\n==> %s\n' "$*"; }

# ── 1. H# ────────────────────────────────────────────────────────────────────
if [ "${SKIP_HSHARP:-0}" != "1" ]; then
  say "installing bytes/vira/fast (install-utils.sh)"
  curl -fsSL "$HSHARP_RAW/install-utils.sh" | bash

  say "installing H# (install.sh)"
  curl -fsSL "$HSHARP_RAW/install.sh" | bash
fi

# `curl -L … -o` inside those scripts happily saves an HTML 404 page as a
# binary, so prove the result really is an executable.
if ! command -v 'h#' >/dev/null 2>&1; then
  echo "::error::h# is not on PATH after running install.sh"; exit 1
fi
if ! head -c 4 "$(command -v 'h#')" | grep -q $'\x7fELF'; then
  echo "::error::$(command -v 'h#') is not an ELF binary (download failed?)"
  head -c 200 "$(command -v 'h#')" || true
  exit 1
fi
test -d /usr/lib/HackerOS/H#/std || { echo "::error::H# std missing in /usr/lib/HackerOS/H#/std"; exit 1; }
'h#' --help >/dev/null 2>&1 || { echo "::error::h# does not run"; exit 1; }
echo "h#: $(command -v 'h#')"

# ── 2. libraries ─────────────────────────────────────────────────────────────
fetch() { # name url ref
  local name="$1" url="$2" ref="${3:-}" dest="$PKG_CACHE/$1"
  rm -rf "$dest"; mkdir -p "$PKG_CACHE"
  if [ -n "$ref" ]; then
    git clone --quiet "$url" "$dest"; git -C "$dest" checkout --quiet "$ref"
  else
    git clone --quiet --depth=1 "$url" "$dest"
  fi
  echo "$name @ $(git -C "$dest" rev-parse --short HEAD)"
}

say "fetching hk-parser, progress-bar and nidus"
fetch hk-parser    "$HK_PARSER_REPO"    "${HK_PARSER_REF:-}"
fetch progress-bar "$PROGRESS_BAR_REPO" "${PROGRESS_BAR_REF:-}"
fetch nidus        "$NIDUS_REPO"        "${NIDUS_REF:-}"

# bit itself is compiled by `h#` (not by bit), so the native part of hk-parser has to
# be built here once. Projects built *with* bit do not need this: bit runs the
# library's `[build] native` command (see hk-parser's Bit.hk) before linking.
say "building libhk_parser.a (cargo)"
( cd "$PKG_CACHE/hk-parser" && cargo build --release --lib )
LIBDIR="$PKG_CACHE/hk-parser/target/release"
test -f "$LIBDIR/libhk_parser.a" || { echo "::error::libhk_parser.a was not produced"; exit 1; }
# the C ABI bit's binding expects must really be in the archive
for sym in hk_parse hk_get_string hk_keys hk_last_error; do
  nm -g "$LIBDIR/libhk_parser.a" 2>/dev/null | grep -q " T $sym\$" \
    || { echo "::error::libhk_parser.a does not export $sym — hk-parser is missing src/ffi.rs"; exit 1; }
done

# `extern static [rust, "hk_parser"]` is linked through LIBRARY_PATH
export LIBRARY_PATH="$LIBDIR${LIBRARY_PATH:+:$LIBRARY_PATH}"
if [ -n "${GITHUB_ENV:-}" ]; then
  echo "LIBRARY_PATH=$LIBRARY_PATH" >> "$GITHUB_ENV"
fi
say "bootstrap done (LIBRARY_PATH=$LIBDIR)"
