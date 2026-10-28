-- 초진 등록 동의 증빙 연결(2026-10-02) — 태블릿·휴대폰 서명 묶음 또는 종이 스캔본이 붙은 ConsentForm(REGISTRATION) · null = 증빙 연결 없음
-- AlterTable
ALTER TABLE "registration_consents" ADD COLUMN     "evidence_consent_form_id" UUID;

