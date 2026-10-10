import SwiftUI

private enum DetailTab: String, CaseIterable, Identifiable {
    case overview = "Overview"
    case source = "Source"
    case versions = "Versions"
    var id: String { rawValue }
}

struct LibraryDetailView: View {
    let name: String

    @EnvironmentObject private var store: LibraryStore
    @EnvironmentObject private var repo: BitRepository
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL

    @State private var tab: DetailTab = .overview
    @State private var refOverride: String?

    var body: some View {
        if let entry = store.find(name) {
            content(entry)
        } else {
            VStack(spacing: 12) {
                Text("\"\(name)\" is not in the index.").foregroundStyle(.secondary)
                Button("Browse the index") { dismiss() }
            }
            .padding()
        }
    }

    @ViewBuilder
    private func content(_ entry: LibEntry) -> some View {
        let defaultRef = entry.rev.isEmpty ? "HEAD" : entry.rev
        let ref = refOverride ?? defaultRef
        let gh = entry.github

        VStack(spacing: 0) {
            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    LangBadge(lang: entry.lang)
                    if ref != defaultRef {
                        Text("version \(ref)").font(.caption).foregroundStyle(Theme.warn)
                        Button("Back to default") { refOverride = nil }.font(.caption)
                    }
                    Spacer()
                }
                if !entry.description.isEmpty {
                    Text(entry.description).font(.subheadline).foregroundStyle(.secondary)
                }
                if !entry.tags.isEmpty {
                    FlowLayout(spacing: 6) {
                        ForEach(entry.tags, id: \.self) { t in
                            Button {
                                store.tag = t
                                dismiss()
                            } label: { TagChip(text: t) }
                            .buttonStyle(.plain)
                        }
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal)
            .padding(.bottom, 8)

            Picker("Section", selection: $tab) {
                ForEach(DetailTab.allCases) { Text($0.rawValue).tag($0) }
            }
            .pickerStyle(.segmented)
            .padding(.horizontal)
            .padding(.bottom, 8)

            switch tab {
            case .overview:
                OverviewTab(entry: entry, gh: gh, ref: ref)
            case .source:
                SourceTab(gh: gh, ref: ref)
            case .versions:
                VersionsTab(gh: gh, ref: ref) { newRef in
                    refOverride = newRef
                    tab = .overview
                }
            }
        }
        .navigationTitle(entry.name)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .navigationBarTrailing) {
                if let url = safeURL(entry.target) {
                    Button { openURL(url) } label: { Image(systemName: "safari") }
                }
            }
        }
    }
}

// MARK: - Overview

private struct OverviewTab: View {
    let entry: LibEntry
    let gh: GithubRepo?
    let ref: String

    @EnvironmentObject private var store: LibraryStore
    @EnvironmentObject private var repo: BitRepository
    @Environment(\.openURL) private var openURL

    @State private var manifest: Load<Manifest> = .loading
    @State private var meta: Load<RepoMeta> = .loading
    @State private var readme: Load<Readme> = .loading
    @State private var readmeBlocks: [MdBlock] = []

