package org.hackeros.bitio.data

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.IOException
import java.net.URLEncoder

/** A value plus where it came from: `stale` = served from the saved copy because the network failed. */
class Loaded<T>(val value: T?, val stale: Boolean = false, val ageMs: Long? = null)

class RateLimit(val remaining: Int, val limit: Int)

/**
 * Everything the app reads: the library index (same document `bit` reads) and, per library, the
 * GitHub data the website shows (manifest, README, stats, releases, file tree, files).
 * Results are cached on disk; when offline the saved copy is used.
 */
class BitRepository(private val context: Context, private val prefs: Prefs) {
    val cache = DiskCache(File(context.cacheDir, "bitio"))

    @Volatile
    var lastRate: RateLimit? = null
        private set

    /* ------------------------------------------------------------------ index */

    /** Fastest possible content for the first frame: the saved copy, else the snapshot shipped in the APK. */
    fun peekIndex(): Index? {
        cache.get(KEY_INDEX)?.let { runCatching { return IndexParser.parse(it.value) } }
        return bundledIndex()
    }

    fun bundledIndex(): Index? = runCatching {
        val text = context.assets.open("repository.json").bufferedReader().use { it.readText() }
        IndexParser.parse(text)
    }.getOrNull()

    /** Network first (the network copy always wins while online), then the saved copy. Throws when neither exists. */
    suspend fun loadIndex(): Loaded<Index> {
        var last: Exception? = null
        for (url in INDEX_URLS) {
            try {
                val res = Http.get(url, mapOf("Cache-Control" to "no-cache"))
                if (!res.ok) throw IOException("$url: HTTP ${res.status}")
                val index = IndexParser.parse(res.body)
                cache.put(KEY_INDEX, res.body)
                return Loaded(index)
            } catch (e: kotlinx.coroutines.CancellationException) {
                throw e
            } catch (e: Exception) {
                last = e
            }
        }
        val saved = cache.get(KEY_INDEX)
        if (saved != null) {
            runCatching { return Loaded(IndexParser.parse(saved.value), stale = true, ageMs = saved.ageMs) }
        }
        bundledIndex()?.let { return Loaded(it, stale = true, ageMs = null) }
        throw last ?: IOException("could not load the library index")
    }

    /* ------------------------------------------------------------ generic cache */

    private suspend fun <T> cached(
        key: String,
        ttlMs: Long,
        fetch: suspend () -> String?,
        parse: (String) -> T,
    ): Loaded<T> {
        val saved = cache.get(key)
        if (saved != null && saved.ageMs < ttlMs) {
            runCatching { return Loaded(parse(saved.value), ageMs = saved.ageMs) }
        }
        try {
            val text = fetch() ?: return Loaded(null)
            cache.put(key, text)
            return Loaded(parse(text), ageMs = 0)
        } catch (e: kotlinx.coroutines.CancellationException) {
            throw e
        } catch (e: Exception) {
            if (saved != null) {
                runCatching { return Loaded(parse(saved.value), stale = true, ageMs = saved.ageMs) }
            }
            throw e
        }
    }

    /* ------------------------------------------------------------------ GitHub */

    private fun enc(s: String) = URLEncoder.encode(s, "UTF-8").replace("+", "%20")
    private fun encPath(p: String) = p.split("/").joinToString("/") { enc(it) }

    /** raw.githubusercontent.com has no API quota and never sees the token. null = 404. */
    private suspend fun fetchRaw(r: GithubRepo, ref: String, path: String): String? {
        val url = "https://raw.githubusercontent.com/${r.owner}/${r.repo}/${encPath(ref)}/${encPath(path)}"
        val res = Http.get(url)
        if (res.status == 404) return null
        if (!res.ok) throw IOException("HTTP ${res.status}")
        return res.body
    }

