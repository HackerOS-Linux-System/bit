import SwiftUI
import UIKit

// MARK: - loading state

enum Load<T> {
    case loading
    case missing
    case failed(String)
    case ok(T, stale: Bool)

    var value: T? {
        if case let .ok(v, _) = self { return v }
        return nil
    }
}

/// Runs a repository call and maps it to a [Load]. Returns nil when the surrounding task was cancelled
/// (a newer load replaced it), so a stale result never overwrites a fresh one.
func runLoad<T>(_ op: () async throws -> Loaded<T>) async -> Load<T>? {
    do {
        let r = try await op()
        if Task.isCancelled { return nil }
        if let v = r.value { return .ok(v, stale: r.stale) }
        return .missing
    } catch {
        if Task.isCancelled || error is CancellationError { return nil }
        return .failed(friendlyError(error))
    }
}

/// The usual four states of a [Load].
struct LoadView<T, Content: View>: View {
    let state: Load<T>
    let missing: String
    @ViewBuilder let content: (T, Bool) -> Content

    var body: some View {
        switch state {
        case .loading:
            HStack { Spacer(); ProgressView(); Spacer() }.padding(.vertical, 12)
        case .missing:
            Text(missing).foregroundStyle(.secondary)
        case let .failed(message):
            Text(message).foregroundStyle(Theme.err)
        case let .ok(value, stale):
            content(value, stale)
        }
    }
}

// MARK: - widgets

struct LangBadge: View {
    let lang: Lang

    var body: some View {
        let color = Theme.lang(lang)
        HStack(spacing: 5) {
            Circle().fill(color).frame(width: 7, height: 7)
            Text(lang.label).font(.caption.weight(.semibold)).foregroundStyle(color)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 3)
        .background(color.opacity(0.12), in: Capsule())
        .overlay(Capsule().stroke(color.opacity(0.35), lineWidth: 1))
    }
}

struct TagChip: View {
    let text: String

    var body: some View {
        Text(text)
            .font(.caption)
            .foregroundStyle(.secondary)
            .padding(.horizontal, 10)
            .padding(.vertical, 4)
            .background(Color(.secondarySystemFill), in: Capsule())
    }
}

/// Wraps its children onto several lines (tags).
struct FlowLayout: Layout {
    var spacing: CGFloat = 6

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let maxWidth = proposal.width ?? .infinity
        var x: CGFloat = 0
        var y: CGFloat = 0
        var rowHeight: CGFloat = 0
        var widest: CGFloat = 0
        for s in subviews {
            let size = s.sizeThatFits(.unspecified)
            if x > 0 && x + size.width > maxWidth {
                y += rowHeight + spacing
                x = 0
                rowHeight = 0
            }
            x += size.width + spacing
            rowHeight = max(rowHeight, size.height)
            widest = max(widest, x - spacing)
        }
        return CGSize(width: widest, height: y + rowHeight)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX
        var y = bounds.minY
        var rowHeight: CGFloat = 0
        for s in subviews {
            let size = s.sizeThatFits(.unspecified)
            if x > bounds.minX && x + size.width > bounds.maxX {
                y += rowHeight + spacing
                x = bounds.minX
                rowHeight = 0
            }
            s.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(size))
            x += size.width + spacing
            rowHeight = max(rowHeight, size.height)
        }
    }
}

/// A shell command with a one-tap copy button.
struct CommandRow: View {
    let command: String
    @State private var copied = false

    var body: some View {
        HStack {
            Text("$ \(command)")
                .font(.system(.footnote, design: .monospaced))
                .lineLimit(2)
                .frame(maxWidth: .infinity, alignment: .leading)
            Button(copied ? "Copied" : "Copy") {
                copyToClipboard(command)
                copied = true
                Task {
                    try? await Task.sleep(nanoseconds: 1_500_000_000)
                    copied = false
                }
            }
            .buttonStyle(.borderless)
            .font(.footnote.weight(.semibold))
        }
        .padding(.vertical, 2)
    }
}

func copyToClipboard(_ text: String) {
    UIPasteboard.general.string = text
    UINotificationFeedbackGenerator().notificationOccurred(.success)
}

struct KeyValueRow: View {
    let key: String
    let value: String

    var body: some View {
        HStack(alignment: .top) {
            Text(key).foregroundStyle(.secondary).frame(width: 104, alignment: .leading)
            Text(value).frame(maxWidth: .infinity, alignment: .leading)
        }
        .font(.subheadline)
    }
}

struct StatBlock: View {
    let value: String
    let label: String

    var body: some View {
        VStack(spacing: 2) {
            Text(value).font(.title3.weight(.bold))
            Text(label).font(.caption2).foregroundStyle(.secondary)
        }
    }
}
