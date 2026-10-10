package org.hackeros.bitio.markdown

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.withLink
import androidx.compose.ui.text.withStyle
import org.hackeros.bitio.data.safeUrl

/** Block-level model of a Markdown document - rendered by native Compose widgets (no WebView). */
sealed interface MdBlock {
    data class Heading(val level: Int, val text: String) : MdBlock
    data class Paragraph(val text: String) : MdBlock
    data class Code(val lang: String, val code: String) : MdBlock
    data class Quote(val blocks: List<MdBlock>) : MdBlock
    data class Item(val depth: Int, val marker: String, val text: String, val checked: Boolean?) : MdBlock
    data class Table(val header: List<String>, val rows: List<List<String>>) : MdBlock
    data object Rule : MdBlock
}

object MarkdownParser {
    private val fence = Regex("^\\s{0,3}(```+|~~~+)\\s*([^`]*)$")
    private val heading = Regex("^\\s{0,3}(#{1,6})\\s+(.*?)\\s*#*\\s*$")
    private val rule = Regex("^\\s{0,3}([-*_])(\\s*\\1){2,}\\s*$")
    private val listItem = Regex("^(\\s*)([-*+]|\\d{1,9}[.)])\\s+(.*)$")
    private val tableSep = Regex("^\\s*\\|?\\s*:?-{1,}:?\\s*(\\|\\s*:?-{1,}:?\\s*)*\\|?\\s*$")
    private val task = Regex("^\\[( |x|X)]\\s+(.*)$")

    fun parse(source: String): List<MdBlock> {
        val lines = source.replace("\r\n", "\n").replace('\r', '\n').split("\n")
        return parseLines(preprocess(lines), 0)
    }

    /** Raw HTML is not rendered: tags are dropped and their text kept. */
    fun stripHtml(line: String): String {
        var s = line
        if (s.contains("<")) {
            s = s.replace(Regex("<!--.*?-->"), "")
            s = s.replace(Regex("<br\\s*/?>", RegexOption.IGNORE_CASE), "\n")
            s = s.replace(Regex("<img\\b[^>]*?alt=\"([^\"]*)\"[^>]*>", RegexOption.IGNORE_CASE)) { "![${it.groupValues[1]}](x)" }
            s = s.replace(Regex("</?[a-zA-Z][a-zA-Z0-9]*(\\s[^>]*)?/?>"), "")
        }
        return s
    }

    /** HTML is stripped outside fenced code; a `<br>` becomes a real line break. */
    private fun preprocess(lines: List<String>): List<String> {
        val out = ArrayList<String>(lines.size)
        var inFence = false
        for (l in lines) {
            val t = l.trimStart()
            if (t.startsWith("```") || t.startsWith("~~~")) {
                inFence = !inFence
                out += l
            } else if (inFence) {
                out += l
            } else {
                out.addAll(stripHtml(l).split("\n"))
            }
        }
        return out
    }

