package org.hackeros.bitio.data

import org.json.JSONArray
import org.json.JSONObject

/** The three HackerOS languages (plus "any" for entries that don't say). Mirrors website/src/langs.ts. */
enum class Lang(val id: String, val label: String, val short: String) {
    HSHARP("hsharp", "H#", "h#"),
    HACKERLANG("hackerlang", "Hacker Lang", "hl"),
    HACKERSCRIPT("hackerscript", "HackerScript", "hs"),
    ANY("any", "any", "any");

    companion object {
        val filterable: List<Lang> = listOf(HSHARP, HACKERLANG, HACKERSCRIPT)

        /** Accepts every spelling people use: "h#", "H-Sharp", "hl", "Hacker Lang", "hcs"... */
        fun normalize(raw: String?): Lang {
            val t = (raw ?: "").lowercase().replace(Regex("[\\s-]"), "")
            return when (t) {
                "h#", "hsharp", "hsh" -> HSHARP
                "hl", "hackerlang" -> HACKERLANG
                "hs", "hcs", "hackerscript" -> HACKERSCRIPT
                else -> ANY
            }
        }

        fun fromTags(tags: List<String>): Lang {
            for (t in tags) {
                val l = normalize(t)
                if (l != ANY) return l
            }
            return ANY
        }
    }
}

data class LibEntry(
    val name: String,
    val target: String,
    val description: String,
    val tags: List<String>,
    val author: String,
    val lang: Lang,
    val rev: String = "",
    val checksum: String = "",
) {
    val installCommand: String get() = "bit install $name"
    val addCommand: String get() = "bit add $name"
    val github: GithubRepo? get() = parseGithub(target)
}

data class Index(val updatedAt: String, val libraries: List<LibEntry>)

data class GithubRepo(val owner: String, val repo: String)

private val GITHUB_URL = Regex("^https://github\\.com/([^/\\s]+)/([^/\\s#?]+?)(?:\\.git)?/?$")

/** `https://github.com/owner/repo(.git)` -> owner/repo */
fun parseGithub(url: String): GithubRepo? {
    val m = GITHUB_URL.matchEntire(url.trim()) ?: return null
    return GithubRepo(m.groupValues[1], m.groupValues[2])
}

/** Only http(s) links are ever opened. */
fun safeUrl(url: String): String? = url.trim().takeIf { it.startsWith("https://") || it.startsWith("http://") }

/* ------------------------------------------------------------------ index parsing */

private fun JSONObject.str(key: String): String = if (isNull(key)) "" else optString(key, "")

object IndexParser {
    /** The hand-edited index has had trailing commas; strip them (outside strings) before parsing. */
    fun stripTrailingCommas(text: String): String {
        val out = StringBuilder(text.length)
        var inStr = false
        var i = 0
        while (i < text.length) {
            val c = text[i]
            if (inStr) {
                out.append(c)
                if (c == '\\' && i + 1 < text.length) {
                    i++
                    out.append(text[i])
                } else if (c == '"') {
                    inStr = false
                }
            } else if (c == '"') {
                inStr = true
                out.append(c)
            } else if (c == ',') {
                var j = i + 1
                while (j < text.length && text[j].isWhitespace()) j++
                if (j >= text.length || (text[j] != '}' && text[j] != ']')) out.append(c)
            } else {
                out.append(c)
            }
            i++
        }
        return out.toString()
    }

    fun parse(text: String): Index {
        val cleaned = stripTrailingCommas(text).trim()
        val list: JSONArray
        var updated = ""
        if (cleaned.startsWith("[")) {
            list = JSONArray(cleaned)
        } else {
            val obj = JSONObject(cleaned)
            list = obj.optJSONArray("libraries") ?: JSONArray()
            updated = obj.str("updated_at")
        }
        val libs = ArrayList<LibEntry>(list.length())
        for (i in 0 until list.length()) {
            val o = list.optJSONObject(i) ?: continue
            val name = o.str("name")
            if (name.isEmpty()) continue
            val tags = ArrayList<String>()
            o.optJSONArray("tags")?.let { arr ->
                for (k in 0 until arr.length()) {
                    val t = arr.optString(k, "")
                    if (t.isNotEmpty()) tags += t
                }
            }
            val explicit = Lang.normalize(o.str("lang"))
            val target = o.str("target").ifEmpty { o.str("url") }.ifEmpty { o.str("git") }
            libs += LibEntry(
                name = name,
                target = target,
                description = o.str("description"),
                tags = tags,
                author = o.str("author"),
                lang = if (explicit != Lang.ANY) explicit else Lang.fromTags(tags),
                rev = o.str("rev"),
                checksum = o.str("checksum"),
            )
        }
        libs.sortWith { a, b -> a.name.compareTo(b.name, ignoreCase = true) }
        return Index(updated, libs)
    }
}

/* -------------------------------------------------------------------------- Bit.hk */

/** Parsed `Bit.hk`: section -> key -> value (`--> sub` entries become "key.sub"). */
typealias HkDoc = Map<String, Map<String, String>>

