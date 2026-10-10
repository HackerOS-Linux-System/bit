import Foundation

/// The three HackerOS languages (plus "any" for entries that don't say). Mirrors website/src/langs.ts.
enum Lang: String, CaseIterable, Identifiable {
    case hsharp, hackerlang, hackerscript, any

    var id: String { rawValue }

    var label: String {
        switch self {
        case .hsharp: return "H#"
        case .hackerlang: return "Hacker Lang"
        case .hackerscript: return "HackerScript"
        case .any: return "any"
        }
    }

    static let filterable: [Lang] = [.hsharp, .hackerlang, .hackerscript]

    /// Accepts every spelling people use: "h#", "H-Sharp", "hl", "Hacker Lang", "hcs"...
    static func normalize(_ raw: String?) -> Lang {
        let t = (raw ?? "").lowercased().filter { !$0.isWhitespace && $0 != "-" }
        switch t {
        case "h#", "hsharp", "hsh": return .hsharp
        case "hl", "hackerlang": return .hackerlang
        case "hs", "hcs", "hackerscript": return .hackerscript
        default: return .any
        }
    }

    static func fromTags(_ tags: [String]) -> Lang {
        for t in tags {
            let l = normalize(t)
            if l != .any { return l }
        }
        return .any
    }
}

struct GithubRepo: Hashable {
    let owner: String
    let repo: String
}

struct LibEntry: Identifiable, Hashable {
    let name: String
    let target: String
    let description: String
    let tags: [String]
    let author: String
    let lang: Lang
    let rev: String
    let checksum: String

    var id: String { name }
    var installCommand: String { "bit install \(name)" }
    var addCommand: String { "bit add \(name)" }
    var github: GithubRepo? { parseGithub(target) }
}

struct LibIndex {
    let updatedAt: String
    let libraries: [LibEntry]
}

/// `https://github.com/owner/repo(.git)` -> owner/repo
func parseGithub(_ url: String) -> GithubRepo? {
    let pattern = #"^https://github\.com/([^/\s]+)/([^/\s#?]+?)(?:\.git)?/?$"#
    guard let m = Rx(pattern).match(url.trimmingCharacters(in: .whitespaces)), m.count >= 3 else { return nil }
    return GithubRepo(owner: m[1], repo: m[2])
}

/// Only http(s) links are ever opened.
func safeURL(_ s: String) -> URL? {
    let t = s.trimmingCharacters(in: .whitespacesAndNewlines)
    guard t.hasPrefix("https://") || t.hasPrefix("http://") else { return nil }
    return URL(string: t)
}

/// Small NSRegularExpression wrapper (whole-string captures).
struct Rx {
    let re: NSRegularExpression

    init(_ pattern: String, _ options: NSRegularExpression.Options = []) {
        // all patterns are literals in this code base
        re = try! NSRegularExpression(pattern: pattern, options: options)
    }

    /// nil = no match; otherwise [whole match, group 1, group 2, ...] ("" for groups that didn't take part).
    func match(_ s: String) -> [String]? {
        let ns = s as NSString
        guard let m = re.firstMatch(in: s, options: [], range: NSRange(location: 0, length: ns.length)) else { return nil }
        return (0..<m.numberOfRanges).map { i in
            let r = m.range(at: i)
            return r.location == NSNotFound ? "" : ns.substring(with: r)
        }
    }

    func test(_ s: String) -> Bool { match(s) != nil }

    func replace(_ s: String, with template: String) -> String {
        re.stringByReplacingMatches(in: s, options: [], range: NSRange(location: 0, length: (s as NSString).length), withTemplate: template)
    }
}

// MARK: - index parsing

enum ParseError: LocalizedError {
    case invalid
    var errorDescription: String? { "The library index is not valid JSON." }
}

enum IndexParser {
    /// The hand-edited index has had trailing commas; strip them (outside strings) before parsing.
    static func stripTrailingCommas(_ text: String) -> String {
        let chars = Array(text)
        var out = String()
        out.reserveCapacity(chars.count)
        var inStr = false
        var i = 0
        while i < chars.count {
            let c = chars[i]
            if inStr {
                out.append(c)
                if c == "\\", i + 1 < chars.count {
                    i += 1
                    out.append(chars[i])
                } else if c == "\"" {
                    inStr = false
                }
            } else if c == "\"" {
                inStr = true
                out.append(c)
            } else if c == "," {
                var j = i + 1
                while j < chars.count, chars[j].isWhitespace { j += 1 }
                if j >= chars.count || (chars[j] != "}" && chars[j] != "]") { out.append(c) }
            } else {
                out.append(c)
            }
            i += 1
        }
        return out
    }

