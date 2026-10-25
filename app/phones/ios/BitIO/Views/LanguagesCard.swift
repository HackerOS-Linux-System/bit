import SwiftUI

// "Languages" card: what a library is written in (like GitHub's linguist bar).
// Same extension table and colours as website/src/langcolors.ts; md / json / yml are not counted.

private let extensionToLanguage: [String: String] = [
    "h#": "H#",
    "h#i": "H# Interface",
    "hk": "hk",
    "hcs": "HackerScript",
    "hl": "Hacker Lang",
    "js": "JavaScript",
    "jsx": "JavaScript",
    "mjs": "JavaScript",
    "cjs": "JavaScript",
    "ts": "TypeScript",
    "tsx": "TypeScript",
    "py": "Python",
    "pyw": "Python",
    "java": "Java",
    "c": "C",
    "h": "C",
    "cpp": "C++",
    "cc": "C++",
    "cxx": "C++",
    "hpp": "C++",
    "hh": "C++",
    "hxx": "C++",
    "cs": "C#",
    "go": "Go",
    "rs": "Rust",
    "rb": "Ruby",
    "php": "PHP",
    "swift": "Swift",
    "kt": "Kotlin",
    "kts": "Kotlin",
    "dart": "Dart",
    "html": "HTML",
    "htm": "HTML",
    "css": "CSS",
    "sh": "Shell",
    "bash": "Shell",
    "zsh": "Shell",
    "ps1": "PowerShell",
    "psm1": "PowerShell",
    "scala": "Scala",
    "sc": "Scala",
    "hs": "Haskell",
    "lhs": "Haskell",
    "lua": "Lua",
    "pl": "Perl",
    "pm": "Perl",
    "r": "R",
    "m": "Objective-C",
    "mm": "Objective-C",
    "ex": "Elixir",
    "exs": "Elixir",
    "clj": "Clojure",
    "cljs": "Clojure",
    "cljc": "Clojure",
    "zig": "Zig",
    "ml": "OCaml",
    "mli": "OCaml",
    "erl": "Erlang",
    "hrl": "Erlang",
    "jl": "Julia",
    "vim": "Vim script",
    "vue": "Vue",
    "svelte": "Svelte",
    "asm": "Assembly",
    "s": "Assembly",
    "cr": "Crystal",
    "nim": "Nim",
    "sol": "Solidity",
]

private let languageColors: [String: UInt32] = [
    "H#": 0x9C1120,
    "H# Interface": 0xC23B4E,
    "hk": 0xFFFFFF,
    "HackerScript": 0x4B4B55,
    "Hacker Lang": 0x8250DF,
    "JavaScript": 0xF1E05A,
    "TypeScript": 0x3178C6,
    "Python": 0x3572A5,
    "Java": 0xB07219,
    "C": 0x555555,
    "C++": 0xF34B7D,
    "C#": 0x178600,
    "Go": 0x00ADD8,
    "Rust": 0xDEA584,
    "Ruby": 0x701516,
    "PHP": 0x4F5D95,
    "Swift": 0xF05138,
    "Kotlin": 0xA97BFF,
    "Dart": 0x00B4AB,
    "HTML": 0xE34C26,
    "CSS": 0x563D7C,
    "Shell": 0x89E051,
    "PowerShell": 0x012456,
    "Scala": 0xC22D40,
    "Haskell": 0x5E5086,
    "Lua": 0x000080,
    "Perl": 0x0298C3,
    "R": 0x198CE7,
    "Objective-C": 0x438EFF,
    "Elixir": 0x6E4A7E,
    "Clojure": 0xDB5855,
    "Zig": 0xEC915C,
    "OCaml": 0x3BE133,
    "Erlang": 0xB83998,
    "Julia": 0xA270BA,
    "Vim script": 0x199F4B,
    "Vue": 0x41B883,
    "Svelte": 0xFF3E00,
    "Assembly": 0x6E4C13,
    "Crystal": 0x000100,
    "Nim": 0xFFC200,
    "Solidity": 0xAA6746,
]

private struct LangShare: Identifiable {
    let name: String
    let pct: Double
    var id: String { name }
}

private func rgb(_ v: UInt32) -> Color {
    Color(red: Double((v >> 16) & 0xFF) / 255, green: Double((v >> 8) & 0xFF) / 255, blue: Double(v & 0xFF) / 255)
}

private func colorOf(_ name: String) -> Color { rgb(languageColors[name] ?? 0x8F8FA3) }

/// Swatches that vanish on a white or dark card (hk is white, HackerScript is dark grey) get an outline.
private func needsOutline(_ name: String) -> Bool { name == "hk" || name == "HackerScript" }

/// Languages by share of bytes, biggest first.
private func breakdown(_ items: [TreeItem]) -> [LangShare] {
    var totals: [String: Int] = [:]
    for item in items where !item.isDir {
        let ext = extOf(item.path)
        guard let lang = extensionToLanguage[ext] ?? extensionToLanguage[String(ext.split(separator: ".").last ?? "")] else { continue }
        totals[lang, default: 0] += item.size
    }
    let sum = Double(totals.values.reduce(0, +))
    if sum <= 0 { return [] }
    return totals.sorted { $0.value > $1.value }.map { LangShare(name: $0.key, pct: Double($0.value) / sum * 100) }
}

