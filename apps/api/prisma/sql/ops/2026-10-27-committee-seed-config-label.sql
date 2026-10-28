-- 2026-10-27 위원회 몫 결정 개발 시드가 넣은 설정 행에 개발 시드 표식 — seed.ts 같은 label(기계 대조 test/seed/committee-seed-config-label.spec.ts)
-- 🔴 시드가 넣은 그대로인 행만: label = 키(시드가 넣은 모양) · 값 = 시드 값 · 생성 뒤 한 번도 바뀌지 않음(updated_at = created_at)
--    사람이 바꿨거나 의결이 집행된 행은 건드리지 않는다 · updated_at 을 바꾸지 않는다(raw UPDATE) · 적용: deploy.sh --backup 뒤
BEGIN;
UPDATE system_configs SET label = '개발 시드(DEV-SEED) — 위원회 의결 전' WHERE key = 'qi.docIssuance.slaHours' AND label = 'qi.docIssuance.slaHours' AND updated_at = created_at AND value = '72'::jsonb;
UPDATE system_configs SET label = '개발 시드(DEV-SEED) — 위원회 의결 전' WHERE key = 'doctor.inbox.dueHours' AND label = 'doctor.inbox.dueHours' AND updated_at = created_at AND value = '24'::jsonb;
UPDATE system_configs SET label = '개발 시드(DEV-SEED) — 위원회 의결 전' WHERE key = 'nursing.io.noOutputAlertHours' AND label = 'nursing.io.noOutputAlertHours' AND updated_at = created_at AND value = '6'::jsonb;
UPDATE system_configs SET label = '개발 시드(DEV-SEED) — 위원회 의결 전' WHERE key = 'documents.fee.billingLink' AND label = 'documents.fee.billingLink' AND updated_at = created_at AND value = '"BILLING_ITEM"'::jsonb;
UPDATE system_configs SET label = '개발 시드(DEV-SEED) — 위원회 의결 전' WHERE key = 'notification.patientPush.types.DOCUMENT_READY' AND label = 'notification.patientPush.types.DOCUMENT_READY' AND updated_at = created_at AND value = 'true'::jsonb;
UPDATE system_configs SET label = '개발 시드(DEV-SEED) — 위원회 의결 전' WHERE key = 'notification.patientPush.types.DOCUMENT_REJECTED' AND label = 'notification.patientPush.types.DOCUMENT_REJECTED' AND updated_at = created_at AND value = 'true'::jsonb;
UPDATE system_configs SET label = '개발 시드(DEV-SEED) — 위원회 의결 전' WHERE key = 'location.wifi.autoUnbindOnEnd' AND label = 'location.wifi.autoUnbindOnEnd' AND updated_at = created_at AND value = 'true'::jsonb;
UPDATE system_configs SET label = '개발 시드(DEV-SEED) — 위원회 의결 전' WHERE key = 'nursing.reassessment.autoScheduleOnAdmission' AND label = 'nursing.reassessment.autoScheduleOnAdmission' AND updated_at = created_at AND value = 'true'::jsonb;
UPDATE system_configs SET label = '개발 시드(DEV-SEED) — 위원회 의결 전' WHERE key = 'nursing.initialAssessment.bradenInput' AND label = 'nursing.initialAssessment.bradenInput' AND updated_at = created_at AND value = '"SUBSCORES"'::jsonb;
UPDATE system_configs SET label = '개발 시드(DEV-SEED) — 위원회 의결 전' WHERE key = 'pediatrics.growth.reference' AND label = 'pediatrics.growth.reference' AND updated_at = created_at AND value = '"KDCA_2017"'::jsonb;
UPDATE system_configs SET label = '개발 시드(DEV-SEED) — 위원회 의결 전' WHERE key = 'notification.staffLabResult.enabled' AND label = 'notification.staffLabResult.enabled' AND updated_at = created_at AND value = 'true'::jsonb;
UPDATE system_configs SET label = '개발 시드(DEV-SEED) — 위원회 의결 전' WHERE key = 'er.reassessNotify.enabled' AND label = 'er.reassessNotify.enabled' AND updated_at = created_at AND value = 'true'::jsonb;
UPDATE system_configs SET label = '개발 시드(DEV-SEED) — 위원회 의결 전' WHERE key = 'order.renewal.noEndReviewDays' AND label = 'order.renewal.noEndReviewDays' AND updated_at = created_at AND value = '7'::jsonb;
UPDATE system_configs SET label = '개발 시드(DEV-SEED) — 위원회 의결 전' WHERE key = 'nursing.lateEntry.graceMinutes' AND label = 'nursing.lateEntry.graceMinutes' AND updated_at = created_at AND value = '30'::jsonb;
UPDATE system_configs SET label = '개발 시드(DEV-SEED) — 위원회 의결 전' WHERE key = 'governance.quorumRosterGate' AND label = 'governance.quorumRosterGate' AND updated_at = created_at AND value = '"WARN"'::jsonb;
UPDATE system_configs SET label = '개발 시드(DEV-SEED) — 위원회 의결 전' WHERE key = 'qi.autoMeasure.incidentDenominator' AND label = 'qi.autoMeasure.incidentDenominator' AND updated_at = created_at AND value = '"PATIENT_DAYS"'::jsonb;
UPDATE system_configs SET label = '개발 시드(DEV-SEED) — 위원회 의결 전' WHERE key = 'qi.autoMeasure.enabled' AND label = 'qi.autoMeasure.enabled' AND updated_at = created_at AND value = 'true'::jsonb;
UPDATE system_configs SET label = '개발 시드(DEV-SEED) — 위원회 의결 전' WHERE key = 'qi.deviceDays.source' AND label = 'qi.deviceDays.source' AND updated_at = created_at AND value = '"MANUAL"'::jsonb;
UPDATE system_configs SET label = '개발 시드(DEV-SEED) — 위원회 의결 전' WHERE key = 'qi.autoManual.precedence' AND label = 'qi.autoManual.precedence' AND updated_at = created_at AND value = '"BOTH"'::jsonb;
UPDATE system_configs SET label = '개발 시드(DEV-SEED) — 위원회 의결 전' WHERE key = 'qi.indicator.directEdit' AND label = 'qi.indicator.directEdit' AND updated_at = created_at AND value = '"ALLOW_WITH_REASON"'::jsonb;
UPDATE system_configs SET label = '개발 시드(DEV-SEED) — 위원회 의결 전' WHERE key = 'safety.incident.anonymous' AND label = 'safety.incident.anonymous' AND updated_at = created_at AND value = 'false'::jsonb;
UPDATE system_configs SET label = '개발 시드(DEV-SEED) — 위원회 의결 전' WHERE key = 'safety.harmLevelScale' AND label = 'safety.harmLevelScale' AND updated_at = created_at AND value = '"KOPS"'::jsonb;
UPDATE system_configs SET label = '개발 시드(DEV-SEED) — 위원회 의결 전' WHERE key = 'safety.poa.required' AND label = 'safety.poa.required' AND updated_at = created_at AND value = 'false'::jsonb;
UPDATE system_configs SET label = '개발 시드(DEV-SEED) — 위원회 의결 전' WHERE key = 'accreditation.framework' AND label = 'accreditation.framework' AND updated_at = created_at AND value = '"KOIHA"'::jsonb;
UPDATE system_configs SET label = '개발 시드(DEV-SEED) — 위원회 의결 전' WHERE key = 'notification.patientPush.enabled' AND label = 'notification.patientPush.enabled' AND updated_at = created_at AND value = 'false'::jsonb;
UPDATE system_configs SET label = '개발 시드(DEV-SEED) — 위원회 의결 전' WHERE key = 'ai.evidenceExtract.enabled' AND label = 'ai.evidenceExtract.enabled' AND updated_at = created_at AND value = 'false'::jsonb;
UPDATE system_configs SET label = '개발 시드(DEV-SEED) — 위원회 의결 전' WHERE key = 'governance.decisionConfigGuard' AND label = 'governance.decisionConfigGuard' AND updated_at = created_at AND value = '"WARN"'::jsonb;
COMMIT;
