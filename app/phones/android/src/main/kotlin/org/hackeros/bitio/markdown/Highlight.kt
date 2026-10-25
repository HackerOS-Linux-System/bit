package org.hackeros.bitio.markdown

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight

/**
 * Syntax highlighting for the source viewer and fenced code in READMEs.
 * Port of website/src/highlight.ts — the HackerOS languages follow their real lexers:
 *   H# (.h#, .h#i), HackerScript (.hcs), Hacker Lang (.hl), hk (.hk); everything else uses a generic scanner.
 */
enum class Tok { PLAIN, COM, DOC, STR, ESC, NUM, KW, SEC, KEY, OP, TYPE, FN, ATTR, VAR, CONST, MOD }

class SyntaxSpan(val start: Int, val end: Int, val kind: Tok)

/** Colours of the website's token palette (website/public/styles.css). */
class SyntaxPalette(private val colors: Map<Tok, Color>) {
    fun color(t: Tok): Color? = colors[t]
}

object SyntaxColors {
    val Light = SyntaxPalette(
        mapOf(
            Tok.COM to Color(0xFF6B7280), Tok.DOC to Color(0xFF4D7C0F), Tok.STR to Color(0xFF0F7A55), Tok.ESC to Color(0xFF0891B2),
            Tok.NUM to Color(0xFFB45309), Tok.KW to Color(0xFFA21CAF), Tok.SEC to Color(0xFF0369A1), Tok.KEY to Color(0xFFBE123C),
            Tok.OP to Color(0xFF6E6E85), Tok.TYPE to Color(0xFF0E7490), Tok.FN to Color(0xFF1D4ED8), Tok.ATTR to Color(0xFFC2410C),
            Tok.VAR to Color(0xFFBE185D), Tok.CONST to Color(0xFF7E22CE), Tok.MOD to Color(0xFF0F766E),
        ),
    )
    val Dark = SyntaxPalette(
        mapOf(
            Tok.COM to Color(0xFF8B93A3), Tok.DOC to Color(0xFFA3D65C), Tok.STR to Color(0xFF6EE7B7), Tok.ESC to Color(0xFF67E8F9),
            Tok.NUM to Color(0xFFFBBF24), Tok.KW to Color(0xFFE879F9), Tok.SEC to Color(0xFF38BDF8), Tok.KEY to Color(0xFFFB7185),
            Tok.OP to Color(0xFF8B8B9C), Tok.TYPE to Color(0xFF5EEAD4), Tok.FN to Color(0xFF93C5FD), Tok.ATTR to Color(0xFFFB923C),
            Tok.VAR to Color(0xFFF472B6), Tok.CONST to Color(0xFFC4B5FD), Tok.MOD to Color(0xFF2DD4BF),
        ),
    )
}

/** "src/main.h#" -> "h#", "Bit.hk" -> "hk", "Makefile" -> "" (same rule as the website). */
fun extOf(path: String): String {
    val name = path.substringAfterLast('/')
    val dot = name.indexOf('.')
    return if (dot <= 0) "" else name.substring(dot + 1).lowercase()
}

/** Markdown fence language ("h#", "hacker lang", "bash"...) -> file extension the highlighter knows. */
fun extForLang(lang: String): String {
    val l = lang.lowercase().trim()
    return when (l) {
        "hsharp", "h-sharp", "h#", "hsh" -> "h#"
        "h#i" -> "h#i"
        "hackerlang", "hacker-lang", "hacker_lang", "hacker lang", "hl" -> "hl"
        "hackerscript", "hacker-script", "hacker_script", "hacker script", "hs", "hcs" -> "hcs"
        "hk", "bit" -> "hk"
        "shell", "console", "zsh", "bash" -> "sh"
        "javascript" -> "js"
        "typescript" -> "ts"
        "python" -> "py"
        "rust" -> "rs"
        "yaml" -> "yml"
        else -> l
    }
}

object Highlighter {
    /** Files above this size are shown without colours (keeps scrolling smooth). */
    private const val MAX_CHARS = 250_000

    fun spans(text: String, ext: String, fileName: String = ""): List<SyntaxSpan> {
        if (text.length > MAX_CHARS) return emptyList()
        val out = Out()
        when (familyFor(ext, fileName)) {
            "hsharp" -> lexCode(text, HSHARP, out)
            "hackerscript" -> lexCode(text, HACKERSCRIPT, out)
            "hackerlang" -> lexHackerLang(text, out)
            "hk" -> lexHk(text, out)
            "c" -> lexCode(text, C_FAMILY, out)
            "hash" -> lexCode(text, HASH_FAMILY, out)
            "lua" -> lexCode(text, LUA_FAMILY, out)
            "sql" -> lexCode(text, SQL_FAMILY, out)
            "html" -> lexCode(text, HTML_FAMILY, out)
            else -> return emptyList()
        }
        return out.spans()
    }

    fun annotate(text: String, ext: String, fileName: String, palette: SyntaxPalette): AnnotatedString {
        val spans = spans(text, ext, fileName)
        if (spans.isEmpty()) return AnnotatedString(text)
        return buildAnnotatedString {
            append(text)
            for (s in spans) {
                val c = palette.color(s.kind) ?: continue
                val style = when (s.kind) {
                    Tok.COM, Tok.DOC -> SpanStyle(color = c, fontStyle = FontStyle.Italic)
                    Tok.SEC, Tok.ESC -> SpanStyle(color = c, fontWeight = FontWeight.SemiBold)
                    else -> SpanStyle(color = c)
                }
                addStyle(style, s.start, s.end)
            }
        }
    }