private struct LangBrand {
    let label: String
    let url: String
    let asset: String
    let top: Color
    let bottom: Color
    let border: Color
}

private let langBrands: [String: LangBrand] = [
    "H#": LangBrand(label: "H#", url: "https://raw.githubusercontent.com/HackerOS-Linux-System/H-Sharp/main/images/icon.png", asset: "LangHSharp",
                    top: rgb(0x2A0D12), bottom: rgb(0x0B0B0D), border: rgb(0x5C0710)),
    "HackerScript": LangBrand(label: "HackerScript", url: "https://raw.githubusercontent.com/HackerOS-Linux-System/HackerScript/main/images/icon.png", asset: "LangHackerScript",
                              top: rgb(0x3A3A42), bottom: rgb(0x1C1C21), border: rgb(0x55555F)),
    "Hacker Lang": LangBrand(label: "Hacker Lang", url: "https://raw.githubusercontent.com/HackerOS-Linux-System/Hacker-Lang/main/images/icon.png", asset: "LangHackerLang",
                             top: rgb(0x1F1536), bottom: rgb(0x0B0B0D), border: rgb(0x3D2A6B)),
]

/// "H# leads this repo" with the project's own icon (downloaded from GitHub; bundled copy while loading / offline).
private struct LeadBadge: View {
    let brand: LangBrand
    let pct: Double

    var body: some View {
        HStack(spacing: 10) {
            AsyncImage(url: URL(string: brand.url)) { phase in
                if let img = phase.image {
                    img.resizable().scaledToFit()
                } else {
                    Image(brand.asset).resizable().scaledToFit()
                }
            }
            .frame(width: 36, height: 36)
            .clipShape(RoundedRectangle(cornerRadius: 8))
            VStack(alignment: .leading, spacing: 1) {
                Text("\(brand.label) leads this repo").font(.footnote.weight(.bold)).foregroundColor(.white)
                Text(String(format: "%.1f%% of tracked bytes", pct)).font(.caption2).foregroundColor(Color(white: 0.66))
            }
            Spacer()
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 8)
        .background(LinearGradient(colors: [brand.top, brand.bottom], startPoint: .topLeading, endPoint: .bottomTrailing), in: RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(brand.border, lineWidth: 1))
    }
}

struct LanguagesCard: View {
    let gh: GithubRepo
    let ref: String

    @EnvironmentObject private var repo: BitRepository
    @State private var shares: [LangShare] = []
    @State private var truncated = false

    private var shown: [LangShare] { Array(shares.prefix(6)) }
    private var otherPct: Double { shares.dropFirst(6).reduce(0) { $0 + $1.pct } }
    private let otherColor = Color(red: 0x8F / 255, green: 0x8F / 255, blue: 0xA3 / 255)

    var body: some View {
        Group {
            if let first = shares.first {
                VStack(alignment: .leading, spacing: 8) {
                    if let brand = langBrands[first.name] { LeadBadge(brand: brand, pct: first.pct) }
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Languages").font(.footnote.weight(.semibold))
                        GeometryReader { geo in
                            HStack(spacing: 0) {
                                ForEach(shown) { s in
                                    Rectangle().fill(colorOf(s.name)).frame(width: max(2, geo.size.width * s.pct / 100))
                                }
                                if otherPct > 0 { Rectangle().fill(otherColor).frame(width: max(2, geo.size.width * otherPct / 100)) }
                                Spacer(minLength: 0)
                            }
                        }
                        .frame(height: 8)
                        .background(Color(.systemFill))
                        .clipShape(Capsule())
                        FlowLayout(spacing: 12) {
                            ForEach(shown) { s in legend(s.name, s.pct, colorOf(s.name), outline: needsOutline(s.name)) }
                            if otherPct > 0 { legend("Other", otherPct, otherColor, outline: false) }
                        }
                        if truncated {
                            Text("Large repository: GitHub truncated the file list, shares are approximate.").font(.caption2).foregroundStyle(Theme.warn)
                        }
                    }
                    .padding(12)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 12))
                }
            }
        }
        .task(id: ref) {
            shares = []
            guard case let .ok(tree, _)? = await runLoad({ try await repo.loadTree(gh, ref: ref) }) else { return }
            shares = breakdown(tree.items)
            truncated = tree.truncated
        }
    }

    private func legend(_ name: String, _ pct: Double, _ color: Color, outline: Bool) -> some View {
        HStack(spacing: 5) {
            Circle().fill(color).frame(width: 9, height: 9)
                .overlay(Circle().stroke(outline ? Color.secondary : Color.clear, lineWidth: 1))
            Text(name).font(.caption.weight(.medium))
            Text(String(format: "%.1f%%", pct)).font(.caption).foregroundStyle(.secondary)
        }
    }
}
