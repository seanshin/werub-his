/**
 * 트랜잭션 경계 기준선 — **파일별 '다중쓰기 메서드' 수**(2026-09-16 F3 최초 동결).
 *
 * 한 메서드가 `$transaction` 밖에서 쓰기를 2회 이상 하면 그 메서드를 1로 센다.
 * 🔴 이 수는 **결함 수가 아니다** — 감사·알림처럼 실패해도 본 작업이 유효한 베스트에포트와,
 *    분기상 동시에 실행되지 않는 쓰기(예: 조기 반환 뒤의 다른 경로)가 섞여 있다.
 *    지키는 것은 **늘지 않는다** 하나다. 줄일 때는 이 수를 함께 내린다.
 *
 * 이력: 2026-09-16 최초 254 → 244(약제 2·사전처방·비대면 2·수혈 3·멸균·검사결과·치료오더 봉합)
 *       2026-09-16 G3 244 → 233(영상 3·검사 2·원격진료 종료·문서서명·이식 2·신체보호대·분납 봉합 ·
 *       🔴 동의서 서명은 서명 쌍만 묶었고 그 메서드에는 다른 쓰기가 남아 여전히 다중쓰기로 센다)
 *       2026-09-16 H4 233 → 221 — 🔴 **쌍둥이 경로가 남아 있었다**: G3 가 `imaging.service` 에서 고친 자리의
 *       워크스테이션 판(촬영·판독·검체접수) 3, 신체보호대에서 고친 자리의 정신과 판(격리 관찰↔해제) 1.
 *       그 밖에 PACS 웹훅 2(재전송 보장 없음)·장비 점검 불합격→사용중지·검진 결과서 서명↔방문 완료·
 *       ER KTAS 재분류·멸균 로드 투입·검사 워크시트 항목·검진권 앵커(중복 앵커).
 *       2026-09-16 I2 221 → 213 — 원장↔상태 쌍 12자리: ESS 휴가 콜백(연차 차감)·근태 정정 기록 ·
 *       응급 처분 원장↔방문 · CSSD 패키지 원장 3경로(사용·반납·리콜 — **한 가족 쌍둥이**) ·
 *       파트너 승인(외부 앱 자격↔신청) · 검진 스테이션 완료 · 프로토콜 단계 전이 · 경로 이탈 카운트 ·
 *       증명서 작성↔요청 상태 · 항암 사이클 개시.
 *       🔴 응급 처분·휴가 콜백은 **다른 분기의 쓰기가 남아** 행 자체는 그대로 세어진다(쌍은 묶였다 —
 *       `tx-boundary-fixes-i2.spec` 이 그 쌍을 따로 본다). 수는 상한이지 결함 수가 아니다.
 *       2026-09-16 J1 213 → 202 — **I2 가 고친 ESS 승인 경로의 신청·취소 쪽 쌍둥이 4**(휴가 취소=연차 복원 ·
 *       휴가 신청·근태 정정=겹침/중복 검사가 재신청을 막는다 · 동의서 확약 상신=결재선 없는 PENDING relay) ·
 *       검진 판독 완료↔결과 항목 판정(E1 가드가 재시도를 막는다) · 의뢰서 전송·서명전송 2(수신과 알림 조용한 유실) ·
 *       환자 가입·환자 생성 2(법정 동의 이력 없는 계정·환자) · 동의서 서식 버전업·복원 2(최신본이 하나도 없는 창).
 *       🔴 검진권 `issueBatch` 는 **트랜잭션이 아니라 멱등 반환의 정직성**을 고쳐 행은 그대로 남는다
 *       (부분 발행인데 요청 수량 전량을 발행했다고 답하던 자리 — `tx-boundary-fixes-j1.spec` 이 따로 본다).
 *       🔴 **인벤토리는 과소 계상이다**(I2 가 밝힘) — `this.event.record()` 처럼 헬퍼 뒤에 숨은 쓰기는
 *       이 스캐너에 1회로만 보인다. 수가 줄었다고 그만큼 결함이 준 것이 아니다.
 *       2026-09-16 K1 201 → 196 — 상태+원장 쌍 10자리: 진료 시작(Encounter↔큐) · 항암 사이클↔코스 종결(J4 startCycle 의
 *       같은 파일 쌍둥이) · 당직 교대 요청↔결재선(J1 ESS 신청의 쌍둥이) · 검진 서명↔소견↔진단(Z00.0) ·
 *       일정 일괄이동(부분 이동 뒤 재시도가 delta 0 이라 영영 못 끝냄) · 포털 동의서(같은 행 2회 쓰기) ·
 *       태블릿 서명 세션 선점 · 동의서 앵커 3쓰기 · sign 제출 후 바인딩 · ERP 상신 매핑(재시도+실패 고지).
 *       🔴 봉합 10 중 5 만 행이 줄었다 — 나머지는 같은 메서드에 비차단 쓰기(알림·여정·PreOrder 동기)가
 *       남아 여전히 다중쓰기로 세어진다. 이 수는 보호의 **상한**이지 결함 수가 아니다.
 */
