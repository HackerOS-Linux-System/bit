import SwiftUI

struct RootView: View {
    var body: some View {
        TabView {
            LibrariesView()
                .tabItem { Label("Libraries", systemImage: "books.vertical") }
            DocsView()
                .tabItem { Label("Docs", systemImage: "book") }
            SettingsView()
                .tabItem { Label("Settings", systemImage: "gearshape") }
        }
    }
}
