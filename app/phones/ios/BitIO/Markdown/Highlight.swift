import SwiftUI

/// Syntax highlighting for the source viewer and fenced code in READMEs.
/// Port of website/src/highlight.ts — the HackerOS languages follow their real lexers:
///   H# (.h#, .h#i), HackerScript (.hcs), Hacker Lang (.hl), hk (.hk); everything else uses a generic scanner.
enum Tok {
    case plain, com, doc, str, esc, num, kw, sec, key, op, type, fn, attr, variable, constant, module
}

struct SynToken {
    var kind: Tok
    var text: String
}

/// "src/main.h#" -> "h#", "Bit.hk" -> "hk", "Makefile" -> "" (same rule as the website).
func extOf(_ path: String) -> String {
    let name = path.split(separator: "/", omittingEmptySubsequences: false).last.map(String.init) ?? path
    guard let dot = name.firstIndex(of: "."), dot != name.startIndex else { return "" }
    return String(name[name.index(after: dot)...]).lowercased()
}

/// Markdown fence language ("h#", "hacker lang", "bash"...) -> file extension the highlighter knows.
func extForLang(_ lang: String) -> String {
    let l = lang.lowercased().trimmingCharacters(in: .whitespaces)
    switch l {
    case "hsharp", "h-sharp", "h#", "hsh": return "h#"
    case "h#i": return "h#i"
    case "hackerlang", "hacker-lang", "hacker_lang", "hacker lang", "hl": return "hl"
    case "hackerscript", "hacker-script", "hacker_script", "hacker script", "hs", "hcs": return "hcs"
    case "hk", "bit": return "hk"
    case "shell", "console", "zsh", "bash": return "sh"
    case "javascript": return "js"
    case "typescript": return "ts"
    case "python": return "py"
    case "rust": return "rs"
    case "yaml": return "yml"
    default: return l
    }
}

enum Highlighter {
    /// Files above this size are shown without colours (keeps scrolling smooth).
    static let maxChars = 120_000

    static func tokens(_ text: String, ext: String, fileName: String = "") -> [SynToken] {
        if text.count > maxChars { return [SynToken(kind: .plain, text: text)] }
        let out = Out()
        switch family(ext, fileName) {
        case "hsharp": lexCode(Array(text), hsharp, out)
        case "hackerscript": lexCode(Array(text), hackerscript, out)
        case "hackerlang": lexHackerLang(text, out)
        case "hk": lexHk(text, out)
        case "c": lexCode(Array(text), cFamily, out)
        case "hash": lexCode(Array(text), hashFamily, out)
        case "lua": lexCode(Array(text), luaFamily, out)
        case "sql": lexCode(Array(text), sqlFamily, out)
        case "html": lexCode(Array(text), htmlFamily, out)
        default: return [SynToken(kind: .plain, text: text)]
        }
        return out.toks
    }

    /// One AttributedString per line (multi-line comments keep their colour on every line).
    static func lines(_ text: String, ext: String, fileName: String = "", limit: Int = 5000) -> [AttributedString] {
        var result: [AttributedString] = []
        var current = AttributedString()
        func flush() { result.append(current); current = AttributedString() }
        outer: for t in tokens(text, ext: ext, fileName: fileName) {
            let parts = t.text.components(separatedBy: "\n")
            for (idx, part) in parts.enumerated() {
                if idx > 0 {
                    flush()
                    if result.count >= limit { break outer }
                }
                if !part.isEmpty { current += styled(part, t.kind) }
            }
        }
        if result.count < limit { flush() }
        return result
    }

    static func attributed(_ text: String, ext: String, fileName: String = "") -> AttributedString {
        var out = AttributedString()
        for t in tokens(text, ext: ext, fileName: fileName) { out += styled(t.text, t.kind) }
        return out
    }

    private static func styled(_ s: String, _ kind: Tok) -> AttributedString {
        var a = AttributedString(s)
        if let c = Theme.syntax(kind) { a.foregroundColor = c }
        return a
    }

    private static func family(_ ext: String, _ fileName: String) -> String {
        if fileName == "Makefile" || fileName == "Dockerfile" { return "hash" }
        if fileName == "Bit.hk" || fileName == "bit.hk" { return "hk" }
        switch ext {
        case "h#", "h#i": return "hsharp"
        case "hcs": return "hackerscript"
        case "hl": return "hackerlang"
        case "hk": return "hk"
        case "js", "jsx", "ts", "tsx", "mjs", "cjs", "c", "h", "cpp", "cc", "hpp", "rs", "go", "java", "cs", "swift", "kt", "kts",
             "scala", "zig", "dart", "php", "css", "json": return "c"
        case "py", "rb", "sh", "bash", "zsh", "yml", "yaml", "toml", "pl", "r", "cmake", "mk", "cfg", "ini", "gitignore": return "hash"
        case "lua": return "lua"
        case "sql": return "sql"
        case "html", "htm", "xml", "svg": return "html"
        default: return ""
        }
    }
}

extension Theme {
    /// Token colours of the website (website/public/styles.css), light and dark.
    static func syntax(_ t: Tok) -> Color? {
        switch t {
        case .plain: return nil
        case .com: return dynamic(light: 0x6B7280, dark: 0x8B93A3)
        case .doc: return dynamic(light: 0x4D7C0F, dark: 0xA3D65C)
        case .str: return dynamic(light: 0x0F7A55, dark: 0x6EE7B7)
        case .esc: return dynamic(light: 0x0891B2, dark: 0x67E8F9)
        case .num: return dynamic(light: 0xB45309, dark: 0xFBBF24)
        case .kw: return dynamic(light: 0xA21CAF, dark: 0xE879F9)
        case .sec: return dynamic(light: 0x0369A1, dark: 0x38BDF8)
        case .key: return dynamic(light: 0xBE123C, dark: 0xFB7185)
        case .op: return dynamic(light: 0x6E6E85, dark: 0x8B8B9C)
        case .type: return dynamic(light: 0x0E7490, dark: 0x5EEAD4)
        case .fn: return dynamic(light: 0x1D4ED8, dark: 0x93C5FD)
        case .attr: return dynamic(light: 0xC2410C, dark: 0xFB923C)
        case .variable: return dynamic(light: 0xBE185D, dark: 0xF472B6)
        case .constant: return dynamic(light: 0x7E22CE, dark: 0xC4B5FD)
        case .module: return dynamic(light: 0x0F766E, dark: 0x2DD4BF)
        }
    }
}

