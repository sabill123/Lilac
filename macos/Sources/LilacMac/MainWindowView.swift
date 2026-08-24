import SwiftUI

enum LilacTheme {
    static let accent = Color(red: 0.72, green: 0.61, blue: 1.00)
    static let accentBright = Color(red: 0.82, green: 0.75, blue: 1.00)
    static let canvas = Color(red: 0.037, green: 0.039, blue: 0.052)
    static let sidebar = Color(red: 0.045, green: 0.047, blue: 0.061)
    static let panel = Color(red: 0.061, green: 0.064, blue: 0.082)
    static let panelRaised = Color(red: 0.082, green: 0.086, blue: 0.109)
    static let stroke = Color.white.opacity(0.075)
    static let muted = Color.white.opacity(0.58)
    static let faint = Color.white.opacity(0.34)
}

private extension View {
    func lilacPanel(radius: CGFloat = 18, shadow: Bool = false) -> some View {
        self
            .background(LilacTheme.panel.opacity(0.96), in: RoundedRectangle(cornerRadius: radius, style: .continuous))
            .overlay { RoundedRectangle(cornerRadius: radius, style: .continuous).stroke(LilacTheme.stroke) }
            .shadow(color: shadow ? Color.black.opacity(0.25) : .clear, radius: 26, y: 14)
    }
}

struct MainWindowView: View {
    @ObservedObject var state: AppState
    @ObservedObject private var player: YouTubePlayerController

    init(state: AppState) {
        self.state = state
        self.player = state.player
    }

    var body: some View {
        HStack(spacing: 0) {
            LilacSidebar(state: state).frame(width: 224)
            Rectangle().fill(Color.white.opacity(0.055)).frame(width: 1)
            ZStack {
                LilacCanvas(tint: state.selectedMix.tint)
                VStack(spacing: 0) {
                    DetailHeader(state: state, player: player)
                    sectionContent.frame(maxWidth: .infinity, maxHeight: .infinity)
                    PlayerBar(state: state, player: player)
                }
            }
        }
        .background(LilacTheme.canvas)
        .tint(LilacTheme.accent)
        .preferredColorScheme(.dark)
    }

    @ViewBuilder
    private var sectionContent: some View {
        switch state.selectedSection ?? .focus {
        case .focus: FocusWorkspace(state: state)
        case .mixes: MixLibraryView(state: state)
        case .history: HistoryView(state: state)
        case .settings: SettingsView(state: state)
        }
    }
}

private struct LilacCanvas: View {
    let tint: Color

    var body: some View {
        ZStack {
            LilacTheme.canvas
            Canvas { context, size in
                let spacing: CGFloat = 30
                for x in stride(from: spacing, through: size.width, by: spacing) {
                    for y in stride(from: spacing, through: size.height, by: spacing) {
                        context.fill(Path(ellipseIn: CGRect(x: x, y: y, width: 1.2, height: 1.2)), with: .color(.white.opacity(0.022)))
                    }
                }
            }
            RadialGradient(colors: [tint.opacity(0.14), .clear], center: .topTrailing, startRadius: 20, endRadius: 520)
        }
        .ignoresSafeArea()
    }
}

private struct LilacSidebar: View {
    @ObservedObject var state: AppState

    private var todayMinutes: Int {
        state.history.filter { Calendar.current.isDateInToday($0.completedAt) }.reduce(0) { $0 + $1.minutes }
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 11) {
                ZStack {
                    RoundedRectangle(cornerRadius: 11, style: .continuous).fill(LilacTheme.accent.opacity(0.16))
                    Image(systemName: "waveform").font(.system(size: 15, weight: .bold)).foregroundStyle(LilacTheme.accentBright)
                }
                .frame(width: 38, height: 38)
                Text("Lilac").font(.system(size: 19, weight: .semibold)).tracking(-0.5)
                Spacer()
            }
            .padding(.horizontal, 18).padding(.top, 18).padding(.bottom, 28)

            VStack(spacing: 5) {
                SidebarButton(section: .focus, state: state)
                SidebarButton(section: .mixes, state: state)
                SidebarButton(section: .history, state: state)
            }

            Spacer()