    private fun familyFor(ext: String, fileName: String): String {
        if (fileName == "Makefile" || fileName == "Dockerfile") return "hash"
        if (fileName == "Bit.hk" || fileName == "bit.hk") return "hk"
        return when (ext) {
            "h#", "h#i" -> "hsharp"
            "hcs" -> "hackerscript"
            "hl" -> "hackerlang"
            "hk" -> "hk"
            "js", "jsx", "ts", "tsx", "mjs", "cjs", "c", "h", "cpp", "cc", "hpp", "rs", "go", "java", "cs", "swift", "kt", "kts",
            "scala", "zig", "dart", "php", "css", "json" -> "c"
            "py", "rb", "sh", "bash", "zsh", "yml", "yaml", "toml", "pl", "r", "cmake", "mk", "cfg", "ini", "gitignore" -> "hash"
            "lua" -> "lua"
            "sql" -> "sql"
            "html", "htm", "xml", "svg" -> "html"
            else -> ""
        }
    }
}

/* ------------------------------------------------------------------------------ plumbing */

private class Out {
    private val kinds = ArrayList<Tok>()
    private val lens = ArrayList<Int>()

    fun push(kind: Tok, text: String) {
        if (text.isEmpty()) return
        if (kinds.isNotEmpty() && kinds[kinds.size - 1] == kind) {
            lens[lens.size - 1] = lens[lens.size - 1] + text.length
        } else {
            kinds.add(kind)
            lens.add(text.length)
        }
    }

    fun spans(): List<SyntaxSpan> {
        val r = ArrayList<SyntaxSpan>()
        var pos = 0
        for (i in kinds.indices) {
            if (kinds[i] != Tok.PLAIN) r.add(SyntaxSpan(pos, pos + lens[i], kinds[i]))
            pos += lens[i]
        }
        return r
    }
}

private fun words(s: String): Set<String> = s.split(Regex("\\s+")).filter { it.isNotEmpty() }.toSet()

private fun isIdentChar(c: Char?): Boolean = c != null && (c.isLetterOrDigit() && c.code < 128 || c == '_')

private fun isAsciiLetter(c: Char): Boolean = (c in 'a'..'z') || (c in 'A'..'Z') || c == '_'

private val IDENT = Regex("[A-Za-z_][A-Za-z0-9_]*")

/* -------------------------------------------------------------------------- code lexer */

private class CommentRule(val start: String, val end: String?, val kind: Tok, val notFollowedBy: Char? = null)

private class CodeCfg(
    val comments: List<CommentRule>,
    val quotes: String,
    val backtick: Boolean = false,
    val charLiteral: Boolean = false,
    val escape: Regex,
    val kw: Set<String>,
    val consts: Set<String>,
    val types: Set<String>,
    val capitals: Boolean,
    val fnDef: Set<String>,
    val typeDef: Set<String>,
    val attrs: List<Regex>,
    val calls: Boolean,
    val ops: Regex,
    /** returns the new index when it consumed something, -1 otherwise */
    val hook: ((text: String, i: Int, out: Out, prev: String) -> Int)? = null,
)

private val NUM = Regex("""0[xX][0-9a-fA-F_]+|0[bB][01_]+|\d[\d_]*(?:\.\d[\d_]*)?(?:[eE][+-]?\d+)?""")
private val NUM_SUFFIX = Regex("""(?:[iu](?:8|16|32|64|128|size)|f32|f64)\b""")
private val CHAR_LIT = Regex("""'(?:\\(?:x[0-9a-fA-F]{2}|u[0-9a-fA-F]{4}|[^\n])|[^'\\\n])'""")

