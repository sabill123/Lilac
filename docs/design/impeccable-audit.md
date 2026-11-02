# Impeccable 기반 전체 디자인 개선 검증

## 범위와 환경

이 문서는 redesign-v2 작업 폴더의 로컬 변경을 기록한다. 커밋·운영 배포·운영 데이터 변경은 하지 않았다. 이번 검증의 데이터는 별도 공개 데이터 DB이며 수집 백그라운드 작업은 꺼져 있다. 자동 수집 완성이나 정보 최신성을 디자인 검증으로 대신하지 않는다.

Impeccable 4.7.1 원문 스킬·polish·audit·operate·craft-floor를 사용했다. 도구 저장소는 https://github.com/pbakaus/impeccable 의 3671d50f0ac9a662ce0615e85a256110c9cd720b 이다. context 실행 파일은 시스템에서 종료되어 수동으로 기존 문맥을 읽었다. 결정적 검사는 공식 crates/live/assets/detect-antipatterns-browser.js의 브라우저/WASM 검사기를 실제 로컬 화면 안에서 실행했다. AI API 호출·프로젝트 실행 훅 설치는 하지 않았다. 검사기 자동 오버레이는 끄고 결과만 기록했으며 검사기를 제품 코드에 포함하지 않았다.

## 개선 전 → 후

- 모든 작업 화면에 큰 유동 제목·흩어진 스타일 → 홈의 큰 사진 표현은 보존하고 목록·상세·검색은 32/40px 제목과 일관된 버튼·필터로 정리.
- 흐린 출처·검색 안내, 9~10px 날짜/조건 → 대비 있는 보조 토큰, 기본12px 날짜·출처·상품사진 안내.
- 팬클럽 제목/조건 생략 → 여러 줄 제목·조건, 4:3 전체 회원 이미지, 읽을 수 있는 회비/확인 시각.
- 겹친 커뮤니티 카드 → 사진·본문·얇은 구분선 중심 피드와 절제된 옆칸.
- 긴 뉴스가 첫 화면 전체를 점유 → 8개씩 더보기, 실제 표시/전체 건수, 선택 상태와 필터 초기화.
- 문서·법무의 다른 글꼴/약한 위계 → 본문·목차·FAQ·독립 스크롤 표, 제목 순서와 공통 글꼴. 법무 사실 문구는 바꾸지 않고 운영자 정보 제목 단계만 수정.
- 숨긴 뒤 등장하는 제목·섹션과 최초0부터 숫자 굴리기 → 즉시 읽히는 실제 값, 짧은 상태 피드백. 홈의 프로필2초→동일 아티스트 앨범/공연2초는 유지.
- 관찰자/프레임이 이전 DOM에 남는 경로 → 공통 수명 정리·중복 설치 방지.
- 상세 탭/라디오의 불완전한 키보드 상태 → 방향키/처음/끝 이동, 단일 포커스 위치, 패널 연결, 숨은 요약바 inert.

## 실제 브라우저 검증

- 한국/일본 각각27개 화면 상태 × 320/390/768/1024/1440px = 270개 조합. 실제 iframe innerWidth와 문서/본문 scrollWidth를 측정했으며 가로 넘침 0건.
- 그중390/1440px 108개에 공식 Impeccable 브라우저 검사기 실행. 최종 반환 경고·안내 0건. 이는 정해진 입력/화면의 결과이지 전체 WCAG 인증이나 모든 비동기 상태·실기기 제스처 보증이 아니다.
- 대상: 홈, 공연 목록/상세, 팬클럽 목록/상세, 아티스트 목록/상세, 뉴스, 차트, 커뮤니티/전체 목록, 앨범/굿즈/음반2종, 가입도움, 검색/검색빈결과, 로그인/회원가입/MY 비로그인, 소개/가이드/FAQ/약관/개인정보/문의/상태.
- 실제 뉴스8→16개 더보기와 주제 필터의 aria-pressed를 확인. 공연 방향키로 다음 탭·패널·포커스가 함께 이동하고 숨은 요약바가 inert임을 확인. 별도 작업에서 팬클럽 거주지 선택에 따른 회비/결제정보 연동 확인.
- 검증 전용 서버의 iframe 허용 설정은 임시 설정 파일뿐이다. 실제5197 응답의 X-Frame-Options: DENY 유지.

## 코드 검사

다음18종 검사를 각각 실행해 통과했다. 프런트 TypeScript/빌드 및 git diff --check도 통과했다.

- node tests/verify-v6-app.mjs
- node tests/verify-home-cover.mjs
- node tests/verify-home-hub.mjs
- node tests/verify-fx-lifecycle.mjs
- node tests/verify-flow-redesign.mjs
- node tests/verify-news-ui.mjs
- node tests/verify-assistance-ui.mjs
- node tests/verify-assistance-routing.mjs
- node tests/verify-assistance.mjs
- node tests/verify-release-images.mjs
- node tests/verify-cover-media.mjs
- node tests/verify-official-portraits.mjs
- node tests/verify-portraits-routing.mjs
- node tests/verify-public-html.mjs
- node tests/verify-profile-handoff.mjs
- node tests/verify-detail.mjs
- node tests/verify-fanclub.mjs
- node tests/verify-site-contract.mjs

새 뉴스 검사는 실제 renderNews를 실행하고 API/DOM 경계만 대체한다. 초기8개·더보기·끝·필터 초기화·선택·일본어·실패·이전 응답 보류와3개 변이 검사를 통과했다. 새 fx 검사는 실제 함수12개와 수정 전 원본이 실패하는11개 대조를 포함한다. 홈 검사는38개/변이26개, 허브11개/변이11개를 유지했다. 폐기된3D홈을 강제하던 기존3개 계약은 현재 배너·실제 섹션 순서·검증된 동일 아티스트2초 전환 조건으로 교체했고 전체53개가 통과했다. 테스트를 생략하거나 제거해 녹색으로 만들지 않았다.

## 남은 한계

- Three 공유 청크 약552KB 빌드 경고는 남는다. 전체 성능·번들 문제가 해결됐다고 하지 않는다.
- 가입/로그인/주문/결제 실제 부작용, 물리 휴대전화 터치, 모든 브라우저/보조기술을 검증하지 않았다.
- 공개 원문 번역의 의미 정확성, 로그인 뒤 가입 조건, 사진 권리·발표일·전체 로스터 검증은 별도다.
- 공식 프로필 주기 수집/배너 자동 갱신 연결과 운영 배포는 이 디자인 작업의 완료에 포함되지 않는다.
