import SwiftUI
import UIKit

/// Brand colours of bit.io (website/public/styles.css).
enum Theme {
    static let purple = Color(red: 0x7C / 255, green: 0x4D / 255, blue: 0xFF / 255)
    static let pink = Color(red: 0xEC / 255, green: 0x48 / 255, blue: 0x99 / 255)
    static let orange = Color(red: 0xFB / 255, green: 0x92 / 255, blue: 0x3C / 255)

    static let gradient = LinearGradient(colors: [purple, pink, orange], startPoint: .leading, endPoint: .trailing)

    static let ok = Color.green
    static let warn = Color.orange
    static let err = Color.red

    private static func dynamic(light: UInt32, dark: UInt32) -> Color {
        Color(UIColor { trait in
            let v = trait.userInterfaceStyle == .dark ? dark : light
            return UIColor(
                red: CGFloat((v >> 16) & 0xFF) / 255,
                green: CGFloat((v >> 8) & 0xFF) / 255,
                blue: CGFloat(v & 0xFF) / 255,
                alpha: 1
            )
        })
    }

    static func lang(_ l: Lang) -> Color {
        switch l {
        case .hsharp: return dynamic(light: 0xA5001A, dark: 0xFF5468)
        case .hackerlang: return dynamic(light: 0x6C1FD6, dark: 0xA78BFA)
        case .hackerscript: return dynamic(light: 0x0A8FA6, dark: 0x38D3EA)
        case .any: return dynamic(light: 0x6E6E85, dark: 0x8B8B9C)
        }
    }
}
