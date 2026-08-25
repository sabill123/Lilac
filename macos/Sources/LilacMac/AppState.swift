import AppKit
import Foundation
import ServiceManagement

@MainActor
final class AppState: ObservableObject {
    @Published var selectedSection: AppSection? = .focus
    @Published private(set) var selectedPreset = FocusPreset.defaults[1]
    @Published private(set) var selectedMix = FocusMix.defaults[0]
    @Published var selectedMode: FocusMode = .balanced
    @Published var taskTitle = ""
    @Published private(set) var curatedSummary: String?
    @Published private(set) var remainingSeconds = FocusPreset.defaults[1].focusMinutes * 60
    @Published private(set) var isSessionRunning = false
    @Published private(set) var sessionStarted = false
    @Published private(set) var isDucked = false
    @Published private(set) var duckReason: String?
    @Published private(set) var history: [FocusSessionRecord] = []
    @Published var autoDucking: Bool {
        didSet { UserDefaults.standard.set(autoDucking, forKey: "lilac.autoDucking") }
    }
    @Published var launchAtLogin = SMAppService.mainApp.status == .enabled
    @Published var userVolume: Double {
        didSet {
            let clamped = min(max(userVolume, 0), 1)
            UserDefaults.standard.set(clamped, forKey: "lilac.volume")
            if !isDucked { player.setVolume(percent: Int(clamped * 100)) }
        }
    }

    let mixes = FocusMix.defaults
    let presets = FocusPreset.defaults
    let player: YouTubePlayerController

    private var timerTask: Task<Void, Never>?
    private var restoreTask: Task<Void, Never>?
    private var workspaceToken: NSObjectProtocol?

    private let meetingBundles: Set<String> = [
        "us.zoom.xos", "com.microsoft.teams", "com.microsoft.teams2",
        "com.cisco.webexmeetingsapp", "com.webex.meetingmanager"
    ]
    private let attentionBundles: Set<String> = [
        "com.tinyspeck.slackmacgap", "com.openai.codex", "com.anthropic.claudefordesktop",
        "com.microsoft.VSCode", "com.microsoft.VSCodeInsiders"
    ]

    init() {
        let savedVolume = UserDefaults.standard.object(forKey: "lilac.volume") as? Double ?? 0.72
        userVolume = min(max(savedVolume, 0), 1)
        autoDucking = UserDefaults.standard.object(forKey: "lilac.autoDucking") as? Bool ?? true
        player = YouTubePlayerController(initialVideoID: FocusMix.defaults[0].youtubeVideoID)
        player.setVolume(percent: Int(userVolume * 100))
        loadHistory()

        workspaceToken = NSWorkspace.shared.notificationCenter.addObserver(
            forName: NSWorkspace.didActivateApplicationNotification,
            object: nil,
            queue: .main
        ) { [weak self] notification in
            Task { @MainActor in self?.applicationActivated(notification) }
        }
    }

    deinit {
        timerTask?.cancel()
        restoreTask?.cancel()
        if let workspaceToken {
            NSWorkspace.shared.notificationCenter.removeObserver(workspaceToken)
        }
    }

    var hasActiveSession: Bool { sessionStarted }

    var timerText: String {
        String(format: "%02d:%02d", remainingSeconds / 60, remainingSeconds % 60)
    }

    var sessionProgress: Double {
        let total = Double(selectedPreset.focusMinutes * 60)
        guard total > 0 else { return 0 }
        return min(max(1 - Double(remainingSeconds) / total, 0), 1)
    }

    var statusText: String {
        if let duckReason { return duckReason }
        if isSessionRunning { return "\(selectedPreset.title) 진행 중" }
        if sessionStarted { return "집중 일시정지" }
        return player.statusText
    }

    func selectPreset(_ preset: FocusPreset) {
        guard !sessionStarted else { return }
        selectedPreset = preset
        remainingSeconds = preset.focusMinutes * 60
        curatedSummary = nil
    }

    func selectMix(_ mix: FocusMix, autoplay: Bool? = nil) {
        let shouldPlay = autoplay ?? player.isPlaying
        selectedMix = mix
        player.load(videoID: mix.youtubeVideoID, autoplay: shouldPlay)
    }

    func recommendMixForTask() {
        let task = taskTitle.lowercased()
        if selectedMode == .energy {
            selectMix(mixes[1], autoplay: player.isPlaying)
        } else if task.contains("코드") || task.contains("개발") || task.contains("디자인") || task.contains("집중") {
            selectMix(mixes[2], autoplay: player.isPlaying)
        } else if task.contains("기획") || task.contains("아이디어") || task.contains("글") {
            selectMix(mixes[1], autoplay: player.isPlaying)
        } else {
            selectMix(mixes[0], autoplay: player.isPlaying)
        }
    }

