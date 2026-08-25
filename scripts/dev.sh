#!/bin/zsh
# Lilac 개발 서버 정리·기동 스크립트
#
# 왜 필요한가
#   개발 중 포트를 옮겨가며 띄운 백엔드/프론트 프로세스가 쌓이면
#   "어느 포트가 진짜인지" 알 수 없게 된다. 이 스크립트는
#   1) 남아 있는 Lilac 관련 프로세스를 전부 정리하고
#   2) 백엔드 4600, 프론트 5180 고정 포트로 다시 띄운다.
#
# 사용법: 프로젝트 루트에서  zsh scripts/dev.sh

set -e
cd "$(dirname "$0")/.."

BACKEND_PORT=4600
FRONT_PORT=5180

echo "── 1. 기존 프로세스 정리"
# Lilac 백엔드 (여러 포트에 흩어져 있을 수 있다)
pkill -f "node backend/server.mjs" 2>/dev/null && echo "   백엔드 정리됨" || echo "   실행 중인 백엔드 없음"
# vite 개발 서버
pkill -f "vite" 2>/dev/null && echo "   vite 정리됨" || echo "   실행 중인 vite 없음"
sleep 1.5

# 포트가 여전히 점유돼 있으면 강제 종료
for p in $BACKEND_PORT $FRONT_PORT; do
  PID=$(lsof -ti :$p 2>/dev/null | head -1)
  if [ -n "$PID" ]; then
    kill -9 "$PID" 2>/dev/null && echo "   포트 $p 강제 해제" || echo "   경고: 포트 $p 해제 실패 (pid $PID)"
    sleep 0.5
  fi
done

echo "── 2. 프록시 설정 확인"
# vite 프록시가 백엔드 포트를 바라보게 맞춘다
sed -i '' -E "s#target: 'http://localhost:[0-9]+'#target: 'http://localhost:${BACKEND_PORT}'#" frontend/vite.config.ts
grep -o "localhost:[0-9]*" frontend/vite.config.ts | head -1 | sed 's/^/   프록시 → /'

echo "── 3. 백엔드 기동 (포트 ${BACKEND_PORT})"
PORT=$BACKEND_PORT nohup node backend/server.mjs > /tmp/lilac-backend.log 2>&1 &
sleep 2.5
if curl -s --max-time 3 "http://localhost:${BACKEND_PORT}/api/health" > /dev/null; then
  echo "   백엔드 정상"
else
  echo "   백엔드 응답 없음 — /tmp/lilac-backend.log 확인"
  exit 1
fi

echo "── 4. 프론트 기동 (포트 ${FRONT_PORT})"
# 포트가 이미 점유돼 있으면(종료 권한이 없는 환경) 캐시를 지우면 안 된다 —
# 돌고 있는 vite의 의존성 번들이 깨져 동적 import가 실패한다.
if lsof -ti :$FRONT_PORT > /dev/null 2>&1; then
  EXISTING_MARKER=$(curl -s --max-time 3 "http://localhost:${FRONT_PORT}/src/main.ts" | grep -c "startViewTransition" || true)
  if [ "$EXISTING_MARKER" -ge 1 ]; then
    echo "   기존 vite가 최신 코드를 서빙 중 — 재기동 생략"
    echo ""
    echo "완료 → http://localhost:${FRONT_PORT}/"
    exit 0
  fi
  echo "   오류: 포트 ${FRONT_PORT}를 낡은 프로세스가 점유 중입니다. 본인 터미널에서 실행해 주세요."
  exit 1
fi
rm -rf frontend/node_modules/.vite
(npm --prefix frontend run dev -- --port $FRONT_PORT --strictPort --force > /tmp/lilac-vite.log 2>&1 &)
sleep 4

# 응답이 있어도 '낡은 좀비 vite'가 포트를 쥐고 있는 경우가 있다.
# 최신 코드 마커가 서빙되는지까지 확인해야 진짜 성공이다.
MARKER=$(curl -s --max-time 3 "http://localhost:${FRONT_PORT}/src/main.ts" | grep -c "startViewTransition" || true)
if [ "$MARKER" -ge 1 ]; then
  echo "   프론트 정상 (최신 코드 확인)"
elif curl -s --max-time 3 "http://localhost:${FRONT_PORT}/" > /dev/null; then
  echo "   경고: 포트 ${FRONT_PORT}에서 응답은 오지만 낡은 프로세스입니다."
  echo "   이 스크립트를 '본인 터미널'에서 실행해야 기존 프로세스를 정리할 수 있습니다."
  exit 1
else
  echo "   프론트 응답 없음 — /tmp/lilac-vite.log 확인"
  exit 1
fi

echo ""
echo "완료 → http://localhost:${FRONT_PORT}/"
