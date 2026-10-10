import SwiftUI

struct LibrariesView: View {
    @EnvironmentObject private var store: LibraryStore
    @Environment(\.openURL) private var openURL

    var body: some View {
        NavigationStack {
            let list = store.filtered()
            List {
                Section {
                    HeroView()
                        .listRowInsets(EdgeInsets())
                        .listRowBackground(Color.clear)
                }

                if let note = store.offlineNote {
                    Section { Text(note).font(.footnote).foregroundStyle(Theme.warn) }
                }
                if let err = store.error {
                    Section { Text("Could not load the index: \(err)").font(.footnote).foregroundStyle(Theme.err) }
                }

                Section {
                    if list.isEmpty && !store.libraries.isEmpty {
                        Text("Nothing matches. Try another search or clear the filters.").foregroundStyle(.secondary)
                    }
                    ForEach(list) { lib in
                        NavigationLink(value: lib.name) { LibraryRow(lib: lib) }
                            .swipeActions(edge: .trailing, allowsFullSwipe: true) {
                                Button { copyToClipboard(lib.installCommand) } label: {
                                    Label("Copy install", systemImage: "doc.on.doc")
                                }
                                .tint(Theme.purple)
                            }
                            .contextMenu {
                                Button { copyToClipboard(lib.installCommand) } label: {
                                    Label("Copy install command", systemImage: "doc.on.doc")
                                }
                                if let url = safeURL(lib.target) {
                                    Button { openURL(url) } label: { Label("Open source", systemImage: "safari") }
                                }
                            }
                    }
                } header: {
                    Text("\(list.count) of \(store.libraries.count) libraries" + (store.tag.isEmpty ? "" : "  ·  tag: \(store.tag)"))
                }
            }
            .listStyle(.insetGrouped)
            .navigationTitle("Libraries")
            .navigationDestination(for: String.self) { name in
                LibraryDetailView(name: name)
            }
            .searchable(text: $store.query, prompt: "Search libraries, tags, authors…")
            .refreshable { await store.refresh() }
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Menu {
                        Picker("Language", selection: $store.lang) {
                            Text("All languages").tag(Lang?.none)
                            ForEach(Lang.filterable) { l in Text(l.label).tag(Lang?.some(l)) }
                        }
                        if !store.tag.isEmpty {
                            Button(role: .destructive) { store.tag = "" } label: {
                                Label("Clear tag “\(store.tag)”", systemImage: "xmark.circle")
                            }
                        }
                    } label: {
                        Image(systemName: (store.lang != nil || !store.tag.isEmpty)
                              ? "line.3.horizontal.decrease.circle.fill"
                              : "line.3.horizontal.decrease.circle")
                    }
                }
            }
            .overlay(alignment: .bottom) {
                if store.loading {
                    ProgressView().padding(10).background(.regularMaterial, in: Capsule()).padding(.bottom, 8)
                }
            }
        }
    }
}

private struct HeroView: View {
    @EnvironmentObject private var store: LibraryStore

    var body: some View {
        let langs = max(Set(store.libraries.map { $0.lang }.filter { $0 != .any }).count, 3)
        VStack(spacing: 6) {
            Text("bit.io")
                .font(.system(size: 40, weight: .heavy, design: .rounded))
                .foregroundStyle(Theme.gradient)
            Text("one index for every HackerOS language").font(.headline)
            Text("Libraries for H#, Hacker Lang and HackerScript - installed checksummed and linked statically by bit.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
            HStack(spacing: 28) {
                StatBlock(value: String(store.libraries.count), label: "libraries")
                StatBlock(value: String(langs), label: "languages")
                StatBlock(value: store.index.map { $0.updatedAt.isEmpty ? "-" : $0.updatedAt } ?? "-", label: "index updated")
            }
            .padding(.top, 10)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 12)
    }
}

private struct LibraryRow: View {
    let lib: LibEntry

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(lib.name).font(.headline).foregroundStyle(Theme.purple).lineLimit(1)
                Spacer(minLength: 8)
                LangBadge(lang: lib.lang)
            }
            Text(lib.description.isEmpty ? "No description." : lib.description)
                .font(.subheadline)
                .foregroundStyle(.secondary)
            if !lib.tags.isEmpty {
                FlowLayout(spacing: 6) {
                    ForEach(lib.tags.prefix(5), id: \.self) { TagChip(text: $0) }
                }
            }
            Text("$ \(lib.installCommand)")
                .font(.system(.caption, design: .monospaced))
                .foregroundStyle(.secondary)
        }
        .padding(.vertical, 4)
    }
}
