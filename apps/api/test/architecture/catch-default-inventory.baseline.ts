/**
 * `.catch(() => 기본값)` 파일별 정확 기준선 — 정본 스펙 `catch-default-inventory.spec.ts`.
 * 2026-09-22: fhir.controller 4→3 — subject 가 MRN 일 때 UUID 조회 예외를 `.catch` 로 삼켜
 *   "환자를 찾을 수 없습니다"라고 말하던 자리다. 식별자 종류로 갈라 찾으니 삼킬 것이 없다.
 * 2026-10-01 비리터럴 46곳 **판정**(종전엔 동결만): 실결함 17 교정 · 정당 29 유지 — 비리터럴 46 → 29(26파일 → 17).
 *   실결함: AI 고지가 조회 실패 시 빈 문자열(AI기본법 표기) · 보존기간·VoC 자동 종결이 실패 시 기본값으로 **지우거나 닫음** ·
 *   재고 원가 갱신 실패를 "ERP 매핑 없음"으로 · 관제·컷오버가 실패를 "승인 대기·미설정"으로 · VoC SLA·부서 배정이 실패 시 기본값으로 원장에 ·
 *   STT 200 본문 실패를 "말 없음"으로 · sign 2xx 본문 실패를 id 없는 성공으로 · 데모 리프레시 실패를 0건으로.
 *   리터럴은 284 그대로(−4: 데모 0·관제 null 2·컷오버 false / +4: data-quality `null` 2 = 실패도 미설정처럼 기본 고지·기관명 —
 *   종전 '' 은 `?? 기본` 을 못 탔다 · sign·STT `null` 2 = 받은 즉시 검사해 던진다 — 삼킴 아님).
 *   정당 29: 오류 응답 본문을 로그로만 읽음 · 발송 실패를 FAILED 로 · 3상태(ok:false)·-1=집계 실패 · 응답 값이 없으면 바로 던짐 · 안전측(마스킹·소유자 아님·발송).
 * 2026-09-15 N4: 총 354곳 · 139파일(실결함 17곳 교정 후 · 교정 전 371). 줄면 낮추고, 늘리려면 이유를 적는다.
 * 2026-09-16 J1: referral-letter 3→1 — 의뢰서 전송·서명전송의 수신과 알림을 **삼키지 않고** 트랜잭션 안으로
 *   옮겼다(알림 실패가 전송 상태를 되돌린다 — 상태 검사가 재전송을 막아 알림이 영구 유실되던 자리).
 *   ess 14→15(+1) — 동의서 확약 상신에서 결재선을 트랜잭션 안으로 옮기며, **알림만** 트랜잭션 밖 best-effort 로
 *   분리했다(알림 실패가 결재 상신을 되돌리면 안 된다 — pre-auth `recordPostFacto` 선례와 같은 규약).
 * 2026-09-16 K4: 349 → 333(139파일 → 133) — 위험순 16자리. **안전 게이트 위반 원장** 쓰기가 8파일 10자리에서
 *   `.catch(() => undefined)` 로 삼켜지고 있었다(기록이 유실되면 `/admin/safety-gates` 는 그 게이트를 "위반 0"으로
 *   그리고, 0건은 이 화면에서 "준수"로 읽혀 WARN→BLOCK 승격 판단의 근거가 된다). 정본
 *   `common/gate-violation-record.ts` 로 수렴 — 던지지 않되 유실을 `logger.error` 로 남긴다.
 *   그 밖에: sign 요청 id 바인딩(외부 발신 후 완료 webhook 매칭 불가) · ERP 릴레이 실패표시/전달표시 ·
 *   CDSS 검증 이력(safety-gate 통계 소스) · 심사 콜백 조회 2(DB 실패를 "담당의 없음"으로 → 전파).
 * 2026-09-17 L2: 333 → 297(133파일 → 132) — K4 가 **읽지 않았다고 밝힌 미분류 166** 을 한 건씩 읽어
 *   ③(실패를 '없음'으로 번역) 만 고쳤다. 가장 큰 것은 **결정 집행·근거 문서 원장**이다:
 *   `decision.service.pendingAttachments` 의 `[]` 폴백은 ① 새 첨부가 기존 목록을 **덮어쓰고**
 *   ② 허가권자 층을 "근거 문서 없음"으로 막고 ③ 근거를 **결정 기록에 담지 않은 채** 봉인시켰다.
 *   `governance-enactment.executeAction` 의 집행 전 스냅샷 15자리는 실패가 원장에
 *   `{ note: '집행 전 상태 없음(신규)' }` 로 박혔고(되돌릴 근거가 사라진 자리에서 "신규였다"고 단정),
 *   그중 GATE_MODE 부분 집행은 읽기 실패 시 **기존 게이트 맵을 통째로 덮어썼다**.
 *   그 밖에 개통 게이트 회수의 "개통 중이 아니다" 오판(integration-gate) · 설정 조회 실패를
 *   "관리자가 껐다"로 말하던 게이트 6(ess 4·pre-auth·governance.enabled) ·
 *   위원회 담당 조회 실패를 "담당 없음"으로 · 상담 AI 답변 저장 실패(환자는 답이 안 온 것을 모른다) 등.
 *   🔴 `config.get()` 은 미설정 키에 `null` 을 돌려주고 **DB 실패에만 던진다** — 그 위의 `.catch` 는
 *   오직 실패만 삼켰다는 뜻이고, 걷어내는 것이 미설정 동작을 바꾸지 않는다(그래서 전파로 고쳤다).
 */