private fun lexCode(text: String, cfg: CodeCfg, out: Out) {
    val n = text.length
    var i = 0
    var prev = ""
    while (i < n) {
        val c = text[i]

        // comments
        var matched = false
        for (rule in cfg.comments) {
            if (!text.startsWith(rule.start, i)) continue
            val after = i + rule.start.length
            if (rule.notFollowedBy != null && after < n && text[after] == rule.notFollowedBy) continue
            val end: Int = if (rule.end == null) {
                val eol = text.indexOf('\n', i)
                if (eol == -1) n else eol
            } else {
                val close = text.indexOf(rule.end, after)
                if (close == -1) n else close + rule.end.length
            }
            out.push(rule.kind, text.substring(i, end))
            i = end
            matched = true
            break
        }
        if (matched) {
            prev = ""
            continue
        }

        // language specific constructs
        val hook = cfg.hook
        if (hook != null) {
            val next = hook(text, i, out, prev)
            if (next >= 0) {
                i = next
                prev = ""
                continue
            }
        }

        // strings
        if (cfg.quotes.indexOf(c) >= 0) {
            if (c == '\'' && cfg.charLiteral) {
                val m = CHAR_LIT.matchAt(text, i)
                if (m != null) {
                    out.push(Tok.STR, m.value)
                    i += m.value.length
                } else {
                    out.push(Tok.PLAIN, c.toString())
                    i++
                }
                prev = ""
                continue
            }
            out.push(Tok.STR, c.toString())
            var j = i + 1
            while (j < n && text[j] != c && text[j] != '\n') {
                if (text[j] == '\\') {
                    val m = cfg.escape.matchAt(text, j)
                    if (m != null) {
                        out.push(Tok.ESC, m.value)
                        j += m.value.length
                    } else {
                        out.push(Tok.STR, text.substring(j, minOf(j + 2, n)))
                        j += 2
                    }
                    continue
                }
                var k = j
                while (k < n && text[k] != c && text[k] != '\n' && text[k] != '\\') k++
                out.push(Tok.STR, text.substring(j, k))
                j = k
            }
            if (j < n && text[j] == c) {
                out.push(Tok.STR, c.toString())
                j++
            }
            i = minOf(j, n)
            prev = ""
            continue
        }
        if (c == '`' && cfg.backtick) {
            var j = i + 1
            while (j < n && text[j] != '`') {
                if (text[j] == '\\') j++
                j++
            }
            val end = minOf(j + 1, n)
            out.push(Tok.STR, text.substring(i, end))
            i = end
            prev = ""
            continue
        }

        // attributes / annotations
        var attr: MatchResult? = null
        for (re in cfg.attrs) {
            attr = re.matchAt(text, i)
            if (attr != null) break
        }
        if (attr != null) {
            out.push(Tok.ATTR, attr.value)
            i += attr.value.length
            prev = ""
            continue
        }

        // numbers
        if (c in '0'..'9' && !isIdentChar(text.getOrNull(i - 1))) {
            val m = NUM.matchAt(text, i)
            if (m != null) {
                var len = m.value.length
                val suf = NUM_SUFFIX.matchAt(text, i + len)
                if (suf != null) len += suf.value.length
                out.push(Tok.NUM, text.substring(i, i + len))
                i += len
                prev = ""
                continue
            }
        }

        // identifiers
        if (isAsciiLetter(c)) {
            val w = IDENT.matchAt(text, i)!!.value
            val next = text.getOrNull(i + w.length)
            var kind = Tok.PLAIN
            if (cfg.fnDef.contains(prev)) kind = Tok.FN
            else if (cfg.typeDef.contains(prev)) kind = Tok.TYPE
            else if (cfg.kw.contains(w)) kind = Tok.KW
            else if (cfg.consts.contains(w)) kind = Tok.CONST
            else if (cfg.types.contains(w)) kind = Tok.TYPE
            else if (cfg.capitals && w.length > 1 && w.all { it in 'A'..'Z' || it in '0'..'9' || it == '_' } && w[0] in 'A'..'Z') kind = Tok.CONST
            else if (cfg.capitals && w[0] in 'A'..'Z') kind = Tok.TYPE
            else if (cfg.calls && (next == '(' || (next == ' ' && text.getOrNull(i + w.length + 1) == '('))) kind = Tok.FN
            out.push(kind, w)
            i += w.length
            prev = w
            continue
        }

        // whitespace keeps `prev` alive; anything else resets it
        if (c == ' ' || c == '\t' || c == '\n' || c == '\r') {
            out.push(Tok.PLAIN, c.toString())
            i++
            continue
        }
        val op = cfg.ops.matchAt(text, i)
        if (op != null) {
            out.push(Tok.OP, op.value)
            i += op.value.length
        } else {
            out.push(Tok.PLAIN, c.toString())
            i++
        }
        prev = ""
    }
}

/* ------------------------------------------------------------------------------ H# */

private val HSHARP = CodeCfg(
    comments = listOf(
        // `///` documentation (`////` is an ordinary comment), `;;` line comment, `// ... \\` multi-line comment,
        // legacy `#` comment (anything but an attribute `#[`)
        CommentRule("///", null, Tok.DOC, notFollowedBy = '/'),
        CommentRule(";;", null, Tok.COM),
        CommentRule("//", "\\\\", Tok.COM),
        CommentRule("#", null, Tok.COM, notFollowedBy = '['),
    ),
    quotes = "\"'",
    charLiteral = true,
    escape = Regex("""\\(?:x[0-9a-fA-F]{2}|u[0-9a-fA-F]{4}|u\{[0-9a-fA-F]+\}|[^\n])"""),
    kw = words(
        "if is then else elsif end match while for in loop do break continue return unsafe async await fn let mut struct enum trait impl pub extern mod use from as new self type arena manual using write const",
    ),
    consts = words("true false nil"),
    types = words("int uint i8 i16 i32 i64 i128 u8 u16 u32 u64 u128 f32 f64 bool string bytes void any"),
    capitals = true,
    fnDef = words("fn"),
    typeDef = words("struct enum trait impl"),
    attrs = listOf(Regex("@[A-Za-z_][A-Za-z0-9_]*"), Regex("""#\[[^\]\n]*\]""")),
    calls = true,
    ops = Regex("""->|=>|::|\.\.=?|[+\-*/%]=|==|!=|<=|>=|&&|\|\||[+\-*/%<>=!?&|^~]"""),
)

/* ------------------------------------------------------------------------ HackerScript */

private val HACKERSCRIPT = CodeCfg(
    comments = listOf(
        CommentRule("!!!", null, Tok.DOC),
        CommentRule("!!", null, Tok.COM),
        CommentRule("!>", "<!", Tok.COM),
    ),
    quotes = "\"'",
    escape = Regex("""\\[ntr\\"'0e]"""),
    kw = words(
        "fun let const if else elif while for in return end get import using direct manual struct enum match break continue gc pub self and or not as impl include native region use async await spawn style",
    ),
    consts = words("true false null"),
    types = words("Int Float Str Bool List Dict Option Result Self Some None Ok Err"),
    capitals = true,
    fnDef = words("fun"),
    typeDef = words("struct enum impl"),
    attrs = listOf(Regex("@[A-Za-z_][A-Za-z0-9_]*")),
    calls = true,
    ops = Regex("""->|::|&&|\|\||[+\-*/%]=|==|!=|<=|>=|[+\-*/%<>=!&|^~]"""),
    hook = { text, i, out, prev -> hackerScriptHook(text, i, out, prev) },
)

