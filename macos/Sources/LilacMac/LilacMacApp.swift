import AppKit
import SwiftUI

@main
struct LilacMacApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @StateObject private var state = AppState()

    var body: some Scene {
        WindowGroup("Lilac", id: "main") {
            MainWindowView(state: state)
                .frame(minWidth: 1100, minHeight: 700)
        }
        .defaultSize(width: 1280, height: 820)
        .commands {
            CommandGroup(replacing: .appTermination) {
                Button("Lilac 종료") { state.quitApp() }
                    .keyboardShortcut("q")
            }

            CommandMenu("워크") {
                Button(state.isSessionRunning ? "세션 일시정지" : "작업 세션 시작") {
                    state.toggleSession()
                }
                .keyboardShortcut(.return, modifiers: [.command, .shift])

                Button("세션 종료") { state.stopSession(markCompleted: false) }
                    .keyboardShortcut(".", modifiers: [.command, .shift])
                    .disabled(!state.hasActiveSession)
            }

            CommandMenu("재생") {
                Button(state.player.isPlaying ? "일시정지" : "재생") {
                    state.togglePlayback()
                }
                .keyboardShortcut(.space, modifiers: [.command, .shift])

                Button("이전 믹스") { state.previousMix() }
                    .keyboardShortcut(.leftArrow, modifiers: [.command, .shift])
                Button("다음 믹스") { state.nextMix() }
                    .keyboardShortcut(.rightArrow, modifiers: [.command, .shift])
            }
        }

        MenuBarExtra("Lilac", systemImage: state.isDucked ? "speaker.wave.1.fill" : "waveform") {
            MenuBarPanel(state: state)
        }
        .menuBarExtraStyle(.window)
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate {
    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.regular)
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        false
    }
}