    private fun parseLines(lines: List<String>, depth: Int): List<MdBlock> {
        val out = ArrayList<MdBlock>()
        var i = 0
        val para = StringBuilder()

        fun flushPara() {
            val t = para.toString().trim()
            if (t.isNotEmpty()) out += MdBlock.Paragraph(t)
            para.setLength(0)
        }

        while (i < lines.size) {
            val line = lines[i]

            val f = fence.matchEntire(line)
            if (f != null) {
                flushPara()
                val marker = f.groupValues[1].substring(0, 3)
                val lang = f.groupValues[2].trim().takeWhile { !it.isWhitespace() }
                val code = StringBuilder()
                i++
                while (i < lines.size && !lines[i].trim().startsWith(marker)) {
                    code.append(lines[i]).append('\n')
                    i++
                }
                i++ // closing fence
                out += MdBlock.Code(lang, code.toString().trimEnd('\n'))
                continue
            }
            if (line.isBlank()) {
                flushPara(); i++; continue
            }
            if (rule.matches(line)) {
                flushPara(); out += MdBlock.Rule; i++; continue
            }
            val h = heading.matchEntire(line)
            if (h != null) {
                flushPara()
                out += MdBlock.Heading(h.groupValues[1].length, h.groupValues[2])
                i++; continue
            }
            if (line.trimStart().startsWith(">")) {
                flushPara()
                val q = ArrayList<String>()
                while (i < lines.size && lines[i].trimStart().startsWith(">")) {
                    q += lines[i].trimStart().removePrefix(">").removePrefix(" ")
                    i++
                }
                out += MdBlock.Quote(if (depth < 4) parseLines(q, depth + 1) else listOf(MdBlock.Paragraph(q.joinToString(" "))))
                continue
            }
            if (line.contains('|') && i + 1 < lines.size && lines[i + 1].contains('-') && tableSep.matches(lines[i + 1])) {
                flushPara()
                val header = splitRow(line)
                i += 2
                val rows = ArrayList<List<String>>()
                while (i < lines.size && lines[i].isNotBlank() && lines[i].contains('|')) {
                    val r = splitRow(lines[i])
                    rows += List(header.size) { c -> r.getOrElse(c) { "" } }
                    i++
                }
                out += MdBlock.Table(header, rows)
                continue
            }
            val li = listItem.matchEntire(line)
            if (li != null) {
                flushPara()
                val indent = li.groupValues[1].replace("\t", "    ").length
                val marker = li.groupValues[2].let { if (it[0].isDigit()) it else "•" }
                var text = li.groupValues[3]
                var checked: Boolean? = null
                val tm = task.matchEntire(text)
                if (tm != null) {
                    checked = tm.groupValues[1] != " "
                    text = tm.groupValues[2]
                }
                i++
                // continuation lines of the same item
                while (i < lines.size) {
                    val nxt = lines[i]
                    if (nxt.isBlank() || listItem.matches(nxt) || heading.matches(nxt) || fence.matches(nxt)) break
                    if (!nxt.startsWith(" ") && !nxt.startsWith("\t")) break
                    text += " " + nxt.trim()
                    i++
                }
                out += MdBlock.Item(indent / 2, marker, text, checked)
                continue
            }
            if (para.isNotEmpty()) para.append(' ')
            para.append(line.trim())
            i++
        }
        flushPara()
        return out
    }

    private fun splitRow(row: String): List<String> {
        var t = row.trim()
        if (t.startsWith("|")) t = t.substring(1)
        if (t.endsWith("|")) t = t.substring(0, t.length - 1)
        return t.split("|").map { it.trim() }
    }
}

/** Colours the inline renderer needs (taken from the Material theme by the caller). */
class InlineColors(val link: Color, val codeBackground: Color)

object InlineMarkdown {
    fun render(src: String, colors: InlineColors): AnnotatedString = buildAnnotatedString { appendInline(this, src, colors) }

    private fun isWordChar(c: Char) = c.isLetterOrDigit()