export const TX_MULTI_WRITE_BY_FILE: Record<string, number> = {
  'agent-session/agent-session.service.ts': 2,
  'auth/device-enroll/device-enroll.service.ts': 1,
  'auth/passkey/passkey.service.ts': 4,
  'auth/recovery/recovery.service.ts': 1,
  'auth/step-up/push-approval.service.ts': 4,
  'blockchain-cert/blockchain-cert.service.ts': 1,
  'bots/bots.service.ts': 1,
  'cancer-registry/cancer-registry.service.ts': 2,
  'chart-template/chart-template.service.ts': 4,
  'checkup-explainer/checkup-explainer.service.ts': 2,
  'checkup/checkup-contract.service.ts': 1,
  'checkup/checkup-protocol.service.ts': 3,
  'checkup/checkup-questionnaire.service.ts': 1,
  'checkup/checkup-station.service.ts': 1,
  'checkup/checkup.service.ts': 5,
  'clinic-integration/clinic-integration.controller.ts': 2,
  'clinic-integration/erp-eapproval.service.ts': 1,
  'clinic-integration/sso.controller.ts': 1,
  'clinical-chart-result/clinical-chart-result.service.ts': 1,
  'cms-config/cms-config.service.ts': 1,
  'code-master/auto-mapper.service.ts': 3,
  'code-master/code-import.service.ts': 1,
  'code-master/drg-reference.service.ts': 3,
  'code-master/reference-dataset.service.ts': 3,
  'concierge/concierge.service.ts': 2,
  'consent/consent.service.ts': 3,
  'consult/consult-agent.service.ts': 1,
  'consult/consult-team.service.ts': 2,
  'consult/consult.service.ts': 7,
  'credential-admin/credential-cron.service.ts': 1,
  'crm/crm.service.ts': 3,
  'cssd/cssd-package.service.ts': 2,
  'data-quality/data-quality.service.ts': 2,
  'dev-demo/dev-demo.service.ts': 4,
  'duty-schedule/duty-schedule.service.ts': 2,
  'eligibility/eligibility.service.ts': 2,
  'emergency/emergency.service.ts': 2,
  'encounter/encounter.service.ts': 1,
  'equipment/equipment.service.ts': 1,
  'ess/ess.service.ts': 9,
  'fee-integration/fee-integration.service.ts': 2,
  'fhir-lab/fhir-lab-ingest.service.ts': 1,
  'foreign-patient/foreign-patient.service.ts': 2,
  'formulary/formulary.service.ts': 1,
  'gld/gld.service.ts': 1,
  'gld/governance-enactment.service.ts': 1,
  'gld/governance.service.ts': 1,
  'go-live/go-live.service.ts': 1,
  'hie/hie.service.ts': 1,
  'hira-edi/hira-edi.service.ts': 1,
  'hospital-info/hospital-info.service.ts': 2,
  'hr/hr.service.ts': 1,
  'imaging/imaging-safety.service.ts': 1,
  'infection-control/infection-control.service.ts': 2,
  'integration/integration-outbox.service.ts': 3,
  'medical-record-issuance/document-bundle.service.ts': 1,
  'mobile/identity/identity.service.ts': 1,
  'notification/notification.service.ts': 1,
  'nutrition/nutrition-advanced.service.ts': 1,
  'nutrition/nutrition.service.ts': 1,
  'onboarding/onboarding.service.ts': 4,
  'order-sign-log/order-sign-log.service.ts': 1,
  'pacs-proxy/pacs-integration.listener.ts': 1,
  'patient-auth/patient-auth.service.ts': 7,
  'patient-auth/patient-profile.controller.ts': 1,
  'patient-auth/services/sms-otp.service.ts': 1,
  'patient-flow/patient-flow.service.ts': 2,
  'pharmacy/pharmacy.service.ts': 1,
  'portal/portal.service.ts': 5,
  'pre-auth/pre-auth-gate.service.ts': 1,
  'pre-auth/pre-auth.service.ts': 5,
  'pre-order/pre-order.service.ts': 2,
  'protocol/protocol.service.ts': 3,
  'qr/qr.service.ts': 1,
  'quality/quality.service.ts': 2,
  // 2026-10-08 QI 보고서 위원회 제출 — DRAFT 선점(조건부) → 안건 생성(위원회 모듈 자체 트랜잭션) → 안건 id 기록 · 안건 실패 시 선점 되돌림(보상). 다른 모듈 트랜잭션을 한 번에 묶을 수 없어 보상으로 닫는다
  'quality-flow/qi-report.service.ts': 1,
  // 2026-10-09 무선 측위 storeFix — 측위 행 → (방 확인 시) 위치 원장(FloorService 자체 tx·환자 잠금) → 측위 행에 위치 id. 마지막 연결이 실패해도 측위·위치는 각자 사실이다(잇는 칸만 빈다)
  'wifi-location/wifi-positioning.service.ts': 1,
  'questionnaire/questionnaire-admin.service.ts': 1,
  'questionnaire/questionnaire.service.ts': 3,
  'radiation/radiation.service.ts': 1,
  'referral-letter/referral-letter.service.ts': 2,
  'remote-consultation/remote-consultation.service.ts': 7,
  'research/research.service.ts': 1,
  'risk-reassessment/risk-reassessment.service.ts': 1,
  'satisfaction/satisfaction.service.ts': 1,
  'scribe/scribe.service.ts': 2,
  'sign-integration/sign-integration.service.ts': 1,
  'smart-auth/smart-auth.service.ts': 1,
  'staff-call/staff-call.service.ts': 1,
  'telehealth/telehealth.service.ts': 1,
  'terminal/terminal.service.ts': 2,
  'transfer/transfer.service.ts': 1,
  'treatment-template/treatment-template.service.ts': 3,
  'vitals/vitals-ingest.service.ts': 1,
  'voc/voc-admin.service.ts': 2,
  'voice-emr/voice-emr.service.ts': 2,
  'workstation-setup/workstation-setup.service.ts': 3,
};

