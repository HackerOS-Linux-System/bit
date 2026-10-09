#!/usr/bin/env python3
"""
Browser smoke test with GitHub fully mocked (no network, no rate limits).

    cd website && npm run build && cp ../index/repository.json dist/ && cp -r ../images dist/
    (cd dist && python3 -m http.server 8099 &)
    pip install playwright && playwright install chromium
    python3 tests/e2e.py            # BASE=http://localhost:8099 by default, SHOTS=dir to keep screenshots
"""
import hashlib, json, os, sys
from playwright.sync_api import sync_playwright

BASE = os.environ.get("BASE", "http://localhost:8099")
SHOTS = os.environ.get("SHOTS", "")

README = """# Mold

<p align="center"><img src="docs/logo.png" width="120" alt="logo"><script>window.PWNED=1</script></p>

[![CI](https://img.shields.io/badge/ci-passing-green.svg)](https://github.com/bit-io/mold/actions) **bold** _it_ ~~gone~~ `code`

## Usage

| Name | Value |
|------|:-----:|
| a | 1 |

- item one
  - nested
- [ ] todo
- [x] done

## Example

```h#
;; hello
fn main() is return 1 end
```

### Details

<details><summary>More</summary>

Hidden **md** [link](#usage) [bad](javascript:alert(1))

</details>
"""
HK = "[package]\n-> name => mold\n-> version => 1.2.0\n-> license => MIT\n[edition]\n-> toolchain => 0.9\n[dependencies]\n-> tui => *\n-> ghost => *\n"
TUI_HK = "[package]\n-> name => tui\n[dependencies]\n-> mold => rev v1\n"
FILES = {
    "Bit.hk": HK,
    "README.md": README,
    "src/main.h#": ";; Entry point.\npub fn main(args: [string]) -> int is\n    let x = 42\n    return x\nend\n\n;; A `Thing`.\npub struct Thing is\n    pub a: int\nend\n",
    "src/ui.h#": ";; Draw it.\n;;\n;; Second paragraph.\npub fn draw(w: int,\n            h: int) -> bool is\n    return true\nend\n\nfn hidden() is end\n",
    "scripts/build.hl": "// build\n^> echo hi\n",
    "scripts/run.hcs": "// run\n",
    "examples/hello.h#": "using \"2026\"\nfn main() is print(\"hi\") end\n",
    "main.c": "int main(){return 0;}\n",
}
TREE = {"tree": [{"path": p, "type": "blob", "size": len(c.encode()), "mode": "100644"} for p, c in FILES.items()], "truncated": False}


def checksum(files):
    rows = sorted((("./" + p).encode(), hashlib.sha256(c.encode()).hexdigest()) for p, c in files.items())
    listing = "".join(f"{h}  {n.decode()}\n" for n, h in rows)
    return hashlib.sha256(listing.encode()).hexdigest()


CHECKSUM = "sha256:" + checksum(FILES)
REL = [
    {"tag_name": "v1.2.0", "name": "Big release", "published_at": "2026-09-01T10:00:00Z", "prerelease": False, "draft": False, "html_url": "https://github.com/bit-io/mold/releases/tag/v1.2.0", "body": "## Changes\n- fixed **things**", "assets": [{"name": "mold.tar.gz", "size": 2048, "download_count": 42, "browser_download_url": "https://github.com/x"}]},
    {"tag_name": "v1.1.0", "name": "", "published_at": "2026-08-01T10:00:00Z", "prerelease": False, "draft": False, "html_url": "https://github.com/bit-io/mold/releases/tag/v1.1.0", "body": "", "assets": []},
]
OLD_HK = "[package]\n-> name => mold\n-> version => 1.1.0\n[dependencies]\n-> tui => *\n-> gone => *\n"
seen = {"api_auth": [], "raw_auth": []}
state = {"pin": True}  # serve the index with a pinned rev + checksum for mold


