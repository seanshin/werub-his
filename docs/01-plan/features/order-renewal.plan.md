# 지속 처방 갱신·만료 (2026-09-30)

> 요청: "지속 처방 갱신·만료 진행해". 출발점: 의사 업무 점검(2026-09-30) 남은 항목 ② · 선행: 처방 중단 `order-discontinue.plan.md`.

## 1. 실측
- 처방의 끝은 `createdAt + duration`(투여기간 정본 `dosingWindow`)으로만 계산됐다. **기간이 끝나도 상태는 활성**이고, 그 사실을 누가 처리해야 하는지 알려 주는 목록이 없었다 — 의사는 기억으로 일했다.
- 기간 없는 처방(PRN·지속 지시)은 끝이 없었다. 마약성 진통제 PRN 이 끝없이 활성으로 남을 수 있었다.
- 갱신 수단은 "반복"(`POST /prescriptions/:id/repeat`)뿐이었다 — 원처방을 그대로 둔 채 **같은 값으로** 새 처방을 만들어, 두 줄이 겹치고(같은 약 이중 투약 위험) DUR 이 원처방과의 '중복'으로 막거나, 중단·취소된 처방도 반복할 수 있었다.

## 2. 설계
### 갱신 = 새 처방으로 잇고 원처방은 같은 순간 중단
- `POST /api/v1/prescriptions/:id/renew` (DOCTOR·ADMIN · 권한은 중단과 같은 규칙): `{ days, quantity, reason?, overrideDur?, overrideReason? }`
  - **일수·총량은 의사가 정한다**(비면 400 `RENEW_DAYS_REQUIRED`/`RENEW_QUANTITY_REQUIRED`) — 원처방 값을 복사하지 않는다(갱신은 새 결정). 화면도 입력칸을 비워 두고 원처방 값은 참고로만 보인다.
  - 새 처방은 발행 정본을 지난다: DUR(원처방은 비교에서 **제외** — `checkInteractions(..., { excludePrescriptionIds })`) · 원내 처방집 · 사전승인(마약류 재처방 남용 벡터) · 약국 오더 생성. 게이트 경로 어휘는 `REPEAT`(늘리지 않는다).
  - 한 트랜잭션: 원처방 `ACTIVE→DISCONTINUED`(조건부 — 동시 변경이면 409 `PRESCRIPTION_STATE_CHANGED`, 새 처방 안 만듦) · 사유 "갱신 — …" · 접수 전 오더 취소 · 중단 시각 이후 예정 투약 삭제 → 새 처방(`source: 'RENEWAL'`, `renewedFromId`, 책임 처방의 = 갱신한 사람).
  - 활성 **약** 처방만(비약물 지속 지시는 후속).
- 스키마(추가만): `prescriptions.renewed_from_id`(+인덱스) — 마이그레이션 `20260930000003_prescription_renewal`.

### 갱신 대기 = 줄어드는 목록
- `GET /api/v1/prescriptions/renewals/due` (DOCTOR·ADMIN): **내**(정본 `my-orders-scope`) **입원 중** 환자의 활성 약 처방 가운데
  - `EXPIRED` 만료됨(기간이 끝났는데 활성) · `ENDING_SOON` 곧 만료(`order.renewal.soonHours` 안 · 기본 24) · `NO_END` 기간 없음(`order.renewal.noEndReviewDays` 가 지난 것 — **미설정이면 전부**, 응답이 그 사실을 싣는다)
  - 멀리 남은 처방은 올리지 않는다 · 500건 상한은 `truncated`·`totalActive` 로 밝힌다.
- 🔴 **자동으로 끊지 않는다**(자동 중단은 사람 결정 `order.renewal.autoExpire`). 그래서 이 목록이 있다 — 갱신하거나 중단하면 사라진다.

## 3. 화면
- `/renewals` 처방 갱신 대기(화면번호 1013 · 사이드바 외래 · DOCTOR/ADMIN): 칸별(만료됨·곧 만료·기간 없음) · 종료/종료 예정 시각 · 환자 링크 · [갱신][중단] · 기준값(곧 만료 시간·재검토 기한)을 머리에 밝힘(미설정이면 미설정).
- 공용 `components/prescription/RenewDialog.tsx` — 일수·총량 필수 · DUR 차단이면 강제 갱신 사유를 받아 한 번 더.
- 환자 차트 투약 이력: 활성 처방에 [갱신]·[중단].

## 4. 사람 결정(등록부 배치 M · `decision.registry.batch-2026-09-m.ts`)
- `order.renewal.autoExpire` — 기간이 끝난 처방 자동 중단(현행 없음 / 유예 뒤 자동) · 자동으로 끊는 방향은 사람 판단.
- `order.renewal.noEndReviewDays` — 기간 없는 처방 재검토 기한(현행 미설정 / 3일 / 7일) — 설정만 바꾸면 된다.

## 5. 남은 것
- 비약물 지속 지시(활동·간호·식이) 갱신 · 예약 중단(미래 stopAt) · 갱신 알림(목록은 있으나 알림 발송은 없음).