private val ANGLE_SPEC = Regex("""<[^>\n]*>""")
private val BRACE_SPEC = Regex("""\{[^}\n]*\}""")

/** `get <std:io>`, `use <lang:js>`, `include <x/y>`, `native {C++}`, `$ cmd $` sandbox. */
private fun hackerScriptHook(text: String, i: Int, out: Out, prev: String): Int {
    val c = text[i]
    if (c == '<' && (prev == "get" || prev == "use" || prev == "include" || prev == "using")) {
        val m = ANGLE_SPEC.matchAt(text, i)
        if (m != null) {
            out.push(Tok.MOD, m.value)
            return i + m.value.length
        }
    }
    if (c == '{' && prev == "native") {
        val m = BRACE_SPEC.matchAt(text, i)
        if (m != null) {
            out.push(Tok.TYPE, m.value)
            return i + m.value.length
        }
    }
    if (c == '$' && text.getOrNull(i + 1) == ' ') {
        val eol = text.indexOf('\n', i).let { if (it == -1) text.length else it }
        val line = text.substring(i, eol)
        val close = line.indexOf(" $", 1)
        if (close > 0) {
            out.push(Tok.OP, "$")
            out.push(Tok.STR, line.substring(1, close + 1))
            out.push(Tok.OP, "$")
            return i + close + 2
        }
    }
    return -1
}

/* ------------------------------------------------------------------------- other files */

private val C_LIKE = words(
    "if else for while do switch case break continue return fn func function let var const mut static struct enum union impl trait type interface class new delete import export from use using mod pub public private protected extends implements package namespace async await yield try catch finally throw throws match in as is not and or void int float double bool char string self this super extern unsafe where loop default",
)
private val SCRIPT = words(
    "if elif else fi then for while do done case esac in function return break continue local export source import set let end begin until unless and or not def class",
)
private val GENERIC_CONSTS = words("true false null nil None True False undefined")
private val GENERIC_OPS = Regex("""->|=>|::|&&|\|\||==|!=|<=|>=|[+\-*/%<>=!&|^~?]""")
private val GENERIC_ESCAPE = Regex("""\\[^\n]""")

private fun generic(
    comments: List<CommentRule>,
    kw: Set<String> = emptySet(),
    backtick: Boolean = false,
    consts: Set<String> = GENERIC_CONSTS,
    ops: Regex = GENERIC_OPS,
) = CodeCfg(
    comments = comments, quotes = "\"'", backtick = backtick, escape = GENERIC_ESCAPE, kw = kw, consts = consts, types = emptySet(),
    capitals = false, fnDef = words("fn func function def"), typeDef = words("struct enum class trait interface type"),
    attrs = emptyList(), calls = false, ops = ops,
)

private val C_FAMILY = generic(listOf(CommentRule("//", null, Tok.COM), CommentRule("/*", "*/", Tok.COM)), kw = C_LIKE, backtick = true)
private val HASH_FAMILY = generic(listOf(CommentRule("#", null, Tok.COM)), kw = SCRIPT)
private val LUA_FAMILY = generic(listOf(CommentRule("--[[", "]]", Tok.COM), CommentRule("--", null, Tok.COM)), kw = SCRIPT)
private val SQL_FAMILY = generic(
    listOf(CommentRule("--", null, Tok.COM), CommentRule("/*", "*/", Tok.COM)),
    kw = words("select from where insert update delete create table join on group by order limit and or not null as into values set"),
)
private val HTML_FAMILY = generic(listOf(CommentRule("<!--", "-->", Tok.COM)), consts = emptySet(), ops = Regex("""[<>/=]"""))

/* ---------------------------------------------------------------------- Hacker Lang */

private val HL_CMD_PREFIXES = listOf("^->", "^>>", "->>", "^>", "->", "/>", ">>", ">", "&")
private val HL_IDENT = Regex("[A-Za-z0-9_]+(?:-[A-Za-z0-9_]+)*")
private val HL_PATH = Regex("""(?:~|\.{1,2})?/[A-Za-z0-9_.\-/*~]*|\.{1,2}(?=[\s/]|$)""")
private val HL_FLAG = Regex("""--?[A-Za-z][A-Za-z0-9_-]*(?:=[^\s"']*)?""")
private val HL_DOLLAR = Regex("""\$(?:\{[^}]*\}|[A-Za-z_][A-Za-z0-9_]*)""")
private val HL_DOLLAR_SPECIAL = Regex("""\$(?:\{[^}]*\}|[A-Za-z_][A-Za-z0-9_]*|[0-9?#$!@*])""")
private val HL_NUMBER = Regex("""\d+(?:\.\d+)?(?![A-Za-z_])""")
private val HL_OPS = Regex("""&&|\|\||>>|==|!=|<=|>=|->|[|;<>=!+\-*/%()&]""")
private val HL_SHELL_WORD = Regex("""[A-Za-z_][A-Za-z0-9_.\-/:=,]*""")

private enum class Mode { EXPR, SHELL, PRINT }