            VStack(spacing: 5) {
                SidebarButton(section: .settings, state: state)
                VStack(alignment: .leading, spacing: 11) {
                    HStack {
                        VStack(alignment: .leading, spacing: 3) {
                            Text("오늘 \(todayMinutes)분").font(.system(size: 14, weight: .semibold))
                            Text(state.hasActiveSession ? state.timerText : "하루 목표 120분")
                                .font(.system(size: 11)).foregroundStyle(LilacTheme.muted)
                        }
                        Spacer()
                        ZStack {
                            Circle().stroke(Color.white.opacity(0.08), lineWidth: 4)
                            Circle().trim(from: 0, to: min(Double(todayMinutes) / 120, 1))
                                .stroke(LilacTheme.accent, style: StrokeStyle(lineWidth: 4, lineCap: .round))
                                .rotationEffect(.degrees(-90))
                            Image(systemName: "bolt.fill").font(.system(size: 10)).foregroundStyle(LilacTheme.accentBright)
                        }
                        .frame(width: 40, height: 40)
                    }
                    GeometryReader { proxy in
                        ZStack(alignment: .leading) {
                            Capsule().fill(Color.white.opacity(0.055))
                            Capsule().fill(LilacTheme.accent).frame(width: proxy.size.width * min(Double(todayMinutes) / 120, 1))
                        }
                    }
                    .frame(height: 4)
                }
                .padding(14)
                .background(Color.white.opacity(0.035), in: RoundedRectangle(cornerRadius: 15, style: .continuous))
                .overlay { RoundedRectangle(cornerRadius: 15).stroke(LilacTheme.stroke) }
                .padding(.horizontal, 12).padding(.top, 12).padding(.bottom, 14)
            }
        }
        .background(LilacTheme.sidebar)
    }
}

private struct SidebarButton: View {
    let section: AppSection
    @ObservedObject var state: AppState
    private var selected: Bool { (state.selectedSection ?? .focus) == section }

    var body: some View {
        Button { state.selectedSection = section } label: {
            HStack(spacing: 12) {
                Image(systemName: section.symbol).font(.system(size: 15, weight: .semibold)).frame(width: 20)
                    .foregroundStyle(selected ? LilacTheme.accentBright : LilacTheme.muted)
                Text(section.title).font(.system(size: 14, weight: selected ? .semibold : .medium))
                Spacer()
                if selected { Circle().fill(LilacTheme.accentBright).frame(width: 5, height: 5) }
            }
            .foregroundStyle(selected ? Color.white : LilacTheme.muted)
            .padding(.horizontal, 14).frame(height: 44)
            .background(selected ? LilacTheme.accent.opacity(0.13) : .clear, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain).padding(.horizontal, 10)
    }
}

private struct DetailHeader: View {
    @ObservedObject var state: AppState
    @ObservedObject var player: YouTubePlayerController

    var body: some View {
        HStack(spacing: 18) {
            Text((state.selectedSection ?? .focus).title).font(.system(size: 27, weight: .semibold)).tracking(-0.7)
            Spacer()
            HStack(spacing: 8) {
                Circle().fill(state.isDucked ? Color.orange : (player.isReady ? Color.green : LilacTheme.faint)).frame(width: 7, height: 7)
                Text(state.isDucked ? "볼륨 자동 조절 중" : "스마트 볼륨")
                    .font(.system(size: 12, weight: .medium)).foregroundStyle(LilacTheme.muted)
            }
            .padding(.horizontal, 12).frame(height: 34).background(Color.white.opacity(0.045), in: Capsule())

            if state.hasActiveSession {
                Text(state.timerText).font(.system(size: 14, weight: .semibold, design: .monospaced))
                    .padding(.horizontal, 12).frame(height: 34).background(LilacTheme.accent.opacity(0.13), in: Capsule())
            }
            if state.selectedSection != .settings {
                Button { state.selectedSection = .settings } label: {
                    Image(systemName: "slider.horizontal.3").font(.system(size: 14, weight: .medium))
                        .frame(width: 34, height: 34).background(Color.white.opacity(0.045), in: Circle())
                }
                .buttonStyle(.plain).help("설정")
            }
        }
        .padding(.horizontal, 28).frame(height: 74)
        .overlay(alignment: .bottom) { Rectangle().fill(Color.white.opacity(0.05)).frame(height: 1) }
    }
}

private struct FocusWorkspace: View {
    @ObservedObject var state: AppState

