import Foundation

/// Block-level model of a Markdown document - rendered by native SwiftUI views (no WebView).
indirect enum MdBlock {
    case heading(level: Int, text: String)
    case paragraph(String)
    case code(lang: String, code: String)
    case quote([MdBlock])
    case item(depth: Int, marker: String, text: String, checked: Bool?)
    case table(header: [String], rows: [[String]])
    case rule
}

enum MarkdownParser {
    private static let fence = Rx(#"^\s{0,3}(`{3,}|~{3,})\s*([^`]*)$"#)
    private static let heading = Rx(#"^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$"#)
    private static let rule = Rx(#"^\s{0,3}([-*_])(\s*\1){2,}\s*$"#)
    private static let listItem = Rx(#"^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$"#)
    private static let tableSep = Rx(#"^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$"#)
    private static let task = Rx(#"^\[( |x|X)\]\s+(.*)$"#)

    private static let htmlComment = Rx(#"<!--.*?-->"#)
    private static let htmlBr = Rx(#"<br\s*/?>"#, [.caseInsensitive])
    private static let htmlImg = Rx(#"<img\b[^>]*?alt="([^"]*)"[^>]*>"#, [.caseInsensitive])
    private static let htmlTag = Rx(#"</?[a-zA-Z][a-zA-Z0-9]*(\s[^>]*)?/?>"#)

    static func parse(_ source: String) -> [MdBlock] {
        let text = source.replacingOccurrences(of: "\r\n", with: "\n").replacingOccurrences(of: "\r", with: "\n")
        let lines = text.components(separatedBy: "\n")
        return parseLines(preprocess(lines), depth: 0)
    }

    /// Raw HTML is not rendered: tags are dropped and their text kept.
    static func stripHtml(_ line: String) -> String {
        guard line.contains("<") else { return line }
        var s = htmlComment.replace(line, with: "")
        s = htmlBr.replace(s, with: "\n")
        s = htmlImg.replace(s, with: "![$1](x)")
        s = htmlTag.replace(s, with: "")
        return s
    }

    /// HTML is stripped outside fenced code; a `<br>` becomes a real line break.
    private static func preprocess(_ lines: [String]) -> [String] {
        var out: [String] = []
        out.reserveCapacity(lines.count)
        var inFence = false
        for l in lines {
            let t = l.trimmingCharacters(in: .whitespaces)
            if t.hasPrefix("```") || t.hasPrefix("~~~") {
                inFence.toggle()
                out.append(l)
            } else if inFence {
                out.append(l)
            } else {
                out.append(contentsOf: stripHtml(l).components(separatedBy: "\n"))
            }
        }
        return out
    }

    private static func parseLines(_ lines: [String], depth: Int) -> [MdBlock] {
        var out: [MdBlock] = []
        var para = ""
        var i = 0

        func flushPara() {
            let t = para.trimmingCharacters(in: .whitespacesAndNewlines)
            if !t.isEmpty { out.append(.paragraph(t)) }
            para = ""
        }

        while i < lines.count {
            let line = lines[i]

            if let f = fence.match(line) {
                flushPara()
                let marker = String(f[1].prefix(3))
                let lang = f[2].trimmingCharacters(in: .whitespaces).split(separator: " ").first.map(String.init) ?? ""
                var code: [String] = []
                i += 1
                while i < lines.count, !lines[i].trimmingCharacters(in: .whitespaces).hasPrefix(marker) {
                    code.append(lines[i])
                    i += 1
                }
                i += 1 // closing fence
                out.append(.code(lang: lang, code: code.joined(separator: "\n")))
                continue
            }
            if line.trimmingCharacters(in: .whitespaces).isEmpty {
                flushPara(); i += 1; continue
            }
            if rule.test(line) {
                flushPara(); out.append(.rule); i += 1; continue
            }
            if let h = heading.match(line) {
                flushPara()
                out.append(.heading(level: h[1].count, text: h[2]))
                i += 1; continue
            }
            if line.trimmingCharacters(in: .whitespaces).hasPrefix(">") {
                flushPara()
                var q: [String] = []
                while i < lines.count, lines[i].trimmingCharacters(in: .whitespaces).hasPrefix(">") {
                    var s = lines[i].trimmingCharacters(in: .whitespaces)
                    s.removeFirst()
                    if s.hasPrefix(" ") { s.removeFirst() }
                    q.append(s)
                    i += 1
                }
                if depth < 4 {
                    out.append(.quote(parseLines(q, depth: depth + 1)))
                } else {
                    out.append(.quote([.paragraph(q.joined(separator: " "))]))
                }
                continue
            }
            if line.contains("|"), i + 1 < lines.count, lines[i + 1].contains("-"), tableSep.test(lines[i + 1]) {
                flushPara()
                let header = splitRow(line)
                i += 2
                var rows: [[String]] = []
                while i < lines.count, !lines[i].trimmingCharacters(in: .whitespaces).isEmpty, lines[i].contains("|") {
                    let r = splitRow(lines[i])
                    rows.append((0..<header.count).map { $0 < r.count ? r[$0] : "" })
                    i += 1
                }
                out.append(.table(header: header, rows: rows))
                continue
            }
            if let li = listItem.match(line) {
                flushPara()
                let indent = li[1].replacingOccurrences(of: "\t", with: "    ").count
                let marker = (li[2].first?.isNumber == true) ? li[2] : "•"
                var text = li[3]
                var checked: Bool?
                if let tm = task.match(text) {
                    checked = tm[1] != " "
                    text = tm[2]
                }
                i += 1
                // continuation lines of the same item
                while i < lines.count {
                    let nxt = lines[i]
                    if nxt.trimmingCharacters(in: .whitespaces).isEmpty || listItem.test(nxt) || heading.test(nxt) || fence.test(nxt) { break }
                    if !nxt.hasPrefix(" ") && !nxt.hasPrefix("\t") { break }
                    text += " " + nxt.trimmingCharacters(in: .whitespaces)
                    i += 1
                }
                out.append(.item(depth: indent / 2, marker: marker, text: text, checked: checked))
                continue
            }
            if !para.isEmpty { para += " " }
            para += line.trimmingCharacters(in: .whitespaces)
            i += 1
        }
        flushPara()
        return out
    }

    private static func splitRow(_ row: String) -> [String] {
        var t = row.trimmingCharacters(in: .whitespaces)
        if t.hasPrefix("|") { t.removeFirst() }
        if t.hasSuffix("|") { t.removeLast() }
        return t.components(separatedBy: "|").map { $0.trimmingCharacters(in: .whitespaces) }
    }
}

enum InlineMarkdown {
    /// Inline Markdown (bold, italic, code, strike, links) via Foundation. Only http(s) links stay clickable.
    static func render(_ s: String) -> AttributedString {
        let options = AttributedString.MarkdownParsingOptions(
            allowsExtendedAttributes: false,
            interpretedSyntax: .inlineOnlyPreservingWhitespace,
            failurePolicy: .returnPartiallyParsedIfPossible
        )
        guard var result = try? AttributedString(markdown: s, options: options) else { return AttributedString(s) }
        let snapshot = result
        for run in snapshot.runs {
            if let url = run.link {
                let scheme = url.scheme?.lowercased()
                if scheme != "https" && scheme != "http" { result[run.range].link = nil }
            }
        }
        return result
    }
}
