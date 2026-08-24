import Foundation
import SwiftUI

enum AppSection: String, CaseIterable, Identifiable {
    case focus
    case mixes
    case history
    case settings

    var id: String { rawValue }

    var title: String {
        switch self {
        case .focus: return "워크 모드"
        case .mixes: return "업무 믹스"
        case .history: return "기록"
        case .settings: return "설정"
        }
    }

    var symbol: String {
        switch self {
        case .focus: return "circle.grid.cross"
        case .mixes: return "music.note.list"
        case .history: return "chart.bar.xaxis"
        case .settings: return "gearshape"
        }
    }
}

struct FocusPreset: Identifiable, Hashable {
    let id: String
    let title: String
    let subtitle: String
    let focusMinutes: Int
    let breakMinutes: Int

    static let defaults: [FocusPreset] = [
        .init(id: "sprint", title: "스프린트", subtitle: "짧게 시작하기", focusMinutes: 25, breakMinutes: 5),
        .init(id: "balanced", title: "기본 세션", subtitle: "집중 흐름 만들기", focusMinutes: 45, breakMinutes: 10),
        .init(id: "deep", title: "딥워크", subtitle: "한 가지 일에 몰입", focusMinutes: 60, breakMinutes: 10),
        .init(id: "flow", title: "플로우", subtitle: "긴 창작·개발 작업", focusMinutes: 90, breakMinutes: 15)
    ]
}

enum FocusMode: String, CaseIterable, Identifiable, Hashable {
    case deep
    case balanced
    case energy

    var id: String { rawValue }

    var title: String {
        switch self {
        case .deep: return "깊은 집중"
        case .balanced: return "균형"
        case .energy: return "에너지"
        }
    }

    var symbol: String {
        switch self {
        case .deep: return "moon.stars"
        case .balanced: return "circle.lefthalf.filled"
        case .energy: return "bolt"
        }
    }
}

struct FocusMix: Identifiable, Hashable {
    let id: String
    let title: String
    let creator: String
    let detail: String
    let youtubeVideoID: String
    let symbol: String
    let tint: Color

    var thumbnailURL: URL? {
        URL(string: "https://i.ytimg.com/vi/\(youtubeVideoID)/hqdefault.jpg")
    }

    var energy: Int {
        switch id {
        case "spring-focus": return 68
        case "japanese-flow": return 52
        default: return 38
        }
    }

    static let defaults: [FocusMix] = [
        .init(
            id: "lofi-archive",
            title: "Lo-fi Archive",
            creator: "Lofi Girl",
            detail: "반복 업무 · 문서 정리",
            youtubeVideoID: "n61ULEU7CO0",
            symbol: "text.page",
            tint: Color(red: 0.48, green: 0.42, blue: 0.70)
        ),
        .init(
            id: "spring-focus",
            title: "Spring Focus",
            creator: "Chillhop Music",
            detail: "기획 · 가벼운 코딩",
            youtubeVideoID: "HFQibg2OJkU",
            symbol: "leaf",
            tint: Color(red: 0.38, green: 0.56, blue: 0.48)
        ),
        .init(
            id: "japanese-flow",
            title: "Japanese Flow",
            creator: "Deebu",
            detail: "집중 코딩 · 디자인",
            youtubeVideoID: "EtD7_8kCMHA",
            symbol: "command",
            tint: Color(red: 0.66, green: 0.43, blue: 0.44)
        )
    ]
}

struct FocusSessionRecord: Identifiable, Codable {
    let id: UUID
    let task: String
    let minutes: Int
    let completedAt: Date
    let mixTitle: String
}