// MARK: - plumbing

private final class Out {
    var toks: [SynToken] = []

    func push(_ kind: Tok, _ text: String) {
        if text.isEmpty { return }
        if let last = toks.last, last.kind == kind {
            toks[toks.count - 1].text += text
        } else {
            toks.append(SynToken(kind: kind, text: text))
        }
    }
}

private func sub(_ c: [Character], _ a: Int, _ b: Int) -> String {
    if a >= b || a >= c.count { return "" }
    return String(c[a..<min(b, c.count)])
}

private func isAlpha(_ c: Character) -> Bool { c == "_" || (c.isASCII && c.isLetter) }
private func isDigit(_ c: Character) -> Bool { c.isASCII && c.isNumber }
private func isAlnum(_ c: Character) -> Bool { isAlpha(c) || isDigit(c) }
private func isHex(_ c: Character) -> Bool { c.isASCII && c.isHexDigit }
private func at(_ c: [Character], _ i: Int) -> Character? { i >= 0 && i < c.count ? c[i] : nil }
private func starts(_ c: [Character], _ i: Int, _ s: String) -> Bool {
    let p = Array(s)
    if i + p.count > c.count { return false }
    for k in 0..<p.count where c[i + k] != p[k] { return false }
    return true
}
private func find(_ c: [Character], _ s: String, from: Int) -> Int? {
    let p = Array(s)
    if p.isEmpty { return from }
    var i = from
    while i + p.count <= c.count {
        if c[i] == p[0] && starts(c, i, s) { return i }
        i += 1
    }
    return nil
}
private func eol(_ c: [Character], _ i: Int) -> Int {
    var j = i
    while j < c.count && c[j] != "\n" { j += 1 }
    return j
}
private func words(_ s: String) -> Set<String> { Set(s.split(whereSeparator: { $0 == " " || $0 == "\n" }).map(String.init)) }

private var rxCache: [String: NSRegularExpression] = [:]

/// Anchored full match of `pattern` against `s`; groups are nil when they did not take part.
private func rxm(_ pattern: String, _ s: String) -> [String?]? {
    let re: NSRegularExpression
    if let cached = rxCache[pattern] {
        re = cached
    } else {
        guard let made = try? NSRegularExpression(pattern: pattern) else { return nil }
        rxCache[pattern] = made
        re = made
    }
    let ns = s as NSString
    guard let m = re.firstMatch(in: s, options: [.anchored], range: NSRange(location: 0, length: ns.length)) else { return nil }
    return (0..<m.numberOfRanges).map { i in
        let r = m.range(at: i)
        return r.location == NSNotFound ? nil : ns.substring(with: r)
    }
}

private func g(_ m: [String?], _ i: Int) -> String { (i < m.count ? m[i] : nil) ?? "" }

// MARK: - code lexer

private struct CommentRule {
    let start: String
    let end: String?
    let kind: Tok
    var notFollowedBy: Character? = nil
}

private struct CodeCfg {
    var comments: [CommentRule] = []
    var quotes: Set<Character> = ["\"", "'"]
    var backtick = false
    var charLiteral = false
    /// length of the escape sequence starting at the backslash (0 = none)
    var escape: ([Character], Int) -> Int
    var kw: Set<String> = []
    var consts: Set<String> = []
    var types: Set<String> = []
    var capitals = false
    var fnDef: Set<String> = []
    var typeDef: Set<String> = []
    var attrs: ([Character], Int) -> Int = { _, _ in 0 }
    var calls = false
    /// multi-character operators, longest first; `singles` are the one-character ones
    var ops: [String]
    var singles: Set<Character>
    /// returns the new index when it consumed something
    var hook: (([Character], Int, Out, String) -> Int?)? = nil
}

private func numberLength(_ c: [Character], _ i: Int) -> Int {
    var j = i
    if c[j] == "0", let n = at(c, j + 1), n == "x" || n == "X", let h = at(c, j + 2), isHex(h) || h == "_" {
        j += 2
        while j < c.count && (isHex(c[j]) || c[j] == "_") { j += 1 }
    } else if c[j] == "0", let n = at(c, j + 1), n == "b" || n == "B", let h = at(c, j + 2), h == "0" || h == "1" || h == "_" {
        j += 2
        while j < c.count && (c[j] == "0" || c[j] == "1" || c[j] == "_") { j += 1 }
    } else {
        while j < c.count && (isDigit(c[j]) || c[j] == "_") { j += 1 }
        if let d = at(c, j), d == ".", let e = at(c, j + 1), isDigit(e) {
            j += 1
            while j < c.count && (isDigit(c[j]) || c[j] == "_") { j += 1 }
        }
        if let e = at(c, j), e == "e" || e == "E" {
            var k = j + 1
            if let s = at(c, k), s == "+" || s == "-" { k += 1 }
            if let d = at(c, k), isDigit(d) {
                while k < c.count && isDigit(c[k]) { k += 1 }
                j = k
            }
        }
    }
    // type suffix: 1u8, 2.5f32
    for suf in ["i128", "u128", "isize", "usize", "i16", "i32", "i64", "u16", "u32", "u64", "f32", "f64", "i8", "u8"] where starts(c, j, suf) {
        if let n = at(c, j + suf.count), isAlnum(n) { continue }
        j += suf.count
        break
    }
    return j - i
}