    /** api.github.com with the token attached when one is saved. */
    private suspend fun api(path: String): HttpResult {
        val headers = HashMap<String, String>()
        headers["Accept"] = "application/vnd.github+json"
        headers["X-GitHub-Api-Version"] = "2022-11-28"
        val token = prefs.githubToken
        if (token.isNotEmpty()) headers["Authorization"] = "Bearer $token"
        val res = Http.get("https://api.github.com$path", headers)
        val remaining = res.headers["x-ratelimit-remaining"]?.toIntOrNull()
        val limit = res.headers["x-ratelimit-limit"]?.toIntOrNull()
        if (remaining != null && limit != null) lastRate = RateLimit(remaining, limit)
        if (res.status == 401) throw GithubException("GitHub rejected the saved token (401). Check it in Settings.", 401)
        if ((res.status == 403 || res.status == 429) && (remaining == 0 || res.body.contains("rate limit", ignoreCase = true))) {
            throw GithubException(
                if (token.isEmpty()) "GitHub's anonymous limit (60 requests/hour) is used up. Add a token in Settings."
                else "GitHub's hourly limit is used up. Try again later.",
                res.status,
            )
        }
        return res
    }

    private suspend fun apiOk(path: String): String? {
        val res = api(path)
        if (res.status == 404) return null
        if (!res.ok) throw GithubException("GitHub API: HTTP ${res.status}", res.status)
        return res.body
    }

    suspend fun rateLimit(): RateLimit? {
        val res = api("/rate_limit")
        if (!res.ok) throw GithubException("GitHub API: HTTP ${res.status}", res.status)
        val core = JSONObject(res.body).optJSONObject("resources")?.optJSONObject("core") ?: return null
        val rl = RateLimit(core.optInt("remaining"), core.optInt("limit"))
        lastRate = rl
        return rl
    }

    suspend fun loadManifest(r: GithubRepo, ref: String): Loaded<Manifest> =
        cached(
            "manifest:${r.owner}/${r.repo}@$ref", TTL_MANIFEST,
            fetch = {
                var found: String? = null
                for (f in MANIFESTS) {
                    val t = fetchRaw(r, ref, f)
                    if (t != null) { found = "$f\n${t.take(100_000)}"; break }
                }
                found
            },
            parse = { s ->
                val nl = s.indexOf('\n')
                Manifest(s.substring(0, nl), Hk.parse(s.substring(nl + 1)))
            },
        )

    suspend fun loadReadme(r: GithubRepo, ref: String): Loaded<Readme> =
        cached(
            "readme:${r.owner}/${r.repo}@$ref", TTL_README,
            fetch = {
                var found: String? = null
                for (f in README_FILES) {
                    val t = fetchRaw(r, ref, f)
                    if (t != null) { found = "$f\n${t.take(200_000)}"; break }
                }
                found
            },
            parse = { s ->
                val nl = s.indexOf('\n')
                val file = s.substring(0, nl)
                Readme(file, s.substring(nl + 1), Regex("\\.(md|markdown)$", RegexOption.IGNORE_CASE).containsMatchIn(file))
            },
        )

    suspend fun loadMeta(r: GithubRepo): Loaded<RepoMeta> =
        cached(
            "meta:${r.owner}/${r.repo}", TTL_META,
            fetch = { apiOk("/repos/${enc(r.owner)}/${enc(r.repo)}") },
            parse = { s ->
                val o = JSONObject(s)
                RepoMeta(
                    stars = o.optInt("stargazers_count"),
                    forks = o.optInt("forks_count"),
                    openIssues = o.optInt("open_issues_count"),
                    license = o.optJSONObject("license")?.let { if (it.isNull("spdx_id")) "" else it.optString("spdx_id", "") }
                        ?.takeIf { it != "NOASSERTION" }.orEmpty(),
                    pushedAt = if (o.isNull("pushed_at")) "" else o.optString("pushed_at", ""),
                    homepage = if (o.isNull("homepage")) "" else o.optString("homepage", ""),
                    archived = o.optBoolean("archived"),
                )
            },
        )

    suspend fun loadReleases(r: GithubRepo): Loaded<List<Release>> =
        cached(
            "releases:${r.owner}/${r.repo}", TTL_RELEASES,
            fetch = {
                val base = "/repos/${enc(r.owner)}/${enc(r.repo)}"
                val rel = apiOk("$base/releases?per_page=30")
                val parsed = rel?.let { parseReleases(it, r) }.orEmpty()
                if (parsed.isNotEmpty()) rel
                else {
                    // no releases published: fall back to plain tags
                    val tags = apiOk("$base/tags?per_page=30")
                    if (tags == null) "[]" else tagsAsReleases(tags, r)
                }
            },
            parse = { s -> parseReleases(s, r) },
        )

