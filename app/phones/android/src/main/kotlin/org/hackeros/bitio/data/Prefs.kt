package org.hackeros.bitio.data

import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue

enum class ThemeMode(val label: String) { SYSTEM("System"), LIGHT("Light"), DARK("Dark") }

/**
 * Person-level settings (theme + optional GitHub token), kept in private app storage.
 * The token only ever goes to api.github.com - never to raw.githubusercontent.com.
 */
class Prefs(context: Context) {
    private val sp = context.getSharedPreferences("bitio", Context.MODE_PRIVATE)

    var theme: ThemeMode by mutableStateOf(
        runCatching { ThemeMode.valueOf(sp.getString(KEY_THEME, "SYSTEM") ?: "SYSTEM") }.getOrDefault(ThemeMode.SYSTEM),
    )
        private set

    var githubToken: String by mutableStateOf(sp.getString(KEY_TOKEN, "") ?: "")
        private set

    fun setTheme(mode: ThemeMode) {
        theme = mode
        sp.edit().putString(KEY_THEME, mode.name).apply()
    }

    fun setToken(token: String) {
        val t = token.trim()
        githubToken = t
        sp.edit().apply { if (t.isEmpty()) remove(KEY_TOKEN) else putString(KEY_TOKEN, t) }.apply()
    }

    private companion object {
        const val KEY_THEME = "theme"
        const val KEY_TOKEN = "github_token"
    }
}