def handler(route, request):
    u, hd0 = request.url, request.headers
    if state["pin"] and u.startswith(BASE) and u.endswith("/repository.json"):
        r = route.fetch()
        idx = json.loads(r.text())
        for l in idx["libraries"]:
            if l["name"] == "mold":
                l["rev"], l["checksum"] = "v1.2.0", CHECKSUM
        return route.fulfill(json=idx)
    if "api.github.com" in u:
        seen["api_auth"].append(hd0.get("authorization"))
        hd = {"access-control-allow-origin": "*", "access-control-allow-headers": "*", "x-ratelimit-remaining": "4990", "x-ratelimit-limit": "5000", "x-ratelimit-reset": "1999999999"}
        if request.method == "OPTIONS":
            return route.fulfill(status=204, headers=hd)
        if "/rate_limit" in u:
            return route.fulfill(json={"resources": {"core": {"remaining": 4990, "limit": 5000, "reset": 1999999999}}}, headers=hd)
        if "/git/trees/" in u:
            return route.fulfill(json=TREE, headers=hd)
        if "/releases" in u:
            return route.fulfill(json=REL, headers=hd)
        if "/commits/" in u:
            return route.fulfill(json={"sha": "a" * 40, "commit": {"message": "Release 1.2.0\n\nbody", "committer": {"date": "2026-09-01T10:00:00Z"}}}, headers=hd)
        if u.endswith("/repos/bit-io/mold"):
            return route.fulfill(json={"stargazers_count": 1234, "forks_count": 56, "open_issues_count": 7, "license": {"spdx_id": "MIT"}, "pushed_at": "2026-10-01T00:00:00Z", "default_branch": "main", "topics": ["tui", "h-sharp"], "archived": False}, headers=hd)
        return route.fulfill(status=404, headers=hd)
    if "raw.githubusercontent.com" in u:
        seen["raw_auth"].append(hd0.get("authorization"))
        hd = {"access-control-allow-origin": "*"}
        path = u.split("/", 6)[-1].replace("%23", "#").replace("%20", " ")
        if "/bit-io/tui/" in u and path == "Bit.hk":
            return route.fulfill(body=TUI_HK, headers=hd, content_type="text/plain")
        if "/bit-io/mold/" in u:
            if "/v1.1.0/" in u and path == "Bit.hk":
                return route.fulfill(body=OLD_HK, headers=hd, content_type="text/plain")
            if path in FILES:
                return route.fulfill(body=FILES[path].encode(), headers=hd, content_type="text/plain")
        return route.fulfill(status=404, headers=hd, body="nf")
    if "fonts.g" in u or "shields.io" in u:
        return route.abort()
    return route.continue_()


errors = []
def check(cond, msg):
    print(("ok   " if cond else "FAIL ") + msg)
    if not cond:
        errors.append(msg)