    static func parse(_ text: String) throws -> LibIndex {
        let cleaned = stripTrailingCommas(text).trimmingCharacters(in: .whitespacesAndNewlines)
        guard let data = cleaned.data(using: .utf8) else { throw ParseError.invalid }
        let json = try JSONSerialization.jsonObject(with: data)
        var list: [Any] = []
        var updated = ""
        if let arr = json as? [Any] {
            list = arr
        } else if let obj = json as? [String: Any] {
            list = obj["libraries"] as? [Any] ?? []
            updated = obj["updated_at"] as? String ?? ""
        } else {
            throw ParseError.invalid
        }
        var libs: [LibEntry] = []
        for item in list {
            guard let o = item as? [String: Any] else { continue }
            let name = o["name"] as? String ?? ""
            if name.isEmpty { continue }
            let tags = (o["tags"] as? [Any] ?? []).compactMap { $0 as? String }.filter { !$0.isEmpty }
            let explicit = Lang.normalize(o["lang"] as? String)
            var target = o["target"] as? String ?? ""
            if target.isEmpty { target = o["url"] as? String ?? "" }
            if target.isEmpty { target = o["git"] as? String ?? "" }
            libs.append(LibEntry(
                name: name,
                target: target,
                description: o["description"] as? String ?? "",
                tags: tags,
                author: o["author"] as? String ?? "",
                lang: explicit != .any ? explicit : Lang.fromTags(tags),
                rev: o["rev"] as? String ?? "",
                checksum: o["checksum"] as? String ?? ""
            ))
        }
        libs.sort { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
        return LibIndex(updatedAt: updated, libraries: libs)
    }
}

// MARK: - Bit.hk

/// Parsed `Bit.hk`: section -> key -> value (`--> sub` entries become "key.sub"), keys keep their file order.
struct HkDoc {
    var sections: [String: [String: String]] = [:]
    var order: [String: [String]] = [:]

    subscript(section: String) -> [String: String] { sections[section] ?? [:] }
    func keys(_ section: String) -> [String] { order[section] ?? [] }
}

enum Hk {
    static func parse(_ source: String) -> HkDoc {
        var doc = HkDoc()
        var section = ""
        var lastKey = ""
        let text = source.replacingOccurrences(of: "\r", with: "")
        for raw in text.split(separator: "\n", omittingEmptySubsequences: false) {
            let line = raw.trimmingCharacters(in: .whitespaces)
            if line.isEmpty || line.hasPrefix(";;") || line.hasPrefix("!") || line.hasPrefix("#") { continue }

            if line.hasPrefix("["), line.hasSuffix("]"), line.count > 2 {
                section = normSection(String(line.dropFirst().dropLast()))
                lastKey = ""
                if doc.sections[section] == nil { doc.sections[section] = [:]; doc.order[section] = [] }
                continue
            }
            if section.isEmpty { continue }

            var body = line
            var sub = false
            if body.hasPrefix("-->") {
                body = String(body.dropFirst(3)).trimmingCharacters(in: .whitespaces)
                sub = true
            } else if body.hasPrefix("->") {
                body = String(body.dropFirst(2)).trimmingCharacters(in: .whitespaces)
            }

            var key: String
            var value = ""
            if let arrow = body.range(of: "=>") {
                key = String(body[..<arrow.lowerBound])
                value = String(body[arrow.upperBound...])
            } else if let eq = body.firstIndex(of: "=") {
                key = String(body[..<eq])
                value = String(body[body.index(after: eq)...])
            } else {
                key = body
            }
            key = unquote(key.trimmingCharacters(in: .whitespaces))
            if key.isEmpty { continue }
            if sub, !lastKey.isEmpty { key = "\(lastKey).\(key)" } else if !sub { lastKey = key }

            if doc.sections[section]?[key] == nil { doc.order[section, default: []].append(key) }
            doc.sections[section, default: [:]][key] = unquote(stripComment(value.trimmingCharacters(in: .whitespaces)))
        }
        return doc
    }