export const CATCH_DEFAULT_BASELINE: Record<string, number> = {
  'agent-session/agent-session.service.ts': 1,
  'audit-enhanced/anomaly-detection.service.ts': 1,
  'audit/audit.interceptor.ts': 2,
  'audit/audit.service.ts': 2,
  'auth/auth.service.ts': 2,
  'auth/break-glass/break-glass.service.ts': 3,
  'auth/device-enroll/device-enroll.service.ts': 5,
  'auth/lifecycle/lifecycle.service.ts': 2,
  'auth/passkey/passkey.service.ts': 3,
  'auth/recovery/recovery.service.ts': 2,
  'auth/step-up/push-approval.service.ts': 1,
  'auth/strategies/jwt.strategy.ts': 1,
  'billing/billing.service.ts': 5, // 7→5 2026-10-22 입원료 단가 설정 조회 실패를 삼키지 않는다(삼키면 상수 50,000 이 근거처럼 보인다)
  'blood-bank/blood-bank.service.ts': 3,
  // 2026-10-21 임상 규칙 P0: 규칙 통계의 DUR 룰 수 조회 실패 → null = 화면 '?'(확인 불가 · 0 으로 접지 않음 — 3상태 정당)
  'cdss/cdss.service.ts': 1,
  'chemo/chemo.service.ts': 1,
  'chronic/chronic.service.ts': 1,
  'code-master/auto-mapper.service.ts': 1,
  'consent/consent.service.ts': 1,
  'consult/consult.service.ts': 12,
  'credential-admin/approval.service.ts': 1,
  'credential-admin/bulk.service.ts': 1,
  'credential-admin/cert-admin.service.ts': 1,
  'credential-admin/credential-cron.service.ts': 1,
  'credential-admin/device-policy.service.ts': 2,
  'credential-admin/grant.service.ts': 1,
  'credential-admin/lifecycle-admin.service.ts': 1,
  'credential-admin/policy.service.ts': 1,
  'credential-admin/staff360.service.ts': 1,
  'cssd/cssd.service.ts': 1,
  'data-quality/data-quality.service.ts': 5,
  'data-quality/quality-registry.ts': 1,
  'decision-registry/decision.service.ts': 2,
  'dialysis/dialysis.service.ts': 1,
  'document/document.controller.ts': 2,
  'duty-schedule/duty-schedule.controller.ts': 1,
  'duty-schedule/duty-schedule.service.ts': 7,
  'eligibility/eligibility.service.ts': 1,
  'emergency/emergency.service.ts': 4,
  'emergency/er-bed.service.ts': 6,
  'emergency/er-flow-display.controller.ts': 1,
  'emr-cert/emr-cert.service.ts': 1,
  'encounter/draft-chart-reminder.cron.ts': 1,
  'encounter/encounter.service.ts': 2,
  'ess/ess-approval-reminder.cron.ts': 3,
  'ess/ess.service.ts': 11,
  'evidence/evidence-extract.service.ts': 1,
  'fhir-lab/fhir-lab-ingest.service.ts': 2,
  'fhir/fhir.controller.ts': 3, // 2026-09-22: reflex 환자 조회의 `.catch(() => null)` 제거 — MRN/UUID 를 갈라 찾으므로 삼킬 이유가 없다
  'foreign-patient/foreign-patient.service.ts': 2,
  'gld/governance-enactment.service.ts': 2,
  'gld/governance.service.ts': 9,
  'gld/standard-governance.service.ts': 2,
  'go-live/go-live.service.ts': 2,
  'him/him.service.ts': 1,
  'hr/hr.service.ts': 1,
  'i18n/translation.service.ts': 2,
  'imaging/imaging-safety.service.ts': 1,
  'infection-control/infection-control.service.ts': 1,
  'inpatient/handoff-reminder.cron.ts': 1,
  'inpatient/inpatient.service.ts': 1,
  'integration/integration-outbox.service.ts': 1,
  'journey-console/flow-canon.ts': 2,
  'journey-console/journey-console.service.ts': 4,
  'medical-ai/medical-ai.service.ts': 7,
  'medical-ai/patient-brief.service.ts': 4,
  'medical-record-issuance/document-bundle.service.ts': 1,
  'mobile/mobile-config.controller.ts': 3,
  'notification/fcm-push.service.ts': 3,
  'notification/notification.listener.ts': 2,
  'notification/notification.service.ts': 3,
  'notification/patient-push-gate.service.ts': 3,
  'nursing/nursing.service.ts': 1,
  'nutrition/nutrition-advanced.service.ts': 1,
  'onboarding/onboarding.service.ts': 1,
  'opening/opening.service.ts': 1,
  // 2026-10-21 임상 규칙 P2: 이전 판을 가리키는 임상경로 수 조회 실패 → null = 화면 '확인하지 못함'(0 아님 · 3상태 정당)
  'order-set/order-set.service.ts': 1,
  'pacs-proxy/pacs-integration.listener.ts': 2,
  'pacu/pacu.service.ts': 2,
  'partner-request/partner-request.service.ts': 1,
  'patient-auth/guards/portal-or-patient.guard.ts': 1,
  'patient-auth/patient-auth.service.ts': 4,
  'patient-flow/patient-flow.service.ts': 1,
  'patient/patient.controller.ts': 1,
  'pharmacy/pharmacy.service.ts': 1,
  'phase0-cutover/phase0-cutover.service.ts': 1,
  'portal/drug-explain.service.ts': 3,
  'portal/pacs-study-ownership.ts': 1,
  'portal/portal-auth.guard.ts': 2,
  'portal/portal.controller.ts': 5, // 2026-10-19 v4.94.1 썸네일 중계 .catch(() => null) 회수(대표 영상 헬퍼는 실패 = 503 한 자리)
  'portal/portal.service.ts': 3,
  'pre-auth/pre-auth-gate.service.ts': 1,
  'pre-auth/pre-auth.service.ts': 6,
  'pre-order/pre-order.service.ts': 1,
  'protocol/protocol.service.ts': 2,
  'qi/surgery-safety.service.ts': 1,
  'qr/qr.service.ts': 1,
  'questionnaire/questionnaire.service.ts': 3,
  'radiation/radiation.service.ts': 1,
  'rbac-admin/rbac-admin.controller.ts': 2,
  'record-timeline/record-timeline.service.ts': 1,
  'referral-letter/referral-letter.service.ts': 1,
  'registration-consent/registration-consent.service.ts': 1,
  'rehab/rehab.service.ts': 1,
  'remote-consultation/remote-consultation.service.ts': 1,
  'research/research.service.ts': 2,
  'safety-gate/safety-gate.service.ts': 1,
  'satisfaction/satisfaction.service.ts': 3,
  'scribe/scribe.service.ts': 2,
  'sign-integration/sign-integration.service.ts': 8,
  'smart-auth/smart-auth.controller.ts': 1,
  'staff-call/staff-call.service.ts': 1,
  'surgery/surgery-advanced.service.ts': 1,
  'surgery/surgery.service.ts': 1,
  'terminal/terminal-pin.service.ts': 1,
  'terminal/terminal.service.ts': 3,
  'treatment-template/treatment-template.service.ts': 4,
  'triage/triage.service.ts': 2,
  'twin/twin.controller.ts': 3,
  'user/user.service.ts': 1,
  'vitals/vitals.service.ts': 2,
  'voice-emr/stt-chunk.client.ts': 1,
  'voice-emr/voice-emr.service.ts': 8,
  'voucher/distributor-auth.service.ts': 2,
  'waiting-queue/display-box.controller.ts': 1,
  'waiting-queue/queue-display.service.ts': 1,
  'waiting-queue/waiting-queue.service.ts': 1,
  'workstation-setup/print.service.ts': 1,
  'workstation-setup/workstation-setup.service.ts': 1,
};