private func lexCode(_ c: [Character], _ cfg: CodeCfg, _ out: Out) {
    let n = c.count
    var i = 0
    var prev = ""
    while i < n {
        let ch = c[i]

        // comments
        var matched = false
        for rule in cfg.comments {
            if !starts(c, i, rule.start) { continue }
            let after = i + rule.start.count
            if let nf = rule.notFollowedBy, at(c, after) == nf { continue }
            let end: Int
            if let e = rule.end {
                if let close = find(c, e, from: after) { end = close + e.count } else { end = n }
            } else {
                end = eol(c, i)
            }
            out.push(rule.kind, sub(c, i, end))
            i = end
            matched = true
            break
        }
        if matched { prev = ""; continue }

        // language specific constructs
        if let hook = cfg.hook, let next = hook(c, i, out, prev) {
            i = next
            prev = ""
            continue
        }

        // strings
        if cfg.quotes.contains(ch) {
            if ch == "'" && cfg.charLiteral {
                if let len = charLiteralLength(c, i) {
                    out.push(.str, sub(c, i, i + len))
                    i += len
                } else {
                    out.push(.plain, "'")
                    i += 1
                }
                prev = ""
                continue
            }
            out.push(.str, String(ch))
            var j = i + 1
            while j < n && c[j] != ch && c[j] != "\n" {
                if c[j] == "\\" {
                    let len = cfg.escape(c, j)
                    if len > 0 {
                        out.push(.esc, sub(c, j, j + len))
                        j += len
                    } else {
                        out.push(.str, sub(c, j, j + 2))
                        j += 2
                    }
                    continue
                }
                var k = j
                while k < n && c[k] != ch && c[k] != "\n" && c[k] != "\\" { k += 1 }
                out.push(.str, sub(c, j, k))
                j = k
            }
            if j < n && c[j] == ch {
                out.push(.str, String(ch))
                j += 1
            }
            i = min(j, n)
            prev = ""
            continue
        }
        if ch == "`" && cfg.backtick {
            var j = i + 1
            while j < n && c[j] != "`" {
                if c[j] == "\\" { j += 1 }
                j += 1
            }
            let end = min(j + 1, n)
            out.push(.str, sub(c, i, end))
            i = end
            prev = ""
            continue
        }

        // attributes / annotations
        let alen = cfg.attrs(c, i)
        if alen > 0 {
            out.push(.attr, sub(c, i, i + alen))
            i += alen
            prev = ""
            continue
        }

        // numbers
        if isDigit(ch) && !(at(c, i - 1).map(isAlnum) ?? false) {
            let len = numberLength(c, i)
            if len > 0 {
                out.push(.num, sub(c, i, i + len))
                i += len
                prev = ""
                continue
            }
        }

        // identifiers
        if isAlpha(ch) {
            var j = i
            while j < n && isAlnum(c[j]) { j += 1 }
            let w = sub(c, i, j)
            let next = at(c, j)
            var kind = Tok.plain
            if cfg.fnDef.contains(prev) { kind = .fn }
            else if cfg.typeDef.contains(prev) { kind = .type }
            else if cfg.kw.contains(w) { kind = .kw }
            else if cfg.consts.contains(w) { kind = .constant }
            else if cfg.types.contains(w) { kind = .type }
            else if cfg.capitals && w.count > 1 && w.allSatisfy({ ($0.isASCII && $0.isUppercase) || isDigit($0) || $0 == "_" }) && w.first!.isUppercase { kind = .constant }
            else if cfg.capitals && w.first!.isASCII && w.first!.isUppercase { kind = .type }
            else if cfg.calls && (next == "(" || (next == " " && at(c, j + 1) == "(")) { kind = .fn }
            out.push(kind, w)
            i = j
            prev = w
            continue
        }

        // whitespace keeps `prev` alive; anything else resets it
        if ch == " " || ch == "\t" || ch == "\n" || ch == "\r" || ch == "\r\n" {
            out.push(.plain, String(ch))
            i += 1
            continue
        }
        if let op = cfg.ops.first(where: { starts(c, i, $0) }) {
            out.push(.op, op)
            i += op.count
        } else if cfg.singles.contains(ch) {
            out.push(.op, String(ch))
            i += 1
        } else {
            out.push(.plain, String(ch))
            i += 1
        }
        prev = ""
    }
}

/// 'a', '\n', '\x41', '\u0041' — nil when it isn't a char literal.
private func charLiteralLength(_ c: [Character], _ i: Int) -> Int? {
    guard let a = at(c, i + 1), a != "\n", a != "'" else { return nil }
    if a == "\\" {
        guard let e = at(c, i + 2), e != "\n" else { return nil }
        if e == "x", starts(c, i + 3, ""), let h1 = at(c, i + 3), let h2 = at(c, i + 4), isHex(h1), isHex(h2), at(c, i + 5) == "'" { return 6 }
        if e == "u", let h1 = at(c, i + 3), let h2 = at(c, i + 4), let h3 = at(c, i + 5), let h4 = at(c, i + 6), isHex(h1), isHex(h2), isHex(h3), isHex(h4), at(c, i + 7) == "'" { return 8 }
        return at(c, i + 3) == "'" ? 4 : nil
    }
    return at(c, i + 2) == "'" ? 3 : nil
}

// MARK: - H#

private func hsharpEscape(_ c: [Character], _ j: Int) -> Int {
    guard let n = at(c, j + 1), n != "\n" else { return 0 }
    if n == "x", let a = at(c, j + 2), let b = at(c, j + 3), isHex(a), isHex(b) { return 4 }
    if n == "u" {
        if at(c, j + 2) == "{" {
            var k = j + 3
            while let h = at(c, k), isHex(h) { k += 1 }
            if k > j + 3, at(c, k) == "}" { return k + 1 - j }
        }
        if let a = at(c, j + 2), let b = at(c, j + 3), let d = at(c, j + 4), let e = at(c, j + 5), isHex(a), isHex(b), isHex(d), isHex(e) { return 6 }
    }
    return 2
}

