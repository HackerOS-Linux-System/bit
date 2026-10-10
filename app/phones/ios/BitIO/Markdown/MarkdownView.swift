import SwiftUI

/// One Markdown block as native SwiftUI views.
struct MarkdownBlockView: View {
    let block: MdBlock

    var body: some View {
        switch block {
        case let .heading(level, text):
            Text(InlineMarkdown.render(text))
                .font(headingFont(level))
                .fontWeight(.bold)
                .padding(.top, level <= 2 ? 10 : 4)
                .frame(maxWidth: .infinity, alignment: .leading)

        case let .paragraph(text):
            Text(InlineMarkdown.render(text))
                .font(.body)
                .frame(maxWidth: .infinity, alignment: .leading)

        case let .code(_, code):
            CodeBlockView(code: code)

        case let .quote(blocks):
            HStack(alignment: .top, spacing: 10) {
                RoundedRectangle(cornerRadius: 2).fill(Theme.purple.opacity(0.6)).frame(width: 3)
                VStack(alignment: .leading, spacing: 6) {
                    ForEach(Array(blocks.enumerated()), id: \.offset) { _, b in
                        MarkdownBlockView(block: b)
                    }
                }
            }

        case let .item(depth, marker, text, checked):
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text(checked == nil ? marker : (checked == true ? "☑" : "☐"))
                    .foregroundStyle(.secondary)
                    .frame(minWidth: 18, alignment: .trailing)
                Text(InlineMarkdown.render(text))
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .padding(.leading, CGFloat(depth) * 16)

        case let .table(header, rows):
            ScrollView(.horizontal, showsIndicators: false) {
                Grid(alignment: .leading, horizontalSpacing: 18, verticalSpacing: 8) {
                    GridRow {
                        ForEach(Array(header.enumerated()), id: \.offset) { _, h in
                            Text(InlineMarkdown.render(h)).font(.subheadline.weight(.semibold))
                        }
                    }
                    Divider()
                    ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
                        GridRow {
                            ForEach(Array(row.enumerated()), id: \.offset) { _, cell in
                                Text(InlineMarkdown.render(cell))
                                    .font(.footnote)
                                    .frame(maxWidth: 240, alignment: .leading)
                            }
                        }
                    }
                }
                .padding(10)
            }
            .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 10))

        case .rule:
            Divider().padding(.vertical, 6)
        }
    }

    private func headingFont(_ level: Int) -> Font {
        switch level {
        case 1: return .title
        case 2: return .title2
        case 3: return .title3
        default: return .headline
        }
    }
}

struct CodeBlockView: View {
    let code: String

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            Text(code)
                .font(.system(.footnote, design: .monospaced))
                .fixedSize(horizontal: true, vertical: true)
                .padding(12)
                .textSelection(.enabled)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 10))
    }
}

/// A whole document (used for release notes and the docs page).
struct MarkdownView: View {
    let blocks: [MdBlock]

    init(_ source: String) {
        blocks = MarkdownParser.parse(source)
    }

    init(blocks: [MdBlock]) {
        self.blocks = blocks
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            ForEach(Array(blocks.enumerated()), id: \.offset) { _, b in
                MarkdownBlockView(block: b)
            }
        }
    }
}
