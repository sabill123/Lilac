import SwiftUI

struct MenuBarPanel: View {
    @ObservedObject var state: AppState
    @ObservedObject private var player: YouTubePlayerController
    @Environment(\.openWindow) private var openWindow

    init(state: AppState) {
        self.state = state
        self.player = state.player
    }

    var body: some View {
        ZStack {
            LilacTheme.canvas

            Circle()
                .fill(state.selectedMix.tint.opacity(0.20))
                .frame(width: 250, height: 250)
                .blur(radius: 82)
                .offset(x: 142, y: -210)

            VStack(alignment: .leading, spacing: 0) {
                header
                nowPlaying
                    .padding(.top, 14)
                transport
                    .padding(.top, 13)
                volume
                    .padding(.top, 12)

                if state.hasActiveSession {
                    sessionStatus
                        .padding(.top, 12)
                } else {
                    quickStart
                        .padding(.top, 12)
                }

                automationRows
                    .padding(.top, 12)

                footer
                    .padding(.top, 12)
            }
            .padding(18)
        }
        .frame(width: 354)
        .preferredColorScheme(.dark)
    }

    private var header: some View {
        HStack(spacing: 9) {
            ZStack {
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .fill(LilacTheme.accent.opacity(0.20))
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .stroke(LilacTheme.accent.opacity(0.44))
                Image(systemName: "waveform")
                    .font(.system(size: 11, weight: .bold))
                    .foregroundStyle(LilacTheme.accentBright)
            }
            .frame(width: 32, height: 32)

            Text("Lilac")
                .font(.system(size: 15, weight: .semibold))

            Spacer()

            Circle()
                .fill(state.isDucked ? Color.orange : (player.isReady ? Color.green : LilacTheme.faint))
                .frame(width: 7, height: 7)
        }
    }

    private var nowPlaying: some View {
        HStack(spacing: 12) {
            MixArtwork(mix: state.selectedMix)
                .frame(width: 68, height: 68)
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                .overlay {
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .stroke(Color.white.opacity(0.12))
                }

            VStack(alignment: .leading, spacing: 4) {
                Text(state.selectedMix.title)
                    .font(.system(size: 15, weight: .semibold))
                    .lineLimit(1)
                Text(state.selectedMix.creator)
                    .font(.system(size: 11))
                    .foregroundStyle(LilacTheme.muted)
                    .lineLimit(1)
            }

            Spacer(minLength: 2)
        }
        .padding(11)
        .background(LilacTheme.panelRaised.opacity(0.92), in: RoundedRectangle(cornerRadius: 15, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 15, style: .continuous)
                .stroke(LilacTheme.stroke)
        }
    }

    private var transport: some View {
        HStack(spacing: 28) {
            Button { state.previousMix() } label: {
                Image(systemName: "backward.end.fill")
            }
            .help("이전 믹스")

            Button { state.togglePlayback() } label: {
                ZStack {
                    Circle()
                        .fill(LilacTheme.accent)
                    Image(systemName: player.isPlaying ? "pause.fill" : "play.fill")
                        .font(.system(size: 14, weight: .black))
                        .foregroundStyle(Color(red: 0.13, green: 0.09, blue: 0.17))
                        .offset(x: player.isPlaying ? 0 : 1)
                }
                .frame(width: 42, height: 42)
            }
            .help(player.isPlaying ? "일시정지" : "재생")

            Button { state.nextMix() } label: {
                Image(systemName: "forward.end.fill")
            }
            .help("다음 믹스")
        }
        .buttonStyle(.plain)
        .font(.system(size: 11, weight: .semibold))
        .foregroundStyle(Color.white.opacity(0.72))
        .frame(maxWidth: .infinity)
    }

    private var volume: some View {
        HStack(spacing: 9) {
            Image(systemName: state.userVolume == 0 ? "speaker.slash.fill" : "speaker.wave.2.fill")
                .font(.system(size: 10))
                .foregroundStyle(LilacTheme.muted)
            Slider(value: $state.userVolume, in: 0...1)
                .tint(LilacTheme.accent)
            Text("\(player.actualVolume)%")
                .font(.system(size: 10, weight: .medium))
                .foregroundStyle(LilacTheme.muted)
                .frame(width: 32, alignment: .trailing)
        }
        .padding(.horizontal, 2)
    }

