# 퇴원약 오더화 (2026-09-30)

> 요청: "퇴원약 오더화 진행해". 출발점: 의사 업무 점검(2026-09-30) 남은 항목 · 선행: 처방 중단 `order-discontinue.plan.md`·지속 처방 갱신 `order-renewal.plan.md`.

## 1. 실측 — 퇴원약은 처방이 아니었다
- 퇴원약은 퇴원요약의 자유 Json(`discharge_summaries.discharge_medications`)뿐이었다 — DUR·원내 처방집·사전승인·약국 조제 오더를 **하나도** 지나지 않았다.
- 프리필은 입원 이후 **활성 약 전부**(수액·주사 포함)를 "퇴원약"이라 불렀다.
- 퇴원 준비(`discharge-readiness`)는 요약 Json 이 "비어 있지 않다"로 `dischargeMedsPrepared` 를 켰다 — 처방·조제를 지나지 않은 글자도 "준비됨".
- 🔴 퇴원 워크스테이션은 프리필을 `string[]` 으로 믿고 `{med}` 로 그렸다 — 서버는 객체를 주므로 **퇴원약이 있으면 React 가 죽는다.** AI 퇴원요약 프롬프트엔 `.join(', ')` 이 `[object Object]` 를 넣었다(두 화면).
- 🔴 퇴원요약 보기에 퇴원약이 아예 없었다.
- 🔴 포털 복약 설명의 "본인 퇴원약" 확인은 `drugName`/`drug` 키를 찾는데 프리필은 `name` 을 적어 **늘 실패**했다.

## 2. 설계
- 스키마(추가만): `prescriptions.discharge_med BOOLEAN NOT NULL DEFAULT false` — 마이그레이션 `20260930000004_prescription_discharge_med`.
- `GET /api/v1/admissions/:admissionId/discharge-prescriptions` (DOCTOR·NURSE·PHARMACIST·ADMIN): 퇴원약 처방(최근 오더 상태 포함) + 옮겨 올 입원 중 활성 약(200 상한 — 잘리면 밝힘).
- `POST /api/v1/admissions/:admissionId/discharge-prescriptions` (DOCTOR·ADMIN — 퇴원약은 의사의 결정, 대리입력 경로 없음): 발행 정본 `create()` 를 그대로 지난다(DUR·처방집·사전승인·처방의 규칙·약국 오더·마약류 원장).
  - 입원 중(ADMITTED)만(409 `ADMISSION_NOT_ACTIVE`) · 약만(400 `DISCHARGE_MEDICATION_ONLY`) · **일수·총량 필수**(400 `DISCHARGE_DAYS_REQUIRED`/`DISCHARGE_QUANTITY_REQUIRED`) · 붙일 진료 없음 409 `NO_ADMISSION_ENCOUNTER`
  - 진료 = 입원의 가장 최근 진료(오더 화면 정본 `findOrderEncounter` 와 같은 규칙) · `source: 'DISCHARGE'`
  - DUR 은 이 입원의 **입원 중 약을 비교에서 뺀다**(퇴원과 함께 끝나는 약) — 퇴원약끼리·다른 복용약과만 본다.
- 입원 흐름에서 빠진다: 투약 예정(MAR) 생성은 409 `DISCHARGE_MED_NO_MAR` · 갱신 대기 목록 제외 · 퇴원 준비의 "미결 오더"에서 제외(퇴원 때 조제되는 것이 정상).
- 퇴원 준비: `dischargeMeds{ source: ORDERS|SUMMARY_TEXT|null, ordered, internal, dispensed, external, summaryListed }` — 출처를 가른다. `dischargeMedsPrepared` 는 호환용으로 남김. `readyToDischarge` 는 바꾸지 않는다(사람 결정).
- 퇴원요약: 프리필은 처방 원장의 퇴원약이 정본(`dischargeMedicationsSource: 'ORDERS'`), 없으면 입원 중 약을 **참고로만**(`'INPATIENT_ACTIVE'` — 화면이 "퇴원약 처방 아님"이라 말한다). **서명 순간** 활성 퇴원약을 요약에 스냅샷(없으면 기존 값 보존 — 옛 자유 기재를 지우지도 지어내지도 않는다). 스냅샷은 `name`·`drugName` 을 함께 싣는다.
- 포털: 본인 퇴원약 확인이 `name` 키와 처방 원장 퇴원약도 본다.
- 약국 워크스테이션: 큐에 '퇴원약' 배지(`dischargeMed`).

## 3. 화면
- 공용 `components/prescription/DischargeRxPanel.tsx` — 퇴원요약 화면·퇴원 워크스테이션: 퇴원약 목록(처방·오더 상태·원내/원외) · [중단] · 입원 중 약에서 옮기기(용량·횟수·경로만 참고로 옮기고 **일수·총량·조제 구분은 비워 둔다**) · 새 약 검색 · DUR 차단이면 사유를 받아 한 번 더.
- 표시 정본 `lib/discharge-med.ts` — 문자열(옛)·객체(프리필·스냅샷) 두 모양을 하나에서 읽는다.

## 4. 사람 결정(등록부 배치 N · `decision.registry.batch-2026-09-n.ts`)
- `discharge.stopInpatientMedsOnDischarge` — 퇴원 처리 때 입원 중 약 자동 중단(현행 없음). 자동으로 끊는 방향은 사람 판단.
- `discharge.medsDispensedForReady` — 원내 조제 퇴원약 조제 완료를 "퇴원 가능" 조건에(현행 보여 주기만).

## 5. 남은 것
- 원외 처방전 출력(퇴원약 원외분) · 퇴원약 복약 교육 기록 · 퇴원약 청구 구분(외래/입원 수가 — 원무 판단).
