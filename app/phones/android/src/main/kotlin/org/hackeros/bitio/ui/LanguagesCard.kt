package org.hackeros.bitio.ui

import android.graphics.BitmapFactory
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.hackeros.bitio.data.BitRepository
import org.hackeros.bitio.data.GithubRepo
import org.hackeros.bitio.data.TreeItem
import org.hackeros.bitio.markdown.extOf
import java.net.HttpURLConnection
import java.net.URL

/* "Languages" card: what a library is written in (like GitHub's linguist bar).
 * Same extension table and colours as website/src/langcolors.ts; md / json / yml are not counted. */

private val EXTENSION_TO_LANGUAGE = mapOf(
    "h#" to "H#",
    "h#i" to "H# Interface",
    "hk" to "hk",
    "hcs" to "HackerScript",
    "hl" to "Hacker Lang",
    "js" to "JavaScript",
    "jsx" to "JavaScript",
    "mjs" to "JavaScript",
    "cjs" to "JavaScript",
    "ts" to "TypeScript",
    "tsx" to "TypeScript",
    "py" to "Python",
    "pyw" to "Python",
    "java" to "Java",
    "c" to "C",
    "h" to "C",
    "cpp" to "C++",
    "cc" to "C++",
    "cxx" to "C++",
    "hpp" to "C++",
    "hh" to "C++",
    "hxx" to "C++",
    "cs" to "C#",
    "go" to "Go",
    "rs" to "Rust",
    "rb" to "Ruby",
    "php" to "PHP",
    "swift" to "Swift",
    "kt" to "Kotlin",
    "kts" to "Kotlin",
    "dart" to "Dart",
    "html" to "HTML",
    "htm" to "HTML",
    "css" to "CSS",
    "sh" to "Shell",
    "bash" to "Shell",
    "zsh" to "Shell",
    "ps1" to "PowerShell",
    "psm1" to "PowerShell",
    "scala" to "Scala",
    "sc" to "Scala",
    "hs" to "Haskell",
    "lhs" to "Haskell",
    "lua" to "Lua",
    "pl" to "Perl",
    "pm" to "Perl",
    "r" to "R",
    "m" to "Objective-C",
    "mm" to "Objective-C",
    "ex" to "Elixir",
    "exs" to "Elixir",
    "clj" to "Clojure",
    "cljs" to "Clojure",
    "cljc" to "Clojure",
    "zig" to "Zig",
    "ml" to "OCaml",
    "mli" to "OCaml",
    "erl" to "Erlang",
    "hrl" to "Erlang",
    "jl" to "Julia",
    "vim" to "Vim script",
    "vue" to "Vue",
    "svelte" to "Svelte",
    "asm" to "Assembly",
    "s" to "Assembly",
    "cr" to "Crystal",
    "nim" to "Nim",
    "sol" to "Solidity",
)

private val LANGUAGE_COLORS: Map<String, Long> = mapOf(
    "H#" to 0xFF9C1120,
    "H# Interface" to 0xFFC23B4E,
    "hk" to 0xFFFFFFFF,
    "HackerScript" to 0xFF4B4B55,
    "Hacker Lang" to 0xFF8250DF,
    "JavaScript" to 0xFFF1E05A,
    "TypeScript" to 0xFF3178C6,
    "Python" to 0xFF3572A5,
    "Java" to 0xFFB07219,
    "C" to 0xFF555555,
    "C++" to 0xFFF34B7D,
    "C#" to 0xFF178600,
    "Go" to 0xFF00ADD8,
    "Rust" to 0xFFDEA584,
    "Ruby" to 0xFF701516,
    "PHP" to 0xFF4F5D95,
    "Swift" to 0xFFF05138,
    "Kotlin" to 0xFFA97BFF,
    "Dart" to 0xFF00B4AB,
    "HTML" to 0xFFE34C26,
    "CSS" to 0xFF563D7C,
    "Shell" to 0xFF89E051,
    "PowerShell" to 0xFF012456,
    "Scala" to 0xFFC22D40,
    "Haskell" to 0xFF5E5086,
    "Lua" to 0xFF000080,
    "Perl" to 0xFF0298C3,
    "R" to 0xFF198CE7,
    "Objective-C" to 0xFF438EFF,
    "Elixir" to 0xFF6E4A7E,
    "Clojure" to 0xFFDB5855,
    "Zig" to 0xFFEC915C,
    "OCaml" to 0xFF3BE133,
    "Erlang" to 0xFFB83998,
    "Julia" to 0xFFA270BA,
    "Vim script" to 0xFF199F4B,
    "Vue" to 0xFF41B883,
    "Svelte" to 0xFFFF3E00,
    "Assembly" to 0xFF6E4C13,
    "Crystal" to 0xFF000100,
    "Nim" to 0xFFFFC200,
    "Solidity" to 0xFFAA6746,
)

private class LangShare(val name: String, val pct: Double)

/** Languages by share of bytes, biggest first. */
private fun breakdown(items: List<TreeItem>): List<LangShare> {
    val totals = HashMap<String, Long>()
    for (item in items) {
        if (item.isDir) continue
        val ext = extOf(item.path)
        val lang = EXTENSION_TO_LANGUAGE[ext] ?: EXTENSION_TO_LANGUAGE[ext.substringAfterLast('.')] ?: continue
        totals[lang] = (totals[lang] ?: 0L) + item.size
    }
    val sum = totals.values.sum().toDouble()
    if (sum <= 0.0) return emptyList()
    return totals.entries.sortedByDescending { it.value }.map { LangShare(it.key, it.value / sum * 100.0) }
}

