import SwiftUI

struct SettingsView: View {
    @EnvironmentObject private var settings: AppSettings
    @EnvironmentObject private var repo: BitRepository
    @Environment(\.openURL) private var openURL

    @State private var token = ""
    @State private var showToken = false
    @State private var status: (text: String, color: Color)?
    @State private var testing = false
    @State private var stats = (count: 0, bytes: 0)

    private static let tokenShape = Rx(#"^(?:ghp_|gho_|ghu_|ghs_|ghr_|github_pat_)[A-Za-z0-9_]{20,}$|^[a-f0-9]{40}$"#)

    var body: some View {
        NavigationStack {
            Form {
                Section("Appearance") {
                    Picker("Theme", selection: $settings.theme) {
                        ForEach(ThemeMode.allCases) { Text($0.label).tag($0) }
                    }
                    .pickerStyle(.segmented)
                }

                Section {
                    Group {
                        if showToken {
                            TextField("ghp_… or github_pat_…", text: $token)
                        } else {
                            SecureField("ghp_… or github_pat_…", text: $token)
                        }
                    }
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    Toggle("Show token", isOn: $showToken)
                    HStack {
                        Button("Save") { save() }.buttonStyle(.borderedProminent)
                        Button("Test") { Task { await test() } }.buttonStyle(.bordered).disabled(testing)
                        Button("Remove", role: .destructive) {
                            token = ""
                            settings.setToken("")
                            status = ("Token removed.", .secondary)
                        }
                        .buttonStyle(.bordered)
                    }
                    if let s = status {
                        Text(s.text).font(.footnote).foregroundStyle(s.color)
                    } else {
                        Text(settings.githubToken.isEmpty ? "No token saved." : "A token is saved in the Keychain.")
                            .font(.footnote).foregroundStyle(.secondary)
                    }
                } header: {
                    Text("GitHub token")
                } footer: {
                    Text("When you open a library, the app asks GitHub's API for its file tree, stats and releases. Anonymous requests are limited to 60 per hour per IP address; with a personal access token the limit is 5,000 per hour. The token is stored in the Keychain and used only for api.github.com. A token with no scopes (or a fine-grained, read-only, public-repositories token) is enough.")
                }

                Section {
                    Text("\(stats.count) saved items · \(formatBytes(stats.bytes))").foregroundStyle(.secondary)
                    Button("Clear saved data", role: .destructive) {
                        repo.cache.clear()
                        stats = repo.cache.stats()
                    }
                } header: {
                    Text("Offline data")
                } footer: {
                    Text("Libraries you open are saved on this device (details, README, file tree, files you read, releases). Without a connection the app shows that saved copy.")
                }

                Section("About") {
                    Text("bit.io for iOS - v\(Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "?")")
                    Text("A native client (SwiftUI, no WebView) for the bit library index: bit is the package manager for H#, Hacker Lang and HackerScript.")
                        .font(.footnote).foregroundStyle(.secondary)
                    Button("GitHub ↗") {
                        if let u = URL(string: "https://github.com/HackerOS-Linux-System/bit") { openURL(u) }
                    }
                }
            }
            .navigationTitle("Settings")
            .onAppear {
                token = settings.githubToken
                stats = repo.cache.stats()
            }
        }
    }

    private func save() {
        let v = token.trimmingCharacters(in: .whitespacesAndNewlines)
        settings.setToken(v)
        if v.isEmpty {
            status = ("Token removed - GitHub's anonymous limit applies.", .secondary)
            return
        }
        if !Self.tokenShape.test(v) {
            status = ("Saved, but it doesn't look like a GitHub token (ghp_…, github_pat_…).", Theme.warn)
        }
        Task { await test() }
    }

    private func test() async {
        testing = true
        defer { testing = false }
        status = ("Checking…", .secondary)
        do {
            if let r = try await repo.rateLimit() {
                let who = settings.githubToken.isEmpty ? "anonymous" : "authenticated"
                status = ("\(r.remaining) of \(r.limit) requests left this hour (\(who)).", Theme.ok)
            } else {
                status = ("Connected, but GitHub didn't report a limit.", .secondary)
            }
        } catch {
            status = (friendlyError(error), Theme.warn)
        }
    }
}
