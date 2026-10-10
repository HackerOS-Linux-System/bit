package org.hackeros.bitio.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedCard
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import org.hackeros.bitio.R
import org.hackeros.bitio.data.LibEntry
import org.hackeros.bitio.data.Lang
import org.hackeros.bitio.data.LibraryStore
import org.hackeros.bitio.data.safeUrl

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun LibrariesScreen(store: LibraryStore, onOpen: (String) -> Unit) {
    Scaffold(
        contentWindowInsets = WindowInsets(0, 0, 0, 0),
        topBar = {
            TopAppBar(
                title = {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Image(painterResource(R.drawable.bit_icon), contentDescription = null, modifier = Modifier.size(28.dp))
                        Spacer(Modifier.width(10.dp))
                        Text("bit.io", fontWeight = FontWeight.Bold)
                    }
                },
                actions = {
                    TextButton(onClick = { store.refresh() }, enabled = !store.loading) {
                        Text(if (store.loading) "Updating…" else "Refresh")
                    }
                },
            )
        },
    ) { inner ->
        val list = store.filtered()
        val tags = store.tag
        LazyColumn(
            Modifier.fillMaxSize().padding(inner),
            contentPadding = PaddingValues(bottom = 24.dp),
        ) {
            item(key = "hero") { Hero(store) }
            item(key = "controls") { Controls(store) }
            store.offlineNote?.let { note ->
                item(key = "offline") {
                    Text(
                        note,
                        color = BitColors.Warn,
                        style = MaterialTheme.typography.bodySmall,
                        modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp),
                    )
                }
            }
            store.error?.let { err ->
                item(key = "error") {
                    Notice("Could not load the index: $err", MaterialTheme.colorScheme.error, Modifier.padding(horizontal = 16.dp))
                }
            }
            item(key = "count") {
                Text(
                    "${list.size} of ${store.libraries.size} libraries" + if (tags.isNotEmpty()) "  ·  tag: $tags" else "",
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
                )
            }
            if (list.isEmpty() && store.libraries.isNotEmpty()) {
                item(key = "empty") {
                    Notice("Nothing matches. Try another search or clear the filters.", modifier = Modifier.padding(horizontal = 16.dp))
                }
            }
            items(list, key = { it.name }) { lib ->
                LibraryCard(lib, onOpen = { onOpen(lib.name) }, onTag = { store.tag = it })
            }
        }
    }
}

@Composable
private fun Hero(store: LibraryStore) {
    val langs = store.libraries.map { it.lang }.filter { it != Lang.ANY }.toSet().size.coerceAtLeast(3)
    Column(
        Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 20.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(
            "bit.io",
            style = MaterialTheme.typography.displaySmall.copy(
                brush = Brush.linearGradient(listOf(BitColors.Purple, BitColors.Pink, BitColors.Orange)),
                fontWeight = FontWeight.ExtraBold,
            ),
        )
        Text(
            "one index for every HackerOS language",
            style = MaterialTheme.typography.titleMedium,
            fontWeight = FontWeight.SemiBold,
            textAlign = TextAlign.Center,
        )
        Text(
            "Libraries for H#, Hacker Lang and HackerScript - installed checksummed and linked statically by bit.",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center,
            modifier = Modifier.padding(top = 6.dp),
        )
        Row(Modifier.padding(top = 16.dp), horizontalArrangement = Arrangement.spacedBy(28.dp)) {
            Stat(store.libraries.size.toString(), "libraries")
            Stat(langs.toString(), "languages")
            Stat(store.index?.updatedAt?.ifEmpty { "-" } ?: "-", "index updated")
        }
    }
}

@Composable
private fun Stat(value: String, label: String) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Text(value, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
        Text(label, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
private fun Controls(store: LibraryStore) {
    Column(Modifier.padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        OutlinedTextField(
            value = store.query,
            onValueChange = { store.query = it },
            modifier = Modifier.fillMaxWidth(),
            singleLine = true,
            placeholder = { Text("Search libraries, tags, authors…") },
            shape = RoundedCornerShape(14.dp),
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
            trailingIcon = {
                if (store.query.isNotEmpty()) TextButton(onClick = { store.query = "" }) { Text("Clear") }
            },
        )
        LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            item {
                FilterChip(selected = store.lang == null, onClick = { store.lang = null }, label = { Text("All languages") })
            }
            items(Lang.filterable) { l ->
                FilterChip(selected = store.lang == l, onClick = { store.lang = l }, label = { Text(l.label) })
            }
            if (store.tag.isNotEmpty()) {
                item {
                    FilterChip(selected = true, onClick = { store.tag = "" }, label = { Text("tag: ${store.tag}  ✕") })
                }
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun LibraryCard(lib: LibEntry, onOpen: () -> Unit, onTag: (String) -> Unit) {
    val uri = LocalUriHandler.current
    OutlinedCard(
        onClick = onOpen,
        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 6.dp),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
    ) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    lib.name,
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.Bold,
                    color = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.weight(1f),
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                LangBadge(lib.lang)
            }
            Text(
                lib.description.ifEmpty { "No description." },
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            if (lib.tags.isNotEmpty()) {
                FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    lib.tags.take(5).forEach { t -> TagChip(t) { onTag(t) } }
                }
            }
            CommandRow(lib.installCommand)
            Row(verticalAlignment = Alignment.CenterVertically) {
                if (lib.author.isNotEmpty()) {
                    Text(lib.author, fontSize = 12.sp, color = MaterialTheme.colorScheme.outline, modifier = Modifier.weight(1f))
                } else {
                    Spacer(Modifier.weight(1f))
                }
                safeUrl(lib.target)?.let { url -> TextButton(onClick = { uri.openUri(url) }) { Text("source ↗") } }
            }
        }
    }
}
