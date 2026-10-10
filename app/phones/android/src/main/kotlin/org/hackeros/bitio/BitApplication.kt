package org.hackeros.bitio

import android.app.Application
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import org.hackeros.bitio.data.BitRepository
import org.hackeros.bitio.data.LibraryStore
import org.hackeros.bitio.data.Prefs

/** Owns the process-wide singletons (settings, repository, library list). */
class BitApplication : Application() {
    lateinit var prefs: Prefs
        private set
    lateinit var repo: BitRepository
        private set
    lateinit var store: LibraryStore
        private set

    override fun onCreate() {
        super.onCreate()
        prefs = Prefs(this)
        repo = BitRepository(this, prefs)
        store = LibraryStore(repo, CoroutineScope(SupervisorJob() + Dispatchers.Main))
        store.refresh()
    }
}
