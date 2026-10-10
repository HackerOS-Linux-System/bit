package org.hackeros.bitio.data

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch

/**
 * Process-wide state of the library list: shows the saved/bundled index immediately, refreshes it
 * in the background and keeps the search / filter state so it survives navigating to a library.
 */
class LibraryStore(private val repo: BitRepository, private val scope: CoroutineScope) {
    var index: Index? by mutableStateOf(repo.peekIndex())
        private set
    var loading: Boolean by mutableStateOf(false)
        private set
    var offlineNote: String? by mutableStateOf(null)
        private set
    var error: String? by mutableStateOf(null)
        private set

    var query: String by mutableStateOf("")
    var lang: Lang? by mutableStateOf(null)
    var tag: String by mutableStateOf("")

    private var job: Job? = null

    fun refresh() {
        if (job?.isActive == true) return
        job = scope.launch {
            loading = true
            error = null
            try {
                val res = repo.loadIndex()
                index = res.value
                offlineNote = if (res.stale) {
                    val age = res.ageMs
                    if (age != null) "Offline - showing the copy saved ${formatAge(age)}."
                    else "Offline - showing the index bundled with the app."
                } else null
            } catch (e: kotlinx.coroutines.CancellationException) {
                throw e
            } catch (e: Exception) {
                error = e.message ?: "could not load the library index"
            } finally {
                loading = false
            }
        }
    }

    val libraries: List<LibEntry> get() = index?.libraries.orEmpty()

    fun filtered(): List<LibEntry> {
        val q = query.trim().lowercase()
        return libraries.filter { e ->
            if (lang != null && e.lang != lang) return@filter false
            if (tag.isNotEmpty() && e.tags.none { it.equals(tag, ignoreCase = true) }) return@filter false
            if (q.isEmpty()) return@filter true
            e.name.lowercase().contains(q) ||
                e.description.lowercase().contains(q) ||
                e.author.lowercase().contains(q) ||
                e.tags.any { it.lowercase().contains(q) }
        }
    }

    fun find(name: String): LibEntry? = libraries.firstOrNull { it.name.equals(name, ignoreCase = true) }
}
