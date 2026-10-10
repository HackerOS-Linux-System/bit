package org.hackeros.bitio.data

import java.io.File
import java.security.MessageDigest

/**
 * Tiny key -> text cache on disk, so everything the person opens keeps working offline.
 * File layout: first line = save time (epoch ms), the rest = payload.
 */
class DiskCache(private val dir: File) {
    class Entry(val value: String, val savedAt: Long) {
        val ageMs: Long get() = System.currentTimeMillis() - savedAt
    }

    init {
        dir.mkdirs()
    }

    private fun fileFor(key: String): File {
        val digest = MessageDigest.getInstance("SHA-1").digest(key.toByteArray(Charsets.UTF_8))
        return File(dir, digest.joinToString("") { "%02x".format(it) })
    }

    @Synchronized
    fun put(key: String, value: String) {
        try {
            fileFor(key).writeText("${System.currentTimeMillis()}\n$value")
        } catch (_: Exception) {
            // a full disk must never break the app
        }
    }

    @Synchronized
    fun get(key: String): Entry? {
        return try {
            val f = fileFor(key)
            if (!f.isFile) return null
            val text = f.readText()
            val nl = text.indexOf('\n')
            if (nl < 0) return null
            Entry(text.substring(nl + 1), text.substring(0, nl).toLongOrNull() ?: 0L)
        } catch (_: Exception) {
            null
        }
    }

    @Synchronized
    fun clear() {
        dir.listFiles()?.forEach { it.delete() }
    }

    /** (entries, bytes) */
    @Synchronized
    fun stats(): Pair<Int, Long> {
        val files = dir.listFiles()?.filter { it.isFile } ?: emptyList()
        return files.size to files.sumOf { it.length() }
    }
}

fun formatBytes(n: Long): String = when {
    n < 1024 -> "$n B"
    n < 1024 * 1024 -> "%.1f KB".format(n / 1024.0)
    else -> "%.1f MB".format(n / (1024.0 * 1024.0))
}

fun formatAge(ms: Long): String {
    val s = ms / 1000
    return when {
        s < 60 -> "just now"
        s < 3600 -> "${s / 60} min ago"
        s < 86_400 -> "${s / 3600} h ago"
        else -> "${s / 86_400} d ago"
    }
}
