#!/usr/bin/env bash
# Buduje bit.io: HackerScript (mode:website) -> dist/. Wymaga `hackerc` w PATH (albo HACKERC=...) i node.
#   bash scripts/build.sh            # wynik w website/dist
#   SITE_URL=https://bit.io bash scripts/build.sh   # + adresy bezwzgledne i sitemap.xml
set -euo pipefail

cd "$(dirname "$0")/.."
HACKERC="${HACKERC:-hackerc}"
OUT="${OUT:-dist}"
command -v "$HACKERC" >/dev/null || { echo "::error::hackerc not found (set HACKERC or add it to PATH)"; exit 1; }
echo "hackerc: $("$HACKERC" --version)"

rm -rf "$OUT"
mkdir -p "$OUT"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# strona:plik-js — `hackerc website` zawsze pisze index.html + app.js, wiec kazda strone
# budujemy osobno, a potem nadajemy jej wlasne nazwy.
PAGES="index:home lib:lib about:about settings:settings"

build_page() {
  local src="$1"
  local js="$2"
  local html="$1"
  local dir="$TMP/$src"
  mkdir -p "$dir"
  # blad kompilacji bywa zglaszany tylko w tekscie (kod wyjscia 0) - sprawdzamy tez wyjscie
  if ! (cd cmd && "$HACKERC" website "$src.hcs" -o "$dir") >"$TMP/$src.log" 2>&1 \
     || grep -Eq 'hackerc-self\]|hackerc: |error\[' "$TMP/$src.log" \
     || [ ! -s "$dir/index.html" ] || [ ! -s "$dir/app.js" ]; then
    echo "::error::compiling cmd/$src.hcs failed"
    cat "$TMP/$src.log"
    return 1
  fi
  cp "$dir/app.js" "$OUT/$js.js"
  sed "s|src=\"app.js\"|src=\"$js.js\"|" "$dir/index.html" >"$OUT/$html.html"
  echo "built $html.html + $js.js ($(wc -c <"$OUT/$js.js") B)"
}

pids=()
for p in $PAGES; do
  build_page "${p%%:*}" "${p##*:}" &
  pids+=($!)
done
fail=0
for pid in "${pids[@]}"; do wait "$pid" || fail=1; done
[ "$fail" -eq 0 ] || exit 1

# statyczne pliki (404, offline, robots)
cp -r public/. "$OUT"/
# service worker - tez HackerScript (use <lang:javascript>)
if ! "$HACKERC" build cmd/sw.hcs -o "$OUT/sw.js" >"$TMP/sw.log" 2>&1 || grep -Eq 'hackerc-self\]|error\[' "$TMP/sw.log" || [ ! -s "$OUT/sw.js" ]; then
  echo "::error::compiling cmd/sw.hcs failed"; cat "$TMP/sw.log"; exit 1
fi
echo "built sw.js ($(wc -c <"$OUT/sw.js") B)"
# ten sam indeks co czyta `bit` - kopia z tej samej domeny
cp ../index/repository.json "$OUT/repository.json"
# obrazki z korzenia repozytorium
mkdir -p "$OUT/images"
cp -r ../images/. "$OUT/images/"

# strony bibliotek (lib/<nazwa>.html), sitemap.xml, robots.txt - tez HackerScript
"$HACKERC" build scripts/generate-pages.hcs -o "$TMP/generate-pages.cjs" >/dev/null
node "$TMP/generate-pages.cjs"

echo "dist: $(du -sh "$OUT" | cut -f1)"