    var body: some View {
        GeometryReader { proxy in
            ScrollView {
                Group {
                    if proxy.size.width >= 900 {
                        HStack(alignment: .top, spacing: 18) {
                            FocusSetupCard(state: state).frame(maxWidth: .infinity)
                            FocusPlayerCard(state: state).frame(width: min(max(proxy.size.width * 0.40, 380), 440))
                        }
                    } else {
                        VStack(spacing: 18) { FocusSetupCard(state: state); FocusPlayerCard(state: state) }
                    }
                }
                .padding(.horizontal, 28).padding(.vertical, 24)
                .frame(maxWidth: 1280).frame(maxWidth: .infinity)
            }
        }
    }
}

private struct FocusPlayerCard: View {
    @ObservedObject var state: AppState
    @ObservedObject private var player: YouTubePlayerController

    init(state: AppState) { self.state = state; self.player = state.player }

    var body: some View {
        VStack(spacing: 0) {
            ZStack(alignment: .bottomLeading) {
                YouTubePlayerView(controller: player).aspectRatio(16 / 9, contentMode: .fit).frame(maxWidth: .infinity).background(Color.black)
                if state.isDucked {
                    Label("알림이 지나갈 때까지 \(player.actualVolume)%", systemImage: "speaker.wave.1.fill")
                        .font(.system(size: 11, weight: .semibold)).padding(.horizontal, 11).frame(height: 32)
                        .background(.ultraThinMaterial, in: Capsule()).overlay { Capsule().stroke(Color.orange.opacity(0.4)) }.padding(14)
                }
            }
            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous)).padding(8)

            VStack(alignment: .leading, spacing: 0) {
                HStack(spacing: 12) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(state.selectedMix.title).font(.system(size: 19, weight: .semibold)).tracking(-0.3).lineLimit(1)
                        Text("\(state.selectedMix.creator) · YouTube")
                            .font(.system(size: 11)).foregroundStyle(LilacTheme.muted).lineLimit(1)
                    }
                    Spacer()
                    Button { state.togglePlayback() } label: {
                        Image(systemName: player.isPlaying ? "pause.fill" : "play.fill")
                            .font(.system(size: 12, weight: .bold))
                            .foregroundStyle(Color(red: 0.10, green: 0.08, blue: 0.14))
                            .frame(width: 36, height: 36)
                            .background(LilacTheme.accent, in: Circle())
                    }
                    .buttonStyle(.plain)
                }
                .padding(.horizontal, 16).padding(.top, 8).padding(.bottom, 16)

                Divider().overlay(Color.white.opacity(0.055))

                Text("다른 믹스")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(LilacTheme.muted)
                    .padding(.horizontal, 16).padding(.top, 14).padding(.bottom, 7)

                ForEach(state.mixes.filter { $0 != state.selectedMix }) { mix in
                    Button { state.selectMix(mix, autoplay: true) } label: {
                        HStack(spacing: 11) {
                            MixArtwork(mix: mix)
                                .frame(width: 46, height: 46)
                                .clipShape(RoundedRectangle(cornerRadius: 9, style: .continuous))
                            VStack(alignment: .leading, spacing: 3) {
                                Text(mix.title).font(.system(size: 12, weight: .semibold)).lineLimit(1)
                                Text(mix.detail).font(.system(size: 10)).foregroundStyle(LilacTheme.muted).lineLimit(1)
                            }
                            Spacer()
                            Image(systemName: "play.fill").font(.system(size: 9)).foregroundStyle(LilacTheme.faint)
                        }
                        .padding(.horizontal, 12).frame(height: 58)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.bottom, 8)
        }
        .lilacPanel(radius: 20, shadow: true)
    }
}

private struct FocusSetupCard: View {
    @ObservedObject var state: AppState

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("오늘 끝낼 일").font(.system(size: 25, weight: .semibold)).tracking(-0.5)
            Text("할 일과 시간을 정하면 어울리는 믹스를 골라드려요.")
                .font(.system(size: 12)).foregroundStyle(LilacTheme.muted).padding(.top, 7)
            TextField("예: 기획서 초안 마무리", text: $state.taskTitle)
                .textFieldStyle(.plain).font(.system(size: 13)).padding(.horizontal, 13).frame(height: 44)
                .background(Color.black.opacity(0.22), in: RoundedRectangle(cornerRadius: 11, style: .continuous))
                .overlay { RoundedRectangle(cornerRadius: 11).stroke(Color.white.opacity(0.09)) }
                .padding(.top, 18).disabled(state.hasActiveSession)