private fun isWordStart(c: Char?): Boolean = c != null && (c in 'A'..'Z' || c in 'a'..'z' || c in '0'..'9' || c == '_')

private fun hlString(out: Out, body: String) {
    out.push(Tok.STR, "\"")
    var k = 1
    while (k < body.length) {
        val ch = body[k]
        if (ch == '\\' && k + 1 < body.length) {
            out.push(Tok.ESC, body.substring(k, k + 2))
            k += 2
        } else if (ch == '@' && isWordStart(body.getOrNull(k + 1))) {
            val m = HL_IDENT.matchAt(body, k + 1)!!
            out.push(Tok.VAR, "@" + m.value)
            k += 1 + m.value.length
        } else if (ch == '$') {
            val m = HL_DOLLAR.matchAt(body, k)
            if (m != null) {
                out.push(Tok.VAR, m.value)
                k += m.value.length
            } else {
                out.push(Tok.STR, "$")
                k++
            }
        } else {
            var e = k + 1
            while (e < body.length && body[e] != '\\' && body[e] != '@' && body[e] != '$') e++
            out.push(Tok.STR, body.substring(k, e))
            k = e
        }
    }
}

/** Strings, @variables, numbers, flags, pipes ... inside one Hacker Lang line (after its prefix). */
private fun hlInline(out: Out, s: String, mode: Mode) {
    val n = s.length
    var i = 0
    var wordStart = mode == Mode.SHELL
    while (i < n) {
        val c = s[i]

        if (c == '@' && isWordStart(s.getOrNull(i + 1))) {
            val m = HL_IDENT.matchAt(s, i + 1)!!
            out.push(Tok.VAR, "@" + m.value)
            i += 1 + m.value.length
            wordStart = false
            continue
        }
        if (mode == Mode.PRINT) {
            var j = i + 1
            while (j < n && s[j] != '@') j++
            out.push(Tok.PLAIN, s.substring(i, j))
            i = j
            continue
        }
        if (c == '"' || (c == '\'' && mode == Mode.SHELL)) {
            var j = i + 1
            while (j < n && s[j] != c) {
                if (s[j] == '\\') j++
                j++
            }
            val end = minOf(j + 1, n)
            if (c == '"') hlString(out, s.substring(i, end)) else out.push(Tok.STR, s.substring(i, end))
            i = end
            wordStart = false
            continue
        }
        if (c == '|' && s.getOrNull(i + 1) == '>') {
            out.push(Tok.OP, "|>")
            i += 2
            continue
        }
        if (c == '$') {
            if (s.getOrNull(i + 1) == '(') {
                out.push(Tok.OP, "$(")
                i += 2
                wordStart = mode == Mode.SHELL
                continue
            }
            val m = HL_DOLLAR_SPECIAL.matchAt(s, i)
            if (m != null) {
                out.push(Tok.VAR, m.value)
                i += m.value.length
                wordStart = false
                continue
            }
        }
        if (c == ' ' || c == '\t') {
            out.push(Tok.PLAIN, c.toString())
            i++
            continue
        }
        if (mode == Mode.SHELL && c == '-' && (i == 0 || s[i - 1] == ' ' || s[i - 1] == '\t')) {
            val m = HL_FLAG.matchAt(s, i)
            if (m != null) {
                out.push(Tok.ATTR, m.value)
                i += m.value.length
                wordStart = false
                continue
            }
        }
        if (mode == Mode.SHELL && (c == '/' || c == '~' || c == '.')) {
            val m = HL_PATH.matchAt(s, i)
            if (m != null && m.value.isNotEmpty()) {
                out.push(Tok.MOD, m.value)
                i += m.value.length
                wordStart = false
                continue
            }
        }
        if (c in '0'..'9' && !isIdentChar(s.getOrNull(i - 1)) && s.getOrNull(i - 1) != '.' && s.getOrNull(i - 1) != '-') {
            val m = HL_NUMBER.matchAt(s, i)
            if (m != null) {
                out.push(Tok.NUM, m.value)
                i += m.value.length
                wordStart = false
                continue
            }
        }
        if (isAsciiLetter(c)) {
            val w = (if (mode == Mode.SHELL) HL_SHELL_WORD else IDENT).matchAt(s, i)!!.value
            val kind = when {
                w == "true" || w == "false" -> Tok.CONST
                mode == Mode.SHELL && wordStart -> Tok.FN
                mode == Mode.EXPR && (w == "in" || w == "and" || w == "or" || w == "not") -> Tok.KW
                else -> Tok.PLAIN
            }
            out.push(kind, w)
            i += w.length
            wordStart = false
            continue
        }
        val op = HL_OPS.matchAt(s, i)
        if (op != null) {
            out.push(Tok.OP, op.value)
            i += op.value.length
            if (mode == Mode.SHELL && (op.value == "|" || op.value == "&&" || op.value == "||" || op.value == ";" || op.value == "(")) wordStart = true
            continue
        }
        out.push(Tok.PLAIN, c.toString())
        i++
    }
}

private fun hlName(s: String, at: Int): String = HL_IDENT.matchAt(s, at)?.value ?: ""

/** `<main/colors> | detail` -> module path + detail. */
private fun importTail(out: Out, s: String) {
    val bar = s.indexOf('|')
    val spec = if (bar == -1) s else s.substring(0, bar)
    val trimmed = spec.trimEnd()
    out.push(Tok.MOD, trimmed)
    out.push(Tok.PLAIN, spec.substring(trimmed.length))
    if (bar != -1) {
        out.push(Tok.OP, "|")
        out.push(Tok.STR, s.substring(bar + 1))
    }
}

