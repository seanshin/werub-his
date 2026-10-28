#!/usr/bin/env bash
# API 스모크 테스트 — 주요 페이지의 핵심 GET 엔드포인트가 200인지 확인.
# FE↔BE 라우트 불일치(예: 콜렉션 경로가 :id에 잡혀 uuid 검증 400)·500을 배포 후 빠르게 탐지.
# 사용: ./smoke-test.sh [API_BASE] [EMAIL] [PASSWORD]
set -u
API="${1:-http://localhost:4000}"
EMAIL="${2:-admin@hospital.example.org}"
PASS="${3:-staff1234!}"

TOKEN=$(curl -s -X POST "$API/api/v1/auth/login" -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\"}" \
  | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{console.log(JSON.parse(d).data.accessToken)}catch{console.log('')}})")
if [ -z "$TOKEN" ]; then echo "❌ 로그인 실패 ($API)"; exit 1; fi

# 각 모듈의 대표 콜렉션 GET (FE가 실제 호출하는 경로 기준)
ENDPOINTS=(
  "/api/v1/research"                 # IRB 연구목록
  "/api/v1/research/stats"
  "/api/v1/research/irb/reviews"
  "/api/v1/telehealth/sessions"
  "/api/v1/telehealth/stats"
  "/api/v1/safety/incidents"
  "/api/v1/infection-control"
  "/api/v1/hr/staff"
  "/api/v1/duty/schedule?month=2026-06"
  "/api/v1/pathways"
  "/api/v1/queue"
  "/api/v1/mdt/conferences"
  "/api/v1/cancer-registry"
)

FAIL=0
for ep in "${ENDPOINTS[@]}"; do
  code=$(curl -s -o /dev/null -w "%{http_code}" -m 15 "$API$ep" -H "Authorization: Bearer $TOKEN")
  if [ "$code" = "200" ]; then
    echo "  ✅ $code  $ep"
  else
    echo "  ❌ $code  $ep"
    FAIL=$((FAIL+1))
  fi
done

echo "─────────────────────────────"
if [ "$FAIL" -eq 0 ]; then echo "✅ 스모크 통과 (${#ENDPOINTS[@]}건)"; exit 0
else echo "❌ 실패 ${FAIL}/${#ENDPOINTS[@]}"; exit 1; fi