    var body: some View {
        List {
            Section("Install") {
                CommandRow(command: entry.installCommand)
                CommandRow(command: entry.addCommand)
                Text("add also writes it to [dependencies] in Bit.hk.").font(.caption).foregroundStyle(.secondary)
            }

            Section("About") { aboutRows }

            if gh != nil {
                Section("GitHub") {
                    LoadView(state: meta, missing: "No repository data.") { m, stale in
                        VStack(alignment: .leading, spacing: 8) {
                            HStack(spacing: 24) {
                                StatBlock(value: "★ \(compactNumber(m.stars))", label: "stars")
                                StatBlock(value: compactNumber(m.forks), label: "forks")
                                StatBlock(value: compactNumber(m.openIssues), label: "issues")
                            }
                            if let a = activity(m.pushedAt) {
                                Text("\(a.0) · last push \(String(m.pushedAt.prefix(10)))").font(.caption).foregroundStyle(a.1)
                            }
                            if m.archived { Text("This repository is archived.").font(.caption).foregroundStyle(Theme.warn) }
                            if stale { Text("Saved copy (offline).").font(.caption).foregroundStyle(Theme.warn) }
                        }
                    }
                }
            }

            if let doc = manifest.value?.doc {
                let deps = dependenciesOf(doc)
                let notes = compatNotes(entry, doc, store.libraries)
                if !deps.isEmpty || !notes.isEmpty {
                    Section("Compatibility & dependencies") {
                        ForEach(notes) { n in
                            Text((n.ok ? "✓ " : "⚠ ") + n.text)
                                .font(.footnote)
                                .foregroundStyle(n.ok ? Theme.ok : Theme.warn)
                        }
                        ForEach(deps) { d in depRow(d) }
                    }
                }
            }

            if !entry.rev.isEmpty || !entry.checksum.isEmpty {
                Section("Pinned revision") {
                    if !entry.rev.isEmpty { KeyValueRow(key: "Revision", value: entry.rev) }
                    if !entry.checksum.isEmpty {
                        VStack(alignment: .leading, spacing: 4) {
                            Text("sha256 (checked by `bit verify`)").font(.caption).foregroundStyle(.secondary)
                            Text(entry.checksum).font(.system(size: 11, design: .monospaced)).textSelection(.enabled)
                        }
                    }
                }
            }

            Section("README") {
                if gh == nil {
                    Text("This library isn't hosted on GitHub, so its README can't be shown here.").foregroundStyle(.secondary)
                } else {
                    switch readme {
                    case .loading:
                        HStack { Spacer(); ProgressView(); Spacer() }
                    case .missing:
                        Text("This repository has no README.").foregroundStyle(.secondary)
                    case let .failed(msg):
                        Text(msg).foregroundStyle(Theme.err)
                    case let .ok(_, stale):
                        if stale { Text("Saved copy (offline).").font(.caption).foregroundStyle(Theme.warn) }
                        ForEach(Array(readmeBlocks.enumerated()), id: \.offset) { _, b in
                            MarkdownBlockView(block: b)
                                .listRowSeparator(.hidden)
                        }
                    }
                }
            }
        }
        .listStyle(.insetGrouped)
        .task(id: ref) { await loadAll() }
    }

    @ViewBuilder
    private var aboutRows: some View {
        let doc = manifest.value?.doc
        let pkgSection: [String: String] = doc?["package"] ?? [:]
        let projSection: [String: String] = doc?["project"] ?? [:]
        let pkg: [String: String] = pkgSection.isEmpty ? projSection : pkgSection
        let m = meta.value
        KeyValueRow(key: "Language", value: entry.lang.label)
        if let v = pkg["version"], !v.isEmpty { KeyValueRow(key: "Version", value: v) }
        if let l = [pkg["license"], m?.license].compactMap({ $0 }).first(where: { !$0.isEmpty }) {
            KeyValueRow(key: "License", value: l)
        }
        if !entry.author.isEmpty { KeyValueRow(key: "Author", value: entry.author) }
        let authors = Hk.list(pkg["authors"])
        if !authors.isEmpty { KeyValueRow(key: "Authors", value: authors.joined(separator: ", ")) }
        let libOutput: String = nonEmpty(doc?["lib"]["output"]) ?? "hlib"
        KeyValueRow(key: "Library output", value: "\(libOutput) - static")
        if !entry.target.isEmpty { KeyValueRow(key: "Repository", value: entry.target.replacingOccurrences(of: "https://", with: "")) }
        if let hp = m?.homepage, safeURL(hp) != nil {
            KeyValueRow(key: "Homepage", value: hp.replacingOccurrences(of: "https://", with: "").replacingOccurrences(of: "http://", with: ""))
        }
        if case .loading = manifest, gh != nil { ProgressView() }
    }

    @ViewBuilder
    private func depRow(_ d: DepSpec) -> some View {
        let (kind, lib) = classifyDep(d, store.libraries)
        let suffix: String = {
            switch kind {
            case .index: return "in the index"
            case .git: return "git"
            case .path: return "local path"
            case .unknown: return "not in the index"
            }
        }()
        let row = HStack(alignment: .firstTextBaseline) {
            Text(d.name)
                .font(.system(.subheadline, design: .monospaced).weight(.semibold))
                .foregroundStyle(lib != nil ? Theme.purple : Color.primary)
            Spacer()
            Text("\(d.spec.isEmpty ? "*" : d.spec)  ·  \(suffix)")
                .font(.caption)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.trailing)
        }
        if let lib = lib {
            NavigationLink(value: lib.name) { row }
        } else {
            row
        }
    }

    private func nonEmpty(_ s: String?) -> String? {
        guard let s = s, !s.isEmpty else { return nil }
        return s
    }

    private func activity(_ pushedAt: String) -> (String, Color)? {
        guard let date = ISO8601DateFormatter().date(from: pushedAt) else { return nil }
        let days = Date().timeIntervalSince(date) / 86_400
        if days < 90 { return ("Active", Theme.ok) }
        if days < 365 { return ("Quiet", Theme.warn) }
        return ("Inactive", Theme.err)
    }

    private func loadAll() async {
        manifest = .loading
        meta = .loading
        readme = .loading
        readmeBlocks = []
        guard let gh = gh else {
            manifest = .missing; meta = .missing; readme = .missing
            return
        }
        async let m = runLoad { try await repo.loadManifest(gh, ref: ref) }
        async let g = runLoad { try await repo.loadMeta(gh) }
        async let r = runLoad { try await repo.loadReadme(gh, ref: ref) }
        let (mv, gv, rv) = await (m, g, r)
        if Task.isCancelled { return }
        if let mv = mv { manifest = mv }
        if let gv = gv { meta = gv }
        if let rv = rv {
            readme = rv
            if case let .ok(doc, _) = rv {
                readmeBlocks = doc.markdown ? MarkdownParser.parse(doc.text) : [.code(lang: "", code: doc.text)]
            }
        }
    }
}