            HStack(alignment: .center) {
                VStack(alignment: .leading, spacing: 5) {
                    Text(state.timerText)
                        .font(.system(size: 58, weight: .semibold, design: .monospaced))
                        .tracking(-2.5)
                    Text(state.isSessionRunning ? "작업 중" : (state.hasActiveSession ? "잠시 멈춤" : "시작 전"))
                        .font(.system(size: 11, weight: .medium))
                        .foregroundStyle(state.isSessionRunning ? LilacTheme.accentBright : LilacTheme.muted)
                }
                Spacer()
                VStack(alignment: .trailing, spacing: 4) {
                    Text(state.selectedPreset.title).font(.system(size: 13, weight: .semibold))
                    Text(state.selectedMix.title).font(.system(size: 11)).foregroundStyle(LilacTheme.muted).lineLimit(1)
                }
            }
            .padding(.top, 21)

            ProgressView(value: state.sessionProgress)
                .progressViewStyle(.linear)
                .tint(LilacTheme.accent)
                .padding(.top, 11)

            Text("작업 흐름").font(.system(size: 12, weight: .semibold)).padding(.top, 18)
            HStack(spacing: 7) {
                ForEach(FocusMode.allCases) { mode in
                    SetupChoice(title: setupModeTitle(mode), selected: state.selectedMode == mode) { state.selectedMode = mode }
                }
            }
            .padding(.top, 9).disabled(state.hasActiveSession)

            Text("작업 시간").font(.system(size: 12, weight: .semibold)).padding(.top, 17)
            HStack(spacing: 7) {
                ForEach(state.presets) { preset in
                    SetupChoice(title: "\(preset.focusMinutes)분", selected: state.selectedPreset == preset) { state.selectPreset(preset) }
                }
            }
            .padding(.top, 9).disabled(state.hasActiveSession)

            Button { state.composeSession() } label: {
                HStack { Image(systemName: "sparkles"); Text("내 작업에 맞추기"); Spacer(); Image(systemName: "arrow.right") }
                    .font(.system(size: 12, weight: .semibold)).foregroundStyle(LilacTheme.muted)
                    .padding(.horizontal, 14).frame(height: 46)
                    .background(Color.white.opacity(0.045), in: RoundedRectangle(cornerRadius: 11, style: .continuous))
                    .overlay { RoundedRectangle(cornerRadius: 11).stroke(LilacTheme.stroke) }
            }
            .buttonStyle(.plain).padding(.top, 18).disabled(state.hasActiveSession)

            if let summary = state.curatedSummary {
                HStack(alignment: .top, spacing: 10) {
                    Image(systemName: "checkmark.circle.fill").foregroundStyle(LilacTheme.accentBright)
                    VStack(alignment: .leading, spacing: 4) {
                        Text(summary).font(.system(size: 12, weight: .medium)).lineLimit(2)
                        Text(state.selectedMix.title).font(.system(size: 11)).foregroundStyle(LilacTheme.muted)
                    }
                }
                .padding(13).frame(maxWidth: .infinity, alignment: .leading)
                .background(Color.white.opacity(0.035), in: RoundedRectangle(cornerRadius: 11, style: .continuous)).padding(.top, 13)
            }

            HStack(spacing: 9) {
                Button { state.toggleSession() } label: {
                    Label(
                        state.isSessionRunning ? "잠시 멈추기" : (state.hasActiveSession ? "계속하기" : "\(state.selectedPreset.focusMinutes)분 작업 시작"),
                        systemImage: state.isSessionRunning ? "pause.fill" : "play.fill"
                    )
                    .font(.system(size: 13, weight: .semibold))
                    .frame(maxWidth: .infinity).frame(height: 46)
                }
                .buttonStyle(LilacPrimaryButtonStyle(active: state.isSessionRunning))

                if state.hasActiveSession {
                    Button("종료") { state.stopSession(markCompleted: false) }
                        .buttonStyle(LilacQuietButtonStyle())
                }
            }
            .padding(.top, 14)
        }
        .padding(22).lilacPanel(radius: 20)
    }

    private func setupModeTitle(_ mode: FocusMode) -> String {
        switch mode { case .deep: return "차분하게"; case .balanced: return "균형 있게"; case .energy: return "빠르게" }
    }
}

