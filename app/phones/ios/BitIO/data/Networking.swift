import CryptoKit
import Foundation

struct HTTPResult {
    let status: Int
    let body: String
    let headers: [String: String]
    var ok: Bool { (200..<300).contains(status) }
}

enum HTTP {
    private static let maxBytes = 4 * 1024 * 1024

    static func get(_ urlString: String, headers: [String: String] = [:], noCache: Bool = false) async throws -> HTTPResult {
        guard let url = URL(string: urlString) else { throw URLError(.badURL) }
        var req = URLRequest(url: url, timeoutInterval: 20)
        req.setValue("bit-io-ios", forHTTPHeaderField: "User-Agent")
        if noCache { req.cachePolicy = .reloadIgnoringLocalCacheData }
        for (k, v) in headers { req.setValue(v, forHTTPHeaderField: k) }

        let (data, response) = try await URLSession.shared.data(for: req)
        let http = response as? HTTPURLResponse
        var hdrs: [String: String] = [:]
        if let fields = http?.allHeaderFields {
            for (k, v) in fields {
                if let key = k as? String, let value = v as? String { hdrs[key.lowercased()] = value }
            }
        }
        let capped = data.prefix(maxBytes)
        return HTTPResult(status: http?.statusCode ?? 0, body: String(decoding: capped, as: UTF8.self), headers: hdrs)
    }
}

/// Anything that went wrong while talking to GitHub (rate limit, bad token, HTTP error).
struct GithubError: LocalizedError {
    let message: String
    let status: Int
    var errorDescription: String? { message }
}

struct SimpleError: LocalizedError {
    let message: String
    var errorDescription: String? { message }
}

func friendlyError(_ error: Error) -> String {
    if let g = error as? GithubError { return g.message }
    if error is URLError { return "Couldn't reach GitHub - check your connection." }
    return error.localizedDescription
}

/// Tiny key -> text cache on disk, so everything the person opens keeps working offline.
/// File layout: first line = save time (epoch seconds), the rest = payload.
final class DiskCache {
    struct Entry {
        let value: String
        let savedAt: TimeInterval
        var age: TimeInterval { Date().timeIntervalSince1970 - savedAt }
    }

    private let dir: URL
    private let lock = NSLock()

