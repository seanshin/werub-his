/**
 * 상태 쓰기 기준선 — 계측 정본 status-write-scan.ts 의 실측값(2026-09-15 D1). **손으로 세지 않는다.**
 * 총 상태 쓰기 558 중 검사안함 220 (나머지는 정본·조건부·선행검사).
 * 갱신: 값을 고친 이유(고쳤다 / 새 경로다)를 커밋 메시지에 남긴다 — 이 표는 늘지 않는다만 지킨다.
 */
/**
 * 🔴 (2026-09-16 G3) 554 → 555 · telehealth 6 → 7 — **늘었다**.
 *    원격진료 종료를 트랜잭션으로 묶으면서 경로가 둘로 갈라졌다(새 진료기록을 만드는 경로 안의 세션 종료 /
 *    이미 진료기록이 연결된 세션의 종료). 세션 종료 쓰기가 하나 더 생긴 것이고, 둘 다 현재 상태를 보지 않는다
 *    — `endSession` 의 상태 선행검사는 이 갈래(G3·트랜잭션 경계)가 아니라 상태 전이 축(E1)의 몫이라 손대지 않았다.
 *    🔴 "늘었으니 통과"가 아니라 **왜 늘었는지 적고 올린다**.
  *       2026-09-16 K2 556 → 557 — 특수영양 처방이 **같은 종류의 이전 활성 처방을 닫는** 쓰기가 하나 늘었다
 *       (식이 처방이 이미 지키던 '한 시점 한 활성 오더' 규칙을 여기도 지키게 한 것 · 조건부라 '검사안함' 은 그대로).
 *       2026-09-28 r3 B4 557 → 558 — 스크라이브 전사가 **세그먼트 0개**면 `TRANSCRIBED` 대신 `FAILED` 로 두는 쓰기가
 *       하나 늘었다("무음"과 "파서가 못 읽음"을 "전사 완료"로 말하지 않는다). 직전에 TRANSCRIBING 세션을 읽고 온 경로다.
 *       2026-09-28 a13360 558 → 559 — **새 쓰기가 아니라 가려져 있던 것**이다. CSSD 발주 입고(`cssd-po.receive`)의
 *       상태 쓰기는 종전부터 있었는데 트랜잭션 클라이언트 이름이 `txc` 라 이 스캐너의 `\btx\.` 가 못 봤다.
 *       입고 봉합(잠금 안 재조회)으로 이름이 `tx` 가 되며 보이게 됐다. 상태를 읽고 throw 하므로 '선행검사' 분류 — 검사안함 수는 그대로.
 *       🔴 이 스캐너도 클라이언트 이름을 `tx` 로 못박고 있다(멱등 스캐너가 같은 사각을 `tx\w*` 로 넓혔다) — 오늘 `txc` 류 0건이라 수는 같다.
*/
export const STATUS_WRITE_TOTAL_BASELINE = 584; // 공개판: 반납을 원자 전이로(-1) · 기증자 승인 · 거절 경로 신설(+1, 상태 확인 후 쓰기) · // 583→584 2026-10-22 입원 중간정산 무효 GENERATED·NOTIFIED·OVERDUE→VOID(조건부 updateMany where {id, status: 현재} · 동시 변경 409 · 검사안함 수는 그대로) · 580→583 2026-10-21 임상 규칙 P2 — 약속처방·치료일정 상태 전이·승인 단계 수정·이전 판 폐기(전부 조건부 updateMany where {id, status: 현재} · 동시 변경 409 CATALOG_STATUS_RACE · 검사안함 수는 그대로) · 581→580 2026-10-14 U1 — 동의서 전자서명 경로의 무조건 COMPLETED 쓰기 제거 · 579→581 2026-10-10 방사선 '조사 중' 고착 정리 — DELIVERING→DELIVERED·CANCELLED(둘 다 조건부 updateMany where status: DELIVERING · 동시 변경 409 · 검사안함 수는 그대로) · 577→579 QI 보고서 위원회 제출 — DRAFT→SUBMITTED 선점·안건 생성 실패 시 되돌림(둘 다 조건부 updateMany · 검사안함 수는 그대로) 2026-10-08 · 578→577 워크그룹 알림 확인이 사고 상태를 바꾸던 쓰기 제거 · 사고 상태 전이는 조건부 updateMany(QI-FLOW P0 D2) 2026-10-08 · 577→578 개선 활동 PDCA 단계 전이(조건부 updateMany where {id, status: 현재} · 검사안함 수는 그대로) 2026-10-07 · 576→577 초진 동의 종이 기록 — 묶음 PENDING→SIGNED(조건부 updateMany · 원장 10종과 한 트랜잭션 · 검사안함 수는 그대로) 2026-10-02 · 573→576 전자결재 콜백 자동 재시도 — 아웃박스 발송 취소(CANCELLED)·EAPPROVAL 발송 완료(SENT)·대상 지정 적재 되살림(PENDING) · 셋 다 조건부(현재 상태를 where 에) · 검사안함 수는 그대로 2026-10-01 · 572→573 데모 전일 미진료 마감(dcq- 토큰 · 조건부 status: WAITING·CALLED · 검사안함 수는 그대로) 2026-10-01 · 568→572 병동 간 전동 요청 — 수락·거절·취소·입원 종료 닫기(전부 조건부 status: REQUESTED · 검사안함 수는 그대로) 2026-09-30 · 570→568 전실 정본 transferBedInTx 추출 — 입원 화면·입원 API 두 전실 경로의 선점·반납 중복이 한 함수로(반납은 OCCUPIED 조건부) · PACU 퇴실 전실도 같은 함수 2026-09-30 · 569→570 처방전 재발급 — 이전 발급 ORIGINAL·REISSUE → SUPERSEDED(조건부 updateMany · 트랜잭션 · 검사안함 수는 그대로) 2026-09-30 · 567→569 처방 갱신 — 원처방 ACTIVE→DISCONTINUED·접수 전 오더 ORDERED→CANCELLED(둘 다 조건부 · 검사안함 수는 그대로) 2026-09-30 · 565→567 처방 중단 — 처방 ACTIVE→DISCONTINUED·접수 전 오더 ORDERED→CANCELLED(둘 다 조건부 updateMany · 검사안함 수는 그대로) 2026-09-30 · 564→565 접수 대기 되돌리기(CANCELLED·NO_SHOW → WAITING · 조건부 updateMany 로 현재 상태를 DB 가 판정 · 검사안함 수는 그대로) 2026-09-29 · 563→564 응급 미확인 등록의 사전통보 도착 처리(EN_ROUTE 만 · 사람이 체크한 경우만 · 선행 조회) 2026-09-29 · 562→563 P2 도면 확정 철회(확정본만 · 선행 조회) · 559→562 P1 초안 생성·확정·반려 · 2026-09-28
// 이전: 559 // 555→556 H1 태블릿 재페어링 경로 신설(소지 증명·페어링 코드 없이 deviceSecret 을 내주던 문을 닫으며 코드 재페어링 update 추가 — 선행검사 분류) · 2026-09-16