private struct SetupChoice: View {
    let title: String
    let selected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(title).font(.system(size: 11, weight: selected ? .semibold : .medium))
                .foregroundStyle(selected ? Color.white : LilacTheme.muted).frame(maxWidth: .infinity).frame(height: 38)
                .background(selected ? LilacTheme.accent.opacity(0.16) : Color.white.opacity(0.035), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                .overlay { RoundedRectangle(cornerRadius: 10).stroke(selected ? LilacTheme.accent.opacity(0.52) : LilacTheme.stroke) }
        }
        .buttonStyle(.plain)
    }
}

private struct LilacPrimaryButtonStyle: ButtonStyle {
    let active: Bool
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .foregroundStyle(active ? Color.white.opacity(0.78) : Color(red: 0.10, green: 0.08, blue: 0.14))
            .background(active ? Color.white.opacity(0.07) : LilacTheme.accent, in: RoundedRectangle(cornerRadius: 11, style: .continuous))
            .overlay { RoundedRectangle(cornerRadius: 11).stroke(active ? LilacTheme.stroke : .clear) }
            .scaleEffect(configuration.isPressed ? 0.985 : 1)
    }
}

private struct LilacQuietButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label.font(.system(size: 12, weight: .semibold)).foregroundStyle(LilacTheme.muted)
            .padding(.horizontal, 16).frame(height: 46)
            .background(Color.white.opacity(configuration.isPressed ? 0.08 : 0.045), in: RoundedRectangle(cornerRadius: 11))
            .overlay { RoundedRectangle(cornerRadius: 11).stroke(LilacTheme.stroke) }
    }
}

private struct PlayerBar: View {
    @ObservedObject var state: AppState
    @ObservedObject var player: YouTubePlayerController

    var body: some View {
        HStack(spacing: 14) {
            MixArtwork(mix: state.selectedMix).frame(width: 56, height: 56)
                .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                .overlay { RoundedRectangle(cornerRadius: 10).stroke(Color.white.opacity(0.1)) }
            VStack(alignment: .leading, spacing: 3) {
                Text(state.selectedMix.title).font(.system(size: 14, weight: .semibold)).lineLimit(1)
                Text(state.selectedMix.creator).font(.system(size: 11)).foregroundStyle(LilacTheme.muted)
            }
            .frame(width: 170, alignment: .leading)
            Spacer(minLength: 12)
            HStack(spacing: 24) {
                Button { state.previousMix() } label: { Image(systemName: "backward.end.fill") }.help("이전 믹스")
                Button { state.togglePlayback() } label: {
                    Image(systemName: player.isPlaying ? "pause.fill" : "play.fill").font(.system(size: 15, weight: .bold))
                        .frame(width: 42, height: 42).background(LilacTheme.accent, in: Circle())
                        .foregroundStyle(Color(red: 0.10, green: 0.08, blue: 0.14))
                }.help(player.isPlaying ? "일시정지" : "재생")
                Button { state.nextMix() } label: { Image(systemName: "forward.end.fill") }.help("다음 믹스")
            }
            .buttonStyle(TransportButtonStyle())
            Spacer(minLength: 12)
            HStack(spacing: 9) {
                Image(systemName: state.userVolume == 0 ? "speaker.slash.fill" : "speaker.wave.2.fill")
                    .font(.system(size: 11)).foregroundStyle(state.isDucked ? Color.orange : LilacTheme.muted)
                Slider(value: $state.userVolume, in: 0...1).frame(width: 120).help("볼륨 \(player.actualVolume)%")
                Text("\(player.actualVolume)%").font(.system(size: 10, weight: .medium)).foregroundStyle(LilacTheme.muted)
                    .frame(width: 30, alignment: .trailing)
            }
        }
        .padding(.horizontal, 18).frame(height: 82)
        .background(.ultraThinMaterial).background(LilacTheme.sidebar.opacity(0.9))
        .overlay(alignment: .top) { Rectangle().fill(Color.white.opacity(0.065)).frame(height: 1) }
    }
}