object Hk {
    fun parse(source: String): HkDoc {
        val doc = LinkedHashMap<String, LinkedHashMap<String, String>>()
        var section = ""
        var lastKey = ""
        for (raw in source.replace("\r", "").split("\n")) {
            val line = raw.trim()
            if (line.isEmpty() || line.startsWith(";;") || line.startsWith("!") || line.startsWith("#")) continue

            if (line.startsWith("[") && line.endsWith("]") && line.length > 2) {
                section = normSection(line.substring(1, line.length - 1))
                lastKey = ""
                doc.getOrPut(section) { LinkedHashMap() }
                continue
            }
            if (section.isEmpty()) continue

            var body = line
            var sub = false
            if (body.startsWith("-->")) {
                body = body.substring(3).trim()
                sub = true
            } else if (body.startsWith("->")) {
                body = body.substring(2).trim()
            }
            val arrow = body.indexOf("=>")
            val eq = body.indexOf('=')
            var key: String
            var value = ""
            if (arrow >= 0) {
                key = body.substring(0, arrow)
                value = body.substring(arrow + 2)
            } else if (eq >= 0) {
                key = body.substring(0, eq)
                value = body.substring(eq + 1)
            } else {
                key = body
            }
            key = unquote(key.trim())
            if (key.isEmpty()) continue
            if (sub && lastKey.isNotEmpty()) key = "$lastKey.$key" else if (!sub) lastKey = key
            doc.getOrPut(section) { LinkedHashMap() }[key] = unquote(stripComment(value.trim()))
        }
        return doc
    }

    /** `[Default build]`, `[default_build]` and `[default-build]` are one section. */
    fun normSection(raw: String): String = raw.trim().lowercase().replace(Regex("[\\s_]+"), "-")

    private fun stripComment(v: String): String {
        var inStr = false
        for (i in 0 until v.length - 1) {
            if (v[i] == '"') inStr = !inStr
            if (!inStr && v[i] == ';' && v[i + 1] == ';') return v.substring(0, i).trim()
        }
        return v
    }

    private fun unquote(s: String): String {
        val t = s.trim()
        return if (t.length >= 2 && t.startsWith("\"") && t.endsWith("\"")) t.substring(1, t.length - 1) else t
    }

    fun list(value: String?): List<String> {
        if (value.isNullOrBlank()) return emptyList()
        var t = value.trim()
        if (t.startsWith("[") && t.endsWith("]")) t = t.substring(1, t.length - 1)
        return t.split(",").map { unquote(it.trim()) }.filter { it.isNotEmpty() }
    }
}

data class DepSpec(val name: String, val spec: String)

enum class DepKind { INDEX, GIT, PATH, UNKNOWN }

/** `[dependencies]` of a manifest: `-> mold => *`, `-> x => git URL v1`, or a `--> path => ../x` map. */
fun dependenciesOf(doc: HkDoc?): List<DepSpec> {
    val deps = doc?.get("dependencies") ?: return emptyList()
    return deps.keys.filter { !it.contains('.') }.map { name ->
        val own = deps[name].orEmpty()
        val subs = deps.keys.filter { it.startsWith("$name.") }
            .map { "${it.substring(name.length + 1)}=${deps[it].orEmpty()}" }
        DepSpec(name, own.ifEmpty { subs.joinToString(", ") })
    }
}

fun classifyDep(d: DepSpec, libs: List<LibEntry>): Pair<DepKind, LibEntry?> {
    if (d.spec.startsWith("git ") || d.spec.startsWith("http://") || d.spec.startsWith("https://")) return DepKind.GIT to null
    if (d.spec.startsWith("path")) return DepKind.PATH to null
    val lib = libs.firstOrNull { it.name.equals(d.name, ignoreCase = true) }
    return if (lib != null) DepKind.INDEX to lib else DepKind.UNKNOWN to null
}

/** Things worth knowing before depending on a library, read from its manifest. */
fun compatNotes(entry: LibEntry, doc: HkDoc, libs: List<LibEntry>): List<Pair<Boolean, String>> {
    val notes = ArrayList<Pair<Boolean, String>>() // (ok, text)
    val pkg = doc["package"].orEmpty()
    val ed = doc["edition"].orEmpty()
    ed["toolchain"]?.takeIf { it.isNotEmpty() }?.let { notes += true to "Needs the H# toolchain $it or newer (h# --version)." }
    ed["edition"]?.takeIf { it.isNotEmpty() }?.let { notes += true to "Edition $it (files without using \"<year>\" use it)." }
    val link = doc["build"]?.get("link").orEmpty()
    if (link.isNotEmpty() && link != "static") notes += false to "[build] link => $link - bit only links statically and rejects this."
    doc["build"]?.get("platform")?.takeIf { it.isNotEmpty() }?.let { notes += true to "Cross-compiles for $it." }
    val pkgName = pkg["name"].orEmpty()
    if (pkgName.isNotEmpty() && !pkgName.equals(entry.name, ignoreCase = true)) {
        notes += false to "The manifest calls this package \"$pkgName\", the index calls it \"${entry.name}\"."
    }
    for (d in dependenciesOf(doc)) {
        if (classifyDep(d, libs).first == DepKind.UNKNOWN) {
            notes += false to "Dependency \"${d.name}\" is not in the index (and isn't a git/path dependency)."
        }
    }
    return notes
}

/* ---------------------------------------------------------------- GitHub entities */

data class RepoMeta(
    val stars: Int,
    val forks: Int,
    val openIssues: Int,
    val license: String,
    val pushedAt: String,
    val homepage: String,
    val archived: Boolean,
)

data class ReleaseAsset(val name: String, val size: Long, val downloads: Int, val url: String)

data class Release(
    val tag: String,
    val name: String,
    val date: String,
    val prerelease: Boolean,
    val url: String,
    val body: String,
    val assets: List<ReleaseAsset>,
    val tagOnly: Boolean = false,
)

data class TreeItem(val path: String, val isDir: Boolean, val size: Long)

data class RepoTree(val items: List<TreeItem>, val truncated: Boolean)

data class Manifest(val file: String, val doc: HkDoc)

data class Readme(val file: String, val text: String, val markdown: Boolean)