/** 전체 합(파일별 합과 일치해야 한다 — 한쪽만 고치면 갈라진다)  *       2026-09-16 병합: J1(213→202)·J4(213→212) 가 같은 기준선을 각자 낮춰 충돌 — 합친 트리에서 재측정한 201 로 확정(감소분이 겹치지 않는다).
 *       2026-09-16 병합(K): K1 이 201→196 으로 내렸고 K4 가 줄바꿈에 가려져 있던 pharmacy 원장 쓰기를
 *       드러내 +1 — 합친 트리 실측 **197**(위반이 는 것이 아니라 스캐너가 더 보게 된 것).
 */
// 🔴 (2026-09-16 J4) 213 → 212: 검진권 발행 루프를 `fillBatch` 로 모으며 청크 쓰기가 전부
//    `$transaction` 안으로 들어갔다(voucher.service 1 → 0). 줄어든 방향이라 기준선을 내린다.
//
// 🔴 (2026-09-17 L1) 197 → **199** — 두 방향이 겹친 수다. 늘고 줄어든 이유를 갈라 적는다:
//    · **+8 은 위반이 는 것이 아니라 스캐너가 더 보게 된 것**이다. 본문 시작을 `)` 뒤 첫 `{` 로 잡아
//      `): Promise<{…}> {` 의 **제네릭 안 중괄호**를 본문으로 삼았고, 그 메서드들의 쓰기는 한 건도
//      세지 않았다(K2 가 멱등 스캐너에서 같은 함정으로 2메서드를 잃은 것과 같은 자리).
//      드러난 8: hie(대외 전송)·sign-integration(webhook)·voucher-ledger(앵커)·patient-auth(refresh)·
//      agent-session·dev-demo 3.
//    · **−6 은 봉합**이다: 앵커 원장(voucher-ledger) · 태블릿 페어링(consent-device) ·
//      코드↔용어매핑 4쌍둥이(code-master) · 고시 수가 버전 교체(code-import).
// 2026-09-28 −1: 여정 위치 갱신(닫기·열기 2쓰기)이 FloorService.recordLocation 트랜잭션으로 이동(P0-3)
// 2026-10-03 −1: 퇴원요약 정정(서명본 보존↔AMENDED 전환)이 한 트랜잭션으로 — discharge-summary.service 1 → 0
export const TX_MULTI_WRITE_TOTAL = 195; // 194→195 무선 측위 storeFix 2026-10-09