private func hsharpAttr(_ c: [Character], _ i: Int) -> Int {
    if c[i] == "@", let n = at(c, i + 1), isAlpha(n) {
        var j = i + 1
        while j < c.count && isAlnum(c[j]) { j += 1 }
        return j - i
    }
    if c[i] == "#", at(c, i + 1) == "[" {
        var j = i + 2
        while j < c.count && c[j] != "]" && c[j] != "\n" { j += 1 }
        if j < c.count && c[j] == "]" { return j + 1 - i }
    }
    return 0
}

private let hsharp = CodeCfg(
    comments: [
        // `///` documentation (`////` is an ordinary comment), `;;` line comment, `// ... \\` multi-line comment,
        // legacy `#` comment (anything but an attribute `#[`)
        CommentRule(start: "///", end: nil, kind: .doc, notFollowedBy: "/"),
        CommentRule(start: ";;", end: nil, kind: .com),
        CommentRule(start: "//", end: "\\\\", kind: .com),
        CommentRule(start: "#", end: nil, kind: .com, notFollowedBy: "["),
    ],
    charLiteral: true,
    escape: hsharpEscape,
    kw: words("if is then else elsif end match while for in loop do break continue return unsafe async await fn let mut struct enum trait impl pub extern mod use from as new self type arena manual using write const"),
    consts: words("true false nil"),
    types: words("int uint i8 i16 i32 i64 i128 u8 u16 u32 u64 u128 f32 f64 bool string bytes void any"),
    capitals: true,
    fnDef: words("fn"),
    typeDef: words("struct enum trait impl"),
    attrs: hsharpAttr,
    calls: true,
    ops: ["..=", "->", "=>", "::", "..", "+=", "-=", "*=", "/=", "%=", "==", "!=", "<=", ">=", "&&", "||"],
    singles: Set("+-*/%<>=!?&|^~")
)

// MARK: - HackerScript

private func hackerscriptEscape(_ c: [Character], _ j: Int) -> Int {
    if let n = at(c, j + 1), "ntr\\\"'0e".contains(n) { return 2 }
    return 0
}

private func hackerscriptAttr(_ c: [Character], _ i: Int) -> Int {
    if c[i] == "@", let n = at(c, i + 1), isAlpha(n) {
        var j = i + 1
        while j < c.count && isAlnum(c[j]) { j += 1 }
        return j - i
    }
    return 0
}

/// `get <std:io>`, `use <lang:js>`, `include <x/y>`, `native {C++}`, `$ cmd $` sandbox.
private func hackerscriptHook(_ c: [Character], _ i: Int, _ out: Out, _ prev: String) -> Int? {
    let ch = c[i]
    if ch == "<" && ["get", "use", "include", "using"].contains(prev) {
        var j = i + 1
        while j < c.count && c[j] != ">" && c[j] != "\n" { j += 1 }
        if j < c.count && c[j] == ">" {
            out.push(.module, sub(c, i, j + 1))
            return j + 1
        }
    }
    if ch == "{" && prev == "native" {
        var j = i + 1
        while j < c.count && c[j] != "}" && c[j] != "\n" { j += 1 }
        if j < c.count && c[j] == "}" {
            out.push(.type, sub(c, i, j + 1))
            return j + 1
        }
    }
    if ch == "$" && at(c, i + 1) == " " {
        let end = eol(c, i)
        if let close = find(Array(c[i..<end]), " $", from: 1) {
            out.push(.op, "$")
            out.push(.str, sub(c, i + 1, i + close + 1))
            out.push(.op, "$")
            return i + close + 2
        }
    }
    return nil
}

private let hackerscript = CodeCfg(
    comments: [
        CommentRule(start: "!!!", end: nil, kind: .doc),
        CommentRule(start: "!!", end: nil, kind: .com),
        CommentRule(start: "!>", end: "<!", kind: .com),
    ],
    escape: hackerscriptEscape,
    kw: words("fun let const if else elif while for in return end get import using direct manual struct enum match break continue gc pub self and or not as impl include native region use async await spawn style"),
    consts: words("true false null"),
    types: words("Int Float Str Bool List Dict Option Result Self Some None Ok Err"),
    capitals: true,
    fnDef: words("fun"),
    typeDef: words("struct enum impl"),
    attrs: hackerscriptAttr,
    calls: true,
    ops: ["->", "::", "&&", "||", "+=", "-=", "*=", "/=", "%=", "==", "!=", "<=", ">="],
    singles: Set("+-*/%<>=!&|^~"),
    hook: hackerscriptHook
)

// MARK: - other files

private let cLike = words("if else for while do switch case break continue return fn func function let var const mut static struct enum union impl trait type interface class new delete import export from use using mod pub public private protected extends implements package namespace async await yield try catch finally throw throws match in as is not and or void int float double bool char string self this super extern unsafe where loop default")
private let scriptKw = words("if elif else fi then for while do done case esac in function return break continue local export source import set let end begin until unless and or not def class")
private let genericConsts = words("true false null nil None True False undefined")

private func genericEscape(_ c: [Character], _ j: Int) -> Int {
    if let n = at(c, j + 1), n != "\n" { return 2 }
    return 0
}

private func generic(_ comments: [CommentRule], kw: Set<String> = [], backtick: Bool = false, consts: Set<String> = genericConsts, html: Bool = false) -> CodeCfg {
    CodeCfg(
        comments: comments, backtick: backtick, escape: genericEscape, kw: kw, consts: consts,
        fnDef: words("fn func function def"), typeDef: words("struct enum class trait interface type"),
        ops: html ? [] : ["->", "=>", "::", "&&", "||", "==", "!=", "<=", ">="],
        singles: html ? Set("<>/=") : Set("+-*/%<>=!&|^~?")
    )
}

