package org.hackeros.bitio.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedCard
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Tab
import androidx.compose.material3.TabRow
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import org.hackeros.bitio.data.BitRepository
import org.hackeros.bitio.data.DepKind
import org.hackeros.bitio.data.GithubRepo
import org.hackeros.bitio.data.Hk
import org.hackeros.bitio.data.LibEntry
import org.hackeros.bitio.data.Loaded
import org.hackeros.bitio.data.Manifest
import org.hackeros.bitio.data.Readme
import org.hackeros.bitio.data.Release
import org.hackeros.bitio.data.RepoMeta
import org.hackeros.bitio.data.TreeItem
import org.hackeros.bitio.data.classifyDep
import org.hackeros.bitio.data.compatNotes
import org.hackeros.bitio.data.dependenciesOf
import org.hackeros.bitio.data.formatAge
import org.hackeros.bitio.data.formatBytes
import org.hackeros.bitio.data.LibraryStore
import org.hackeros.bitio.data.safeUrl
import org.hackeros.bitio.markdown.CodeBlock
import org.hackeros.bitio.markdown.MarkdownParser
import org.hackeros.bitio.markdown.MdBlock
import org.hackeros.bitio.markdown.MdBlockView
import java.time.Instant

private val TABS = listOf("Overview", "Source", "Versions")

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun LibraryDetailScreen(
    name: String,
    store: LibraryStore,
    repo: BitRepository,
    onBack: () -> Unit,
    onOpenLib: (String) -> Unit,
) {
    val entry = store.find(name)
    val uri = LocalUriHandler.current

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(entry?.name ?: name, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis) },
                navigationIcon = {
                    IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back") }
                },
                actions = {
                    val url = entry?.let { safeUrl(it.target) }
                    if (url != null) TextButton(onClick = { uri.openUri(url) }) { Text("GitHub ↗") }
                },
            )
        },
    ) { inner ->
        if (entry == null) {
            Column(Modifier.padding(inner).padding(16.dp)) {
                Notice("\"$name\" is not in the index.")
                TextButton(onClick = onBack) { Text("Browse the index") }
            }
            return@Scaffold
        }

        val gh = entry.github
        val defaultRef = entry.rev.ifEmpty { "HEAD" }
        var ref by rememberSaveable(entry.name) { mutableStateOf(defaultRef) }
        var tab by rememberSaveable(entry.name) { mutableIntStateOf(0) }

        Column(Modifier.fillMaxSize().padding(inner)) {
            Column(Modifier.padding(horizontal = 16.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    LangBadge(entry.lang)
                    if (ref != defaultRef) {
                        Text("version $ref", style = MaterialTheme.typography.labelMedium, color = BitColors.Warn)
                        TextButton(onClick = { ref = defaultRef }) { Text("Back to default") }
                    }
                }
                if (entry.description.isNotEmpty()) {
                    Text(entry.description, style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                if (entry.tags.isNotEmpty()) {
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        entry.tags.forEach { TagChip(it) }
                    }
                }
            }
            TabRow(selectedTabIndex = tab) {
                TABS.forEachIndexed { i, label ->
                    Tab(selected = tab == i, onClick = { tab = i }, text = { Text(label) })
                }
            }
            when (tab) {
                0 -> OverviewTab(entry, gh, ref, repo, store.libraries, onOpenLib)
                1 -> SourceTab(gh, ref, repo)
                else -> VersionsTab(gh, ref, repo) { newRef ->
                    ref = newRef
                    tab = 0
                }
            }
        }
    }
}

/* ------------------------------------------------------------------ overview */

