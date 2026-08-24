import Foundation
import SwiftUI
import WebKit

@MainActor
private final class WeakScriptMessageHandler: NSObject, WKScriptMessageHandler {
    weak var delegate: WKScriptMessageHandler?

    init(delegate: WKScriptMessageHandler) {
        self.delegate = delegate
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        delegate?.userContentController(userContentController, didReceive: message)
    }
}

@MainActor
final class YouTubePlayerController: NSObject, ObservableObject, WKScriptMessageHandler, WKNavigationDelegate {
    @Published private(set) var isReady = false
    @Published private(set) var isPlaying = false
    @Published private(set) var actualVolume = 72
    @Published private(set) var statusText = "플레이어 연결 중"
    @Published private(set) var lastError: String?

    private let initialVideoID: String
    private var pendingVideoID: String?
    private var requestedVolume = 72
    private var shouldAutoplayWhenReady = false

    private(set) lazy var webView: WKWebView = makeWebView()

    init(initialVideoID: String) {
        self.initialVideoID = initialVideoID
        super.init()
        _ = webView
        loadPlayer()
    }

    func toggle() {
        isPlaying ? pause() : play()
    }

    func play() {
        shouldAutoplayWhenReady = true
        guard isReady else {
            statusText = "플레이어 준비 중"
            return
        }
        evaluate("window.lilacPlay()")
    }

    func pause() {
        shouldAutoplayWhenReady = false
        guard isReady else { return }
        evaluate("window.lilacPause()")
    }

    func load(videoID: String, autoplay: Bool) {
        pendingVideoID = videoID
        shouldAutoplayWhenReady = autoplay
        guard isReady else { return }
        let safeID = Self.javascriptString(videoID)
        evaluate("window.lilacLoad(\(safeID), \(autoplay ? "true" : "false"))")
        pendingVideoID = nil
        statusText = autoplay ? "새 믹스 재생 중" : "믹스 준비됨"
    }

    func setVolume(percent: Int) {
        let clamped = min(max(percent, 0), 100)
        requestedVolume = clamped
        guard isReady else {
            actualVolume = clamped
            return
        }
        evaluate("window.lilacSetVolume(\(clamped))") { [weak self] result in
            guard let self else { return }
            if let value = result as? NSNumber {
                self.actualVolume = value.intValue
                self.lastError = nil
            }
        }
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let payload = message.body as? [String: Any], let type = payload["type"] as? String else { return }

        switch type {
        case "ready":
            isReady = true
            lastError = nil
            statusText = "재생 준비됨"
            setVolume(percent: requestedVolume)
            if let pendingVideoID {
                load(videoID: pendingVideoID, autoplay: shouldAutoplayWhenReady)
            } else if shouldAutoplayWhenReady {
                play()
            }
        case "state":
            let value = (payload["value"] as? NSNumber)?.intValue ?? -1
            isPlaying = value == 1
            if value == 1 { statusText = "재생 중" }
            else if value == 2 { statusText = "일시정지" }
            else if value == 0 { statusText = "재생 완료" }
        case "volume":
            let value = (payload["value"] as? NSNumber)?.intValue ?? actualVolume
            actualVolume = value
            lastError = abs(value - requestedVolume) > 1 ? "볼륨 적용값을 확인해 주세요" : nil
        case "error":
            let code = (payload["value"] as? NSNumber)?.intValue ?? 0
            lastError = "YouTube 재생 오류 (\(code))"
            statusText = "재생할 수 없음"
            isPlaying = false
        default:
            break
        }
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        lastError = "네트워크 연결을 확인해 주세요"
        statusText = "연결 실패"
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        lastError = "네트워크 연결을 확인해 주세요"
        statusText = "연결 실패"
    }

    private func makeWebView() -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.allowsAirPlayForMediaPlayback = true
        configuration.mediaTypesRequiringUserActionForPlayback = []
        configuration.userContentController.add(WeakScriptMessageHandler(delegate: self), name: "lilacPlayer")

        let view = WKWebView(frame: .zero, configuration: configuration)
        view.navigationDelegate = self
        view.setValue(false, forKey: "drawsBackground")
        return view
    }

    private func loadPlayer() {
        let videoID = Self.javascriptString(initialVideoID)
        let html = """
        <!doctype html>
        <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width,initial-scale=1,user-scalable=no">
          <style>
            * { box-sizing: border-box; }
            html, body, #player { width: 100%; height: 100%; margin: 0; background: #111113; overflow: hidden; }
            iframe { width: 100%; height: 100%; border: 0; }
          </style>
        </head>
        <body>
          <div id="player"></div>
          <script src="https://www.youtube.com/iframe_api"></script>
          <script>
            let player;
            const post = (type, value) => window.webkit.messageHandlers.lilacPlayer.postMessage({ type, value });
            function onYouTubeIframeAPIReady() {
              player = new YT.Player('player', {
                videoId: \(videoID),
                width: '100%',
                height: '100%',
                playerVars: { playsinline: 1, controls: 1, rel: 0, modestbranding: 1 },
                events: {
                  onReady: event => {
                    event.target.setVolume(\(requestedVolume));
                    post('ready', true);
                    setTimeout(() => post('volume', event.target.getVolume()), 180);
                  },
                  onStateChange: event => post('state', event.data),
                  onError: event => post('error', event.data)
                }
              });
            }
            window.lilacPlay = () => { if (player?.playVideo) player.playVideo(); };
            window.lilacPause = () => { if (player?.pauseVideo) player.pauseVideo(); };
            window.lilacLoad = (videoId, autoplay) => {
              if (!player) return;
              if (autoplay) player.loadVideoById(videoId);
              else player.cueVideoById(videoId);
            };
            window.lilacSetVolume = value => {
              if (!player?.setVolume) return value;
              const target = Math.min(100, Math.max(0, Math.round(value)));
              player.setVolume(target);
              setTimeout(() => post('volume', player.getVolume()), 180);
              return target;
            };
          </script>
        </body>
        </html>
        """
        webView.loadHTMLString(html, baseURL: URL(string: "https://lilac.local"))
    }

    private func evaluate(_ script: String, completion: ((Any?) -> Void)? = nil) {
        webView.evaluateJavaScript(script) { [weak self] result, error in
            if error != nil {
                self?.lastError = "플레이어 제어에 실패했습니다"
                self?.statusText = "제어 실패"
            } else {
                completion?(result)
            }
        }
    }

    private static func javascriptString(_ value: String) -> String {
        let data = try? JSONEncoder().encode(value)
        return data.flatMap { String(data: $0, encoding: .utf8) } ?? "\"\""
    }
}

struct YouTubePlayerView: NSViewRepresentable {
    @ObservedObject var controller: YouTubePlayerController

    func makeNSView(context: Context) -> WKWebView {
        controller.webView
    }

    func updateNSView(_ nsView: WKWebView, context: Context) {}
}
