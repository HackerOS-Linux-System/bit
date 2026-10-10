package org.hackeros.bitio.ui

import android.app.Activity
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.SideEffect
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalView
import androidx.core.view.WindowCompat
import org.hackeros.bitio.data.Lang
import org.hackeros.bitio.data.ThemeMode

/** Brand colours of bit.io (website/public/styles.css). */
object BitColors {
    val Purple = Color(0xFF7C4DFF)
    val Pink = Color(0xFFEC4899)
    val Orange = Color(0xFFFB923C)
    val Gradient = Brush.linearGradient(listOf(Purple, Pink, Orange))

    val Ok = Color(0xFF16A34A)
    val Warn = Color(0xFFD97706)
    val Err = Color(0xFFDC2626)

    fun lang(lang: Lang, dark: Boolean): Color = when (lang) {
        Lang.HSHARP -> if (dark) Color(0xFFFF5468) else Color(0xFFA5001A)
        Lang.HACKERLANG -> if (dark) Color(0xFFA78BFA) else Color(0xFF6C1FD6)
        Lang.HACKERSCRIPT -> if (dark) Color(0xFF38D3EA) else Color(0xFF0A8FA6)
        Lang.ANY -> if (dark) Color(0xFF8B8B9C) else Color(0xFF6E6E85)
    }
}

private val LightScheme = lightColorScheme(
    primary = Color(0xFF7C4DFF),
    onPrimary = Color.White,
    primaryContainer = Color(0xFFEDE7FF),
    onPrimaryContainer = Color(0xFF2A0E80),
    secondary = Color(0xFFEC4899),
    tertiary = Color(0xFFFB923C),
    background = Color(0xFFFFFFFF),
    onBackground = Color(0xFF14141C),
    surface = Color(0xFFFFFFFF),
    onSurface = Color(0xFF14141C),
    surfaceVariant = Color(0xFFF3F3F8),
    onSurfaceVariant = Color(0xFF4A4A58),
    outline = Color(0xFF6E6E85),
    outlineVariant = Color(0xFFEAEAF0),
    error = Color(0xFFDC2626),
)

private val DarkScheme = darkColorScheme(
    primary = Color(0xFFB39DFF),
    onPrimary = Color(0xFF1E0A5C),
    primaryContainer = Color(0xFF2E2250),
    onPrimaryContainer = Color(0xFFE6DEFF),
    secondary = Color(0xFFF472B6),
    tertiary = Color(0xFFFDBA74),
    background = Color(0xFF0E0E13),
    onBackground = Color(0xFFF0F0F5),
    surface = Color(0xFF17171F),
    onSurface = Color(0xFFF0F0F5),
    surfaceVariant = Color(0xFF1D1D27),
    onSurfaceVariant = Color(0xFFC2C2CF),
    outline = Color(0xFF8B8B9C),
    outlineVariant = Color(0xFF2A2A34),
    error = Color(0xFFF87171),
)

@Composable
fun BitTheme(mode: ThemeMode, content: @Composable () -> Unit) {
    val dark = when (mode) {
        ThemeMode.SYSTEM -> isSystemInDarkTheme()
        ThemeMode.LIGHT -> false
        ThemeMode.DARK -> true
    }
    val view = LocalView.current
    if (!view.isInEditMode) {
        SideEffect {
            val window = (view.context as? Activity)?.window
            if (window != null) {
                val controller = WindowCompat.getInsetsController(window, view)
                controller.isAppearanceLightStatusBars = !dark
                controller.isAppearanceLightNavigationBars = !dark
            }
        }
    }
    MaterialTheme(colorScheme = if (dark) DarkScheme else LightScheme, content = content)
}

@Composable
fun isDarkTheme(): Boolean = MaterialTheme.colorScheme.background.red < 0.5f
