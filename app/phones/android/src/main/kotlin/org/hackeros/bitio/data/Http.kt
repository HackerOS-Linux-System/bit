package org.hackeros.bitio.data

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL

/** Anything that went wrong while talking to GitHub (rate limit, bad token, HTTP error). */
class GithubException(message: String, val status: Int) : IOException(message)

class HttpResult(val status: Int, val body: String, val headers: Map<String, String>) {
    val ok: Boolean get() = status in 200..299
}

object Http {
    private const val MAX_BYTES = 4 * 1024 * 1024
    private const val USER_AGENT = "bit-io-android"

    suspend fun get(url: String, headers: Map<String, String> = emptyMap()): HttpResult = withContext(Dispatchers.IO) {
        val conn = URL(url).openConnection() as HttpURLConnection
        try {
            conn.requestMethod = "GET"
            conn.connectTimeout = 15_000
            conn.readTimeout = 20_000
            conn.instanceFollowRedirects = true
            conn.setRequestProperty("User-Agent", USER_AGENT)
            for ((k, v) in headers) conn.setRequestProperty(k, v)

            val status = conn.responseCode
            val stream = if (status >= 400) conn.errorStream else conn.inputStream
            val body = if (stream == null) "" else stream.use { readCapped(it) }
            val hdrs = HashMap<String, String>()
            for ((k, v) in conn.headerFields) {
                if (k != null && v != null && v.isNotEmpty()) hdrs[k.lowercase()] = v.last()
            }
            HttpResult(status, body, hdrs)
        } finally {
            conn.disconnect()
        }
    }

    private fun readCapped(input: java.io.InputStream): String {
        val out = ByteArrayOutputStream()
        val buf = ByteArray(16 * 1024)
        while (out.size() < MAX_BYTES) {
            val n = input.read(buf)
            if (n < 0) break
            out.write(buf, 0, n)
        }
        return out.toString(Charsets.UTF_8.name())
    }
}