// MARK: - Source

private struct SourceTab: View {
    let gh: GithubRepo?
    let ref: String

    @EnvironmentObject private var repo: BitRepository

    @State private var tree: Load<RepoTree> = .loading
    @State private var dir = ""
    @State private var file: String?

    var body: some View {
        Group {
            if let gh = gh {
                if let file = file {
                    FileViewer(gh: gh, ref: ref, path: file) { self.file = nil }
                } else {
                    browser
                }
            } else {
                Text("This library isn't hosted on GitHub, so its source can't be browsed here.")
                    .foregroundStyle(.secondary).padding()
                Spacer()
            }
        }
        .task(id: ref) {
            guard let gh = gh else { return }
            tree = .loading
            dir = ""
            file = nil
            if let t = await runLoad({ try await repo.loadTree(gh, ref: ref) }) { tree = t }
        }
    }

    @ViewBuilder
    private var browser: some View {
        switch tree {
        case .loading:
            ProgressView().padding(); Spacer()
        case .missing:
            Text("Repository not found.").foregroundStyle(.secondary).padding(); Spacer()
        case let .failed(msg):
            Text(msg).foregroundStyle(Theme.err).padding(); Spacer()
        case let .ok(t, stale):
            let prefix = dir.isEmpty ? "" : dir + "/"
            let children = t.items
                .filter { $0.path.hasPrefix(prefix) && !$0.path.dropFirst(prefix.count).contains("/") }
                .sorted { a, b in
                    if a.isDir != b.isDir { return a.isDir }
                    return a.path.lowercased() < b.path.lowercased()
                }
            List {
                Section {
                    HStack {
                        Text("\(gh?.repo ?? "")/\(dir)")
                            .font(.system(.caption, design: .monospaced))
                            .foregroundStyle(.secondary)
                        Spacer()
                        if !dir.isEmpty {
                            Button("↑ Up") {
                                dir = dir.contains("/") ? String(dir[..<dir.lastIndex(of: "/")!]) : ""
                            }
                            .font(.caption)
                        }
                    }
                    if t.truncated { Text("The repository is large: GitHub truncated the file list.").font(.caption).foregroundStyle(Theme.warn) }
                    if stale { Text("Saved copy (offline).").font(.caption).foregroundStyle(Theme.warn) }
                }
                Section {
                    ForEach(children) { item in
                        Button {
                            if item.isDir { dir = item.path } else { file = item.path }
                        } label: {
                            HStack {
                                Image(systemName: item.isDir ? "folder.fill" : "doc.text")
                                    .foregroundStyle(item.isDir ? Theme.purple : Color.secondary)
                                Text(String(item.path.dropFirst(prefix.count)))
                                    .font(.system(.subheadline, design: .monospaced))
                                    .foregroundStyle(Color.primary)
                                    .lineLimit(1)
                                Spacer()
                                if !item.isDir { Text(formatBytes(item.size)).font(.caption2).foregroundStyle(.secondary) }
                            }
                        }
                    }
                    if children.isEmpty { Text("Empty directory.").foregroundStyle(.secondary) }
                }
            }
            .listStyle(.insetGrouped)
        }
    }
}

private struct FileViewer: View {
    let gh: GithubRepo
    let ref: String
    let path: String
    let onClose: () -> Void

