# Lilac Desktop / Focus 제품 리서치

조사일: 2026-08-24

## 결론

Lilac Desktop의 진입점은 "데스크톱에서도 들을 수 있다"가 아니다. 이미 Spotify와 Apple Music은 데스크톱 앱을 제공하고 YouTube는 브라우저에서 충분히 재생된다. 더 구체적인 미충족 수요는 다음과 같다.

> 업무를 시작할 때 음악을 고르는 과정, 창을 관리하는 과정, 알림·회의 때 볼륨을 조절하는 과정을 없앤다.

따라서 제품은 큰 창을 매번 여는 전통적인 DSP가 아니라 다음 세 층으로 설계한다.

1. **메뉴바 상주층** — 한 번의 클릭으로 재생, 집중 타이머, 볼륨 완화
2. **Focus Desk** — 업무 종류와 시간에 맞는 YouTube 기반 세션, AI 큐레이션
3. **Lilac 본체** — J-POP/K-POP 탐색, 팬덤, 커머스, 일정, 향후 정식 음원 스트리밍

## 경쟁 제품에서 가져올 패턴

| 제품 | 검증된 데스크톱 패턴 | Lilac에 반영 |
|---|---|---|
| Spotify | 왼쪽 보관함, 가운데 탐색, 오른쪽 Now Playing. 보관함 접기·검색·필터·크기 조절·드래그앤드롭 | 기존 Lilac Play 모드 유지. Focus에서는 선택보다 시작을 앞세움 |
| Apple Music | 작은 MiniPlayer, 재생·볼륨·가사·대기열, 항상 위에 표시 | 메뉴바 팝오버 + 작은 컨트롤. 전체 창 없이 핵심 동작 수행 |
| YouTube | IFrame API로 재생목록·재생·일시정지·볼륨 제어 가능 | 영상은 공식 임베드로 표시하고, Lilac은 세션과 볼륨 정책만 제어 |
| Netflix | Windows 앱은 있으나 Mac은 브라우저 시청 | 네이티브 앱 자체가 가치가 아니라 OS 통합이 가치라는 반례 |
| 라프텔 | PC 앱 없이 Chrome/Safari 웹 스트리밍 | 팬덤 포털은 웹으로 유지하고, Mac 앱은 업무 편의 기능에 집중 |

## 사람들이 업무용 컴퓨터에서 전용 음악 앱을 덜 여는 이유

현재 자료와 제품 동작을 종합한 가설이다. 출시 전 8~12명 인터뷰와 사용 로그로 검증해야 한다.

1. **휴대폰이 이미 기본 리모컨이다.** 스마트폰은 항상 로그인되어 있고 이어폰과 연결돼 있다. 새 데스크톱 앱 설치와 재로그인은 추가 비용이다.
2. **업무 화면에서 앱 하나가 더 늘어난다.** 음악은 배경 행동인데 전통적인 플레이어는 독립 창과 탐색을 요구한다.
3. **선택 피로가 시작을 막는다.** 업무 중에는 새로운 곡 탐색보다 즉시 재생되는 익숙한 긴 믹스가 유리하다.
4. **알림·통화와 오디오가 충돌한다.** Slack, 화상 회의, IDE 알림이 음악과 겹치면 사용자가 수동으로 볼륨을 줄인다.
5. **웹이면 충분한 경우가 많다.** Netflix와 라프텔처럼 데스크톱을 브라우저로만 지원해도 콘텐츠 소비는 성립한다.
6. **회사 기기의 제약이 있다.** 설치 권한, DRM 설정, 사내 네트워크 제한이 전용 앱·웹 플레이어 모두에 마찰을 만든다.

스마트폰 중심성은 오래된 일시적 현상만은 아니다. 2025년 아일랜드 음악 이용 조사에서도 음악 팬이 쓰는 기기는 휴대폰 스피커 39%, 랩톱/데스크톱 21%로 차이가 있었다. 과거 다중 기기 조사에서도 응답자의 4분의 3이 하루에 여러 기기로 들었지만 기기 간 호환에 매우 만족한 비율은 27%에 그쳤다. 정확한 한국 J-POP 타깃 수치는 별도 자체 조사가 필요하다.

## Lilac Desktop 핵심 기능

### 지금 구현하는 MVP

- macOS 메뉴바 상주
- 로그인 시 자동 실행 설정
- 메뉴바에서 재생/정지, 25분·45분 집중 세션 시작
- 업무 앱 전환 시 부드러운 볼륨 완화 프리뷰
- 전체 Lilac 웹을 담는 네이티브 WebKit 창
- Focus Desk: YouTube 공식 임베드, 집중 타이머, 업무 유형별 추천
- AI Focus Curator: 업무·에너지·시간을 받아 검증된 믹스 중 하나와 세션 구성을 선택

### OS 제약 때문에 단계적으로 구현할 기능

- **다른 앱의 알림 감지:** macOS 공개 API는 제3자 앱의 모든 알림을 직접 읽는 일반 인터페이스를 제공하지 않는다. MVP는 전면 앱 전환과 회의 앱 활성화를 신호로 사용한다. 정밀 감지는 사용자 동의를 받는 접근성 권한 또는 Slack/Calendar 등 공식 연동으로 분리한다.
- **회의 전체 구간 감지:** MVP는 Zoom/Teams/Meet 계열 앱 활성 시 완화한다. 후속 버전은 캘린더 일정, 마이크 사용 상태, 회의 앱 상태를 결합한다.
- **Windows:** Focus Desk 웹을 먼저 공통 기반으로 사용한다. macOS 검증 후 Tauri 또는 WinUI 셸에서 트레이·자동 실행·미디어 키를 구현한다.

## AI 원칙

- GPT-5.4는 곡 URL을 지어내지 않는다. 서버가 제공한 검증된 후보 ID 중 하나만 고른다.
- API 키는 Letsur 가이드대로 서버 환경변수 `LETSUR_API_KEY`에만 둔다.
- 키가 없거나 호출이 실패해도 로컬 규칙 기반 추천으로 동작한다.
- 개인의 Slack 메시지나 코드 내용은 보내지 않는다. 업무 설명은 사용자가 Focus Desk에 직접 입력한 텍스트만 사용한다.

## 출처

- Spotify, Desktop Experience redesign: https://newsroom.spotify.com/2023-06-20/spotify-desktop-experience-redesign-your-library-now-playing-views-customize/
- Spotify, supported desktop and web devices: https://support.spotify.com/gm/article/supported-devices-for-spotify/
- Apple, Music MiniPlayer on Mac: https://support.apple.com/en-ie/guide/music/mus71d7dcfce/mac
- Netflix, Mac은 브라우저 시청: https://help.netflix.com/en/node/12983
- 라프텔, PC 앱 미제공: https://help.laftel.net/hc/ko/articles/6011133241231
- YouTube IFrame API: https://developers.google.com/youtube/iframe_api_reference
- Letsur AI Gateway 첫 호출: https://docs.platform.letsur.ai/ai-gateway/getting-started
- Letsur 인증 및 키 보관: https://docs.platform.letsur.ai/ai-gateway/api-reference/authentication
- Ireland Music Report 2025: https://imro.ie/wp-content/uploads/2025/07/Ireland-Music-Report-June-2025-1_compressed.pdf
- Qualcomm multi-device audio survey: https://www.qualcomm.com/news/onq/2016/10/state-play-2016-audio-consumer-insights-report
