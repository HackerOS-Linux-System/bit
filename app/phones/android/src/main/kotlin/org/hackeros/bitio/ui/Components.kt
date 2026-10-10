package org.hackeros.bitio.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedCard
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.State
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import org.hackeros.bitio.data.GithubException
import org.hackeros.bitio.data.Lang
import org.hackeros.bitio.data.Loaded
import java.io.IOException

/* ------------------------------------------------------------------ loading */

sealed interface Load<out T> {
    data object Loading : Load<Nothing>
    data object Missing : Load<Nothing>
    data class Failed(val message: String) : Load<Nothing>
    data class Ok<T>(val value: T, val stale: Boolean, val ageMs: Long?) : Load<T>
}

fun friendlyError(e: Exception): String = when (e) {
    is GithubException -> e.message ?: "GitHub error"
    is IOException -> "Couldn't reach GitHub - check your connection."
    else -> e.message ?: "Something went wrong."
}

@Composable
fun <T> rememberLoad(vararg keys: Any?, block: suspend () -> Loaded<T>): State<Load<T>> =
    produceState<Load<T>>(Load.Loading, *keys) {
        value = Load.Loading
        value = try {
            val r = block()
            val v = r.value
            if (v == null) Load.Missing else Load.Ok(v, r.stale, r.ageMs)
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            Load.Failed(friendlyError(e))
        }
    }

@Composable
fun Spinner(modifier: Modifier = Modifier) {
    Box(modifier.fillMaxWidth().padding(24.dp), contentAlignment = Alignment.Center) {
        CircularProgressIndicator(Modifier.size(28.dp), strokeWidth = 3.dp)
    }
}

@Composable
fun Notice(text: String, color: Color = MaterialTheme.colorScheme.onSurfaceVariant, modifier: Modifier = Modifier) {
    Text(text, color = color, style = MaterialTheme.typography.bodyMedium, modifier = modifier.padding(vertical = 8.dp))
}

/** Renders the usual four states of a [Load]; [ok] gets the value. */
@Composable
fun <T> LoadView(state: Load<T>, missing: String, ok: @Composable (T, Boolean) -> Unit) {
    when (state) {
        Load.Loading -> Spinner()
        Load.Missing -> Notice(missing)
        is Load.Failed -> Notice(state.message, MaterialTheme.colorScheme.error)
        is Load.Ok -> ok(state.value, state.stale)
    }
}

/* ------------------------------------------------------------------ widgets */

@Composable
fun LangBadge(lang: Lang, modifier: Modifier = Modifier) {
    val color = BitColors.lang(lang, isDarkTheme())
    Surface(
        modifier = modifier,
        shape = RoundedCornerShape(50),
        color = color.copy(alpha = 0.12f),
        border = BorderStroke(1.dp, color.copy(alpha = 0.35f)),
    ) {
        Row(Modifier.padding(horizontal = 10.dp, vertical = 3.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(7.dp).clip(RoundedCornerShape(50)).background(color))
            Spacer(Modifier.width(6.dp))
            Text(lang.label, color = color, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
        }
    }
}

@Composable
fun TagChip(text: String, onClick: (() -> Unit)? = null) {
    val shape = RoundedCornerShape(50)
    Box(
        Modifier
            .clip(shape)
            .background(MaterialTheme.colorScheme.surfaceVariant)
            .then(if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier)
            .padding(horizontal = 10.dp, vertical = 4.dp),
    ) {
        Text(text, fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

/** A shell command with a one-tap copy button. */
@Composable
fun CommandRow(command: String, modifier: Modifier = Modifier) {
    val clipboard = LocalClipboardManager.current
    var copied by remember { mutableStateOf(false) }
    LaunchedEffect(copied) {
        if (copied) {
            delay(1500)
            copied = false
        }
    }
    Row(
        modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(10.dp))
            .background(MaterialTheme.colorScheme.surfaceVariant)
            .padding(start = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            "$ $command",
            fontFamily = FontFamily.Monospace,
            fontSize = 13.sp,
            modifier = Modifier.weight(1f).padding(vertical = 10.dp),
            maxLines = 2,
        )
        TextButton(onClick = {
            clipboard.setText(AnnotatedString(command))
            copied = true
        }) { Text(if (copied) "Copied" else "Copy") }
    }
}

@Composable
fun SectionCard(title: String, modifier: Modifier = Modifier, content: @Composable () -> Unit) {
    OutlinedCard(
        modifier.fillMaxWidth(),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
    ) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(title, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold)
            content()
        }
    }
}

@Composable
fun KeyValue(key: String, value: String) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.Top) {
        Text(key, color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall, modifier = Modifier.width(96.dp))
        Text(value, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f))
    }
}

fun compactNumber(n: Int): String =
    if (n >= 1000) "%.1fk".format(n / 1000.0).replace(".0k", "k") else n.toString()