private fun g(m: MatchResult, i: Int): String = m.groups[i]?.value ?: ""

private val RE_GOROUTINE = Regex("""^(\s*)([A-Za-z0-9_-]*)(\s*)(def\b)?(.*)$""")
private val RE_ARENA = Regex("""^(\s*)(<[^>\n]*>)?(\s*)(def)\b(.*)$""")
private val RE_FDEF = Regex("""^:(\s*)([A-Za-z0-9_-]+)(\s+)def\b(.*)$""")
private val RE_EXPORT_EQ = Regex("""^(\s*)(=)(.*)$""")
private val RE_EXPORT_LIST = Regex("""^(\s*)(\[)(.*)$""")
private val RE_EXTERN_TAIL = Regex("""^(\s*)(\[[^\]\n]*\])?(\s*)(def\b)?(.*)$""")
private val RE_VAR_TAIL = Regex("""^(\s*)(?::(\s*)([A-Za-z0-9_-]+))?(\s*)(=)?(.*)$""")
private val RE_FOR = Regex("""^@(\s*)([A-Za-z0-9_-]+)(\s+)in\b(.*)$""")
private val RE_QMARK = Regex("""^\?(\s*)([A-Za-z]+)(.*)$""")
private val RE_KWLINE = Regex("""^(done|using)\b(.*)$""")
private val RE_GEN = Regex("""^(\s*)(<[^>\n]*>)(.*)$""")
private val RE_REPEAT = Regex("""^(_)(\d+)(?![A-Za-z0-9_])(.*)$""")

