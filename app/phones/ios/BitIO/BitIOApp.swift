import SwiftUI

@main
@MainActor
struct BitIOApp: App {
    @StateObject private var repo: BitRepository
    @StateObject private var settings: AppSettings
    @StateObject private var store: LibraryStore

    init() {
        let r = BitRepository()
        _repo = StateObject(wrappedValue: r)
        _settings = StateObject(wrappedValue: AppSettings(repo: r))
        _store = StateObject(wrappedValue: LibraryStore(repo: r))
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(repo)
                .environmentObject(settings)
                .environmentObject(store)
                .preferredColorScheme(settings.theme.colorScheme)
                .tint(Theme.purple)
                .task { await store.refresh() }
        }
    }
}