    /// `[Default build]`, `[default_build]` and `[default-build]` are one section.
    static func normSection(_ raw: String) -> String {
        let t = raw.trimmingCharacters(in: .whitespaces).lowercased()
        return t.replacingOccurrences(of: #"[\s_]+"#, with: "-", options: .regularExpression)
    }

    private static func stripComment(_ v: String) -> String {
        let chars = Array(v)
        var inStr = false
        var i = 0
        while i + 1 < chars.count {
            if chars[i] == "\"" { inStr.toggle() }
            if !inStr, chars[i] == ";", chars[i + 1] == ";" {
                return String(chars[0..<i]).trimmingCharacters(in: .whitespaces)
            }
            i += 1
        }
        return v
    }

    private static func unquote(_ s: String) -> String {
        let t = s.trimmingCharacters(in: .whitespaces)
        if t.count >= 2, t.hasPrefix("\""), t.hasSuffix("\"") { return String(t.dropFirst().dropLast()) }
        return t
    }

    static func list(_ value: String?) -> [String] {
        guard var t = value?.trimmingCharacters(in: .whitespaces), !t.isEmpty else { return [] }
        if t.hasPrefix("["), t.hasSuffix("]") { t = String(t.dropFirst().dropLast()) }
        return t.split(separator: ",").map { unquote(String($0)) }.filter { !$0.isEmpty }
    }
}

struct DepSpec: Identifiable {
    let name: String
    let spec: String
    var id: String { name }
}

enum DepKind { case index, git, path, unknown }

/// `[dependencies]` of a manifest: `-> mold => *`, `-> x => git URL v1`, or a `--> path => ../x` map.
func dependenciesOf(_ doc: HkDoc?) -> [DepSpec] {
    guard let doc = doc else { return [] }
    let deps = doc["dependencies"]
    return doc.keys("dependencies").filter { !$0.contains(".") }.map { name in
        let own = deps[name] ?? ""
        let subs = doc.keys("dependencies")
            .filter { $0.hasPrefix(name + ".") }
            .map { "\($0.dropFirst(name.count + 1))=\(deps[$0] ?? "")" }
        return DepSpec(name: name, spec: own.isEmpty ? subs.joined(separator: ", ") : own)
    }
}

func classifyDep(_ d: DepSpec, _ libs: [LibEntry]) -> (DepKind, LibEntry?) {
    if d.spec.hasPrefix("git ") || d.spec.hasPrefix("http://") || d.spec.hasPrefix("https://") { return (.git, nil) }
    if d.spec.hasPrefix("path") { return (.path, nil) }
    if let lib = libs.first(where: { $0.name.caseInsensitiveCompare(d.name) == .orderedSame }) { return (.index, lib) }
    return (.unknown, nil)
}

struct CompatNote: Identifiable {
    let ok: Bool
    let text: String
    var id: String { text }
}

/// Things worth knowing before depending on a library, read from its manifest.
func compatNotes(_ entry: LibEntry, _ doc: HkDoc, _ libs: [LibEntry]) -> [CompatNote] {
    var notes: [CompatNote] = []
    if let v = doc["edition"]["toolchain"], !v.isEmpty {
        notes.append(CompatNote(ok: true, text: "Needs the H# toolchain \(v) or newer (h# --version)."))
    }
    if let v = doc["edition"]["edition"], !v.isEmpty {
        notes.append(CompatNote(ok: true, text: "Edition \(v) (files without using \"<year>\" use it)."))
    }
    if let link = doc["build"]["link"], !link.isEmpty, link != "static" {
        notes.append(CompatNote(ok: false, text: "[build] link => \(link) - bit only links statically and rejects this."))
    }
    if let p = doc["build"]["platform"], !p.isEmpty {
        notes.append(CompatNote(ok: true, text: "Cross-compiles for \(p)."))
    }
    if let n = doc["package"]["name"], !n.isEmpty, n.caseInsensitiveCompare(entry.name) != .orderedSame {
        notes.append(CompatNote(ok: false, text: "The manifest calls this package \"\(n)\", the index calls it \"\(entry.name)\"."))
    }
    for d in dependenciesOf(doc) where classifyDep(d, libs).0 == .unknown {
        notes.append(CompatNote(ok: false, text: "Dependency \"\(d.name)\" is not in the index (and isn't a git/path dependency)."))
    }
    return notes
}

// MARK: - GitHub entities

struct RepoMeta {
    let stars: Int
    let forks: Int
    let openIssues: Int
    let license: String
    let pushedAt: String
    let homepage: String
    let archived: Bool
}

struct ReleaseAsset: Identifiable {
    let name: String
    let size: Int
    let downloads: Int
    let url: String
    var id: String { name }
}

struct Release: Identifiable {
    let tag: String
    let name: String
    let date: String
    let prerelease: Bool
    let url: String
    let body: String
    let assets: [ReleaseAsset]
    var tagOnly = false
    var id: String { tag }
}

struct TreeItem: Identifiable {
    let path: String
    let isDir: Bool
    let size: Int
    var id: String { path }
}

struct RepoTree {
    let items: [TreeItem]
    let truncated: Bool
}

struct Manifest {
    let file: String
    let doc: HkDoc
}

struct Readme {
    let file: String
    let text: String
    let markdown: Bool
}

func formatBytes(_ n: Int) -> String {
    let f = ByteCountFormatter()
    f.countStyle = .file
    return f.string(fromByteCount: Int64(n))
}

func formatAge(_ seconds: TimeInterval) -> String {
    let s = Int(seconds)
    if s < 60 { return "just now" }
    if s < 3600 { return "\(s / 60) min ago" }
    if s < 86_400 { return "\(s / 3600) h ago" }
    return "\(s / 86_400) d ago"
}

func compactNumber(_ n: Int) -> String {
    if n >= 1000 {
        let v = String(format: "%.1f", Double(n) / 1000.0)
        return (v.hasSuffix(".0") ? String(v.dropLast(2)) : v) + "k"
    }
    return String(n)
}