private let cFamily = generic([CommentRule(start: "//", end: nil, kind: .com), CommentRule(start: "/*", end: "*/", kind: .com)], kw: cLike, backtick: true)
private let hashFamily = generic([CommentRule(start: "#", end: nil, kind: .com)], kw: scriptKw)
private let luaFamily = generic([CommentRule(start: "--[[", end: "]]", kind: .com), CommentRule(start: "--", end: nil, kind: .com)], kw: scriptKw)
private let sqlFamily = generic(
    [CommentRule(start: "--", end: nil, kind: .com), CommentRule(start: "/*", end: "*/", kind: .com)],
    kw: words("select from where insert update delete create table join on group by order limit and or not null as into values set")
)
private let htmlFamily = generic([CommentRule(start: "<!--", end: "-->", kind: .com)], consts: [], html: true)

// MARK: - Hacker Lang

private let hlCmdPrefixes = ["^->", "^>>", "->>", "^>", "->", "/>", ">>", ">", "&"]

private enum Mode { case expr, shell, print }

/// `[A-Za-z0-9_]+(-[A-Za-z0-9_]+)*` starting at `i` — length (0 = none).
private func hlIdentLen(_ c: [Character], _ i: Int) -> Int {
    var j = i
    while j < c.count && isAlnum(c[j]) { j += 1 }
    if j == i { return 0 }
    while j + 1 < c.count && c[j] == "-" && isAlnum(c[j + 1]) {
        j += 1
        while j < c.count && isAlnum(c[j]) { j += 1 }
    }
    return j - i
}

private func hlName(_ s: String, _ at: Int) -> String {
    let c = Array(s)
    return sub(c, at, at + hlIdentLen(c, at))
}

private func hlString(_ out: Out, _ body: String) {
    let c = Array(body)
    out.push(.str, "\"")
    var k = 1
    while k < c.count {
        let ch = c[k]
        if ch == "\\" && k + 1 < c.count {
            out.push(.esc, sub(c, k, k + 2))
            k += 2
        } else if ch == "@", let nx = at(c, k + 1), isAlnum(nx) {
            let len = hlIdentLen(c, k + 1)
            out.push(.variable, "@" + sub(c, k + 1, k + 1 + len))
            k += 1 + len
        } else if ch == "$", let len = dollarLen(c, k, special: false) {
            out.push(.variable, sub(c, k, k + len))
            k += len
        } else {
            var e = k + 1
            while e < c.count && c[e] != "\\" && c[e] != "@" && c[e] != "$" { e += 1 }
            out.push(.str, sub(c, k, e))
            k = e
        }
    }
}

/// `$NAME`, `${...}` (and, with `special`, `$1 $? $# $$ $! $@ $*`) — length or nil.
private func dollarLen(_ c: [Character], _ i: Int, special: Bool) -> Int? {
    guard let n = at(c, i + 1) else { return nil }
    if n == "{" {
        var j = i + 2
        while j < c.count && c[j] != "}" { j += 1 }
        return j < c.count ? j + 1 - i : nil
    }
    if isAlpha(n) {
        var j = i + 1
        while j < c.count && isAlnum(c[j]) { j += 1 }
        return j - i
    }
    if special && "0123456789?#$!@*".contains(n) { return 2 }
    return nil
}

/// `-x`, `--long`, `--opt=value` — length or nil.
private func flagLen(_ c: [Character], _ i: Int) -> Int? {
    var j = i + 1
    if at(c, j) == "-" { j += 1 }
    guard let a = at(c, j), a.isASCII && a.isLetter else { return nil }
    while j < c.count && (isAlnum(c[j]) || c[j] == "-") { j += 1 }
    if at(c, j) == "=" {
        j += 1
        while j < c.count && !c[j].isWhitespace && c[j] != "\"" && c[j] != "'" { j += 1 }
    }
    return j - i
}

/// `/tmp/x`, `./a`, `~/b`, `..` — length or nil.
private func pathLen(_ c: [Character], _ i: Int) -> Int? {
    var j = i
    var dots = false
    if c[j] == "~" { j += 1 } else if c[j] == "." {
        dots = true
        j += 1
        if at(c, j) == "." { j += 1 }
    }
    if at(c, j) == "/" {
        j += 1
        while j < c.count && (isAlnum(c[j]) || ".-/*~".contains(c[j])) { j += 1 }
        return j - i
    }
    if dots && (j >= c.count || c[j].isWhitespace) { return j - i }
    return nil
}

