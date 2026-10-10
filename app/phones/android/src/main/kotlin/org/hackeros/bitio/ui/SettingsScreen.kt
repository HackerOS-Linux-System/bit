package org.hackeros.bitio.ui

import android.content.Context
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import org.hackeros.bitio.data.BitRepository
import org.hackeros.bitio.data.Prefs
import org.hackeros.bitio.data.ThemeMode
import org.hackeros.bitio.data.formatBytes

private val TOKEN_SHAPE = Regex("^(?:ghp_|gho_|ghu_|ghs_|ghr_|github_pat_)[A-Za-z0-9_]{20,}$|^[a-f0-9]{40}$")

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen(prefs: Prefs, repo: BitRepository) {
    val context = LocalContext.current
    val uri = LocalUriHandler.current
    val scope = rememberCoroutineScope()

    var token by remember { mutableStateOf(prefs.githubToken) }
    var show by remember { mutableStateOf(false) }
    var status by remember { mutableStateOf<Pair<String, Boolean?>?>(null) } // text, ok? (null = neutral)
    var testing by remember { mutableStateOf(false) }
    var cacheStats by remember { mutableStateOf(repo.cache.stats()) }

    fun test() {
        scope.launch {
            testing = true
            status = "Checking…" to null
            try {
                val r = repo.rateLimit()
                status = if (r != null) {
                    "${r.remaining} of ${r.limit} requests left this hour" +
                        (if (prefs.githubToken.isNotEmpty()) " (authenticated)." else " (anonymous).") to true
                } else "Connected, but GitHub didn't report a limit." to null
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                status = friendlyError(e) to false
            } finally {
                testing = false
            }
        }
    }

    Scaffold(
        contentWindowInsets = WindowInsets(0, 0, 0, 0),
        topBar = { TopAppBar(title = { Text("Settings", fontWeight = FontWeight.Bold) }) },
    ) { inner ->
        Column(
            Modifier.fillMaxSize().padding(inner).verticalScroll(rememberScrollState()).padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Text("Everything here is stored only on this device.", color = MaterialTheme.colorScheme.onSurfaceVariant)

            SectionCard("Appearance") {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    ThemeMode.entries.forEach { m ->
                        FilterChip(selected = prefs.theme == m, onClick = { prefs.setTheme(m) }, label = { Text(m.label) })
                    }
                }
            }

            SectionCard("GitHub token") {
                Text(
                    "When you open a library, the app asks GitHub's API for its file tree, stats and releases. Anonymous requests are limited to 60 per hour per IP address; with a personal access token the limit is 5,000 per hour.",
                    style = MaterialTheme.typography.bodyMedium,
                )
                Text(
                    "The token is used only for api.github.com - never for raw.githubusercontent.com or anything else. A token with no scopes (or a fine-grained, read-only, public-repositories token) is enough.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                OutlinedTextField(
                    value = token,
                    onValueChange = { token = it },
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true,
                    label = { Text("Personal access token") },
                    placeholder = { Text("ghp_… or github_pat_…") },
                    visualTransformation = if (show) VisualTransformation.None else PasswordVisualTransformation(),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                )
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Checkbox(checked = show, onCheckedChange = { show = it })
                    Text("Show token")
                }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Button(onClick = {
                        val v = token.trim()
                        prefs.setToken(v)
                        if (v.isEmpty()) {
                            status = "Token removed - GitHub's anonymous limit applies." to null
                        } else {
                            if (!TOKEN_SHAPE.matches(v)) status = "Saved, but it doesn't look like a GitHub token (ghp_…, github_pat_…)." to false
                            test()
                        }
                    }) { Text("Save") }
                    OutlinedButton(enabled = !testing, onClick = { test() }) { Text("Test") }
                    OutlinedButton(onClick = {
                        token = ""
                        prefs.setToken("")
                        status = "Token removed." to null
                    }) { Text("Remove") }
                }
                status?.let { (text, ok) ->
                    Text(
                        text,
                        style = MaterialTheme.typography.bodySmall,
                        color = when (ok) {
                            true -> BitColors.Ok
                            false -> BitColors.Warn
                            null -> MaterialTheme.colorScheme.onSurfaceVariant
                        },
                    )
                } ?: Text(
                    if (prefs.githubToken.isNotEmpty()) "A token is saved on this device." else "No token saved.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }

            SectionCard("Offline data") {
                Text(
                    "Libraries you open are saved on this device (details, README, file tree, files you read, releases). Without a connection the app shows that saved copy.",
                    style = MaterialTheme.typography.bodyMedium,
                )
                Text(
                    "${cacheStats.first} saved items · ${formatBytes(cacheStats.second)}",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                OutlinedButton(onClick = {
                    repo.cache.clear()
                    cacheStats = repo.cache.stats()
                }) { Text("Clear saved data") }
            }

            SectionCard("About") {
                Text("bit.io for Android - ${versionName(context)}", style = MaterialTheme.typography.bodyMedium)
                Text(
                    "A native client (Jetpack Compose, no WebView) for the bit library index: bit is the package manager for H#, Hacker Lang and HackerScript.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                TextButton(onClick = { uri.openUri("https://github.com/HackerOS-Linux-System/bit") }) { Text("GitHub ↗") }
            }
        }
    }
}

@Suppress("DEPRECATION")
private fun versionName(context: Context): String = try {
    "v" + (context.packageManager.getPackageInfo(context.packageName, 0).versionName ?: "?")
} catch (_: Exception) {
    ""
}
