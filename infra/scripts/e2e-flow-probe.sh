#!/bin/bash
# 전체 흐름(환자 여정) 종단 검증 — **읽기 전용** 프로브
#
# 사용법:  HIS_TOKEN=<직원 JWT> ./infra/scripts/e2e-flow-probe.sh
# 계획·판정 기준: docs/01-plan/e2e-flow-review-2026-07.plan.md
#
# 주의: 앵커 ID 는 운영 실데이터 기준이라 환경이 바뀌면 갱신해야 한다.
#       404 가 나오면 **먼저 프로브 경로를 의심할 것**(계획서 §7.3 참조).
BASE=${HIS_BASE:-https://his.example.org}
T=${HIS_TOKEN:?HIS_TOKEN 환경변수에 직원 JWT 를 넣어 실행하세요}
PAT=2c33eb7c-0117-484a-a72c-60b65bcee73b
ENC=43020b51-cf07-45dd-8dd8-4e6b1d2f6dc8
RX=84e77ec8-96a4-4bef-a752-9e21a8612acd
ORD=6626915e-46bd-478f-bffd-b76046d661b7
BILL=91694e1d-b5d7-4e9a-9b99-9267efea2e2a
ADM=90a75ed3-0382-4c57-84c9-d60b56bd19c0
LAB=d521bb55-caba-4880-b361-188be6c5a9dd
CKV=897d7d03-72a7-4fee-bd03-b88bef968a88
APT=487b06d8-6723-40ef-b120-15153d2ea505
TODAY=$(date +%F)

probe() { # $1=flow $2=label $3=path
  code=$(curl -s -o /tmp/e2e_body -w "%{http_code}" "$BASE$3" -H "Authorization: Bearer $T")
  size=$(wc -c < /tmp/e2e_body | tr -d ' ')
  # 데이터 유무 힌트(배열 길이 or total)
  hint=$(node -e "
    let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{
      try{const j=JSON.parse(s);const d=j.data??j;
        if(Array.isArray(d))console.log('n='+d.length);
        else if(d&&Array.isArray(d.items))console.log('n='+d.items.length);
        else if(d&&typeof d.total!=='undefined')console.log('total='+d.total);
        else if(j.pagination)console.log('total='+j.pagination.total);
        else if(d&&d.id)console.log('id');
        else console.log('obj');
      }catch(e){console.log('-')}})" < /tmp/e2e_body 2>/dev/null)
  printf '%-4s %-34s %-3s %-9s %s\n' "$1" "$2" "$code" "$hint" "$3"
}

echo "=== F1 외래 진료 ==="
probe F1 "환자 검색" "/api/v1/patients?limit=5"
probe F1 "환자 상세" "/api/v1/patients/$PAT"
probe F1 "예약 목록" "/api/v1/appointments?limit=5"
probe F1 "예약 가용슬롯" "/api/v1/appointments/availability?date=$TODAY"
probe F1 "진료실 대기열" "/api/v1/queue?date=$TODAY"
probe F1 "진료 상세" "/api/v1/encounters/$ENC"
probe F1 "처방(환자)" "/api/v1/prescriptions/patient/$PAT"
probe F1 "오더 목록" "/api/v1/orders?limit=5"
probe F1 "예약 가용(인코딩)" "/api/v1/appointments/availability?date=$TODAY&departmentName=%EB%82%B4%EA%B3%BC"
probe F1 "DUR 점검" "/api/v1/billing/dur-check?patientId=$PAT"
probe F1 "약국 대기" "/api/v1/pharmacy/queue"
probe F1 "수납 대기" "/api/v1/billing/cashier-queue"
probe F1 "청구 상세" "/api/v1/billings/$BILL"
probe F1 "청구 산출" "/api/v1/billing/calculate/$ENC"
probe F1 "영수증" "/api/v1/billings/$BILL/receipt"

echo
echo "=== F2 검사 ==="
probe F2 "검사 큐" "/api/v1/lab/queue"
probe F2 "검사 결과(환자)" "/api/v1/lab/patients/$PAT/results"
probe F2 "위급값 대기" "/api/v1/lab/critical-values/pending"
probe F2 "워크스테이션 스테이션" "/api/v1/workstation/stations"

echo
echo "=== F3 영상 ==="
probe F3 "영상 큐" "/api/v1/imaging/queue"
probe F3 "영상 결과(환자)" "/api/v1/imaging/patients/$PAT/results"
probe F3 "판독 대기" "/api/v1/workstation/imaging/reading-queue"

echo
echo "=== F4 입원 ==="
probe F4 "재원 목록" "/api/v1/admissions/active/list"
probe F4 "입원 상세" "/api/v1/admissions/$ADM"
probe F4 "간호기록" "/api/v1/admissions/$ADM/nursing-notes"
probe F4 "투약 스케줄" "/api/v1/admissions/$ADM/medication-schedule"
probe F4 "퇴원요약 프리필" "/api/v1/admissions/$ADM/discharge-summary/prefill"
probe F4 "병상 보드" "/api/v1/bed-board"

echo
echo "=== F5 응급 ==="
probe F5 "응급 보드" "/api/v1/emergency/board"
probe F5 "NEDOCS" "/api/v1/emergency/nedocs"
probe F5 "사전통보" "/api/v1/emergency/prenotifications"

echo
echo "=== F6 검진 ==="
probe F6 "검진 방문" "/api/v1/checkup/visits?limit=5"
probe F6 "검진 결과" "/api/v1/checkup/visits/$CKV/results"
probe F6 "결과서 준비도" "/api/v1/checkup/visits/$CKV/result-readiness"
probe F6 "스테이션 보드" "/api/v1/checkup/ws/flow-board"

echo
echo "=== F8 횡단 ==="
probe F8 "여정 타임라인" "/api/v1/journey/$PAT/timeline"
probe F8 "감사 통계" "/api/v1/audit/stats"
probe F8 "안전게이트" "/api/v1/admin/safety-gates"
probe F8 "데이터품질 요약" "/api/v1/data-quality/summary"
probe F8 "알림" "/api/v1/notifications?limit=5"
