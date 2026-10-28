# 병동 간 전동 요청 → 수락 (2026-09-30)

> 요청: "전동 요청→수락 2단계 진행해". 선행: PACU 퇴실 → 병상·ICU 연결(같은 날).

## 1. 실측
- 입원 화면 "전동"은 `window.prompt` 로 병상 번호를 골라 **즉시** 옮겼다 — 받는 병동은 환자가 도착해서야 알았다.
- 병원 내부 요청→수락 흐름이 없었다(`TransferRecord` 는 기관 간 전원용).
- 사용자에 병동 소속이 없다 — "받는 병동 간호사"를 시스템이 확인할 수 없다.

## 2. 설계
- 원장 `bed_transfer_requests`(추가만 · `20260930000009`) + 부분 유니크 `uniq_bed_transfer_open`(입원 하나에 열린 요청 하나 → 409) · 어휘 shared `bed-transfer.ts`
- `POST /api/v1/bed-transfers`(간호사·의사·관리자) — 받는 병동·사유 필수·원하는 병상 선택 · 같은 병동이면 400(즉시 이동으로) · 병상을 잡지 않는다
- `POST …/:id/accept`(간호사·관리자 — 즉시 이동과 같은 권한) — 받는 병동 병상 · **같은 트랜잭션**: 조건부 상태 전이(REQUESTED→ACCEPTED) + 전실 정본 `transferBedInTx`(사유 TRANSFER_REQUEST) · 이미 닫혔으면 409·이동 없음
- `POST …/:id/reject`(사유 필수) · `POST …/:id/cancel`(요청자·관리자) · `GET ?scope=incoming|mine|recent`(200 상한·잘리면 밝힘)
- 입원 종료(`admission.closed`) → 열린 요청 CANCELLED·판정자 null·사유 ADMISSION_CLOSED
- 요청자 인앱 알림 `BED_TRANSFER_DECIDED`(수락·거절 · 결과 `{attempted,sent,reason}`)
- 🔴 받는 병동 소속은 확인하지 못한다 — 누가 수락·거절했는지 남긴다(화면이 그 사실을 말한다)

## 3. 화면
- `/bed-transfers`(1906 · 입원 메뉴) — 받을 요청(병동 선택)·보낸 요청·최근 처리 · 수락은 비어 있는 병상만 고를 수 있다(예약·청소 중은 비활성 표시)
- 입원 화면: 즉시 이동은 "병상 이동", 병동 간은 "전동 요청"(창)

## 4. 사람 결정(배치 R)
- `bedTransfer.requireAcceptance` — 병동 간 이동은 수락 필수(현행 선택)
- `bedTransfer.reserveOnRequest` — 요청 때 병상 예약(현행 안 함)

## 5. 남은 것
- PACU 퇴실 → 다른 병동은 지금 즉시 이동 — 결정 `requireAcceptance` 에 따라 요청으로 바꿀지
- ICU 퇴실 → 병동 복귀 요청