private func hlInline(_ out: Out, _ s: String, _ mode: Mode) {
    let c = Array(s)
    let n = c.count
    var i = 0
    var wordStart = mode == .shell
    while i < n {
        let ch = c[i]

        if ch == "@", let nx = at(c, i + 1), isAlnum(nx) {
            let len = hlIdentLen(c, i + 1)
            out.push(.variable, "@" + sub(c, i + 1, i + 1 + len))
            i += 1 + len
            wordStart = false
            continue
        }
        if mode == .print {
            var j = i + 1
            while j < n && c[j] != "@" { j += 1 }
            out.push(.plain, sub(c, i, j))
            i = j
            continue
        }
        if ch == "\"" || (ch == "'" && mode == .shell) {
            var j = i + 1
            while j < n && c[j] != ch {
                if c[j] == "\\" { j += 1 }
                j += 1
            }
            let end = min(j + 1, n)
            if ch == "\"" { hlString(out, sub(c, i, end)) } else { out.push(.str, sub(c, i, end)) }
            i = end
            wordStart = false
            continue
        }
        if ch == "|" && at(c, i + 1) == ">" {
            out.push(.op, "|>")
            i += 2
            continue
        }
        if ch == "$" {
            if at(c, i + 1) == "(" {
                out.push(.op, "$(")
                i += 2
                wordStart = mode == .shell
                continue
            }
            if let len = dollarLen(c, i, special: true) {
                out.push(.variable, sub(c, i, i + len))
                i += len
                wordStart = false
                continue
            }
        }
        if ch == " " || ch == "\t" {
            out.push(.plain, String(ch))
            i += 1
            continue
        }
        if mode == .shell && ch == "-" && (i == 0 || c[i - 1] == " " || c[i - 1] == "\t"), let len = flagLen(c, i) {
            out.push(.attr, sub(c, i, i + len))
            i += len
            wordStart = false
            continue
        }
        if mode == .shell && (ch == "/" || ch == "~" || ch == "."), let len = pathLen(c, i), len > 0 {
            out.push(.module, sub(c, i, i + len))
            i += len
            wordStart = false
            continue
        }
        if isDigit(ch) && !(at(c, i - 1).map(isAlnum) ?? false) && at(c, i - 1) != "." && at(c, i - 1) != "-" {
            var j = i
            while j < n && isDigit(c[j]) { j += 1 }
            if at(c, j) == ".", let d = at(c, j + 1), isDigit(d) {
                j += 1
                while j < n && isDigit(c[j]) { j += 1 }
            }
            if !(at(c, j).map(isAlpha) ?? false) {
                out.push(.num, sub(c, i, j))
                i = j
                wordStart = false
                continue
            }
        }
        if isAlpha(ch) {
            var j = i + 1
            if mode == .shell {
                while j < n && (isAlnum(c[j]) || ".-/:=,".contains(c[j])) { j += 1 }
            } else {
                while j < n && isAlnum(c[j]) { j += 1 }
            }
            let w = sub(c, i, j)
            var kind = Tok.plain
            if w == "true" || w == "false" { kind = .constant }
            else if mode == .shell && wordStart { kind = .fn }
            else if mode == .expr && (w == "in" || w == "and" || w == "or" || w == "not") { kind = .kw }
            out.push(kind, w)
            i = j
            wordStart = false
            continue
        }
        if let two = ["&&", "||", ">>", "==", "!=", "<=", ">=", "->"].first(where: { starts(c, i, $0) }) {
            out.push(.op, two)
            i += 2
            if mode == .shell && (two == "&&" || two == "||") { wordStart = true }
            continue
        }
        if "|;<>=!+-*/%()&".contains(ch) {
            out.push(.op, String(ch))
            i += 1
            if mode == .shell && (ch == "|" || ch == ";" || ch == "(") { wordStart = true }
            continue
        }
        out.push(.plain, String(ch))
        i += 1
    }
}

/// `<main/colors> | detail` -> module path + detail.
private func importTail(_ out: Out, _ s: String) {
    let c = Array(s)
    let bar = c.firstIndex(of: "|")
    let spec = bar == nil ? s : sub(c, 0, bar!)
    let trimmed = spec.replacingOccurrences(of: "\\s+$", with: "", options: .regularExpression)
    out.push(.module, trimmed)
    out.push(.plain, String(spec.dropFirst(trimmed.count)))
    if let b = bar {
        out.push(.op, "|")
        out.push(.str, sub(c, b + 1, c.count))
    }
}