@Composable
private fun OverviewTab(
    entry: LibEntry,
    gh: GithubRepo?,
    ref: String,
    repo: BitRepository,
    libs: List<LibEntry>,
    onOpenLib: (String) -> Unit,
) {
    val uri = LocalUriHandler.current
    val manifest by rememberLoad(gh, ref) { if (gh == null) Loaded<Manifest>(null) else repo.loadManifest(gh, ref) }
    val meta by rememberLoad(gh) { if (gh == null) Loaded<RepoMeta>(null) else repo.loadMeta(gh) }
    val readme by rememberLoad(gh, ref) { if (gh == null) Loaded<Readme>(null) else repo.loadReadme(gh, ref) }

    val readmeBlocks = remember(readme) {
        (readme as? Load.Ok)?.value?.let { r ->
            if (r.markdown) MarkdownParser.parse(r.text) else listOf<MdBlock>(MdBlock.Code("", r.text))
        } ?: emptyList()
    }

    LazyColumn(
        Modifier.fillMaxSize(),
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item {
            SectionCard("Install") {
                CommandRow(entry.installCommand)
                CommandRow(entry.addCommand)
                Text("add also writes it to [dependencies] in Bit.hk.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.outline)
            }
        }

        item {
            SectionCard("About") {
                val doc = (manifest as? Load.Ok)?.value?.doc
                val pkg = doc?.get("package") ?: doc?.get("project") ?: emptyMap()
                val m = (meta as? Load.Ok)?.value
                KeyValue("Language", entry.lang.label)
                pkg["version"]?.takeIf { it.isNotEmpty() }?.let { KeyValue("Version", it) }
                (pkg["license"]?.takeIf { it.isNotEmpty() } ?: m?.license?.takeIf { it.isNotEmpty() })?.let { KeyValue("License", it) }
                if (entry.author.isNotEmpty()) KeyValue("Author", entry.author)
                val authors = Hk.list(pkg["authors"])
                if (authors.isNotEmpty()) KeyValue("Authors", authors.joinToString(", "))
                KeyValue("Library output", "${doc?.get("lib")?.get("output")?.ifEmpty { null } ?: "hlib"} - static")
                if (entry.target.isNotEmpty()) KeyValue("Repository", entry.target.removePrefix("https://"))
                m?.homepage?.let { hp -> safeUrl(hp)?.let { KeyValue("Homepage", hp.removePrefix("https://").removePrefix("http://")) } }
                if (manifest is Load.Loading && gh != null) Spinner()
            }
        }

        if (gh != null) {
            item {
                SectionCard("GitHub") {
                    LoadView(meta, "No repository data.") { m, stale ->
                        Row(horizontalArrangement = Arrangement.spacedBy(20.dp)) {
                            Stat2("★ ${compactNumber(m.stars)}", "stars")
                            Stat2(compactNumber(m.forks), "forks")
                            Stat2(compactNumber(m.openIssues), "issues")
                        }
                        activity(m.pushedAt)?.let { (label, color) ->
                            Text("$label · last push ${m.pushedAt.take(10)}", color = color, style = MaterialTheme.typography.bodySmall)
                        }
                        if (m.archived) Text("This repository is archived.", color = BitColors.Warn, style = MaterialTheme.typography.bodySmall)
                        if (stale) Text("Saved copy (offline).", color = BitColors.Warn, style = MaterialTheme.typography.bodySmall)
                    }
                }
            }
        }

        val doc = (manifest as? Load.Ok)?.value?.doc
        if (doc != null) {
            val deps = dependenciesOf(doc)
            val notes = compatNotes(entry, doc, libs)
            if (deps.isNotEmpty() || notes.isNotEmpty()) {
                item {
                    SectionCard("Compatibility & dependencies") {
                        notes.forEach { (ok, text) ->
                            Text(
                                (if (ok) "✓ " else "⚠ ") + text,
                                style = MaterialTheme.typography.bodySmall,
                                color = if (ok) BitColors.Ok else BitColors.Warn,
                            )
                        }
                        if (deps.isNotEmpty()) {
                            if (notes.isNotEmpty()) HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                            deps.forEach { d ->
                                val (kind, lib) = classifyDep(d, libs)
                                Row(
                                    Modifier.fillMaxWidth().then(if (lib != null) Modifier.clickable { onOpenLib(lib.name) } else Modifier).padding(vertical = 4.dp),
                                    verticalAlignment = Alignment.CenterVertically,
                                ) {
                                    Text(
                                        d.name,
                                        fontFamily = FontFamily.Monospace,
                                        fontWeight = FontWeight.SemiBold,
                                        color = if (lib != null) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurface,
                                        modifier = Modifier.width(120.dp),
                                        maxLines = 1,
                                        overflow = TextOverflow.Ellipsis,
                                    )
                                    Text(
                                        d.spec.ifEmpty { "*" } + when (kind) {
                                            DepKind.INDEX -> "  ·  in the index"
                                            DepKind.GIT -> "  ·  git"
                                            DepKind.PATH -> "  ·  local path"
                                            DepKind.UNKNOWN -> "  ·  not in the index"
                                        },
                                        style = MaterialTheme.typography.bodySmall,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    )
                                }
                            }
                        }
                    }
                }
            }
        }

        if (entry.rev.isNotEmpty() || entry.checksum.isNotEmpty()) {
            item {
                SectionCard("Pinned revision") {
                    if (entry.rev.isNotEmpty()) KeyValue("Revision", entry.rev)
                    if (entry.checksum.isNotEmpty()) {
                        Text("sha256 (checked by `bit verify`)", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.outline)
                        Text(entry.checksum, fontFamily = FontFamily.Monospace, fontSize = 11.sp)
                    }
                }
            }
        }

        item {
            Text("README", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
        }
        if (gh == null) {
            item { Notice("This library isn't hosted on GitHub, so its README can't be shown here.") }
        } else when (val r = readme) {
            Load.Loading -> item { Spinner() }
            Load.Missing -> item { Notice("This repository has no README.") }
            is Load.Failed -> item {
                Column {
                    Notice(r.message, MaterialTheme.colorScheme.error)
                    OutlinedButton(onClick = { uri.openUri(entry.target) }) { Text("Open on GitHub") }
                }
            }
            is Load.Ok -> {
                if (r.stale) item { Notice("Saved copy (offline).", BitColors.Warn) }
                items(readmeBlocks) { MdBlockView(it) }
            }
        }
    }
}

@Composable
private fun Stat2(value: String, label: String) {
    Column {
        Text(value, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
        Text(label, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

private fun activity(pushedAt: String): Pair<String, androidx.compose.ui.graphics.Color>? {
    val t = runCatching { Instant.parse(pushedAt).toEpochMilli() }.getOrNull() ?: return null
    val days = (System.currentTimeMillis() - t) / 86_400_000.0
    return when {
        days < 90 -> "Active" to BitColors.Ok
        days < 365 -> "Quiet" to BitColors.Warn
        else -> "Inactive" to BitColors.Err
    }
}

/* -------------------------------------------------------------------- source */

@Composable
private fun SourceTab(gh: GithubRepo?, ref: String, repo: BitRepository) {
    if (gh == null) {
        Notice("This library isn't hosted on GitHub, so its source can't be browsed here.", modifier = Modifier.padding(16.dp))
        return
    }
    val tree by rememberLoad(gh, ref) { repo.loadTree(gh, ref) }
    var dir by rememberSaveable(gh.repo, ref) { mutableStateOf("") }
    var file by rememberSaveable(gh.repo, ref) { mutableStateOf<String?>(null) }

    BackHandler(enabled = file != null || dir.isNotEmpty()) {
        if (file != null) file = null else dir = dir.substringBeforeLast('/', "")
    }

    val openFile = file
    if (openFile != null) {
        FileViewer(gh, ref, repo, openFile, onClose = { file = null })
        return
    }

    when (val t = tree) {
        Load.Loading -> Spinner()
        Load.Missing -> Notice("Repository not found.", modifier = Modifier.padding(16.dp))
        is Load.Failed -> Notice(t.message, MaterialTheme.colorScheme.error, Modifier.padding(16.dp))
        is Load.Ok -> {
            val prefix = if (dir.isEmpty()) "" else "$dir/"
            val children = remember(t.value, dir) {
                t.value.items
                    .filter { it.path.startsWith(prefix) && !it.path.removePrefix(prefix).contains('/') }
                    .sortedWith(compareBy<TreeItem>({ !it.isDir }, { it.path.lowercase() }))
            }
            LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(vertical = 8.dp)) {
                item {
                    Row(Modifier.padding(horizontal = 16.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text(
                            "${gh.repo}/" + dir,
                            fontFamily = FontFamily.Monospace,
                            fontSize = 12.sp,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.weight(1f),
                        )
                        if (dir.isNotEmpty()) TextButton(onClick = { dir = dir.substringBeforeLast('/', "") }) { Text("↑ Up") }
                    }
                    if (t.value.truncated) {
                        Text("The repository is large: GitHub truncated the file list.", color = BitColors.Warn, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(horizontal = 16.dp))
                    }
                    if (t.stale) Text("Saved copy (offline).", color = BitColors.Warn, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(horizontal = 16.dp))
                }
                items(children, key = { it.path }) { item ->
                    Row(
                        Modifier
                            .fillMaxWidth()
                            .clickable { if (item.isDir) dir = item.path else file = item.path }
                            .padding(horizontal = 16.dp, vertical = 12.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(if (item.isDir) "📁" else "📄", modifier = Modifier.width(32.dp))
                        Text(
                            item.path.removePrefix(prefix),
                            fontFamily = FontFamily.Monospace,
                            fontSize = 14.sp,
                            modifier = Modifier.weight(1f),
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                        if (!item.isDir) Text(formatBytes(item.size), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.outline)
                    }
                    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                }
                if (children.isEmpty()) item { Notice("Empty directory.", modifier = Modifier.padding(16.dp)) }
            }
        }
    }
}

@Composable
private fun FileViewer(gh: GithubRepo, ref: String, repo: BitRepository, path: String, onClose: () -> Unit) {
    val file by rememberLoad(gh, ref, path) { repo.loadFile(gh, ref, path) }
    Column(Modifier.fillMaxSize()) {
        Row(Modifier.padding(horizontal = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            TextButton(onClick = onClose) { Text("← Files") }
            Text(path, fontFamily = FontFamily.Monospace, fontSize = 12.sp, modifier = Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
        when (val f = file) {
            Load.Loading -> Spinner()
            Load.Missing -> Notice("File not found.", modifier = Modifier.padding(16.dp))
            is Load.Failed -> Notice(f.message, MaterialTheme.colorScheme.error, Modifier.padding(16.dp))
            is Load.Ok -> {
                if (f.value.contains('\u0000')) {
                    Notice("Binary file - not shown.", modifier = Modifier.padding(16.dp))
                } else {
                    val lines = remember(f.value) { f.value.lines().take(5000) }
                    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(vertical = 8.dp)) {
                        items(lines.size) { i ->
                            Row(Modifier.padding(horizontal = 12.dp)) {
                                Text(
                                    (i + 1).toString(),
                                    fontFamily = FontFamily.Monospace,
                                    fontSize = 11.sp,
                                    color = MaterialTheme.colorScheme.outline,
                                    modifier = Modifier.width(40.dp),
                                )
                                Text(lines[i], fontFamily = FontFamily.Monospace, fontSize = 12.sp, lineHeight = 17.sp, modifier = Modifier.weight(1f))
                            }
                        }
                    }
                }
            }
        }
    }
}

/* ------------------------------------------------------------------ versions */

@Composable
private fun VersionsTab(gh: GithubRepo?, ref: String, repo: BitRepository, onView: (String) -> Unit) {
    if (gh == null) {
        Notice("This library isn't hosted on GitHub, so its releases can't be listed here.", modifier = Modifier.padding(16.dp))
        return
    }
    val releases by rememberLoad(gh) { repo.loadReleases(gh) }
    val uri = LocalUriHandler.current

    when (val r = releases) {
        Load.Loading -> Spinner()
        Load.Missing -> Notice("No releases.", modifier = Modifier.padding(16.dp))
        is Load.Failed -> Notice(r.message, MaterialTheme.colorScheme.error, Modifier.padding(16.dp))
        is Load.Ok -> {
            if (r.value.isEmpty()) {
                Notice("This repository has no releases or tags.", modifier = Modifier.padding(16.dp))
                return
            }
            LazyColumn(
                Modifier.fillMaxSize(),
                contentPadding = PaddingValues(16.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                if (r.stale) item { Notice("Saved copy (offline).", BitColors.Warn) }
                items(r.value, key = { it.tag }) { rel ->
                    ReleaseCard(rel, current = rel.tag == ref, onView = { onView(rel.tag) }, onOpen = { safeUrl(rel.url)?.let(uri::openUri) })
                }
            }
        }
    }
}

@Composable
private fun ReleaseCard(rel: Release, current: Boolean, onView: () -> Unit, onOpen: () -> Unit) {
    var expanded by rememberSaveable(rel.tag) { mutableStateOf(false) }
    val uri = LocalUriHandler.current
    OutlinedCard(Modifier.fillMaxWidth(), border = BorderStroke(1.dp, if (current) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.outlineVariant)) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(rel.tag, fontFamily = FontFamily.Monospace, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
                if (rel.prerelease) TagChip("pre-release")
                if (current) TagChip("viewing")
            }
            val sub = listOfNotNull(rel.name.takeIf { it.isNotEmpty() && it != rel.tag }, rel.date.take(10).takeIf { it.isNotEmpty() }).joinToString("  ·  ")
            if (sub.isNotEmpty()) Text(sub, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            if (rel.tagOnly) Text("Tag only - no release was published.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.outline)

            if (rel.body.isNotBlank()) {
                if (expanded) {
                    val blocks = remember(rel.body) { MarkdownParser.parse(rel.body) }
                    Column { blocks.forEach { MdBlockView(it) } }
                }
                TextButton(onClick = { expanded = !expanded }) { Text(if (expanded) "Hide notes" else "Release notes") }
            }
            rel.assets.forEach { a ->
                Row(
                    Modifier.fillMaxWidth().clickable(enabled = safeUrl(a.url) != null) { safeUrl(a.url)?.let(uri::openUri) }.padding(vertical = 4.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text("⬇ ${a.name}", fontFamily = FontFamily.Monospace, fontSize = 12.sp, color = MaterialTheme.colorScheme.primary, modifier = Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text(formatBytes(a.size), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.outline)
                }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                if (!current) Button(onClick = onView) { Text("View this version") }
                OutlinedButton(onClick = onOpen) { Text("GitHub ↗") }
            }
        }
    }
}