private fun lexHackerLang(text: String, out: Out) {
    var inExportList = false
    val lines = text.split("\n")
    for ((idx, line) in lines.withIndex()) {
        if (idx > 0) out.push(Tok.PLAIN, "\n")
        var leadLen = 0
        while (leadLen < line.length && (line[leadLen] == ' ' || line[leadLen] == '\t' || line[leadLen] == '\r')) leadLen++
        out.push(Tok.PLAIN, line.substring(0, leadLen))
        val s = line.substring(leadLen)
        if (s.isEmpty()) continue

        fun rest(from: Int) = s.substring(from)
        fun ws(from: Int): Int {
            var p = from
            while (p < s.length && (s[p] == ' ' || s[p] == '\t')) p++
            return p
        }

        // body of an export list:  => name [   | item   ]
        if (inExportList) {
            if (s.startsWith("]")) {
                out.push(Tok.OP, "]")
                out.push(Tok.PLAIN, rest(1))
                inExportList = false
                continue
            }
            if (s.startsWith(";;;")) { out.push(Tok.DOC, s); continue }
            if (s.startsWith(";;")) { out.push(Tok.COM, s); continue }
            if (s.startsWith("|") && s.getOrNull(1) != '>' && s.getOrNull(1) != '|') {
                out.push(Tok.OP, "|")
                hlInline(out, rest(1), Mode.EXPR)
                continue
            }
        }

        // comments and shebang
        if (s.startsWith("#!")) { out.push(Tok.COM, s); continue }
        if (s.startsWith("///") || s.startsWith(";;;")) { out.push(Tok.DOC, s); continue }
        if (s.startsWith(";;")) { out.push(Tok.COM, s); continue }

        // // tool [apt-package]   — dependency declaration
        if (s.startsWith("//")) {
            out.push(Tok.ATTR, "//")
            val p = ws(2)
            out.push(Tok.PLAIN, s.substring(2, p))
            val lb = s.indexOf('[', p)
            val name = s.substring(p, if (lb == -1) s.length else lb)
            val trimmed = name.trimEnd()
            out.push(Tok.MOD, trimmed)
            out.push(Tok.PLAIN, name.substring(trimmed.length))
            if (lb != -1) out.push(Tok.STR, s.substring(lb))
            continue
        }

        // # <lib>  /  # <lib> | detail      — import
        if (s.startsWith("#")) {
            out.push(Tok.KW, "#")
            val p = ws(1)
            out.push(Tok.PLAIN, s.substring(1, p))
            importTail(out, s.substring(p))
            continue
        }
        // << file | detail   /   <* directory
        if (s.startsWith("<<") || s.startsWith("<*")) {
            out.push(Tok.KW, s.substring(0, 2))
            val p = ws(2)
            out.push(Tok.PLAIN, s.substring(2, p))
            importTail(out, s.substring(p))
            continue
        }

        // ~> print
        if (s.startsWith("~>")) {
            out.push(Tok.KW, "~>")
            hlInline(out, rest(2), Mode.PRINT)
            continue
        }

        // $( expr ) -> @var
        if (s.startsWith("$(")) {
            out.push(Tok.KW, "$(")
            var depth = 1
            var j = 2
            while (j < s.length && depth > 0) {
                if (s[j] == '(') depth++ else if (s[j] == ')') depth--
                j++
            }
            val close = if (depth == 0) j - 1 else j
            hlInline(out, s.substring(2, close), Mode.EXPR)
            if (depth == 0) out.push(Tok.KW, ")")
            hlInline(out, s.substring(j), Mode.EXPR)
            continue
        }

        // :* goroutine
        if (s.startsWith(":*")) {
            out.push(Tok.KW, ":*")
            val m = RE_GOROUTINE.matchEntire(rest(2))
            if (m != null) {
                out.push(Tok.PLAIN, g(m, 1)); out.push(Tok.FN, g(m, 2)); out.push(Tok.PLAIN, g(m, 3))
                out.push(Tok.KW, g(m, 4)); out.push(Tok.PLAIN, g(m, 5))
            } else out.push(Tok.PLAIN, rest(2))
            continue
        }
        // :: name <size> def   |   :: name args
        if (s.startsWith("::")) {
            out.push(Tok.KW, "::")
            var p = ws(2)
            out.push(Tok.PLAIN, s.substring(2, p))
            val name = hlName(s, p)
            out.push(Tok.FN, name)
            p += name.length
            val tail = s.substring(p)
            val arena = RE_ARENA.matchEntire(tail)
            if (arena != null) {
                out.push(Tok.PLAIN, g(arena, 1)); out.push(Tok.NUM, g(arena, 2)); out.push(Tok.PLAIN, g(arena, 3))
                out.push(Tok.KW, g(arena, 4)); out.push(Tok.COM, g(arena, 5))
            } else hlInline(out, tail, Mode.SHELL)
            continue
        }
        // :name def
        val fdef = RE_FDEF.matchEntire(s)
        if (fdef != null) {
            out.push(Tok.KW, ":"); out.push(Tok.PLAIN, g(fdef, 1)); out.push(Tok.FN, g(fdef, 2))
            out.push(Tok.PLAIN, g(fdef, 3)); out.push(Tok.KW, "def"); out.push(Tok.COM, g(fdef, 4))
            continue
        }

        // *-- channel operation   /   *> hsh command
        if (s.startsWith("*--")) {
            out.push(Tok.KW, "*--")
            val p = ws(3)
            out.push(Tok.PLAIN, s.substring(3, p))
            val name = hlName(s, p)
            out.push(Tok.FN, name)
            hlInline(out, s.substring(p + name.length), Mode.EXPR)
            continue
        }
        if (s.startsWith("*>")) {
            out.push(Tok.KW, "*>")
            hlInline(out, rest(2), Mode.SHELL)
            continue
        }

        // -- function call
        if (s.startsWith("--")) {
            out.push(Tok.KW, "--")
            val p = ws(2)
            out.push(Tok.PLAIN, s.substring(2, p))
            val name = hlName(s, p)
            out.push(Tok.FN, name)
            hlInline(out, s.substring(p + name.length), Mode.EXPR)
            continue
        }

        // => export
        if (s.startsWith("=>")) {
            out.push(Tok.KW, "=>")
            val p = ws(2)
            out.push(Tok.PLAIN, s.substring(2, p))
            val name = hlName(s, p)
            out.push(Tok.VAR, name)
            val after = s.substring(p + name.length)
            val eq = RE_EXPORT_EQ.matchEntire(after)
            val lst = RE_EXPORT_LIST.matchEntire(after)
            if (eq != null) {
                out.push(Tok.PLAIN, g(eq, 1)); out.push(Tok.OP, "=")
                hlInline(out, g(eq, 3), Mode.EXPR)
            } else if (lst != null) {
                out.push(Tok.PLAIN, g(lst, 1)); out.push(Tok.OP, "[")
                out.push(Tok.PLAIN, g(lst, 3))
                inExportList = true
            } else out.push(Tok.PLAIN, after)
            continue
        }

        // _> file [runtime] def
        if (s.startsWith("_>")) {
            out.push(Tok.KW, "_>")
            var p = ws(2)
            out.push(Tok.PLAIN, s.substring(2, p))
            var e = p
            while (e < s.length && !s[e].isWhitespace() && s[e] != '[') e++
            out.push(Tok.MOD, s.substring(p, e))
            p = e
            val m = RE_EXTERN_TAIL.matchEntire(s.substring(p))
            if (m != null) {
                out.push(Tok.PLAIN, g(m, 1)); out.push(Tok.TYPE, g(m, 2)); out.push(Tok.PLAIN, g(m, 3))
                out.push(Tok.KW, g(m, 4)); out.push(Tok.PLAIN, g(m, 5))
            } else out.push(Tok.PLAIN, s.substring(p))
            continue
        }

        // command lines: > >> ^> ^>> -> ->> ^-> /> &
        val prefix = HL_CMD_PREFIXES.firstOrNull { s.startsWith(it) }
        if (prefix != null) {
            out.push(Tok.KW, prefix)
            hlInline(out, rest(prefix.length), Mode.SHELL)
            continue
        }

        // % name: type = value
        if (s.startsWith("%")) {
            out.push(Tok.KW, "%")
            var p = ws(1)
            out.push(Tok.PLAIN, s.substring(1, p))
            val name = hlName(s, p)
            out.push(Tok.VAR, name)
            p += name.length
            val m = RE_VAR_TAIL.matchEntire(s.substring(p))
            if (m != null) {
                out.push(Tok.PLAIN, g(m, 1))
                if (m.groups[3] != null) {
                    out.push(Tok.OP, ":"); out.push(Tok.PLAIN, g(m, 2)); out.push(Tok.TYPE, g(m, 3))
                }
                out.push(Tok.PLAIN, g(m, 4))
                if (m.groups[5] != null) out.push(Tok.OP, "=")
                hlInline(out, g(m, 6), Mode.EXPR)
            } else out.push(Tok.PLAIN, s.substring(p))
            continue
        }

        // @ item in list   (for)   —   any other line with @name is a variable reference
        if (s.startsWith("@")) {
            val f = RE_FOR.matchEntire(s)
            if (f != null) {
                out.push(Tok.KW, "@"); out.push(Tok.PLAIN, g(f, 1)); out.push(Tok.VAR, g(f, 2))
                out.push(Tok.PLAIN, g(f, 3)); out.push(Tok.KW, "in")
                hlInline(out, g(f, 4), Mode.SHELL)
                continue
            }
            hlInline(out, s, Mode.EXPR)
            continue
        }

        // ?~ cond   |   ? ok  |  ? err  |  ?switch x
        if (s.startsWith("?")) {
            if (s.startsWith("?~")) {
                out.push(Tok.KW, "?~")
                hlInline(out, rest(2), Mode.EXPR)
                continue
            }
            val m = RE_QMARK.matchEntire(s)
            if (m != null) {
                out.push(Tok.KW, "?"); out.push(Tok.PLAIN, g(m, 1)); out.push(Tok.KW, g(m, 2))
                hlInline(out, g(m, 3), Mode.EXPR)
                continue
            }
        }

        // done / using <gen 2>
        val kwLine = RE_KWLINE.matchEntire(s)
        if (kwLine != null) {
            out.push(Tok.KW, g(kwLine, 1))
            val tail = g(kwLine, 2)
            val gen = RE_GEN.matchEntire(tail)
            if (gen != null) {
                out.push(Tok.PLAIN, g(gen, 1)); out.push(Tok.MOD, g(gen, 2)); out.push(Tok.COM, g(gen, 3))
            } else hlInline(out, tail, Mode.EXPR)
            continue
        }
        // _3 — repeat the next line three times
        val rep = RE_REPEAT.matchEntire(s)
        if (rep != null) {
            out.push(Tok.KW, "_"); out.push(Tok.NUM, g(rep, 2))
            hlInline(out, g(rep, 3), Mode.EXPR)
            continue
        }

        // switch arms, loose values, anything else
        hlInline(out, s, Mode.EXPR)
    }
}