private func lexHackerLang(_ text: String, _ out: Out) {
    var inExportList = false
    for (idx, line) in text.components(separatedBy: "\n").enumerated() {
        if idx > 0 { out.push(.plain, "\n") }
        let all = Array(line)
        var leadLen = 0
        while leadLen < all.count && (all[leadLen] == " " || all[leadLen] == "\t" || all[leadLen] == "\r") { leadLen += 1 }
        out.push(.plain, sub(all, 0, leadLen))
        let sc = Array(all[leadLen...])
        let s = String(sc)
        if s.isEmpty { continue }

        func rest(_ from: Int) -> String { sub(sc, from, sc.count) }
        func ws(_ from: Int) -> Int {
            var p = from
            while p < sc.count && (sc[p] == " " || sc[p] == "\t") { p += 1 }
            return p
        }

        // body of an export list:  => name [   | item   ]
        if inExportList {
            if s.hasPrefix("]") {
                out.push(.op, "]")
                out.push(.plain, rest(1))
                inExportList = false
                continue
            }
            if s.hasPrefix(";;;") { out.push(.doc, s); continue }
            if s.hasPrefix(";;") { out.push(.com, s); continue }
            if s.hasPrefix("|") && at(sc, 1) != ">" && at(sc, 1) != "|" {
                out.push(.op, "|")
                hlInline(out, rest(1), .expr)
                continue
            }
        }

        // comments and shebang
        if s.hasPrefix("#!") { out.push(.com, s); continue }
        if s.hasPrefix("///") || s.hasPrefix(";;;") { out.push(.doc, s); continue }
        if s.hasPrefix(";;") { out.push(.com, s); continue }

        // // tool [apt-package]   — dependency declaration
        if s.hasPrefix("//") {
            out.push(.attr, "//")
            let p = ws(2)
            out.push(.plain, sub(sc, 2, p))
            let lb = sc[p...].firstIndex(of: "[")
            let name = sub(sc, p, lb ?? sc.count)
            let trimmed = name.replacingOccurrences(of: "\\s+$", with: "", options: .regularExpression)
            out.push(.module, trimmed)
            out.push(.plain, String(name.dropFirst(trimmed.count)))
            if let l = lb { out.push(.str, sub(sc, l, sc.count)) }
            continue
        }

        // # <lib>  /  # <lib> | detail      — import
        if s.hasPrefix("#") {
            out.push(.kw, "#")
            let p = ws(1)
            out.push(.plain, sub(sc, 1, p))
            importTail(out, sub(sc, p, sc.count))
            continue
        }
        // << file | detail   /   <* directory
        if s.hasPrefix("<<") || s.hasPrefix("<*") {
            out.push(.kw, sub(sc, 0, 2))
            let p = ws(2)
            out.push(.plain, sub(sc, 2, p))
            importTail(out, sub(sc, p, sc.count))
            continue
        }

        // ~> print
        if s.hasPrefix("~>") {
            out.push(.kw, "~>")
            hlInline(out, rest(2), .print)
            continue
        }

        // $( expr ) -> @var
        if s.hasPrefix("$(") {
            out.push(.kw, "$(")
            var depth = 1
            var j = 2
            while j < sc.count && depth > 0 {
                if sc[j] == "(" { depth += 1 } else if sc[j] == ")" { depth -= 1 }
                j += 1
            }
            let close = depth == 0 ? j - 1 : j
            hlInline(out, sub(sc, 2, close), .expr)
            if depth == 0 { out.push(.kw, ")") }
            hlInline(out, sub(sc, j, sc.count), .expr)
            continue
        }

        // :* goroutine
        if s.hasPrefix(":*") {
            out.push(.kw, ":*")
            if let m = rxm(#"^(\s*)([A-Za-z0-9_-]*)(\s*)(def\b)?(.*)$"#, rest(2)) {
                out.push(.plain, g(m, 1)); out.push(.fn, g(m, 2)); out.push(.plain, g(m, 3))
                out.push(.kw, g(m, 4)); out.push(.plain, g(m, 5))
            } else { out.push(.plain, rest(2)) }
            continue
        }
        // :: name <size> def   |   :: name args
        if s.hasPrefix("::") {
            out.push(.kw, "::")
            var p = ws(2)
            out.push(.plain, sub(sc, 2, p))
            let name = hlName(s, p)
            out.push(.fn, name)
            p += name.count
            let tail = sub(sc, p, sc.count)
            if let a = rxm(#"^(\s*)(<[^>\n]*>)?(\s*)(def)\b(.*)$"#, tail) {
                out.push(.plain, g(a, 1)); out.push(.num, g(a, 2)); out.push(.plain, g(a, 3))
                out.push(.kw, g(a, 4)); out.push(.com, g(a, 5))
            } else { hlInline(out, tail, .shell) }
            continue
        }
        // :name def
        if let f = rxm(#"^:(\s*)([A-Za-z0-9_-]+)(\s+)def\b(.*)$"#, s) {
            out.push(.kw, ":"); out.push(.plain, g(f, 1)); out.push(.fn, g(f, 2))
            out.push(.plain, g(f, 3)); out.push(.kw, "def"); out.push(.com, g(f, 4))
            continue
        }

        // *-- channel operation   /   *> hsh command
        if s.hasPrefix("*--") {
            out.push(.kw, "*--")
            let p = ws(3)
            out.push(.plain, sub(sc, 3, p))
            let name = hlName(s, p)
            out.push(.fn, name)
            hlInline(out, sub(sc, p + name.count, sc.count), .expr)
            continue
        }
        if s.hasPrefix("*>") {
            out.push(.kw, "*>")
            hlInline(out, rest(2), .shell)
            continue
        }

        // -- function call
        if s.hasPrefix("--") {
            out.push(.kw, "--")
            let p = ws(2)
            out.push(.plain, sub(sc, 2, p))
            let name = hlName(s, p)
            out.push(.fn, name)
            hlInline(out, sub(sc, p + name.count, sc.count), .expr)
            continue
        }

        // => export
        if s.hasPrefix("=>") {
            out.push(.kw, "=>")
            let p = ws(2)
            out.push(.plain, sub(sc, 2, p))
            let name = hlName(s, p)
            out.push(.variable, name)
            let after = sub(sc, p + name.count, sc.count)
            if let eq = rxm(#"^(\s*)(=)(.*)$"#, after) {
                out.push(.plain, g(eq, 1)); out.push(.op, "=")
                hlInline(out, g(eq, 3), .expr)
            } else if let lst = rxm(#"^(\s*)(\[)(.*)$"#, after) {
                out.push(.plain, g(lst, 1)); out.push(.op, "[")
                out.push(.plain, g(lst, 3))
                inExportList = true
            } else { out.push(.plain, after) }
            continue
        }

        // _> file [runtime] def
        if s.hasPrefix("_>") {
            out.push(.kw, "_>")
            var p = ws(2)
            out.push(.plain, sub(sc, 2, p))
            var e = p
            while e < sc.count && !sc[e].isWhitespace && sc[e] != "[" { e += 1 }
            out.push(.module, sub(sc, p, e))
            p = e
            let tail = sub(sc, p, sc.count)
            if let m = rxm(#"^(\s*)(\[[^\]\n]*\])?(\s*)(def\b)?(.*)$"#, tail) {
                out.push(.plain, g(m, 1)); out.push(.type, g(m, 2)); out.push(.plain, g(m, 3))
                out.push(.kw, g(m, 4)); out.push(.plain, g(m, 5))
            } else { out.push(.plain, tail) }
            continue
        }

        // command lines: > >> ^> ^>> -> ->> ^-> /> &
        if let prefix = hlCmdPrefixes.first(where: { s.hasPrefix($0) }) {
            out.push(.kw, prefix)
            hlInline(out, rest(prefix.count), .shell)
            continue
        }

        // % name: type = value
        if s.hasPrefix("%") {
            out.push(.kw, "%")
            var p = ws(1)
            out.push(.plain, sub(sc, 1, p))
            let name = hlName(s, p)
            out.push(.variable, name)
            p += name.count
            let tail = sub(sc, p, sc.count)
            if let m = rxm(#"^(\s*)(?::(\s*)([A-Za-z0-9_-]+))?(\s*)(=)?(.*)$"#, tail) {
                out.push(.plain, g(m, 1))
                if m[3] != nil {
                    out.push(.op, ":"); out.push(.plain, g(m, 2)); out.push(.type, g(m, 3))
                }
                out.push(.plain, g(m, 4))
                if m[5] != nil { out.push(.op, "=") }
                hlInline(out, g(m, 6), .expr)
            } else { out.push(.plain, tail) }
            continue
        }

        // @ item in list   (for)   —   any other line with @name is a variable reference
        if s.hasPrefix("@") {
            if let f = rxm(#"^@(\s*)([A-Za-z0-9_-]+)(\s+)in\b(.*)$"#, s) {
                out.push(.kw, "@"); out.push(.plain, g(f, 1)); out.push(.variable, g(f, 2))
                out.push(.plain, g(f, 3)); out.push(.kw, "in")
                hlInline(out, g(f, 4), .shell)
                continue
            }
            hlInline(out, s, .expr)
            continue
        }

        // ?~ cond   |   ? ok  |  ? err  |  ?switch x
        if s.hasPrefix("?") {
            if s.hasPrefix("?~") {
                out.push(.kw, "?~")
                hlInline(out, rest(2), .expr)
                continue
            }
            if let m = rxm(#"^\?(\s*)([A-Za-z]+)(.*)$"#, s) {
                out.push(.kw, "?"); out.push(.plain, g(m, 1)); out.push(.kw, g(m, 2))
                hlInline(out, g(m, 3), .expr)
                continue
            }
        }

        // done / using <gen 2>
        if let k = rxm(#"^(done|using)\b(.*)$"#, s) {
            out.push(.kw, g(k, 1))
            let tail = g(k, 2)
            if let gen = rxm(#"^(\s*)(<[^>\n]*>)(.*)$"#, tail) {
                out.push(.plain, g(gen, 1)); out.push(.module, g(gen, 2)); out.push(.com, g(gen, 3))
            } else { hlInline(out, tail, .expr) }
            continue
        }
        // _3 — repeat the next line three times
        if let r = rxm(#"^(_)(\d+)(?![A-Za-z0-9_])(.*)$"#, s) {
            out.push(.kw, "_"); out.push(.num, g(r, 2))
            hlInline(out, g(r, 3), .expr)
            continue
        }

        // switch arms, loose values, anything else
        hlInline(out, s, .expr)
    }
}