/**
 * 🔴 **비리터럴 폴백 인벤토리** (2026-09-27 신설) — 위 인벤토리의 **사각**을 덮는다.
 *
 * 위 `CATCH_DEFAULT_BASELINE` 의 정규식은 `null|undefined|[]|0|{}|false` **리터럴만** 센다.
 * 그래서 `.catch(() => ({ count: 0 }))` 같은 모양은 같은 삼킴인데도 **한 번도 세어진 적이 없었고**,
 * 늘어나도 아무 가드가 실패하지 않았다(2026-09-27 billing 성분코드 백필에서 실측 — 09-23 에 보험코드
 * 쌍둥이를 고치며 7줄 아래 이 모양을 지나쳤고, 인벤토리는 그것을 보지 못했다).
 *
 * 세는 모양: `=> ({...})` · `=> ([...])` · `=> ''` · `=> 숫자` · `=> true`
 * 🔴 처음(09-27) 46곳은 **판정한 것이 아니라 동결한 것**이었다. 2026-10-01 한 건씩 판정했다(파일 머리 주석) —
 *    실결함 17 교정 · 남은 29 는 정당 판정이다. 새로 늘면 다시 판정 대상이다(늘지 못하게 하는 동결은 그대로).
 */
export const CATCH_NONLITERAL_BASELINE: Record<string, number> = {
  'clinic-integration/clinic-api.service.ts': 1,
  'crm/crm-cron.service.ts': 1,
  // +1 (2026-10-11 판정: 정당) — 일괄 의사결정의 즉시 집행 `enactDecision(...).catch((e) => ({ error: errOf(e) }))`: 실패를 **그 항목의 결과로 돌려준다**(화면이 "집행 안 됨: 사유"를 그린다 · 없음으로 바꾸는 자리 아님 · 의결은 이미 커밋됐다)
  'decision-registry/decision-bulk.service.ts': 1,
  'emergency/er-bed.service.ts': 1,
  'encounter/draft-chart-reminder.cron.ts': 1,
  'hospital-info/hospital-info.service.ts': 1,
  'integration/integration-outbox.service.ts': 1,
  // 2→3 (2026-10-07 판정: 정당) — AI 429 재시도 전 본문 비우기 `res.text().catch(() => '')`: 내용을 쓰지 않고 연결만 돌려준다(실패해도 다음 재시도가 같은 결과를 말한다 · 실패를 없음으로 바꾸는 자리 아님)
  'medical-ai/medical-ai.service.ts': 3,
  'nutrition/nutrition-advanced.service.ts': 2,
  'onboarding/onboarding.service.ts': 1,
  'patient-auth/services/sms-otp.service.ts': 1,
  'pharmacy/pharmacy.service.ts': 1,
  'portal/portal.controller.ts': 1,
  'qi/surgery-safety.cron.ts': 2,
  'questionnaire/questionnaire-admin.service.ts': 1,
  'scribe/scribe-ai.client.ts': 2,
  'sign-integration/sign-integration.service.ts': 3,
  'transfer/transfer.service.ts': 1,
  'voice-emr/stt-chunk.client.ts': 3,
  'voucher/voucher-email.service.ts': 3,
};