    private fun parseReleases(json: String, r: GithubRepo): List<Release> {
        val arr = JSONArray(json)
        val out = ArrayList<Release>()
        for (i in 0 until arr.length()) {
            val o = arr.optJSONObject(i) ?: continue
            val tag = o.optString("tag_name", "")
            if (tag.isEmpty()) {
                // our own synthetic "tag only" rows
                val t = o.optString("tag", "")
                if (t.isNotEmpty() && o.optBoolean("tag_only")) {
                    out += Release(t, "", "", false, "https://github.com/${r.owner}/${r.repo}/releases/tag/${enc(t)}", "", emptyList(), true)
                }
                continue
            }
            if (o.optBoolean("draft")) continue
            val assets = ArrayList<ReleaseAsset>()
            o.optJSONArray("assets")?.let { a ->
                for (k in 0 until a.length()) {
                    val x = a.optJSONObject(k) ?: continue
                    assets += ReleaseAsset(
                        name = x.optString("name", "file"),
                        size = x.optLong("size"),
                        downloads = x.optInt("download_count"),
                        url = x.optString("browser_download_url", ""),
                    )
                }
            }
            out += Release(
                tag = tag,
                name = if (o.isNull("name")) "" else o.optString("name", ""),
                date = if (o.isNull("published_at")) o.optString("created_at", "") else o.optString("published_at", ""),
                prerelease = o.optBoolean("prerelease"),
                url = o.optString("html_url", "https://github.com/${r.owner}/${r.repo}/releases/tag/${enc(tag)}"),
                body = (if (o.isNull("body")) "" else o.optString("body", "")).take(6000),
                assets = assets,
            )
        }
        return out
    }

    private fun tagsAsReleases(json: String, r: GithubRepo): String {
        val arr = JSONArray(json)
        val out = JSONArray()
        for (i in 0 until arr.length()) {
            val n = arr.optJSONObject(i)?.optString("name", "").orEmpty()
            if (n.isNotEmpty()) out.put(JSONObject().put("tag", n).put("tag_only", true))
        }
        return out.toString()
    }

    suspend fun loadTree(r: GithubRepo, ref: String): Loaded<RepoTree> =
        cached(
            "tree:${r.owner}/${r.repo}@$ref", TTL_TREE,
            fetch = { apiOk("/repos/${enc(r.owner)}/${enc(r.repo)}/git/trees/${encPath(ref)}?recursive=1") },
            parse = { s ->
                val o = JSONObject(s)
                val arr = o.optJSONArray("tree") ?: JSONArray()
                val items = ArrayList<TreeItem>(arr.length())
                for (i in 0 until arr.length()) {
                    val t = arr.optJSONObject(i) ?: continue
                    val type = t.optString("type")
                    if (type != "blob" && type != "tree") continue
                    items += TreeItem(t.optString("path"), type == "tree", t.optLong("size"))
                }
                RepoTree(items, o.optBoolean("truncated"))
            },
        )

    suspend fun loadFile(r: GithubRepo, ref: String, path: String): Loaded<String> =
        cached(
            "src:${r.owner}/${r.repo}@$ref:$path", TTL_FILE,
            fetch = { fetchRaw(r, ref, path)?.take(300_000) },
            parse = { it },
        )

    private companion object {
        const val KEY_INDEX = "index"
        val INDEX_URLS = listOf(
            "https://raw.githubusercontent.com/HackerOS-Linux-System/bit/main/index/repository.json",
        )
        val MANIFESTS = listOf("Bit.hk", "bit.hk", "Bytes.hk", "Virus.hk")
        val README_FILES = listOf("README.md", "Readme.md", "readme.md", "README.markdown", "README.MD", "README", "README.txt", "README.rst")

        const val HOUR = 3_600_000L
        const val TTL_MANIFEST = 6 * HOUR
        const val TTL_README = 6 * HOUR
        const val TTL_META = 1 * HOUR
        const val TTL_RELEASES = 1 * HOUR
        const val TTL_TREE = 6 * HOUR
        const val TTL_FILE = 24 * HOUR
    }
}
