# PACU 퇴실 → 병상·전동·ICU 연결 (2026-09-30)

> 요청: "PACU 퇴실 병상·전동 연결 설계 진행해" → "구현까지 진행하고 배포 후 푸시해". 선행: PACU 검토 보완(같은 날).

## 1. 실측
- PACU 퇴실은 `disposition`(WARD/ICU/HOME)만 적고 여정 이벤트뿐 — 병상·입원·ICU 는 아무것도 바뀌지 않았다. PACU 기록에 입원 연결도 없다.
- 병동: 입원이 현재 병상(`Admission.bedId`)을 갖고 이력은 `BedAssignment`. 전실 경로가 **둘**이었다 —
  `PATCH /inpatient/:id/transfer`(원자적·이력 닫음)와 `PATCH /admissions/:id/transfer-bed`(🔴 **이전 배정 이력을 닫지 않아** 한 입원에 활성 배정 둘·여정 없음).
- ICU: 별개 체계(`IcuBed`·`IcuAdmission`) · 입실은 DOCTOR/ADMIN · 병동 입원과 연결 없음. 병원 내부 "전동 요청→수락" 2단계는 없다.
- 입원 환자 퇴원은 퇴원 절차(`InpatientService.discharge` — 퇴원요약·정산 게이트·병상 청소·식이 종료)를 지난다.

## 2. 설계
- 트랜잭션 단계 정본 두 개로 추출(같은 규칙을 두 번 쓰지 않는다): `inpatient/bed-transfer.ts transferBedInTx` · `icu/icu-admit.ts admitIcuInTx`.
  입원 화면 전실·입원 API 전실(이력 닫기 봉합)·ICU 입실·PACU 퇴실이 같은 함수를 쓴다.
- PACU 퇴실 = **한 트랜잭션**(목적지 쓰기 + 조건부 퇴실 갱신 — 동시 퇴실이면 409 로 전부 되돌림):
  - WARD: 재원 중 입원 필수(없으면 409 `PACU_WARD_NEEDS_ADMISSION` — 입원 수속은 입원 경로) · 원 병상 복귀 / 다른 병상 = 전실(간호사·관리자 — 전실 EP 와 같은 권한)
  - ICU: 의사가 먼저 연 ICU 입실을 잇는다(누구든) · 없으면 ICU 병상 + 입실 사유 + 의사(ICU 입실 EP 와 같은 권한)로 새 입실 · 둘 다 아니면 409
  - HOME: 재원 중 입원이면 409 `PACU_HOME_WHILE_ADMITTED`(퇴원 절차를 건너뛰지 않는다)
- 기록: `pacu_records.destination`(추가만 · `20260930000008`) — `{kind, action(RETURN_TO_BED·TRANSFERRED·ICU_EXISTING·ICU_ADMITTED·HOME), admissionId, bedId, fromBedId, wardName, icuAdmissionId, wardBedHeld}` · 전실이면 여정 `BED_TRANSFER`
- `GET /api/v1/pacu/:id/destination-options` — 원 병상·재원 중 ICU 입실·비어 있는 병상(응급 구역 제외)·ICU 병상(각 200 상한·잘리면 밝힘)

## 3. 화면
- PACU 퇴실 패널에 목적지 선택(서버가 준 것만 · 초기값 미선택 · 고르기 전에는 퇴실 버튼 잠김) — 입원 없음·입원 중 귀가는 안내(입원 관리·퇴원요약 링크)

## 4. 사람 결정(등록부 배치 Q)
- `pacu.icuWardBedHold` — ICU 로 갈 때 병동 병상 유지(현행)/반납

## 5. 남은 것
- 병동 "전동 요청→수락" 2단계(받는 병동 확인) · PACU 입실 때 입원 연결을 PACU 기록에 저장 · ICU 퇴실 → 병동 복귀 병상 연결