    init() {
        let base = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first
            ?? URL(fileURLWithPath: NSTemporaryDirectory())
        dir = base.appendingPathComponent("bitio", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    }

    private func file(for key: String) -> URL {
        let digest = SHA256.hash(data: Data(key.utf8))
        return dir.appendingPathComponent(digest.map { String(format: "%02x", $0) }.joined())
    }

    func put(_ key: String, _ value: String) {
        lock.lock(); defer { lock.unlock() }
        let text = "\(Date().timeIntervalSince1970)\n\(value)"
        try? text.write(to: file(for: key), atomically: true, encoding: .utf8)
    }

    func get(_ key: String) -> Entry? {
        lock.lock(); defer { lock.unlock() }
        guard let text = try? String(contentsOf: file(for: key), encoding: .utf8),
              let nl = text.firstIndex(of: "\n") else { return nil }
        let ts = TimeInterval(text[..<nl]) ?? 0
        return Entry(value: String(text[text.index(after: nl)...]), savedAt: ts)
    }

    func clear() {
        lock.lock(); defer { lock.unlock() }
        let files = (try? FileManager.default.contentsOfDirectory(at: dir, includingPropertiesForKeys: nil)) ?? []
        for f in files { try? FileManager.default.removeItem(at: f) }
    }

    /// (entries, bytes)
    func stats() -> (count: Int, bytes: Int) {
        lock.lock(); defer { lock.unlock() }
        let files = (try? FileManager.default.contentsOfDirectory(at: dir, includingPropertiesForKeys: [.fileSizeKey])) ?? []
        let total = files.reduce(0) { $0 + ((try? $1.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0) }
        return (files.count, total)
    }
}

/// A value plus where it came from: `stale` = served from the saved copy because the network failed.
struct Loaded<T> {
    let value: T?
    var stale = false
    var age: TimeInterval?
}

struct RateLimitInfo {
    let remaining: Int
    let limit: Int
}

/// Everything the app reads: the library index (same document `bit` reads) and, per library, the
/// GitHub data the website shows (manifest, README, stats, releases, file tree, files).
/// Results are cached on disk; when offline the saved copy is used.
final class BitRepository: ObservableObject {
    let cache = DiskCache()

    private let lock = NSLock()
    private var _token = ""
    private var _rate: RateLimitInfo?

    /// GitHub token - only ever sent to api.github.com.
    var token: String {
        get { lock.lock(); defer { lock.unlock() }; return _token }
        set { lock.lock(); _token = newValue; lock.unlock() }
    }

    var lastRate: RateLimitInfo? {
        lock.lock(); defer { lock.unlock() }
        return _rate
    }

    private static let indexURLs = [
        "https://raw.githubusercontent.com/HackerOS-Linux-System/bit/main/index/repository.json",
    ]
    private static let manifests = ["Bit.hk", "bit.hk", "Bytes.hk", "Virus.hk"]
    private static let readmeFiles = ["README.md", "Readme.md", "readme.md", "README.markdown", "README.MD", "README", "README.txt", "README.rst"]

    private static let hour: TimeInterval = 3600

    // MARK: index

    func bundledIndex() -> LibIndex? {
        guard let url = Bundle.main.url(forResource: "repository", withExtension: "json"),
              let text = try? String(contentsOf: url, encoding: .utf8) else { return nil }
        return try? IndexParser.parse(text)
    }

    /// Fastest possible content for the first frame: the saved copy, else the snapshot shipped in the app.
    func peekIndex() -> LibIndex? {
        if let saved = cache.get("index"), let idx = try? IndexParser.parse(saved.value) { return idx }
        return bundledIndex()
    }

    /// Network first (the network copy always wins while online), then the saved copy. Throws when neither exists.
    func loadIndex() async throws -> Loaded<LibIndex> {
        var last: Error?
        for url in Self.indexURLs {
            do {
                let res = try await HTTP.get(url, noCache: true)
                if !res.ok { throw SimpleError(message: "\(url): HTTP \(res.status)") }
                let idx = try IndexParser.parse(res.body)
                cache.put("index", res.body)
                return Loaded(value: idx)
            } catch is CancellationError {
                throw CancellationError()
            } catch {
                last = error
            }
        }
        if let saved = cache.get("index"), let idx = try? IndexParser.parse(saved.value) {
            return Loaded(value: idx, stale: true, age: saved.age)
        }
        if let idx = bundledIndex() { return Loaded(value: idx, stale: true, age: nil) }
        throw last ?? SimpleError(message: "could not load the library index")
    }

    // MARK: generic cache

    private func cached<T>(
        key: String,
        ttl: TimeInterval,
        fetch: () async throws -> String?,
        parse: (String) throws -> T
    ) async throws -> Loaded<T> {
        let saved = cache.get(key)
        if let s = saved, s.age < ttl, let v = try? parse(s.value) {
            return Loaded(value: v, stale: false, age: s.age)
        }
        do {
            guard let text = try await fetch() else { return Loaded(value: nil) }
            cache.put(key, text)
            return Loaded(value: try parse(text), stale: false, age: 0)
        } catch {
            if error is CancellationError { throw error }
            if let s = saved, let v = try? parse(s.value) {
                return Loaded(value: v, stale: true, age: s.age)
            }
            throw error
        }
    }

    // MARK: GitHub

    private func enc(_ s: String) -> String {
        s.addingPercentEncoding(withAllowedCharacters: CharacterSet(charactersIn: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~")) ?? s
    }

    private func encPath(_ p: String) -> String {
        p.split(separator: "/", omittingEmptySubsequences: false).map { enc(String($0)) }.joined(separator: "/")
    }

    /// raw.githubusercontent.com has no API quota and never sees the token. nil = 404.
    private func fetchRaw(_ r: GithubRepo, _ ref: String, _ path: String) async throws -> String? {
        let url = "https://raw.githubusercontent.com/\(r.owner)/\(r.repo)/\(encPath(ref))/\(encPath(path))"
        let res = try await HTTP.get(url)
        if res.status == 404 { return nil }
        if !res.ok { throw SimpleError(message: "HTTP \(res.status)") }
        return res.body
    }

    /// api.github.com with the token attached when one is saved.
    private func api(_ path: String) async throws -> HTTPResult {
        var headers = [
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
        ]
        let tok = token
        if !tok.isEmpty { headers["Authorization"] = "Bearer \(tok)" }
        let res = try await HTTP.get("https://api.github.com\(path)", headers: headers)
        let remaining = res.headers["x-ratelimit-remaining"].flatMap { Int($0) }
        let limit = res.headers["x-ratelimit-limit"].flatMap { Int($0) }
        if let remaining = remaining, let limit = limit {
            lock.lock(); _rate = RateLimitInfo(remaining: remaining, limit: limit); lock.unlock()
        }
        if res.status == 401 {
            throw GithubError(message: "GitHub rejected the saved token (401). Check it in Settings.", status: 401)
        }
        if (res.status == 403 || res.status == 429),
           remaining == 0 || res.body.lowercased().contains("rate limit") {
            throw GithubError(
                message: tok.isEmpty
                    ? "GitHub's anonymous limit (60 requests/hour) is used up. Add a token in Settings."
                    : "GitHub's hourly limit is used up. Try again later.",
                status: res.status
            )
        }
        return res
    }

    private func apiOK(_ path: String) async throws -> String? {
        let res = try await api(path)
        if res.status == 404 { return nil }
        if !res.ok { throw GithubError(message: "GitHub API: HTTP \(res.status)", status: res.status) }
        return res.body
    }

    func rateLimit() async throws -> RateLimitInfo? {
        let res = try await api("/rate_limit")
        if !res.ok { throw GithubError(message: "GitHub API: HTTP \(res.status)", status: res.status) }
        guard let obj = try JSONSerialization.jsonObject(with: Data(res.body.utf8)) as? [String: Any],
              let core = (obj["resources"] as? [String: Any])?["core"] as? [String: Any] else { return nil }
        let info = RateLimitInfo(remaining: core["remaining"] as? Int ?? 0, limit: core["limit"] as? Int ?? 0)
        lock.lock(); _rate = info; lock.unlock()
        return info
    }

    func loadManifest(_ r: GithubRepo, ref: String) async throws -> Loaded<Manifest> {
        try await cached(
            key: "manifest:\(r.owner)/\(r.repo)@\(ref)", ttl: 6 * Self.hour,
            fetch: {
                for f in Self.manifests {
                    if let t = try await self.fetchRaw(r, ref, f) { return "\(f)\n\(t.prefix(100_000))" }
                }
                return nil
            },
            parse: { s in
                guard let nl = s.firstIndex(of: "\n") else { throw ParseError.invalid }
                return Manifest(file: String(s[..<nl]), doc: Hk.parse(String(s[s.index(after: nl)...])))
            }
        )
    }

    func loadReadme(_ r: GithubRepo, ref: String) async throws -> Loaded<Readme> {
        try await cached(
            key: "readme:\(r.owner)/\(r.repo)@\(ref)", ttl: 6 * Self.hour,
            fetch: {
                for f in Self.readmeFiles {
                    if let t = try await self.fetchRaw(r, ref, f) { return "\(f)\n\(t.prefix(200_000))" }
                }
                return nil
            },
            parse: { s in
                guard let nl = s.firstIndex(of: "\n") else { throw ParseError.invalid }
                let file = String(s[..<nl])
                let isMd = file.lowercased().hasSuffix(".md") || file.lowercased().hasSuffix(".markdown")
                return Readme(file: file, text: String(s[s.index(after: nl)...]), markdown: isMd)
            }
        )
    }

    func loadMeta(_ r: GithubRepo) async throws -> Loaded<RepoMeta> {
        try await cached(
            key: "meta:\(r.owner)/\(r.repo)", ttl: Self.hour,
            fetch: { try await self.apiOK("/repos/\(self.enc(r.owner))/\(self.enc(r.repo))") },
            parse: { s in
                guard let o = try JSONSerialization.jsonObject(with: Data(s.utf8)) as? [String: Any] else { throw ParseError.invalid }
                var license = (o["license"] as? [String: Any])?["spdx_id"] as? String ?? ""
                if license == "NOASSERTION" { license = "" }
                return RepoMeta(
                    stars: o["stargazers_count"] as? Int ?? 0,
                    forks: o["forks_count"] as? Int ?? 0,
                    openIssues: o["open_issues_count"] as? Int ?? 0,
                    license: license,
                    pushedAt: o["pushed_at"] as? String ?? "",
                    homepage: o["homepage"] as? String ?? "",
                    archived: o["archived"] as? Bool ?? false
                )
            }
        )
    }

    func loadReleases(_ r: GithubRepo) async throws -> Loaded<[Release]> {
        try await cached(
            key: "releases:\(r.owner)/\(r.repo)", ttl: Self.hour,
            fetch: {
                let base = "/repos/\(self.enc(r.owner))/\(self.enc(r.repo))"
                if let rel = try await self.apiOK("\(base)/releases?per_page=30"),
                   !((try? self.parseReleases(rel, r)) ?? []).isEmpty {
                    return rel
                }
                // no releases published: fall back to plain tags
                guard let tags = try await self.apiOK("\(base)/tags?per_page=30"),
                      let arr = try JSONSerialization.jsonObject(with: Data(tags.utf8)) as? [[String: Any]] else { return "[]" }
                let synthetic: [[String: Any]] = arr.compactMap { t in
                    guard let n = t["name"] as? String, !n.isEmpty else { return nil }
                    return ["tag": n, "tag_only": true]
                }
                let data = try JSONSerialization.data(withJSONObject: synthetic)
                return String(decoding: data, as: UTF8.self)
            },
            parse: { s in try self.parseReleases(s, r) }
        )
    }

    private func parseReleases(_ json: String, _ r: GithubRepo) throws -> [Release] {
        guard let arr = try JSONSerialization.jsonObject(with: Data(json.utf8)) as? [[String: Any]] else { throw ParseError.invalid }
        var out: [Release] = []
        for o in arr {
            guard let tag = o["tag_name"] as? String, !tag.isEmpty else {
                if let t = o["tag"] as? String, !t.isEmpty, o["tag_only"] as? Bool == true {
                    out.append(Release(tag: t, name: "", date: "", prerelease: false,
                                       url: "https://github.com/\(r.owner)/\(r.repo)/releases/tag/\(enc(t))",
                                       body: "", assets: [], tagOnly: true))
                }
                continue
            }
            if o["draft"] as? Bool == true { continue }
            let assets: [ReleaseAsset] = (o["assets"] as? [[String: Any]] ?? []).map { a in
                ReleaseAsset(
                    name: a["name"] as? String ?? "file",
                    size: a["size"] as? Int ?? 0,
                    downloads: a["download_count"] as? Int ?? 0,
                    url: a["browser_download_url"] as? String ?? ""
                )
            }
            let published = o["published_at"] as? String
            out.append(Release(
                tag: tag,
                name: o["name"] as? String ?? "",
                date: published ?? (o["created_at"] as? String ?? ""),
                prerelease: o["prerelease"] as? Bool ?? false,
                url: o["html_url"] as? String ?? "https://github.com/\(r.owner)/\(r.repo)/releases/tag/\(enc(tag))",
                body: String((o["body"] as? String ?? "").prefix(6000)),
                assets: assets
            ))
        }
        return out
    }

    func loadTree(_ r: GithubRepo, ref: String) async throws -> Loaded<RepoTree> {
        try await cached(
            key: "tree:\(r.owner)/\(r.repo)@\(ref)", ttl: 6 * Self.hour,
            fetch: { try await self.apiOK("/repos/\(self.enc(r.owner))/\(self.enc(r.repo))/git/trees/\(self.encPath(ref))?recursive=1") },
            parse: { s in
                guard let o = try JSONSerialization.jsonObject(with: Data(s.utf8)) as? [String: Any] else { throw ParseError.invalid }
                let items: [TreeItem] = (o["tree"] as? [[String: Any]] ?? []).compactMap { t in
                    let type = t["type"] as? String ?? ""
                    guard type == "blob" || type == "tree", let path = t["path"] as? String else { return nil }
                    return TreeItem(path: path, isDir: type == "tree", size: t["size"] as? Int ?? 0)
                }
                return RepoTree(items: items, truncated: o["truncated"] as? Bool ?? false)
            }
        )
    }

    func loadFile(_ r: GithubRepo, ref: String, path: String) async throws -> Loaded<String> {
        try await cached(
            key: "src:\(r.owner)/\(r.repo)@\(ref):\(path)", ttl: 24 * Self.hour,
            fetch: { try await self.fetchRaw(r, ref, path).map { String($0.prefix(300_000)) } },
            parse: { $0 }
        )
    }
}