    private fun appendInline(b: AnnotatedString.Builder, s: String, colors: InlineColors) {
        val buf = StringBuilder()
        fun flush() {
            if (buf.isNotEmpty()) { b.append(buf.toString()); buf.setLength(0) }
        }
        var i = 0
        while (i < s.length) {
            val c = s[i]
            when {
                c == '\\' && i + 1 < s.length && "\\`*_{}[]()#+-.!~|<>".indexOf(s[i + 1]) >= 0 -> {
                    buf.append(s[i + 1]); i += 2
                }
                c == '`' -> {
                    val end = s.indexOf('`', i + 1)
                    if (end > i) {
                        flush()
                        b.withStyle(SpanStyle(fontFamily = FontFamily.Monospace, background = colors.codeBackground)) {
                            append(" " + s.substring(i + 1, end).trim() + " ")
                        }
                        i = end + 1
                    } else { buf.append(c); i++ }
                }
                s.startsWith("**", i) || s.startsWith("__", i) -> {
                    val m = s.substring(i, i + 2)
                    val end = s.indexOf(m, i + 2)
                    if (end > i + 2) {
                        flush()
                        b.withStyle(SpanStyle(fontWeight = FontWeight.Bold)) { appendInline(this, s.substring(i + 2, end), colors) }
                        i = end + 2
                    } else { buf.append(m); i += 2 }
                }
                s.startsWith("~~", i) -> {
                    val end = s.indexOf("~~", i + 2)
                    if (end > i + 2) {
                        flush()
                        b.withStyle(SpanStyle(textDecoration = TextDecoration.LineThrough)) { appendInline(this, s.substring(i + 2, end), colors) }
                        i = end + 2
                    } else { buf.append("~~"); i += 2 }
                }
                (c == '*' || c == '_') && i + 1 < s.length && !s[i + 1].isWhitespace() &&
                    !(c == '_' && i > 0 && isWordChar(s[i - 1])) -> {
                    val end = findClosing(s, c, i + 1)
                    if (end > i + 1) {
                        flush()
                        b.withStyle(SpanStyle(fontStyle = FontStyle.Italic)) { appendInline(this, s.substring(i + 1, end), colors) }
                        i = end + 1
                    } else { buf.append(c); i++ }
                }
                c == '!' && s.startsWith("![", i) -> {
                    val close = matchBracket(s, i + 1)
                    if (close > 0 && close + 1 < s.length && s[close + 1] == '(') {
                        val paren = matchParen(s, close + 1)
                        if (paren > 0) {
                            flush()
                            val alt = s.substring(i + 2, close).ifBlank { "image" }
                            b.withStyle(SpanStyle(fontStyle = FontStyle.Italic)) { append("[$alt]") }
                            i = paren + 1
                            continue
                        }
                    }
                    buf.append(c); i++
                }
                c == '[' -> {
                    val close = matchBracket(s, i)
                    if (close > 0 && close + 1 < s.length && s[close + 1] == '(') {
                        val paren = matchParen(s, close + 1)
                        if (paren > 0) {
                            flush()
                            val label = s.substring(i + 1, close)
                            val target = s.substring(close + 2, paren).trim().substringBefore(' ').trim('<', '>')
                            val url = safeUrl(target)
                            if (url != null) {
                                b.withLink(LinkAnnotation.Url(url, TextLinkStyles(SpanStyle(color = colors.link, textDecoration = TextDecoration.Underline)))) {
                                    appendInline(this, label, colors)
                                }
                            } else {
                                appendInline(b, label, colors)
                            }
                            i = paren + 1
                            continue
                        }
                    }
                    buf.append(c); i++
                }
                c == '<' && (s.startsWith("<http://", i) || s.startsWith("<https://", i)) -> {
                    val end = s.indexOf('>', i)
                    if (end > i) {
                        flush()
                        val url = s.substring(i + 1, end)
                        b.withLink(LinkAnnotation.Url(url, TextLinkStyles(SpanStyle(color = colors.link, textDecoration = TextDecoration.Underline)))) { append(url) }
                        i = end + 1
                    } else { buf.append(c); i++ }
                }
                (s.startsWith("http://", i) || s.startsWith("https://", i)) && (i == 0 || !isWordChar(s[i - 1])) -> {
                    var end = i
                    while (end < s.length && !s[end].isWhitespace() && s[end] != '<' && s[end] != ')' && s[end] != ']') end++
                    while (end > i && s[end - 1] in ".,;:!?") end--
                    flush()
                    val url = s.substring(i, end)
                    b.withLink(LinkAnnotation.Url(url, TextLinkStyles(SpanStyle(color = colors.link, textDecoration = TextDecoration.Underline)))) { append(url) }
                    i = end
                }
                else -> { buf.append(c); i++ }
            }
        }
        flush()
    }

    private fun findClosing(s: String, c: Char, from: Int): Int {
        var j = from
        while (j < s.length) {
            if (s[j] == '\\') { j += 2; continue }
            if (s[j] == c && !s[j - 1].isWhitespace() && !(c == '_' && j + 1 < s.length && isWordChar(s[j + 1]))) return j
            j++
        }
        return -1
    }

    /** index of the `]` matching the `[` at [open], or -1 */
    private fun matchBracket(s: String, open: Int): Int {
        var depth = 0
        var j = open
        while (j < s.length) {
            when (s[j]) {
                '\\' -> j++
                '[' -> depth++
                ']' -> { depth--; if (depth == 0) return j }
            }
            j++
        }
        return -1
    }

    /** index of the `)` matching the `(` at [open], or -1 */
    private fun matchParen(s: String, open: Int): Int {
        var depth = 0
        var j = open
        while (j < s.length) {
            when (s[j]) {
                '\\' -> j++
                '(' -> depth++
                ')' -> { depth--; if (depth == 0) return j }
            }
            j++
        }
        return -1
    }
}