    private var sessionStatus: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 3) {
                    Text(state.taskTitle.isEmpty ? state.selectedPreset.title : state.taskTitle)
                        .font(.system(size: 12, weight: .semibold))
                        .lineLimit(1)
                    Text(state.isSessionRunning ? "작업 세션 진행 중" : "세션 일시정지")
                        .font(.system(size: 10))
                        .foregroundStyle(LilacTheme.muted)
                }
                Spacer()
                Text(state.timerText)
                    .font(.system(size: 22, weight: .bold, design: .monospaced))
                    .foregroundStyle(LilacTheme.accentBright)
            }

            ProgressView(value: state.sessionProgress)
                .tint(LilacTheme.accent)

            HStack(spacing: 7) {
                Button(state.isSessionRunning ? "일시정지" : "계속하기") {
                    state.toggleSession()
                }
                .buttonStyle(MenuAccentButtonStyle())

                Button("세션 종료") {
                    state.stopSession(markCompleted: false)
                }
                .buttonStyle(MenuQuietButtonStyle())
            }
        }
        .padding(12)
        .background(LilacTheme.accent.opacity(0.075), in: RoundedRectangle(cornerRadius: 13, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 13, style: .continuous)
                .stroke(LilacTheme.accent.opacity(0.23))
        }
    }

    private var quickStart: some View {
        VStack(alignment: .leading, spacing: 9) {
            Text("작업 시작")
                .font(.system(size: 11, weight: .medium))
                .foregroundStyle(LilacTheme.muted)

            HStack(spacing: 7) {
                ForEach(state.presets.prefix(3)) { preset in
                    Button("\(preset.focusMinutes)분") {
                        state.selectPreset(preset)
                        state.startSession()
                    }
                    .buttonStyle(MenuQuietButtonStyle())
                }
            }
        }
        .padding(11)
        .background(Color.white.opacity(0.032), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay { RoundedRectangle(cornerRadius: 12).stroke(LilacTheme.stroke) }
    }

    private var automationRows: some View {
        VStack(spacing: 0) {
            MenuToggleRow(
                title: "스마트 볼륨",
                symbol: "speaker.wave.2.bubble.left",
                isOn: $state.autoDucking
            )

            Rectangle()
                .fill(LilacTheme.stroke)
                .frame(height: 1)
                .padding(.leading, 36)

            MenuToggleRow(
                title: "로그인 시 실행",
                symbol: "power",
                isOn: Binding(
                    get: { state.launchAtLogin },
                    set: { state.setLaunchAtLogin($0) }
                )
            )
        }
        .padding(.horizontal, 11)
        .background(Color.white.opacity(0.028), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay { RoundedRectangle(cornerRadius: 12).stroke(LilacTheme.stroke) }
    }

    private var footer: some View {
        HStack(spacing: 8) {
            Button {
                openWindow(id: "main")
                state.bringMainWindowForward()
            } label: {
                Label("전체 앱 열기", systemImage: "macwindow")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(MenuAccentButtonStyle())

            Button { NSApp.terminate(nil) } label: {
                Image(systemName: "power")
                    .frame(width: 30)
            }
            .buttonStyle(MenuQuietButtonStyle())
            .help("Lilac 종료")
        }
    }
}

private struct MenuToggleRow: View {
    let title: String
    let symbol: String
    @Binding var isOn: Bool

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: symbol)
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(LilacTheme.accentBright)
                .frame(width: 25)

            Text(title)
                .font(.system(size: 11, weight: .medium))

            Spacer()

            Toggle("", isOn: $isOn)
                .labelsHidden()
                .toggleStyle(.switch)
                .controlSize(.mini)
                .tint(LilacTheme.accent)
        }
        .padding(.vertical, 9)
    }
}

private struct MenuAccentButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 11, weight: .bold))
            .foregroundStyle(Color(red: 0.15, green: 0.10, blue: 0.19))
            .padding(.horizontal, 11)
            .frame(height: 32)
            .background(LilacTheme.accent, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
            .opacity(configuration.isPressed ? 0.72 : 1)
    }
}

private struct MenuQuietButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 11, weight: .semibold))
            .foregroundStyle(Color.white.opacity(0.76))
            .padding(.horizontal, 10)
            .frame(maxWidth: .infinity)
            .frame(height: 32)
            .background(Color.white.opacity(configuration.isPressed ? 0.10 : 0.052), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
            .overlay { RoundedRectangle(cornerRadius: 8).stroke(LilacTheme.stroke) }
    }
}