private fun colorOf(name: String): Color = Color(LANGUAGE_COLORS[name] ?: 0xFF8F8FA3)

/** Swatches that vanish on a white or dark card (hk is white, HackerScript is dark grey) get an outline. */
private fun needsOutline(name: String) = name == "hk" || name == "HackerScript"

private class LangBrand(val label: String, val url: String, val top: Color, val bottom: Color, val border: Color)

private val BRANDS = mapOf(
    "H#" to LangBrand("H#", "https://raw.githubusercontent.com/HackerOS-Linux-System/H-Sharp/main/images/icon.png", Color(0xFF2A0D12), Color(0xFF0B0B0D), Color(0xFF5C0710)),
    "HackerScript" to LangBrand("HackerScript", "https://raw.githubusercontent.com/HackerOS-Linux-System/HackerScript/main/images/icon.png", Color(0xFF3A3A42), Color(0xFF1C1C21), Color(0xFF55555F)),
    "Hacker Lang" to LangBrand("Hacker Lang", "https://raw.githubusercontent.com/HackerOS-Linux-System/Hacker-Lang/main/images/icon.png", Color(0xFF1F1536), Color(0xFF0B0B0D), Color(0xFF3D2A6B)),
)

private val iconCache = java.util.concurrent.ConcurrentHashMap<String, ImageBitmap>()

/** Downloads [url] (the project's real icon on GitHub). Nothing is bundled: an empty placeholder is shown while loading and when offline. */
@Composable
private fun RemoteIcon(url: String, modifier: Modifier = Modifier) {
    val bitmap by produceState<ImageBitmap?>(iconCache[url], url) {
        if (value != null) return@produceState
        value = withContext(Dispatchers.IO) {
            try {
                val conn = URL(url).openConnection() as HttpURLConnection
                conn.connectTimeout = 8000
                conn.readTimeout = 8000
                try {
                    if (conn.responseCode == 200) {
                        val opts = BitmapFactory.Options().apply { inSampleSize = 4 } // the source icon is ~1250 px
                        BitmapFactory.decodeStream(conn.inputStream, null, opts)?.asImageBitmap()?.also { iconCache[url] = it }
                    } else null
                } finally {
                    conn.disconnect()
                }
            } catch (e: Exception) {
                null
            }
        }
    }
    val bmp = bitmap
    if (bmp != null) Image(bmp, contentDescription = null, modifier = modifier)
    else Box(modifier.background(Color(0x22FFFFFF)))
}

/** "H# leads this repo" with the project's own icon, for the three HackerOS languages. */
@Composable
private fun LeadBadge(brand: LangBrand, pct: Double) {
    Row(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(Brush.linearGradient(listOf(brand.top, brand.bottom)))
            .border(1.dp, brand.border, RoundedCornerShape(12.dp))
            .padding(horizontal = 10.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        RemoteIcon(brand.url, Modifier.size(36.dp).clip(RoundedCornerShape(8.dp)))
        Column {
            Text("${brand.label} leads this repo", color = Color.White, fontWeight = FontWeight.Bold, fontSize = 13.sp)
            Text("${"%.1f".format(pct)}% of tracked bytes", color = Color(0xFFA8A8B3), fontSize = 11.sp)
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun LanguagesCard(gh: GithubRepo, ref: String, repo: BitRepository) {
    val tree by rememberLoad(gh, ref) { repo.loadTree(gh, ref) }
    val t = tree
    if (t !is Load.Ok) return
    val shares = remember(t.value) { breakdown(t.value.items) }
    if (shares.isEmpty()) return

    val shown = shares.take(6)
    val otherPct = shares.drop(6).sumOf { it.pct }
    val brand = BRANDS[shares.first().name]
    val dark = isDarkTheme()

    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        if (brand != null) LeadBadge(brand, shares.first().pct)
        Column(
            Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(12.dp))
                .background(MaterialTheme.colorScheme.surfaceVariant)
                .padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Text("Languages", fontWeight = FontWeight.SemiBold, fontSize = 13.sp)
            Row(
                Modifier.fillMaxWidth().height(8.dp).clip(RoundedCornerShape(50)).background(MaterialTheme.colorScheme.outlineVariant),
            ) {
                for (s in shown) Box(Modifier.weight(s.pct.toFloat().coerceAtLeast(0.6f)).height(8.dp).background(colorOf(s.name)))
                if (otherPct > 0.0) Box(Modifier.weight(otherPct.toFloat().coerceAtLeast(0.6f)).height(8.dp).background(Color(0xFF8F8FA3)))
            }
            FlowRow(horizontalArrangement = Arrangement.spacedBy(14.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                for (s in shown) Legend(s.name, s.pct, colorOf(s.name), outline = needsOutline(s.name), dark = dark)
                if (otherPct > 0.0) Legend("Other", otherPct, Color(0xFF8F8FA3), outline = false, dark = dark)
            }
            if (t.value.truncated) {
                Text("Large repository: GitHub truncated the file list, shares are approximate.", color = BitColors.Warn, fontSize = 11.sp)
            }
        }
    }
}

@Composable
private fun Legend(name: String, pct: Double, color: Color, outline: Boolean, dark: Boolean) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Box(
            Modifier
                .size(9.dp)
                .clip(RoundedCornerShape(50))
                .background(color)
                .then(if (outline) Modifier.border(1.dp, if (dark) Color(0xFF8B8B9C) else Color(0xFF6E6E85), RoundedCornerShape(50)) else Modifier),
        )
        Box(Modifier.width(6.dp))
        Text(name, fontSize = 12.sp, fontWeight = FontWeight.Medium)
        Box(Modifier.width(4.dp))
        Text("${"%.1f".format(pct)}%", fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}