private struct TransportButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label.foregroundStyle(Color.white.opacity(configuration.isPressed ? 0.5 : 0.8))
            .scaleEffect(configuration.isPressed ? 0.92 : 1)
    }
}

private struct MixLibraryView: View {
    @ObservedObject var state: AppState
    private let columns = [GridItem(.flexible(), spacing: 16), GridItem(.flexible(), spacing: 16), GridItem(.flexible(), spacing: 16)]

    var body: some View {
        ScrollView {
            LazyVGrid(columns: columns, spacing: 16) {
                ForEach(state.mixes) { mix in
                    MixCard(mix: mix, selected: mix == state.selectedMix, isPlaying: mix == state.selectedMix && state.player.isPlaying) {
                        if mix == state.selectedMix { state.togglePlayback() } else { state.selectMix(mix, autoplay: true) }
                    }
                }
            }
            .padding(28).frame(maxWidth: 1180).frame(maxWidth: .infinity, alignment: .top)
        }
    }
}

private struct MixCard: View {
    let mix: FocusMix
    let selected: Bool
    let isPlaying: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(alignment: .leading, spacing: 0) {
                ZStack(alignment: .topTrailing) {
                    MixArtwork(mix: mix).aspectRatio(16 / 10, contentMode: .fit).frame(maxWidth: .infinity)
                    Image(systemName: isPlaying ? "pause.fill" : "play.fill").font(.system(size: 14, weight: .bold))
                        .foregroundStyle(Color(red: 0.10, green: 0.08, blue: 0.14)).frame(width: 40, height: 40)
                        .background(LilacTheme.accent, in: Circle()).shadow(color: Color.black.opacity(0.3), radius: 12, y: 5).padding(13)
                }
                .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                VStack(alignment: .leading, spacing: 5) {
                    HStack {
                        Text(mix.title).font(.system(size: 17, weight: .semibold)).lineLimit(1)
                        Spacer()
                        if selected { Text(isPlaying ? "재생 중" : "선택됨").font(.system(size: 10, weight: .semibold)).foregroundStyle(LilacTheme.accentBright) }
                    }
                    Text(mix.creator).font(.system(size: 12)).foregroundStyle(LilacTheme.muted)
                    Text(mix.detail).font(.system(size: 11)).foregroundStyle(LilacTheme.faint)
                }
                .padding(.horizontal, 5).padding(.top, 13).padding(.bottom, 5)
            }
            .padding(8)
            .background(selected ? mix.tint.opacity(0.105) : Color.white.opacity(0.025), in: RoundedRectangle(cornerRadius: 18, style: .continuous))
            .overlay { RoundedRectangle(cornerRadius: 18).stroke(selected ? mix.tint.opacity(0.55) : LilacTheme.stroke) }
        }
        .buttonStyle(.plain)
    }
}

private struct HistoryView: View {
    @ObservedObject var state: AppState
    private var totalMinutes: Int { state.history.reduce(0) { $0 + $1.minutes } }
    private var todayMinutes: Int { state.history.filter { Calendar.current.isDateInToday($0.completedAt) }.reduce(0) { $0 + $1.minutes } }
    private var week: [DaySummary] {
        let calendar = Calendar.current, today = calendar.startOfDay(for: Date())
        return (0..<7).reversed().compactMap { offset in
            guard let date = calendar.date(byAdding: .day, value: -offset, to: today) else { return nil }
            let minutes = state.history.filter { calendar.isDate($0.completedAt, inSameDayAs: date) }.reduce(0) { $0 + $1.minutes }
            return DaySummary(date: date, minutes: minutes)
        }
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 18) {
                HStack(spacing: 12) {
                    HistoryStat(title: "오늘", value: "\(todayMinutes)분", symbol: "sun.max.fill", tint: .orange)
                    HistoryStat(title: "완료한 세션", value: "\(state.history.count)회", symbol: "checkmark.circle.fill", tint: LilacTheme.accent)
                    HistoryStat(title: "누적 시간", value: "\(totalMinutes)분", symbol: "chart.bar.fill", tint: .green)
                }
                HStack(alignment: .top, spacing: 16) {
                    WeekActivityCard(days: week).frame(maxWidth: .infinity)
                    RecentSessionsCard(state: state).frame(width: 380)
                }
            }
            .padding(28).frame(maxWidth: 1120).frame(maxWidth: .infinity, alignment: .top)
        }
    }
}