// MARK: - hk

private func lexHk(_ text: String, _ out: Out) {
    for (idx, line) in text.components(separatedBy: "\n").enumerated() {
        if idx > 0 { out.push(.plain, "\n") }
        let all = Array(line)
        var leadLen = 0
        while leadLen < all.count && (all[leadLen] == " " || all[leadLen] == "\t" || all[leadLen] == "\r") { leadLen += 1 }
        out.push(.plain, sub(all, 0, leadLen))
        let sc = Array(all[leadLen...])
        let s = String(sc)
        if s.isEmpty { continue }

        if s.hasPrefix("!") || s.hasPrefix(";;") { out.push(.com, s); continue }

        if let sec = rxm(#"^\[[^\]\n]*\]"#, s), let whole = sec[0] {
            out.push(.sec, whole)
            hkTail(out, String(s.dropFirst(whole.count)))
            continue
        }
        if let a = rxm(#"^(-+>)(\s*)(.*)$"#, s) {
            out.push(.op, g(a, 1))
            out.push(.plain, g(a, 2))
            let body = Array(g(a, 3))
            let sep = find(body, "=>", from: 0)
            let cmt = find(body, ";;", from: 0)
            let keyEnd: Int
            if let sp = sep, cmt == nil || sp < cmt! { keyEnd = sp } else if let cm = cmt { keyEnd = cm } else { keyEnd = body.count }
            let keyText = sub(body, 0, keyEnd)
            let key = keyText.replacingOccurrences(of: "\\s+$", with: "", options: .regularExpression)
            out.push(.key, key)
            out.push(.plain, String(keyText.dropFirst(key.count)))
            if sep != nil && keyEnd == sep! {
                out.push(.op, "=>")
                hkTail(out, sub(body, keyEnd + 2, body.count))
            } else {
                hkTail(out, sub(body, keyEnd, body.count))
            }
            continue
        }
        hkTail(out, s)
    }
}

private func hkTail(_ out: Out, _ s: String) {
    let c = Array(s)
    let n = c.count
    var i = 0
    while i < n {
        let ch = c[i]
        if ch == ";" && at(c, i + 1) == ";" {
            out.push(.com, sub(c, i, n))
            return
        }
        if ch == "\"" {
            var j = i + 1
            while j < n && c[j] != "\"" && c[j] != "\n" {
                if c[j] == "\\" { j += 1 }
                j += 1
            }
            let end = j < n && c[j] == "\"" ? j + 1 : min(j, n)
            out.push(.str, sub(c, i, end))
            i = end
            continue
        }
        if ch == "[" || ch == "]" || ch == "," {
            out.push(.op, String(ch))
            i += 1
            continue
        }
        if isDigit(ch) && !(at(c, i - 1).map(isAlnum) ?? false) {
            var j = i
            while j < n && isDigit(c[j]) { j += 1 }
            if at(c, j) == ".", let d = at(c, j + 1), isDigit(d) {
                j += 1
                while j < n && isDigit(c[j]) { j += 1 }
            }
            if !(at(c, j).map({ isAlpha($0) || $0 == "." || $0 == "-" }) ?? false) {
                out.push(.num, sub(c, i, j))
                i = j
                continue
            }
        }
        if isAlpha(ch) && ch != "_" && !(at(c, i - 1).map(isAlnum) ?? false) {
            var j = i + 1
            while j < n && isAlnum(c[j]) { j += 1 }
            let w = sub(c, i, j)
            out.push(w == "true" || w == "false" ? .constant : .plain, w)
            i = j
            continue
        }
        out.push(.plain, String(ch))
        i += 1
    }
}