/* ------------------------------------------------------------------------------ hk */

private val HK_STRING = Regex(""""(?:\\.|[^"\\\n])*"?""")
private val HK_NUMBER = Regex("""\d+(?:\.\d+)?(?![A-Za-z_.-])""")
private val HK_WORD = Regex("[A-Za-z][A-Za-z0-9_]*")
private val HK_SECTION = Regex("""^\[[^\]\n]*\]""")
private val HK_ARROW = Regex("""^(-+>)(\s*)(.*)$""")

private fun lexHk(text: String, out: Out) {
    for ((idx, line) in text.split("\n").withIndex()) {
        if (idx > 0) out.push(Tok.PLAIN, "\n")
        var leadLen = 0
        while (leadLen < line.length && (line[leadLen] == ' ' || line[leadLen] == '\t' || line[leadLen] == '\r')) leadLen++
        out.push(Tok.PLAIN, line.substring(0, leadLen))
        val s = line.substring(leadLen)
        if (s.isEmpty()) continue

        if (s.startsWith("!") || s.startsWith(";;")) { out.push(Tok.COM, s); continue }

        val sec = HK_SECTION.find(s)
        if (sec != null) {
            out.push(Tok.SEC, sec.value)
            hkTail(out, s.substring(sec.value.length))
            continue
        }
        val arrow = HK_ARROW.matchEntire(s)
        if (arrow != null) {
            out.push(Tok.OP, g(arrow, 1))
            out.push(Tok.PLAIN, g(arrow, 2))
            val body = g(arrow, 3)
            val sep = body.indexOf("=>")
            val cmt = body.indexOf(";;")
            val keyEnd = if (sep != -1 && (cmt == -1 || sep < cmt)) sep else if (cmt != -1) cmt else body.length
            val keyText = body.substring(0, keyEnd)
            val key = keyText.trimEnd()
            out.push(Tok.KEY, key)
            out.push(Tok.PLAIN, keyText.substring(key.length))
            if (keyEnd == sep) {
                out.push(Tok.OP, "=>")
                hkTail(out, body.substring(keyEnd + 2))
            } else hkTail(out, body.substring(keyEnd))
            continue
        }
        hkTail(out, s)
    }
}

private fun hkTail(out: Out, s: String) {
    var i = 0
    val n = s.length
    while (i < n) {
        val c = s[i]
        if (c == ';' && s.getOrNull(i + 1) == ';') {
            out.push(Tok.COM, s.substring(i))
            return
        }
        if (c == '"') {
            val m = HK_STRING.matchAt(s, i)!!
            out.push(Tok.STR, m.value)
            i += m.value.length
            continue
        }
        if (c == '[' || c == ']' || c == ',') {
            out.push(Tok.OP, c.toString())
            i++
            continue
        }
        if (c in '0'..'9' && !isIdentChar(s.getOrNull(i - 1))) {
            val m = HK_NUMBER.matchAt(s, i)
            if (m != null) {
                out.push(Tok.NUM, m.value)
                i += m.value.length
                continue
            }
        }
        if (isAsciiLetter(c) && c != '_' && !isIdentChar(s.getOrNull(i - 1))) {
            val m = HK_WORD.matchAt(s, i)!!
            out.push(if (m.value == "true" || m.value == "false") Tok.CONST else Tok.PLAIN, m.value)
            i += m.value.length
            continue
        }
        out.push(Tok.PLAIN, c.toString())
        i++
    }
}