private struct DaySummary: Identifiable { let date: Date; let minutes: Int; var id: Date { date } }

private struct HistoryStat: View {
    let title: String, value: String, symbol: String
    let tint: Color
    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Image(systemName: symbol).font(.system(size: 16, weight: .semibold)).foregroundStyle(tint)
                .frame(width: 38, height: 38).background(tint.opacity(0.12), in: RoundedRectangle(cornerRadius: 11))
            VStack(alignment: .leading, spacing: 4) {
                Text(value).font(.system(size: 25, weight: .semibold)).tracking(-0.5)
                Text(title).font(.system(size: 12)).foregroundStyle(LilacTheme.muted)
            }
        }
        .padding(18).frame(maxWidth: .infinity, alignment: .leading).lilacPanel(radius: 16)
    }
}

private struct WeekActivityCard: View {
    let days: [DaySummary]
    private var total: Int { days.reduce(0) { $0 + $1.minutes } }
    private var scale: Double { Double(max(days.map(\.minutes).max() ?? 0, 60)) }

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            HStack {
                Text("이번 주 흐름").font(.system(size: 16, weight: .semibold)); Spacer()
                Text("\(total)분").font(.system(size: 13, weight: .medium)).foregroundStyle(LilacTheme.muted)
            }
            HStack(alignment: .bottom, spacing: 12) {
                ForEach(days) { day in
                    VStack(spacing: 9) {
                        ZStack(alignment: .bottom) {
                            RoundedRectangle(cornerRadius: 6, style: .continuous).fill(Color.white.opacity(0.04))
                            RoundedRectangle(cornerRadius: 6, style: .continuous).fill(LilacTheme.accent)
                                .frame(height: max(5, CGFloat(Double(day.minutes) / scale) * 164)).opacity(day.minutes == 0 ? 0.2 : 1)
                        }
                        .frame(maxWidth: .infinity).frame(height: 164)
                        Text(day.date, format: .dateTime.weekday(.narrow)).font(.system(size: 11, weight: .medium))
                            .foregroundStyle(Calendar.current.isDateInToday(day.date) ? Color.white : LilacTheme.faint)
                    }
                }
            }
        }
        .padding(20).frame(minHeight: 290, alignment: .top).lilacPanel(radius: 18)
    }
}

private struct RecentSessionsCard: View {
    @ObservedObject var state: AppState
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("최근 세션").font(.system(size: 16, weight: .semibold)).padding(20)
            Divider().overlay(Color.white.opacity(0.06))
            if state.history.isEmpty {
                VStack(spacing: 13) {
                    Image(systemName: "clock.badge.checkmark").font(.system(size: 26, weight: .light)).foregroundStyle(LilacTheme.accentBright)
                    Text("완료한 세션이 없습니다").font(.system(size: 13, weight: .medium))
                    Button("워크 모드 열기") { state.selectedSection = .focus }.buttonStyle(.bordered)
                }
                .frame(maxWidth: .infinity, minHeight: 232)
            } else {
                ForEach(Array(state.history.prefix(4).enumerated()), id: \.element.id) { index, record in
                    HistoryRow(record: record)
                    if index < min(state.history.count, 4) - 1 { Divider().overlay(Color.white.opacity(0.05)).padding(.leading, 62) }
                }
            }
        }
        .frame(minHeight: 290, alignment: .top).lilacPanel(radius: 18)
    }
}

private struct HistoryRow: View {
    let record: FocusSessionRecord
    var body: some View {
        HStack(spacing: 13) {
            Image(systemName: "checkmark").font(.system(size: 10, weight: .bold)).foregroundStyle(.green)
                .frame(width: 34, height: 34).background(Color.green.opacity(0.1), in: Circle())
            VStack(alignment: .leading, spacing: 3) {
                Text(record.task).font(.system(size: 13, weight: .semibold)).lineLimit(1)
                Text("\(record.mixTitle) · \(record.minutes)분").font(.system(size: 10)).foregroundStyle(LilacTheme.muted)
            }
            Spacer()
            Text(record.completedAt, format: .dateTime.month(.abbreviated).day()).font(.system(size: 10)).foregroundStyle(LilacTheme.faint)
        }
        .padding(.horizontal, 16).frame(height: 62)
    }
}

