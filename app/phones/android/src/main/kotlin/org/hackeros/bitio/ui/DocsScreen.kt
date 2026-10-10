package org.hackeros.bitio.ui

import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import org.hackeros.bitio.markdown.MarkdownParser
import org.hackeros.bitio.markdown.MdBlockView

/** The docs page of bit.io, rendered natively from Markdown. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DocsScreen() {
    val blocks = remember { MarkdownParser.parse(DOCS_MARKDOWN) }
    Scaffold(
        contentWindowInsets = WindowInsets(0, 0, 0, 0),
        topBar = { TopAppBar(title = { Text("Docs", fontWeight = FontWeight.Bold) }) },
    ) { inner ->
        LazyColumn(
            Modifier.fillMaxSize().padding(inner),
            contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp),
        ) {
            itemsIndexed(blocks) { _, b -> MdBlockView(b) }
        }
    }
}

private val DOCS_MARKDOWN = """
# bit docs

bit is the package manager for H#, Hacker Lang and HackerScript. It is written 100% in H# and statically linked.

## Quick start

```
bit init myapp --lang h#     # or hl, hs
cd myapp
bit                          # does everything Bit.hk describes
```

A bare `bit` reads `Bit.hk`, installs the missing dependencies, builds with `[default-build]` and, if you asked for it, runs the result.

## Bit.hk

```
[package]
-> name        => myapp
-> version     => 0.1.0
-> lang        => h#            ;; h# | hl | hs   (several: h#, hs)

[build]
-> link   => static             ;; the only mode
-> target => h#                 ;; language toolchain (or a platform like linux-aarch64)

[lib]
-> output => hlib               ;; hlib | so | a | obj

[default-build]                 ;; what a bare `bit` does
-> profile => release
-> run     => true

[dependencies]
-> mold => *
-> tui  => rev v1.0
-> mine => path ../mine

[commands]                      ;; your own `bit deploy`
-> deploy => scp cache/build/release/myapp server:/opt/
--> description => Copy the release build to the server
```

## Sections

| Section | Purpose |
| --- | --- |
| [package] | name, version, description, authors, license, lang |
| [layout] | where the code is. Auto-detected: src/ = H#, cmd/ + lib/ = HackerScript. Hacker Lang needs hl-entry. |
| [edition] | H# only: edition (default edition for files without using) and toolchain (minimum h# --version) |
| [directories] | file (default, home, root, project: where libraries live) and before-build |
| [build] | target (h#, hl, hs), platform, link (static), mem-mode, flags |
| [lib] | library output: hlib (default), so, a, obj |
| [default-build] | profile, target, platform, emit, run, args, before, after |
| [dependencies] | *, rev X, git URL [rev], path DIR |
| [commands] | custom commands, run as bit NAME (extra args are appended or fill {args}) |
| [hooks] | pre-build, post-build |
| [workspace] | members: the workspace root's cache/ is shared |

## Where things live

| Path | What |
| --- | --- |
| ~/.hackeros/libs/NAME/COMMIT/ | installed libraries (current points to the active commit) |
| ~/.hackeros/bit/bit.lock | what is installed, with checksums |
| PROJECT/cache/ | build outputs and links (no build/ directory) |
| PROJECT/Bit.lock | the commits and checksums your project resolved to: commit it |

## Statically linked, checksummed

Every library is built and linked statically; `link => dynamic` and `extern dynamic` are rejected. On install, bit hashes the library's files (sha256 over the sorted per-file hashes, independent of install location) and stores the result in `bit.lock`. `bit verify` re-checks it, and a `Bit.lock` pin that no longer matches fails the build instead of being trusted.

## Library pages in this app

Every library has an **Overview** (rendered README, the pinned revision, compatibility, dependencies and GitHub stats), a **Source** browser and **Versions** (GitHub releases, with a button to view the library at that version).

Pages read from GitHub's API only when you open a library. Add a personal token in Settings to raise the 60 requests/hour limit. Everything you open is saved on the device, so it keeps working offline.

## Commands

```
bit init [name] [--lang h#|hl|hs] [--lib]
bit build [--release] [--target h#|hl|hs] [--platform linux-aarch64] [--emit bin|hlib|so|a|obj]
bit run [-- args]        bit check        bit clean [--all]
bit install [name|git-url] [--output hlib|so|a|obj] [--no-build]
bit add NAME [rev]       bit remove NAME  bit upgrade [name]
bit search [text|all] [--lang hl]   bit info NAME   bit list
bit update       bit verify       bit doctor      bit langs
bit publish      bit commands     bit x CUSTOM
```

## Publishing a library

There is no upload step. Run `bit publish` in your library: it validates `Bit.hk` and prints an index entry. Add it to `index/repository.json` and open a pull request; CI checks it before it lands.

```
{
  "name": "mylib",
  "target": "https://github.com/you/mylib",
  "description": "What it does.",
  "tags": ["tui"],
  "lang": "hsharp",
  "author": "You"
}
```
""".trimIndent()
