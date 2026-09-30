# 운영 배포

| 구성 | 위치 | 비고 |
|---|---|---|
| 프론트 | Vercel `lilac` (https://lilac-wheat.vercel.app) | GitHub `main` 푸시 시 자동 배포. `vercel.json`이 `/api/*`를 백엔드로 프록시 |
| 백엔드 | Render `lilac-api` (https://lilac-api-401k.onrender.com, 싱가포르, Free) | 상시 Node 서버: API, SSE, 수집기 |
| 사용자 데이터 | Neon Postgres `lilac` (싱가포르, Free 0.5GB) | `backend/lib/persist.mjs`가 `lilac_files` 테이블에 동기화 |
| 깨우기 | GitHub Actions `keepalive` | 10분마다 `/api/health` |
| 백엔드 배포 | GitHub Actions `deploy-backend` | `backend/**`·`db/**` 변경이 main에 오면 Render 배포 훅 호출(저장소 비밀값 `RENDER_DEPLOY_HOOK`) |

## 백엔드 환경변수 (Render)

- `NODE_ENV=production`, `NODE_VERSION=22`
- `LILAC_TRUST_PROXY=2` — Vercel → Render 두 홉 뒤의 실제 방문자 IP로 요청 제한
- `LILAC_ALLOWED_ORIGINS=https://lilac-wheat.vercel.app` — 도메인을 추가하면 여기에도 추가
- `LILAC_ADMIN_TOKEN` — 관리 API(`/api/admin/*`, `/api/live/admin/*`) 헤더 `X-Lilac-Admin-Token`
- `DATABASE_URL` — Neon 연결 문자열(pooler)

## 무료 플랜의 제약과 대응

- **디스크가 재시작·재배포마다 비워진다.** 공개 데이터(카탈로그·차트)는 저장소 `db/`, 실시간 캐시는 `backend/seed/live-cache`에서 시작하고 수집기가 갱신한다. 회원·세션·커뮤니티·좋아요는 Postgres에 10초 주기와 종료 신호 때 저장되고 부팅 때 복원된다. 크래시 때는 마지막 10초가 유실될 수 있다.
- **15분 동안 요청이 없으면 잠든다.** keepalive가 깨워 두지만 GitHub Actions 스케줄은 지연될 수 있어 드물게 첫 요청이 50초 이상 걸릴 수 있다.
- **CPU 0.1.** 수집 주기가 길어지고, 검색 색인 재생성(kuromoji)이 느리다.
- Vercel Hobby는 비상업 용도 조건이다. 유료화·결제를 붙이기 전에 Pro로 옮긴다.

## 아직 운영 전 해야 할 것

- 실제 결제·환불, 이메일 인증, 비밀번호 재설정은 구현되지 않았다(결제 API는 503으로 막혀 있음).
- 커스텀 도메인, 모니터링 알림, Postgres 백업 복구 연습, 이미지·음원 권리 검토.
