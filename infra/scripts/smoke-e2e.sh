#!/usr/bin/env bash
# 배포 후 스모크 e2e — 핵심 여정 EP·게이트 config·역할별 인증을 비파괴로 검증 (2026-07 전체검토 F)
# 사용: ./infra/scripts/smoke-e2e.sh [BASE_URL]  (기본 https://his.example.org)
# 종료코드: 0=전부 통과, 1=실패 존재. 쓰기 작업 없음(로그인 제외) — 운영에서 상시 실행 가능.
set -u
BASE="${1:-https://his.example.org}"
PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  ✓ $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  ✗ $1"; }

login() { # $1=email
  curl -s -m 10 -X POST "$BASE/api/v1/auth/login" -H 'Content-Type: application/json' \
    -d "{\"email\":\"$1\",\"password\":\"staff1234!\"}" \
    | python3 -c "import sys,json;d=json.load(sys.stdin);print(d.get('data',d).get('accessToken') or d.get('data',d).get('token') or '')" 2>/dev/null
}

echo "== ① 역할별 인증 =="
declare -a TOKENS
i=0
for email in admin@hospital.example.org ck.doctor@hospital.example.org yoon.ganho@hospital.example.org lim.yaksa@hospital.example.org; do
  T=$(login "$email")
  if [ -n "$T" ]; then ok "login $email"; else bad "login $email"; fi
  TOKENS[$i]="$T"; i=$((i+1))
done
ADMIN="${TOKENS[0]}"; DOCTOR="${TOKENS[1]}"; NURSE="${TOKENS[2]}"; PHARM="${TOKENS[3]}"

get() { # $1=token $2=path $3=label
  CODE=$(curl -s -m 15 -o /dev/null -w '%{http_code}' "$BASE$2" -H "Authorization: Bearer $1")
  if [ "$CODE" = "200" ]; then ok "$3 ($2)"; else bad "$3 ($2) → HTTP $CODE"; fi
}

echo "== ② 핵심 여정 EP (외래→처방→조제→수납) =="
get "$ADMIN"  "/api/v1/patients?limit=1"                 "환자 조회"
get "$DOCTOR" "/api/v1/encounters?limit=1"               "진료(외래)"
get "$ADMIN"  "/api/v1/prescriptions/prescriber-rules"   "처방(규칙)"
get "$PHARM"  "/api/v1/pharmacy/queue"                   "조제 큐"
get "$PHARM"  "/api/v1/compounding/worklist"             "무균조제 워크리스트"
get "$ADMIN"  "/api/v1/billing/cashier-queue"            "수납 큐"
get "$ADMIN"  "/api/v1/claims?limit=1"                   "심사 청구"
get "$ADMIN"  "/api/v1/claims/adjustments/stats"         "삭감 통계 (R3-3)"

echo "== ③ 안전코어·로드맵 EP =="
get "$NURSE"  "/api/v1/blood-bank/transfusions?limit=1"  "수혈 목록 (R2-1)"
get "$DOCTOR" "/api/v1/chemo/regimens"                   "항암 레지멘 (R4)"
get "$DOCTOR" "/api/v1/chemo/courses"                    "항암 코스 (R4)"
get "$ADMIN"  "/api/v1/admin/him/deficiencies?overdue=true" "미비기록 HIM (R3-2)"
get "$ADMIN"  "/api/v1/orders?limit=1"                   "오더 게이트웨이"
get "$ADMIN"  "/api/v1/lab/queue"                        "검사실 큐(LIS)"
get "$NURSE"  "/api/v1/ess/approvals/inbox"              "HR 결재 수신함 (P0)"
get "$NURSE"  "/api/v1/ess/leave/balance"                "연차 잔여 (ESS)"

echo "== ④ 게이트 config 상태(데모 기대값) =="
gate() { # $1=key $2=expect(포함 문자열)
  V=$(curl -s -m 10 "$BASE/api/v1/config/$1" -H "Authorization: Bearer $ADMIN" \
    | python3 -c "import sys,json;d=json.load(sys.stdin);print(json.dumps(d.get('data',{}).get('value') if isinstance(d.get('data'),dict) else d.get('data')))" 2>/dev/null)
  if echo "$V" | grep -qi "$2"; then ok "config $1=$V"; else bad "config $1=$V (기대: $2)"; fi
}
gate "chemo.cycleGate" "BLOCK"
gate "nursing.bcma.enforce" "WARN"
gate "bloodBank.bedsideScan.enforce" "true\|WARN\|BLOCK"
gate "surgery.preAnesthesiaGate" "true"
gate "inpatient.dischargeGate" "true"
gate "ess.leaveApprovalMode" "INTERNAL"
gate "ess.leave.unified" "true"

echo "== ⑤ 프론트 페이지 =="
for path in /login /custom/guide; do
  CODE=$(curl -s -m 15 -o /dev/null -w '%{http_code}' "$BASE$path")
  if [ "$CODE" = "200" ]; then ok "page $path"; else bad "page $path → HTTP $CODE"; fi
done

echo "== ⑥ 공개 엣지 라우팅(터널→Caddy→API) =="
# 🔴 (2026-09-14) ①~⑤ 는 전부 /api/* 와 Next 페이지만 봐서, 09-09 서버 이전 때 Caddy 가 원본 nginx 의
#    `location = /health` 와 `/.well-known/` 규칙을 빠뜨린 것을 29 PASS 로 통과시켰다(두 경로가 Next 404 로 떨어짐).
#    본문까지 본다 — Next 의 404 HTML 도 상태코드만으론 구분이 안 되는 자리가 있다.
edge() { # $1=path $2=본문에 있어야 할 조각 $3=label
  BODY=$(curl -s -m 15 -w '\n%{http_code}' "$BASE$1")
  CODE=$(printf '%s' "$BODY" | tail -n1)
  if [ "$CODE" = "200" ] && printf '%s' "$BODY" | grep -q "$2"; then ok "$3 ($1)"; else bad "$3 ($1) → HTTP $CODE (API 가 아닌 곳으로 라우팅됐는지 확인: Caddyfile)"; fi
}
edge "/health" '"status":"ok"' "API 헬스(공개)"
edge "/.well-known/smart-configuration" 'authorization_endpoint' "SMART discovery(공개)"

echo ""
echo "결과: PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ]