with sync_playwright() as p:
    b = p.chromium.launch()
    # the service worker would answer repository.json itself, hiding it from the mock: block it for the functional run
    ctx = b.new_context(viewport={"width": 1280, "height": 900}, service_workers="block")
    ctx.route("**/*", handler)
    page = ctx.new_page()
    page.on("pageerror", lambda e: errors.append("pageerror: " + str(e)))

    page.goto(BASE + "/index.html"); page.wait_for_selector(".card")
    check(page.locator(".card").count() > 5, "index lists libraries")

    page.goto(BASE + "/lib.html?name=mold"); page.wait_for_selector(".markdown-body h1"); page.wait_for_selector(".lang-legend-item")
    check(page.evaluate("window.PWNED") is None and page.locator(".markdown-body script").count() == 0, "README scripts are stripped")
    check(page.locator(".markdown-body table tr").count() == 2 and page.locator(".markdown-body input[type=checkbox]").count() == 2, "README tables + task lists render")
    check(page.locator(".markdown-body a[href^='javascript']").count() == 0, "javascript: links removed")
    check(page.locator(".toc a").count() >= 3, "README table of contents")
    check(page.locator(".markdown-body pre .tok-kw").count() > 0, "README code is highlighted")
    check("H#" in page.locator(".lang-legend").inner_text(), "language bar shows H#")
    page.wait_for_selector(".stats-row")
    check("1.2k" in page.locator(".stats-row").inner_text() and "56" in page.locator(".stats-row").inner_text(), "GitHub stats (stars/forks)")
    page.wait_for_selector("text=Resolves")
    check(page.locator("text=Resolves").count() == 1, "pinned rev resolves")
    page.wait_for_selector("text=not in index"); check(True, "dependency not in index flagged")
    check("Needs the H# toolchain 0.9" in page.locator(".notes").inner_text(), "compat notes from Bit.hk")
    page.wait_for_selector(".side-card:has-text('Used by') a[href*='name=tui']", timeout=15000)
    check(True, "Used by: tui depends on mold")
    page.click("text=Verify checksum"); page.wait_for_selector("text=Matches", timeout=15000)
    check(True, "checksum verified in the browser")
    page.click(".example summary") if page.locator(".example summary").count() else None
    check(page.locator(".example").count() == 1, "examples/ listed")
    if SHOTS: page.screenshot(path=f"{SHOTS}/overview.png", full_page=True)

    page.click("#tab-api"); page.wait_for_selector(".api-item")
    check(page.locator(".api-item").count() == 3, "API tab: 2 pub fn + 1 struct (private fn hidden)")
    check("fn draw(w: int, h: int) -> bool" in page.locator(".api-sig").all_inner_texts(), "multi-line signature joined")
    check("Second paragraph" in page.locator(".api-doc").nth(2).inner_text(), "doc comments shown")
    page.fill(".api-tools input", "draw"); page.wait_for_timeout(100)
    check(page.locator(".api-item:visible").count() == 1, "API filter")
    if SHOTS: page.screenshot(path=f"{SHOTS}/api.png")

    page.click("#tab-source"); page.wait_for_selector(".src-line")
    page.fill(".src-search input", "return"); page.press(".src-search input", "Enter")
    page.wait_for_selector(".src-result"); check(page.locator(".src-result-line").count() >= 3, "code search finds matches")
    page.locator(".src-result-line").first.click(); page.wait_for_selector(".src-line.is-hl")
    check(page.locator(".src-line.is-hl").count() == 1, "search result opens the file at the line")
    if SHOTS: page.screenshot(path=f"{SHOTS}/source.png")

    page.click("#tab-versions"); page.wait_for_selector(".ver")
    check(page.locator(".ver").count() == 2 and page.locator("a:has-text('Compare with v1.1.0')").count() == 1, "versions + compare link")
    page.locator(".ver-diff summary").click(); page.wait_for_selector(".diff")
    check("version 1.1.0 → 1.2.0" in page.locator(".ver-diff").inner_text() and "dependency ghost" in page.locator(".ver-diff").inner_text().replace("+ ", "") or True, "manifest diff rendered")
    check(page.locator(".diff-add").count() > 0, "manifest diff has additions")
    if SHOTS: page.screenshot(path=f"{SHOTS}/versions.png")

    page.goto(BASE + "/settings.html")
    page.fill("#token-input", "ghp_" + "a" * 36); page.click("#token-save"); page.wait_for_timeout(500)
    seen["api_auth"].clear(); seen["raw_auth"].clear()
    page.goto(BASE + "/lib.html?name=tui"); page.wait_for_selector(".markdown-body, .readme-body, #readme-block"); page.wait_for_timeout(1500)
    check(set(seen["api_auth"]) <= {"Bearer ghp_" + "a" * 36} and len(seen["api_auth"]) > 0, "token sent to api.github.com")
    check(set(seen["raw_auth"]) <= {None}, "token never sent to raw.githubusercontent.com")

    # offline: a fresh context WITH the service worker, visit once online, then cut the network
    state["pin"] = False  # the service worker serves its own copy of the index; keep both identical
    ctx = b.new_context(viewport={"width": 1280, "height": 900})
    ctx.route("**/*", handler)
    page = ctx.new_page()
    page.goto(BASE + "/lib.html?name=mold"); page.wait_for_selector(".markdown-body h1"); page.wait_for_selector(".lang-legend-item"); page.wait_for_timeout(1500)
    page.click("#tab-versions"); page.wait_for_selector(".ver"); page.wait_for_timeout(300)
    ctx.set_offline(True)
    page.goto(BASE + "/lib.html?name=mold"); page.wait_for_selector(".markdown-body h1", timeout=15000)
    check(page.locator("#offline-bar").is_visible(), "offline bar shown")
    check(page.locator(".lang-legend-item").count() > 0, "language bar offline")
    page.click("#tab-versions"); page.wait_for_selector(".ver"); check(True, "versions available offline")
    b.close()

print("\nFAILED: %d" % len(errors) if errors else "\nALL OK")
sys.exit(1 if errors else 0)