private struct SettingsView: View {
    @ObservedObject var state: AppState
    @ObservedObject private var player: YouTubePlayerController

    init(state: AppState) {
        self.state = state
        self.player = state.player
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 16) {
                SettingsGroup {
                    SettingsToggleRow(title: "Mac을 켤 때 함께 시작", detail: "로그인하면 Lilac을 메뉴바에 준비합니다.", symbol: "power", isOn: Binding(get: { state.launchAtLogin }, set: { state.setLaunchAtLogin($0) }))
                    SettingsDivider()
                    SettingsToggleRow(title: "스마트 볼륨", detail: "회의와 업무 앱이 활성화되면 음악을 잠시 낮춥니다.", symbol: "speaker.wave.2.fill", isOn: $state.autoDucking)
                    SettingsDivider()
                    HStack(spacing: 14) {
                        SettingsIcon(symbol: "bell.badge.fill")
                        VStack(alignment: .leading, spacing: 4) {
                            Text("볼륨 전환 확인").font(.system(size: 14, weight: .medium))
                            Text("알림이 왔을 때의 동작을 미리 확인합니다.").font(.system(size: 11)).foregroundStyle(LilacTheme.muted)
                        }
                        Spacer(); Button("테스트") { state.simulateNotification() }.buttonStyle(LilacQuietButtonStyle())
                    }
                    .frame(minHeight: 60)
                }
                SettingsGroup {
                    HStack(spacing: 14) {
                        SettingsIcon(symbol: "play.rectangle.fill", tint: .red)
                        VStack(alignment: .leading, spacing: 4) {
                            Text("YouTube 플레이어").font(.system(size: 14, weight: .medium))
                            Text("현재 적용 볼륨 \(player.actualVolume)%").font(.system(size: 11)).foregroundStyle(LilacTheme.muted)
                        }
                        Spacer()
                        HStack(spacing: 7) {
                            Circle().fill(player.isReady ? Color.green : Color.orange).frame(width: 7, height: 7)
                            Text(player.isReady ? "연결됨" : "연결 중").font(.system(size: 12, weight: .medium))
                        }
                        .foregroundStyle(player.isReady ? .green : .orange)
                    }
                    .frame(minHeight: 60)
                }
            }
            .padding(.horizontal, 28).padding(.vertical, 28).frame(maxWidth: 780).frame(maxWidth: .infinity, alignment: .top)
        }
    }
}

private struct SettingsGroup<Content: View>: View {
    let content: Content
    init(@ViewBuilder content: () -> Content) { self.content = content() }
    var body: some View { VStack(spacing: 0) { content }.padding(.horizontal, 18).padding(.vertical, 8).lilacPanel(radius: 18) }
}

private struct SettingsDivider: View { var body: some View { Divider().overlay(Color.white.opacity(0.055)).padding(.leading, 52) } }

private struct SettingsIcon: View {
    let symbol: String
    var tint: Color = LilacTheme.accentBright
    var body: some View {
        Image(systemName: symbol).font(.system(size: 14, weight: .semibold)).foregroundStyle(tint)
            .frame(width: 38, height: 38).background(tint.opacity(0.1), in: RoundedRectangle(cornerRadius: 11))
    }
}

private struct SettingsToggleRow: View {
    let title: String, detail: String, symbol: String
    @Binding var isOn: Bool
    var body: some View {
        HStack(spacing: 14) {
            SettingsIcon(symbol: symbol)
            VStack(alignment: .leading, spacing: 4) {
                Text(title).font(.system(size: 14, weight: .medium)); Text(detail).font(.system(size: 11)).foregroundStyle(LilacTheme.muted)
            }
            Spacer(); Toggle("", isOn: $isOn).labelsHidden().toggleStyle(.switch)
        }
        .frame(minHeight: 64)
    }
}

struct MixArtwork: View {
    let mix: FocusMix
    var body: some View {
        AsyncImage(url: mix.thumbnailURL) { phase in
            switch phase {
            case .success(let image): image.resizable().scaledToFill()
            default:
                ZStack { mix.tint.opacity(0.18); Image(systemName: mix.symbol).font(.system(size: 28, weight: .light)).foregroundStyle(mix.tint) }
            }
        }
        .clipped()
    }
}