    @EnvironmentObject private var repo: BitRepository
    @State private var state: Load<String> = .loading

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Button("← Files", action: onClose)
                Text(path)
                    .font(.system(.caption, design: .monospaced))
                    .lineLimit(1)
                    .truncationMode(.head)
                Spacer()
            }
            .padding(.horizontal)
            .padding(.bottom, 8)
            Divider()
            switch state {
            case .loading:
                ProgressView().padding(); Spacer()
            case .missing:
                Text("File not found.").foregroundStyle(.secondary).padding(); Spacer()
            case let .failed(msg):
                Text(msg).foregroundStyle(Theme.err).padding(); Spacer()
            case let .ok(text, _):
                if text.contains("\u{0}") {
                    Text("Binary file - not shown.").foregroundStyle(.secondary).padding(); Spacer()
                } else {
                    let lines = Array(text.components(separatedBy: "\n").prefix(5000))
                    ScrollView([.vertical, .horizontal]) {
                        LazyVStack(alignment: .leading, spacing: 0) {
                            ForEach(Array(lines.enumerated()), id: \.offset) { i, line in
                                HStack(alignment: .top, spacing: 10) {
                                    Text(String(i + 1))
                                        .font(.system(size: 11, design: .monospaced))
                                        .foregroundStyle(.tertiary)
                                        .frame(width: 38, alignment: .trailing)
                                    Text(line.isEmpty ? " " : line)
                                        .font(.system(size: 12, design: .monospaced))
                                        .fixedSize(horizontal: true, vertical: false)
                                }
                            }
                        }
                        .padding(.vertical, 8)
                        .padding(.horizontal, 8)
                        .textSelection(.enabled)
                    }
                }
            }
        }
        .task(id: path) {
            state = .loading
            if let s = await runLoad({ try await repo.loadFile(gh, ref: ref, path: path) }) { state = s }
        }
    }
}

// MARK: - Versions

private struct VersionsTab: View {
    let gh: GithubRepo?
    let ref: String
    let onView: (String) -> Void

    @EnvironmentObject private var repo: BitRepository
    @Environment(\.openURL) private var openURL
    @State private var releases: Load<[Release]> = .loading

    var body: some View {
        Group {
            if gh == nil {
                VStack {
                    Text("This library isn't hosted on GitHub, so its releases can't be listed here.")
                        .foregroundStyle(.secondary).padding()
                    Spacer()
                }
            } else {
                switch releases {
                case .loading:
                    VStack { ProgressView().padding(); Spacer() }
                case .missing:
                    VStack { Text("No releases.").foregroundStyle(.secondary).padding(); Spacer() }
                case let .failed(msg):
                    VStack { Text(msg).foregroundStyle(Theme.err).padding(); Spacer() }
                case let .ok(list, stale):
                    if list.isEmpty {
                        VStack { Text("This repository has no releases or tags.").foregroundStyle(.secondary).padding(); Spacer() }
                    } else {
                        List {
                            if stale { Text("Saved copy (offline).").font(.caption).foregroundStyle(Theme.warn) }
                            ForEach(list) { rel in releaseSection(rel) }
                        }
                        .listStyle(.insetGrouped)
                    }
                }
            }
        }
        .task {
            guard let gh = gh else { return }
            if let r = await runLoad({ try await repo.loadReleases(gh) }) { releases = r }
        }
    }

    @ViewBuilder
    private func releaseSection(_ rel: Release) -> some View {
        let current = rel.tag == ref
        Section {
            HStack {
                Text(rel.tag).font(.system(.headline, design: .monospaced))
                Spacer()
                if rel.prerelease { TagChip(text: "pre-release") }
                if current { TagChip(text: "viewing") }
            }
            let sub = [rel.name == rel.tag ? "" : rel.name, String(rel.date.prefix(10))].filter { !$0.isEmpty }.joined(separator: "  ·  ")
            if !sub.isEmpty { Text(sub).font(.caption).foregroundStyle(.secondary) }
            if rel.tagOnly { Text("Tag only - no release was published.").font(.caption).foregroundStyle(.secondary) }
            if !rel.body.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                DisclosureGroup("Release notes") { MarkdownView(rel.body).padding(.top, 6) }
            }
            ForEach(rel.assets) { a in
                Button {
                    if let u = safeURL(a.url) { openURL(u) }
                } label: {
                    HStack {
                        Image(systemName: "arrow.down.circle")
                        Text(a.name).font(.system(.footnote, design: .monospaced)).lineLimit(1)
                        Spacer()
                        Text(formatBytes(a.size)).font(.caption2).foregroundStyle(.secondary)
                    }
                }
            }
            HStack {
                if !current { Button("View this version") { onView(rel.tag) }.buttonStyle(.borderedProminent) }
                Spacer()
                Button("GitHub ↗") { if let u = safeURL(rel.url) { openURL(u) } }.buttonStyle(.bordered)
            }
            .padding(.vertical, 2)
        }
    }
}
