# Lilac 화면 재설계

## 범위

홈, 공통 헤더·푸터·모바일 탭, 공연 탐색·상세, 팬클럽·가입 조건,
커뮤니티, 소식, 앨범·굿즈, 차트, 아티스트, 검색, 로그인·도움말의 표현 체계.
회원 정책, 결제, 수집기, 원천 데이터, 가격 계산은 변경하지 않는다.
기존 로컬 main의 미배포 개인정보·회원 작업과는 별도 브랜치다.

## 사용한 공개 도구와 근거

- JCodesMore/ai-website-cloner-template의 MIT `clone-website` 지침:
  관찰 → 파일 소유 분리 → 구현 → 같은 화면 크기에서 비교 → 실제 조작 검수.
  프레임워크 전체를 갈아엎거나 다른 사이트의 파일을 재배포하지 않았다.
- Paidax01/web-to-design-md의 스타일 추출 프로브를 임시 검수 폴더에서 사용해
  실제 DOM의 글꼴·크기·색·반경을 조사했다. 원본 추출물은 제품에 포함하지 않는다.
- braxtonROSE4/clone-any-website의 애니메이션 조사 방법을 참고해
  실제 전환 속성을 조사했다. 별도 브라우저 런타임과 설치 스크립트는 실행하지 않았다.
  이 패키지를 설치하거나 전체 워크플로를 그대로 실행했다고 주장하지 않는다.
- 2026-10-25에 실제 웹 화면에서 조사한 참고 사이트:
  Apple Music `https://music.apple.com/kr/new`,
  NOL `https://nol.yanolja.com/ticket/genre/concert`.
  참고 사이트를 복제하는 작업이 아니므로 일치율 점수를 부여하지 않는다.

실측 예: NOL 섹션 제목 24px/700/29px, 포스터 외곽 반경12px,
전환200ms/cubic-bezier(.33,1,.68,1). Apple Music 제목34px/700,
음반 제목17px/22px, 보조 글자13px. 관찰 수치를 Lilac 목적에 맞게 조정했다.
타사의 브랜드, 사진, 코드, 상업 글꼴은 추가하지 않는다.

## 디자인 체계

- 사진·포스터가 색을 만든다. 공통 UI는 흰색·연한 중립색과 검정 타이포.
- 라일락 색은 현재 위치, 선택, 작은 아이콘과 상태 표현에 한정한다.
- 전역 제목32–42px, 섹션24–26px, 주 본문15–17px, 부가정보12–14px.
- 글꼴은 기존 직접 호스팅 OFL Host Grotesk·Geist Mono와 기존 한국어/일본어 폴백.
- 일반 이미지12px, 큰 구분면16–18px. 모든 요소를 알약 모양으로 만들지 않는다.
- 1440px 화면에서 한 줄 헤더, 작은 데스크톱에서는 2단, 모바일에서는
  60px 헤더+44px 가로 메뉴+하단 탭. 펼쳐진 메뉴·플레이어·고정 CTA는 유지한다.
- 본문 최대1328px, 좌우 여백40px. 모바일20px, 360px 이하16px.
- 홈은 어두운 곡면 포스터 갤러리를 유지하고, 그 아래 실제 경로4개를 빠른 탐색으로 제공한다.
- 일반 목록에는 입장 시 흐림·긴 등장·카드 기울임을 적용하지 않는다.
- 그라데이션 텍스트, 발광 배경, 이모지, 강제 스크롤은 추가하지 않는다.

## 상호작용

- 홈 3D는 초점0에서 바로 시작한다. 긴 등장 회전·색 번짐·바닥 반사를 제거한다.
- 원본 sRGB를 보존하며 중심 포스터를 강조한다. 이동은 약0.5초의 감쇠로 정착한다.
- 가로 방향이 확인된 터치만 드래그로 처리하고 세로 페이지 스크롤은 유지한다.
- 포인터 취소·캡처 유실은 상세 열기가 아니다.
- 정지·모션 줄이기에서도 수동 이전/다음·탭 선택은 즉시 반영한다.
- 자동 넘김은 키보드 포커스·호버·숨김 탭·화면 밖에서 보류한다.
- 명시적 일시정지, 좌우키, Home/End, 한 개의 탭 정지점을 제공한다.
- WebGL 컨텍스트가 유실되면 실제 평면 대체 화면으로 전환한다.
- 앨범 커버플로와 아티스트 띠는 경로 이탈 시 관찰자·프레임·타이머를 정리한다.

## 파일 소유

- `frontend/src/app/redesign.css`: 공통 셸·홈·전역 모션 축소
- `frontend/src/app/product-redesign.css`: 홈 외 목록·상세·도움말
- `frontend/src/app/pages/home.ts`: 빠른 탐색·무대 컨트롤·대체 화면
- `frontend/src/app/pages/misc.ts`: 빈 검색에도 제목 제공
- `frontend/src/three/stage3d.ts`: 그림·포인터 입력·수명주기
- `frontend/src/app/fx.ts`: 기존 커버플로·아티스트 띠의 입력·정리

## 재현 가능한 검증

```sh
npm run build
node tests/verify-v6-app.mjs
node tests/verify-stage-redesign.mjs
node tests/verify-flow-redesign.mjs
node frontend/src/three/verify-three.mjs
node tests/verify-player-ux.mjs
node tests/verify-store-ux.mjs
node tests/verify-home-awards.mjs
node tests/verify-community.mjs
node tests/verify-detail.mjs
node tests/verify-text.mjs
```

테스트는 운영 비밀키를 상속하지 않는 깨끗한 환경에서 실행한다.
DOM/GPU 대체 테스트는 실제 GPU 출력의 독립 증거가 아니다.
별도 브라우저에서320/390/1440px, 한국어/일본어, 주요 상세·오류·빈 화면을 검수한다.
수집·예매·회원가입·게시물 작성·구매는 화면 검수에서 실행하지 않는다.
