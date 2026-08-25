#!/usr/bin/env bash
# macOS 앱을 SwiftPM 없이 검증한다.
#
# 왜 필요한가: `swift build` 는 SwiftPM 이 자체 샌드박스를 켜는데,
# 샌드박스 안에서 돌리면 sandbox_apply 가 막혀 매니페스트 컴파일부터
# 실패한다(--disable-sandbox 로도 안 된다). 그러면 코드 오류가 없는데도
# 빌드가 깨진 것처럼 보인다.
#
# 이 패키지는 외부 의존성이 없는 단일 타깃이라 swiftc 로 직접 컴파일해도
# 결과가 같다. 전체 타입체크와 링크까지 확인한다.
#
# 사용: bash scripts/verify-macos.sh

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$ROOT/macos/Sources/LilacMac"
OUT="${TMPDIR:-/tmp}/LilacMac-verify"

if [ ! -d "$SRC" ]; then
  echo "소스를 찾지 못했습니다: $SRC" >&2
  exit 1
fi

SDK="$(xcrun --show-sdk-path --sdk macosx)"
# Package.swift 의 설정과 맞춘다 (swift-tools 6.2, 언어 모드 v5, macOS 13+)
TARGET="arm64-apple-macosx13.0"

echo "· SDK      $SDK"
echo "· 대상     $TARGET"
echo "· 소스     $(ls "$SRC"/*.swift | wc -l | tr -d ' ')개 파일"
echo

echo "[1/2] 전체 타입체크"
swiftc -typecheck -swift-version 5 -target "$TARGET" -sdk "$SDK" "$SRC"/*.swift
echo "     통과"

echo "[2/2] 컴파일 및 링크"
swiftc -swift-version 5 -target "$TARGET" -sdk "$SDK" -O "$SRC"/*.swift -o "$OUT"
echo "     $(file -b "$OUT")  $(du -h "$OUT" | cut -f1)"

rm -f "$OUT"
echo
echo "macOS 앱 검증 통과"
