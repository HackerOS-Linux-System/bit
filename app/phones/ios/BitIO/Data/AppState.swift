import Combine
import Foundation
import Security
import SwiftUI

enum ThemeMode: String, CaseIterable, Identifiable {
    case system, light, dark
    var id: String { rawValue }
    var label: String {
        switch self {
        case .system: return "System"
        case .light: return "Light"
        case .dark: return "Dark"
        }
    }
    var colorScheme: ColorScheme? {
        switch self {
        case .system: return nil
        case .light: return .light
        case .dark: return .dark
        }
    }
}

/// The GitHub token lives in the Keychain, never in UserDefaults.
enum Keychain {
    private static let service = "org.hackeros.bitio"

    private static func base(_ account: String) -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
    }

    static func get(_ account: String) -> String? {
        var q = base(account)
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var out: AnyObject?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let data = out as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    static func set(_ value: String, account: String) {
        let q = base(account)
        SecItemDelete(q as CFDictionary)
        guard !value.isEmpty else { return }
        var add = q
        add[kSecValueData as String] = Data(value.utf8)
        add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
        SecItemAdd(add as CFDictionary, nil)
    }
}

/// Person-level settings: theme + optional GitHub token (only ever sent to api.github.com).
@MainActor
final class AppSettings: ObservableObject {
    private static let themeKey = "bitio.theme"
    private static let tokenAccount = "github-token"

    @Published var theme: ThemeMode {
        didSet { UserDefaults.standard.set(theme.rawValue, forKey: Self.themeKey) }
    }
    @Published private(set) var githubToken: String

    private let repo: BitRepository

    init(repo: BitRepository) {
        self.repo = repo
        theme = ThemeMode(rawValue: UserDefaults.standard.string(forKey: Self.themeKey) ?? "") ?? .system
        let token = Keychain.get(Self.tokenAccount) ?? ""
        githubToken = token
        repo.token = token
    }

    func setToken(_ value: String) {
        let t = value.trimmingCharacters(in: .whitespacesAndNewlines)
        githubToken = t
        repo.token = t
        Keychain.set(t, account: Self.tokenAccount)
    }
}

/// App-wide state of the library list: shows the saved/bundled index immediately, refreshes it in
/// the background and keeps the search / filter state so it survives navigating to a library.
@MainActor
final class LibraryStore: ObservableObject {
    @Published private(set) var index: LibIndex?
    @Published private(set) var loading = false
    @Published private(set) var offlineNote: String?
    @Published private(set) var error: String?

    @Published var query = ""
    @Published var lang: Lang?
    @Published var tag = ""

    private let repo: BitRepository

    init(repo: BitRepository) {
        self.repo = repo
        index = repo.peekIndex()
    }

    var libraries: [LibEntry] { index?.libraries ?? [] }

    func refresh() async {
        if loading { return }
        loading = true
        error = nil
        defer { loading = false }
        do {
            let res = try await repo.loadIndex()
            index = res.value
            if res.stale {
                if let age = res.age {
                    offlineNote = "Offline - showing the copy saved \(formatAge(age))."
                } else {
                    offlineNote = "Offline - showing the index bundled with the app."
                }
            } else {
                offlineNote = nil
            }
        } catch is CancellationError {
            // a cancelled pull-to-refresh is not an error
        } catch {
            self.error = friendlyError(error)
        }
    }

    func filtered() -> [LibEntry] {
        let q = query.trimmingCharacters(in: .whitespaces).lowercased()
        return libraries.filter { e in
            if let l = lang, e.lang != l { return false }
            if !tag.isEmpty, !e.tags.contains(where: { $0.caseInsensitiveCompare(tag) == .orderedSame }) { return false }
            if q.isEmpty { return true }
            return e.name.lowercased().contains(q)
                || e.description.lowercased().contains(q)
                || e.author.lowercased().contains(q)
                || e.tags.contains(where: { $0.lowercased().contains(q) })
        }
    }

    func find(_ name: String) -> LibEntry? {
        libraries.first { $0.name.caseInsensitiveCompare(name) == .orderedSame }
    }
}