export const STATUS_WRITE_UNCHECKED_BASELINE: Record<string, number> = {
  'agent-session/agent-session.service.ts': 7,
  'auth/step-up/push-approval.service.ts': 2,
  'billing/billing.listener.ts': 1,
  'blockchain-anchor/blockchain-anchor.service.ts': 1,
  'blockchain-cert/blockchain-cert.service.ts': 2,
  'blood-bank/blood-bank.service.ts': 3,
  'checkup/checkup-protocol.service.ts': 1,
  'checkup/checkup.service.ts': 5,
  'chemo/chemo.service.ts': 2,
  // 2026-09-16 K1 2 → 1: 상신 성공 경로의 매핑 쓰기를 재시도 루프로 옮기며 상태 쓰기 1자리가 사라졌다
  //    (ERROR 표식 쓰기는 그대로 남아 있다 — 감춘 것이 아니다)
  'clinic-integration/erp-eapproval.service.ts': 1,
  'code-master/auto-mapper.service.ts': 3,
  'code-master/code-synonym.service.ts': 1,
  'compounding/compounding.service.ts': 1,
  'concierge/concierge.service.ts': 1,
  'consent/consent-device.service.ts': 4,
  'consent/consent.service.ts': 2,
  'consult/consult.service.ts': 4,
  'controlled-substance/controlled-substance.service.ts': 3, // 공개판: 반납을 원자 전이로
  'credential-admin/approval.service.ts': 2,
  'credential-admin/credential-cron.service.ts': 2,
  'credential-admin/device-policy.service.ts': 3,
  'crm/crm-cron.service.ts': 1,
  'crm/crm.service.ts': 1,
  'cssd/cssd-package.service.ts': 1,
  'dental/dental.service.ts': 1,
  'dermatology/dermatology.service.ts': 2,
  'dev-demo/dev-demo.service.ts': 3,
  'diagnostic-test/diagnostic-test.service.ts': 1,
  'discharge-summary/discharge-summary.service.ts': 1,
  'document-sign/document-sign.service.ts': 1,
  'document/document.service.ts': 1,
  'eligibility/eligibility.service.ts': 1,
  'emergency/emergency.service.ts': 4,
  'emergency/er-bed.service.ts': 6,
  'equipment/equipment.service.ts': 1,
  'ess/ess.service.ts': 5,
  'formulary/formulary.service.ts': 2,
  'gld/gld.service.ts': 3,
  'gld/governance-enactment.service.ts': 3,
  'gld/governance.service.ts': 2,
  'hie/hie.service.ts': 3,
  'hr/hr.service.ts': 2,
  'i18n-review/i18n-review.service.ts': 2,
  'infection-control/infection-control.service.ts': 2,
  'integration-gate/integration-gate.service.ts': 1,
  'integration/integration-outbox.service.ts': 2,
  'inventory/inventory.service.ts': 3,
  'lab/cell-therapy.service.ts': 1,
  'lab/genomics.service.ts': 1,
  'lab/lab.service.ts': 2,
  'medical-record-issuance/document-bundle.service.ts': 1,
  'medical-record-issuance/issuance.service.ts': 4,
  'mobile/app-key/app-key.service.ts': 3,
  'nurse-station/nurse-station.service.ts': 1,
  'nursing/nursing.service.ts': 2,
  'nutrition/nutrition-advanced.service.ts': 1,
  'nutrition/nutrition.service.ts': 1,
  'onboarding/onboarding.service.ts': 2,
  'order-sign-log/order-sign-log.service.ts': 2,
  'pacs-proxy/pacs-integration.listener.ts': 3,
  'pacs-proxy/pacs-webhook.controller.ts': 4,
  'partner-request/partner-request.service.ts': 1,
  'pathology/pathology.service.ts': 2,
  'patient-auth/patient-auth.controller.ts': 2,
  'patient-auth/patient-auth.service.ts': 1,
  'patient-safety/patient-safety.service.ts': 2,
  'pharmacy/pharmacy.service.ts': 3,
  'portal/portal.service.ts': 5,
  'pre-auth/pre-auth.service.ts': 1,
  'pre-order/pre-order.service.ts': 1,
  'problem-list/problem-list.service.ts': 1,
  'protocol/protocol.service.ts': 2,
  'questionnaire/questionnaire-admin.service.ts': 1,
  'questionnaire/questionnaire.service.ts': 4,
  'radiation/radiation.service.ts': 1, // 2026-10-10 2→1 분할 취소가 상태를 읽고 조사 완료는 막는다
  'rehab/rehab.service.ts': 1, // 공개판: 세션 시작 · 완료가 상태를 확인한 뒤 쓴다
  'schedule/schedule.service.ts': 4,
  'scribe/ambient.service.ts': 1,
  'scribe/scribe.service.ts': 4,
  // 🔴 (2026-09-17 L1) 0 → 1 — 봉합이 만든 분류 이동이지 새 무검사 쓰기가 아니다.
  //    webhook 을 `handleWebhook`(멱등 claim/해제) + `applyWebhook`(반영) 으로 갈랐더니 종결상태 역행
  //    차단이 `applyWebhook` 안의 **조기 return** 으로만 남았다(그 위 `throw` 는 wrapper 로 옮겨갔다).
  //    스캐너는 `throw` 또는 `…: false` 반환만 선행검사로 읽어 이 자리를 '검사안함'으로 센다 —
  //    실제 가드(TERMINAL 역행 차단)는 그대로 있다.
  'sign-integration/sign-integration.service.ts': 1,
  'staff-call/staff-call.service.ts': 1,
  'surgery-opnote/surgery-opnote.service.ts': 1,
  'telehealth/telehealth.service.ts': 7,
  'terminal/terminal.service.ts': 2,
  'voc/voc-admin.service.ts': 4,
  'voice-emr/voice-emr.service.ts': 3,
  'voucher/distributor.service.ts': 1,
  'voucher/voucher-cron.service.ts': 2,
  // 2026-09-16 병합: J4 의 '빠진 일련번호 이어서 발행' 경로가 상태 쓰기를 하나 더 만든다(J1 이 내린 2 → 3)
  'voucher/voucher.service.ts': 3, // 2026-09-16 J1 −1 — issueBatch 멱등 분기가 배치 status 를 읽고 비교하게 되어 '선행검사'로 재분류(검사안함 아님)
  'waiting-queue/waiting-queue.service.ts': 4,
  // 'workgroup/workgroup.service.ts': 1 — 2026-10-08 알림 확인이 사고 상태를 바꾸던 쓰기 제거(QI-FLOW P0 D2)
  'workstation-setup/print.service.ts': 1,
  'workstation/workstation.service.ts': 2,
};