    func composeSession() {
        recommendMixForTask()
        let task = taskTitle.trimmingCharacters(in: .whitespacesAndNewlines)
        let subject = task.isEmpty ? "한 가지 업무" : task
        curatedSummary = "\(subject) · \(selectedPreset.focusMinutes)분 · \(selectedMode.title)"
    }

    func toggleSession() {
        isSessionRunning ? pauseSession() : startSession()
    }

    func startSession() {
        if !sessionStarted {
            sessionStarted = true
            remainingSeconds = selectedPreset.focusMinutes * 60
        }
        isSessionRunning = true
        player.play()
        runTimer()
    }

    func pauseSession() {
        isSessionRunning = false
        timerTask?.cancel()
        timerTask = nil
        player.pause()
    }

    func stopSession(markCompleted: Bool) {
        timerTask?.cancel()
        timerTask = nil
        if markCompleted { addHistoryRecord() }
        isSessionRunning = false
        sessionStarted = false
        remainingSeconds = selectedPreset.focusMinutes * 60
        player.pause()
    }

    func togglePlayback() {
        player.toggle()
    }

    func previousMix() {
        guard let index = mixes.firstIndex(of: selectedMix) else { return }
        let target = mixes[(index - 1 + mixes.count) % mixes.count]
        selectMix(target, autoplay: player.isPlaying)
    }

    func nextMix() {
        guard let index = mixes.firstIndex(of: selectedMix) else { return }
        selectMix(mixes[(index + 1) % mixes.count], autoplay: player.isPlaying)
    }

    func setLaunchAtLogin(_ enabled: Bool) {
        do {
            if enabled { try SMAppService.mainApp.register() }
            else { try SMAppService.mainApp.unregister() }
            launchAtLogin = enabled
        } catch {
            launchAtLogin = SMAppService.mainApp.status == .enabled
        }
    }

    func simulateNotification() {
        duck(to: 18, reason: "알림 소리 보호", restoreAfter: 2.4)
    }

    func bringMainWindowForward() {
        NSApp.activate(ignoringOtherApps: true)
        mainWindow?.makeKeyAndOrderFront(nil)
    }

    func closeMainWindow() {
        mainWindow?.performClose(nil)
    }

    func quitApp() {
        NSApp.terminate(nil)
    }

    private var mainWindow: NSWindow? {
        NSApp.windows.first(where: { $0.canBecomeMain && $0.title == "Lilac" })
            ?? NSApp.windows.first(where: { $0.canBecomeMain })
    }

    private func runTimer() {
        timerTask?.cancel()
        timerTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(1))
                guard !Task.isCancelled, let self else { return }
                if self.remainingSeconds > 0 {
                    self.remainingSeconds -= 1
                }
                if self.remainingSeconds == 0 {
                    self.completeSession()
                    return
                }
            }
        }
    }

    private func completeSession() {
        timerTask?.cancel()
        timerTask = nil
        addHistoryRecord()
        isSessionRunning = false
        sessionStarted = false
        player.pause()
    }

    private func addHistoryRecord() {
        history.insert(
            FocusSessionRecord(
                id: UUID(),
                task: taskTitle.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "이름 없는 집중" : taskTitle,
                minutes: selectedPreset.focusMinutes,
                completedAt: Date(),
                mixTitle: selectedMix.title
            ),
            at: 0
        )
        history = Array(history.prefix(100))
        if let data = try? JSONEncoder().encode(history) {
            UserDefaults.standard.set(data, forKey: "lilac.history")
        }
    }

    private func loadHistory() {
        guard let data = UserDefaults.standard.data(forKey: "lilac.history"),
              let records = try? JSONDecoder().decode([FocusSessionRecord].self, from: data) else { return }
        history = records
    }

    private func applicationActivated(_ notification: Notification) {
        guard autoDucking,
              let app = notification.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication,
              let bundle = app.bundleIdentifier,
              bundle != Bundle.main.bundleIdentifier else { return }

        if meetingBundles.contains(bundle) {
            restoreTask?.cancel()
            duck(to: 16, reason: "회의 앱 사용 중")
        } else if attentionBundles.contains(bundle) {
            duck(to: 26, reason: "업무 알림 소리 보호", restoreAfter: 1.8)
        } else if isDucked {
            restoreVolume()
        }
    }

    private func duck(to percent: Int, reason: String, restoreAfter seconds: Double? = nil) {
        restoreTask?.cancel()
        isDucked = true
        duckReason = reason
        player.setVolume(percent: min(percent, Int(userVolume * 100)))
        guard let seconds else { return }
        restoreTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(seconds))
            guard !Task.isCancelled else { return }
            self?.restoreVolume()
        }
    }

    private func restoreVolume() {
        restoreTask?.cancel()
        restoreTask = nil
        isDucked = false
        duckReason = nil
        player.setVolume(percent: Int(userVolume * 100))
    }
}
