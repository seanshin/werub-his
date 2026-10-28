-- 스키마 기준선(baseline) — 2026-09-13 상용 릴리즈 T2-1.
-- 생성: prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script (prisma 6.19.3)
-- 🔴 손으로 고치지 않는다. 운영 DB 는 이 파일을 실행하지 않고 `migrate resolve --applied 00000000000001_baseline` 로 표시만 한다
--    (그 전에 운영과 schema.prisma 의 드리프트를 `migrate diff --from-url` 로 확인 — docs/05-reference/sql-inventory.md §운영 적용).
-- 테이블 562 · 인덱스 1,039 · 열거형 61 · 외래키 566.

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'DOCTOR', 'NURSE', 'RECEPTIONIST', 'PHARMACIST', 'LAB_TECH', 'NUTRITION', 'ADMIN_STAFF', 'MEDICAL_RECORDS', 'CHECKUP', 'CRM_MANAGER', 'CRM_STAFF', 'EXECUTIVE', 'READ');

-- CreateEnum
CREATE TYPE "Gender" AS ENUM ('MALE', 'FEMALE', 'OTHER', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "InsuranceType" AS ENUM ('NHI', 'MEDICAID', 'INDUSTRIAL', 'AUTO', 'SELF_PAY');

-- CreateEnum
CREATE TYPE "AppointmentStatus" AS ENUM ('SCHEDULED', 'CONFIRMED', 'CHECKED_IN', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'NO_SHOW');

-- CreateEnum
CREATE TYPE "AppointmentType" AS ENUM ('INITIAL', 'FOLLOW_UP', 'URGENT', 'ROUTINE');

-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('CREATE', 'READ', 'UPDATE', 'DELETE');

-- CreateEnum
CREATE TYPE "EncounterStatus" AS ENUM ('DRAFT', 'SIGNED', 'AMENDED');

-- CreateEnum
CREATE TYPE "PrescriptionType" AS ENUM ('MEDICATION', 'LAB', 'IMAGING', 'THERAPY', 'DIET', 'ACTIVITY', 'NURSING');

-- CreateEnum
CREATE TYPE "PrescriptionStatus" AS ENUM ('ACTIVE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "OrderDepartment" AS ENUM ('PHARMACY', 'LAB', 'IMAGING', 'THERAPY');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('ORDERED', 'RECEIVED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "BillingStatus" AS ENUM ('PENDING', 'PAID', 'PARTIAL', 'CANCELLED', 'DEFERRED', 'REFUNDED', 'INSTALLMENT');

-- CreateEnum
CREATE TYPE "ScribeSessionStatus" AS ENUM ('RECORDING', 'UPLOADED', 'TRANSCRIBING', 'TRANSCRIBED', 'DRAFTED', 'APPLIED', 'FAILED', 'DELETED');

-- CreateEnum
CREATE TYPE "ScribeVoiceProfileStatus" AS ENUM ('ACTIVE', 'REVOKED');

-- CreateEnum
CREATE TYPE "DispensingStatus" AS ENUM ('PENDING', 'DISPENSED', 'VERIFIED', 'ISSUED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "LabResultStatus" AS ENUM ('PENDING', 'COLLECTED', 'IN_PROGRESS', 'COMPLETED', 'VERIFIED');

-- CreateEnum
CREATE TYPE "ImagingResultStatus" AS ENUM ('ORDERED', 'ACQUIRED', 'REPORTED');

-- CreateEnum
CREATE TYPE "ClaimStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'PARTIALLY_APPROVED', 'REJECTED', 'PAID');

-- CreateEnum
CREATE TYPE "AdmissionStatus" AS ENUM ('ADMITTED', 'TRANSFERRED', 'DISCHARGED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "BedStatus" AS ENUM ('AVAILABLE', 'OCCUPIED', 'RESERVED', 'MAINTENANCE', 'CLEANING', 'ISOLATION');

-- CreateEnum
CREATE TYPE "SurgeryStatus" AS ENUM ('SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "Laterality" AS ENUM ('LEFT', 'RIGHT', 'BILATERAL', 'MIDLINE', 'NA');

-- CreateEnum
CREATE TYPE "KtasLevel" AS ENUM ('LEVEL_1', 'LEVEL_2', 'LEVEL_3', 'LEVEL_4', 'LEVEL_5');

-- CreateEnum
CREATE TYPE "EmergencyDisposition" AS ENUM ('DISCHARGE', 'ADMISSION', 'TRANSFER', 'DEATH', 'LEAVE_AMA', 'OBSERVATION', 'SURGERY');

-- CreateEnum
CREATE TYPE "InventoryTxType" AS ENUM ('IN', 'OUT', 'ADJUST', 'RETURN', 'TRANSFER', 'ISSUE', 'RECEIVE', 'DISPOSAL', 'EXPIRED');

-- CreateEnum
CREATE TYPE "SterilizationStatus" AS ENUM ('DIRTY', 'WASHING', 'STERILIZING', 'STERILE', 'EXPIRED', 'IN_USE');

-- CreateEnum
CREATE TYPE "EmploymentStatus" AS ENUM ('ACTIVE', 'ON_LEAVE', 'RESIGNED', 'RETIRED');

-- CreateEnum
CREATE TYPE "StaffCategory" AS ENUM ('MEDICAL', 'TECHNICAL', 'ADMIN', 'SUPPORT');

-- CreateEnum
CREATE TYPE "EquipmentStatus" AS ENUM ('ACTIVE', 'UNDER_MAINTENANCE', 'BROKEN', 'RETIRED');

-- CreateEnum
CREATE TYPE "BotTriggerType" AS ENUM ('RESOURCE_CREATED', 'RESOURCE_UPDATED', 'RESOURCE_DELETED', 'SCHEDULE', 'MANUAL');

-- CreateEnum
CREATE TYPE "BotStatus" AS ENUM ('ACTIVE', 'DISABLED', 'ERROR');

-- CreateEnum
CREATE TYPE "ConsentType" AS ENUM ('SURGERY', 'PROCEDURE', 'ANESTHESIA', 'RESEARCH', 'TRANSFUSION', 'DNR', 'TREATMENT', 'GENERAL', 'RECORDING');

-- CreateEnum
CREATE TYPE "ConsentStatus" AS ENUM ('PENDING', 'SIGNED', 'EXPIRED', 'REVOKED');

-- CreateEnum
CREATE TYPE "ProblemStatus" AS ENUM ('ACTIVE', 'CHRONIC', 'RESOLVED', 'INACTIVE');

-- CreateEnum
CREATE TYPE "ProblemSeverity" AS ENUM ('MILD', 'MODERATE', 'SEVERE');

-- CreateEnum
CREATE TYPE "AllergyType" AS ENUM ('DRUG', 'FOOD', 'ENVIRONMENTAL', 'LATEX', 'OTHER');

-- CreateEnum
CREATE TYPE "AllergySeverity" AS ENUM ('MILD', 'MODERATE', 'SEVERE', 'LIFE_THREATENING');

-- CreateEnum
CREATE TYPE "AllergyVerification" AS ENUM ('CONFIRMED', 'UNCONFIRMED', 'REFUTED', 'ENTERED_IN_ERROR');

-- CreateEnum
CREATE TYPE "AllergyAssessmentResult" AS ENUM ('NO_KNOWN_ALLERGIES', 'HAS_ALLERGIES', 'UNABLE_TO_ASSESS');

-- CreateEnum
CREATE TYPE "IsolationPrecautionType" AS ENUM ('STANDARD', 'CONTACT', 'DROPLET', 'AIRBORNE', 'PROTECTIVE', 'STRICT');

-- CreateEnum
CREATE TYPE "IsolationPrecautionStatus" AS ENUM ('ACTIVE', 'DISCONTINUED');

-- CreateEnum
CREATE TYPE "RefRangeSex" AS ENUM ('ANY', 'MALE', 'FEMALE');

-- CreateEnum
CREATE TYPE "DischargeSummaryStatus" AS ENUM ('DRAFT', 'SIGNED', 'AMENDED');

-- CreateEnum
CREATE TYPE "NursingDiagnosisStatus" AS ENUM ('ACTIVE', 'RESOLVED');

-- CreateEnum
CREATE TYPE "NursingNoteType" AS ENUM ('FOCUS', 'NARRATIVE', 'DAR', 'SOAP', 'DARE', 'SBAR');

-- CreateEnum
CREATE TYPE "ShiftType" AS ENUM ('DAY', 'EVENING', 'NIGHT');

-- CreateEnum
CREATE TYPE "IntakeType" AS ENUM ('ORAL', 'IV', 'OTHER');

-- CreateEnum
CREATE TYPE "OutputType" AS ENUM ('URINE', 'DRAIN', 'EMESIS', 'OTHER');

-- CreateEnum
CREATE TYPE "MedAdminStatus" AS ENUM ('SCHEDULED', 'ADMINISTERED', 'HELD', 'REFUSED', 'MISSED');

-- CreateEnum
CREATE TYPE "CodeBlueOutcome" AS ENUM ('ONGOING', 'ROSC', 'DEATH', 'TRANSFER');

-- CreateEnum
CREATE TYPE "RrtTrigger" AS ENUM ('NEWS2', 'DIRECT_CALL', 'FAMILY', 'OTHER');

-- CreateEnum
CREATE TYPE "RrtOutcome" AS ENUM ('ONGOING', 'WARD_STAY', 'ICU_TRANSFER', 'CODE_BLUE', 'DECEASED');

-- CreateEnum
CREATE TYPE "AdmissionLegalType" AS ENUM ('VOLUNTARY', 'CONSENT', 'GUARDIAN', 'ADMINISTRATIVE', 'EMERGENCY');

-- CreateEnum
CREATE TYPE "PsychAdmissionStatus" AS ENUM ('ACTIVE', 'DISCHARGED', 'CONVERTED');

-- CreateEnum
CREATE TYPE "CompoundingStatus" AS ENUM ('ORDERED', 'CALCULATED', 'IN_PREP', 'COMPOUNDED', 'VERIFIED', 'RELEASED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "VoiceSessionStatus" AS ENUM ('ACTIVE', 'CLOSED', 'ABORTED');

-- CreateEnum
CREATE TYPE "VoiceMode" AS ENUM ('READ', 'DICTATE', 'COMMAND');

-- CreateEnum
CREATE TYPE "VoicePhraseType" AS ENUM ('ALIAS', 'HABIT', 'VOCAB', 'MACRO');

-- CreateEnum
CREATE TYPE "AiProposalStatus" AS ENUM ('GENERATED', 'PRESENTED', 'ACCEPTED', 'EDITED', 'REJECTED', 'EXPIRED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "AiProposalSource" AS ENUM ('AI', 'FALLBACK', 'UNAVAILABLE');

-- CreateEnum
CREATE TYPE "TranslationOverrideStatus" AS ENUM ('PROPOSED', 'APPROVED', 'REJECTED', 'MERGED');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "password_hash" VARCHAR(255) NOT NULL,
    "family_name" VARCHAR(100) NOT NULL,
    "given_name" VARCHAR(100) NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'NURSE',
    "department" VARCHAR(50),
    "specialty" VARCHAR(100),
    "signature_image" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "account_stage" VARCHAR(12) NOT NULL DEFAULT 'ACTIVE',
    "last_login_at" TIMESTAMPTZ,
    "password_changed_at" TIMESTAMPTZ,
    "sign_cert_serial" VARCHAR(64),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_dashboard_configs" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "config" JSONB NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_dashboard_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dashboard_templates" (
    "id" UUID NOT NULL,
    "scope" VARCHAR(20) NOT NULL,
    "scope_ref" VARCHAR(50) NOT NULL,
    "config" JSONB NOT NULL,
    "updated_by" UUID NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dashboard_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consult_sessions" (
    "id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "status" VARCHAR(12) NOT NULL DEFAULT 'OPEN',
    "locale" VARCHAR(10) NOT NULL DEFAULT 'ko',
    "category" VARCHAR(20),
    "team_id" UUID,
    "ai_mode" VARCHAR(8) NOT NULL DEFAULT 'AUTO',
    "assignee_id" UUID,
    "priority" VARCHAR(8) NOT NULL DEFAULT 'NORMAL',
    "escalation_level" INTEGER NOT NULL DEFAULT 0,
    "escalated_at" TIMESTAMP(3),
    "escalated_to_id" UUID,
    "lead_escalated_at" TIMESTAMP(3),
    "escalation_reason" VARCHAR(300),
    "first_response_at" TIMESTAMP(3),
    "jitsi_room" VARCHAR(60),
    "video_started_at" TIMESTAMP(3),
    "rating" INTEGER,
    "rating_comment" VARCHAR(500),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "consult_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consult_messages" (
    "id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "sender" VARCHAR(10) NOT NULL,
    "sender_id" UUID,
    "visibility" VARCHAR(10) NOT NULL DEFAULT 'PATIENT',
    "content" TEXT NOT NULL,
    "content_ko" TEXT,
    "attachment_url" VARCHAR(500),
    "lang" VARCHAR(10),
    "read_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consult_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consult_teams" (
    "id" UUID NOT NULL,
    "name" VARCHAR(40) NOT NULL,
    "description" VARCHAR(200),
    "categories" JSONB,
    "locales" JSONB,
    "default_ai_mode" VARCHAR(8) NOT NULL DEFAULT 'AUTO',
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "consult_teams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consult_agents" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "team_id" UUID,
    "role" VARCHAR(8) NOT NULL,
    "status" VARCHAR(8) NOT NULL DEFAULT 'OFFLINE',
    "skills" JSONB,
    "max_concurrent" INTEGER NOT NULL DEFAULT 5,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "consult_agents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "translations" (
    "id" UUID NOT NULL,
    "hash" TEXT NOT NULL,
    "source_lang" VARCHAR(10) NOT NULL,
    "target_lang" VARCHAR(10) NOT NULL,
    "source_text" TEXT NOT NULL,
    "translated" TEXT NOT NULL,
    "engine" VARCHAR(40) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "translations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "non_covered_items" (
    "id" UUID NOT NULL,
    "code" VARCHAR(30) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "category" VARCHAR(20) NOT NULL,
    "price" INTEGER NOT NULL,
    "description" VARCHAR(500),
    "requiresConsent" BOOLEAN NOT NULL DEFAULT true,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "non_covered_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "patients" (
    "id" UUID NOT NULL,
    "mrn" VARCHAR(50) NOT NULL,
    "fhir_id" VARCHAR(100),
    "family_name" VARCHAR(100) NOT NULL,
    "given_name" VARCHAR(100) NOT NULL,
    "date_of_birth" DATE NOT NULL,
    "gender" "Gender" NOT NULL,
    "insurance_type" "InsuranceType" NOT NULL DEFAULT 'NHI',
    "insurance_number" VARCHAR(255),
    "income_decile" INTEGER,
    "phone" VARCHAR(20),
    "phone_normalized" VARCHAR(20),
    "email" VARCHAR(255),
    "address" JSONB,
    "ci" VARCHAR(200),
    "national_id" VARCHAR(200),
    "national_id_type" VARCHAR(20),
    "national_id_hash" VARCHAR(64),
    "photo_url" VARCHAR(500),
    "nationality" VARCHAR(50) DEFAULT 'KR',
    "preferred_language" VARCHAR(10) DEFAULT 'ko',
    "passport_number" VARCHAR(200),
    "passport_number_hash" VARCHAR(64),
    "alien_registration_no" VARCHAR(200),
    "alien_registration_no_hash" VARCHAR(64),
    "name_en" VARCHAR(200),
    "korean_name" VARCHAR(100),
    "passport_expiry" DATE,
    "visa_type" VARCHAR(20),
    "patient_source" VARCHAR(20),
    "source_org_id" UUID,
    "external_patient_id" VARCHAR(100),
    "travel_insurance" JSONB,
    "embassy_contact" VARCHAR(200),
    "interpreter_needed" BOOLEAN NOT NULL DEFAULT false,
    "deposit_required" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "archived_at" TIMESTAMPTZ,
    "attachments" JSONB,
    "marital_status" VARCHAR(20),
    "occupation" VARCHAR(100),
    "smoking_status" VARCHAR(12),
    "religion" VARCHAR(50),
    "death_date" TIMESTAMPTZ,
    "death_cause" VARCHAR(500),
    "is_deceased" BOOLEAN NOT NULL DEFAULT false,
    "death_location" VARCHAR(20),
    "death_type" VARCHAR(20),
    "death_cause_chain" JSONB,
    "death_confirmed_by" UUID,
    "death_confirmed_at" TIMESTAMPTZ,
    "memo" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "merged_into_id" UUID,
    "crm_score" INTEGER DEFAULT 0,
    "last_contact_at" TIMESTAMPTZ,
    "churn_risk" VARCHAR(10),
    "rfm_segment" VARCHAR(20),
    "preferred_channel" VARCHAR(20),
    "blood_type" VARCHAR(5),
    "allergies" JSONB NOT NULL DEFAULT '[]',
    "valid_from" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "valid_to" TIMESTAMPTZ,
    "sign_cert_serial" VARCHAR(64),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "created_by" UUID NOT NULL,
    "updated_by" UUID NOT NULL,

    CONSTRAINT "patients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "patient_history" (
    "id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "data" JSONB NOT NULL,
    "valid_from" TIMESTAMPTZ NOT NULL,
    "valid_to" TIMESTAMPTZ NOT NULL,
    "tx_time" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "changed_by" UUID NOT NULL,

    CONSTRAINT "patient_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "patient_contacts" (
    "id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "relationship" VARCHAR(30) NOT NULL,
    "relationship_detail" VARCHAR(50),
    "name" VARCHAR(100) NOT NULL,
    "phone" VARCHAR(20) NOT NULL,
    "phone2" VARCHAR(20),
    "is_emergency_contact" BOOLEAN NOT NULL DEFAULT false,
    "is_legal_guardian" BOOLEAN NOT NULL DEFAULT false,
    "is_primary_contact" BOOLEAN NOT NULL DEFAULT false,
    "priority" INTEGER NOT NULL DEFAULT 1,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "patient_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "family_histories" (
    "id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "relation" VARCHAR(20) NOT NULL,
    "diagnosis_code_id" UUID,
    "condition_name" VARCHAR(200) NOT NULL,
    "onset_age" INTEGER,
    "is_deceased" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "recorded_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "family_histories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "patient_relations" (
    "id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "related_id" UUID NOT NULL,
    "relationship" VARCHAR(30) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "patient_relations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "appointments" (
    "id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "doctor_id" UUID NOT NULL,
    "scheduled_at" TIMESTAMPTZ NOT NULL,
    "duration" INTEGER NOT NULL DEFAULT 30,
    "status" "AppointmentStatus" NOT NULL DEFAULT 'SCHEDULED',
    "type" "AppointmentType" NOT NULL DEFAULT 'INITIAL',
    "reason" TEXT,
    "notes" TEXT,
    "department_name" VARCHAR(100),
    "room_name" VARCHAR(100),
    "slot_period" VARCHAR(10),
    "booked_via" VARCHAR(20),
    "priority" INTEGER DEFAULT 0,
    "no_show_at" TIMESTAMPTZ,
    "rescheduled_from_id" UUID,
    "recurring_group_id" UUID,
    "reminder_sent_at" TIMESTAMPTZ,
    "confirmed_at" TIMESTAMPTZ,
    "confirmed_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "created_by" UUID,
    "cancelled_at" TIMESTAMPTZ,
    "cancelled_by" UUID,
    "cancel_reason" TEXT,

    CONSTRAINT "appointments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "appointment_waitlists" (
    "id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "doctor_id" UUID,
    "department_name" VARCHAR(100) NOT NULL,
    "preferred_from" TIMESTAMPTZ,
    "preferred_to" TIMESTAMPTZ,
    "status" VARCHAR(20) NOT NULL DEFAULT 'WAITING',
    "notified_at" TIMESTAMPTZ,
    "note" TEXT,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "appointment_waitlists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "action" "AuditAction" NOT NULL,
    "resource_type" VARCHAR(50) NOT NULL,
    "resource_id" UUID NOT NULL,
    "changes" JSONB,
    "ip_address" VARCHAR(45),
    "user_agent" TEXT,
    "timestamp" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "diagnosis_codes" (
    "id" UUID NOT NULL,
    "code_system" VARCHAR(20) NOT NULL DEFAULT 'KCD-8',
    "code" VARCHAR(20) NOT NULL,
    "name_ko" VARCHAR(500) NOT NULL,
    "name_en" VARCHAR(500),
    "category" VARCHAR(100),
    "not_primary" BOOLEAN NOT NULL DEFAULT false,
    "sex_restriction" VARCHAR(1),
    "age_min" INTEGER,
    "age_max" INTEGER,
    "chapter" VARCHAR(10),
    "parent_code" VARCHAR(20),
    "icd10_code" VARCHAR(20),
    "icd11_code" VARCHAR(20),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "valid_from" DATE NOT NULL,
    "valid_to" DATE,
    "origin" VARCHAR(10),
    "successor_code" VARCHAR(20),
    "retired_reason" VARCHAR(300),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "diagnosis_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "procedure_codes" (
    "id" UUID NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "name_ko" VARCHAR(500) NOT NULL,
    "loinc_code" VARCHAR(20),
    "category" VARCHAR(100),
    "modality" VARCHAR(10),
    "uses_contrast" BOOLEAN NOT NULL DEFAULT false,
    "unit_price" INTEGER,
    "insurance_covered" BOOLEAN NOT NULL DEFAULT true,
    "copay_rate" DECIMAL(5,4),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "valid_from" DATE NOT NULL,
    "valid_to" DATE,
    "origin" VARCHAR(10),
    "category_source" VARCHAR(20),
    "gazette_class" VARCHAR(40),
    "successor_code" VARCHAR(20),
    "retired_reason" VARCHAR(300),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "procedure_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "medication_codes" (
    "id" UUID NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "name_ko" VARCHAR(500) NOT NULL,
    "name_en" VARCHAR(500),
    "category" VARCHAR(100),
    "ingredient" VARCHAR(500),
    "ingredient_code" VARCHAR(20),
    "manufacturer" VARCHAR(200),
    "dosage_form" VARCHAR(100),
    "unit" VARCHAR(50),
    "insurance_code" VARCHAR(20),
    "unit_price" INTEGER,
    "barcode" VARCHAR(50),
    "control_schedule" VARCHAR(5),
    "narcotic_type" VARCHAR(20),
    "psychotropic_group" VARCHAR(10),
    "storage_condition" VARCHAR(10),
    "high_alert_flag" BOOLEAN NOT NULL DEFAULT false,
    "high_alert_category" VARCHAR(50),
    "pregnancy_category" VARCHAR(4),
    "lasa_group" VARCHAR(30),
    "asp_restricted_level" VARCHAR(20),
    "max_single_dose" DECIMAL(10,2),
    "max_daily_dose" DECIMAL(10,2),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "valid_from" DATE NOT NULL,
    "valid_to" DATE,
    "origin" VARCHAR(10),
    "successor_code" VARCHAR(20),
    "retired_reason" VARCHAR(300),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "medication_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asp_requests" (
    "id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "prescription_id" UUID,
    "encounter_id" UUID,
    "antimicrobial_name" VARCHAR(200) NOT NULL,
    "restricted_level" VARCHAR(20),
    "indication" TEXT NOT NULL,
    "duration" INTEGER,
    "duration_unit" VARCHAR(20),
    "requested_by" UUID NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    "reviewed_by" UUID,
    "reviewed_at" TIMESTAMPTZ,
    "review_comment" TEXT,
    "requested_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "asp_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "code_synonyms" (
    "id" UUID NOT NULL,
    "source_table" VARCHAR(40) NOT NULL,
    "code" VARCHAR(20),
    "code_key" VARCHAR(20) NOT NULL DEFAULT '',
    "code_system" VARCHAR(20),
    "term" VARCHAR(120) NOT NULL,
    "term_norm" VARCHAR(120) NOT NULL,
    "expands_to" VARCHAR(200),
    "kind" VARCHAR(20) NOT NULL,
    "status" VARCHAR(12) NOT NULL DEFAULT 'PROPOSED',
    "note" VARCHAR(300),
    "proposed_by" UUID,
    "reviewed_by" UUID,
    "reviewed_at" TIMESTAMPTZ,
    "review_note" VARCHAR(300),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "code_synonyms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lab_test_codes" (
    "id" UUID NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "loinc_code" VARCHAR(20),
    "name_ko" VARCHAR(200) NOT NULL,
    "name_en" VARCHAR(200),
    "category" VARCHAR(50) NOT NULL,
    "specimen" VARCHAR(50),
    "unit" VARCHAR(30),
    "ref_range_male" VARCHAR(50),
    "ref_range_female" VARCHAR(50),
    "turnaround_min" INTEGER,
    "edi_code" VARCHAR(20),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lab_test_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "medication_routes" (
    "id" UUID NOT NULL,
    "code" VARCHAR(10) NOT NULL,
    "name_ko" VARCHAR(50) NOT NULL,
    "name_en" VARCHAR(50),
    "snomed_code" VARCHAR(20),
    "description" VARCHAR(200),
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "medication_routes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "department_codes" (
    "id" UUID NOT NULL,
    "code" VARCHAR(10) NOT NULL,
    "name_ko" VARCHAR(50) NOT NULL,
    "name_en" VARCHAR(50),
    "category" VARCHAR(20) NOT NULL,
    "parent_code" VARCHAR(10),
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "department_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "surgery_anesthesia_codes" (
    "id" UUID NOT NULL,
    "code_type" VARCHAR(20) NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "name_ko" VARCHAR(100) NOT NULL,
    "name_en" VARCHAR(100),
    "description" VARCHAR(300),
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "surgery_anesthesia_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "procedure_fees" (
    "id" UUID NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "gazette_class" VARCHAR(40),
    "name_ko" VARCHAR(500),
    "name_en" VARCHAR(500),
    "benefit_type" VARCHAR(20),
    "domain" VARCHAR(20),
    "price_clinic" INTEGER,
    "price_hospital" INTEGER,
    "price_dental" INTEGER,
    "price_health_ctr" INTEGER,
    "price_midwife" INTEGER,
    "price_oriental" INTEGER,
    "price_nursing" INTEGER,
    "rvu" DECIMAL(12,2),
    "copay_50" BOOLEAN NOT NULL DEFAULT false,
    "copay_80" BOOLEAN NOT NULL DEFAULT false,
    "copay_90" BOOLEAN NOT NULL DEFAULT false,
    "duplicate_ok" VARCHAR(5),
    "calc_name" VARCHAR(300),
    "is_surgery" VARCHAR(5),
    "applied_on" DATE,
    "valid_from" DATE NOT NULL,
    "valid_to" DATE,
    "dataset_id" UUID NOT NULL,

    CONSTRAINT "procedure_fees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "drug_prices" (
    "id" UUID NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "name_ko" VARCHAR(300),
    "price" INTEGER,
    "ingredient_code" VARCHAR(30),
    "route" VARCHAR(20),
    "spec" VARCHAR(60),
    "unit" VARCHAR(40),
    "manufacturer" VARCHAR(200),
    "class_no" VARCHAR(20),
    "note" VARCHAR(60),
    "valid_from" DATE NOT NULL,
    "valid_to" DATE,
    "dataset_id" UUID NOT NULL,

    CONSTRAINT "drug_prices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "drg_separate_billings" (
    "id" UUID NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "gazette_class" VARCHAR(40),
    "name" VARCHAR(300),
    "calc_name" VARCHAR(300),
    "rate" VARCHAR(20),
    "benefit_type" VARCHAR(20),
    "valid_from" DATE,
    "valid_to" DATE,
    "dataset_id" UUID NOT NULL,

    CONSTRAINT "drg_separate_billings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "drg_severity_scores" (
    "id" UUID NOT NULL,
    "diagnosis_code" VARCHAR(10) NOT NULL,
    "score" INTEGER NOT NULL,
    "dataset_id" UUID NOT NULL,

    CONSTRAINT "drg_severity_scores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "drg_zero_score_rules" (
    "id" UUID NOT NULL,
    "other_diagnosis" VARCHAR(10) NOT NULL,
    "main_diagnoses" TEXT[],
    "dataset_id" UUID NOT NULL,

    CONSTRAINT "drg_zero_score_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reference_datasets" (
    "id" UUID NOT NULL,
    "kind" VARCHAR(30) NOT NULL,
    "effective_date" DATE NOT NULL,
    "source_name" VARCHAR(300) NOT NULL,
    "file_name" VARCHAR(300),
    "content_hash" VARCHAR(64),
    "row_count" INTEGER NOT NULL DEFAULT 0,
    "applied_count" INTEGER NOT NULL DEFAULT 0,
    "skipped_count" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "imported_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "imported_by" UUID NOT NULL,

    CONSTRAINT "reference_datasets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "drug_barcodes" (
    "id" UUID NOT NULL,
    "standard_code" VARCHAR(14) NOT NULL,
    "representative_code" VARCHAR(14),
    "edi_code" VARCHAR(20),
    "medication_code_id" UUID,
    "product_name" VARCHAR(300),
    "maker" VARCHAR(200),
    "package_spec" VARCHAR(200),
    "check_digit_valid" BOOLEAN NOT NULL DEFAULT true,
    "dataset_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "drug_barcodes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "terminology_mappings" (
    "id" UUID NOT NULL,
    "source_table" VARCHAR(30) NOT NULL,
    "source_id" UUID NOT NULL,
    "source_code" VARCHAR(20) NOT NULL,
    "target_system" VARCHAR(20) NOT NULL,
    "target_code" VARCHAR(30) NOT NULL,
    "target_display" VARCHAR(500) NOT NULL,
    "target_version" VARCHAR(20),
    "equivalence" VARCHAR(20) NOT NULL DEFAULT 'equivalent',
    "map_source" VARCHAR(20) NOT NULL DEFAULT 'MANUAL',
    "confidence" DECIMAL(3,2),
    "notes" TEXT,
    "valid_from" DATE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "valid_to" DATE,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "terminology_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "nursing_codes" (
    "id" UUID NOT NULL,
    "code_system" VARCHAR(10) NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "name_ko" VARCHAR(200) NOT NULL,
    "name_en" VARCHAR(200),
    "domain" VARCHAR(50),
    "class" VARCHAR(50),
    "definition" TEXT,
    "indicators" JSONB,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "nursing_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pending_mappings" (
    "id" UUID NOT NULL,
    "source_table" VARCHAR(30) NOT NULL,
    "source_id" UUID NOT NULL,
    "source_code" VARCHAR(20) NOT NULL,
    "source_name" VARCHAR(500) NOT NULL,
    "target_system" VARCHAR(20) NOT NULL,
    "candidates" JSONB NOT NULL,
    "best_candidate" VARCHAR(30),
    "best_confidence" DECIMAL(3,2),
    "status" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    "reviewed_by" UUID,
    "reviewed_at" TIMESTAMPTZ,
    "review_notes" TEXT,
    "selected_code" VARCHAR(30),
    "mapping_id" UUID,
    "batch_id" UUID,
    "clinical_status" VARCHAR(20) NOT NULL DEFAULT 'AWAITING',
    "clinical_reviewed_by" UUID,
    "clinical_reviewed_at" TIMESTAMPTZ,
    "clinical_notes" TEXT,
    "clinical_reviewer_role" VARCHAR(20),
    "assigned_dept" VARCHAR(50),
    "priority" VARCHAR(10) NOT NULL DEFAULT 'NORMAL',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '30 days',

    CONSTRAINT "pending_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mapping_batch_jobs" (
    "id" UUID NOT NULL,
    "source_table" VARCHAR(30) NOT NULL,
    "target_system" VARCHAR(20) NOT NULL,
    "filter" VARCHAR(50) NOT NULL,
    "total_codes" INTEGER NOT NULL,
    "processed_codes" INTEGER NOT NULL DEFAULT 0,
    "confirmed_count" INTEGER NOT NULL DEFAULT 0,
    "pending_count" INTEGER NOT NULL DEFAULT 0,
    "not_applicable_count" INTEGER NOT NULL DEFAULT 0,
    "no_candidate_count" INTEGER NOT NULL DEFAULT 0,
    "error_count" INTEGER NOT NULL DEFAULT 0,
    "failed_count" INTEGER NOT NULL DEFAULT 0,
    "status" VARCHAR(20) NOT NULL DEFAULT 'QUEUED',
    "started_at" TIMESTAMPTZ,
    "completed_at" TIMESTAMPTZ,
    "created_by" UUID NOT NULL,
    "error_log" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mapping_batch_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mapping_audit_logs" (
    "id" UUID NOT NULL,
    "mapping_id" UUID NOT NULL,
    "action" VARCHAR(20) NOT NULL,
    "previous_data" JSONB,
    "new_data" JSONB,
    "reason" TEXT,
    "performed_by" UUID,
    "performed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mapping_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "encounters" (
    "id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "doctor_id" UUID NOT NULL,
    "appointment_id" UUID,
    "admission_id" UUID,
    "visit_type" VARCHAR(30),
    "subjective" TEXT,
    "objective" TEXT,
    "assessment" TEXT,
    "plan" TEXT,
    "chief_complaint" TEXT,
    "hpi" TEXT,
    "pmh" TEXT,
    "family_history" TEXT,
    "social_history" JSONB,
    "ros" JSONB,
    "pe" JSONB,
    "status" "EncounterStatus" NOT NULL DEFAULT 'DRAFT',
    "signed_at" TIMESTAMPTZ,
    "signed_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "pregnancy_status" VARCHAR(16),
    "eligibility_check_id" UUID,
    "ai_scribed" BOOLEAN NOT NULL DEFAULT false,
    "scribe_session_id" UUID,
    "ai_edit_distance" INTEGER,

    CONSTRAINT "encounters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "encounter_attachments" (
    "id" UUID NOT NULL,
    "encounter_id" UUID NOT NULL,
    "kind" VARCHAR(16) NOT NULL DEFAULT 'SKETCH',
    "url" TEXT NOT NULL,
    "mime_type" VARCHAR(64) NOT NULL,
    "note" TEXT,
    "uploaded_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "encounter_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scribe_sessions" (
    "id" UUID NOT NULL,
    "encounter_id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "doctor_id" UUID NOT NULL,
    "consent_id" UUID,
    "status" "ScribeSessionStatus" NOT NULL DEFAULT 'RECORDING',
    "source" VARCHAR(16) NOT NULL DEFAULT 'RECORDING',
    "audio_path" TEXT,
    "audio_deleted_at" TIMESTAMPTZ,
    "legal_hold" BOOLEAN NOT NULL DEFAULT false,
    "transcript" JSONB,
    "stt_tier" VARCHAR(16),
    "resolver_kind" VARCHAR(16),
    "job_id" VARCHAR(64),
    "draft_snapshot" JSONB,
    "ai_model" VARCHAR(64),
    "ai_prompt_version" VARCHAR(32),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "scribe_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "voice_utterances" (
    "id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "seq" INTEGER NOT NULL,
    "started_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "text" TEXT NOT NULL,
    "edited_text" TEXT,
    "speaker" VARCHAR(12) NOT NULL DEFAULT 'UNKNOWN',
    "speaker_source" VARCHAR(12) NOT NULL DEFAULT 'HEURISTIC',
    "confidence" DOUBLE PRECISION,
    "dropped_sec" DOUBLE PRECISION,
    "deleted" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "voice_utterances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scribe_voice_profiles" (
    "id" UUID NOT NULL,
    "doctor_id" UUID NOT NULL,
    "embedding" JSONB,
    "sample_count" INTEGER NOT NULL DEFAULT 0,
    "consent_at" TIMESTAMPTZ NOT NULL,
    "status" "ScribeVoiceProfileStatus" NOT NULL DEFAULT 'ACTIVE',
    "revoked_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "scribe_voice_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "concierge_sessions" (
    "id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    "started_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closed_at" TIMESTAMPTZ,
    "last_active_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rating" INTEGER,
    "rating_comment" VARCHAR(500),

    CONSTRAINT "concierge_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "concierge_messages" (
    "id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "role" VARCHAR(10) NOT NULL,
    "content" TEXT NOT NULL,
    "intent" VARCHAR(30),
    "rich_data" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "concierge_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consultations" (
    "id" UUID NOT NULL,
    "encounter_id" UUID NOT NULL,
    "requesting_doctor_id" UUID NOT NULL,
    "to_department" VARCHAR(50) NOT NULL,
    "to_doctor_id" UUID,
    "reason" TEXT NOT NULL,
    "clinical_question" TEXT,
    "urgency" VARCHAR(20) NOT NULL DEFAULT 'ROUTINE',
    "reply_doctor_id" UUID,
    "reply_content" TEXT,
    "replied_at" TIMESTAMPTZ,
    "recommendations" TEXT,
    "status" VARCHAR(20) NOT NULL DEFAULT 'REQUESTED',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consultations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "referral_letters" (
    "id" UUID NOT NULL,
    "type" VARCHAR(30) NOT NULL,
    "consultation_id" UUID,
    "transfer_id" UUID,
    "encounter_id" UUID,
    "patient_id" UUID NOT NULL,
    "from_department" VARCHAR(50) NOT NULL,
    "from_doctor_id" UUID NOT NULL,
    "to_department" VARCHAR(50) NOT NULL,
    "to_doctor_id" UUID,
    "urgency" VARCHAR(20) NOT NULL DEFAULT 'ROUTINE',
    "content" TEXT NOT NULL,
    "ai_draft" TEXT,
    "ai_model" VARCHAR(50),
    "edited_by_doctor" BOOLEAN NOT NULL DEFAULT false,
    "patient_snapshot" JSONB,
    "status" VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
    "signed_at" TIMESTAMPTZ,
    "signed_by" UUID,
    "rejection_reason" TEXT,
    "expires_at" TIMESTAMPTZ,
    "pdf_url" VARCHAR(500),
    "letter_number" VARCHAR(30),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "referral_letters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "encounter_diagnoses" (
    "id" UUID NOT NULL,
    "encounter_id" UUID NOT NULL,
    "diagnosis_code_id" UUID NOT NULL,
    "type" VARCHAR(20) NOT NULL DEFAULT 'PRIMARY',
    "rank" INTEGER NOT NULL DEFAULT 1,
    "certainty" VARCHAR(20),
    "onset_date" DATE,
    "notes" TEXT,

    CONSTRAINT "encounter_diagnoses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prescriptions" (
    "id" UUID NOT NULL,
    "encounter_id" UUID NOT NULL,
    "type" "PrescriptionType" NOT NULL,
    "medication_code_id" UUID,
    "procedure_code_id" UUID,
    "dosage" VARCHAR(100),
    "frequency" VARCHAR(100),
    "duration" INTEGER,
    "quantity" INTEGER,
    "route" VARCHAR(50),
    "dur_checked" BOOLEAN NOT NULL DEFAULT false,
    "dur_warnings" JSONB,
    "dur_overridden" BOOLEAN NOT NULL DEFAULT false,
    "dur_override_reason" TEXT,
    "dur_override_by" UUID,
    "dur_override_at" TIMESTAMPTZ,
    "instructions" TEXT,
    "priority" VARCHAR(20) NOT NULL DEFAULT 'ROUTINE',
    "source" VARCHAR(30),
    "dispensing_type" VARCHAR(10) NOT NULL DEFAULT 'INTERNAL',
    "rx_valid_until" TIMESTAMPTZ,
    "order_source" VARCHAR(15) NOT NULL DEFAULT 'WRITTEN',
    "read_back_confirmed_at" TIMESTAMPTZ,
    "read_back_confirmed_by" UUID,
    "status" "PrescriptionStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "prescriber_id" UUID,
    "diagnosis_code_id" UUID,

    CONSTRAINT "prescriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orders" (
    "id" UUID NOT NULL,
    "prescription_id" UUID NOT NULL,
    "department" "OrderDepartment" NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'ORDERED',
    "received_at" TIMESTAMPTZ,
    "received_by_id" UUID,
    "started_at" TIMESTAMPTZ,
    "started_by_id" UUID,
    "completed_at" TIMESTAMPTZ,
    "completed_by_id" UUID,
    "priority" VARCHAR(20) NOT NULL DEFAULT 'ROUTINE',
    "pharmacy_type" VARCHAR(10) NOT NULL DEFAULT 'INTERNAL',
    "pre_order_id" UUID,
    "result" JSONB,
    "notes" TEXT,
    "acknowledged_by" UUID,
    "acknowledged_at" TIMESTAMPTZ,
    "accession_number" VARCHAR(64),
    "worklist_status" VARCHAR(20),
    "worklist_error" TEXT,
    "cancelled_at" TIMESTAMPTZ,
    "cancelled_by_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_sign_logs" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "prescription_id" UUID,
    "patient_id" UUID,
    "encounter_id" UUID,
    "action" VARCHAR(40) NOT NULL,
    "from_status" VARCHAR(20),
    "to_status" VARCHAR(20) NOT NULL,
    "actor_id" UUID,
    "actor_role" VARCHAR(30),
    "order_type" VARCHAR(20),
    "department" VARCHAR(20),
    "priority" VARCHAR(20),
    "summary" TEXT,
    "origin" VARCHAR(20) NOT NULL DEFAULT 'EVENT',
    "occurred_at" TIMESTAMPTZ NOT NULL,
    "seal_status" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    "entry_hash" VARCHAR(64),
    "prev_hash" VARCHAR(64),
    "auth_method" VARCHAR(20),
    "anchor_head" VARCHAR(64),
    "anchored_at" TIMESTAMPTZ,
    "seal_attempts" INTEGER NOT NULL DEFAULT 0,
    "seal_error" TEXT,
    "sealed_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_sign_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billings" (
    "id" UUID NOT NULL,
    "encounter_id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "total_amount" INTEGER NOT NULL,
    "insurance_covered" INTEGER NOT NULL,
    "patient_copay" INTEGER NOT NULL,
    "status" "BillingStatus" NOT NULL DEFAULT 'PENDING',
    "paid_at" TIMESTAMPTZ,
    "paid_amount" INTEGER,
    "payment_method" VARCHAR(20),
    "card_approval_no" VARCHAR(30),
    "receipt_no" VARCHAR(30),
    "cash_receipt_type" VARCHAR(20),
    "cash_receipt_no" VARCHAR(30),
    "deferred_reason" TEXT,
    "refund_amount" INTEGER,
    "refunded_at" TIMESTAMPTZ,
    "refund_reason" TEXT,
    "cashier_note" TEXT,
    "processed_by" UUID,
    "copay_category" VARCHAR(24),
    "eligibility_status" VARCHAR(16),
    "eligibility_check_id" UUID,
    "special_exemption" VARCHAR(40),
    "discount_amount" INTEGER NOT NULL DEFAULT 0,
    "discount_reason" VARCHAR(200),
    "reviewed_insurance_amount" INTEGER,
    "insurance_reduced_amount" INTEGER,
    "insurance_adjusted_at" TIMESTAMPTZ,
    "copay_cap_excess" INTEGER,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "billings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing_items" (
    "id" UUID NOT NULL,
    "billing_id" UUID NOT NULL,
    "code_type" VARCHAR(20) NOT NULL,
    "code_id" UUID NOT NULL,
    "code_name" VARCHAR(500) NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit_price" INTEGER NOT NULL,
    "amount" INTEGER NOT NULL,
    "copay_rate" DECIMAL(5,4) NOT NULL,
    "insurance_category" VARCHAR(20),
    "full_copay" BOOLEAN NOT NULL DEFAULT false,
    "source_prescription_id" UUID,

    CONSTRAINT "billing_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deposits" (
    "id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "admission_id" UUID,
    "amount" INTEGER NOT NULL,
    "balance" INTEGER NOT NULL,
    "deposit_type" VARCHAR(20) NOT NULL,
    "payment_method" VARCHAR(20),
    "deposited_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "refunded_at" TIMESTAMPTZ,
    "processed_by" UUID NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "deposits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "installment_plans" (
    "id" UUID NOT NULL,
    "billing_id" UUID NOT NULL,
    "total_amount" INTEGER NOT NULL,
    "installments" INTEGER NOT NULL,
    "paid_count" INTEGER NOT NULL DEFAULT 0,
    "next_due_date" DATE,
    "status" VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "installment_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "installment_payments" (
    "id" UUID NOT NULL,
    "plan_id" UUID NOT NULL,
    "seq_no" INTEGER NOT NULL,
    "amount" INTEGER NOT NULL,
    "due_date" DATE NOT NULL,
    "paid_at" TIMESTAMPTZ,
    "status" VARCHAR(20) NOT NULL DEFAULT 'PENDING',

    CONSTRAINT "installment_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "form_schemas" (
    "id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "version" VARCHAR(20) NOT NULL,
    "locale" VARCHAR(10) NOT NULL DEFAULT 'ko',
    "schema" JSONB NOT NULL,
    "category" VARCHAR(30) NOT NULL DEFAULT 'QUESTIONNAIRE',
    "description" VARCHAR(500),
    "estimated_minutes" INTEGER,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "created_by" UUID NOT NULL,

    CONSTRAINT "form_schemas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "form_submissions" (
    "id" UUID NOT NULL,
    "form_schema_id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "encounter_id" UUID,
    "data" JSONB NOT NULL,
    "submitted_by" UUID NOT NULL,
    "submitted_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "form_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dispensings" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "pharmacist_id" UUID NOT NULL,
    "status" "DispensingStatus" NOT NULL DEFAULT 'PENDING',
    "care_type" VARCHAR(15) NOT NULL DEFAULT 'OUTPATIENT',
    "packaging_type" VARCHAR(15) NOT NULL DEFAULT 'STANDARD',
    "split_seq_no" INTEGER NOT NULL DEFAULT 1,
    "split_of_id" UUID,
    "total_prescribed_qty" INTEGER,
    "partial_qty" INTEGER,
    "remaining_qty" INTEGER,
    "dispensed_at" TIMESTAMPTZ,
    "second_check_by" UUID,
    "second_check_at" TIMESTAMPTZ,
    "verified_by" UUID,
    "verified_at" TIMESTAMPTZ,
    "issued_by" UUID,
    "issued_at" TIMESTAMPTZ,
    "issued_to" VARCHAR(100),
    "notes" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "dispensings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dispensing_items" (
    "id" UUID NOT NULL,
    "dispensing_id" UUID NOT NULL,
    "medication_code_id" UUID NOT NULL,
    "prescribed_qty" INTEGER NOT NULL,
    "dispensed_qty" INTEGER NOT NULL,
    "scanned_barcode" VARCHAR(100),
    "scanned_at" TIMESTAMPTZ,
    "barcode_verified" BOOLEAN NOT NULL DEFAULT false,
    "batch_id" UUID,
    "lot_number" VARCHAR(50),

    CONSTRAINT "dispensing_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "medication_batches" (
    "id" UUID NOT NULL,
    "medication_code_id" UUID NOT NULL,
    "lot_number" VARCHAR(50) NOT NULL,
    "expiration_date" DATE NOT NULL,
    "quantity" INTEGER NOT NULL,
    "remaining_qty" INTEGER NOT NULL,
    "manufacturer" VARCHAR(200),
    "received_at" TIMESTAMPTZ NOT NULL,
    "storage_condition" VARCHAR(10) NOT NULL DEFAULT 'ROOM',
    "is_controlled" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "medication_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dispensing_counsels" (
    "id" UUID NOT NULL,
    "dispensing_id" UUID NOT NULL,
    "pharmacist_id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "counsel_type" VARCHAR(15) NOT NULL DEFAULT 'INITIAL',
    "content" TEXT NOT NULL,
    "drug_interactions" TEXT,
    "side_effects" TEXT,
    "food_interactions" TEXT,
    "storage_instructions" TEXT,
    "duration" INTEGER,
    "counseled_at" TIMESTAMPTZ NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dispensing_counsels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "generic_substitutions" (
    "id" UUID NOT NULL,
    "original_prescription_id" UUID NOT NULL,
    "substitute_medication_code_id" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "pharmacist_id" UUID NOT NULL,
    "requested_at" TIMESTAMPTZ NOT NULL,
    "doctor_notified" BOOLEAN NOT NULL DEFAULT false,
    "doctor_approved" BOOLEAN,
    "patient_consent" BOOLEAN NOT NULL DEFAULT false,
    "status" VARCHAR(15) NOT NULL DEFAULT 'REQUESTED',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "generic_substitutions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "adverse_reaction_reports" (
    "id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "reporter_id" UUID NOT NULL,
    "report_type" VARCHAR(15) NOT NULL DEFAULT 'INITIAL',
    "suspected_drug_name" VARCHAR(200) NOT NULL,
    "suspected_drug_code" VARCHAR(30),
    "reaction_description" TEXT NOT NULL,
    "onset_date" DATE NOT NULL,
    "severity" VARCHAR(10) NOT NULL,
    "outcome" VARCHAR(15) NOT NULL,
    "is_serious" BOOLEAN NOT NULL DEFAULT false,
    "serious_death" BOOLEAN NOT NULL DEFAULT false,
    "serious_life_threat" BOOLEAN NOT NULL DEFAULT false,
    "serious_hospital" BOOLEAN NOT NULL DEFAULT false,
    "serious_disability" BOOLEAN NOT NULL DEFAULT false,
    "serious_congenital" BOOLEAN NOT NULL DEFAULT false,
    "causality_assessment" VARCHAR(15),
    "naranjo_score" INTEGER,
    "parent_report_id" UUID,
    "kids_reported" BOOLEAN NOT NULL DEFAULT false,
    "kids_report_date" DATE,
    "kids_report_number" VARCHAR(30),
    "kids_payload" JSONB,
    "action_taken" VARCHAR(15),
    "status" VARCHAR(15) NOT NULL DEFAULT 'DRAFT',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "adverse_reaction_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pharmacy_devices" (
    "id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "type" VARCHAR(20) NOT NULL,
    "status" VARCHAR(15) NOT NULL DEFAULT 'OFFLINE',
    "connection_type" VARCHAR(10) NOT NULL,
    "connection_config" JSONB NOT NULL,
    "location" VARCHAR(100),
    "last_heartbeat_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pharmacy_devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "atc_dispense_jobs" (
    "id" UUID NOT NULL,
    "dispensing_id" UUID NOT NULL,
    "device_id" UUID NOT NULL,
    "status" VARCHAR(15) NOT NULL DEFAULT 'QUEUED',
    "medications" JSONB NOT NULL,
    "started_at" TIMESTAMPTZ,
    "completed_at" TIMESTAMPTZ,
    "error_message" TEXT,
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "atc_dispense_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lab_results" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "technician_id" UUID NOT NULL,
    "status" "LabResultStatus" NOT NULL DEFAULT 'PENDING',
    "collected_at" TIMESTAMPTZ,
    "completed_at" TIMESTAMPTZ,
    "verified_by" UUID,
    "verified_at" TIMESTAMPTZ,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lab_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lab_result_amendments" (
    "id" UUID NOT NULL,
    "lab_result_id" UUID NOT NULL,
    "amended_by" UUID NOT NULL,
    "reason" VARCHAR(500) NOT NULL,
    "previous_status" VARCHAR(20) NOT NULL,
    "previous_items" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lab_result_amendments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lab_result_items" (
    "id" UUID NOT NULL,
    "lab_result_id" UUID NOT NULL,
    "test_name" VARCHAR(200) NOT NULL,
    "test_code" VARCHAR(50),
    "loinc_code" VARCHAR(20),
    "value" VARCHAR(100) NOT NULL,
    "unit" VARCHAR(50) NOT NULL,
    "normal_min" DECIMAL(10,3),
    "normal_max" DECIMAL(10,3),
    "flag" VARCHAR(10),

    CONSTRAINT "lab_result_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chronic_observations" (
    "id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "value" DECIMAL(8,2) NOT NULL,
    "unit" VARCHAR(10) NOT NULL,
    "measured_at" TIMESTAMPTZ NOT NULL,
    "source" VARCHAR(12) NOT NULL DEFAULT 'CLINIC',
    "source_id" VARCHAR(80),
    "context" VARCHAR(10) NOT NULL DEFAULT 'CHRONIC',
    "normal_min" DECIMAL(8,2),
    "normal_max" DECIMAL(8,2),
    "flag" VARCHAR(2),
    "encounter_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chronic_observations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lab_result_attachments" (
    "id" UUID NOT NULL,
    "lab_result_id" UUID NOT NULL,
    "file_name" VARCHAR(300) NOT NULL,
    "file_url" VARCHAR(500) NOT NULL,
    "file_size" INTEGER NOT NULL,
    "mime_type" VARCHAR(100) NOT NULL,
    "type" VARCHAR(30) NOT NULL,
    "description" TEXT,
    "uploaded_by" UUID NOT NULL,
    "uploaded_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lab_result_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lab_instruments" (
    "id" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "manufacturer" VARCHAR(200),
    "model" VARCHAR(100),
    "serial_number" VARCHAR(100),
    "category" VARCHAR(50) NOT NULL,
    "interface_type" VARCHAR(30) NOT NULL,
    "interface_config" JSONB,
    "location" VARCHAR(100),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_sync_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "lab_instruments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lab_interface_results" (
    "id" UUID NOT NULL,
    "instrument_id" UUID NOT NULL,
    "raw_data" JSONB NOT NULL,
    "parsed_items" JSONB,
    "sample_barcode" VARCHAR(50),
    "matched_order_id" UUID,
    "matched_lab_result_id" UUID,
    "file_name" VARCHAR(300),
    "status" VARCHAR(20) NOT NULL DEFAULT 'RECEIVED',
    "error_message" TEXT,
    "received_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "applied_at" TIMESTAMPTZ,

    CONSTRAINT "lab_interface_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lab_worksheets" (
    "id" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "instrument_id" UUID,
    "category" VARCHAR(50) NOT NULL,
    "date" DATE NOT NULL,
    "technician_id" UUID NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'OPEN',
    "signed_by" UUID,
    "signed_at" TIMESTAMPTZ,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "lab_worksheets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lab_worksheet_items" (
    "id" UUID NOT NULL,
    "worksheet_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "lab_result_id" UUID,
    "sequence" INTEGER NOT NULL,
    "sample_barcode" VARCHAR(50),
    "sample_status" VARCHAR(30),
    "status" VARCHAR(20) NOT NULL DEFAULT 'PENDING',

    CONSTRAINT "lab_worksheet_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reference_labs" (
    "id" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "contact_info" JSONB,
    "api_endpoint" VARCHAR(300),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reference_labs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lab_send_out_catalog" (
    "id" UUID NOT NULL,
    "reference_lab_id" UUID NOT NULL,
    "test_code" VARCHAR(50) NOT NULL,
    "test_name" VARCHAR(200) NOT NULL,
    "turnaround_days" INTEGER NOT NULL,
    "price" DECIMAL(10,0),
    "sample_type" VARCHAR(30),
    "sample_volume" VARCHAR(50),
    "category" VARCHAR(50),

    CONSTRAINT "lab_send_out_catalog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lab_send_outs" (
    "id" UUID NOT NULL,
    "order_id" UUID,
    "patient_id" UUID NOT NULL,
    "reference_lab_id" UUID NOT NULL,
    "catalog_item_id" UUID,
    "test_name" VARCHAR(200) NOT NULL,
    "sample_type" VARCHAR(30),
    "sample_barcode" VARCHAR(50),
    "clinical_info" TEXT,
    "sent_at" TIMESTAMPTZ,
    "tracking_number" VARCHAR(50),
    "expected_date" DATE,
    "result_received_at" TIMESTAMPTZ,
    "result_file_url" VARCHAR(500),
    "result_summary" TEXT,
    "status" VARCHAR(20) NOT NULL DEFAULT 'ORDERED',
    "requested_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "lab_send_outs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cell_therapy_batches" (
    "id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "batch_number" VARCHAR(30) NOT NULL,
    "cell_type" VARCHAR(50) NOT NULL,
    "source_type" VARCHAR(30) NOT NULL,
    "collection_date" TIMESTAMPTZ NOT NULL,
    "processing_start" TIMESTAMPTZ,
    "processing_end" TIMESTAMPTZ,
    "target_dose" VARCHAR(100),
    "status" VARCHAR(20) NOT NULL DEFAULT 'COLLECTED',
    "notes" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "cell_therapy_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cell_environment_logs" (
    "id" UUID NOT NULL,
    "batch_id" UUID NOT NULL,
    "temperature" DECIMAL(4,1) NOT NULL,
    "co2_percent" DECIMAL(4,1) NOT NULL,
    "humidity" DECIMAL(4,1),
    "recorded_at" TIMESTAMPTZ NOT NULL,
    "recorded_by" UUID,
    "is_alert" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "cell_environment_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cell_qc_tests" (
    "id" UUID NOT NULL,
    "batch_id" UUID NOT NULL,
    "test_type" VARCHAR(50) NOT NULL,
    "result" VARCHAR(200) NOT NULL,
    "unit" VARCHAR(50),
    "pass_fail" VARCHAR(10) NOT NULL,
    "tested_at" TIMESTAMPTZ NOT NULL,
    "tested_by" UUID NOT NULL,
    "report_url" VARCHAR(500),

    CONSTRAINT "cell_qc_tests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cell_batch_documents" (
    "id" UUID NOT NULL,
    "batch_id" UUID NOT NULL,
    "doc_type" VARCHAR(30) NOT NULL,
    "file_name" VARCHAR(300) NOT NULL,
    "file_url" VARCHAR(500) NOT NULL,
    "uploaded_by" UUID NOT NULL,
    "uploaded_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cell_batch_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "genomic_tests" (
    "id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "test_type" VARCHAR(50) NOT NULL,
    "panel_name" VARCHAR(200),
    "sample_type" VARCHAR(30) NOT NULL,
    "reference_lab_id" UUID,
    "status" VARCHAR(20) NOT NULL DEFAULT 'ORDERED',
    "ordered_by" UUID NOT NULL,
    "ordered_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reported_at" TIMESTAMPTZ,
    "counseled_at" TIMESTAMPTZ,
    "counsel_notes" TEXT,
    "notes" TEXT,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "genomic_tests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "genomic_variants" (
    "id" UUID NOT NULL,
    "genomic_test_id" UUID NOT NULL,
    "gene" VARCHAR(50) NOT NULL,
    "chromosome" VARCHAR(10),
    "position" BIGINT,
    "ref_allele" VARCHAR(500),
    "alt_allele" VARCHAR(500),
    "variant_type" VARCHAR(30) NOT NULL,
    "zygosity" VARCHAR(20),
    "classification" VARCHAR(30) NOT NULL,
    "allele_freq" DECIMAL(6,4),
    "clinical_sig" TEXT,
    "actionability" VARCHAR(20),
    "db_snp_id" VARCHAR(30),
    "cosmic_id" VARCHAR(30),
    "hgvs_c" VARCHAR(200),
    "hgvs_p" VARCHAR(200),

    CONSTRAINT "genomic_variants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "genomic_reports" (
    "id" UUID NOT NULL,
    "genomic_test_id" UUID NOT NULL,
    "report_type" VARCHAR(30) NOT NULL,
    "interpretation" TEXT,
    "recommendation" TEXT,
    "report_file_url" VARCHAR(500),
    "reported_by" UUID NOT NULL,
    "reported_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "genomic_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lab_qc_records" (
    "id" UUID NOT NULL,
    "instrument_id" UUID NOT NULL,
    "qc_material_id" VARCHAR(50),
    "qc_level" VARCHAR(20) NOT NULL,
    "test_code" VARCHAR(50) NOT NULL,
    "measured_value" DECIMAL(10,3) NOT NULL,
    "target_mean" DECIMAL(10,3) NOT NULL,
    "target_sd" DECIMAL(10,3) NOT NULL,
    "z_score" DECIMAL(5,2),
    "westgard_rule" VARCHAR(20),
    "is_accepted" BOOLEAN NOT NULL,
    "performed_at" TIMESTAMPTZ NOT NULL,
    "performed_by" UUID NOT NULL,
    "notes" TEXT,

    CONSTRAINT "lab_qc_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "nutrition_assessments" (
    "id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "admission_id" UUID,
    "assessment_type" VARCHAR(30) NOT NULL,
    "height" DECIMAL(5,1),
    "weight" DECIMAL(5,1),
    "bmi" DECIMAL(4,1),
    "albumin" DECIMAL(4,1),
    "nrs_score" INTEGER,
    "risk_level" VARCHAR(20),
    "intake_status" VARCHAR(20),
    "notes" TEXT,
    "assessed_by" UUID NOT NULL,
    "assessed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "nutrition_assessments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "diet_orders" (
    "id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "admission_id" UUID NOT NULL,
    "diet_type" VARCHAR(50) NOT NULL,
    "calorie_target" INTEGER,
    "protein_target" DECIMAL(5,1),
    "fluid_limit" INTEGER,
    "restrictions" JSONB,
    "texture" VARCHAR(30),
    "ordered_by" UUID NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "diet_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "production_batches" (
    "id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "meal_type" VARCHAR(20) NOT NULL,
    "diet_type" VARCHAR(100) NOT NULL,
    "planned_qty" INTEGER NOT NULL DEFAULT 0,
    "produced_qty" INTEGER,
    "allergy_note" TEXT,
    "cook_start_at" TIMESTAMPTZ,
    "cook_end_at" TIMESTAMPTZ,
    "status" VARCHAR(20) NOT NULL DEFAULT 'PLANNED',
    "cooked_by" UUID,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "production_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meal_inspections" (
    "id" UUID NOT NULL,
    "production_batch_id" UUID NOT NULL,
    "pass" BOOLEAN NOT NULL DEFAULT true,
    "taste" INTEGER,
    "temperature" INTEGER,
    "portion" INTEGER,
    "hygiene" INTEGER,
    "notes" TEXT,
    "inspected_by" UUID NOT NULL,
    "inspected_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "meal_inspections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "haccp_checks" (
    "id" UUID NOT NULL,
    "production_batch_id" UUID,
    "date" DATE NOT NULL,
    "meal_type" VARCHAR(20),
    "ccp_type" VARCHAR(20) NOT NULL,
    "value" DOUBLE PRECISION,
    "within_limit" BOOLEAN NOT NULL DEFAULT true,
    "corrective_action" TEXT,
    "checked_by" UUID NOT NULL,
    "checked_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "haccp_checks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meal_delivery_checks" (
    "id" UUID NOT NULL,
    "meal_order_id" UUID NOT NULL,
    "patient_verified" BOOLEAN NOT NULL DEFAULT false,
    "diet_verified" BOOLEAN NOT NULL DEFAULT false,
    "allergy_verified" BOOLEAN NOT NULL DEFAULT false,
    "temp_ok" BOOLEAN NOT NULL DEFAULT false,
    "delivered_by" UUID NOT NULL,
    "delivered_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "meal_delivery_checks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "special_nutrition_orders" (
    "id" UUID NOT NULL,
    "admission_id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "kind" VARCHAR(20) NOT NULL,
    "route" VARCHAR(30),
    "formula" VARCHAR(100),
    "target_calories" INTEGER,
    "volume_ml" INTEGER,
    "rate_ml_hr" INTEGER,
    "composition" JSONB,
    "monitoring" JSONB,
    "start_date" DATE NOT NULL,
    "end_date" DATE,
    "status" VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    "ordered_by" UUID NOT NULL,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "special_nutrition_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "nutrition_counsels" (
    "id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "counsel_type" VARCHAR(30) NOT NULL,
    "topic" VARCHAR(200) NOT NULL,
    "content" TEXT NOT NULL,
    "dietary_goals" JSONB,
    "duration" INTEGER,
    "counseled_by" UUID NOT NULL,
    "counseled_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "follow_up_date" DATE,

    CONSTRAINT "nutrition_counsels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "operating_rooms" (
    "id" UUID NOT NULL,
    "name" VARCHAR(50) NOT NULL,
    "floor" VARCHAR(20),
    "room_type" VARCHAR(30) NOT NULL,
    "equipment" JSONB,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "operating_rooms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "or_schedules" (
    "id" UUID NOT NULL,
    "room_id" UUID NOT NULL,
    "surgery_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "start_time" VARCHAR(5) NOT NULL,
    "end_time" VARCHAR(5) NOT NULL,
    "estimated_duration" INTEGER NOT NULL,
    "actual_start_time" TIMESTAMPTZ,
    "actual_end_time" TIMESTAMPTZ,
    "status" VARCHAR(20) NOT NULL DEFAULT 'SCHEDULED',
    "delay_reason" TEXT,
    "notes" TEXT,

    CONSTRAINT "or_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "anesthesia_records" (
    "id" UUID NOT NULL,
    "surgery_id" UUID NOT NULL,
    "anesthetist_id" UUID NOT NULL,
    "asa_class" VARCHAR(10),
    "anesthesia_type" VARCHAR(30) NOT NULL,
    "airway_type" VARCHAR(30),
    "ett_size" VARCHAR(10),
    "induction_time" TIMESTAMPTZ,
    "intubation_time" TIMESTAMPTZ,
    "extubation_time" TIMESTAMPTZ,
    "induction_drugs" JSONB,
    "maintenance_drugs" JSONB,
    "analgesics" JSONB,
    "reversal" JSONB,
    "fluid_input" JSONB,
    "blood_products" JSONB,
    "ebl" INTEGER,
    "urine_output" INTEGER,
    "complications" JSONB,
    "vital_signs" JSONB,
    "notes" TEXT,

    CONSTRAINT "anesthesia_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pacu_records" (
    "id" UUID NOT NULL,
    "surgery_id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "arrival_time" TIMESTAMPTZ NOT NULL,
    "discharge_time" TIMESTAMPTZ,
    "aldrete_score" INTEGER,
    "aldrete_detail" JSONB,
    "pain_score" INTEGER,
    "ponv_score" INTEGER,
    "ponv_management" VARCHAR(200),
    "padss_score" INTEGER,
    "padss_detail" JSONB,
    "arrival_handoff" JSONB,
    "discharge_handoff" JSONB,
    "complications" JSONB,
    "pain_assessments" JSONB,
    "oxygen_therapy" VARCHAR(50),
    "vital_signs" JSONB,
    "interventions" JSONB,
    "nurse_id" UUID NOT NULL,
    "disposition" VARCHAR(30),
    "discharged_by_id" UUID,
    "discharge_override" TEXT,
    "notes" TEXT,

    CONSTRAINT "pacu_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "surgical_checklists" (
    "id" UUID NOT NULL,
    "surgery_id" UUID NOT NULL,
    "sign_in_patient_id" BOOLEAN,
    "sign_in_site_marked" BOOLEAN,
    "sign_in_consent_signed" BOOLEAN,
    "sign_in_anesthesia_check" BOOLEAN,
    "sign_in_allergy_check" BOOLEAN,
    "sign_in_pulse_oximeter" BOOLEAN,
    "sign_in_expected_blood_loss" BOOLEAN,
    "sign_in_difficult_airway" BOOLEAN,
    "sign_in_completed_by" UUID,
    "sign_in_completed_at" TIMESTAMPTZ,
    "time_out_team_intro" BOOLEAN,
    "time_out_patient_name" BOOLEAN,
    "time_out_procedure" BOOLEAN,
    "time_out_site" BOOLEAN,
    "time_out_antibiotics" BOOLEAN,
    "time_out_critical_events" BOOLEAN,
    "time_out_imaging_displayed" BOOLEAN,
    "time_out_completed_by" UUID,
    "time_out_completed_at" TIMESTAMPTZ,
    "sign_out_procedure_recorded" BOOLEAN,
    "sign_out_instrument_count" BOOLEAN,
    "count_items" JSONB,
    "count_status" VARCHAR(20),
    "count_discrepancy_note" TEXT,
    "sign_out_specimen_labeled" BOOLEAN,
    "sign_out_recovery_plan" BOOLEAN,
    "sign_out_equipment_issues" BOOLEAN,
    "sign_out_completed_by" UUID,
    "sign_out_completed_at" TIMESTAMPTZ,

    CONSTRAINT "surgical_checklists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "blood_products" (
    "id" UUID NOT NULL,
    "unit_number" VARCHAR(30) NOT NULL,
    "product_type" VARCHAR(30) NOT NULL,
    "blood_type" VARCHAR(5) NOT NULL,
    "rh_factor" VARCHAR(3) NOT NULL,
    "volume" INTEGER NOT NULL,
    "collected_at" TIMESTAMPTZ NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "donor_id" VARCHAR(30),
    "supplier_name" VARCHAR(100),
    "received_at" TIMESTAMPTZ NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'AVAILABLE',
    "storage_location" VARCHAR(50),
    "notes" TEXT,
    "irradiated" BOOLEAN NOT NULL DEFAULT false,
    "leukoreduced" BOOLEAN NOT NULL DEFAULT false,
    "cmv_negative" BOOLEAN NOT NULL DEFAULT false,
    "washed" BOOLEAN NOT NULL DEFAULT false,
    "discard_reason" VARCHAR(200),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "blood_products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "blood_crossmatches" (
    "id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "blood_product_id" UUID NOT NULL,
    "requested_by" UUID NOT NULL,
    "requested_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "tested_by" UUID,
    "tested_at" TIMESTAMPTZ,
    "method" VARCHAR(30),
    "result" VARCHAR(20),
    "antibody_screen" VARCHAR(20),
    "valid_until" TIMESTAMPTZ,
    "notes" TEXT,

    CONSTRAINT "blood_crossmatches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transfusion_orders" (
    "id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "ordered_by" UUID NOT NULL,
    "product_type" VARCHAR(30) NOT NULL,
    "units" INTEGER NOT NULL,
    "urgency" VARCHAR(20) NOT NULL DEFAULT 'ROUTINE',
    "indication" TEXT,
    "special_reqs" JSONB,
    "pre_transfusion_hb" DECIMAL(4,1),
    "consent_id" UUID,
    "status" VARCHAR(20) NOT NULL DEFAULT 'ORDERED',
    "ordered_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transfusion_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "blood_transfusions" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "blood_product_id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "verified_by_nurse1" UUID,
    "verified_by_nurse2" UUID,
    "verification_time" TIMESTAMPTZ,
    "patient_band_scan" VARCHAR(40),
    "blood_unit_scan" VARCHAR(40),
    "bedside_scan_at" TIMESTAMPTZ,
    "start_time" TIMESTAMPTZ,
    "end_time" TIMESTAMPTZ,
    "rate" INTEGER,
    "volume_transfused" INTEGER,
    "vital_signs" JSONB,
    "reaction_occurred" BOOLEAN NOT NULL DEFAULT false,
    "reaction_type" VARCHAR(50),
    "reaction_severity" VARCHAR(20),
    "reaction_action" TEXT,
    "emergency_release" BOOLEAN NOT NULL DEFAULT false,
    "emergency_reason" VARCHAR(300),
    "status" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    "notes" TEXT,

    CONSTRAINT "blood_transfusions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "patient_blood_typings" (
    "id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "abo" VARCHAR(3) NOT NULL,
    "rh" VARCHAR(3) NOT NULL,
    "abo_confirm" VARCHAR(3),
    "method" VARCHAR(30),
    "antibody_screen" VARCHAR(10),
    "typed_by" UUID,
    "typed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,

    CONSTRAINT "patient_blood_typings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "patient_antibodies" (
    "id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "antibody" VARCHAR(30) NOT NULL,
    "significance" VARCHAR(20),
    "identified_by" UUID,
    "identified_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,

    CONSTRAINT "patient_antibodies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "massive_transfusion_protocols" (
    "id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "activated_by" UUID NOT NULL,
    "activated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "indication" VARCHAR(50) NOT NULL,
    "ratio" VARCHAR(20),
    "packs_issued" INTEGER NOT NULL DEFAULT 0,
    "status" VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    "deactivated_by" UUID,
    "deactivated_at" TIMESTAMPTZ,
    "notes" TEXT,

    CONSTRAINT "massive_transfusion_protocols_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transfusion_reaction_reports" (
    "id" UUID NOT NULL,
    "transfusion_id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "reaction_type" VARCHAR(30) NOT NULL,
    "severity" VARCHAR(20) NOT NULL,
    "signs" TEXT,
    "workup" JSONB,
    "management_note" TEXT,
    "reported_to_blood_center" BOOLEAN NOT NULL DEFAULT false,
    "reported_at" TIMESTAMPTZ,
    "outcome" VARCHAR(30),
    "reported_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transfusion_reaction_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "blood_reorder_requests" (
    "id" UUID NOT NULL,
    "product_type" VARCHAR(30) NOT NULL,
    "blood_type" VARCHAR(5) NOT NULL,
    "units" INTEGER NOT NULL,
    "urgency" VARCHAR(20) NOT NULL DEFAULT 'ROUTINE',
    "supplier_name" VARCHAR(100),
    "status" VARCHAR(20) NOT NULL DEFAULT 'REQUESTED',
    "requested_by" UUID NOT NULL,
    "requested_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,

    CONSTRAINT "blood_reorder_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rehab_assessments" (
    "id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "admission_id" UUID,
    "assessment_type" VARCHAR(30) NOT NULL,
    "diagnosis" VARCHAR(200) NOT NULL,
    "onset_date" DATE,
    "barthel" INTEGER,
    "fim" INTEGER,
    "mmt" JSONB,
    "rom" JSONB,
    "berg" INTEGER,
    "mmse" INTEGER,
    "vas" INTEGER,
    "gait" VARCHAR(100),
    "swallow" VARCHAR(100),
    "goals" JSONB,
    "notes" TEXT,
    "assessed_by" UUID NOT NULL,
    "assessed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rehab_assessments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rehab_plans" (
    "id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "diagnosis" VARCHAR(200) NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE,
    "frequency" VARCHAR(50) NOT NULL,
    "therapies" JSONB NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    "prescribed_by" UUID NOT NULL,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rehab_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rehab_sessions" (
    "id" UUID NOT NULL,
    "plan_id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "therapy_type" VARCHAR(20) NOT NULL,
    "therapist_id" UUID NOT NULL,
    "scheduled_at" TIMESTAMPTZ NOT NULL,
    "start_time" TIMESTAMPTZ,
    "end_time" TIMESTAMPTZ,
    "duration" INTEGER,
    "activities" JSONB,
    "vitals" JSONB,
    "progress" TEXT,
    "status" VARCHAR(20) NOT NULL DEFAULT 'SCHEDULED',
    "notes" TEXT,
    "safety_checks" JSONB,
    "billing_code" VARCHAR(20),
    "billing_code_name" VARCHAR(200),
    "billing_unit_price" INTEGER,

    CONSTRAINT "rehab_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "radiation_plans" (
    "id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "diagnosis" VARCHAR(200) NOT NULL,
    "diagnosis_code" VARCHAR(20),
    "intent" VARCHAR(20) NOT NULL,
    "technique" VARCHAR(30) NOT NULL,
    "site" VARCHAR(100) NOT NULL,
    "total_dose" DECIMAL(6,2) NOT NULL,
    "fraction_dose" DECIMAL(5,2) NOT NULL,
    "total_fractions" INTEGER NOT NULL,
    "energy" VARCHAR(30),
    "machine" VARCHAR(50),
    "simulation_date" DATE,
    "plan_approved_at" TIMESTAMPTZ,
    "plan_approved_by" UUID,
    "start_date" DATE,
    "end_date" DATE,
    "status" VARCHAR(20) NOT NULL DEFAULT 'PLANNED',
    "prescribed_by" UUID NOT NULL,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "radiation_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "radiation_fractions" (
    "id" UUID NOT NULL,
    "plan_id" UUID NOT NULL,
    "fraction_number" INTEGER NOT NULL,
    "scheduled_date" DATE NOT NULL,
    "delivered_at" TIMESTAMPTZ,
    "delivered_dose" DECIMAL(5,2),
    "cumulative_dose" DECIMAL(6,2),
    "setup_verified" BOOLEAN,
    "cone_beam_ct" BOOLEAN,
    "therapist_id" UUID,
    "status" VARCHAR(20) NOT NULL DEFAULT 'SCHEDULED',
    "notes" TEXT,

    CONSTRAINT "radiation_fractions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "radiation_toxicities" (
    "id" UUID NOT NULL,
    "plan_id" UUID NOT NULL,
    "week" INTEGER NOT NULL,
    "skin_grade" INTEGER,
    "mucositis_grade" INTEGER,
    "fatigue_grade" INTEGER,
    "nausea_grade" INTEGER,
    "pain_grade" INTEGER,
    "other_toxicity" JSONB,
    "weight" DECIMAL(5,1),
    "ecog" INTEGER,
    "notes" TEXT,
    "assessed_by" UUID NOT NULL,
    "assessed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "radiation_toxicities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dialysis_orders" (
    "id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "modality" VARCHAR(20) NOT NULL,
    "frequency" VARCHAR(30) NOT NULL,
    "duration" INTEGER NOT NULL,
    "dialyzer_type" VARCHAR(50),
    "blood_flow_rate" INTEGER,
    "dialysate_flow" INTEGER,
    "dry_weight" DECIMAL(5,1),
    "uf_goal" INTEGER,
    "anticoagulant" VARCHAR(50),
    "access_type" VARCHAR(30),
    "pd_solution" VARCHAR(50),
    "pd_volume" INTEGER,
    "pd_exchanges" INTEGER,
    "dwell_time" INTEGER,
    "prescribed_by" UUID NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dialysis_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dialysis_sessions" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "machine_id" UUID,
    "scheduled_date" DATE NOT NULL,
    "shift" VARCHAR(10),
    "pre_weight" DECIMAL(5,1),
    "pre_temp" DECIMAL(4,1),
    "pre_bp" VARCHAR(20),
    "pre_hr" INTEGER,
    "intradialytic_vitals" JSONB,
    "post_weight" DECIMAL(5,1),
    "post_temp" DECIMAL(4,1),
    "post_bp" VARCHAR(20),
    "post_hr" INTEGER,
    "actual_uf" INTEGER,
    "actual_duration" INTEGER,
    "kt_v" DECIMAL(4,2),
    "start_time" TIMESTAMPTZ,
    "end_time" TIMESTAMPTZ,
    "nurse_id" UUID,
    "complications" JSONB,
    "status" VARCHAR(20) NOT NULL DEFAULT 'SCHEDULED',
    "notes" TEXT,

    CONSTRAINT "dialysis_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dialysis_machines" (
    "id" UUID NOT NULL,
    "name" VARCHAR(50) NOT NULL,
    "model" VARCHAR(100),
    "serial_number" VARCHAR(50),
    "machine_type" VARCHAR(20) NOT NULL,
    "location" VARCHAR(50),
    "status" VARCHAR(20) NOT NULL DEFAULT 'AVAILABLE',
    "last_disinfection" TIMESTAMPTZ,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "dialysis_machines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hospice_registrations" (
    "id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "admission_id" UUID,
    "registered_by" UUID NOT NULL,
    "registered_at" TIMESTAMPTZ NOT NULL,
    "pps_score" INTEGER NOT NULL,
    "primary_diagnosis" VARCHAR(200) NOT NULL,
    "prognosis" VARCHAR(50),
    "hospice_type" VARCHAR(20) NOT NULL,
    "goals" TEXT,
    "dnr_status" BOOLEAN NOT NULL DEFAULT false,
    "status" VARCHAR(15) NOT NULL DEFAULT 'ACTIVE',
    "discharged_at" TIMESTAMPTZ,
    "deceased_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hospice_registrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hospice_symptom_assessments" (
    "id" UUID NOT NULL,
    "registration_id" UUID NOT NULL,
    "assessor_id" UUID NOT NULL,
    "pain" INTEGER NOT NULL DEFAULT 0,
    "tiredness" INTEGER NOT NULL DEFAULT 0,
    "nausea" INTEGER NOT NULL DEFAULT 0,
    "depression" INTEGER NOT NULL DEFAULT 0,
    "anxiety" INTEGER NOT NULL DEFAULT 0,
    "drowsiness" INTEGER NOT NULL DEFAULT 0,
    "appetite" INTEGER NOT NULL DEFAULT 0,
    "wellbeing" INTEGER NOT NULL DEFAULT 0,
    "shortness_of_breath" INTEGER NOT NULL DEFAULT 0,
    "other_symptom" VARCHAR(100),
    "other_score" INTEGER,
    "total_score" INTEGER NOT NULL,
    "pain_type" VARCHAR(30),
    "who_step" INTEGER,
    "pain_medication" VARCHAR(200),
    "notes" TEXT,
    "assessed_at" TIMESTAMPTZ NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hospice_symptom_assessments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "advance_directives" (
    "id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "document_type" VARCHAR(20) NOT NULL,
    "cpr_decision" VARCHAR(10),
    "ventilator_decision" VARCHAR(10),
    "dialysis_decision" VARCHAR(10),
    "transfusion_decision" VARCHAR(10),
    "chemotherapy_decision" VARCHAR(10),
    "hospice_consent" BOOLEAN,
    "organ_donation" BOOLEAN,
    "patient_signed_at" TIMESTAMPTZ,
    "family_signed_at" TIMESTAMPTZ,
    "doctor_signed_at" TIMESTAMPTZ,
    "doctor_id" UUID,
    "registered_at" TIMESTAMPTZ NOT NULL,
    "status" VARCHAR(15) NOT NULL DEFAULT 'ACTIVE',
    "revoked_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "advance_directives_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hospice_care_conferences" (
    "id" UUID NOT NULL,
    "registration_id" UUID NOT NULL,
    "facilitator_id" UUID NOT NULL,
    "conference_date" TIMESTAMPTZ NOT NULL,
    "conference_type" VARCHAR(20) NOT NULL,
    "attendees" JSONB NOT NULL,
    "current_status" TEXT,
    "care_goals" TEXT,
    "pain_management" TEXT,
    "psychosocial" TEXT,
    "spiritual" TEXT,
    "family_concerns" TEXT,
    "action_items" JSONB,
    "next_conference_date" DATE,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hospice_care_conferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transplant_waitlists" (
    "id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "organ_type" VARCHAR(30) NOT NULL,
    "blood_type" VARCHAR(5) NOT NULL,
    "urgency" VARCHAR(15) NOT NULL DEFAULT 'ROUTINE',
    "hla_typing" JSONB,
    "pra" INTEGER,
    "registered_at" TIMESTAMPTZ NOT NULL,
    "konos_id" VARCHAR(30),
    "status" VARCHAR(15) NOT NULL DEFAULT 'WAITING',
    "matched_at" TIMESTAMPTZ,
    "removed_at" TIMESTAMPTZ,
    "remove_reason" VARCHAR(100),
    "notes" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transplant_waitlists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transplant_donors" (
    "id" UUID NOT NULL,
    "donor_type" VARCHAR(15) NOT NULL,
    "donor_patient_id" UUID,
    "donor_name" VARCHAR(100),
    "relationship" VARCHAR(30),
    "blood_type" VARCHAR(5) NOT NULL,
    "hla_typing" JSONB,
    "organ_type" VARCHAR(30) NOT NULL,
    "crossmatch_result" VARCHAR(15),
    "crossmatch_date" DATE,
    "status" VARCHAR(15) NOT NULL DEFAULT 'REGISTERED',
    "evaluation_notes" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transplant_donors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transplant_crossmatches" (
    "id" UUID NOT NULL,
    "donor_id" UUID NOT NULL,
    "recipient_id" UUID NOT NULL,
    "result" VARCHAR(15) NOT NULL,
    "details" JSONB,
    "tested_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "valid_until" TIMESTAMPTZ,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transplant_crossmatches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transplant_records" (
    "id" UUID NOT NULL,
    "recipient_id" UUID NOT NULL,
    "donor_id" UUID NOT NULL,
    "waitlist_id" UUID,
    "surgery_id" UUID,
    "organ_type" VARCHAR(30) NOT NULL,
    "transplant_date" TIMESTAMPTZ NOT NULL,
    "surgeon_id" UUID NOT NULL,
    "cold_ischemia_time" INTEGER,
    "warm_ischemia_time" INTEGER,
    "outcome" VARCHAR(15) NOT NULL DEFAULT 'SUCCESS',
    "graft_function" VARCHAR(15),
    "induction_regimen" TEXT,
    "maintenance_regimen" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transplant_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transplant_hla" (
    "id" UUID NOT NULL,
    "waitlist_id" UUID NOT NULL,
    "class_i" JSONB,
    "class_ii" JSONB,
    "method" VARCHAR(50),
    "pra" INTEGER,
    "antibodies" JSONB,
    "lab" VARCHAR(100),
    "tested_at" TIMESTAMPTZ NOT NULL,
    "recorded_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transplant_hla_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transplant_tdm" (
    "id" UUID NOT NULL,
    "transplant_id" UUID NOT NULL,
    "drug" VARCHAR(60) NOT NULL,
    "trough_level" DOUBLE PRECISION,
    "peak_level" DOUBLE PRECISION,
    "target_low" DOUBLE PRECISION,
    "target_high" DOUBLE PRECISION,
    "in_range" BOOLEAN,
    "dose_adjustment" VARCHAR(200),
    "side_effects" JSONB,
    "sampled_at" TIMESTAMPTZ NOT NULL,
    "recorded_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transplant_tdm_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transplant_follow_ups" (
    "id" UUID NOT NULL,
    "transplant_id" UUID NOT NULL,
    "visit_date" TIMESTAMPTZ NOT NULL,
    "post_op_day" INTEGER,
    "graft_function" VARCHAR(30),
    "lab_results" JSONB,
    "immunosuppression_regimen" JSONB,
    "complications" JSONB,
    "biopsy_result" TEXT,
    "infections" JSONB,
    "rejection_signs" BOOLEAN,
    "next_follow_up" TIMESTAMPTZ,
    "notes" TEXT,
    "recorded_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transplant_follow_ups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transplant_rejections" (
    "id" UUID NOT NULL,
    "transplant_id" UUID NOT NULL,
    "detected_at" TIMESTAMPTZ NOT NULL,
    "rejection_type" VARCHAR(20) NOT NULL,
    "severity" VARCHAR(10) NOT NULL,
    "biopsy_result" TEXT,
    "treatment" TEXT,
    "outcome" VARCHAR(15),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transplant_rejections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "telehealth_sessions" (
    "id" UUID NOT NULL,
    "encounter_id" UUID,
    "patient_id" UUID NOT NULL,
    "doctor_id" UUID NOT NULL,
    "scheduled_at" TIMESTAMPTZ NOT NULL,
    "session_type" VARCHAR(20) NOT NULL,
    "chief_complaint" TEXT,
    "status" VARCHAR(15) NOT NULL DEFAULT 'SCHEDULED',
    "started_at" TIMESTAMPTZ,
    "ended_at" TIMESTAMPTZ,
    "duration_minutes" INTEGER,
    "room_id" VARCHAR(100),
    "recording_url" VARCHAR(500),
    "patient_message" TEXT,
    "patient_photos" JSONB,
    "doctor_reply" TEXT,
    "prescription_issued" BOOLEAN NOT NULL DEFAULT false,
    "fee_amount" INTEGER,
    "payment_status" VARCHAR(15),
    "patient_rating" INTEGER,
    "patient_feedback" TEXT,
    "notes" TEXT,
    "pharmacy_review" TEXT,
    "pharmacy_review_by" UUID,
    "pharmacy_review_at" TIMESTAMPTZ,
    "nursing_note_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "telehealth_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dental_charts" (
    "id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "encounter_id" UUID,
    "teeth_status" JSONB NOT NULL,
    "perio_status" JSONB,
    "occlusion" VARCHAR(100),
    "oral_hygiene" VARCHAR(20),
    "notes" TEXT,
    "charted_by" UUID NOT NULL,
    "charted_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dental_charts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dental_treatment_plans" (
    "id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "tooth" VARCHAR(5) NOT NULL,
    "procedure" VARCHAR(100) NOT NULL,
    "category" VARCHAR(30) NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 1,
    "estimated_cost" DECIMAL(10,0),
    "insurance_covered" BOOLEAN,
    "status" VARCHAR(20) NOT NULL DEFAULT 'PLANNED',
    "sessions" INTEGER NOT NULL DEFAULT 1,
    "notes" TEXT,
    "planned_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dental_treatment_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dental_treatment_records" (
    "id" UUID NOT NULL,
    "plan_id" UUID,
    "patient_id" UUID NOT NULL,
    "encounter_id" UUID,
    "tooth" VARCHAR(5) NOT NULL,
    "procedure" VARCHAR(100) NOT NULL,
    "surfaces" JSONB,
    "material" VARCHAR(50),
    "anesthesia" VARCHAR(50),
    "anesthesia_agent" VARCHAR(20),
    "anesthesia_dose_mg" DECIMAL(6,1),
    "canal_length" JSONB,
    "shade" VARCHAR(10),
    "lab_order" VARCHAR(100),
    "xray_taken" BOOLEAN,
    "findings" TEXT,
    "next_visit" VARCHAR(100),
    "treated_by" UUID NOT NULL,
    "treated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dental_treatment_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "eye_exams" (
    "id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "encounter_id" UUID,
    "va_od_uncorrected" VARCHAR(20),
    "va_os_uncorrected" VARCHAR(20),
    "va_od_corrected" VARCHAR(20),
    "va_os_corrected" VARCHAR(20),
    "refraction_od" JSONB,
    "refraction_os" JSONB,
    "iop_od" DECIMAL(4,1),
    "iop_os" DECIMAL(4,1),
    "iop_method" VARCHAR(30),
    "pupil_od" VARCHAR(30),
    "pupil_os" VARCHAR(30),
    "rapd" BOOLEAN,
    "slit_lamp_od" JSONB,
    "slit_lamp_os" JSONB,
    "fundus_od" JSONB,
    "fundus_os" JSONB,
    "fundus_image_url" VARCHAR(500),
    "oct_od" JSONB,
    "oct_os" JSONB,
    "oct_image_url" VARCHAR(500),
    "vf_od" JSONB,
    "vf_os" JSONB,
    "vf_image_url" VARCHAR(500),
    "diagnosis" TEXT,
    "plan" TEXT,
    "notes" TEXT,
    "examined_by" UUID NOT NULL,
    "examined_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "eye_exams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "eye_surgeries" (
    "id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "surgery_id" UUID,
    "eye" VARCHAR(5) NOT NULL,
    "procedure" VARCHAR(100) NOT NULL,
    "iol_model" VARCHAR(100),
    "iol_power" VARCHAR(20),
    "laser_params" JSONB,
    "pre_op_va" VARCHAR(20),
    "post_op_va" VARCHAR(20),
    "complications" TEXT,
    "operated_by" UUID NOT NULL,
    "operated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "eye_surgeries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "skin_lesions" (
    "id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "encounter_id" UUID,
    "location" VARCHAR(100) NOT NULL,
    "body_region" VARCHAR(30) NOT NULL,
    "morphology" VARCHAR(50) NOT NULL,
    "color" VARCHAR(30),
    "size" VARCHAR(30),
    "border" VARCHAR(30),
    "distribution" VARCHAR(30),
    "surface" VARCHAR(50),
    "dermoscopy" JSONB,
    "abcde_score" INTEGER,
    "photo_urls" JSONB,
    "biopsy_taken" BOOLEAN,
    "biopsy_result" TEXT,
    "biopsy_status" VARCHAR(20),
    "diagnosis" VARCHAR(200),
    "diagnosis_code" VARCHAR(20),
    "notes" TEXT,
    "recorded_by" UUID NOT NULL,
    "recorded_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "pasi_score" DECIMAL(4,1),
    "scorad_score" DECIMAL(5,1),
    "gags_score" INTEGER,
    "breslow_thickness" DECIMAL(4,2),
    "clark_level" INTEGER,
    "tnm_stage" VARCHAR(20),

    CONSTRAINT "skin_lesions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "skin_treatments" (
    "id" UUID NOT NULL,
    "lesion_id" UUID,
    "patient_id" UUID NOT NULL,
    "treatment_type" VARCHAR(30) NOT NULL,
    "procedure" VARCHAR(200) NOT NULL,
    "area" VARCHAR(100),
    "parameters" JSONB,
    "medication" VARCHAR(200),
    "before_photo_url" VARCHAR(500),
    "after_photo_url" VARCHAR(500),
    "complications" TEXT,
    "next_session" DATE,
    "treated_by" UUID NOT NULL,
    "treated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "skin_treatments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ent_exams" (
    "id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "encounter_id" UUID,
    "otoscopy_right" JSONB,
    "otoscopy_left" JSONB,
    "audiogram_right" JSONB,
    "audiogram_left" JSONB,
    "pta_right" INTEGER,
    "pta_left" INTEGER,
    "speech_right" INTEGER,
    "speech_left" INTEGER,
    "tympanometry_right" VARCHAR(10),
    "tympanometry_left" VARCHAR(10),
    "nasal_endoscopy" JSONB,
    "nasal_endoscopy_image_url" VARCHAR(500),
    "pharynx_exam" JSONB,
    "laryngoscopy_image_url" VARCHAR(500),
    "diagnosis" TEXT,
    "notes" TEXT,
    "examined_by" UUID NOT NULL,
    "examined_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ent_exams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hearing_aids" (
    "id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "encounter_id" UUID,
    "ear" VARCHAR(10) NOT NULL,
    "model" VARCHAR(100),
    "type" VARCHAR(50),
    "gain" JSONB,
    "notes" TEXT,
    "prescribed_by" UUID NOT NULL,
    "prescribed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hearing_aids_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "eye_prescriptions" (
    "id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "prescription_type" VARCHAR(20) NOT NULL,
    "od_sphere" DECIMAL(5,2),
    "od_cylinder" DECIMAL(5,2),
    "od_axis" INTEGER,
    "od_add" DECIMAL(4,2),
    "os_sphere" DECIMAL(5,2),
    "os_cylinder" DECIMAL(5,2),
    "os_axis" INTEGER,
    "os_add" DECIMAL(4,2),
    "pd" DECIMAL(4,1),
    "base_curve" DECIMAL(4,2),
    "diameter" DECIMAL(4,1),
    "brand" VARCHAR(100),
    "prescribed_by" UUID NOT NULL,
    "prescribed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "eye_prescriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dental_lab_orders" (
    "id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "plan_id" UUID,
    "tooth" VARCHAR(5) NOT NULL,
    "order_type" VARCHAR(30) NOT NULL,
    "material" VARCHAR(50) NOT NULL,
    "shade" VARCHAR(10),
    "lab_name" VARCHAR(100),
    "impression" VARCHAR(30),
    "due_date" DATE,
    "sent_at" TIMESTAMPTZ,
    "received_at" TIMESTAMPTZ,
    "status" VARCHAR(20) NOT NULL DEFAULT 'ORDERED',
    "fitting_notes" TEXT,
    "cost" DECIMAL(10,0),
    "ordered_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dental_lab_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sleep_studies" (
    "id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "study_type" VARCHAR(30) NOT NULL,
    "study_date" DATE NOT NULL,
    "ahi" DECIMAL(5,1) NOT NULL,
    "oxygen_sat_min" INTEGER,
    "oxygen_sat_avg" INTEGER,
    "sleep_efficiency" DECIMAL(5,1),
    "total_sleep_time" INTEGER,
    "rem_percent" DECIMAL(4,1),
    "supine_ahi" DECIMAL(5,1),
    "severity" VARCHAR(20),
    "diagnosis" VARCHAR(200),
    "cpap_recommended" BOOLEAN,
    "cpap_pressure" DECIMAL(4,1),
    "report_url" VARCHAR(500),
    "interpreted_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sleep_studies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "imaging_results" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "radiologist_id" UUID,
    "radiologist_name" VARCHAR(100),
    "modality" VARCHAR(50) NOT NULL,
    "body_part" VARCHAR(100),
    "finding" TEXT,
    "impression" TEXT,
    "status" "ImagingResultStatus" NOT NULL DEFAULT 'ORDERED',
    "safety_checks" JSONB,
    "acquired_at" TIMESTAMPTZ,
    "reported_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "imaging_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "radiation_exposures" (
    "id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "imaging_result_id" UUID,
    "modality" VARCHAR(10) NOT NULL,
    "body_part" VARCHAR(100),
    "dlp" DECIMAL(10,2),
    "ctdi_vol" DECIMAL(10,2),
    "dose_area_product" DECIMAL(10,3),
    "effective_dose_msv" DECIMAL(8,3),
    "estimated" BOOLEAN NOT NULL DEFAULT false,
    "entered_by" UUID NOT NULL,
    "performed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "radiation_exposures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "claims" (
    "id" UUID NOT NULL,
    "billing_id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "claim_number" VARCHAR(50),
    "claim_date" DATE NOT NULL,
    "claimed_amount" INTEGER NOT NULL,
    "approved_amount" INTEGER,
    "paid_amount" INTEGER,
    "reduced_amount" INTEGER,
    "status" "ClaimStatus" NOT NULL DEFAULT 'DRAFT',
    "submitted_at" TIMESTAMPTZ,
    "reviewed_at" TIMESTAMPTZ,
    "paid_at" TIMESTAMPTZ,
    "reject_reason" TEXT,
    "claim_data" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "claims_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "claim_adjustments" (
    "id" UUID NOT NULL,
    "claim_id" UUID NOT NULL,
    "line_ref" VARCHAR(120),
    "item_name" VARCHAR(200),
    "adjust_code" VARCHAR(20) NOT NULL,
    "adjust_reason" VARCHAR(300),
    "amount" INTEGER NOT NULL,
    "status" VARCHAR(12) NOT NULL DEFAULT 'ACCEPTED',
    "recorded_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "claim_adjustments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wards" (
    "id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "floor" INTEGER NOT NULL,
    "type" VARCHAR(20) NOT NULL DEFAULT 'GENERAL',
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "wards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "beds" (
    "id" UUID NOT NULL,
    "ward_id" UUID NOT NULL,
    "room_number" VARCHAR(20) NOT NULL,
    "bed_number" VARCHAR(10) NOT NULL,
    "status" "BedStatus" NOT NULL DEFAULT 'AVAILABLE',
    "bed_class" VARCHAR(20) NOT NULL DEFAULT 'GENERAL',

    CONSTRAINT "beds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admissions" (
    "id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "bed_id" UUID NOT NULL,
    "admitting_doctor_id" UUID NOT NULL,
    "admit_date" TIMESTAMPTZ NOT NULL,
    "discharge_date" TIMESTAMPTZ,
    "expected_discharge_date" TIMESTAMPTZ,
    "status" "AdmissionStatus" NOT NULL DEFAULT 'ADMITTED',
    "admit_reason" TEXT,
    "discharge_summary" TEXT,
    "diet_type" VARCHAR(100),
    "attending_doctor_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "admissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "interim_billings" (
    "id" UUID NOT NULL,
    "admission_id" UUID NOT NULL,
    "period_start" DATE NOT NULL,
    "period_end" DATE NOT NULL,
    "sequence_no" INTEGER NOT NULL,
    "total_amount" DECIMAL(12,0) NOT NULL DEFAULT 0,
    "insurance_amount" DECIMAL(12,0) NOT NULL DEFAULT 0,
    "copay_amount" DECIMAL(12,0) NOT NULL DEFAULT 0,
    "status" VARCHAR(20) NOT NULL DEFAULT 'GENERATED',
    "paid_at" TIMESTAMPTZ,
    "paid_amount" DECIMAL(12,0),
    "billing_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "interim_billings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "progress_notes" (
    "id" UUID NOT NULL,
    "admission_id" UUID NOT NULL,
    "doctor_id" UUID NOT NULL,
    "note_date" DATE NOT NULL,
    "content" TEXT NOT NULL,
    "vital_signs" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "progress_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "certificates" (
    "id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "issued_by" UUID NOT NULL,
    "type" VARCHAR(50) NOT NULL,
    "content" JSONB NOT NULL,
    "issued_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "certificates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "surgeries" (
    "id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "surgeon_id" UUID NOT NULL,
    "anesthetist_id" UUID,
    "admission_id" UUID,
    "scheduled_at" TIMESTAMPTZ NOT NULL,
    "started_at" TIMESTAMPTZ,
    "ended_at" TIMESTAMPTZ,
    "procedure_name" VARCHAR(500) NOT NULL,
    "procedure_code" VARCHAR(20),
    "body_site" VARCHAR(200),
    "laterality" "Laterality",
    "status" "SurgeryStatus" NOT NULL DEFAULT 'SCHEDULED',
    "pre_op_diagnosis" TEXT,
    "post_op_diagnosis" TEXT,
    "op_note" TEXT,
    "findings" TEXT,
    "complications" TEXT,
    "specimens" TEXT,
    "ebl" INTEGER,
    "fluids_given" VARCHAR(500),
    "implants" TEXT,
    "drains" VARCHAR(500),
    "incision_time" TIMESTAMPTZ,
    "closure_time" TIMESTAMPTZ,
    "assistant_id" UUID,
    "scrub_nurse_id" UUID,
    "anesthesia_type" VARCHAR(50),
    "anesthesia_note" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "surgeries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pre_anesthesia_evaluations" (
    "id" UUID NOT NULL,
    "surgery_id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "evaluator_id" UUID NOT NULL,
    "asa_class" VARCHAR(4),
    "airway_mallampati" VARCHAR(4),
    "npo_confirmed" BOOLEAN NOT NULL DEFAULT false,
    "npo_since" TIMESTAMPTZ,
    "cardiac_risk_rcri" INTEGER,
    "pulmonary_risk" VARCHAR(200),
    "labs_reviewed" BOOLEAN NOT NULL DEFAULT false,
    "anesthesia_consent" BOOLEAN NOT NULL DEFAULT false,
    "plan" VARCHAR(20),
    "status" VARCHAR(12) NOT NULL DEFAULT 'DRAFT',
    "completed_at" TIMESTAMPTZ,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "pre_anesthesia_evaluations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "emergency_visits" (
    "id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "doctor_id" UUID,
    "arrival_at" TIMESTAMPTZ NOT NULL,
    "triage_level" "KtasLevel" NOT NULL,
    "chief_complaint" TEXT NOT NULL,
    "status" VARCHAR(25) NOT NULL DEFAULT 'PENDING_TRIAGE',
    "is_non_emergency" BOOLEAN NOT NULL DEFAULT false,
    "triage_nurse_id" UUID,
    "triaged_at" TIMESTAMPTZ,
    "triage_note" TEXT,
    "vital_signs" JSONB,
    "treatment_note" TEXT,
    "treatment_started_at" TIMESTAMPTZ,
    "disposition" "EmergencyDisposition",
    "disposition_at" TIMESTAMPTZ,
    "disposition_note" TEXT,
    "admission_id" UUID,
    "on_ventilator" BOOLEAN NOT NULL DEFAULT false,
    "mci_event_id" UUID,
    "bed_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "emergency_visits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "emergency_bed_assignments" (
    "id" UUID NOT NULL,
    "visit_id" UUID NOT NULL,
    "bed_id" UUID NOT NULL,
    "assigned_by" UUID NOT NULL,
    "assigned_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "released_at" TIMESTAMPTZ,
    "release_reason" VARCHAR(30),

    CONSTRAINT "emergency_bed_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "emergency_golden_pathways" (
    "id" UUID NOT NULL,
    "visit_id" UUID,
    "patient_id" UUID NOT NULL,
    "pathway_type" VARCHAR(20) NOT NULL,
    "primary_metric" VARCHAR(40) NOT NULL,
    "target_minutes" INTEGER NOT NULL,
    "milestones" JSONB NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    "activated_by" UUID NOT NULL,
    "activated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ,
    "primary_metric_minutes" INTEGER,
    "notes" TEXT,

    CONSTRAINT "emergency_golden_pathways_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "emergency_prenotifications" (
    "id" UUID NOT NULL,
    "source" VARCHAR(20) NOT NULL DEFAULT 'EMS_119',
    "unit_id" VARCHAR(40),
    "eta_minutes" INTEGER,
    "eta_at" TIMESTAMPTZ,
    "patient_age" INTEGER,
    "patient_gender" VARCHAR(10),
    "chief_complaint" TEXT NOT NULL,
    "severity_hint" VARCHAR(20),
    "vitals" JSONB,
    "note" TEXT,
    "status" VARCHAR(20) NOT NULL DEFAULT 'EN_ROUTE',
    "received_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "arrived_at" TIMESTAMPTZ,
    "linked_visit_id" UUID,

    CONSTRAINT "emergency_prenotifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mci_events" (
    "id" UUID NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "type" VARCHAR(20) NOT NULL DEFAULT 'MCI',
    "status" VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    "expected_casualties" INTEGER,
    "note" TEXT,
    "activated_by" UUID NOT NULL,
    "activated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closed_by" UUID,
    "closed_at" TIMESTAMPTZ,

    CONSTRAINT "mci_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "emergency_reassessments" (
    "id" UUID NOT NULL,
    "visit_id" UUID NOT NULL,
    "previous_level" VARCHAR(10) NOT NULL,
    "new_level" VARCHAR(10) NOT NULL,
    "reason" TEXT NOT NULL,
    "vitals" JSONB,
    "assessed_by" UUID NOT NULL,
    "assessed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "emergency_reassessments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "emergency_dispositions" (
    "id" UUID NOT NULL,
    "visit_id" UUID NOT NULL,
    "disposition" VARCHAR(20) NOT NULL,
    "decided_by" UUID NOT NULL,
    "decided_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "discharge_instructions" TEXT,
    "followup_date" TIMESTAMPTZ,
    "admission_id" UUID,
    "transfer_to" VARCHAR(200),
    "transfer_reason" TEXT,

    CONSTRAINT "emergency_dispositions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "emergency_nursing_assessments" (
    "id" UUID NOT NULL,
    "visit_id" UUID NOT NULL,
    "airway" VARCHAR(20) NOT NULL,
    "breathing" VARCHAR(20) NOT NULL,
    "circulation" VARCHAR(20) NOT NULL,
    "gcs_eye" INTEGER,
    "gcs_verbal" INTEGER,
    "gcs_motor" INTEGER,
    "pain_scale" INTEGER,
    "pain_location" VARCHAR(100),
    "assessed_by" UUID NOT NULL,
    "assessed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "emergency_nursing_assessments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_items" (
    "id" UUID NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "erp_item_code" VARCHAR(60),
    "name" VARCHAR(300) NOT NULL,
    "category" VARCHAR(100) NOT NULL,
    "unit" VARCHAR(30) NOT NULL,
    "specification" VARCHAR(500),
    "barcode" VARCHAR(100),
    "gtin" VARCHAR(14),
    "manufacturer" VARCHAR(200),
    "country_of_origin" VARCHAR(50),
    "storage_condition" VARCHAR(100),
    "current_stock" INTEGER NOT NULL DEFAULT 0,
    "safety_stock" INTEGER NOT NULL DEFAULT 10,
    "max_stock" INTEGER,
    "reorder_point" INTEGER,
    "reorder_qty" INTEGER,
    "lead_time_days" INTEGER,
    "supplier_name" VARCHAR(200),
    "unit_price" INTEGER,
    "last_purchase_date" DATE,
    "last_purchase_price" INTEGER,
    "default_storage_id" UUID,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "inventory_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_transactions" (
    "id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "type" "InventoryTxType" NOT NULL,
    "quantity" INTEGER NOT NULL,
    "reason" VARCHAR(500),
    "performed_by" UUID NOT NULL,
    "lot_id" UUID,
    "storage_id" UUID,
    "unit_cost" INTEGER,
    "total_cost" INTEGER,
    "reference_number" VARCHAR(100),
    "department" VARCHAR(100),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_storages" (
    "id" UUID NOT NULL,
    "code" VARCHAR(30) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "type" VARCHAR(50) NOT NULL,
    "location" VARCHAR(200),
    "parent_id" UUID,
    "temperature" VARCHAR(50),
    "capacity" INTEGER,
    "manager_name" VARCHAR(200),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "inventory_storages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_suppliers" (
    "id" UUID NOT NULL,
    "code" VARCHAR(30) NOT NULL,
    "erp_vendor_code" VARCHAR(60),
    "name" VARCHAR(200) NOT NULL,
    "business_number" VARCHAR(20),
    "representative" VARCHAR(100),
    "contact_name" VARCHAR(100),
    "contact_phone" VARCHAR(50),
    "contact_email" VARCHAR(255),
    "address" TEXT,
    "payment_terms" VARCHAR(100),
    "contract_expiry" DATE,
    "rating" VARCHAR(20),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "inventory_suppliers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_item_suppliers" (
    "id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "supplier_id" UUID NOT NULL,
    "supplier_item_code" VARCHAR(100),
    "unit_price" INTEGER,
    "lead_time_days" INTEGER,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "min_order_qty" INTEGER,

    CONSTRAINT "inventory_item_suppliers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_lots" (
    "id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "lot_number" VARCHAR(100) NOT NULL,
    "expiry_date" DATE,
    "manufacture_date" DATE,
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "storage_id" UUID,
    "unit_cost" INTEGER,
    "status" VARCHAR(30) NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "inventory_lots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_orders" (
    "id" UUID NOT NULL,
    "order_number" VARCHAR(30) NOT NULL,
    "supplier_id" UUID NOT NULL,
    "status" VARCHAR(30) NOT NULL DEFAULT 'DRAFT',
    "order_date" DATE NOT NULL,
    "expected_date" DATE,
    "received_date" DATE,
    "total_amount" INTEGER NOT NULL DEFAULT 0,
    "approved_by" UUID,
    "approved_at" TIMESTAMPTZ,
    "notes" TEXT,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "purchase_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_order_items" (
    "id" UUID NOT NULL,
    "purchase_order_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "ordered_qty" INTEGER NOT NULL,
    "received_qty" INTEGER NOT NULL DEFAULT 0,
    "unit_price" INTEGER NOT NULL,
    "amount" INTEGER NOT NULL,
    "lot_number" VARCHAR(100),
    "expiry_date" DATE,
    "notes" TEXT,

    CONSTRAINT "purchase_order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_requests" (
    "id" UUID NOT NULL,
    "request_number" VARCHAR(30) NOT NULL,
    "department" VARCHAR(100) NOT NULL,
    "status" VARCHAR(30) NOT NULL DEFAULT 'REQUESTED',
    "requested_by" UUID NOT NULL,
    "requested_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approved_by" UUID,
    "approved_at" TIMESTAMPTZ,
    "issued_by" UUID,
    "issued_at" TIMESTAMPTZ,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_request_items" (
    "id" UUID NOT NULL,
    "request_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "requested_qty" INTEGER NOT NULL,
    "approved_qty" INTEGER,
    "issued_qty" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,

    CONSTRAINT "inventory_request_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "repack_orders" (
    "id" UUID NOT NULL,
    "order_number" VARCHAR(30) NOT NULL,
    "type" VARCHAR(30) NOT NULL,
    "status" VARCHAR(30) NOT NULL DEFAULT 'DRAFT',
    "target_item_name" VARCHAR(300) NOT NULL,
    "target_item_id" UUID,
    "target_qty" INTEGER NOT NULL,
    "target_unit" VARCHAR(30) NOT NULL,
    "target_storage_id" UUID,
    "instructions" TEXT,
    "performed_by" VARCHAR(200),
    "completed_at" TIMESTAMPTZ,
    "notes" TEXT,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "repack_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "repack_order_items" (
    "id" UUID NOT NULL,
    "repack_order_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "lot_id" UUID,
    "quantity" INTEGER NOT NULL,
    "notes" TEXT,

    CONSTRAINT "repack_order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "qr_labels" (
    "id" UUID NOT NULL,
    "label_type" VARCHAR(30) NOT NULL,
    "reference_id" UUID NOT NULL,
    "reference_name" VARCHAR(300) NOT NULL,
    "reference_code" VARCHAR(100),
    "qr_data" VARCHAR(2000) NOT NULL,
    "print_count" INTEGER NOT NULL DEFAULT 0,
    "last_printed_at" TIMESTAMPTZ,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "qr_labels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_counts" (
    "id" UUID NOT NULL,
    "count_number" VARCHAR(30) NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "storage_id" UUID,
    "category" VARCHAR(50),
    "status" VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
    "scheduled_date" DATE NOT NULL,
    "completed_date" DATE,
    "counted_by" UUID,
    "approved_by" UUID,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "inventory_counts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_count_items" (
    "id" UUID NOT NULL,
    "count_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "system_qty" INTEGER NOT NULL,
    "counted_qty" INTEGER,
    "difference" INTEGER,
    "reason" VARCHAR(200),
    "is_adjusted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "inventory_count_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_feedbacks" (
    "id" UUID NOT NULL,
    "session_id" UUID,
    "user_message" TEXT NOT NULL,
    "ai_response" TEXT NOT NULL,
    "rating" VARCHAR(20) NOT NULL,
    "comment" TEXT,
    "tools_used" TEXT[],
    "latency_ms" INTEGER,
    "model" VARCHAR(50),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_feedbacks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chart_templates" (
    "id" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "department" VARCHAR(50) NOT NULL,
    "role" VARCHAR(30) NOT NULL,
    "category" VARCHAR(50) NOT NULL,
    "description" TEXT,
    "layout" VARCHAR(20) NOT NULL DEFAULT 'tabs',
    "sections" JSONB NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "is_personal" BOOLEAN NOT NULL DEFAULT false,
    "owner_id" UUID,
    "version" VARCHAR(20) NOT NULL DEFAULT '1.0',
    "usage_count" INTEGER NOT NULL DEFAULT 0,
    "last_used_at" TIMESTAMPTZ,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "chart_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_chart_preferences" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "default_template_id" UUID,
    "recent_template_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "favorite_template_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "board_layout" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "user_chart_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_ui_preferences" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "term_lang" VARCHAR(8),
    "ui_locale" VARCHAR(8),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "user_ui_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clinical_chart_results" (
    "id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "encounter_id" UUID,
    "chart_id" VARCHAR(50) NOT NULL,
    "chart_name" VARCHAR(200) NOT NULL,
    "archetype" VARCHAR(20) NOT NULL,
    "source_version" VARCHAR(50),
    "inputs" JSONB NOT NULL,
    "result_label" VARCHAR(200),
    "result_level" VARCHAR(20),
    "result_value" DECIMAL(12,3),
    "recommendation" TEXT,
    "flags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "performed_by" UUID NOT NULL,
    "performed_by_name" VARCHAR(100) NOT NULL,
    "used_tool_version" VARCHAR(20) NOT NULL,
    "performed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "clinical_chart_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clinical_chart_verifications" (
    "id" UUID NOT NULL,
    "chart_id" VARCHAR(50) NOT NULL,
    "status" VARCHAR(20) NOT NULL,
    "source_guideline" VARCHAR(200),
    "source_version" VARCHAR(50),
    "def_hash" VARCHAR(64),
    "note" TEXT,
    "verified_by" UUID NOT NULL,
    "verified_by_name" VARCHAR(100) NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "clinical_chart_verifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "instrument_sets" (
    "id" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "contents" JSONB NOT NULL,
    "status" "SterilizationStatus" NOT NULL DEFAULT 'DIRTY',
    "last_sterilized_at" TIMESTAMPTZ,
    "expires_at" TIMESTAMPTZ,
    "location" VARCHAR(100),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "instrument_sets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sterilization_logs" (
    "id" UUID NOT NULL,
    "instrument_set_id" UUID NOT NULL,
    "action" VARCHAR(50) NOT NULL,
    "performed_by" UUID NOT NULL,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sterilization_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "instrument_set_templates" (
    "id" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "category" VARCHAR(60),
    "packaging_type" VARCHAR(20) NOT NULL DEFAULT 'POUCH',
    "shelf_life_days" INTEGER NOT NULL DEFAULT 30,
    "items" JSONB NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "instrument_set_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sterile_packages" (
    "id" UUID NOT NULL,
    "lot_no" VARCHAR(40) NOT NULL,
    "template_id" UUID NOT NULL,
    "template_name" VARCHAR(200) NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'PACKAGED',
    "packaging_type" VARCHAR(20) NOT NULL DEFAULT 'POUCH',
    "count_verified" BOOLEAN NOT NULL DEFAULT false,
    "count_note" VARCHAR(300),
    "assembled_by" UUID,
    "packaged_at" TIMESTAMPTZ,
    "load_id" UUID,
    "sterilized_at" TIMESTAMPTZ,
    "expires_at" TIMESTAMPTZ,
    "location" VARCHAR(100),
    "used_encounter_id" UUID,
    "used_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sterile_packages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sterilization_loads" (
    "id" UUID NOT NULL,
    "load_no" VARCHAR(40) NOT NULL,
    "sterilizer" VARCHAR(60) NOT NULL,
    "program" VARCHAR(20) NOT NULL DEFAULT 'STEAM',
    "temp_c" INTEGER,
    "duration_min" INTEGER,
    "operator_id" UUID,
    "started_at" TIMESTAMPTZ,
    "finished_at" TIMESTAMPTZ,
    "bi_result" VARCHAR(10) NOT NULL DEFAULT 'PENDING',
    "ci_result" VARCHAR(10) NOT NULL DEFAULT 'PENDING',
    "released_by" UUID,
    "released_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sterilization_loads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "package_events" (
    "id" UUID NOT NULL,
    "package_id" UUID NOT NULL,
    "action" VARCHAR(40) NOT NULL,
    "by" UUID,
    "note" VARCHAR(300),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "package_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_outbox" (
    "id" UUID NOT NULL,
    "domain" VARCHAR(30) NOT NULL,
    "event" VARCHAR(40) NOT NULL,
    "ref" VARCHAR(200) NOT NULL,
    "payload" JSONB NOT NULL,
    "target_url" VARCHAR(400) NOT NULL,
    "status" VARCHAR(10) NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 6,
    "last_error" VARCHAR(300),
    "secret" VARCHAR(200),
    "format" VARCHAR(10),
    "next_attempt_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "integration_outbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "his_webhooks" (
    "id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "target_url" VARCHAR(400) NOT NULL,
    "events" VARCHAR(50)[],
    "secret" VARCHAR(200) NOT NULL,
    "format" VARCHAR(10) NOT NULL DEFAULT 'RAW',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "description" VARCHAR(300),
    "last_delivery_at" TIMESTAMPTZ,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "his_webhooks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "eapproval_relays" (
    "id" UUID NOT NULL,
    "approval_id" VARCHAR(80),
    "doc_type" VARCHAR(30) NOT NULL,
    "title" VARCHAR(300),
    "ref_module" VARCHAR(80) NOT NULL,
    "ref_id" VARCHAR(80) NOT NULL,
    "drafter_clinic_user_id" VARCHAR(80),
    "callback_url" VARCHAR(400) NOT NULL,
    "view_url" VARCHAR(400),
    "status" VARCHAR(12) NOT NULL DEFAULT 'PENDING',
    "result" VARCHAR(12),
    "approval_line" JSONB,
    "idempotency_key" VARCHAR(160),
    "callback_delivered" BOOLEAN NOT NULL DEFAULT false,
    "reminded_at" TIMESTAMPTZ,
    "decided_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "eapproval_relays_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pre_auth_requests" (
    "id" UUID NOT NULL,
    "category" VARCHAR(10) NOT NULL,
    "type" VARCHAR(40) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
    "patient_id" UUID NOT NULL,
    "encounter_id" UUID,
    "requested_by_user_id" UUID,
    "requested_by_patient_id" UUID,
    "payload" JSONB NOT NULL,
    "eapproval_ref" VARCHAR(80),
    "decision" VARCHAR(12),
    "decided_at" TIMESTAMPTZ,
    "fulfilled_ref" VARCHAR(80),
    "fulfilled_type" VARCHAR(30),
    "bypass_reason" VARCHAR(300),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "pre_auth_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "instrument_items" (
    "id" UUID NOT NULL,
    "code" VARCHAR(40) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "category" VARCHAR(40),
    "spec" VARCHAR(100),
    "unit" VARCHAR(20) NOT NULL DEFAULT '개',
    "stock" INTEGER NOT NULL DEFAULT 0,
    "safety_stock" INTEGER NOT NULL DEFAULT 0,
    "location" VARCHAR(100),
    "supplier_id" UUID,
    "unit_price" INTEGER,
    "erp_item_code" VARCHAR(60),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "instrument_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cssd_purchase_orders" (
    "id" UUID NOT NULL,
    "po_no" VARCHAR(40) NOT NULL,
    "supplier_id" UUID,
    "status" VARCHAR(12) NOT NULL DEFAULT 'REQUESTED',
    "note" VARCHAR(300),
    "requested_by" VARCHAR(80),
    "approved_by" VARCHAR(80),
    "approved_at" TIMESTAMP(3),
    "received_at" TIMESTAMP(3),
    "total_amount" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cssd_purchase_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cssd_po_lines" (
    "id" UUID NOT NULL,
    "po_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "item_name" VARCHAR(200) NOT NULL,
    "qty" INTEGER NOT NULL,
    "received_qty" INTEGER NOT NULL DEFAULT 0,
    "unit_price" INTEGER,

    CONSTRAINT "cssd_po_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "suppliers" (
    "id" UUID NOT NULL,
    "erp_vendor_code" VARCHAR(60),
    "name" VARCHAR(200) NOT NULL,
    "contact" VARCHAR(100),
    "phone" VARCHAR(40),
    "email" VARCHAR(120),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supply_transactions" (
    "id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "type" VARCHAR(10) NOT NULL,
    "qty" INTEGER NOT NULL,
    "balance_after" INTEGER NOT NULL,
    "reason" VARCHAR(200),
    "ref" VARCHAR(80),
    "performed_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supply_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff" (
    "id" UUID NOT NULL,
    "user_id" UUID,
    "employee_number" VARCHAR(20) NOT NULL,
    "erp_employee_code" VARCHAR(60),
    "family_name" VARCHAR(100) NOT NULL,
    "given_name" VARCHAR(100) NOT NULL,
    "category" "StaffCategory" NOT NULL,
    "department" VARCHAR(100) NOT NULL,
    "position" VARCHAR(100) NOT NULL,
    "license_number" VARCHAR(50),
    "specialty" VARCHAR(100),
    "hire_date" DATE NOT NULL,
    "resign_date" DATE,
    "status" "EmploymentStatus" NOT NULL DEFAULT 'ACTIVE',
    "phone" VARCHAR(20),
    "email" VARCHAR(255),
    "clinic_user_id" VARCHAR(100),
    "executive_role" VARCHAR(20),
    "manager_staff_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "staff_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_dependents" (
    "id" UUID NOT NULL,
    "staff_id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "relation" VARCHAR(20) NOT NULL,
    "birth_date" DATE,
    "is_dependent" BOOLEAN NOT NULL DEFAULT true,
    "deduction_type" VARCHAR(30),
    "note" VARCHAR(200),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "staff_dependents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_documents" (
    "id" UUID NOT NULL,
    "staff_id" UUID NOT NULL,
    "category" VARCHAR(30) NOT NULL,
    "file_name" VARCHAR(255) NOT NULL,
    "file_key" VARCHAR(300) NOT NULL,
    "mime_type" VARCHAR(100),
    "size_bytes" INTEGER,
    "sensitive" BOOLEAN NOT NULL DEFAULT true,
    "status" VARCHAR(20) NOT NULL DEFAULT 'SUBMITTED',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "staff_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_payroll_relays" (
    "id" UUID NOT NULL,
    "staff_id" UUID NOT NULL,
    "bank_name" VARCHAR(40),
    "bank_account_mask" VARCHAR(40),
    "bank_holder" VARCHAR(60),
    "bank_relayed_at" TIMESTAMPTZ,
    "resident_id_mask" VARCHAR(20),
    "resident_relayed_at" TIMESTAMPTZ,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "staff_payroll_relays_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_schedules" (
    "id" UUID NOT NULL,
    "staff_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "shift_type" VARCHAR(20) NOT NULL,
    "start_time" VARCHAR(5),
    "end_time" VARCHAR(5),
    "notes" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "staff_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meal_orders" (
    "id" UUID NOT NULL,
    "admission_id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "meal_type" VARCHAR(20) NOT NULL,
    "diet_type" VARCHAR(100) NOT NULL,
    "allergies" TEXT,
    "notes" TEXT,
    "status" VARCHAR(20) NOT NULL DEFAULT 'ORDERED',
    "ward_name" VARCHAR(100),
    "undelivered_reason" VARCHAR(50),
    "intake_percent" INTEGER,
    "intake_recorded_by" UUID,
    "intake_recorded_at" TIMESTAMPTZ,
    "leftover_percent" INTEGER,
    "refusal_reason" VARCHAR(100),
    "tray_collected_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "meal_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_meal_menus" (
    "id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "meal_type" VARCHAR(20) NOT NULL,
    "course_type" VARCHAR(10) NOT NULL,
    "menu_name" VARCHAR(200) NOT NULL,
    "description" TEXT,
    "price" INTEGER NOT NULL DEFAULT 0,
    "calories" INTEGER,
    "allergens" VARCHAR(200),
    "image_url" VARCHAR(500),
    "is_special" BOOLEAN NOT NULL DEFAULT false,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "staff_meal_menus_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_meal_requests" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "meal_type" VARCHAR(20) NOT NULL,
    "course_type" VARCHAR(10) NOT NULL DEFAULT 'A',
    "status" VARCHAR(20) NOT NULL DEFAULT 'REQUESTED',
    "cancelled_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "staff_meal_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device_usages" (
    "id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "surgery_id" UUID,
    "encounter_id" UUID,
    "gtin" VARCHAR(14),
    "gtin_valid" BOOLEAN,
    "udi_di" VARCHAR(60),
    "lot_number" VARCHAR(40),
    "serial_number" VARCHAR(40),
    "expiry_date" DATE,
    "expiry_day_unknown" BOOLEAN NOT NULL DEFAULT false,
    "device_name" VARCHAR(300) NOT NULL,
    "manufacturer" VARCHAR(200),
    "usage_type" VARCHAR(20) NOT NULL DEFAULT 'IMPLANT',
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "raw_barcode" VARCHAR(200),
    "unparsed" JSONB,
    "note" VARCHAR(500),
    "used_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attachments" JSONB,
    "recorded_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "device_usages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "equipment" (
    "id" UUID NOT NULL,
    "asset_number" VARCHAR(50) NOT NULL,
    "erp_asset_code" VARCHAR(60),
    "name" VARCHAR(300) NOT NULL,
    "category" VARCHAR(100) NOT NULL,
    "manufacturer" VARCHAR(200),
    "model" VARCHAR(200),
    "serial_number" VARCHAR(100),
    "gtin" VARCHAR(14),
    "udi_di" VARCHAR(60),
    "location" VARCHAR(100),
    "purchase_date" DATE,
    "purchase_price" INTEGER,
    "warranty_expiry" DATE,
    "status" "EquipmentStatus" NOT NULL DEFAULT 'ACTIVE',
    "next_inspection" DATE,
    "next_calibration" DATE,
    "supplier_name" VARCHAR(200),
    "supplier_contact" VARCHAR(100),
    "supplier_phone" VARCHAR(50),
    "as_contact_name" VARCHAR(100),
    "as_contact_phone" VARCHAR(50),
    "notes" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "equipment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "maintenance_logs" (
    "id" UUID NOT NULL,
    "equipment_id" UUID NOT NULL,
    "type" VARCHAR(50) NOT NULL,
    "status" VARCHAR(30) NOT NULL DEFAULT 'COMPLETED',
    "description" TEXT NOT NULL,
    "performed_by" VARCHAR(200),
    "requested_by" VARCHAR(200),
    "cost" INTEGER,
    "vendor" VARCHAR(200),
    "part_replaced" VARCHAR(500),
    "result_notes" TEXT,
    "performed_at" DATE NOT NULL,
    "completed_at" DATE,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "maintenance_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "equipment_parts" (
    "id" UUID NOT NULL,
    "equipment_id" UUID NOT NULL,
    "part_name" VARCHAR(200) NOT NULL,
    "part_number" VARCHAR(100),
    "current_stock" INTEGER NOT NULL DEFAULT 0,
    "min_stock" INTEGER NOT NULL DEFAULT 1,
    "unit_price" INTEGER,
    "supplier" VARCHAR(200),
    "last_ordered_at" DATE,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "equipment_parts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "equipment_usage_logs" (
    "id" UUID NOT NULL,
    "equipment_id" UUID NOT NULL,
    "used_date" DATE NOT NULL,
    "used_by" VARCHAR(200) NOT NULL,
    "department" VARCHAR(100),
    "patient_count" INTEGER,
    "usage_hours" DECIMAL(5,1),
    "purpose" VARCHAR(500),
    "condition" VARCHAR(50),
    "issue_notes" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "equipment_usage_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "equipment_inspection_logs" (
    "id" UUID NOT NULL,
    "equipment_id" UUID NOT NULL,
    "inspection_date" DATE NOT NULL,
    "inspector_name" VARCHAR(200) NOT NULL,
    "inspection_type" VARCHAR(50) NOT NULL,
    "check_items" JSONB NOT NULL,
    "overall_result" VARCHAR(30) NOT NULL,
    "findings" TEXT,
    "action_taken" TEXT,
    "next_inspection_date" DATE,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "equipment_inspection_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bots" (
    "id" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "description" TEXT,
    "trigger_type" "BotTriggerType" NOT NULL,
    "trigger_config" JSONB NOT NULL,
    "action" JSONB NOT NULL,
    "status" "BotStatus" NOT NULL DEFAULT 'ACTIVE',
    "last_run_at" TIMESTAMPTZ,
    "run_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "created_by" UUID NOT NULL,

    CONSTRAINT "bots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bot_executions" (
    "id" UUID NOT NULL,
    "bot_id" UUID NOT NULL,
    "triggered_by" VARCHAR(100),
    "input" JSONB,
    "output" JSONB,
    "success" BOOLEAN NOT NULL,
    "error" TEXT,
    "duration" INTEGER,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bot_executions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dicom_studies" (
    "id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "order_id" UUID,
    "orthanc_study_id" VARCHAR(100) NOT NULL,
    "study_instance_uid" VARCHAR(200) NOT NULL,
    "study_date" DATE,
    "modality" VARCHAR(20) NOT NULL,
    "description" VARCHAR(500),
    "series_count" INTEGER NOT NULL DEFAULT 0,
    "instance_count" INTEGER NOT NULL DEFAULT 0,
    "body_part" VARCHAR(100),
    "referring_doctor" VARCHAR(200),
    "report_status" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dicom_studies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "patient_identification_checks" (
    "id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "check_type" VARCHAR(20) NOT NULL,
    "method" VARCHAR(20) NOT NULL,
    "verified_items" JSONB NOT NULL,
    "verified_by" UUID NOT NULL,
    "verified_at" TIMESTAMPTZ NOT NULL,
    "result" VARCHAR(10) NOT NULL,
    "failure_reason" TEXT,
    "encounter_id" UUID,
    "admission_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "patient_identification_checks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "safety_incidents" (
    "id" UUID NOT NULL,
    "patient_id" UUID,
    "reporter_id" UUID NOT NULL,
    "type" VARCHAR(50) NOT NULL,
    "severity" VARCHAR(20) NOT NULL,
    "description" TEXT NOT NULL,
    "location" VARCHAR(100),
    "occurred_at" TIMESTAMPTZ NOT NULL,
    "action_taken" TEXT,
    "status" VARCHAR(20) NOT NULL DEFAULT 'REPORTED',
    "rca_completed" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "safety_incidents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rca_reports" (
    "id" UUID NOT NULL,
    "incident_id" UUID NOT NULL,
    "findings" TEXT,
    "contributing_factors" JSONB,
    "action_plan" JSONB,
    "owner" UUID,
    "due_at" TIMESTAMPTZ,
    "status" VARCHAR(20) NOT NULL DEFAULT 'OPEN',
    "approved_by" UUID,
    "approved_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "rca_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accreditation_items" (
    "id" VARCHAR(40) NOT NULL,
    "standard" VARCHAR(20) NOT NULL,
    "chapter" VARCHAR(50),
    "name" VARCHAR(200) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    "last_reviewed" DATE,
    "evidence" TEXT,
    "reviewed_by" UUID,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "accreditation_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "early_warning_scores" (
    "id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "nurse_id" UUID NOT NULL,
    "respiratory_rate" INTEGER NOT NULL,
    "sp_o2" INTEGER NOT NULL,
    "supplemental_o2" BOOLEAN NOT NULL DEFAULT false,
    "sp_o2_scale" INTEGER NOT NULL DEFAULT 1,
    "systolic_bp" INTEGER NOT NULL,
    "heart_rate" INTEGER NOT NULL,
    "consciousness" VARCHAR(15) NOT NULL,
    "temperature" DECIMAL(4,1) NOT NULL,
    "total_score" INTEGER NOT NULL,
    "risk_level" VARCHAR(15) NOT NULL,
    "score_breakdown" JSONB NOT NULL,
    "escalation_required" BOOLEAN NOT NULL DEFAULT false,
    "escalation_notified" BOOLEAN NOT NULL DEFAULT false,
    "escalation_notified_at" TIMESTAMPTZ,
    "recorded_at" TIMESTAMPTZ NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "early_warning_scores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fall_risk_assessments" (
    "id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "assessor_id" UUID NOT NULL,
    "score" INTEGER NOT NULL,
    "risk_level" VARCHAR(20) NOT NULL,
    "factors" JSONB NOT NULL,
    "interventions" JSONB,
    "assessed_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "fall_risk_assessments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "infection_surveillance" (
    "id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "infection_type" VARCHAR(100) NOT NULL,
    "organism" VARCHAR(200),
    "isolation_type" VARCHAR(50),
    "detected_at" TIMESTAMPTZ NOT NULL,
    "resolved_at" TIMESTAMPTZ,
    "reported_to_kcdc" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "infection_surveillance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hai_cases" (
    "id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "hai_type" VARCHAR(20) NOT NULL,
    "organism" VARCHAR(200),
    "device_type" VARCHAR(50),
    "device_inserted_at" TIMESTAMPTZ,
    "device_days" INTEGER,
    "site" VARCHAR(100),
    "onset_at" TIMESTAMPTZ NOT NULL,
    "ward" VARCHAR(50),
    "criteria_met" TEXT,
    "status" VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    "reported_to_konis" BOOLEAN NOT NULL DEFAULT false,
    "detected_by" UUID,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hai_cases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mdro_registry" (
    "id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "organism" VARCHAR(200) NOT NULL,
    "mdro_type" VARCHAR(20) NOT NULL,
    "mechanism" VARCHAR(100),
    "specimen" VARCHAR(50),
    "ward" VARCHAR(50),
    "detected_at" TIMESTAMPTZ NOT NULL,
    "cleared_at" TIMESTAMPTZ,
    "isolation_type" VARCHAR(50),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mdro_registry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifiable_disease_reports" (
    "id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "disease_name" VARCHAR(100) NOT NULL,
    "disease_grade" VARCHAR(10),
    "kcdc_code" VARCHAR(20),
    "diagnosis_type" VARCHAR(30),
    "status" VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
    "submitted_at" TIMESTAMPTZ,
    "ack_at" TIMESTAMPTZ,
    "report_ref" VARCHAR(50),
    "error_log" TEXT,
    "reported_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifiable_disease_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quality_indicators" (
    "id" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "category" VARCHAR(100) NOT NULL,
    "formula" TEXT NOT NULL,
    "target_value" DECIMAL(5,2) NOT NULL,
    "direction" VARCHAR(20),
    "unit" VARCHAR(20),
    "value_scale" INTEGER,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "quality_indicators_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "qi_measurements" (
    "id" UUID NOT NULL,
    "indicator_id" UUID NOT NULL,
    "period" VARCHAR(20) NOT NULL,
    "numerator" INTEGER NOT NULL,
    "denominator" INTEGER NOT NULL,
    "value" DECIMAL(5,2) NOT NULL,
    "meet_target" BOOLEAN,
    "notes" TEXT,
    "measured_at" TIMESTAMPTZ NOT NULL,
    "voided_at" TIMESTAMPTZ,
    "voided_by" UUID,
    "void_reason" TEXT,

    CONSTRAINT "qi_measurements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consent_forms" (
    "id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "type" VARCHAR(50) NOT NULL,
    "template_name" VARCHAR(200) NOT NULL,
    "content" JSONB NOT NULL,
    "signed_by" VARCHAR(100),
    "signed_at" TIMESTAMPTZ,
    "witness_id" UUID,
    "expires_at" TIMESTAMPTZ,
    "is_valid" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "template_id" UUID,
    "consent_type" "ConsentType",
    "encounter_id" UUID,
    "surgery_id" UUID,
    "risks" TEXT,
    "alternatives" TEXT,
    "patient_signature" TEXT,
    "attachments" JSONB,
    "patient_signed_at" TIMESTAMPTZ,
    "patient_signed_by" VARCHAR(100),
    "witness_signed_at" TIMESTAMPTZ,
    "doctor_id" UUID,
    "doctor_signed_at" TIMESTAMPTZ,
    "status" "ConsentStatus" DEFAULT 'PENDING',
    "revoked_at" TIMESTAMPTZ,
    "revoked_reason" TEXT,
    "superseded_by" VARCHAR(80),
    "superseded_at" TIMESTAMPTZ,
    "requested_by" UUID,
    "nurse_id" UUID,
    "nurse_checked_at" TIMESTAMPTZ,
    "nurse_checked_by" UUID,
    "doctor_signature_image" TEXT,
    "nurse_signature_image" TEXT,
    "witness_signature_image" TEXT,
    "explanation" TEXT,
    "sign_mode" VARCHAR(20),
    "signer_type" VARCHAR(20),
    "guardian_name" VARCHAR(100),
    "guardian_relation" VARCHAR(30),
    "guardian_legal_basis" VARCHAR(50),
    "sign_provider" VARCHAR(20) DEFAULT 'EXTERNAL',
    "signature_request_id" VARCHAR(64),
    "sign_status" VARCHAR(24),
    "sign_participant_id" VARCHAR(64),
    "sign_cert_serial" VARCHAR(64),
    "audit_cert_uri" TEXT,
    "sign_key_custody" VARCHAR(20),
    "sign_assurance_level" VARCHAR(20),
    "sign_attestation_ref" VARCHAR(500),
    "sign_tsa_token" TEXT,

    CONSTRAINT "consent_forms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consent_sign_sessions" (
    "id" UUID NOT NULL,
    "consent_id" UUID NOT NULL,
    "token" VARCHAR(64) NOT NULL,
    "signMode" VARCHAR(20) NOT NULL,
    "signerType" VARCHAR(20) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'OPEN',
    "created_by" UUID NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "signed_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consent_sign_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consent_signing_devices" (
    "id" UUID NOT NULL,
    "device_uid" VARCHAR(64) NOT NULL,
    "device_secret" VARCHAR(64),
    "name" VARCHAR(100) NOT NULL,
    "location" VARCHAR(100),
    "approval_status" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    "approved_by" UUID,
    "approved_at" TIMESTAMPTZ,
    "status" VARCHAR(20) NOT NULL DEFAULT 'IDLE',
    "current_consent_id" UUID,
    "current_token" VARCHAR(64),
    "last_seen_at" TIMESTAMPTZ,
    "user_agent" VARCHAR(300),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consent_signing_devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device_pairing_codes" (
    "id" UUID NOT NULL,
    "code" VARCHAR(8) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    "created_by" UUID NOT NULL,
    "used_by_device_id" UUID,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "used_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "device_pairing_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consent_templates" (
    "id" UUID NOT NULL,
    "type" VARCHAR(50) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "language" VARCHAR(10) NOT NULL DEFAULT 'ko',
    "version" VARCHAR(20) NOT NULL,
    "content" JSONB NOT NULL,
    "required_fields" JSONB NOT NULL,
    "description" VARCHAR(500),
    "components" JSONB,
    "variables" JSONB,
    "legal_checks" JSONB,
    "last_edited_by" UUID,
    "parent_id" UUID,
    "is_latest" BOOLEAN NOT NULL DEFAULT true,
    "change_log" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "consent_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "education_programs" (
    "id" UUID NOT NULL,
    "name" VARCHAR(300) NOT NULL,
    "category" VARCHAR(100) NOT NULL,
    "is_mandatory" BOOLEAN NOT NULL DEFAULT false,
    "valid_months" INTEGER NOT NULL DEFAULT 12,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "education_programs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "education_completions" (
    "id" UUID NOT NULL,
    "program_id" UUID NOT NULL,
    "staff_id" UUID NOT NULL,
    "completed_at" TIMESTAMPTZ NOT NULL,
    "expires_at" TIMESTAMPTZ,
    "score" INTEGER,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "education_completions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "problem_lists" (
    "id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "diagnosis_code_id" UUID NOT NULL,
    "description" VARCHAR(500) NOT NULL,
    "status" "ProblemStatus" NOT NULL DEFAULT 'ACTIVE',
    "severity" "ProblemSeverity" NOT NULL DEFAULT 'MODERATE',
    "onset_date" DATE,
    "resolved_date" DATE,
    "added_by" UUID NOT NULL,
    "added_encounter_id" UUID,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "problem_lists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "allergies" (
    "id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "type" "AllergyType" NOT NULL,
    "allergen" VARCHAR(300) NOT NULL,
    "allergen_code" VARCHAR(50),
    "reaction" VARCHAR(500) NOT NULL,
    "severity" "AllergySeverity" NOT NULL,
    "onset_date" DATE,
    "verification_status" "AllergyVerification" NOT NULL DEFAULT 'UNCONFIRMED',
    "reported_by" VARCHAR(100) NOT NULL,
    "recorded_by" UUID NOT NULL,
    "notes" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "allergies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "allergy_assessments" (
    "id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "result" "AllergyAssessmentResult" NOT NULL,
    "encounter_id" UUID,
    "note" TEXT,
    "assessed_by" UUID NOT NULL,
    "assessed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "allergy_assessments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "isolation_protocols" (
    "id" UUID NOT NULL,
    "isolation_type" VARCHAR(20) NOT NULL,
    "standard_duration_days" INTEGER NOT NULL,
    "required_ppe" JSONB NOT NULL,
    "environmental_measures" JSONB NOT NULL,
    "visitation_policy" VARCHAR(100) NOT NULL,
    "staff_education_required" BOOLEAN NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "source" VARCHAR(40),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "isolation_protocols_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "isolation_precautions" (
    "id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "admission_id" UUID,
    "type" "IsolationPrecautionType" NOT NULL,
    "status" "IsolationPrecautionStatus" NOT NULL DEFAULT 'ACTIVE',
    "reason" VARCHAR(500) NOT NULL,
    "organism" VARCHAR(200),
    "room_number" VARCHAR(30),
    "start_date" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expected_end_date" DATE,
    "end_date" TIMESTAMPTZ,
    "ordered_by" UUID NOT NULL,
    "discontinued_by" UUID,
    "discontinue_reason" VARCHAR(500),
    "notes" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "isolation_precautions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reference_ranges" (
    "id" UUID NOT NULL,
    "test_code" VARCHAR(50),
    "loinc_code" VARCHAR(20),
    "test_name" VARCHAR(200),
    "sex" "RefRangeSex" NOT NULL DEFAULT 'ANY',
    "age_min_years" INTEGER,
    "age_max_years" INTEGER,
    "age_min_months" INTEGER,
    "age_max_months" INTEGER,
    "specimen" VARCHAR(50),
    "low" DECIMAL(12,3),
    "high" DECIMAL(12,3),
    "critical_low" DECIMAL(12,3),
    "critical_high" DECIMAL(12,3),
    "unit" VARCHAR(20),
    "text_normal" VARCHAR(100),
    "source" VARCHAR(50),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "reference_ranges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "discharge_summaries" (
    "id" UUID NOT NULL,
    "admission_id" UUID NOT NULL,
    "doctor_id" UUID NOT NULL,
    "admit_date" DATE NOT NULL,
    "discharge_date" DATE NOT NULL,
    "admit_diagnosis" TEXT NOT NULL,
    "discharge_diagnosis" TEXT NOT NULL,
    "diagnosis_codes" JSONB NOT NULL,
    "hospital_course" TEXT NOT NULL,
    "procedures" TEXT,
    "significant_findings" TEXT,
    "condition_at_discharge" VARCHAR(200) NOT NULL,
    "discharge_medications" JSONB NOT NULL,
    "follow_up_plan" TEXT NOT NULL,
    "follow_up_date" DATE,
    "dietary_instructions" TEXT,
    "activity_restrictions" TEXT,
    "patient_education" TEXT,
    "status" "DischargeSummaryStatus" NOT NULL DEFAULT 'DRAFT',
    "signed_at" TIMESTAMPTZ,
    "signed_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "discharge_summaries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "nursing_assessments" (
    "id" UUID NOT NULL,
    "admission_id" UUID NOT NULL,
    "nurse_id" UUID NOT NULL,
    "consciousness" VARCHAR(20) NOT NULL,
    "mobility" VARCHAR(50) NOT NULL,
    "pain_score" INTEGER NOT NULL,
    "pain_location" VARCHAR(100),
    "nutrition_status" VARCHAR(50) NOT NULL,
    "skin_integrity" VARCHAR(50) NOT NULL,
    "fall_risk_assessment_id" UUID,
    "braden_score" INTEGER,
    "allergy_confirmed" BOOLEAN NOT NULL DEFAULT false,
    "additional_data" JSONB,
    "assessed_at" TIMESTAMPTZ NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "nursing_assessments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "nursing_diagnoses" (
    "id" UUID NOT NULL,
    "assessment_id" UUID NOT NULL,
    "nurse_id" UUID NOT NULL,
    "nanda_code" VARCHAR(20) NOT NULL,
    "nanda_name" VARCHAR(300) NOT NULL,
    "related_factors" TEXT,
    "defining_characteristics" TEXT,
    "expected_outcome" TEXT NOT NULL,
    "status" "NursingDiagnosisStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "nursing_diagnoses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "nursing_notes" (
    "id" UUID NOT NULL,
    "admission_id" UUID NOT NULL,
    "nurse_id" UUID NOT NULL,
    "note_type" "NursingNoteType" NOT NULL,
    "focus" VARCHAR(200),
    "data" TEXT,
    "action" TEXT,
    "response" TEXT,
    "content" TEXT,
    "subjective" TEXT,
    "objective" TEXT,
    "assessment" TEXT,
    "plan" TEXT,
    "education" TEXT,
    "shift_type" "ShiftType" NOT NULL,
    "priority" VARCHAR(10),
    "photo_urls" JSONB,
    "recorded_at" TIMESTAMPTZ NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" VARCHAR(12) NOT NULL DEFAULT 'SIGNED',
    "signed_at" TIMESTAMPTZ,
    "signed_by" UUID,
    "ai_assisted" BOOLEAN NOT NULL DEFAULT false,
    "ai_model" VARCHAR(80),
    "ai_prompt_version" VARCHAR(40),
    "ai_source_snapshot" JSONB,
    "ai_edit_distance" INTEGER,
    "cosign_status" VARCHAR(12),
    "cosigned_by" UUID,
    "cosigned_at" TIMESTAMPTZ,

    CONSTRAINT "nursing_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "nursing_interventions" (
    "id" UUID NOT NULL,
    "nursing_diagnosis_id" UUID NOT NULL,
    "nic_code" VARCHAR(20),
    "name" VARCHAR(300) NOT NULL,
    "detail" TEXT,
    "frequency" VARCHAR(100),
    "status" VARCHAR(15) NOT NULL DEFAULT 'PLANNED',
    "performed_by" UUID,
    "performed_at" TIMESTAMPTZ,
    "performed_note" TEXT,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "nursing_interventions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "nursing_outcomes" (
    "id" UUID NOT NULL,
    "nursing_diagnosis_id" UUID NOT NULL,
    "noc_code" VARCHAR(20),
    "name" VARCHAR(300) NOT NULL,
    "baseline_score" INTEGER,
    "target_score" INTEGER,
    "current_score" INTEGER,
    "status" VARCHAR(15) NOT NULL DEFAULT 'NOT_MET',
    "evaluated_at" TIMESTAMPTZ,
    "evaluated_by" UUID,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "nursing_outcomes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "intake_outputs" (
    "id" UUID NOT NULL,
    "admission_id" UUID NOT NULL,
    "nurse_id" UUID NOT NULL,
    "recorded_at" TIMESTAMPTZ NOT NULL,
    "intake_type" "IntakeType",
    "intake_amount" INTEGER,
    "intake_detail" VARCHAR(200),
    "output_type" "OutputType",
    "output_amount" INTEGER,
    "output_detail" VARCHAR(200),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "intake_outputs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "medication_administrations" (
    "id" UUID NOT NULL,
    "prescription_id" UUID NOT NULL,
    "order_id" UUID,
    "dispensing_id" UUID,
    "compounding_order_id" UUID,
    "patient_band_scan" VARCHAR(40),
    "med_scan" VARCHAR(60),
    "bcma_scan_at" TIMESTAMPTZ,
    "nurse_id" UUID,
    "patient_id" UUID NOT NULL,
    "scheduled_at" TIMESTAMPTZ NOT NULL,
    "administered_at" TIMESTAMPTZ,
    "status" "MedAdminStatus" NOT NULL DEFAULT 'SCHEDULED',
    "hold_reason" VARCHAR(500),
    "route" VARCHAR(20) NOT NULL,
    "dose" VARCHAR(100) NOT NULL,
    "verified_by" UUID,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "medication_administrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clinic_schedules" (
    "id" UUID NOT NULL,
    "doctor_id" UUID NOT NULL,
    "department_name" VARCHAR(100) NOT NULL,
    "room_name" VARCHAR(100) NOT NULL,
    "day_of_week" INTEGER NOT NULL,
    "period" VARCHAR(10) NOT NULL,
    "start_time" VARCHAR(5) NOT NULL,
    "end_time" VARCHAR(5) NOT NULL,
    "max_patients" INTEGER NOT NULL DEFAULT 20,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "clinic_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clinic_closures" (
    "id" UUID NOT NULL,
    "doctor_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "period" VARCHAR(10),
    "reason" VARCHAR(200) NOT NULL,
    "substitute_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "clinic_closures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "waiting_queue" (
    "id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "doctor_id" UUID NOT NULL,
    "department_name" VARCHAR(100) NOT NULL,
    "room_name" VARCHAR(100),
    "queue_number" INTEGER NOT NULL,
    "type" VARCHAR(20) NOT NULL DEFAULT 'WALK_IN',
    "visitType" VARCHAR(20) NOT NULL DEFAULT 'INITIAL',
    "reason" TEXT,
    "status" VARCHAR(20) NOT NULL DEFAULT 'WAITING',
    "appointment_id" UUID,
    "encounter_id" UUID,
    "waiting_token" VARCHAR(64),
    "call_count" INTEGER NOT NULL DEFAULT 0,
    "priority_order" INTEGER,
    "checked_in_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "called_at" TIMESTAMPTZ,
    "started_at" TIMESTAMPTZ,
    "completed_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "eligibility_status" VARCHAR(16),
    "eligibility_check_id" UUID,
    "identity_verified_at" TIMESTAMPTZ,

    CONSTRAINT "waiting_queue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "drug_standard_codes" (
    "id" UUID NOT NULL,
    "insurance_code" VARCHAR(16) NOT NULL,
    "product_name" VARCHAR(300) NOT NULL,
    "manufacturer" VARCHAR(200),
    "spec" VARCHAR(100),
    "standard_code" VARCHAR(20),
    "ingredient_code" VARCHAR(20),
    "atc_code" VARCHAR(20),
    "dosage_form" VARCHAR(40),
    "rx_otc" VARCHAR(20),
    "base_code" VARCHAR(20),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "drug_standard_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "eligibility_checks" (
    "id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "insurance_type" "InsuranceType" NOT NULL,
    "status" VARCHAR(16) NOT NULL,
    "copay_category" VARCHAR(24) NOT NULL,
    "coverage_start_date" TIMESTAMPTZ,
    "coverage_end_date" TIMESTAMPTZ,
    "special_exemption" VARCHAR(40),
    "exemption_expiry" TIMESTAMPTZ,
    "source" VARCHAR(12) NOT NULL,
    "visit_type" VARCHAR(12),
    "raw_response" JSONB,
    "message" VARCHAR(200),
    "checked_by_id" UUID,
    "queried_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "eligibility_checks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "display_api_keys" (
    "id" UUID NOT NULL,
    "key" VARCHAR(100) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "board_type" VARCHAR(30),
    "config" JSONB,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_used_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "display_api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "encounter_templates" (
    "id" UUID NOT NULL,
    "department" VARCHAR(50) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "description" TEXT,
    "soap_sections" JSONB NOT NULL,
    "version" VARCHAR(20) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "encounter_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "text_macros" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "category" VARCHAR(20) NOT NULL,
    "shortcut" VARCHAR(50) NOT NULL,
    "content" TEXT NOT NULL,
    "is_shared" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "text_macros_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "medical_record_copies" (
    "id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "requested_by" VARCHAR(100) NOT NULL,
    "requestor_relation" VARCHAR(50) NOT NULL,
    "purpose" VARCHAR(200) NOT NULL,
    "record_types" JSONB NOT NULL,
    "date_range" JSONB,
    "issued_by" UUID NOT NULL,
    "issued_at" TIMESTAMPTZ NOT NULL,
    "copy_count" INTEGER NOT NULL,
    "fee" INTEGER NOT NULL,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "medical_record_copies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "break_the_glass_accesses" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "accessed_at" TIMESTAMPTZ NOT NULL,
    "resource_type" VARCHAR(50) NOT NULL,
    "resource_id" UUID,
    "reviewed_by" UUID,
    "reviewed_at" TIMESTAMPTZ,
    "is_approved" BOOLEAN,

    CONSTRAINT "break_the_glass_accesses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webauthn_credentials" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "credential_id" TEXT NOT NULL,
    "public_key" BYTEA NOT NULL,
    "counter" BIGINT NOT NULL DEFAULT 0,
    "transports" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "aaguid" VARCHAR(64),
    "backed_up" BOOLEAN NOT NULL DEFAULT false,
    "device_name" VARCHAR(100),
    "device_id" UUID,
    "status" VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMPTZ,

    CONSTRAINT "webauthn_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_installation_keys" (
    "id" UUID NOT NULL,
    "app" VARCHAR(20) NOT NULL,
    "installation_id" VARCHAR(64) NOT NULL,
    "apple_key_id" VARCHAR(128) NOT NULL,
    "public_key" BYTEA NOT NULL,
    "public_key_fingerprint" VARCHAR(64) NOT NULL,
    "receipt_encrypted" TEXT,
    "attestation_environment" VARCHAR(12) NOT NULL,
    "attestation_level" VARCHAR(24) NOT NULL DEFAULT 'APP_ATTEST',
    "bundle_id" VARCHAR(100) NOT NULL,
    "bundle_version" VARCHAR(30),
    "status" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    "patient_account_id" UUID,
    "staff_user_id" UUID,
    "staff_device_id" UUID,
    "patient_device_id" UUID,
    "assertion_counter" BIGINT NOT NULL DEFAULT 0,
    "attested_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "bound_at" TIMESTAMPTZ,
    "last_asserted_at" TIMESTAMPTZ,
    "rotated_at" TIMESTAMPTZ,
    "revoked_at" TIMESTAMPTZ,
    "revoke_reason" VARCHAR(255),
    "replaced_by_key_id" UUID,

    CONSTRAINT "app_installation_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "identity_verifications" (
    "id" UUID NOT NULL,
    "provider" VARCHAR(40) NOT NULL,
    "purpose" VARCHAR(40) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'STARTED',
    "installation_id" VARCHAR(64),
    "app_key_id" UUID,
    "provider_tx_ref" VARCHAR(200),
    "state_nonce" VARCHAR(128) NOT NULL,
    "ci_encrypted" TEXT,
    "ci_lookup_hash" VARCHAR(64),
    "verified_name" VARCHAR(100),
    "verified_birth" VARCHAR(10),
    "verified_gender" VARCHAR(10),
    "verified_phone" VARCHAR(20),
    "matched_patient_id" UUID,
    "failure_code" VARCHAR(40),
    "expires_at" TIMESTAMPTZ NOT NULL,
    "verified_at" TIMESTAMPTZ,
    "consumed_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "identity_verifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_devices" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "device_name" VARCHAR(100) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    "enroll_channel" VARCHAR(20) NOT NULL DEFAULT 'ADMIN_QR',
    "enroll_mode" VARCHAR(20) NOT NULL DEFAULT 'REMOTE',
    "enrolled_by" UUID,
    "fcm_token" TEXT,
    "fcm_token_at" TIMESTAMPTZ,
    "verified_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMPTZ,
    "expires_at" TIMESTAMPTZ,
    "re_enroll_due_at" TIMESTAMPTZ,
    "lost_reported_at" TIMESTAMPTZ,
    "replaced_by_id" UUID,
    "revoked_at" TIMESTAMPTZ,
    "revoke_reason" VARCHAR(255),

    CONSTRAINT "staff_devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "terminal_registry" (
    "id" UUID NOT NULL,
    "device_uuid" VARCHAR(128) NOT NULL,
    "ip_address" VARCHAR(45),
    "mac_address" VARCHAR(32),
    "mode" VARCHAR(8) NOT NULL DEFAULT 'PUBLIC',
    "dedicated_user_id" UUID,
    "location" VARCHAR(120),
    "label" VARCHAR(120),
    "beacon_id" VARCHAR(64),
    "status" VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    "lock_timeout_sec" INTEGER,
    "registered_by_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "terminal_registry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_consent" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "location_consent" BOOLEAN NOT NULL DEFAULT false,
    "biometric_consent" BOOLEAN NOT NULL DEFAULT false,
    "passkey_consent" BOOLEAN NOT NULL DEFAULT false,
    "consent_doc_id" UUID,
    "consented_at" TIMESTAMPTZ,
    "revoked_at" TIMESTAMPTZ,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "staff_consent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "retention_policy" (
    "id" UUID NOT NULL,
    "resource_type" VARCHAR(40) NOT NULL,
    "retention_days" INTEGER NOT NULL,
    "legal_min_days" INTEGER NOT NULL DEFAULT 0,
    "action" VARCHAR(16) NOT NULL DEFAULT 'REPORT_ONLY',
    "legal_confirmed" BOOLEAN NOT NULL DEFAULT false,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "description" VARCHAR(200),
    "last_run_at" TIMESTAMPTZ,
    "last_candidates" INTEGER,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "retention_policy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_calls" (
    "id" UUID NOT NULL,
    "type" VARCHAR(20) NOT NULL,
    "severity" VARCHAR(20) NOT NULL DEFAULT 'NORMAL',
    "sender_id" UUID NOT NULL,
    "target_kind" VARCHAR(20) NOT NULL,
    "target_ref" VARCHAR(100),
    "message" TEXT,
    "patient_ref" UUID,
    "status" VARCHAR(20) NOT NULL DEFAULT 'OPEN',
    "location" VARCHAR(100),
    "cancelled_by" UUID,
    "escalated_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "staff_calls_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "code_blue_events" (
    "id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "admission_id" UUID,
    "staff_call_id" UUID,
    "location" VARCHAR(100) NOT NULL,
    "recognized_at" TIMESTAMPTZ NOT NULL,
    "team_arrived_at" TIMESTAMPTZ,
    "cpr_started_at" TIMESTAMPTZ,
    "rosc_at" TIMESTAMPTZ,
    "ended_at" TIMESTAMPTZ,
    "defibrillation_count" INTEGER NOT NULL DEFAULT 0,
    "medications" JSONB,
    "outcome" "CodeBlueOutcome" NOT NULL DEFAULT 'ONGOING',
    "notes" TEXT,
    "recorded_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "code_blue_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rrt_activations" (
    "id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "ews_id" UUID,
    "trigger" "RrtTrigger" NOT NULL DEFAULT 'DIRECT_CALL',
    "activated_at" TIMESTAMPTZ NOT NULL,
    "responded_at" TIMESTAMPTZ,
    "responder_team" VARCHAR(100),
    "reason" TEXT,
    "outcome" "RrtOutcome" NOT NULL DEFAULT 'ONGOING',
    "recorded_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "rrt_activations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_call_acks" (
    "id" UUID NOT NULL,
    "call_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "response" VARCHAR(20) NOT NULL,
    "acked_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "staff_call_acks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_emergency_access" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "approvers" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "approval_kind" VARCHAR(20) NOT NULL,
    "scope" VARCHAR(100) NOT NULL DEFAULT 'FULL',
    "granted_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "reviewed_by" UUID,
    "reviewed_at" TIMESTAMPTZ,

    CONSTRAINT "auth_emergency_access_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account_recoveries" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "reason" TEXT,
    "status" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    "approvers" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "token_hash" VARCHAR(128),
    "expires_at" TIMESTAMPTZ,
    "requested_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approved_at" TIMESTAMPTZ,
    "completed_at" TIMESTAMPTZ,

    CONSTRAINT "account_recoveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_permission_grants" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "permission" VARCHAR(40) NOT NULL,
    "granted_by" UUID NOT NULL,
    "expires_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_permission_grants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_approvals" (
    "id" UUID NOT NULL,
    "action" VARCHAR(40) NOT NULL,
    "target_type" VARCHAR(30) NOT NULL,
    "target_id" VARCHAR(64) NOT NULL,
    "payload" JSONB,
    "requested_by" UUID NOT NULL,
    "approved_by" UUID,
    "status" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    "reason" TEXT,
    "requested_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_at" TIMESTAMPTZ,
    "expires_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "admin_approvals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_policies" (
    "id" UUID NOT NULL,
    "scope" VARCHAR(20) NOT NULL,
    "scope_ref" VARCHAR(50) NOT NULL DEFAULT '*',
    "re_enroll_days" INTEGER NOT NULL DEFAULT 180,
    "idle_expire_days" INTEGER NOT NULL DEFAULT 60,
    "cert_validity_days" INTEGER NOT NULL DEFAULT 365,
    "expiry_warn_days" INTEGER NOT NULL DEFAULT 14,
    "max_devices" INTEGER NOT NULL DEFAULT 3,
    "in_person_roles" TEXT[] DEFAULT ARRAY['DOCTOR']::TEXT[],
    "synced_passkey" VARCHAR(20) NOT NULL DEFAULT 'ROLE_BASED',
    "updated_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "auth_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vip_patients" (
    "id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "designated_by" UUID NOT NULL,
    "reason" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vip_patients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "questionnaire_tokens" (
    "id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "form_schema_id" UUID NOT NULL,
    "appointment_id" UUID,
    "token" VARCHAR(100) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'SENT',
    "sent_via" VARCHAR(20),
    "expires_at" TIMESTAMPTZ NOT NULL,
    "opened_at" TIMESTAMPTZ,
    "completed_at" TIMESTAMPTZ,
    "reviewed_by" UUID,
    "reviewed_at" TIMESTAMPTZ,
    "reminder_sent_at" TIMESTAMPTZ,
    "submission_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "questionnaire_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_subscriptions" (
    "id" UUID NOT NULL,
    "url" VARCHAR(500) NOT NULL,
    "events" VARCHAR(50)[],
    "secret" VARCHAR(200) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clinic_sync_logs" (
    "id" UUID NOT NULL,
    "sync_type" VARCHAR(50) NOT NULL,
    "status" VARCHAR(20) NOT NULL,
    "total_sent" INTEGER NOT NULL,
    "registered" INTEGER NOT NULL DEFAULT 0,
    "skipped" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "details" JSONB,
    "error_message" TEXT,
    "executed_by" UUID NOT NULL,
    "executed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "clinic_sync_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_sets" (
    "id" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "code" VARCHAR(30),
    "department" VARCHAR(50),
    "category" VARCHAR(30) NOT NULL,
    "diagnosis_code" VARCHAR(20),
    "description" TEXT,
    "items" JSONB NOT NULL,
    "is_shared" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    "applicable_to" VARCHAR(30),
    "age_group" VARCHAR(20),
    "contraindications" JSONB,
    "evidence_level" VARCHAR(10),
    "guideline_ref" VARCHAR(200),
    "created_by" UUID,
    "approved_by" UUID,
    "approved_at" TIMESTAMPTZ,
    "use_count" INTEGER NOT NULL DEFAULT 0,
    "last_used_at" TIMESTAMPTZ,
    "parent_id" UUID,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "order_sets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "treatment_schedule_templates" (
    "id" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "department" VARCHAR(50),
    "description" TEXT,
    "status" VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "parent_id" UUID,
    "total_days" INTEGER NOT NULL DEFAULT 28,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" UUID,
    "approved_by" UUID,
    "approved_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "treatment_schedule_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "treatment_template_items" (
    "id" UUID NOT NULL,
    "template_id" UUID NOT NULL,
    "day_offset" INTEGER NOT NULL,
    "time_of_day" VARCHAR(5),
    "item_type" VARCHAR(20) NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "ref_code_id" UUID,
    "repeat_every" INTEGER,
    "repeat_count" INTEGER,
    "is_default" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "notes" VARCHAR(300),

    CONSTRAINT "treatment_template_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "patient_treatment_schedules" (
    "id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "encounter_id" UUID,
    "template_id" UUID,
    "name" VARCHAR(200) NOT NULL,
    "anchor_date" DATE NOT NULL,
    "status" VARCHAR(15) NOT NULL DEFAULT 'ACTIVE',
    "created_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "patient_treatment_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "patient_schedule_items" (
    "id" UUID NOT NULL,
    "schedule_id" UUID NOT NULL,
    "planned_at" TIMESTAMPTZ NOT NULL,
    "item_type" VARCHAR(20) NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "status" VARCHAR(15) NOT NULL DEFAULT 'PLANNED',
    "ref_type" VARCHAR(20),
    "ref_id" UUID,
    "notes" VARCHAR(300),
    "reminded_at" TIMESTAMPTZ,

    CONSTRAINT "patient_schedule_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "treatment_template_diagnoses" (
    "id" UUID NOT NULL,
    "template_id" UUID NOT NULL,
    "diagnosis_code" VARCHAR(20) NOT NULL,
    "match_type" VARCHAR(10) NOT NULL DEFAULT 'EXACT',
    "role" VARCHAR(15) NOT NULL DEFAULT 'ANY',
    "weight" INTEGER NOT NULL DEFAULT 100,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "treatment_template_diagnoses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_set_diagnoses" (
    "id" UUID NOT NULL,
    "order_set_id" UUID NOT NULL,
    "diagnosis_code" VARCHAR(20) NOT NULL,
    "match_type" VARCHAR(10) NOT NULL DEFAULT 'EXACT',
    "role" VARCHAR(15) NOT NULL DEFAULT 'ANY',
    "weight" INTEGER NOT NULL DEFAULT 100,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_set_diagnoses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_set_usages" (
    "id" UUID NOT NULL,
    "order_set_id" UUID NOT NULL,
    "encounter_id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "used_by" UUID NOT NULL,
    "used_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "items_applied" INTEGER NOT NULL,
    "items_modified" INTEGER NOT NULL,

    CONSTRAINT "order_set_usages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "favorite_orders" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "items" JSONB NOT NULL,
    "use_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "favorite_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "icu_beds" (
    "id" UUID NOT NULL,
    "unit_name" VARCHAR(100) NOT NULL,
    "bed_number" VARCHAR(20) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'AVAILABLE',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "icu_beds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "icu_admissions" (
    "id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "icu_bed_id" UUID NOT NULL,
    "doctor_id" UUID NOT NULL,
    "admit_date" TIMESTAMPTZ NOT NULL,
    "discharge_date" TIMESTAMPTZ,
    "admit_reason" TEXT NOT NULL,
    "severity" VARCHAR(20),
    "ventilator" BOOLEAN NOT NULL DEFAULT false,
    "isolation" BOOLEAN NOT NULL DEFAULT false,
    "status" VARCHAR(20) NOT NULL DEFAULT 'ADMITTED',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "icu_admissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "icu_records" (
    "id" UUID NOT NULL,
    "admission_id" UUID NOT NULL,
    "record_time" TIMESTAMPTZ NOT NULL,
    "heart_rate" INTEGER,
    "systolic_bp" INTEGER,
    "diastolic_bp" INTEGER,
    "spo2" INTEGER,
    "respiratory_rate" INTEGER,
    "temperature" DECIMAL(4,1),
    "gc_score" INTEGER,
    "consciousness" VARCHAR(20),
    "pupil_reaction" VARCHAR(50),
    "intake_oral" INTEGER,
    "intake_iv" INTEGER,
    "intake_other" INTEGER,
    "output_urine" INTEGER,
    "output_drain" INTEGER,
    "output_other" INTEGER,
    "vent_mode" VARCHAR(30),
    "fio2" INTEGER,
    "peep" INTEGER,
    "tidal_volume" INTEGER,
    "pip" INTEGER,
    "apache_score" INTEGER,
    "sofa_score" INTEGER,
    "pain_score" INTEGER,
    "sedation_score" INTEGER,
    "notes" TEXT,
    "recorded_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "icu_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "diagnostic_tests" (
    "id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "test_type" VARCHAR(50) NOT NULL,
    "test_name" VARCHAR(200) NOT NULL,
    "requested_by" UUID NOT NULL,
    "performed_by" UUID,
    "interpreted_by" UUID,
    "status" VARCHAR(20) NOT NULL DEFAULT 'ORDERED',
    "scheduled_at" TIMESTAMPTZ,
    "performed_at" TIMESTAMPTZ,
    "reported_at" TIMESTAMPTZ,
    "findings" TEXT,
    "impression" TEXT,
    "conclusion" VARCHAR(50),
    "measurements" JSONB,
    "attachment_url" VARCHAR(500),
    "priority" VARCHAR(20) NOT NULL DEFAULT 'ROUTINE',
    "target_tat_minutes" INTEGER,
    "critical_flag" BOOLEAN NOT NULL DEFAULT false,
    "critical_note" VARCHAR(300),
    "request_note" VARCHAR(500),
    "room_name" VARCHAR(50),
    "equipment_name" VARCHAR(100),
    "order_id" UUID,
    "reviewed_by" UUID,
    "reviewed_at" TIMESTAMPTZ,
    "review_status" VARCHAR(20),
    "delta_flag" BOOLEAN NOT NULL DEFAULT false,
    "delta_note" VARCHAR(300),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "diagnostic_tests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_gates" (
    "id" UUID NOT NULL,
    "track" VARCHAR(30) NOT NULL,
    "key" VARCHAR(10) NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "owner" VARCHAR(80) NOT NULL,
    "status" VARCHAR(15) NOT NULL DEFAULT 'PENDING',
    "confirmed_by" UUID,
    "confirmed_at" TIMESTAMPTZ,
    "evidence_type" VARCHAR(20),
    "evidence_ref" VARCHAR(120),
    "approved_on" DATE,
    "approver_name" VARCHAR(50),
    "evidence_url" VARCHAR(300),
    "note" VARCHAR(500),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "integration_gates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_gate_events" (
    "id" UUID NOT NULL,
    "gate_id" UUID,
    "track" VARCHAR(30) NOT NULL,
    "key" VARCHAR(10),
    "action" VARCHAR(15) NOT NULL,
    "actor_id" UUID,
    "snapshot" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "integration_gate_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_configs" (
    "id" UUID NOT NULL,
    "key" VARCHAR(100) NOT NULL,
    "value" JSONB NOT NULL,
    "category" VARCHAR(50) NOT NULL,
    "label" VARCHAR(200) NOT NULL,
    "updated_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "system_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hospital_info_contents" (
    "id" UUID NOT NULL,
    "category" VARCHAR(30) NOT NULL,
    "slug" VARCHAR(100) NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "content" TEXT NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "image_url" VARCHAR(500),
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" VARCHAR(20) NOT NULL DEFAULT 'PUBLISHED',
    "publish_from" TIMESTAMPTZ,
    "publish_until" TIMESTAMPTZ,
    "is_pinned" BOOLEAN NOT NULL DEFAULT false,
    "view_count" INTEGER NOT NULL DEFAULT 0,
    "deleted_at" TIMESTAMPTZ,
    "deleted_by" UUID,
    "editable_depts" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_by" UUID NOT NULL,
    "updated_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "hospital_info_contents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hospital_info_audits" (
    "id" UUID NOT NULL,
    "content_id" UUID NOT NULL,
    "action" VARCHAR(20) NOT NULL,
    "changes" JSONB NOT NULL DEFAULT '{}',
    "snapshot" JSONB,
    "reason" VARCHAR(500),
    "changed_by" UUID NOT NULL,
    "changed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hospital_info_audits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "homepage_popups" (
    "id" UUID NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "type" VARCHAR(20) NOT NULL,
    "content" TEXT,
    "image_url" VARCHAR(500),
    "link_url" VARCHAR(500),
    "link_text" VARCHAR(100),
    "target_pages" TEXT[],
    "start_date" TIMESTAMPTZ NOT NULL,
    "end_date" TIMESTAMPTZ NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "hide_today" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "bg_color" VARCHAR(20),
    "text_color" VARCHAR(20),
    "button_text" VARCHAR(100),
    "button_color" VARCHAR(20),
    "clipart_id" VARCHAR(50),
    "clipart_position" VARCHAR(20),
    "overlay_opacity" INTEGER,
    "border_radius" INTEGER,
    "font_size" VARCHAR(10),
    "template_id" VARCHAR(50),
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "homepage_popups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cms_categories" (
    "id" UUID NOT NULL,
    "code" VARCHAR(30) NOT NULL,
    "name" VARCHAR(50) NOT NULL,
    "description" VARCHAR(200),
    "icon" VARCHAR(10),
    "color" VARCHAR(20),
    "parent_id" UUID,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "show_on_home" BOOLEAN NOT NULL DEFAULT false,
    "show_on_subpage" BOOLEAN NOT NULL DEFAULT true,
    "renderMode" VARCHAR(20) NOT NULL DEFAULT 'cards',
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "cms_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cms_menus" (
    "id" UUID NOT NULL,
    "menu_group" VARCHAR(30) NOT NULL,
    "label" VARCHAR(50) NOT NULL,
    "href" VARCHAR(200),
    "icon" VARCHAR(30),
    "parent_id" UUID,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "is_external" BOOLEAN NOT NULL DEFAULT false,
    "category_code" VARCHAR(30),
    "roles" TEXT[] DEFAULT ARRAY['ALL']::TEXT[],
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "cms_menus_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "media_files" (
    "id" UUID NOT NULL,
    "file_name" VARCHAR(255) NOT NULL,
    "original_name" VARCHAR(255) NOT NULL,
    "mime_type" VARCHAR(50) NOT NULL,
    "file_size" INTEGER NOT NULL,
    "url" VARCHAR(500) NOT NULL,
    "folder" VARCHAR(200) NOT NULL DEFAULT '/',
    "width" INTEGER,
    "height" INTEGER,
    "alt" VARCHAR(200),
    "uploaded_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "media_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "doctor_profiles" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "position" VARCHAR(50),
    "education" JSONB NOT NULL DEFAULT '[]',
    "career" JSONB NOT NULL DEFAULT '[]',
    "certifications" JSONB NOT NULL DEFAULT '[]',
    "research" JSONB NOT NULL DEFAULT '[]',
    "languages" TEXT[] DEFAULT ARRAY['한국어']::TEXT[],
    "introduction" TEXT,
    "photo_url" VARCHAR(500),
    "schedule_note" VARCHAR(200),
    "is_public" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "doctor_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "holiday_calendars" (
    "id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "type" VARCHAR(30) NOT NULL,
    "is_holiday" BOOLEAN NOT NULL DEFAULT true,
    "year" INTEGER NOT NULL,
    "source" VARCHAR(20) NOT NULL DEFAULT 'MANUAL',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "holiday_calendars_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "patient_accounts" (
    "id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "phone" VARCHAR(20) NOT NULL,
    "phone_verified" BOOLEAN NOT NULL DEFAULT false,
    "ci" VARCHAR(200),
    "password_hash" VARCHAR(255) NOT NULL,
    "previous_passwords" JSONB,
    "pin_hash" VARCHAR(255),
    "biometric_enabled" BOOLEAN NOT NULL DEFAULT false,
    "email" VARCHAR(255),
    "email_verified" BOOLEAN NOT NULL DEFAULT false,
    "status" VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    "failed_attempts" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMPTZ,
    "password_changed_at" TIMESTAMPTZ,
    "last_login_at" TIMESTAMPTZ,
    "last_login_ip" VARCHAR(50),
    "two_factor_enabled" BOOLEAN NOT NULL DEFAULT false,
    "marketing_consent" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "withdrawn_at" TIMESTAMPTZ,

    CONSTRAINT "patient_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "patient_ai_consents" (
    "id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "consented" BOOLEAN NOT NULL DEFAULT false,
    "consented_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "method" VARCHAR(20),
    "recorded_by" VARCHAR(80),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "patient_ai_consents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "patient_consents" (
    "id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "type" VARCHAR(50) NOT NULL,
    "version" VARCHAR(20) NOT NULL,
    "agreed" BOOLEAN NOT NULL,
    "agreed_at" TIMESTAMPTZ,
    "revoked_at" TIMESTAMPTZ,
    "ip_address" VARCHAR(50),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "patient_consents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "patient_devices" (
    "id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "device_id" VARCHAR(255) NOT NULL,
    "device_name" VARCHAR(100),
    "platform" VARCHAR(20) NOT NULL,
    "os_version" VARCHAR(30),
    "app_version" VARCHAR(20),
    "fcm_token" VARCHAR(500),
    "refresh_token_hash" VARCHAR(255),
    "prev_refresh_hash" VARCHAR(255),
    "refresh_family_id" UUID,
    "installation_id" VARCHAR(64),
    "app_key_id" UUID,
    "last_active_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "patient_devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "patient_families" (
    "id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "relationship" VARCHAR(30) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "date_of_birth" DATE,
    "phone" VARCHAR(20),
    "linked_patient_id" UUID,
    "is_emergency_contact" BOOLEAN NOT NULL DEFAULT false,
    "is_deceased" BOOLEAN NOT NULL DEFAULT false,
    "medical_history" VARCHAR(500),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "patient_families_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "patient_guardians" (
    "id" UUID NOT NULL,
    "guardian_account_id" UUID NOT NULL,
    "dependent_account_id" UUID NOT NULL,
    "relationship" VARCHAR(30) NOT NULL,
    "legal_basis" VARCHAR(50) NOT NULL,
    "document_url" VARCHAR(500),
    "patient_consent_url" VARCHAR(500),
    "access_scope" JSONB,
    "is_approved" BOOLEAN NOT NULL DEFAULT false,
    "approved_by" UUID,
    "approved_at" TIMESTAMPTZ,
    "rejected_reason" VARCHAR(300),
    "expires_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "patient_guardians_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "patient_notifications" (
    "id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "type" VARCHAR(30) NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "body" VARCHAR(500) NOT NULL,
    "data" JSONB,
    "is_read" BOOLEAN NOT NULL DEFAULT false,
    "read_at" TIMESTAMPTZ,
    "sent_via" VARCHAR(20),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "patient_notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_settings" (
    "id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "type" VARCHAR(30) NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "push_enabled" BOOLEAN NOT NULL DEFAULT true,
    "sms_enabled" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "notification_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "patient_addresses" (
    "id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "type" VARCHAR(20) NOT NULL DEFAULT 'HOME',
    "zip_code" VARCHAR(10),
    "province" VARCHAR(50),
    "city" VARCHAR(50),
    "district" VARCHAR(100),
    "detail" VARCHAR(200),
    "full_address" VARCHAR(500),
    "road_address" VARCHAR(500),
    "jibun_address" VARCHAR(500),
    "is_primary" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "patient_addresses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sms_verifications" (
    "id" UUID NOT NULL,
    "phone" VARCHAR(20) NOT NULL,
    "code" VARCHAR(6) NOT NULL,
    "purpose" VARCHAR(30) NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "ip_address" VARCHAR(50),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sms_verifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "medication_check_logs" (
    "id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "prescription_id" UUID NOT NULL,
    "slot_date" DATE NOT NULL,
    "slot" VARCHAR(20) NOT NULL,
    "reminded_at" TIMESTAMPTZ,
    "taken" BOOLEAN,
    "checked_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "medication_check_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_requests" (
    "id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "type" VARCHAR(30) NOT NULL,
    "purpose" VARCHAR(200),
    "period_from" DATE,
    "period_to" DATE,
    "delivery_method" VARCHAR(20) NOT NULL DEFAULT 'VISIT',
    "copies" INTEGER NOT NULL DEFAULT 1,
    "status" VARCHAR(20) NOT NULL DEFAULT 'REQUESTED',
    "fee" INTEGER,
    "note" VARCHAR(500),
    "reject_reason" VARCHAR(300),
    "processed_by" UUID,
    "processed_at" TIMESTAMPTZ,
    "drafted_by" UUID,
    "completed_at" TIMESTAMPTZ,
    "requestor_account_id" UUID,
    "requester_type" VARCHAR(10) NOT NULL DEFAULT 'SELF',
    "requester_relation" VARCHAR(30),
    "legal_basis" VARCHAR(20),
    "proxy_documents" JSONB,
    "proxy_verify_status" VARCHAR(10) NOT NULL DEFAULT 'NONE',
    "proxy_verified_by" UUID,
    "proxy_verified_at" TIMESTAMPTZ,
    "record_types" JSONB,
    "encounter_id" UUID,
    "issued_document_id" VARCHAR(60),
    "sla_due_at" TIMESTAMPTZ,
    "delivered_at" TIMESTAMPTZ,
    "delivered_by" UUID,
    "delivery_ref" VARCHAR(120),
    "fee_breakdown" JSONB,
    "bundle_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "document_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "drug_explain_cache" (
    "medication_code_id" UUID NOT NULL,
    "item_code" VARCHAR(20),
    "content" JSONB NOT NULL,
    "source_version" VARCHAR(40),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approved_by" UUID,
    "approved_at" TIMESTAMPTZ,

    CONSTRAINT "drug_explain_cache_pkey" PRIMARY KEY ("medication_code_id")
);

-- CreateTable
CREATE TABLE "issuance_artifacts" (
    "id" UUID NOT NULL,
    "request_id" UUID NOT NULL,
    "record_type" VARCHAR(30) NOT NULL,
    "source_ids" JSONB NOT NULL,
    "snapshot_json" JSONB NOT NULL,
    "issued_document_id" VARCHAR(60),
    "page_count" INTEGER,
    "authored_json" JSONB,
    "signed_by" UUID,
    "signed_at" TIMESTAMPTZ,
    "signature_ref" VARCHAR(120),
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "issuance_artifacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "portal_sessions" (
    "id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "token" VARCHAR(500) NOT NULL,
    "ip_address" VARCHAR(50),
    "user_agent" VARCHAR(500),
    "expires_at" TIMESTAMPTZ NOT NULL,
    "last_active_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "portal_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "portal_audit_logs" (
    "id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "action" VARCHAR(50) NOT NULL,
    "endpoint" VARCHAR(200) NOT NULL,
    "ip_address" VARCHAR(50),
    "detail" VARCHAR(500),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "portal_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "department_form_mappings" (
    "id" UUID NOT NULL,
    "department_name" VARCHAR(50) NOT NULL,
    "form_schema_id" UUID NOT NULL,
    "visit_type" VARCHAR(20) NOT NULL DEFAULT 'ALL',
    "priority" INTEGER NOT NULL DEFAULT 1,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "department_form_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_sessions" (
    "id" UUID NOT NULL,
    "channel" VARCHAR(30) NOT NULL,
    "operator_id" UUID,
    "patient_id" UUID,
    "state" VARCHAR(30) NOT NULL DEFAULT 'IDLE',
    "context" JSONB NOT NULL,
    "messages" JSONB NOT NULL DEFAULT '[]',
    "result_type" VARCHAR(30),
    "result_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ,

    CONSTRAINT "agent_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "online_bookings" (
    "id" UUID NOT NULL,
    "booking_number" VARCHAR(20) NOT NULL,
    "session_id" UUID,
    "patient_name" VARCHAR(100) NOT NULL,
    "patient_phone" VARCHAR(20) NOT NULL,
    "patient_birth" DATE,
    "department" VARCHAR(50) NOT NULL,
    "doctor_id" UUID,
    "appointment_id" UUID,
    "preferred_date" DATE NOT NULL,
    "preferred_time" VARCHAR(10) NOT NULL,
    "reason" TEXT,
    "status" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "online_bookings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pre_orders" (
    "id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "doctor_id" UUID NOT NULL,
    "type" VARCHAR(20) NOT NULL,
    "medication_code_id" UUID,
    "procedure_code_id" UUID,
    "dosage" VARCHAR(100),
    "frequency" VARCHAR(100),
    "duration" INTEGER,
    "quantity" INTEGER,
    "route" VARCHAR(50),
    "priority" VARCHAR(20) NOT NULL DEFAULT 'ROUTINE',
    "instructions" TEXT,
    "reason" TEXT,
    "scheduled_date" DATE,
    "dur_snapshot" JSONB,
    "source" VARCHAR(20) NOT NULL DEFAULT 'MANUAL',
    "external_ref" VARCHAR(120),
    "appointment_id" UUID,
    "activation_mode" VARCHAR(15) NOT NULL DEFAULT 'ON_APPROVAL',
    "recurring_group_id" UUID,
    "scheduled_time" VARCHAR(5),
    "status" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    "approved_by" UUID,
    "approved_at" TIMESTAMPTZ,
    "encounter_id" UUID,
    "prescription_id" UUID,
    "expires_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pre_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pre_order_revisions" (
    "id" UUID NOT NULL,
    "pre_order_id" UUID NOT NULL,
    "snapshot" JSONB NOT NULL,
    "changed_by" UUID,
    "reason" VARCHAR(300),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pre_order_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "doctor_code_lists" (
    "id" UUID NOT NULL,
    "doctor_id" UUID NOT NULL,
    "category" VARCHAR(20) NOT NULL,
    "code_id" UUID NOT NULL,
    "code_type" VARCHAR(20) NOT NULL,
    "display_name" VARCHAR(200),
    "default_dosage" VARCHAR(100),
    "default_frequency" VARCHAR(100),
    "default_duration" INTEGER,
    "default_route" VARCHAR(50),
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "use_count" INTEGER NOT NULL DEFAULT 0,
    "is_pinned" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "doctor_code_lists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "doctor_prescription_sets" (
    "id" UUID NOT NULL,
    "doctor_id" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "description" TEXT,
    "category" VARCHAR(50),
    "items" JSONB NOT NULL,
    "use_count" INTEGER NOT NULL DEFAULT 0,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "doctor_prescription_sets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "formulary_items" (
    "id" UUID NOT NULL,
    "domain" VARCHAR(20) NOT NULL,
    "code_type" VARCHAR(30) NOT NULL,
    "code_id" UUID,
    "preset_key" VARCHAR(40),
    "status" VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    "note" TEXT,
    "committee" VARCHAR(60),
    "decided_at" TIMESTAMPTZ,
    "decided_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "formulary_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "formulary_lists" (
    "id" UUID NOT NULL,
    "domain" VARCHAR(20) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "description" VARCHAR(300),
    "items" JSONB NOT NULL,
    "ai_generated" BOOLEAN NOT NULL DEFAULT false,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "formulary_lists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "formulary_requests" (
    "id" UUID NOT NULL,
    "domain" VARCHAR(20) NOT NULL,
    "code_type" VARCHAR(30) NOT NULL,
    "code_id" UUID,
    "code_label" VARCHAR(300),
    "free_text" VARCHAR(300),
    "reason" TEXT NOT NULL,
    "urgency" VARCHAR(10) NOT NULL DEFAULT 'ROUTINE',
    "requested_by" UUID NOT NULL,
    "department" VARCHAR(100),
    "status" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    "decision" TEXT,
    "decided_by" UUID,
    "decided_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "formulary_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "department_code_catalogs" (
    "id" UUID NOT NULL,
    "department_name" VARCHAR(100) NOT NULL,
    "subcategory" VARCHAR(100),
    "code_id" UUID NOT NULL,
    "code_type" VARCHAR(20) NOT NULL,
    "default_dosage" VARCHAR(100),
    "default_frequency" VARCHAR(100),
    "default_duration" INTEGER,
    "default_route" VARCHAR(50),
    "max_dosage" VARCHAR(100),
    "guide_note" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "department_code_catalogs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "triage_symptoms" (
    "id" UUID NOT NULL,
    "name" VARCHAR(50) NOT NULL,
    "category" VARCHAR(50),
    "description" VARCHAR(200),
    "is_emergency" BOOLEAN NOT NULL DEFAULT false,
    "emergency_msg" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "triage_symptoms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "triage_rules" (
    "id" UUID NOT NULL,
    "symptom_id" UUID NOT NULL,
    "department_name" VARCHAR(100) NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 1,
    "confidence" INTEGER NOT NULL DEFAULT 70,
    "reason" VARCHAR(200),
    "condition" VARCHAR(200),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "hit_count" INTEGER NOT NULL DEFAULT 0,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "triage_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "triage_aliases" (
    "id" UUID NOT NULL,
    "symptom_id" UUID NOT NULL,
    "alias" VARCHAR(50) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "hit_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "triage_aliases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "charge_of_care" (
    "id" UUID NOT NULL,
    "admission_id" UUID NOT NULL,
    "doctor_id" UUID NOT NULL,
    "role" VARCHAR(30) NOT NULL DEFAULT 'ATTENDING',
    "assigned_at" TIMESTAMPTZ NOT NULL,
    "released_at" TIMESTAMPTZ,
    "reason" VARCHAR(200),
    "handoff_note" TEXT,
    "assigned_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "charge_of_care_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journey_delay_acks" (
    "id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "track" VARCHAR(4) NOT NULL,
    "stage" VARCHAR(24) NOT NULL,
    "flag_key" VARCHAR(200) NOT NULL,
    "note" VARCHAR(300) NOT NULL,
    "acked_by" UUID NOT NULL,
    "acked_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "journey_delay_acks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clinical_handoffs" (
    "id" UUID NOT NULL,
    "type" VARCHAR(30) NOT NULL,
    "patient_id" UUID NOT NULL,
    "from_doctor_id" UUID NOT NULL,
    "to_doctor_id" UUID NOT NULL,
    "emergency_visit_id" UUID,
    "admission_id" UUID,
    "summary" TEXT NOT NULL,
    "illness" VARCHAR(20),
    "patient_summary" TEXT,
    "action_list" JSONB,
    "situation_awareness" TEXT,
    "synthesis" TEXT,
    "vital_signs" JSONB,
    "pending_items" JSONB,
    "acknowledged_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "clinical_handoffs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bed_assignments" (
    "id" UUID NOT NULL,
    "admission_id" UUID NOT NULL,
    "bed_id" UUID NOT NULL,
    "assigned_at" TIMESTAMPTZ NOT NULL,
    "released_at" TIMESTAMPTZ,
    "reason" VARCHAR(200),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bed_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rounds" (
    "id" UUID NOT NULL,
    "admission_id" UUID NOT NULL,
    "doctor_id" UUID NOT NULL,
    "round_type" VARCHAR(20) NOT NULL,
    "rounded_at" TIMESTAMPTZ NOT NULL,
    "notes" TEXT,
    "assessment" TEXT,
    "plan" TEXT,
    "vital_signs" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rounds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "patient_journey_events" (
    "id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "event_type" VARCHAR(50) NOT NULL,
    "event_at" TIMESTAMPTZ NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "description" TEXT,
    "department" VARCHAR(100),
    "doctor_id" UUID,
    "doctor_name" VARCHAR(100),
    "ref_type" VARCHAR(30),
    "ref_id" UUID,
    "nav_url" VARCHAR(300),
    "severity" VARCHAR(20),
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "patient_journey_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "space_nodes" (
    "id" UUID NOT NULL,
    "parent_id" UUID,
    "depth" INTEGER NOT NULL DEFAULT 0,
    "path" VARCHAR(500) NOT NULL,
    "node_type" VARCHAR(30) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "code" VARCHAR(30),
    "floor" INTEGER,
    "room_number" VARCHAR(20),
    "space_type" VARCHAR(30) NOT NULL,
    "department" VARCHAR(50),
    "capacity" INTEGER,
    "color" VARCHAR(7),
    "icon" VARCHAR(30),
    "ward_id" UUID,
    "bed_id" UUID,
    "connected_to" JSONB,
    "walk_time" INTEGER,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "equipment" JSONB,
    "tags" JSONB,
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "space_nodes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "patient_locations" (
    "id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "zone_id" UUID NOT NULL,
    "status" VARCHAR(30) NOT NULL,
    "entered_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "left_at" TIMESTAMPTZ,
    "duration" INTEGER,
    "event_type" VARCHAR(50),
    "event_id" UUID,
    "metadata" JSONB,

    CONSTRAINT "patient_locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "location_stations" (
    "id" UUID NOT NULL,
    "zone_id" UUID NOT NULL,
    "label" VARCHAR(100) NOT NULL,
    "device_type" VARCHAR(20) NOT NULL,
    "key_hash" VARCHAR(128) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_seen_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "location_stations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "patient_loc_tokens" (
    "token" VARCHAR(64) NOT NULL,
    "patient_id" UUID NOT NULL,
    "mode" VARCHAR(10) NOT NULL,
    "issued_via" VARCHAR(10),
    "expires_at" TIMESTAMPTZ NOT NULL,
    "revoked_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "patient_loc_tokens_pkey" PRIMARY KEY ("token")
);

-- CreateTable
CREATE TABLE "cdss_rules" (
    "id" UUID NOT NULL,
    "category" VARCHAR(30) NOT NULL,
    "level" VARCHAR(10) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "description" TEXT NOT NULL,
    "drug_a" VARCHAR(100),
    "drug_b" VARCHAR(100),
    "age_min" INTEGER,
    "age_max" INTEGER,
    "max_dose" VARCHAR(50),
    "diagnosis_code" VARCHAR(20),
    "recommendation" TEXT,
    "reference" VARCHAR(500),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "hit_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "cdss_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dur_rules" (
    "id" UUID NOT NULL,
    "rule_type" VARCHAR(20) NOT NULL,
    "severity" VARCHAR(10) NOT NULL DEFAULT 'WARNING',
    "drug_a" VARCHAR(100),
    "drug_b" VARCHAR(100),
    "keywords" JSONB,
    "min_age" INTEGER,
    "max_age" INTEGER,
    "max_daily_dose" DOUBLE PRECISION,
    "max_per_kg_day" DOUBLE PRECISION,
    "max_absolute" DOUBLE PRECISION,
    "unit" VARCHAR(10),
    "message" VARCHAR(500) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "source" VARCHAR(40),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "dur_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cdss_logs" (
    "id" UUID NOT NULL,
    "encounter_id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "doctor_id" UUID NOT NULL,
    "medication_code" VARCHAR(50),
    "overall_level" VARCHAR(10) NOT NULL,
    "total_checks" INTEGER NOT NULL,
    "passed_checks" INTEGER NOT NULL,
    "alerts" JSONB NOT NULL,
    "overridden" BOOLEAN NOT NULL DEFAULT false,
    "override_reason" TEXT,
    "acknowledger_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cdss_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gate_violation_logs" (
    "id" UUID NOT NULL,
    "gate_key" VARCHAR(60) NOT NULL,
    "severity" VARCHAR(10) NOT NULL,
    "message" TEXT NOT NULL,
    "ref_type" VARCHAR(40),
    "ref_id" VARCHAR(60),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gate_violation_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "patient_messages" (
    "id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "doctor_id" UUID,
    "sender" VARCHAR(10) NOT NULL,
    "content" TEXT NOT NULL,
    "is_read" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "patient_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "health_memos" (
    "id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "category" VARCHAR(30) NOT NULL DEFAULT 'GENERAL',
    "content" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "health_memos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "satisfaction_surveys" (
    "id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "encounter_id" UUID,
    "overallRating" INTEGER NOT NULL,
    "wait_rating" INTEGER,
    "staff_rating" INTEGER,
    "facility_rating" INTEGER,
    "comment" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "satisfaction_surveys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "survey_dispatches" (
    "id" UUID NOT NULL,
    "token" VARCHAR(40) NOT NULL,
    "template_id" VARCHAR(40) NOT NULL,
    "template_name" VARCHAR(200) NOT NULL,
    "questions" JSONB NOT NULL,
    "patient_id" UUID,
    "patient_name" VARCHAR(100),
    "department" VARCHAR(60),
    "channel" VARCHAR(12) NOT NULL DEFAULT 'PORTAL',
    "trigger" VARCHAR(16) NOT NULL DEFAULT 'MANUAL',
    "device_id" UUID,
    "status" VARCHAR(12) NOT NULL DEFAULT 'PENDING',
    "answers" JSONB,
    "nps_score" INTEGER,
    "avg_score" DOUBLE PRECISION,
    "submitted_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "survey_dispatches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "survey_action_items" (
    "id" UUID NOT NULL,
    "department" VARCHAR(60) NOT NULL,
    "title" VARCHAR(300) NOT NULL,
    "description" TEXT,
    "priority" VARCHAR(8) NOT NULL DEFAULT 'MEDIUM',
    "status" VARCHAR(12) NOT NULL DEFAULT 'OPEN',
    "assignee" VARCHAR(100),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "survey_action_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "survey_templates_custom" (
    "id" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "description" VARCHAR(500),
    "target_department" VARCHAR(60),
    "questions" JSONB NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "survey_templates_custom_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vaccinations" (
    "id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "vaccine_name" VARCHAR(200) NOT NULL,
    "vaccine_code" VARCHAR(50),
    "dose_number" INTEGER NOT NULL DEFAULT 1,
    "administered_at" TIMESTAMPTZ NOT NULL,
    "next_due_at" TIMESTAMPTZ,
    "administered_by" VARCHAR(200),
    "location" VARCHAR(200),
    "lot_number" VARCHAR(100),
    "notes" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "vaccinations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dental_recalls" (
    "id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "tooth" VARCHAR(5),
    "recall_type" VARCHAR(20) NOT NULL,
    "scheduled_date" DATE NOT NULL,
    "completed_at" TIMESTAMPTZ,
    "status" VARCHAR(20) NOT NULL DEFAULT 'SCHEDULED',
    "notes" TEXT,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dental_recalls_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chart_template_versions" (
    "id" UUID NOT NULL,
    "template_id" UUID NOT NULL,
    "version" VARCHAR(20) NOT NULL,
    "sections" JSONB NOT NULL,
    "changed_by" UUID,
    "change_note" VARCHAR(500),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chart_template_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ortho_exams" (
    "id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "encounter_id" UUID,
    "body_part" VARCHAR(50) NOT NULL,
    "side" VARCHAR(10),
    "rom" JSONB,
    "mmt" JSONB,
    "special_tests" JSONB,
    "pain_vas" INTEGER,
    "pain_location" VARCHAR(100),
    "pain_pattern" VARCHAR(100),
    "fracture_class" VARCHAR(50),
    "imaging_findings" TEXT,
    "diagnosis" TEXT,
    "plan" TEXT,
    "examined_by" UUID NOT NULL,
    "examined_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ortho_exams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "obgyn_exams" (
    "id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "encounter_id" UUID,
    "exam_type" VARCHAR(20) NOT NULL,
    "gestational_age" VARCHAR(20),
    "edd" DATE,
    "gravida" INTEGER,
    "para" INTEGER,
    "pre_pregnancy_weight" DECIMAL(5,1),
    "current_weight" DECIMAL(5,1),
    "blood_pressure" VARCHAR(20),
    "urine_protein" VARCHAR(10),
    "urine_glucose" VARCHAR(10),
    "edema" VARCHAR(20),
    "fundal_height" DECIMAL(4,1),
    "fetal_heart_rate" INTEGER,
    "fetal_movement" VARCHAR(20),
    "ultrasound" JSONB,
    "nst" JSONB,
    "cervical_dilation" DECIMAL(3,1),
    "effacement" INTEGER,
    "station" INTEGER,
    "pap_smear" VARCHAR(50),
    "hpv_test" VARCHAR(50),
    "pelvic_ultrasound" JSONB,
    "diagnosis" TEXT,
    "plan" TEXT,
    "examined_by" UUID NOT NULL,
    "examined_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "obgyn_exams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_records" (
    "id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "encounter_id" UUID,
    "status" VARCHAR(20) NOT NULL DEFAULT 'IN_LABOR',
    "delivery_type" VARCHAR(20),
    "gestational_weeks" VARCHAR(10),
    "labor_onset_at" TIMESTAMPTZ,
    "delivered_at" TIMESTAMPTZ,
    "stage1_minutes" INTEGER,
    "stage2_minutes" INTEGER,
    "stage3_minutes" INTEGER,
    "anesthesia" VARCHAR(30),
    "blood_loss_ml" INTEGER,
    "indication" VARCHAR(200),
    "complications" TEXT,
    "delivered_by" UUID,
    "lochia" VARCHAR(100),
    "fundus_status" VARCHAR(100),
    "wound_status" VARCHAR(100),
    "breastfeeding" VARCHAR(50),
    "notes" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "delivery_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "newborn_records" (
    "id" UUID NOT NULL,
    "delivery_id" UUID NOT NULL,
    "patient_id" UUID,
    "birth_order" INTEGER NOT NULL DEFAULT 1,
    "id_band_no" VARCHAR(40),
    "mother_band_no" VARCHAR(40),
    "birth_at" TIMESTAMPTZ NOT NULL,
    "sex" VARCHAR(10) NOT NULL,
    "weight_g" INTEGER,
    "length_cm" DECIMAL(4,1),
    "head_circ_cm" DECIMAL(4,1),
    "apgar_1" INTEGER,
    "apgar_5" INTEGER,
    "apgar_10" INTEGER,
    "resuscitation" VARCHAR(100),
    "nicu_admission" BOOLEAN NOT NULL DEFAULT false,
    "feeding_type" VARCHAR(30),
    "notes" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "newborn_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "labor_progress_records" (
    "id" UUID NOT NULL,
    "delivery_id" UUID NOT NULL,
    "recorded_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cervical_dilation" INTEGER,
    "station" INTEGER,
    "contraction_freq" INTEGER,
    "contraction_dur" INTEGER,
    "fetal_heart_rate" INTEGER,
    "note" VARCHAR(200),
    "recorded_by" UUID,

    CONSTRAINT "labor_progress_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pediatric_growths" (
    "id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "age_months" INTEGER NOT NULL,
    "weight" DECIMAL(5,2),
    "height" DECIMAL(5,1),
    "head_circ" DECIMAL(4,1),
    "bmi" DECIMAL(4,1),
    "weight_percentile" INTEGER,
    "height_percentile" INTEGER,
    "bmi_percentile" INTEGER,
    "measured_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "measured_by" UUID NOT NULL,

    CONSTRAINT "pediatric_growths_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pediatric_immunizations" (
    "id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "vaccine_name" VARCHAR(100) NOT NULL,
    "vaccine_code" VARCHAR(20),
    "dose_number" INTEGER NOT NULL,
    "given_at" TIMESTAMPTZ NOT NULL,
    "site" VARCHAR(30),
    "lot_number" VARCHAR(50),
    "manufacturer" VARCHAR(100),
    "given_by" UUID NOT NULL,
    "next_due_date" DATE,
    "notes" TEXT,

    CONSTRAINT "pediatric_immunizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "developmental_assessments" (
    "id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "age_months" INTEGER NOT NULL,
    "tool" VARCHAR(30) NOT NULL,
    "gross_motor" VARCHAR(20) NOT NULL,
    "fine_motor" VARCHAR(20) NOT NULL,
    "language" VARCHAR(20) NOT NULL,
    "social_personal" VARCHAR(20) NOT NULL,
    "overall_result" VARCHAR(20) NOT NULL,
    "details" JSONB,
    "assessed_by" UUID NOT NULL,
    "assessed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "developmental_assessments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "psychiatric_admissions" (
    "id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "admission_id" UUID,
    "legal_type" "AdmissionLegalType" NOT NULL,
    "status" "PsychAdmissionStatus" NOT NULL DEFAULT 'ACTIVE',
    "admitted_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "diagnosis" VARCHAR(500),
    "psychiatrist1_id" UUID,
    "psychiatrist2_id" UUID,
    "guardian1_name" VARCHAR(100),
    "guardian1_relation" VARCHAR(50),
    "guardian2_name" VARCHAR(100),
    "guardian2_relation" VARCHAR(50),
    "suitability_review_due" DATE,
    "suitability_reviewed_at" DATE,
    "suitability_result" VARCHAR(30),
    "continuation_review_due" DATE,
    "legal_expiry_at" TIMESTAMPTZ,
    "discharged_at" TIMESTAMPTZ,
    "recorded_by" UUID NOT NULL,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "psychiatric_admissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "psych_seclusion_orders" (
    "id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "admission_id" UUID,
    "type" VARCHAR(20) NOT NULL,
    "reason" TEXT NOT NULL,
    "riskType" VARCHAR(20) NOT NULL,
    "ordered_by_id" UUID NOT NULL,
    "psychiatrist_verified" BOOLEAN NOT NULL DEFAULT false,
    "started_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "legal_max_until" TIMESTAMPTZ NOT NULL,
    "extension_count" INTEGER NOT NULL DEFAULT 0,
    "status" VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    "released_at" TIMESTAMPTZ,
    "released_by_id" UUID,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "psych_seclusion_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "psych_seclusion_monitorings" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "checked_by_id" UUID NOT NULL,
    "checked_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "observation" TEXT,
    "vital_signs" JSONB,
    "continued" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "psych_seclusion_monitorings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "psych_seclusion_extensions" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "extended_by_id" UUID NOT NULL,
    "extended_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reason" TEXT NOT NULL,
    "new_max_until" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "psych_seclusion_extensions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ect_sessions" (
    "id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "ordered_by_id" UUID NOT NULL,
    "consent_form_id" UUID,
    "scheduled_at" TIMESTAMPTZ,
    "performed_at" TIMESTAMPTZ,
    "anesthesia_note" TEXT,
    "seizure_duration_sec" INTEGER,
    "complications" TEXT,
    "notes" TEXT,
    "status" VARCHAR(20) NOT NULL DEFAULT 'ORDERED',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ect_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "psych_exams" (
    "id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "encounter_id" UUID,
    "appearance" VARCHAR(30),
    "behavior" VARCHAR(30),
    "speech" VARCHAR(30),
    "mood" VARCHAR(30),
    "affect" VARCHAR(30),
    "thought_content" JSONB,
    "thought_process" VARCHAR(30),
    "perception" JSONB,
    "cognition" JSONB,
    "insight" VARCHAR(20),
    "phq9" INTEGER,
    "phq9_item9" INTEGER,
    "gad7" INTEGER,
    "mmse" INTEGER,
    "audit" INTEGER,
    "cssrs" JSONB,
    "custom_scales" JSONB,
    "suicide_risk" VARCHAR(10),
    "safety_plan" JSONB,
    "diagnosis" TEXT,
    "plan" TEXT,
    "examined_by" UUID NOT NULL,
    "examined_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "psych_exams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "neuro_exams" (
    "id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "encounter_id" UUID,
    "gcs_eye" INTEGER,
    "gcs_verbal" INTEGER,
    "gcs_motor" INTEGER,
    "gcs_total" INTEGER,
    "pupil_right" JSONB,
    "pupil_left" JSONB,
    "anisocoria" BOOLEAN,
    "motor_exam" JSONB,
    "sensory_exam" JSONB,
    "reflexes" JSONB,
    "babinski" JSONB,
    "cranial_nerves" JSONB,
    "asia_scale" VARCHAR(5),
    "nihss" INTEGER,
    "diagnosis" TEXT,
    "plan" TEXT,
    "examined_by" UUID NOT NULL,
    "examined_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "neuro_exams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "urology_exams" (
    "id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "encounter_id" UUID,
    "ipss_score" INTEGER,
    "ipss_qol" INTEGER,
    "psa_value" DECIMAL(6,2),
    "urodynamics" JSONB,
    "prostate_volume" DECIMAL(5,1),
    "diagnosis" TEXT,
    "plan" TEXT,
    "examined_by" UUID NOT NULL,
    "examined_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "urology_exams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "urology_procedures" (
    "id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "encounter_id" UUID,
    "procedure_type" VARCHAR(30) NOT NULL,
    "indication" TEXT,
    "anesthesia" VARCHAR(50),
    "findings" TEXT,
    "complications" TEXT,
    "specimen_taken" BOOLEAN,
    "notes" TEXT,
    "performed_by" UUID NOT NULL,
    "performed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "urology_procedures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plastic_exams" (
    "id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "encounter_id" UUID,
    "body_part" VARCHAR(50) NOT NULL,
    "procedure" VARCHAR(200) NOT NULL,
    "anesthesia_type" VARCHAR(30),
    "material" VARCHAR(200),
    "fitzpatrick_type" INTEGER,
    "skin_elasticity" VARCHAR(20),
    "scar_tendency" VARCHAR(20),
    "photo_angles" JSONB,
    "before_photo_urls" JSONB,
    "after_photo_urls" JSONB,
    "complications" TEXT,
    "duration" INTEGER,
    "diagnosis" TEXT,
    "plan" TEXT,
    "examined_by" UUID NOT NULL,
    "examined_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "plastic_exams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "internal_medicine_exams" (
    "id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "encounter_id" UUID,
    "subspecialty" VARCHAR(30) NOT NULL,
    "chief_complaint" TEXT,
    "diagnosis" TEXT,
    "plan" TEXT,
    "nyha_class" INTEGER,
    "ccs_grade" INTEGER,
    "lvef" DECIMAL(4,1),
    "heart_rhythm" VARCHAR(30),
    "ecg_findings" JSONB,
    "echo_summary" JSONB,
    "pacemaker_info" JSONB,
    "inr_target" DECIMAL(3,1),
    "inr_actual" DECIMAL(3,1),
    "cha2ds2vasc" INTEGER,
    "hasbled" INTEGER,
    "heart_score" INTEGER,
    "grace_score" INTEGER,
    "timi_score" INTEGER,
    "fev1" DECIMAL(5,1),
    "fvc" DECIMAL(5,1),
    "fev1_fvc" DECIMAL(5,1),
    "dlco" DECIMAL(5,1),
    "gold_stage" INTEGER,
    "oxygen_therapy" JSONB,
    "sputum" JSONB,
    "curb65" INTEGER,
    "cat_score" INTEGER,
    "mmrc_grade" INTEGER,
    "qsofa" INTEGER,
    "endoscopy_type" VARCHAR(30),
    "endoscopy_findings" JSONB,
    "child_pugh_score" INTEGER,
    "child_pugh_class" VARCHAR(1),
    "meld_score" INTEGER,
    "ascites" VARCHAR(20),
    "varices_grade" VARCHAR(5),
    "blatchford_score" INTEGER,
    "hba1c" DECIMAL(4,1),
    "fasting_glucose" INTEGER,
    "insulin_regimen" JSONB,
    "thyroid_function" JSONB,
    "bmd_t_score" DECIMAL(4,1),
    "bmd_site" VARCHAR(30),
    "frax_score" DECIMAL(4,1),
    "ckd_stage" VARCHAR(5),
    "egfr" DECIMAL(5,1),
    "dialysis_type" VARCHAR(10),
    "ktv" DECIMAL(4,2),
    "electrolytes" JSONB,
    "fluid_balance" JSONB,
    "cancer_type" VARCHAR(100),
    "tnm_stage" VARCHAR(20),
    "ecog_ps" INTEGER,
    "regimen_name" VARCHAR(100),
    "cycle_day" VARCHAR(20),
    "bsa" DECIMAL(4,2),
    "recist_response" VARCHAR(10),
    "ctcae_grade" INTEGER,
    "ctcae_event" VARCHAR(100),
    "infection_site" VARCHAR(100),
    "organism" VARCHAR(200),
    "susceptibility" JSONB,
    "antibiotics" JSONB,
    "isolation_type" VARCHAR(20),
    "sofa_score" INTEGER,
    "procalcitonin" DECIMAL(6,2),
    "tender_joint_count" INTEGER,
    "swollen_joint_count" INTEGER,
    "das28" DECIMAL(4,2),
    "haq_di" DECIMAL(4,2),
    "autoantibodies" JSONB,
    "sledai" INTEGER,
    "basdai" DECIMAL(4,1),
    "biologics" JSONB,
    "scores" JSONB,
    "examined_by" UUID NOT NULL,
    "examined_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "internal_medicine_exams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "emergency_exams" (
    "id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "encounter_id" UUID,
    "ktas_level" INTEGER,
    "triage" JSONB,
    "assessment" JSONB,
    "treatment" JSONB,
    "progress_notes" JSONB,
    "disposition" JSONB,
    "examined_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "emergency_exams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "family_med_exams" (
    "id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "encounter_id" UUID,
    "soap" JSONB,
    "vitals" JSONB,
    "checkup" JSONB,
    "lifestyle" JSONB,
    "screenings" JSONB,
    "examined_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "family_med_exams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pediatric_exams" (
    "id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "encounter_id" UUID,
    "age_months" INTEGER,
    "gender" VARCHAR(10),
    "weight" DECIMAL(5,2),
    "height" DECIMAL(5,2),
    "head_circumference" DECIMAL(5,2),
    "bmi" DECIMAL(4,1),
    "developmental_assessment" JSONB,
    "immunizations" JSONB,
    "findings" TEXT,
    "examined_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pediatric_exams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rehab_exams" (
    "id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "encounter_id" UUID,
    "soap" JSONB,
    "functional_assessment" JSONB,
    "therapy_plans" JSONB,
    "examined_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rehab_exams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "surgery_op_notes" (
    "id" UUID NOT NULL,
    "surgery_id" UUID NOT NULL,
    "pre_op_diagnosis" TEXT,
    "post_op_diagnosis" TEXT,
    "procedure_code" VARCHAR(20),
    "assistants" JSONB,
    "anesthesia_type" VARCHAR(30),
    "incision_time" TIMESTAMPTZ,
    "closure_time" TIMESTAMPTZ,
    "findings" TEXT,
    "specimens" JSONB,
    "estimated_blood_loss" INTEGER,
    "fluid_balance" JSONB,
    "implants" JSONB,
    "drains" JSONB,
    "narrative" TEXT,
    "post_op_orders" TEXT,
    "asa_class" INTEGER,
    "mallampati_class" INTEGER,
    "npo_status" JSONB,
    "prophylactic_abx" VARCHAR(200),
    "vte_prophylaxis" BOOLEAN,
    "who_checklist" JSONB,
    "complication_grade" VARCHAR(10),
    "complications" TEXT,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "surgery_op_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "burn_assessments" (
    "id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "encounter_id" UUID,
    "tbsa" DECIMAL(5,2) NOT NULL,
    "regions" JSONB NOT NULL,
    "mechanism" VARCHAR(100),
    "is_child" BOOLEAN DEFAULT false,
    "weight_kg" DECIMAL(5,1),
    "notes" TEXT,
    "assessed_by" UUID NOT NULL,
    "assessed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "burn_assessments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "care_teams" (
    "id" UUID NOT NULL,
    "doctor_id" UUID NOT NULL,
    "nurse_id" UUID NOT NULL,
    "department_name" VARCHAR(100) NOT NULL,
    "team_type" VARCHAR(20) NOT NULL DEFAULT 'OUTPATIENT',
    "is_primary" BOOLEAN NOT NULL DEFAULT true,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "effective_from" DATE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effective_to" DATE,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "care_teams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "nurse_patient_assignments" (
    "id" UUID NOT NULL,
    "nurse_id" UUID NOT NULL,
    "admission_id" UUID NOT NULL,
    "shift_type" VARCHAR(10) NOT NULL DEFAULT 'DAY',
    "is_primary" BOOLEAN NOT NULL DEFAULT true,
    "assigned_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "released_at" TIMESTAMPTZ,
    "assigned_by" UUID,

    CONSTRAINT "nurse_patient_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "nurse_tasks" (
    "id" UUID NOT NULL,
    "encounter_id" UUID,
    "patient_id" UUID NOT NULL,
    "nurse_id" UUID,
    "queue_id" UUID,
    "phase" VARCHAR(20) NOT NULL,
    "task_type" VARCHAR(30) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    "notes" TEXT,
    "completed_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "nurse_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pre_visit_vitals" (
    "id" UUID NOT NULL,
    "queue_id" UUID,
    "encounter_id" UUID,
    "patient_id" UUID NOT NULL,
    "nurse_id" UUID NOT NULL,
    "systolic_bp" INTEGER,
    "diastolic_bp" INTEGER,
    "heart_rate" INTEGER,
    "temperature" DECIMAL(4,1),
    "spo2" INTEGER,
    "weight" DECIMAL(5,1),
    "height" DECIMAL(5,1),
    "bmi" DECIMAL(4,1),
    "pain_score" INTEGER,
    "respiratory_rate" INTEGER,
    "notes" TEXT,
    "is_abnormal" BOOLEAN NOT NULL DEFAULT false,
    "measured_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pre_visit_vitals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "blockchain_certificates" (
    "id" UUID NOT NULL,
    "owner_type" VARCHAR(10) NOT NULL,
    "user_id" UUID,
    "patient_id" UUID,
    "serial_number" VARCHAR(64) NOT NULL,
    "subject_dn" VARCHAR(500) NOT NULL,
    "public_key" TEXT NOT NULL,
    "algorithm" VARCHAR(30) NOT NULL,
    "issued_at" TIMESTAMPTZ NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    "revoked_at" TIMESTAMPTZ,
    "revoke_reason" VARCHAR(200),
    "license_number" VARCHAR(50),
    "license_type" VARCHAR(30),
    "department" VARCHAR(100),
    "specialty" VARCHAR(100),
    "patient_mrn" VARCHAR(50),
    "identity_verified" BOOLEAN,
    "cert_hash" VARCHAR(64) NOT NULL,
    "blockchain_tx_id" VARCHAR(128),
    "blockchain_anchored_at" TIMESTAMPTZ,
    "previous_cert_id" UUID,
    "fingerprint" VARCHAR(64) NOT NULL,
    "key_custody" VARCHAR(20) NOT NULL DEFAULT 'SOFTWARE',
    "attestation_ref" VARCHAR(500),
    "pin_fail_count" INTEGER NOT NULL DEFAULT 0,
    "pin_locked_until" TIMESTAMPTZ,
    "last_backup_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "blockchain_certificates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "signed_documents" (
    "id" UUID NOT NULL,
    "document_type" VARCHAR(50) NOT NULL,
    "document_id" UUID NOT NULL,
    "patient_id" UUID,
    "document_hash" VARCHAR(64) NOT NULL,
    "document_version" INTEGER NOT NULL DEFAULT 1,
    "status" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    "required_signers" INTEGER NOT NULL DEFAULT 1,
    "completed_signers" INTEGER NOT NULL DEFAULT 0,
    "timeout_at" TIMESTAMPTZ,
    "merkle_root" VARCHAR(64),
    "blockchain_tx_id" VARCHAR(128),
    "blockchain_anchored_at" TIMESTAMPTZ,
    "envelope_url" VARCHAR(500),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "signed_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_signatures" (
    "id" UUID NOT NULL,
    "signed_document_id" UUID NOT NULL,
    "certificate_id" UUID NOT NULL,
    "signature_value" TEXT NOT NULL,
    "signature_algorithm" VARCHAR(30) NOT NULL,
    "signed_at" TIMESTAMPTZ NOT NULL,
    "signer_role" VARCHAR(30) NOT NULL,
    "signer_type" VARCHAR(10) NOT NULL,
    "signer_user_id" UUID,
    "signer_patient_id" UUID,
    "ip_address" VARCHAR(45),
    "user_agent" VARCHAR(500),
    "is_valid" BOOLEAN NOT NULL DEFAULT true,
    "verified_at" TIMESTAMPTZ,
    "key_custody" VARCHAR(20) NOT NULL DEFAULT 'SOFTWARE',
    "attestation_ref" VARCHAR(500),

    CONSTRAINT "document_signatures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "encryption_key_registry" (
    "id" UUID NOT NULL,
    "key_id" VARCHAR(32) NOT NULL,
    "wrapped_dek" TEXT NOT NULL,
    "kek_kind" VARCHAR(10) NOT NULL,
    "status" VARCHAR(10) NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "retired_at" TIMESTAMPTZ,

    CONSTRAINT "encryption_key_registry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admission_designated_doctors" (
    "id" UUID NOT NULL,
    "admission_id" UUID NOT NULL,
    "doctor_id" UUID NOT NULL,
    "reason" VARCHAR(200),
    "assigned_by" UUID NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admission_designated_doctors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "step_up_approvals" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "requester_id" UUID,
    "action" VARCHAR(50) NOT NULL,
    "resource_id" VARCHAR(100),
    "summary" VARCHAR(120),
    "body_hash" VARCHAR(64),
    "status" VARCHAR(12) NOT NULL DEFAULT 'PENDING',
    "method" VARCHAR(8),
    "step_up_token" TEXT,
    "approved_at" TIMESTAMPTZ,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "step_up_approvals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "blockchain_anchors" (
    "id" UUID NOT NULL,
    "anchor_type" VARCHAR(30) NOT NULL,
    "reference_id" UUID NOT NULL,
    "data_hash" VARCHAR(64) NOT NULL,
    "merkle_root" VARCHAR(64),
    "merkle_proof" JSONB,
    "chain_type" VARCHAR(30) NOT NULL,
    "tx_hash" VARCHAR(128),
    "block_number" INTEGER,
    "confirmations" INTEGER DEFAULT 0,
    "status" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    "anchored_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "blockchain_anchors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "certificate_audit_logs" (
    "id" UUID NOT NULL,
    "certificate_id" UUID,
    "actor_type" VARCHAR(10) NOT NULL,
    "user_id" UUID,
    "patient_id" UUID,
    "event_type" VARCHAR(30) NOT NULL,
    "event_detail" JSONB,
    "ip_address" VARCHAR(45),
    "pin_fail_count" INTEGER,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "certificate_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pathology_specimens" (
    "id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "encounter_id" UUID,
    "accession_no" VARCHAR(30) NOT NULL,
    "specimen_type" VARCHAR(50) NOT NULL,
    "site" VARCHAR(200) NOT NULL,
    "collected_at" TIMESTAMPTZ NOT NULL,
    "collected_by" UUID NOT NULL,
    "received_at" TIMESTAMPTZ,
    "fixative" VARCHAR(50),
    "clinical_info" TEXT,
    "status" VARCHAR(20) NOT NULL DEFAULT 'RECEIVED',
    "priority" VARCHAR(20) NOT NULL DEFAULT 'ROUTINE',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pathology_specimens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pathology_processing_steps" (
    "id" UUID NOT NULL,
    "specimen_id" UUID NOT NULL,
    "step" VARCHAR(20) NOT NULL,
    "notes" TEXT,
    "performed_by" UUID,
    "performed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pathology_processing_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pathology_reports" (
    "id" UUID NOT NULL,
    "specimen_id" UUID NOT NULL,
    "gross_description" TEXT,
    "micro_description" TEXT,
    "diagnosis" TEXT,
    "diagnosis_code" VARCHAR(20),
    "ihc" JSONB,
    "molecular_test" JSONB,
    "tnm_t" VARCHAR(10),
    "tnm_n" VARCHAR(10),
    "tnm_m" VARCHAR(10),
    "tnm_stage" VARCHAR(20),
    "tumor_grade" VARCHAR(20),
    "margin_status" VARCHAR(20),
    "reported_by" UUID,
    "reported_at" TIMESTAMPTZ,
    "signed_by" UUID,
    "signed_at" TIMESTAMPTZ,
    "addendum" TEXT,
    "amended_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pathology_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hira_claim_documents" (
    "id" UUID NOT NULL,
    "claim_id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "document_type" VARCHAR(20) NOT NULL,
    "edi_version" VARCHAR(10) NOT NULL,
    "edi_data" JSONB NOT NULL,
    "treatment_from" DATE NOT NULL,
    "treatment_to" DATE NOT NULL,
    "total_amount" INTEGER NOT NULL,
    "insurance_amount" INTEGER NOT NULL,
    "patient_amount" INTEGER NOT NULL,
    "diagnosis_codes" JSONB NOT NULL,
    "procedures" JSONB NOT NULL,
    "medications" JSONB NOT NULL,
    "materials" JSONB,
    "status" VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
    "validation_errors" JSONB,
    "submitted_at" TIMESTAMPTZ,
    "response_at" TIMESTAMPTZ,
    "response_data" JSONB,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "hira_claim_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "controlled_substance_logs" (
    "id" UUID NOT NULL,
    "prescription_id" UUID,
    "patient_id" UUID NOT NULL,
    "drug_name" VARCHAR(200) NOT NULL,
    "drug_code" VARCHAR(30),
    "dea_schedule" VARCHAR(10) NOT NULL,
    "narcotic_type" VARCHAR(20),
    "psychotropic_group" VARCHAR(4),
    "quantity" DECIMAL(10,2) NOT NULL,
    "administered_qty" DECIMAL(10,2),
    "wasted_qty" DECIMAL(10,2),
    "unit" VARCHAR(20) NOT NULL,
    "prescribed_by" UUID NOT NULL,
    "prescribed_at" TIMESTAMPTZ NOT NULL,
    "verified_by" UUID,
    "verified_at" TIMESTAMPTZ,
    "dispensed_by" UUID,
    "dispensed_at" TIMESTAMPTZ,
    "dispense_scan_code" VARCHAR(100),
    "administered_by" UUID,
    "administered_at" TIMESTAMPTZ,
    "status" VARCHAR(20) NOT NULL DEFAULT 'PRESCRIBED',
    "waste_reason" VARCHAR(200),
    "waste_witness" UUID,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "controlled_substance_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "controlled_substance_stocks" (
    "id" UUID NOT NULL,
    "drug_code" VARCHAR(30) NOT NULL,
    "drug_name" VARCHAR(200) NOT NULL,
    "dea_schedule" VARCHAR(10) NOT NULL,
    "location" VARCHAR(60) NOT NULL DEFAULT 'PHARMACY',
    "unit" VARCHAR(20) NOT NULL,
    "balance" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "last_counted_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "controlled_substance_stocks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "controlled_substance_stock_txns" (
    "id" UUID NOT NULL,
    "stock_id" UUID NOT NULL,
    "type" VARCHAR(15) NOT NULL,
    "quantity" DECIMAL(12,2) NOT NULL,
    "balance_before" DECIMAL(12,2) NOT NULL,
    "balance_after" DECIMAL(12,2) NOT NULL,
    "ref_type" VARCHAR(30),
    "ref_id" UUID,
    "reason" VARCHAR(300),
    "performed_by" UUID NOT NULL,
    "witnessed_by" UUID,
    "discrepancy" DECIMAL(12,2),
    "occurred_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "controlled_substance_stock_txns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "controlled_substance_incidents" (
    "id" UUID NOT NULL,
    "log_id" UUID,
    "incident_type" VARCHAR(20) NOT NULL,
    "drug_name" VARCHAR(200) NOT NULL,
    "drug_code" VARCHAR(30),
    "quantity" DECIMAL(10,2) NOT NULL,
    "unit" VARCHAR(20) NOT NULL,
    "occurred_at" TIMESTAMPTZ NOT NULL,
    "description" TEXT NOT NULL,
    "reported_by" UUID NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'REPORTED',
    "filed_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "controlled_substance_incidents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "compounding_orders" (
    "id" UUID NOT NULL,
    "source_type" VARCHAR(20) NOT NULL,
    "prescription_id" UUID,
    "special_nutrition_order_id" UUID,
    "patient_id" UUID NOT NULL,
    "status" "CompoundingStatus" NOT NULL DEFAULT 'ORDERED',
    "priority" VARCHAR(10) NOT NULL DEFAULT 'ROUTINE',
    "is_hazardous" BOOLEAN NOT NULL DEFAULT false,
    "due_at" TIMESTAMPTZ,
    "assigned_pharmacist_id" UUID,
    "compounded_by" UUID,
    "hood_type" VARCHAR(20),
    "started_at" TIMESTAMPTZ,
    "finished_at" TIMESTAMPTZ,
    "verified_by" UUID,
    "verified_at" TIMESTAMPTZ,
    "bud_at" TIMESTAMPTZ,
    "label_barcode" VARCHAR(100),
    "released_at" TIMESTAMPTZ,
    "cancel_reason" VARCHAR(200),
    "notes" TEXT,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "compounding_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "compounding_components" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "role" VARCHAR(20) NOT NULL,
    "medication_code_id" UUID,
    "name" VARCHAR(200) NOT NULL,
    "ordered_amount" DECIMAL(12,3),
    "amount_unit" VARCHAR(20),
    "computed_volume_ml" DECIMAL(10,2),
    "lot_number" VARCHAR(50),
    "expiry_date" DATE,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "compounding_components_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "nims_reports" (
    "id" UUID NOT NULL,
    "report_type" VARCHAR(20) NOT NULL,
    "ref_id" UUID,
    "drug_code" VARCHAR(30),
    "drug_name" VARCHAR(200) NOT NULL,
    "narcotic_type" VARCHAR(20),
    "quantity" DECIMAL(12,3) NOT NULL,
    "unit" VARCHAR(20) NOT NULL,
    "event_at" TIMESTAMPTZ NOT NULL,
    "payload" JSONB NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    "submitted_at" TIMESTAMPTZ,
    "nims_ref_no" VARCHAR(50),
    "error_message" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "nims_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "risk_reassessment_schedules" (
    "id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "admission_id" UUID,
    "assessment_type" VARCHAR(20) NOT NULL,
    "tool_name" VARCHAR(30) NOT NULL,
    "interval_hours" INTEGER NOT NULL,
    "next_due_at" TIMESTAMPTZ NOT NULL,
    "last_score" INTEGER,
    "last_risk_level" VARCHAR(20),
    "last_assessed_at" TIMESTAMPTZ,
    "last_assessed_by" UUID,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "interventions" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "risk_reassessment_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "universal_nursing_notes" (
    "id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "nurse_id" UUID NOT NULL,
    "context_type" VARCHAR(30) NOT NULL,
    "context_id" UUID NOT NULL,
    "note_type" VARCHAR(30) NOT NULL,
    "situation" TEXT,
    "background" TEXT,
    "assessment" TEXT,
    "recommendation" TEXT,
    "content" TEXT,
    "vital_signs" JSONB,
    "severity" VARCHAR(20),
    "shift_type" VARCHAR(10),
    "recorded_at" TIMESTAMPTZ NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "universal_nursing_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "type" VARCHAR(30) NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "message" TEXT NOT NULL,
    "severity" VARCHAR(20) NOT NULL DEFAULT 'INFO',
    "ref_type" VARCHAR(30),
    "ref_id" UUID,
    "is_read" BOOLEAN NOT NULL DEFAULT false,
    "read_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "critical_value_alerts" (
    "id" UUID NOT NULL,
    "lab_result_id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "doctor_id" UUID,
    "test_name" VARCHAR(200) NOT NULL,
    "value" VARCHAR(100) NOT NULL,
    "unit" VARCHAR(50) NOT NULL,
    "reason" VARCHAR(200) NOT NULL,
    "notified_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    "acknowledged_by" UUID,
    "acknowledged_at" TIMESTAMPTZ,
    "read_back_confirmed" BOOLEAN NOT NULL DEFAULT false,
    "response_action" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "critical_value_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hand_hygiene_observations" (
    "id" UUID NOT NULL,
    "observer_id" UUID NOT NULL,
    "department" VARCHAR(50),
    "observed_role" VARCHAR(20) NOT NULL,
    "moment" INTEGER NOT NULL,
    "action" VARCHAR(20) NOT NULL,
    "method" VARCHAR(20),
    "observed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hand_hygiene_observations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "restraint_orders" (
    "id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "type" VARCHAR(20) NOT NULL,
    "reason" TEXT NOT NULL,
    "body_parts" JSONB,
    "ordered_by" UUID NOT NULL,
    "started_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "planned_until" TIMESTAMPTZ,
    "consent_obtained" BOOLEAN NOT NULL DEFAULT false,
    "status" VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    "discontinued_at" TIMESTAMPTZ,
    "discontinued_by" UUID,
    "encounter_id" UUID,
    "admission_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "restraint_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "restraint_monitorings" (
    "id" UUID NOT NULL,
    "restraint_id" UUID NOT NULL,
    "checked_by" UUID NOT NULL,
    "checked_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "circulation" VARCHAR(20),
    "skin_integrity" VARCHAR(20),
    "range_of_motion" BOOLEAN NOT NULL DEFAULT false,
    "repositioned" BOOLEAN NOT NULL DEFAULT false,
    "behavior" VARCHAR(50),
    "continued" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "restraint_monitorings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_credentials" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "type" VARCHAR(30) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "number" VARCHAR(100),
    "issuer" VARCHAR(200),
    "issued_at" TIMESTAMPTZ,
    "expires_at" TIMESTAMPTZ,
    "status" VARCHAR(20) NOT NULL DEFAULT 'VALID',
    "verified_by" UUID,
    "verified_at" TIMESTAMPTZ,
    "file_url" VARCHAR(500),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "staff_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_educations" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "course_name" VARCHAR(200) NOT NULL,
    "category" VARCHAR(30) NOT NULL,
    "completed_at" TIMESTAMPTZ,
    "expires_at" TIMESTAMPTZ,
    "due_date" TIMESTAMPTZ,
    "hours" DECIMAL(5,1),
    "status" VARCHAR(20) NOT NULL DEFAULT 'COMPLETED',
    "certificate_url" VARCHAR(500),
    "idempotency_key" VARCHAR(120),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "staff_educations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "committees" (
    "id" UUID NOT NULL,
    "code" VARCHAR(20),
    "quorum" INTEGER NOT NULL DEFAULT 0,
    "name" VARCHAR(150) NOT NULL,
    "type" VARCHAR(40) NOT NULL,
    "purpose" TEXT,
    "charter" TEXT,
    "meeting_cycle" VARCHAR(30),
    "chair_id" UUID,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "committees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "opening_task_records" (
    "id" UUID NOT NULL,
    "task_key" VARCHAR(80) NOT NULL,
    "state" VARCHAR(20) NOT NULL,
    "evidence_ref" VARCHAR(200),
    "evidence_date" DATE,
    "note" TEXT,
    "attachments" JSONB,
    "recorded_by" UUID NOT NULL,
    "recorded_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "opening_task_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "opening_custom_tasks" (
    "id" UUID NOT NULL,
    "key" VARCHAR(80) NOT NULL,
    "countries" TEXT[],
    "phase" VARCHAR(30) NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "owner" VARCHAR(100) NOT NULL,
    "authority" VARCHAR(200),
    "dueBy" VARCHAR(20) NOT NULL,
    "cycle" VARCHAR(20),
    "note" TEXT,
    "depends_on" TEXT[],
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "inactive_reason" TEXT,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "opening_custom_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "committee_members" (
    "id" UUID NOT NULL,
    "committee_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" VARCHAR(20) NOT NULL DEFAULT 'MEMBER',
    "joined_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "source" VARCHAR(10) NOT NULL DEFAULT 'MANUAL',
    "appointed_by" UUID,

    CONSTRAINT "committee_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "committee_meetings" (
    "id" UUID NOT NULL,
    "committee_id" UUID NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "scheduled_at" TIMESTAMPTZ NOT NULL,
    "location" VARCHAR(100),
    "agenda" TEXT,
    "minutes" TEXT,
    "decisions" JSONB,
    "minutes_signed_at" TIMESTAMPTZ,
    "minutes_sign_ref" VARCHAR(200),
    "attendees" JSONB,
    "status" VARCHAR(20) NOT NULL DEFAULT 'SCHEDULED',
    "created_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "committee_meetings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "institutional_policies" (
    "id" UUID NOT NULL,
    "code" VARCHAR(40),
    "title" VARCHAR(200) NOT NULL,
    "category" VARCHAR(40) NOT NULL,
    "version" VARCHAR(20) NOT NULL DEFAULT '1.0',
    "content" TEXT,
    "committee_id" UUID,
    "approved_by" UUID,
    "approved_at" TIMESTAMPTZ,
    "effective_date" TIMESTAMPTZ,
    "review_date" TIMESTAMPTZ,
    "status" VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "institutional_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "committee_agendas" (
    "id" UUID NOT NULL,
    "committee_id" UUID NOT NULL,
    "meeting_id" UUID,
    "seq" INTEGER,
    "title" VARCHAR(300) NOT NULL,
    "proposer_id" UUID NOT NULL,
    "source_ref" JSONB,
    "body" TEXT,
    "status" VARCHAR(20) NOT NULL DEFAULT 'SUBMITTED',
    "options" JSONB,
    "ai_assessment" JSONB,
    "ai_assessed_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "committee_agendas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "committee_decisions" (
    "id" UUID NOT NULL,
    "committee_id" UUID NOT NULL,
    "agenda_id" UUID NOT NULL,
    "decision_no" VARCHAR(30) NOT NULL,
    "resolution" TEXT NOT NULL,
    "chosen_option" JSONB,
    "vote_for" INTEGER,
    "vote_against" INTEGER,
    "vote_abstain" INTEGER,
    "resolved_at" TIMESTAMPTZ NOT NULL,
    "effective_from" TIMESTAMPTZ,
    "effective_until" TIMESTAMPTZ,
    "review_due" DATE,
    "status" VARCHAR(20) NOT NULL DEFAULT 'RESOLVED',
    "supersedes_id" UUID,
    "policy_id" UUID,
    "sign_ref" VARCHAR(200),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "committee_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "decision_actions" (
    "id" UUID NOT NULL,
    "decision_id" UUID,
    "registry_key" VARCHAR(80),
    "kind" VARCHAR(30) NOT NULL,
    "target" JSONB NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    "snapshot_before" JSONB,
    "enacted_at" TIMESTAMPTZ,
    "enacted_by" UUID,
    "error" VARCHAR(500),
    "manual_note" TEXT,
    "basis" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "decision_actions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "committee_surface_maps" (
    "id" UUID NOT NULL,
    "surface_key" VARCHAR(120) NOT NULL,
    "committee_id" UUID NOT NULL,
    "note" VARCHAR(300),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "committee_surface_maps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "decision_pathways" (
    "id" UUID NOT NULL,
    "code" VARCHAR(40) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" VARCHAR(12) NOT NULL DEFAULT 'DRAFT',
    "layer" VARCHAR(20) NOT NULL,
    "description" TEXT,
    "published_at" TIMESTAMPTZ,
    "published_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "decision_pathways_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "decision_pathway_steps" (
    "id" UUID NOT NULL,
    "pathway_id" UUID NOT NULL,
    "key" VARCHAR(40) NOT NULL,
    "title" VARCHAR(120) NOT NULL,
    "sort_order" INTEGER NOT NULL,
    "owner_roles" TEXT[],
    "gate" BOOLEAN NOT NULL DEFAULT false,
    "gate_rule" VARCHAR(40),
    "sla_days" INTEGER,
    "transitions" JSONB,

    CONSTRAINT "decision_pathway_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "decision_pathway_instances" (
    "id" UUID NOT NULL,
    "pathway_id" UUID NOT NULL,
    "pathway_version" INTEGER NOT NULL,
    "agenda_id" UUID,
    "registry_key" VARCHAR(80),
    "current_step_key" VARCHAR(40),
    "status" VARCHAR(12) NOT NULL DEFAULT 'ACTIVE',
    "started_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ,

    CONSTRAINT "decision_pathway_instances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "decision_pathway_step_states" (
    "id" UUID NOT NULL,
    "instance_id" UUID NOT NULL,
    "step_key" VARCHAR(40) NOT NULL,
    "status" VARCHAR(12) NOT NULL DEFAULT 'PENDING',
    "actor_id" UUID,
    "acted_at" TIMESTAMPTZ,
    "blocked_reason" TEXT,
    "note" TEXT,

    CONSTRAINT "decision_pathway_step_states_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "standard_governance_rules" (
    "id" UUID NOT NULL,
    "standard_kind" VARCHAR(20) NOT NULL,
    "standard_code" VARCHAR(60) NOT NULL DEFAULT '*',
    "require_all" BOOLEAN NOT NULL DEFAULT true,
    "actions" JSONB NOT NULL,
    "require_basis" TEXT[],
    "review_cycle_m" INTEGER,
    "gate_mode" VARCHAR(10) NOT NULL DEFAULT 'WARN',
    "delegation_ref" VARCHAR(30),
    "note" TEXT,
    "updated_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "standard_governance_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "patient_flags" (
    "id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "flagType" VARCHAR(20) NOT NULL,
    "reason" TEXT,
    "flagged_by" UUID NOT NULL,
    "related_user_id" UUID,
    "relation" VARCHAR(30),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "patient_flags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workstation_configs" (
    "id" UUID NOT NULL,
    "station_id" VARCHAR(30) NOT NULL,
    "label" VARCHAR(100) NOT NULL,
    "category" VARCHAR(20) NOT NULL,
    "department" VARCHAR(50) NOT NULL,
    "order_codes" JSONB NOT NULL,
    "location" VARCHAR(100),
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workstation_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workstation_profiles" (
    "id" UUID NOT NULL,
    "code" VARCHAR(30) NOT NULL,
    "label" VARCHAR(100) NOT NULL,
    "department" VARCHAR(50),
    "location" VARCHAR(100),
    "default_station_ids" JSONB NOT NULL DEFAULT '[]',
    "terminal_id" UUID,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "workstation_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "peripheral_devices" (
    "id" UUID NOT NULL,
    "workstation_profile_id" UUID NOT NULL,
    "type" VARCHAR(20) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "connection" VARCHAR(15) NOT NULL DEFAULT 'NETWORK',
    "host" VARCHAR(120),
    "port" INTEGER,
    "config" JSONB,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "status" VARCHAR(10) NOT NULL DEFAULT 'UNKNOWN',
    "last_seen_at" TIMESTAMPTZ,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "peripheral_devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "duty_entries" (
    "id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "shift" VARCHAR(10) NOT NULL,
    "staff_id" VARCHAR(50) NOT NULL,
    "staff_name" VARCHAR(100) NOT NULL,
    "role" VARCHAR(20) NOT NULL,
    "department" VARCHAR(50) NOT NULL,
    "start_time" VARCHAR(5),
    "end_time" VARCHAR(5),
    "notes" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "duty_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "duty_swap_requests" (
    "id" UUID NOT NULL,
    "requester_id" VARCHAR(50) NOT NULL,
    "requester_name" VARCHAR(100) NOT NULL,
    "target_id" VARCHAR(50) NOT NULL,
    "target_name" VARCHAR(100) NOT NULL,
    "original_date" VARCHAR(10) NOT NULL,
    "original_shift" VARCHAR(10) NOT NULL,
    "swap_date" VARCHAR(10) NOT NULL,
    "swap_shift" VARCHAR(10) NOT NULL,
    "reason" TEXT NOT NULL,
    "status" VARCHAR(10) NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "duty_swap_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "duty_leave_requests" (
    "id" UUID NOT NULL,
    "staff_id" VARCHAR(50) NOT NULL,
    "staff_name" VARCHAR(100) NOT NULL,
    "department" VARCHAR(50) NOT NULL,
    "start_date" VARCHAR(10) NOT NULL,
    "end_date" VARCHAR(10) NOT NULL,
    "type" VARCHAR(15) NOT NULL,
    "reason" TEXT NOT NULL,
    "status" VARCHAR(10) NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "duty_leave_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "duty_staffing_rules" (
    "id" UUID NOT NULL,
    "department" VARCHAR(50) NOT NULL,
    "shift" VARCHAR(10) NOT NULL,
    "day_type" VARCHAR(10) NOT NULL DEFAULT 'ALL',
    "min_count" INTEGER NOT NULL DEFAULT 1,
    "nurse_grade" VARCHAR(10),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "duty_staffing_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "on_call_schedules" (
    "id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "department" VARCHAR(50) NOT NULL,
    "call_level" VARCHAR(10) NOT NULL,
    "staff_id" UUID NOT NULL,
    "staff_name" VARCHAR(100) NOT NULL,
    "note" VARCHAR(200),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "on_call_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "duty_preferences" (
    "id" UUID NOT NULL,
    "staff_id" UUID NOT NULL,
    "month" VARCHAR(7) NOT NULL,
    "date" VARCHAR(10) NOT NULL,
    "kind" VARCHAR(10) NOT NULL,
    "note" VARCHAR(200),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "duty_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "training_logbooks" (
    "id" UUID NOT NULL,
    "user_id" VARCHAR(50) NOT NULL,
    "date" DATE NOT NULL,
    "category" VARCHAR(20) NOT NULL,
    "procedure_name" VARCHAR(200),
    "icd_code" VARCHAR(20),
    "role" VARCHAR(20) NOT NULL DEFAULT 'ASSISTANT',
    "supervisor" VARCHAR(100),
    "department" VARCHAR(50),
    "patient_age" INTEGER,
    "complexity" VARCHAR(20) NOT NULL DEFAULT 'MODERATE',
    "outcome" VARCHAR(20) NOT NULL DEFAULT 'SUCCESSFUL',
    "reflection" TEXT,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "training_logbooks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "epa_assessments" (
    "id" UUID NOT NULL,
    "user_id" VARCHAR(50) NOT NULL,
    "epa_number" VARCHAR(20) NOT NULL,
    "epa_title" VARCHAR(200),
    "entrustment_level" INTEGER NOT NULL DEFAULT 1,
    "assessor" VARCHAR(100),
    "assessor_role" VARCHAR(50),
    "clinical_context" TEXT,
    "strengths" TEXT,
    "improvements" TEXT,
    "feedback" TEXT,
    "assessed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "epa_assessments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "training_rotations" (
    "id" UUID NOT NULL,
    "resident_id" VARCHAR(50) NOT NULL,
    "resident_name" VARCHAR(100) NOT NULL,
    "department" VARCHAR(50) NOT NULL,
    "start_date" VARCHAR(10) NOT NULL,
    "end_date" VARCHAR(10) NOT NULL,
    "supervisor" VARCHAR(100),
    "objectives" JSONB,
    "assigned_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "training_rotations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "case_presentations" (
    "id" UUID NOT NULL,
    "title" VARCHAR(300) NOT NULL,
    "presenter" VARCHAR(100),
    "department" VARCHAR(50),
    "presentation_date" DATE NOT NULL,
    "case_type" VARCHAR(20) NOT NULL DEFAULT 'CLINICAL',
    "diagnosis" VARCHAR(300),
    "summary" TEXT,
    "learning_points" JSONB,
    "attendees" JSONB,
    "feedback" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "case_presentations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lab_test_templates" (
    "id" UUID NOT NULL,
    "procedure_code" VARCHAR(20) NOT NULL,
    "test_name" VARCHAR(200) NOT NULL,
    "station_id" VARCHAR(30) NOT NULL,
    "items" JSONB NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "lab_test_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "therapy_orders" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "therapy_type" VARCHAR(30) NOT NULL,
    "scheduled_date" DATE NOT NULL,
    "scheduled_time" VARCHAR(10),
    "duration" INTEGER,
    "therapist_id" UUID,
    "station_id" VARCHAR(30),
    "is_recurring" BOOLEAN NOT NULL DEFAULT false,
    "recur_pattern" VARCHAR(50),
    "recur_end_date" DATE,
    "total_sessions" INTEGER,
    "session_no" INTEGER,
    "result_data" JSONB,
    "completed_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "therapy_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "checkup_test_masters" (
    "id" UUID NOT NULL,
    "code" VARCHAR(30) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "category" VARCHAR(20) NOT NULL,
    "sub_category" VARCHAR(50),
    "interpret_dept" VARCHAR(50),
    "unit" VARCHAR(30),
    "reference_range" VARCHAR(100),
    "default_price" INTEGER NOT NULL DEFAULT 0,
    "duration" INTEGER NOT NULL DEFAULT 5,
    "description" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "checkup_test_masters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "checkup_programs" (
    "id" UUID NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "category" VARCHAR(20) NOT NULL,
    "description" TEXT,
    "gender" VARCHAR(10) NOT NULL DEFAULT 'ALL',
    "age_min" INTEGER,
    "age_max" INTEGER,
    "price" INTEGER NOT NULL,
    "discount_rate" INTEGER NOT NULL DEFAULT 0,
    "duration" INTEGER NOT NULL DEFAULT 120,
    "daily_capacity" INTEGER,
    "items" JSONB NOT NULL,
    "options" JSONB,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "checkup_programs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ck_questionnaires" (
    "id" UUID NOT NULL,
    "program_id" UUID,
    "title" VARCHAR(200) NOT NULL,
    "sections" JSONB NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "ck_questionnaires_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ck_questionnaire_responses" (
    "id" UUID NOT NULL,
    "questionnaire_id" UUID NOT NULL,
    "visit_id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "answers" JSONB NOT NULL,
    "completed_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ck_questionnaire_responses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ck_stations" (
    "id" UUID NOT NULL,
    "station_id" VARCHAR(30) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "category" VARCHAR(20) NOT NULL,
    "location" VARCHAR(100),
    "icon" VARCHAR(10),
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "avg_minutes" INTEGER NOT NULL DEFAULT 5,
    "capacity" INTEGER NOT NULL DEFAULT 1,
    "template" JSONB,
    "his_mapping" JSONB,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ck_stations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ck_station_logs" (
    "id" UUID NOT NULL,
    "visit_id" UUID NOT NULL,
    "station_id" VARCHAR(30) NOT NULL,
    "arrived_at" TIMESTAMPTZ NOT NULL,
    "started_at" TIMESTAMPTZ,
    "completed_at" TIMESTAMPTZ,
    "operator_id" UUID,
    "result_data" JSONB,
    "finding" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    "note" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ck_station_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "checkup_visits" (
    "id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "program_id" UUID NOT NULL,
    "encounter_id" UUID,
    "scheduled_date" DATE NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'RESERVED',
    "selected_options" JSONB,
    "total_price" INTEGER NOT NULL,
    "checked_in_at" TIMESTAMPTZ,
    "completed_at" TIMESTAMPTZ,
    "barcode_number" VARCHAR(20),
    "questionnaire_id" UUID,
    "is_nhi_screening" BOOLEAN NOT NULL DEFAULT false,
    "nhi_screening_code" VARCHAR(10),
    "contract_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "checkup_visits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "checkup_result_items" (
    "id" UUID NOT NULL,
    "visit_id" UUID NOT NULL,
    "category" VARCHAR(20) NOT NULL,
    "test_code" VARCHAR(30),
    "test_name" VARCHAR(200) NOT NULL,
    "value" VARCHAR(200),
    "unit" VARCHAR(50),
    "reference_range" VARCHAR(100),
    "finding" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    "grade" VARCHAR(5),
    "source_type" VARCHAR(30),
    "source_id" UUID,
    "note" TEXT,
    "completed_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "checkup_result_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "checkup_summaries" (
    "id" UUID NOT NULL,
    "visit_id" UUID NOT NULL,
    "overall_grade" VARCHAR(5) NOT NULL,
    "sections" JSONB NOT NULL,
    "doctor_opinion" TEXT,
    "recommendations" JSONB,
    "reviewed_by" UUID,
    "authored_by" UUID,
    "signed_by" UUID,
    "signed_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "checkup_summaries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ck_interpretations" (
    "id" UUID NOT NULL,
    "visit_id" UUID NOT NULL,
    "result_item_id" UUID NOT NULL,
    "department" VARCHAR(50) NOT NULL,
    "requested_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "interpreted_by" UUID,
    "interpreted_at" TIMESTAMPTZ,
    "finding" TEXT,
    "grade" VARCHAR(5),
    "recommendation" TEXT,
    "status" VARCHAR(20) NOT NULL DEFAULT 'REQUESTED',

    CONSTRAINT "ck_interpretations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "checkup_explainer_contents" (
    "id" UUID NOT NULL,
    "test_code" VARCHAR(30) NOT NULL,
    "test_name" VARCHAR(200) NOT NULL,
    "plain_what" TEXT,
    "plain_meaning" TEXT,
    "lifestyle_info" TEXT,
    "when_to_see_doctor" TEXT,
    "source_ref" VARCHAR(300),
    "status" VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "content_hash" VARCHAR(64),
    "reviewed_by" UUID,
    "reviewed_by_name" VARCHAR(100),
    "reviewed_at" TIMESTAMPTZ,
    "review_note" TEXT,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "checkup_explainer_contents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "checkup_explainer_reviews" (
    "id" UUID NOT NULL,
    "content_id" UUID NOT NULL,
    "test_code" VARCHAR(30) NOT NULL,
    "decision" VARCHAR(20) NOT NULL,
    "content_hash" VARCHAR(64),
    "note" TEXT,
    "reviewed_by" UUID NOT NULL,
    "reviewed_by_name" VARCHAR(100) NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "checkup_explainer_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ck_protocols" (
    "id" UUID NOT NULL,
    "code" VARCHAR(40) NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "program_id" UUID,
    "gender" VARCHAR(10) NOT NULL DEFAULT 'ALL',
    "age_min" INTEGER,
    "age_max" INTEGER,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" VARCHAR(12) NOT NULL DEFAULT 'DRAFT',
    "require_all_interpretations" BOOLEAN NOT NULL DEFAULT true,
    "require_four_eyes" BOOLEAN NOT NULL DEFAULT false,
    "signer_roles" TEXT[] DEFAULT ARRAY['DOCTOR']::TEXT[],
    "panel_test_codes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "published_at" TIMESTAMPTZ,
    "published_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "ck_protocols_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ck_judgment_rules" (
    "id" UUID NOT NULL,
    "protocol_id" UUID NOT NULL,
    "test_code" VARCHAR(30) NOT NULL,
    "sex" VARCHAR(10) NOT NULL DEFAULT 'ALL',
    "age_min" INTEGER,
    "age_max" INTEGER,
    "normal_low" DOUBLE PRECISION,
    "normal_high" DOUBLE PRECISION,
    "grade_bands" JSONB,
    "panic_low" DOUBLE PRECISION,
    "panic_high" DOUBLE PRECISION,
    "interpret_dept" VARCHAR(50),
    "required_interpretation" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "ck_judgment_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ck_referrals" (
    "id" UUID NOT NULL,
    "visit_id" UUID NOT NULL,
    "result_item_id" UUID,
    "to_department" VARCHAR(50) NOT NULL,
    "reason" TEXT NOT NULL,
    "urgency" VARCHAR(20) NOT NULL DEFAULT 'ROUTINE',
    "appointment_id" UUID,
    "referral_id" UUID,
    "status" VARCHAR(20) NOT NULL DEFAULT 'CREATED',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ck_referrals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ck_follow_ups" (
    "id" UUID NOT NULL,
    "visit_id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "follow_up_type" VARCHAR(30) NOT NULL,
    "description" VARCHAR(500) NOT NULL,
    "due_date" DATE NOT NULL,
    "reminder_sent" BOOLEAN NOT NULL DEFAULT false,
    "completed_at" TIMESTAMPTZ,
    "linked_visit_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ck_follow_ups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ck_contracts" (
    "id" UUID NOT NULL,
    "company_name" VARCHAR(200) NOT NULL,
    "contact_person" VARCHAR(100),
    "contact_phone" VARCHAR(20),
    "program_id" UUID NOT NULL,
    "headcount" INTEGER NOT NULL,
    "discount_rate" INTEGER NOT NULL,
    "contract_date" DATE NOT NULL,
    "expiry_date" DATE NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ck_contracts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clinical_pathways" (
    "id" UUID NOT NULL,
    "code" VARCHAR(30) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "department" VARCHAR(50) NOT NULL,
    "target_drg" VARCHAR(20),
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
    "total_days" INTEGER NOT NULL,
    "description" TEXT,
    "created_by" UUID NOT NULL,
    "published_at" TIMESTAMPTZ,
    "published_by" UUID,
    "governance_ref" VARCHAR(30),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "clinical_pathways_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pathway_milestones" (
    "id" UUID NOT NULL,
    "pathway_id" UUID NOT NULL,
    "day" INTEGER NOT NULL,
    "category" VARCHAR(30) NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "detail" JSONB,
    "is_required" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "pathway_milestones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pathway_assignments" (
    "id" UUID NOT NULL,
    "pathway_id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "encounter_id" UUID NOT NULL,
    "start_date" DATE NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    "deviations" INTEGER NOT NULL DEFAULT 0,
    "actual_days" INTEGER,
    "note" TEXT,
    "assigned_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ,

    CONSTRAINT "pathway_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "milestone_outcomes" (
    "id" UUID NOT NULL,
    "assignment_id" UUID NOT NULL,
    "milestone_id" UUID NOT NULL,
    "actual_day" INTEGER NOT NULL,
    "status" VARCHAR(20) NOT NULL,
    "variance" TEXT,
    "performed_by" UUID,
    "performed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "milestone_outcomes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mdt_conferences" (
    "id" UUID NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "conference_type" VARCHAR(30) NOT NULL,
    "department" VARCHAR(50) NOT NULL,
    "scheduled_at" TIMESTAMPTZ NOT NULL,
    "location" VARCHAR(100),
    "status" VARCHAR(20) NOT NULL DEFAULT 'SCHEDULED',
    "chairperson_id" UUID NOT NULL,
    "notes" TEXT,
    "recording_url" TEXT,
    "minutes" TEXT,
    "minutes_generated_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mdt_conferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mdt_cases" (
    "id" UUID NOT NULL,
    "conference_id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "presenter_id" UUID NOT NULL,
    "primary_diag" VARCHAR(200) NOT NULL,
    "tnm_stage" VARCHAR(30),
    "clinical_summary" TEXT,
    "imaging_summary" TEXT,
    "pathology_summary" TEXT,
    "lab_summary" TEXT,
    "proposed_plan" TEXT,
    "decision" TEXT,
    "decision_category" VARCHAR(30),
    "follow_up" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "mdt_cases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mdt_attendees" (
    "id" UUID NOT NULL,
    "conference_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "department" VARCHAR(50) NOT NULL,
    "role" VARCHAR(20) NOT NULL,
    "attended" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "mdt_attendees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cancer_registries" (
    "id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "registration_no" VARCHAR(20) NOT NULL,
    "diagnosis_date" DATE NOT NULL,
    "primary_site" VARCHAR(10) NOT NULL,
    "morphology" VARCHAR(10) NOT NULL,
    "behavior" VARCHAR(5) NOT NULL,
    "grade" VARCHAR(5),
    "laterality" VARCHAR(10),
    "diagnosis_basis" VARCHAR(20) NOT NULL,
    "icd_code" VARCHAR(10) NOT NULL,
    "tnm_clinical" VARCHAR(20),
    "tnm_pathological" VARCHAR(20),
    "ajcc_stage" VARCHAR(10),
    "ajcc_edition" INTEGER,
    "first_treatment" VARCHAR(30),
    "first_treatment_date" DATE,
    "recurrence_date" DATE,
    "recurrence_site" VARCHAR(100),
    "vital_status" VARCHAR(20) NOT NULL DEFAULT 'ALIVE',
    "last_contact_date" DATE,
    "death_date" DATE,
    "cause_of_death" VARCHAR(10),
    "registrar_id" UUID NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'REGISTERED',
    "reported_to_kccr" BOOLEAN NOT NULL DEFAULT false,
    "kccr_transmitted_at" TIMESTAMPTZ,
    "kccr_submission_id" VARCHAR(60),
    "verified_at" TIMESTAMPTZ,
    "verified_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "cancer_registries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cancer_treatments" (
    "id" UUID NOT NULL,
    "registry_id" UUID NOT NULL,
    "treatment_type" VARCHAR(30) NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE,
    "regimen" VARCHAR(200),
    "cycles" INTEGER,
    "response" VARCHAR(20),
    "surgery_type" VARCHAR(100),
    "radiation_dose" VARCHAR(50),
    "note" TEXT,

    CONSTRAINT "cancer_treatments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cancer_follow_ups" (
    "id" UUID NOT NULL,
    "registry_id" UUID NOT NULL,
    "follow_up_date" DATE NOT NULL,
    "status" VARCHAR(20) NOT NULL,
    "recurrence" BOOLEAN NOT NULL DEFAULT false,
    "metastasis_site" VARCHAR(100),
    "performance_status" VARCHAR(10),
    "note" TEXT,
    "recorded_by" UUID NOT NULL,

    CONSTRAINT "cancer_follow_ups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "research_studies" (
    "id" UUID NOT NULL,
    "study_no" VARCHAR(30) NOT NULL,
    "title" TEXT NOT NULL,
    "pi_user_id" UUID NOT NULL,
    "department" VARCHAR(50) NOT NULL,
    "study_type" VARCHAR(30) NOT NULL,
    "phase" VARCHAR(10),
    "sponsor" VARCHAR(200),
    "irb_status" VARCHAR(20) NOT NULL DEFAULT 'SUBMITTED',
    "irb_approval_date" DATE,
    "irb_expiry_date" DATE,
    "target_enroll" INTEGER,
    "current_enroll" INTEGER NOT NULL DEFAULT 0,
    "start_date" DATE,
    "end_date" DATE,
    "description" TEXT,
    "protocol" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "research_studies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "research_subjects" (
    "id" UUID NOT NULL,
    "study_id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "subject_no" VARCHAR(20) NOT NULL,
    "consent_date" DATE NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'ENROLLED',
    "withdraw_date" DATE,
    "withdraw_reason" TEXT,
    "arm_group" VARCHAR(50),
    "enrolled_by" UUID NOT NULL,

    CONSTRAINT "research_subjects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "research_documents" (
    "id" UUID NOT NULL,
    "study_id" UUID NOT NULL,
    "doc_type" VARCHAR(30) NOT NULL,
    "version" VARCHAR(10) NOT NULL,
    "file_name" VARCHAR(200) NOT NULL,
    "file_url" TEXT NOT NULL,
    "uploaded_by" UUID NOT NULL,
    "uploaded_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "research_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "irb_amendments" (
    "id" UUID NOT NULL,
    "study_id" UUID NOT NULL,
    "amendment_no" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "changes" JSONB NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'SUBMITTED',
    "submitted_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewed_at" TIMESTAMPTZ,
    "review_note" TEXT,

    CONSTRAINT "irb_amendments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cost_centers" (
    "id" UUID NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "type" VARCHAR(20) NOT NULL,
    "parent_id" UUID,
    "department" VARCHAR(50) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "cost_centers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cost_drivers" (
    "id" UUID NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "category" VARCHAR(20) NOT NULL,
    "unit" VARCHAR(20) NOT NULL,
    "unit_cost" DECIMAL(12,2) NOT NULL,
    "period" VARCHAR(10) NOT NULL,
    "note" TEXT,

    CONSTRAINT "cost_drivers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cost_allocations" (
    "id" UUID NOT NULL,
    "cost_center_id" UUID NOT NULL,
    "cost_driver_id" UUID,
    "period" VARCHAR(10) NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "quantity" DECIMAL(10,2),
    "allocated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" VARCHAR(20) NOT NULL,

    CONSTRAINT "cost_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "procedure_costs" (
    "id" UUID NOT NULL,
    "procedure_code" VARCHAR(20) NOT NULL,
    "procedure_name" VARCHAR(200) NOT NULL,
    "period" VARCHAR(10) NOT NULL,
    "direct_cost" DECIMAL(12,2) NOT NULL,
    "indirect_cost" DECIMAL(12,2) NOT NULL,
    "total_cost" DECIMAL(12,2) NOT NULL,
    "revenue_avg" DECIMAL(12,2) NOT NULL,
    "margin" DECIMAL(8,4) NOT NULL,
    "volume_count" INTEGER NOT NULL,

    CONSTRAINT "procedure_costs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "flow_sheet_entries" (
    "id" UUID NOT NULL,
    "admission_id" UUID NOT NULL,
    "nurse_id" UUID NOT NULL,
    "recorded_at" TIMESTAMPTZ NOT NULL,
    "systolic_bp" INTEGER,
    "diastolic_bp" INTEGER,
    "heart_rate" INTEGER,
    "temperature" DECIMAL(4,1),
    "spo2" INTEGER,
    "respiratory_rate" INTEGER,
    "consciousness" VARCHAR(20),
    "pain_score" INTEGER,
    "pain_location" VARCHAR(100),
    "intake_oral" INTEGER,
    "intake_iv" INTEGER,
    "intake_other" INTEGER,
    "output_urine" INTEGER,
    "output_drain" INTEGER,
    "output_other" INTEGER,
    "pupil_left" VARCHAR(20),
    "pupil_right" VARCHAR(20),
    "gcs_score" INTEGER,
    "sedation_score" INTEGER,
    "notes" TEXT,
    "shift_type" "ShiftType" NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "flow_sheet_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "nursing_checklists" (
    "id" UUID NOT NULL,
    "admission_id" UUID NOT NULL,
    "nurse_id" UUID NOT NULL,
    "template_type" VARCHAR(30) NOT NULL,
    "shift_type" "ShiftType",
    "items" JSONB NOT NULL,
    "total_items" INTEGER NOT NULL,
    "checked_items" INTEGER NOT NULL DEFAULT 0,
    "completed_at" TIMESTAMPTZ,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "nursing_checklists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "nursing_checklist_templates" (
    "id" UUID NOT NULL,
    "code" VARCHAR(30) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "items" JSONB NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "source" VARCHAR(60),
    "updated_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "nursing_checklist_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organizations" (
    "id" UUID NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "org_type" VARCHAR(30) NOT NULL,
    "grade" VARCHAR(20),
    "country" VARCHAR(3) NOT NULL DEFAULT 'KOR',
    "address" JSONB,
    "phone" VARCHAR(30),
    "fhir_endpoint" TEXT,
    "smart_client_id" VARCHAR(100),
    "smart_secret" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "is_self" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transfer_records" (
    "id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "from_org_id" UUID NOT NULL,
    "to_org_id" UUID NOT NULL,
    "transfer_type" VARCHAR(20) NOT NULL,
    "status" VARCHAR(20) NOT NULL,
    "urgency" VARCHAR(10) NOT NULL,
    "reason" TEXT NOT NULL,
    "clinical_summary" TEXT,
    "diagnoses" JSONB,
    "medications" JSONB,
    "allergies" JSONB,
    "lab_results" JSONB,
    "fhir_bundle_id" TEXT,
    "fhir_bundle" JSONB,
    "requested_by" UUID,
    "accepted_by" UUID,
    "requested_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "accepted_at" TIMESTAMPTZ,
    "transferred_at" TIMESTAMPTZ,
    "completed_at" TIMESTAMPTZ,
    "response_note" TEXT,
    "metadata" JSONB,

    CONSTRAINT "transfer_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public_access_logs" (
    "id" UUID NOT NULL,
    "channel" VARCHAR(20) NOT NULL,
    "action" VARCHAR(20) NOT NULL,
    "path" VARCHAR(300) NOT NULL,
    "result" VARCHAR(20) NOT NULL,
    "subject_hash" VARCHAR(64),
    "patient_id" UUID,
    "session_ref" UUID,
    "detail" JSONB,
    "ip_address" VARCHAR(45),
    "user_agent" TEXT,
    "at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "public_access_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "smart_access_logs" (
    "id" UUID NOT NULL,
    "client_id" VARCHAR(100) NOT NULL,
    "client_name" VARCHAR(200),
    "user_id" UUID,
    "patient_id" UUID,
    "resource_type" VARCHAR(50) NOT NULL,
    "action" VARCHAR(20) NOT NULL,
    "path" VARCHAR(300) NOT NULL,
    "scope" VARCHAR(500),
    "ip_address" VARCHAR(45),
    "user_agent" TEXT,
    "at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "smart_access_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "smart_clients" (
    "id" UUID NOT NULL,
    "client_id" VARCHAR(100) NOT NULL,
    "client_secret" VARCHAR(500) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "org_id" UUID,
    "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "redirect_uris" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "launch_url" VARCHAR(500),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_used_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "smart_clients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "twin_risk_assessments" (
    "id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "status" VARCHAR(20) NOT NULL,
    "method" VARCHAR(50),
    "occurrence_datetime" TIMESTAMPTZ,
    "basis" JSONB,
    "prediction" JSONB,
    "note" TEXT,
    "ai_generated" BOOLEAN NOT NULL DEFAULT true,
    "author_fhir_user" VARCHAR(200),
    "client_id" VARCHAR(100),
    "resource_json" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "twin_risk_assessments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "twin_document_references" (
    "id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "status" VARCHAR(20) NOT NULL,
    "doc_type" VARCHAR(100),
    "description" TEXT,
    "content_text" TEXT,
    "ai_generated" BOOLEAN NOT NULL DEFAULT true,
    "author_fhir_user" VARCHAR(200),
    "client_id" VARCHAR(100),
    "resource_json" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "twin_document_references_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "issued_documents" (
    "issue_no" VARCHAR(60) NOT NULL,
    "document_type" VARCHAR(40) NOT NULL,
    "source_id" VARCHAR(64) NOT NULL,
    "patient_id" UUID,
    "snapshot_json" JSONB NOT NULL,
    "form_version" VARCHAR(20) NOT NULL DEFAULT 'v1',
    "hash" VARCHAR(64) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'ORIGINAL',
    "reissue_of" VARCHAR(60),
    "date_key" VARCHAR(8) NOT NULL,
    "seq" INTEGER NOT NULL,
    "issued_by" UUID,
    "issued_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "signature_request_id" VARCHAR(64),

    CONSTRAINT "issued_documents_pkey" PRIMARY KEY ("issue_no")
);

-- CreateTable
CREATE TABLE "partner_requests" (
    "id" UUID NOT NULL,
    "org_name" VARCHAR(200) NOT NULL,
    "org_type" VARCHAR(30) NOT NULL,
    "org_code" VARCHAR(20),
    "country" VARCHAR(3) NOT NULL,
    "contact_name" VARCHAR(100) NOT NULL,
    "contact_email" VARCHAR(200) NOT NULL,
    "contact_phone" VARCHAR(30),
    "tech_contact_name" VARCHAR(100),
    "tech_contact_email" VARCHAR(200),
    "fhir_base_url" TEXT,
    "purpose" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "requested_scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" VARCHAR(20) NOT NULL,
    "review_note" TEXT,
    "reviewed_by" UUID,
    "reviewed_at" TIMESTAMPTZ,
    "org_id" UUID,
    "smart_client_id" UUID,
    "ip_whitelist" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "rate_limit" INTEGER,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "partner_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_access_logs" (
    "id" UUID NOT NULL,
    "client_id" VARCHAR(100) NOT NULL,
    "org_id" UUID,
    "method" VARCHAR(10) NOT NULL,
    "path" VARCHAR(500) NOT NULL,
    "status_code" INTEGER NOT NULL,
    "response_time" INTEGER NOT NULL,
    "ip_address" VARCHAR(50),
    "user_agent" VARCHAR(500),
    "error_message" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_access_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hie_exchanges" (
    "id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "direction" VARCHAR(10) NOT NULL,
    "document_type" VARCHAR(10) NOT NULL,
    "document_title" VARCHAR(200),
    "target_org_id" UUID,
    "source_org_id" UUID,
    "format" VARCHAR(10) NOT NULL,
    "status" VARCHAR(20) NOT NULL,
    "cda_document" TEXT,
    "fhir_bundle" JSONB,
    "error_message" TEXT,
    "requested_by" UUID,
    "sent_at" TIMESTAMPTZ,
    "received_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hie_exchanges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_campaigns" (
    "id" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "type" VARCHAR(30) NOT NULL,
    "channel" VARCHAR(20) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
    "segment_id" UUID,
    "target_count" INTEGER NOT NULL DEFAULT 0,
    "template_id" UUID,
    "subject" VARCHAR(200),
    "content" TEXT NOT NULL,
    "variables" JSONB,
    "scheduled_at" TIMESTAMPTZ,
    "sent_at" TIMESTAMPTZ,
    "completed_at" TIMESTAMPTZ,
    "sent_count" INTEGER NOT NULL DEFAULT 0,
    "delivered_count" INTEGER NOT NULL DEFAULT 0,
    "opened_count" INTEGER NOT NULL DEFAULT 0,
    "clicked_count" INTEGER NOT NULL DEFAULT 0,
    "failed_count" INTEGER NOT NULL DEFAULT 0,
    "ab_test_enabled" BOOLEAN NOT NULL DEFAULT false,
    "ab_variant_name" VARCHAR(50),
    "ab_parent_id" UUID,
    "ab_split_ratio" INTEGER,
    "conversion_count" INTEGER NOT NULL DEFAULT 0,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "crm_campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_campaign_logs" (
    "id" UUID NOT NULL,
    "campaign_id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "channel" VARCHAR(20) NOT NULL,
    "status" VARCHAR(20) NOT NULL,
    "sent_at" TIMESTAMPTZ,
    "delivered_at" TIMESTAMPTZ,
    "opened_at" TIMESTAMPTZ,
    "error_message" VARCHAR(500),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crm_campaign_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_templates" (
    "id" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "type" VARCHAR(30) NOT NULL,
    "channel" VARCHAR(20) NOT NULL,
    "locale" VARCHAR(5) NOT NULL DEFAULT 'ko',
    "subject" VARCHAR(200),
    "content" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "crm_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_segments" (
    "id" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "description" TEXT,
    "type" VARCHAR(20) NOT NULL,
    "rules" JSONB NOT NULL,
    "patient_count" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_refreshed_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "crm_segments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "patient_communication_logs" (
    "id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "channel" VARCHAR(20) NOT NULL,
    "direction" VARCHAR(10) NOT NULL,
    "type" VARCHAR(30) NOT NULL,
    "subject" VARCHAR(200),
    "content" TEXT,
    "status" VARCHAR(20) NOT NULL,
    "campaign_id" UUID,
    "sent_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "patient_communication_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "patient_consents_crm" (
    "id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "channel" VARCHAR(20) NOT NULL,
    "type" VARCHAR(30) NOT NULL,
    "consented" BOOLEAN NOT NULL,
    "consented_at" TIMESTAMPTZ,
    "withdrawn_at" TIMESTAMPTZ,
    "source" VARCHAR(30),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "patient_consents_crm_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_foreign_patient_cases" (
    "id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "assigned_to" UUID NOT NULL,
    "source" VARCHAR(30) NOT NULL,
    "agency_name" VARCHAR(200),
    "arrival_date" DATE,
    "departure_date" DATE,
    "accommodation" VARCHAR(200),
    "interpreter_lang" VARCHAR(10),
    "package_type" VARCHAR(30),
    "estimated_cost" DECIMAL(12,0),
    "actual_cost" DECIMAL(12,0),
    "status" VARCHAR(20) NOT NULL DEFAULT 'INQUIRY',
    "satisfaction_score" INTEGER,
    "note" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "crm_foreign_patient_cases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_portal_banners" (
    "id" UUID NOT NULL,
    "type" VARCHAR(20) NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "content" TEXT,
    "image_url" VARCHAR(500),
    "link_url" VARCHAR(500),
    "link_type" VARCHAR(20),
    "segment_id" UUID,
    "target_all" BOOLEAN NOT NULL DEFAULT true,
    "publish_from" TIMESTAMPTZ NOT NULL,
    "publish_until" TIMESTAMPTZ NOT NULL,
    "show_once_per_day" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "impression_count" INTEGER NOT NULL DEFAULT 0,
    "click_count" INTEGER NOT NULL DEFAULT 0,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "crm_portal_banners_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "registration_consents" (
    "id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "type" VARCHAR(30) NOT NULL,
    "version" VARCHAR(10) NOT NULL DEFAULT '1.0',
    "agreed" BOOLEAN NOT NULL,
    "signed_at" TIMESTAMPTZ,
    "signed_by" VARCHAR(100),
    "signature_data" TEXT,
    "sign_method" VARCHAR(20),
    "guardian_name" VARCHAR(100),
    "guardian_relation" VARCHAR(20),
    "revoked_at" TIMESTAMPTZ,
    "revoked_reason" VARCHAR(200),
    "expires_at" TIMESTAMPTZ,
    "renewed_from_id" UUID,
    "collected_by" UUID,
    "ip_address" VARCHAR(50),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "registration_consents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "remote_consultations" (
    "id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "doctor_id" UUID NOT NULL,
    "channel" VARCHAR(20) NOT NULL DEFAULT 'TEXT',
    "category" VARCHAR(30) NOT NULL DEFAULT 'GENERAL',
    "status" VARCHAR(20) NOT NULL DEFAULT 'REQUESTED',
    "priority" VARCHAR(10) NOT NULL DEFAULT 'NORMAL',
    "subject" VARCHAR(200) NOT NULL,
    "chief_complaint" TEXT,
    "symptom_duration" VARCHAR(50),
    "attachments" JSONB,
    "prior_lab_result_id" UUID,
    "prior_imaging_id" UUID,
    "encounter_id" UUID,
    "video_room_id" VARCHAR(100),
    "video_scheduled_at" TIMESTAMPTZ,
    "video_started_at" TIMESTAMPTZ,
    "video_ended_at" TIMESTAMPTZ,
    "video_duration_min" INTEGER,
    "recording_url" VARCHAR(500),
    "recording_consent" BOOLEAN NOT NULL DEFAULT false,
    "video_requested_by" VARCHAR(10),
    "video_requested_at" TIMESTAMPTZ,
    "doctor_assessment" TEXT,
    "doctor_plan" TEXT,
    "referral_needed" BOOLEAN NOT NULL DEFAULT false,
    "referral_reason" VARCHAR(200),
    "consultation_type" VARCHAR(30),
    "fee_amount" INTEGER,
    "billing_status" VARCHAR(20),
    "billing_id" UUID,
    "payment_method" VARCHAR(20),
    "is_free_consult" BOOLEAN NOT NULL DEFAULT false,
    "patient_rating" INTEGER,
    "patient_feedback" TEXT,
    "message_count" INTEGER NOT NULL DEFAULT 0,
    "last_message_at" TIMESTAMPTZ,
    "doctor_read_at" TIMESTAMPTZ,
    "doctor_replied_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "completed_at" TIMESTAMPTZ,

    CONSTRAINT "remote_consultations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consultation_messages" (
    "id" UUID NOT NULL,
    "consultation_id" UUID NOT NULL,
    "sender" VARCHAR(10) NOT NULL,
    "sender_id" UUID,
    "content" TEXT NOT NULL,
    "attachments" JSONB,
    "shared_lab_result_id" UUID,
    "shared_imaging_id" UUID,
    "shared_prescription_id" UUID,
    "is_medical_advice" BOOLEAN NOT NULL DEFAULT false,
    "is_read" BOOLEAN NOT NULL DEFAULT false,
    "read_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consultation_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "onboarding_invites" (
    "id" UUID NOT NULL,
    "token_hash" VARCHAR(64) NOT NULL,
    "candidate_family_name" VARCHAR(50) NOT NULL,
    "candidate_given_name" VARCHAR(50) NOT NULL,
    "email" VARCHAR(120),
    "phone" VARCHAR(20),
    "birth_date" TIMESTAMPTZ,
    "job_category" VARCHAR(30) NOT NULL,
    "department" VARCHAR(40),
    "hire_date" TIMESTAMPTZ NOT NULL,
    "contract_type" VARCHAR(20) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'INVITED',
    "provisional_user_id" UUID,
    "welcome_viewed_at" TIMESTAMPTZ,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "verified_at" TIMESTAMPTZ,
    "revoked_at" TIMESTAMPTZ,
    "created_by_id" UUID NOT NULL,
    "booted_user_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "onboarding_invites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "onboarding_sends" (
    "id" UUID NOT NULL,
    "invite_id" UUID NOT NULL,
    "channel" VARCHAR(10) NOT NULL,
    "sent_by_id" UUID NOT NULL,
    "meta" JSONB,
    "sent_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "onboarding_sends_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "onboarding_documents" (
    "id" UUID NOT NULL,
    "invite_id" UUID NOT NULL,
    "category" VARCHAR(20) NOT NULL,
    "file_key" VARCHAR(300) NOT NULL,
    "sensitive" BOOLEAN NOT NULL DEFAULT false,
    "status" VARCHAR(12) NOT NULL DEFAULT 'PENDING',
    "reviewer_id" UUID,
    "reject_reason" VARCHAR(300),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "onboarding_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "onboarding_profiles" (
    "id" UUID NOT NULL,
    "invite_id" UUID NOT NULL,
    "gender" VARCHAR(10),
    "nationality" VARCHAR(40) DEFAULT 'KR',
    "photo_key" VARCHAR(300),
    "zip_code" VARCHAR(10),
    "addr1" VARCHAR(200),
    "addr2" VARCHAR(200),
    "emg_name" VARCHAR(50),
    "emg_relation" VARCHAR(30),
    "emg_phone" VARCHAR(20),
    "education" JSONB,
    "career" JSONB,
    "licenses" JSONB,
    "military" VARCHAR(20),
    "dependents" JSONB,
    "sensitive_consent" BOOLEAN NOT NULL DEFAULT false,
    "submitted_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "onboarding_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "onboarding_contracts" (
    "id" UUID NOT NULL,
    "invite_id" UUID NOT NULL,
    "template_id" UUID NOT NULL,
    "pdf_key" VARCHAR(300),
    "signed_at" TIMESTAMPTZ,
    "signer_hash" VARCHAR(128),
    "signature_image_key" VARCHAR(300),
    "blockchain_tx_id" VARCHAR(120),

    CONSTRAINT "onboarding_contracts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "qr_sessions" (
    "id" UUID NOT NULL,
    "purpose" VARCHAR(16) NOT NULL,
    "token" VARCHAR(64) NOT NULL,
    "ref_type" VARCHAR(30),
    "ref_id" VARCHAR(64),
    "status" VARCHAR(12) NOT NULL DEFAULT 'OPEN',
    "created_by_id" UUID,
    "consumed_by_id" UUID,
    "device_id" UUID,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "consumed_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "qr_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance_records" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "clinic_user_id" VARCHAR(100),
    "type" VARCHAR(10) NOT NULL,
    "method" VARCHAR(10) NOT NULL,
    "device_id" UUID,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "correction_of" UUID,
    "provisional" BOOLEAN NOT NULL DEFAULT false,
    "auto_closed_at" TIMESTAMPTZ,
    "at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attendance_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leave_requests" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "type" VARCHAR(12) NOT NULL,
    "from_date" TIMESTAMPTZ NOT NULL,
    "to_date" TIMESTAMPTZ NOT NULL,
    "days" DOUBLE PRECISION NOT NULL,
    "reason" VARCHAR(300),
    "status" VARCHAR(12) NOT NULL DEFAULT 'REQUESTED',
    "approver_id" UUID,
    "attachment_doc_id" UUID,
    "eapproval_ref" VARCHAR(80),
    "decided_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "leave_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leave_balances" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "year" INTEGER NOT NULL,
    "type" VARCHAR(12) NOT NULL,
    "granted" DOUBLE PRECISION NOT NULL,
    "used" DOUBLE PRECISION NOT NULL DEFAULT 0,

    CONSTRAINT "leave_balances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employment_certificates" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "kind" VARCHAR(12) NOT NULL,
    "pdf_key" VARCHAR(300) NOT NULL,
    "verify_code" VARCHAR(40) NOT NULL,
    "revoked" BOOLEAN NOT NULL DEFAULT false,
    "issued_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "employment_certificates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "voucher_policies" (
    "id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "enabled_forms" TEXT[],
    "serial_prefix" TEXT NOT NULL DEFAULT 'WGC',
    "validity_months" INTEGER NOT NULL,
    "refund_window_months" INTEGER NOT NULL,
    "balance_refund_rate" INTEGER NOT NULL,
    "max_commission_rate" INTEGER NOT NULL,
    "domestic_max_commission_rate" INTEGER NOT NULL DEFAULT 15,
    "max_hierarchy_depth" INTEGER NOT NULL DEFAULT 2,
    "prepayment_required" BOOLEAN NOT NULL DEFAULT true,
    "foreigner_only" BOOLEAN NOT NULL DEFAULT true,
    "allowed_categories" TEXT[],
    "anchor_chain_type" TEXT NOT NULL DEFAULT 'INTERNAL',
    "anchor_interval_min" INTEGER NOT NULL DEFAULT 60,
    "diff_policy" TEXT NOT NULL DEFAULT 'RESIDUAL_VOUCHER',
    "approved_by" UUID,
    "updated_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "voucher_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "voucher_batches" (
    "id" UUID NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "form" TEXT NOT NULL,
    "program_id" UUID,
    "face_value" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,
    "supply_price" INTEGER NOT NULL,
    "policy_version" INTEGER NOT NULL,
    "serial_rule" JSONB NOT NULL,
    "merkle_root" VARCHAR(64),
    "anchor_id" UUID,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "issued_by" UUID NOT NULL,
    "approved_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "voucher_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "checkup_vouchers" (
    "id" UUID NOT NULL,
    "serial" VARCHAR(40) NOT NULL,
    "batch_id" UUID NOT NULL,
    "form" TEXT NOT NULL,
    "program_id" UUID,
    "face_value" INTEGER NOT NULL,
    "balance" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ISSUED',
    "current_owner_type" TEXT NOT NULL DEFAULT 'HOSPITAL',
    "current_owner_id" UUID,
    "activation_hash" VARCHAR(64) NOT NULL,
    "activation_code_enc" TEXT,
    "activation_fail_count" INTEGER NOT NULL DEFAULT 0,
    "activation_locked_until" TIMESTAMPTZ,
    "dealer_confirmed_at" TIMESTAMPTZ,
    "bound_patient_id" UUID,
    "genesis_hash" VARCHAR(64) NOT NULL,
    "head_hash" VARCHAR(64) NOT NULL,
    "expires_at" TIMESTAMPTZ,
    "chain_verified_at" TIMESTAMPTZ,
    "chain_valid" BOOLEAN,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "checkup_vouchers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "voucher_events" (
    "id" UUID NOT NULL,
    "voucher_id" UUID NOT NULL,
    "serial" VARCHAR(40) NOT NULL,
    "type" TEXT NOT NULL,
    "prev_hash" VARCHAR(64) NOT NULL,
    "hash" VARCHAR(64) NOT NULL,
    "actor_type" TEXT NOT NULL,
    "actor_id" UUID,
    "payload" JSONB NOT NULL,
    "anchor_id" UUID,
    "anchor_status" TEXT NOT NULL DEFAULT 'PENDING',
    "anchor_attempts" INTEGER NOT NULL DEFAULT 0,
    "anchored_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "voucher_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "voucher_redemptions" (
    "id" UUID NOT NULL,
    "voucher_id" UUID NOT NULL,
    "visit_id" UUID,
    "billing_id" UUID,
    "amount_used" INTEGER NOT NULL,
    "actual_price" INTEGER NOT NULL,
    "diff_billing_ref" TEXT,
    "idempotency_key" TEXT NOT NULL,
    "reversed_at" TIMESTAMPTZ,
    "reversed_amount" INTEGER NOT NULL DEFAULT 0,
    "reversal_reason" VARCHAR(200),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "voucher_redemptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing_payments" (
    "id" UUID NOT NULL,
    "billing_id" UUID NOT NULL,
    "method" VARCHAR(20) NOT NULL,
    "amount" INTEGER NOT NULL,
    "voucher_serial" VARCHAR(40),
    "voucher_redemption_id" UUID,
    "card_approval_no" VARCHAR(30),
    "card_company" VARCHAR(30),
    "installment" INTEGER,
    "cash_receipt_no" VARCHAR(30),
    "processed_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "billing_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "voucher_distributors" (
    "id" UUID NOT NULL,
    "management_no" VARCHAR(30),
    "name" VARCHAR(200) NOT NULL,
    "parent_id" UUID,
    "tier" TEXT NOT NULL,
    "dealer_type" VARCHAR(12) NOT NULL DEFAULT 'OVERSEAS',
    "country" VARCHAR(2) NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "license_number" VARCHAR(80),
    "contract_ref" VARCHAR(120),
    "tax_id" VARCHAR(40),
    "bank_info" JSONB,
    "license_expiry" DATE,
    "commission_rate" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "approved_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "voucher_distributors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "voucher_distributor_accounts" (
    "id" UUID NOT NULL,
    "distributor_id" UUID NOT NULL,
    "email" VARCHAR(200) NOT NULL,
    "password_hash" TEXT NOT NULL,
    "locale" VARCHAR(5) NOT NULL DEFAULT 'en',
    "mfa_enabled" BOOLEAN NOT NULL DEFAULT true,
    "mfa_secret" TEXT,
    "mfa_enrolled_at" TIMESTAMPTZ,
    "failed_attempts" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMPTZ,
    "last_login_at" TIMESTAMPTZ,
    "setup_code_hash" VARCHAR(120),
    "setup_code_expiry" TIMESTAMPTZ,
    "email_verified_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "voucher_distributor_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "voucher_allocations" (
    "id" UUID NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "from_type" TEXT NOT NULL,
    "from_id" UUID,
    "to_distributor_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "supply_price" INTEGER NOT NULL,
    "payment_ref" VARCHAR(80),
    "paid_at" TIMESTAMPTZ,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "recipient_email" VARCHAR(200),
    "emailed_at" TIMESTAMPTZ,
    "delivery_channel" VARCHAR(20),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "voucher_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "voucher_sales" (
    "id" UUID NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "voucher_id" UUID NOT NULL,
    "distributor_id" UUID NOT NULL,
    "buyer_type" TEXT NOT NULL,
    "buyer_id" UUID,
    "buyer_name" VARCHAR(120),
    "buyer_contact" VARCHAR(120),
    "sale_price" INTEGER NOT NULL,
    "commission_rate" INTEGER NOT NULL,
    "commission_amount" INTEGER NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "payment_ref" VARCHAR(80),
    "sold_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "voucher_sales_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "voucher_settlements" (
    "id" UUID NOT NULL,
    "distributor_id" UUID NOT NULL,
    "period_start" DATE NOT NULL,
    "period_end" DATE NOT NULL,
    "gross_sales" INTEGER NOT NULL,
    "commission_total" INTEGER NOT NULL,
    "refund_clawback" INTEGER NOT NULL DEFAULT 0,
    "net_payable" INTEGER NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "fx_rate" DOUBLE PRECISION,
    "fx_rate_source" VARCHAR(12),
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "billing_ref" VARCHAR(80),
    "created_by" UUID,
    "confirmed_by" UUID,
    "confirmed_at" TIMESTAMPTZ,
    "paid_at" TIMESTAMPTZ,
    "erp_voucher_ref" VARCHAR(120),
    "amount_paid_krw" INTEGER,
    "withholding_krw" INTEGER,
    "paid_callback_event_id" VARCHAR(120),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "voucher_settlements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "voucher_refunds" (
    "id" UUID NOT NULL,
    "voucher_id" UUID NOT NULL,
    "serial" VARCHAR(40) NOT NULL,
    "reason" VARCHAR(200) NOT NULL,
    "refund_amount" INTEGER NOT NULL,
    "clawback_amount" INTEGER NOT NULL DEFAULT 0,
    "sale_id" UUID,
    "distributor_id" UUID,
    "status" TEXT NOT NULL DEFAULT 'DONE',
    "refunded_by" UUID,
    "settled_at" TIMESTAMPTZ,
    "settlement_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "voucher_refunds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "protocol_templates" (
    "id" UUID NOT NULL,
    "code" VARCHAR(40) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "domain" VARCHAR(16) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" VARCHAR(12) NOT NULL DEFAULT 'ACTIVE',
    "description" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "published_at" TIMESTAMPTZ,
    "published_by" UUID,

    CONSTRAINT "protocol_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "protocol_steps" (
    "id" UUID NOT NULL,
    "template_id" UUID NOT NULL,
    "key" VARCHAR(40) NOT NULL,
    "title" VARCHAR(120) NOT NULL,
    "sort_order" INTEGER NOT NULL,
    "phase" VARCHAR(16),
    "owner_roles" TEXT[],
    "action_type" VARCHAR(12) NOT NULL DEFAULT 'CHECK',
    "gate" BOOLEAN NOT NULL DEFAULT false,
    "gate_rule" VARCHAR(40),
    "chart_view" VARCHAR(20),
    "sla_minutes" INTEGER,
    "transitions" JSONB,

    CONSTRAINT "protocol_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "protocol_instances" (
    "id" UUID NOT NULL,
    "template_id" UUID NOT NULL,
    "template_version" INTEGER NOT NULL,
    "patient_id" UUID NOT NULL,
    "surgery_id" UUID,
    "encounter_id" UUID,
    "admission_id" UUID,
    "emergency_visit_id" UUID,
    "current_step_key" VARCHAR(40),
    "status" VARCHAR(12) NOT NULL DEFAULT 'ACTIVE',
    "started_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ,

    CONSTRAINT "protocol_instances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "protocol_step_states" (
    "id" UUID NOT NULL,
    "instance_id" UUID NOT NULL,
    "step_key" VARCHAR(40) NOT NULL,
    "status" VARCHAR(12) NOT NULL DEFAULT 'PENDING',
    "completed_by" UUID,
    "completed_at" TIMESTAMPTZ,
    "blocked_reason" TEXT,

    CONSTRAINT "protocol_step_states_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chemo_regimens" (
    "id" UUID NOT NULL,
    "code" VARCHAR(40) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "cycle_length_days" INTEGER NOT NULL DEFAULT 21,
    "default_cycles" INTEGER NOT NULL DEFAULT 6,
    "diagnosis_hint" VARCHAR(200),
    "emetogenicity" VARCHAR(10),
    "status" VARCHAR(10) NOT NULL DEFAULT 'ACTIVE',
    "notes" VARCHAR(500),
    "created_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "chemo_regimens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chemo_regimen_drugs" (
    "id" UUID NOT NULL,
    "regimen_id" UUID NOT NULL,
    "role" VARCHAR(12) NOT NULL DEFAULT 'CHEMO',
    "drug_name" VARCHAR(200) NOT NULL,
    "medication_code_id" UUID,
    "dose_per_m2" DECIMAL(8,2),
    "fixed_dose" DECIMAL(8,2),
    "cap_mg" DECIMAL(8,2),
    "band_mg" DECIMAL(8,2),
    "day_offsets" JSONB NOT NULL,
    "infusion_note" VARCHAR(200),
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "chemo_regimen_drugs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chemo_courses" (
    "id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "regimen_id" UUID NOT NULL,
    "encounter_id" UUID,
    "registry_id" UUID,
    "status" VARCHAR(12) NOT NULL DEFAULT 'ACTIVE',
    "planned_cycles" INTEGER NOT NULL,
    "height_cm" DECIMAL(5,1) NOT NULL,
    "weight_kg" DECIMAL(5,1) NOT NULL,
    "bsa" DECIMAL(4,2) NOT NULL,
    "dose_reduction_pct" INTEGER NOT NULL DEFAULT 0,
    "start_date" DATE NOT NULL,
    "schedule_id" UUID,
    "stop_reason" VARCHAR(300),
    "created_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "chemo_courses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chemo_cycles" (
    "id" UUID NOT NULL,
    "course_id" UUID NOT NULL,
    "cycle_number" INTEGER NOT NULL,
    "planned_date" DATE NOT NULL,
    "started_at" TIMESTAMPTZ,
    "completed_at" TIMESTAMPTZ,
    "status" VARCHAR(12) NOT NULL DEFAULT 'PLANNED',
    "dose_reduction_pct" INTEGER,
    "delay_days" INTEGER NOT NULL DEFAULT 0,
    "delay_reason" VARCHAR(300),
    "gate_result" JSONB,
    "compounding_order_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "chemo_cycles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance_correction_requests" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "target_record_id" UUID,
    "work_date" DATE NOT NULL,
    "corrected_type" VARCHAR(10) NOT NULL,
    "corrected_at" TIMESTAMPTZ NOT NULL,
    "reason" VARCHAR(300) NOT NULL,
    "status" VARCHAR(12) NOT NULL DEFAULT 'REQUESTED',
    "e_approval_ref" UUID,
    "decided_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attendance_correction_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "overtime_requests" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "work_date" DATE NOT NULL,
    "ot_type" VARCHAR(10) NOT NULL,
    "start_at" TIMESTAMPTZ NOT NULL,
    "end_at" TIMESTAMPTZ NOT NULL,
    "hours" DECIMAL(4,1) NOT NULL,
    "is_post_facto" BOOLEAN NOT NULL DEFAULT false,
    "reason" VARCHAR(300) NOT NULL,
    "status" VARCHAR(12) NOT NULL DEFAULT 'REQUESTED',
    "e_approval_ref" UUID,
    "decided_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "overtime_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_delegations" (
    "id" UUID NOT NULL,
    "delegator_staff_id" UUID NOT NULL,
    "delegate_staff_id" UUID NOT NULL,
    "from_date" DATE NOT NULL,
    "to_date" DATE NOT NULL,
    "reason" VARCHAR(300) NOT NULL,
    "revoked_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "approval_delegations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quality_metric_snapshots" (
    "id" UUID NOT NULL,
    "metric_key" VARCHAR(60) NOT NULL,
    "value" INTEGER NOT NULL,
    "total" INTEGER,
    "captured_on" DATE NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quality_metric_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "voc_tickets" (
    "id" UUID NOT NULL,
    "ticket_no" VARCHAR(20) NOT NULL,
    "type" VARCHAR(12) NOT NULL DEFAULT 'QUESTION',
    "status" VARCHAR(12) NOT NULL DEFAULT 'RECEIVED',
    "severity" VARCHAR(8) NOT NULL DEFAULT 'NORMAL',
    "channel" VARCHAR(10) NOT NULL DEFAULT 'WEB',
    "consult_session_id" UUID,
    "patient_id" UUID,
    "identity_verified" BOOLEAN NOT NULL DEFAULT false,
    "submitter_name" VARCHAR(100),
    "contact_phone" VARCHAR(30),
    "contact_email" VARCHAR(120),
    "replyChannel" VARCHAR(10) NOT NULL DEFAULT 'PORTAL',
    "title" VARCHAR(300) NOT NULL,
    "department" VARCHAR(60),
    "category" VARCHAR(40),
    "assignee_id" UUID,
    "due_at" TIMESTAMPTZ,
    "first_response_at" TIMESTAMPTZ,
    "closed_at" TIMESTAMPTZ,
    "reopen_count" INTEGER NOT NULL DEFAULT 0,
    "rating_score" INTEGER,
    "action_item_id" UUID,
    "consent_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "voc_tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "voc_messages" (
    "id" UUID NOT NULL,
    "ticket_id" UUID NOT NULL,
    "author_type" VARCHAR(10) NOT NULL,
    "author_id" UUID,
    "author_name" VARCHAR(100),
    "body" TEXT NOT NULL,
    "internal" BOOLEAN NOT NULL DEFAULT false,
    "ai_draft" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "voc_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "voc_attachments" (
    "id" UUID NOT NULL,
    "ticket_id" UUID NOT NULL,
    "url" VARCHAR(500) NOT NULL,
    "file_name" VARCHAR(255) NOT NULL,
    "uploaded_by" VARCHAR(10) NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "voc_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "go_live_items" (
    "id" UUID NOT NULL,
    "area" VARCHAR(4) NOT NULL,
    "key" VARCHAR(60) NOT NULL,
    "title" VARCHAR(300) NOT NULL,
    "type" VARCHAR(12) NOT NULL,
    "owner" VARCHAR(60),
    "status" VARCHAR(12) NOT NULL DEFAULT 'NOT_READY',
    "blocker" TEXT,
    "drillDown" VARCHAR(200),
    "sourceKey" VARCHAR(80),
    "targetMode" VARCHAR(8),
    "is_blocking" BOOLEAN NOT NULL DEFAULT true,
    "target_date" DATE,
    "updated_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "go_live_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "go_live_approvals" (
    "id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "action" VARCHAR(12) NOT NULL,
    "actor_id" UUID NOT NULL,
    "actor_name" VARCHAR(100) NOT NULL,
    "reason" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "go_live_approvals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "go_live_snapshots" (
    "id" UUID NOT NULL,
    "captured_on" DATE NOT NULL,
    "readiness_pct" INTEGER NOT NULL,
    "blocking_ready" INTEGER NOT NULL,
    "blocking_total" INTEGER NOT NULL,
    "overdue_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "go_live_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "voice_command_sessions" (
    "id" UUID NOT NULL,
    "encounter_id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "doctor_id" UUID NOT NULL,
    "mode" "VoiceMode" NOT NULL DEFAULT 'READ',
    "status" "VoiceSessionStatus" NOT NULL DEFAULT 'ACTIVE',
    "consent_id" UUID,
    "audio_retention" VARCHAR(16) NOT NULL DEFAULT 'none',
    "started_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closed_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "voice_command_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "voice_command_logs" (
    "id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "utterance_sid" VARCHAR(64),
    "transcript" TEXT,
    "intent" VARCHAR(24),
    "sub" VARCHAR(24),
    "slots" JSONB,
    "nbest" JSONB,
    "phrase_id" UUID,
    "result_kind" VARCHAR(24),
    "result_ref" VARCHAR(64),
    "confirmed_by_user" BOOLEAN NOT NULL DEFAULT false,
    "dropped_s" DOUBLE PRECISION,
    "confidence" DOUBLE PRECISION,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "voice_command_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "voice_user_profiles" (
    "user_id" UUID NOT NULL,
    "default_mode" "VoiceMode" NOT NULL DEFAULT 'READ',
    "ptt_enabled" BOOLEAN NOT NULL DEFAULT true,
    "speaker_gate_enabled" BOOLEAN NOT NULL DEFAULT false,
    "language" VARCHAR(8) NOT NULL DEFAULT 'ko',
    "biometric_consent_at" TIMESTAMPTZ,
    "biometric_consent_ver" VARCHAR(16),
    "voiceprint_status" VARCHAR(16) NOT NULL DEFAULT 'none',
    "voiceprint_sample_count" INTEGER NOT NULL DEFAULT 0,
    "voiceprint_ref" VARCHAR(128),
    "voiceprint_enrolled_at" TIMESTAMPTZ,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "voice_user_profiles_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "voice_custom_phrases" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "type" "VoicePhraseType" NOT NULL,
    "pattern" VARCHAR(200) NOT NULL,
    "action" JSONB NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "hit_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "voice_custom_phrases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_exposure_incidents" (
    "id" UUID NOT NULL,
    "staff_id" UUID NOT NULL,
    "occurred_at" TIMESTAMPTZ NOT NULL,
    "exposure_type" VARCHAR(30) NOT NULL,
    "body_part" VARCHAR(50),
    "device_type" VARCHAR(60),
    "place" VARCHAR(60),
    "source_patient_id" UUID,
    "source_hbv" BOOLEAN,
    "source_hcv" BOOLEAN,
    "source_hiv" BOOLEAN,
    "ppe_used" VARCHAR(100),
    "immediate_action" TEXT,
    "prophylaxis" TEXT,
    "follow_up_status" VARCHAR(20) NOT NULL DEFAULT 'OPEN',
    "follow_up_notes" TEXT,
    "reported_by" UUID NOT NULL,
    "reported_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closed_at" TIMESTAMPTZ,

    CONSTRAINT "staff_exposure_incidents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pharmacist_interventions" (
    "id" UUID NOT NULL,
    "pharmacist_id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "prescription_id" UUID,
    "drug_text" VARCHAR(200),
    "type" VARCHAR(20) NOT NULL,
    "reason" TEXT NOT NULL,
    "suggestion" TEXT NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    "doctor_response" TEXT,
    "responded_by" UUID,
    "responded_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "pharmacist_interventions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tdm_requests" (
    "id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "drug_name" VARCHAR(120) NOT NULL,
    "indication" VARCHAR(200),
    "target_range_min" DECIMAL(8,2),
    "target_range_max" DECIMAL(8,2),
    "target_unit" VARCHAR(20),
    "status" VARCHAR(20) NOT NULL DEFAULT 'REQUESTED',
    "result_level" DECIMAL(8,2),
    "result_interpretation" TEXT,
    "dose_recommendation" TEXT,
    "requested_by" UUID NOT NULL,
    "requested_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sampled_at" TIMESTAMPTZ,
    "resulted_at" TIMESTAMPTZ,
    "reviewed_by" UUID,
    "reviewed_at" TIMESTAMPTZ,

    CONSTRAINT "tdm_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sentinel_runs" (
    "id" UUID NOT NULL,
    "axis" VARCHAR(16) NOT NULL,
    "started_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMPTZ,
    "ok" BOOLEAN NOT NULL DEFAULT false,
    "attempted" INTEGER NOT NULL DEFAULT 0,
    "succeeded" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "duration_ms" INTEGER,

    CONSTRAINT "sentinel_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sentinel_pulses" (
    "id" BIGSERIAL NOT NULL,
    "metric" VARCHAR(60) NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sentinel_pulses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sentinel_runtime_signals" (
    "id" UUID NOT NULL,
    "kind" VARCHAR(24) NOT NULL,
    "producer" VARCHAR(120) NOT NULL,
    "consumer" VARCHAR(120) NOT NULL,
    "detail" TEXT NOT NULL,
    "hit_count" INTEGER NOT NULL DEFAULT 1,
    "first_seen_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "sentinel_runtime_signals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sentinel_probes" (
    "key" VARCHAR(40) NOT NULL,
    "payload" JSONB NOT NULL,
    "captured_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "sentinel_probes_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "sentinel_findings" (
    "id" UUID NOT NULL,
    "axis" VARCHAR(16) NOT NULL,
    "check_key" VARCHAR(80) NOT NULL,
    "severity" VARCHAR(8) NOT NULL,
    "label" TEXT NOT NULL,
    "value" INTEGER NOT NULL,
    "prev_value" INTEGER,
    "first_seen_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ NOT NULL,
    "resolved_at" TIMESTAMPTZ,
    "drill_down" VARCHAR(200),
    "unobservable" BOOLEAN NOT NULL DEFAULT false,
    "detail" TEXT,
    "notify_pending" BOOLEAN NOT NULL DEFAULT false,
    "notified_at" TIMESTAMPTZ,

    CONSTRAINT "sentinel_findings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sentinel_judgments" (
    "id" UUID NOT NULL,
    "axis" VARCHAR(16) NOT NULL,
    "check_key" VARCHAR(80) NOT NULL,
    "verdict" VARCHAR(20) NOT NULL,
    "value_at_judgment" INTEGER NOT NULL,
    "basis" TEXT NOT NULL,
    "source" VARCHAR(10) NOT NULL DEFAULT 'SCREEN',
    "judged_by" UUID,
    "judged_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sentinel_judgments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_proposals" (
    "id" UUID NOT NULL,
    "kind" VARCHAR(40) NOT NULL,
    "target_type" VARCHAR(40) NOT NULL,
    "target_id" UUID NOT NULL,
    "target_key" VARCHAR(120),
    "patient_id" UUID,
    "model_ref" VARCHAR(64),
    "model_release_id" UUID,
    "prompt_version" VARCHAR(64),
    "input_snapshot_hash" VARCHAR(64),
    "content_hash" VARCHAR(64) NOT NULL,
    "content_enc" TEXT,
    "confidence" DECIMAL(4,3),
    "source" "AiProposalSource" NOT NULL,
    "reason_code" VARCHAR(40),
    "status" "AiProposalStatus" NOT NULL DEFAULT 'GENERATED',
    "version" INTEGER NOT NULL DEFAULT 1,
    "supersedes_id" UUID,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "presented_at" TIMESTAMPTZ,
    "decided_at" TIMESTAMPTZ,
    "decided_by" UUID,
    "reject_reason" VARCHAR(200),
    "edit_distance" INTEGER,
    "expires_at" TIMESTAMPTZ,

    CONSTRAINT "ai_proposals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_proposal_transitions" (
    "id" UUID NOT NULL,
    "proposal_id" UUID NOT NULL,
    "from_status" "AiProposalStatus",
    "to_status" "AiProposalStatus" NOT NULL,
    "actor_id" UUID,
    "at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reason" VARCHAR(200),
    "edit_distance" INTEGER,
    "client_context" VARCHAR(80),

    CONSTRAINT "ai_proposal_transitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_model_releases" (
    "id" UUID NOT NULL,
    "provider" VARCHAR(40) NOT NULL,
    "model_tag" VARCHAR(64) NOT NULL,
    "digest" VARCHAR(80),
    "deployed_at" TIMESTAMPTZ NOT NULL,
    "retired_at" TIMESTAMPTZ,
    "approved_by" UUID,
    "approval_ref" VARCHAR(80),
    "notes" TEXT,

    CONSTRAINT "ai_model_releases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_call_logs" (
    "id" UUID NOT NULL,
    "skill" VARCHAR(80) NOT NULL,
    "client" VARCHAR(60) NOT NULL,
    "requested_model" VARCHAR(64),
    "model_ref" VARCHAR(64),
    "latency_ms" INTEGER,
    "http_status" INTEGER,
    "source" "AiProposalSource",
    "reason_code" VARCHAR(40),
    "verify_failed" JSONB,
    "proposal_id" UUID,
    "bytes" INTEGER,
    "mode" VARCHAR(16),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_call_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "translation_overrides" (
    "id" UUID NOT NULL,
    "locale" VARCHAR(16) NOT NULL,
    "key" VARCHAR(500) NOT NULL,
    "area" VARCHAR(40) NOT NULL,
    "draft_value" TEXT NOT NULL,
    "base_value" TEXT,
    "status" "TranslationOverrideStatus" NOT NULL DEFAULT 'PROPOSED',
    "note" TEXT,
    "proposed_by" UUID,
    "proposed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewed_by" UUID,
    "reviewed_at" TIMESTAMPTZ,
    "merged_at" TIMESTAMPTZ,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "translation_overrides_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "translation_override_transitions" (
    "id" UUID NOT NULL,
    "override_id" UUID NOT NULL,
    "from_status" "TranslationOverrideStatus",
    "to_status" "TranslationOverrideStatus" NOT NULL,
    "actor_id" UUID,
    "at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reason" VARCHAR(500),

    CONSTRAINT "translation_override_transitions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_email_idx" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_role_idx" ON "users"("role");

-- CreateIndex
CREATE UNIQUE INDEX "user_dashboard_configs_user_id_key" ON "user_dashboard_configs"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "dashboard_templates_scope_scope_ref_key" ON "dashboard_templates"("scope", "scope_ref");

-- CreateIndex
CREATE INDEX "consult_sessions_patient_id_idx" ON "consult_sessions"("patient_id");

-- CreateIndex
CREATE INDEX "consult_sessions_status_idx" ON "consult_sessions"("status");

-- CreateIndex
CREATE INDEX "consult_sessions_team_id_idx" ON "consult_sessions"("team_id");

-- CreateIndex
CREATE INDEX "consult_messages_session_id_idx" ON "consult_messages"("session_id");

-- CreateIndex
CREATE UNIQUE INDEX "consult_agents_user_id_key" ON "consult_agents"("user_id");

-- CreateIndex
CREATE INDEX "consult_agents_team_id_idx" ON "consult_agents"("team_id");

-- CreateIndex
CREATE UNIQUE INDEX "translations_hash_key" ON "translations"("hash");

-- CreateIndex
CREATE INDEX "translations_target_lang_idx" ON "translations"("target_lang");

-- CreateIndex
CREATE INDEX "non_covered_items_category_idx" ON "non_covered_items"("category");

-- CreateIndex
CREATE UNIQUE INDEX "patients_mrn_key" ON "patients"("mrn");

-- CreateIndex
CREATE UNIQUE INDEX "patients_fhir_id_key" ON "patients"("fhir_id");

-- CreateIndex
CREATE UNIQUE INDEX "patients_ci_key" ON "patients"("ci");

-- CreateIndex
CREATE INDEX "idx_patients_national_id_hash" ON "patients"("national_id_hash");

-- CreateIndex
CREATE INDEX "idx_patients_passport_number_hash" ON "patients"("passport_number_hash");

-- CreateIndex
CREATE INDEX "idx_patients_alien_registration_no_hash" ON "patients"("alien_registration_no_hash");

-- CreateIndex
CREATE INDEX "idx_patients_phone_normalized" ON "patients"("phone_normalized");

-- CreateIndex
CREATE INDEX "patients_mrn_idx" ON "patients"("mrn");

-- CreateIndex
CREATE INDEX "idx_patients_name" ON "patients"("family_name", "given_name");

-- CreateIndex
CREATE INDEX "idx_patients_dob" ON "patients"("date_of_birth");

-- CreateIndex
CREATE INDEX "idx_patients_fhir_id" ON "patients"("fhir_id");

-- CreateIndex
CREATE INDEX "idx_patients_valid_range" ON "patients"("valid_from", "valid_to");

-- CreateIndex
CREATE INDEX "idx_patient_history_patient" ON "patient_history"("patient_id");

-- CreateIndex
CREATE INDEX "idx_patient_history_temporal" ON "patient_history"("valid_from", "valid_to");

-- CreateIndex
CREATE INDEX "patient_contacts_patient_id_idx" ON "patient_contacts"("patient_id");

-- CreateIndex
CREATE INDEX "family_histories_patient_id_idx" ON "family_histories"("patient_id");

-- CreateIndex
CREATE INDEX "patient_relations_patient_id_idx" ON "patient_relations"("patient_id");

-- CreateIndex
CREATE INDEX "patient_relations_related_id_idx" ON "patient_relations"("related_id");

-- CreateIndex
CREATE UNIQUE INDEX "patient_relations_patient_id_related_id_key" ON "patient_relations"("patient_id", "related_id");

-- CreateIndex
CREATE INDEX "idx_appointments_patient" ON "appointments"("patient_id");

-- CreateIndex
CREATE INDEX "idx_appointments_doctor" ON "appointments"("doctor_id");

-- CreateIndex
CREATE INDEX "idx_appointments_scheduled" ON "appointments"("scheduled_at");

-- CreateIndex
CREATE INDEX "idx_appointments_status" ON "appointments"("status");

-- CreateIndex
CREATE INDEX "idx_appointments_doctor_schedule" ON "appointments"("doctor_id", "scheduled_at");

-- CreateIndex
CREATE INDEX "idx_appointments_recurring" ON "appointments"("recurring_group_id");

-- CreateIndex
CREATE INDEX "appointment_waitlists_doctor_id_status_idx" ON "appointment_waitlists"("doctor_id", "status");

-- CreateIndex
CREATE INDEX "appointment_waitlists_department_name_status_idx" ON "appointment_waitlists"("department_name", "status");

-- CreateIndex
CREATE INDEX "appointment_waitlists_patient_id_idx" ON "appointment_waitlists"("patient_id");

-- CreateIndex
CREATE INDEX "idx_audit_logs_user" ON "audit_logs"("user_id");

-- CreateIndex
CREATE INDEX "idx_audit_logs_resource" ON "audit_logs"("resource_type", "resource_id");

-- CreateIndex
CREATE INDEX "idx_audit_logs_timestamp" ON "audit_logs"("timestamp");

-- CreateIndex
CREATE INDEX "diagnosis_codes_code_idx" ON "diagnosis_codes"("code");

-- CreateIndex
CREATE INDEX "diagnosis_codes_code_system_idx" ON "diagnosis_codes"("code_system");

-- CreateIndex
CREATE INDEX "diagnosis_codes_icd10_code_idx" ON "diagnosis_codes"("icd10_code");

-- CreateIndex
CREATE INDEX "diagnosis_codes_icd11_code_idx" ON "diagnosis_codes"("icd11_code");

-- CreateIndex
CREATE UNIQUE INDEX "diagnosis_codes_code_system_code_key" ON "diagnosis_codes"("code_system", "code");

-- CreateIndex
CREATE INDEX "procedure_codes_code_idx" ON "procedure_codes"("code");

-- CreateIndex
CREATE UNIQUE INDEX "procedure_codes_code_valid_from_key" ON "procedure_codes"("code", "valid_from");

-- CreateIndex
CREATE UNIQUE INDEX "medication_codes_code_key" ON "medication_codes"("code");

-- CreateIndex
CREATE INDEX "medication_codes_code_idx" ON "medication_codes"("code");

-- CreateIndex
CREATE INDEX "medication_codes_ingredient_idx" ON "medication_codes"("ingredient");

-- CreateIndex
CREATE UNIQUE INDEX "asp_requests_prescription_id_key" ON "asp_requests"("prescription_id");

-- CreateIndex
CREATE INDEX "asp_requests_patient_id_idx" ON "asp_requests"("patient_id");

-- CreateIndex
CREATE INDEX "asp_requests_status_idx" ON "asp_requests"("status");

-- CreateIndex
CREATE INDEX "code_synonyms_source_table_term_norm_status_idx" ON "code_synonyms"("source_table", "term_norm", "status");

-- CreateIndex
CREATE INDEX "code_synonyms_status_idx" ON "code_synonyms"("status");

-- CreateIndex
CREATE UNIQUE INDEX "code_synonyms_source_table_term_norm_code_key_key" ON "code_synonyms"("source_table", "term_norm", "code_key");

-- CreateIndex
CREATE UNIQUE INDEX "lab_test_codes_code_key" ON "lab_test_codes"("code");

-- CreateIndex
CREATE INDEX "lab_test_codes_category_idx" ON "lab_test_codes"("category");

-- CreateIndex
CREATE UNIQUE INDEX "medication_routes_code_key" ON "medication_routes"("code");

-- CreateIndex
CREATE UNIQUE INDEX "department_codes_code_key" ON "department_codes"("code");

-- CreateIndex
CREATE UNIQUE INDEX "surgery_anesthesia_codes_code_type_code_key" ON "surgery_anesthesia_codes"("code_type", "code");

-- CreateIndex
CREATE INDEX "procedure_fees_code_valid_from_idx" ON "procedure_fees"("code", "valid_from");

-- CreateIndex
CREATE UNIQUE INDEX "procedure_fees_dataset_id_code_key" ON "procedure_fees"("dataset_id", "code");

-- CreateIndex
CREATE INDEX "drug_prices_code_valid_from_idx" ON "drug_prices"("code", "valid_from");

-- CreateIndex
CREATE UNIQUE INDEX "drug_prices_dataset_id_code_key" ON "drug_prices"("dataset_id", "code");

-- CreateIndex
CREATE INDEX "drg_separate_billings_code_idx" ON "drg_separate_billings"("code");

-- CreateIndex
CREATE UNIQUE INDEX "drg_separate_billings_dataset_id_code_key" ON "drg_separate_billings"("dataset_id", "code");

-- CreateIndex
CREATE INDEX "drg_severity_scores_diagnosis_code_idx" ON "drg_severity_scores"("diagnosis_code");

-- CreateIndex
CREATE UNIQUE INDEX "drg_severity_scores_dataset_id_diagnosis_code_key" ON "drg_severity_scores"("dataset_id", "diagnosis_code");

-- CreateIndex
CREATE INDEX "drg_zero_score_rules_other_diagnosis_idx" ON "drg_zero_score_rules"("other_diagnosis");

-- CreateIndex
CREATE UNIQUE INDEX "drg_zero_score_rules_dataset_id_other_diagnosis_key" ON "drg_zero_score_rules"("dataset_id", "other_diagnosis");

-- CreateIndex
CREATE INDEX "reference_datasets_kind_effective_date_idx" ON "reference_datasets"("kind", "effective_date");

-- CreateIndex
CREATE UNIQUE INDEX "drug_barcodes_standard_code_key" ON "drug_barcodes"("standard_code");

-- CreateIndex
CREATE INDEX "drug_barcodes_edi_code_idx" ON "drug_barcodes"("edi_code");

-- CreateIndex
CREATE INDEX "drug_barcodes_representative_code_idx" ON "drug_barcodes"("representative_code");

-- CreateIndex
CREATE INDEX "drug_barcodes_medication_code_id_idx" ON "drug_barcodes"("medication_code_id");

-- CreateIndex
CREATE INDEX "terminology_mappings_source_table_source_id_idx" ON "terminology_mappings"("source_table", "source_id");

-- CreateIndex
CREATE INDEX "terminology_mappings_target_system_target_code_idx" ON "terminology_mappings"("target_system", "target_code");

-- CreateIndex
CREATE UNIQUE INDEX "terminology_mappings_source_table_source_id_target_system_t_key" ON "terminology_mappings"("source_table", "source_id", "target_system", "target_code");

-- CreateIndex
CREATE INDEX "nursing_codes_code_system_idx" ON "nursing_codes"("code_system");

-- CreateIndex
CREATE INDEX "nursing_codes_domain_idx" ON "nursing_codes"("domain");

-- CreateIndex
CREATE UNIQUE INDEX "nursing_codes_code_system_code_key" ON "nursing_codes"("code_system", "code");

-- CreateIndex
CREATE INDEX "pending_mappings_status_idx" ON "pending_mappings"("status");

-- CreateIndex
CREATE INDEX "pending_mappings_clinical_status_idx" ON "pending_mappings"("clinical_status");

-- CreateIndex
CREATE INDEX "pending_mappings_assigned_dept_idx" ON "pending_mappings"("assigned_dept");

-- CreateIndex
CREATE INDEX "pending_mappings_source_table_source_id_idx" ON "pending_mappings"("source_table", "source_id");

-- CreateIndex
CREATE INDEX "pending_mappings_batch_id_idx" ON "pending_mappings"("batch_id");

-- CreateIndex
CREATE INDEX "mapping_audit_logs_mapping_id_idx" ON "mapping_audit_logs"("mapping_id");

-- CreateIndex
CREATE UNIQUE INDEX "encounters_appointment_id_key" ON "encounters"("appointment_id");

-- CreateIndex
CREATE INDEX "encounters_patient_id_idx" ON "encounters"("patient_id");

-- CreateIndex
CREATE INDEX "encounters_doctor_id_idx" ON "encounters"("doctor_id");

-- CreateIndex
CREATE INDEX "encounters_created_at_idx" ON "encounters"("created_at");

-- CreateIndex
CREATE INDEX "idx_encounters_status" ON "encounters"("status");

-- CreateIndex
CREATE INDEX "idx_encounters_patient_status" ON "encounters"("patient_id", "status");

-- CreateIndex
CREATE INDEX "idx_encounters_patient_date" ON "encounters"("patient_id", "created_at");

-- CreateIndex
CREATE INDEX "idx_encounters_doctor_date" ON "encounters"("doctor_id", "created_at");

-- CreateIndex
CREATE INDEX "encounter_attachments_encounter_id_idx" ON "encounter_attachments"("encounter_id");

-- CreateIndex
CREATE INDEX "scribe_sessions_encounter_id_idx" ON "scribe_sessions"("encounter_id");

-- CreateIndex
CREATE INDEX "scribe_sessions_doctor_id_idx" ON "scribe_sessions"("doctor_id");

-- CreateIndex
CREATE INDEX "voice_utterances_session_id_idx" ON "voice_utterances"("session_id");

-- CreateIndex
CREATE UNIQUE INDEX "voice_utterances_session_id_seq_key" ON "voice_utterances"("session_id", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "scribe_voice_profiles_doctor_id_key" ON "scribe_voice_profiles"("doctor_id");

-- CreateIndex
CREATE INDEX "concierge_sessions_patient_id_idx" ON "concierge_sessions"("patient_id");

-- CreateIndex
CREATE INDEX "concierge_sessions_status_idx" ON "concierge_sessions"("status");

-- CreateIndex
CREATE INDEX "concierge_messages_session_id_idx" ON "concierge_messages"("session_id");

-- CreateIndex
CREATE INDEX "consultations_encounter_id_idx" ON "consultations"("encounter_id");

-- CreateIndex
CREATE INDEX "consultations_status_idx" ON "consultations"("status");

-- CreateIndex
CREATE INDEX "consultations_to_doctor_id_status_idx" ON "consultations"("to_doctor_id", "status");

-- CreateIndex
CREATE INDEX "consultations_to_department_status_idx" ON "consultations"("to_department", "status");

-- CreateIndex
CREATE INDEX "referral_letters_patient_id_type_idx" ON "referral_letters"("patient_id", "type");

-- CreateIndex
CREATE INDEX "referral_letters_from_doctor_id_status_idx" ON "referral_letters"("from_doctor_id", "status");

-- CreateIndex
CREATE INDEX "referral_letters_to_department_status_idx" ON "referral_letters"("to_department", "status");

-- CreateIndex
CREATE INDEX "encounter_diagnoses_encounter_id_idx" ON "encounter_diagnoses"("encounter_id");

-- CreateIndex
CREATE INDEX "encounter_diagnoses_diagnosis_code_id_idx" ON "encounter_diagnoses"("diagnosis_code_id");

-- CreateIndex
CREATE INDEX "prescriptions_encounter_id_idx" ON "prescriptions"("encounter_id");

-- CreateIndex
CREATE INDEX "idx_prescriptions_status" ON "prescriptions"("status");

-- CreateIndex
CREATE INDEX "idx_prescriptions_created" ON "prescriptions"("created_at");

-- CreateIndex
CREATE INDEX "idx_prescriptions_type_status" ON "prescriptions"("type", "status");

-- CreateIndex
CREATE INDEX "prescriptions_procedure_code_id_idx" ON "prescriptions"("procedure_code_id");

-- CreateIndex
CREATE INDEX "prescriptions_medication_code_id_idx" ON "prescriptions"("medication_code_id");

-- CreateIndex
CREATE INDEX "orders_department_status_idx" ON "orders"("department", "status");

-- CreateIndex
CREATE INDEX "orders_prescription_id_idx" ON "orders"("prescription_id");

-- CreateIndex
CREATE INDEX "idx_orders_created" ON "orders"("created_at");

-- CreateIndex
CREATE INDEX "idx_orders_status_created" ON "orders"("status", "created_at");

-- CreateIndex
CREATE INDEX "orders_acknowledged_by_acknowledged_at_idx" ON "orders"("acknowledged_by", "acknowledged_at");

-- CreateIndex
CREATE INDEX "orders_accession_number_idx" ON "orders"("accession_number");

-- CreateIndex
CREATE INDEX "order_sign_logs_order_id_occurred_at_idx" ON "order_sign_logs"("order_id", "occurred_at");

-- CreateIndex
CREATE INDEX "order_sign_logs_seal_status_created_at_idx" ON "order_sign_logs"("seal_status", "created_at");

-- CreateIndex
CREATE INDEX "order_sign_logs_occurred_at_idx" ON "order_sign_logs"("occurred_at");

-- CreateIndex
CREATE INDEX "order_sign_logs_actor_id_occurred_at_idx" ON "order_sign_logs"("actor_id", "occurred_at");

-- CreateIndex
CREATE INDEX "order_sign_logs_patient_id_occurred_at_idx" ON "order_sign_logs"("patient_id", "occurred_at");

-- CreateIndex
CREATE UNIQUE INDEX "order_sign_logs_order_id_action_occurred_at_key" ON "order_sign_logs"("order_id", "action", "occurred_at");

-- CreateIndex
CREATE UNIQUE INDEX "billings_encounter_id_key" ON "billings"("encounter_id");

-- CreateIndex
CREATE INDEX "billings_patient_id_idx" ON "billings"("patient_id");

-- CreateIndex
CREATE INDEX "billings_status_idx" ON "billings"("status");

-- CreateIndex
CREATE INDEX "idx_billings_patient_status" ON "billings"("patient_id", "status");

-- CreateIndex
CREATE INDEX "idx_billings_created" ON "billings"("created_at");

-- CreateIndex
CREATE INDEX "idx_billings_status_date" ON "billings"("status", "created_at");

-- CreateIndex
CREATE INDEX "billing_items_billing_id_idx" ON "billing_items"("billing_id");

-- CreateIndex
CREATE INDEX "billing_items_source_prescription_id_idx" ON "billing_items"("source_prescription_id");

-- CreateIndex
CREATE INDEX "deposits_patient_id_idx" ON "deposits"("patient_id");

-- CreateIndex
CREATE UNIQUE INDEX "form_schemas_name_key" ON "form_schemas"("name");

-- CreateIndex
CREATE INDEX "form_schemas_category_idx" ON "form_schemas"("category");

-- CreateIndex
CREATE INDEX "form_submissions_patient_id_idx" ON "form_submissions"("patient_id");

-- CreateIndex
CREATE INDEX "form_submissions_form_schema_id_idx" ON "form_submissions"("form_schema_id");

-- CreateIndex
CREATE UNIQUE INDEX "dispensings_order_id_key" ON "dispensings"("order_id");

-- CreateIndex
CREATE INDEX "dispensings_patient_id_idx" ON "dispensings"("patient_id");

-- CreateIndex
CREATE INDEX "dispensing_items_dispensing_id_idx" ON "dispensing_items"("dispensing_id");

-- CreateIndex
CREATE INDEX "medication_batches_medication_code_id_idx" ON "medication_batches"("medication_code_id");

-- CreateIndex
CREATE INDEX "medication_batches_expiration_date_idx" ON "medication_batches"("expiration_date");

-- CreateIndex
CREATE INDEX "medication_batches_lot_number_idx" ON "medication_batches"("lot_number");

-- CreateIndex
CREATE INDEX "dispensing_counsels_dispensing_id_idx" ON "dispensing_counsels"("dispensing_id");

-- CreateIndex
CREATE INDEX "dispensing_counsels_patient_id_idx" ON "dispensing_counsels"("patient_id");

-- CreateIndex
CREATE INDEX "generic_substitutions_original_prescription_id_idx" ON "generic_substitutions"("original_prescription_id");

-- CreateIndex
CREATE INDEX "adverse_reaction_reports_patient_id_idx" ON "adverse_reaction_reports"("patient_id");

-- CreateIndex
CREATE INDEX "adverse_reaction_reports_suspected_drug_code_idx" ON "adverse_reaction_reports"("suspected_drug_code");

-- CreateIndex
CREATE INDEX "adverse_reaction_reports_status_idx" ON "adverse_reaction_reports"("status");

-- CreateIndex
CREATE INDEX "atc_dispense_jobs_dispensing_id_idx" ON "atc_dispense_jobs"("dispensing_id");

-- CreateIndex
CREATE INDEX "atc_dispense_jobs_device_id_status_idx" ON "atc_dispense_jobs"("device_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "lab_results_order_id_key" ON "lab_results"("order_id");

-- CreateIndex
CREATE INDEX "idx_lab_results_patient_status" ON "lab_results"("patient_id", "status");

-- CreateIndex
CREATE INDEX "idx_lab_results_status_date" ON "lab_results"("status", "created_at");

-- CreateIndex
CREATE INDEX "idx_lab_results_completed" ON "lab_results"("completed_at");

-- CreateIndex
CREATE INDEX "lab_result_amendments_lab_result_id_idx" ON "lab_result_amendments"("lab_result_id");

-- CreateIndex
CREATE INDEX "idx_lab_result_items_result" ON "lab_result_items"("lab_result_id");

-- CreateIndex
CREATE INDEX "idx_lab_result_items_test" ON "lab_result_items"("test_name");

-- CreateIndex
CREATE INDEX "idx_lab_result_items_loinc" ON "lab_result_items"("loinc_code");

-- CreateIndex
CREATE INDEX "chronic_observations_patient_id_code_measured_at_idx" ON "chronic_observations"("patient_id", "code", "measured_at");

-- CreateIndex
CREATE INDEX "chronic_observations_patient_id_code_context_measured_at_idx" ON "chronic_observations"("patient_id", "code", "context", "measured_at");

-- CreateIndex
CREATE UNIQUE INDEX "chronic_observations_source_source_id_key" ON "chronic_observations"("source", "source_id");

-- CreateIndex
CREATE UNIQUE INDEX "lab_instruments_interface_type_serial_number_key" ON "lab_instruments"("interface_type", "serial_number");

-- CreateIndex
CREATE INDEX "lab_interface_results_sample_barcode_idx" ON "lab_interface_results"("sample_barcode");

-- CreateIndex
CREATE INDEX "lab_interface_results_status_idx" ON "lab_interface_results"("status");

-- CreateIndex
CREATE UNIQUE INDEX "reference_labs_code_key" ON "reference_labs"("code");

-- CreateIndex
CREATE INDEX "lab_send_outs_status_idx" ON "lab_send_outs"("status");

-- CreateIndex
CREATE INDEX "lab_send_outs_patient_id_idx" ON "lab_send_outs"("patient_id");

-- CreateIndex
CREATE UNIQUE INDEX "cell_therapy_batches_batch_number_key" ON "cell_therapy_batches"("batch_number");

-- CreateIndex
CREATE INDEX "cell_therapy_batches_patient_id_idx" ON "cell_therapy_batches"("patient_id");

-- CreateIndex
CREATE INDEX "cell_therapy_batches_status_idx" ON "cell_therapy_batches"("status");

-- CreateIndex
CREATE INDEX "genomic_tests_patient_id_idx" ON "genomic_tests"("patient_id");

-- CreateIndex
CREATE INDEX "genomic_tests_status_idx" ON "genomic_tests"("status");

-- CreateIndex
CREATE INDEX "lab_qc_records_instrument_id_idx" ON "lab_qc_records"("instrument_id");

-- CreateIndex
CREATE INDEX "nutrition_assessments_patient_id_idx" ON "nutrition_assessments"("patient_id");

-- CreateIndex
CREATE INDEX "diet_orders_admission_id_is_active_idx" ON "diet_orders"("admission_id", "is_active");

-- CreateIndex
CREATE INDEX "production_batches_date_status_idx" ON "production_batches"("date", "status");

-- CreateIndex
CREATE UNIQUE INDEX "production_batches_date_meal_type_diet_type_key" ON "production_batches"("date", "meal_type", "diet_type");

-- CreateIndex
CREATE INDEX "meal_inspections_production_batch_id_idx" ON "meal_inspections"("production_batch_id");

-- CreateIndex
CREATE INDEX "haccp_checks_production_batch_id_idx" ON "haccp_checks"("production_batch_id");

-- CreateIndex
CREATE INDEX "haccp_checks_date_idx" ON "haccp_checks"("date");

-- CreateIndex
CREATE INDEX "meal_delivery_checks_meal_order_id_idx" ON "meal_delivery_checks"("meal_order_id");

-- CreateIndex
CREATE INDEX "special_nutrition_orders_admission_id_status_idx" ON "special_nutrition_orders"("admission_id", "status");

-- CreateIndex
CREATE INDEX "or_schedules_room_id_date_idx" ON "or_schedules"("room_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "anesthesia_records_surgery_id_key" ON "anesthesia_records"("surgery_id");

-- CreateIndex
CREATE INDEX "pacu_records_surgery_id_idx" ON "pacu_records"("surgery_id");

-- CreateIndex
CREATE INDEX "pacu_records_patient_id_idx" ON "pacu_records"("patient_id");

-- CreateIndex
CREATE INDEX "pacu_records_discharge_time_idx" ON "pacu_records"("discharge_time");

-- CreateIndex
CREATE INDEX "pacu_records_arrival_time_idx" ON "pacu_records"("arrival_time");

-- CreateIndex
CREATE UNIQUE INDEX "surgical_checklists_surgery_id_key" ON "surgical_checklists"("surgery_id");

-- CreateIndex
CREATE UNIQUE INDEX "blood_products_unit_number_key" ON "blood_products"("unit_number");

-- CreateIndex
CREATE INDEX "blood_products_product_type_blood_type_status_idx" ON "blood_products"("product_type", "blood_type", "status");

-- CreateIndex
CREATE INDEX "blood_products_expires_at_idx" ON "blood_products"("expires_at");

-- CreateIndex
CREATE INDEX "transfusion_orders_patient_id_idx" ON "transfusion_orders"("patient_id");

-- CreateIndex
CREATE INDEX "blood_transfusions_patient_id_idx" ON "blood_transfusions"("patient_id");

-- CreateIndex
CREATE INDEX "blood_transfusions_order_id_idx" ON "blood_transfusions"("order_id");

-- CreateIndex
CREATE UNIQUE INDEX "patient_blood_typings_patient_id_key" ON "patient_blood_typings"("patient_id");

-- CreateIndex
CREATE INDEX "patient_antibodies_patient_id_idx" ON "patient_antibodies"("patient_id");

-- CreateIndex
CREATE INDEX "massive_transfusion_protocols_patient_id_status_idx" ON "massive_transfusion_protocols"("patient_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "transfusion_reaction_reports_transfusion_id_key" ON "transfusion_reaction_reports"("transfusion_id");

-- CreateIndex
CREATE INDEX "transfusion_reaction_reports_patient_id_idx" ON "transfusion_reaction_reports"("patient_id");

-- CreateIndex
CREATE INDEX "blood_reorder_requests_status_idx" ON "blood_reorder_requests"("status");

-- CreateIndex
CREATE INDEX "dialysis_sessions_scheduled_date_shift_idx" ON "dialysis_sessions"("scheduled_date", "shift");

-- CreateIndex
CREATE INDEX "hospice_registrations_patient_id_idx" ON "hospice_registrations"("patient_id");

-- CreateIndex
CREATE INDEX "hospice_registrations_status_idx" ON "hospice_registrations"("status");

-- CreateIndex
CREATE INDEX "hospice_symptom_assessments_registration_id_assessed_at_idx" ON "hospice_symptom_assessments"("registration_id", "assessed_at");

-- CreateIndex
CREATE INDEX "advance_directives_patient_id_idx" ON "advance_directives"("patient_id");

-- CreateIndex
CREATE INDEX "hospice_care_conferences_registration_id_idx" ON "hospice_care_conferences"("registration_id");

-- CreateIndex
CREATE INDEX "transplant_waitlists_patient_id_idx" ON "transplant_waitlists"("patient_id");

-- CreateIndex
CREATE INDEX "transplant_waitlists_organ_type_status_idx" ON "transplant_waitlists"("organ_type", "status");

-- CreateIndex
CREATE INDEX "transplant_donors_organ_type_idx" ON "transplant_donors"("organ_type");

-- CreateIndex
CREATE INDEX "transplant_crossmatches_donor_id_recipient_id_tested_at_idx" ON "transplant_crossmatches"("donor_id", "recipient_id", "tested_at");

-- CreateIndex
CREATE UNIQUE INDEX "transplant_records_waitlist_id_key" ON "transplant_records"("waitlist_id");

-- CreateIndex
CREATE INDEX "transplant_records_recipient_id_idx" ON "transplant_records"("recipient_id");

-- CreateIndex
CREATE INDEX "transplant_hla_waitlist_id_idx" ON "transplant_hla"("waitlist_id");

-- CreateIndex
CREATE INDEX "transplant_tdm_transplant_id_idx" ON "transplant_tdm"("transplant_id");

-- CreateIndex
CREATE INDEX "transplant_follow_ups_transplant_id_idx" ON "transplant_follow_ups"("transplant_id");

-- CreateIndex
CREATE INDEX "transplant_rejections_transplant_id_idx" ON "transplant_rejections"("transplant_id");

-- CreateIndex
CREATE INDEX "telehealth_sessions_patient_id_idx" ON "telehealth_sessions"("patient_id");

-- CreateIndex
CREATE INDEX "telehealth_sessions_doctor_id_scheduled_at_idx" ON "telehealth_sessions"("doctor_id", "scheduled_at");

-- CreateIndex
CREATE INDEX "telehealth_sessions_status_idx" ON "telehealth_sessions"("status");

-- CreateIndex
CREATE INDEX "hearing_aids_patient_id_prescribed_at_idx" ON "hearing_aids"("patient_id", "prescribed_at");

-- CreateIndex
CREATE UNIQUE INDEX "imaging_results_order_id_key" ON "imaging_results"("order_id");

-- CreateIndex
CREATE INDEX "idx_imaging_results_patient_status" ON "imaging_results"("patient_id", "status");

-- CreateIndex
CREATE INDEX "idx_imaging_results_status_date" ON "imaging_results"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "radiation_exposures_imaging_result_id_key" ON "radiation_exposures"("imaging_result_id");

-- CreateIndex
CREATE INDEX "radiation_exposures_patient_id_performed_at_idx" ON "radiation_exposures"("patient_id", "performed_at");

-- CreateIndex
CREATE UNIQUE INDEX "claims_claim_number_key" ON "claims"("claim_number");

-- CreateIndex
CREATE INDEX "claims_billing_id_idx" ON "claims"("billing_id");

-- CreateIndex
CREATE INDEX "claims_status_idx" ON "claims"("status");

-- CreateIndex
CREATE INDEX "claims_claim_date_idx" ON "claims"("claim_date");

-- CreateIndex
CREATE INDEX "idx_claims_status_date" ON "claims"("status", "claim_date");

-- CreateIndex
CREATE INDEX "idx_claims_patient_status" ON "claims"("patient_id", "status");

-- CreateIndex
CREATE INDEX "claim_adjustments_claim_id_idx" ON "claim_adjustments"("claim_id");

-- CreateIndex
CREATE INDEX "claim_adjustments_adjust_code_idx" ON "claim_adjustments"("adjust_code");

-- CreateIndex
CREATE INDEX "claim_adjustments_status_idx" ON "claim_adjustments"("status");

-- CreateIndex
CREATE UNIQUE INDEX "wards_name_key" ON "wards"("name");

-- CreateIndex
CREATE INDEX "beds_status_idx" ON "beds"("status");

-- CreateIndex
CREATE UNIQUE INDEX "beds_ward_id_room_number_bed_number_key" ON "beds"("ward_id", "room_number", "bed_number");

-- CreateIndex
CREATE INDEX "admissions_patient_id_idx" ON "admissions"("patient_id");

-- CreateIndex
CREATE INDEX "admissions_status_idx" ON "admissions"("status");

-- CreateIndex
CREATE INDEX "admissions_bed_id_idx" ON "admissions"("bed_id");

-- CreateIndex
CREATE INDEX "admissions_attending_doctor_id_idx" ON "admissions"("attending_doctor_id");

-- CreateIndex
CREATE INDEX "idx_admissions_status_date" ON "admissions"("status", "admit_date");

-- CreateIndex
CREATE INDEX "interim_billings_admission_id_idx" ON "interim_billings"("admission_id");

-- CreateIndex
CREATE INDEX "interim_billings_status_idx" ON "interim_billings"("status");

-- CreateIndex
CREATE INDEX "progress_notes_admission_id_idx" ON "progress_notes"("admission_id");

-- CreateIndex
CREATE INDEX "certificates_patient_id_idx" ON "certificates"("patient_id");

-- CreateIndex
CREATE INDEX "surgeries_patient_id_idx" ON "surgeries"("patient_id");

-- CreateIndex
CREATE INDEX "surgeries_scheduled_at_idx" ON "surgeries"("scheduled_at");

-- CreateIndex
CREATE INDEX "surgeries_status_idx" ON "surgeries"("status");

-- CreateIndex
CREATE UNIQUE INDEX "pre_anesthesia_evaluations_surgery_id_key" ON "pre_anesthesia_evaluations"("surgery_id");

-- CreateIndex
CREATE INDEX "pre_anesthesia_evaluations_patient_id_idx" ON "pre_anesthesia_evaluations"("patient_id");

-- CreateIndex
CREATE INDEX "emergency_visits_patient_id_idx" ON "emergency_visits"("patient_id");

-- CreateIndex
CREATE INDEX "emergency_visits_triage_level_idx" ON "emergency_visits"("triage_level");

-- CreateIndex
CREATE INDEX "emergency_visits_arrival_at_idx" ON "emergency_visits"("arrival_at");

-- CreateIndex
CREATE INDEX "emergency_bed_assignments_visit_id_idx" ON "emergency_bed_assignments"("visit_id");

-- CreateIndex
CREATE INDEX "emergency_bed_assignments_bed_id_released_at_idx" ON "emergency_bed_assignments"("bed_id", "released_at");

-- CreateIndex
CREATE INDEX "emergency_golden_pathways_status_idx" ON "emergency_golden_pathways"("status");

-- CreateIndex
CREATE INDEX "emergency_golden_pathways_patient_id_idx" ON "emergency_golden_pathways"("patient_id");

-- CreateIndex
CREATE INDEX "emergency_prenotifications_status_received_at_idx" ON "emergency_prenotifications"("status", "received_at");

-- CreateIndex
CREATE INDEX "mci_events_status_activated_at_idx" ON "mci_events"("status", "activated_at");

-- CreateIndex
CREATE INDEX "emergency_reassessments_visit_id_idx" ON "emergency_reassessments"("visit_id");

-- CreateIndex
CREATE UNIQUE INDEX "emergency_dispositions_visit_id_key" ON "emergency_dispositions"("visit_id");

-- CreateIndex
CREATE UNIQUE INDEX "emergency_nursing_assessments_visit_id_key" ON "emergency_nursing_assessments"("visit_id");

-- CreateIndex
CREATE INDEX "emergency_nursing_assessments_visit_id_idx" ON "emergency_nursing_assessments"("visit_id");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_items_code_key" ON "inventory_items"("code");

-- CreateIndex
CREATE INDEX "inventory_items_category_idx" ON "inventory_items"("category");

-- CreateIndex
CREATE INDEX "inventory_transactions_item_id_idx" ON "inventory_transactions"("item_id");

-- CreateIndex
CREATE INDEX "inventory_transactions_created_at_idx" ON "inventory_transactions"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_storages_code_key" ON "inventory_storages"("code");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_suppliers_code_key" ON "inventory_suppliers"("code");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_item_suppliers_item_id_supplier_id_key" ON "inventory_item_suppliers"("item_id", "supplier_id");

-- CreateIndex
CREATE INDEX "inventory_lots_item_id_idx" ON "inventory_lots"("item_id");

-- CreateIndex
CREATE INDEX "inventory_lots_expiry_date_idx" ON "inventory_lots"("expiry_date");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_orders_order_number_key" ON "purchase_orders"("order_number");

-- CreateIndex
CREATE INDEX "purchase_orders_status_idx" ON "purchase_orders"("status");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_requests_request_number_key" ON "inventory_requests"("request_number");

-- CreateIndex
CREATE INDEX "inventory_requests_status_idx" ON "inventory_requests"("status");

-- CreateIndex
CREATE UNIQUE INDEX "repack_orders_order_number_key" ON "repack_orders"("order_number");

-- CreateIndex
CREATE INDEX "repack_orders_status_idx" ON "repack_orders"("status");

-- CreateIndex
CREATE INDEX "qr_labels_label_type_idx" ON "qr_labels"("label_type");

-- CreateIndex
CREATE INDEX "qr_labels_reference_id_idx" ON "qr_labels"("reference_id");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_counts_count_number_key" ON "inventory_counts"("count_number");

-- CreateIndex
CREATE INDEX "inventory_counts_status_idx" ON "inventory_counts"("status");

-- CreateIndex
CREATE INDEX "inventory_counts_scheduled_date_idx" ON "inventory_counts"("scheduled_date");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_count_items_count_id_item_id_key" ON "inventory_count_items"("count_id", "item_id");

-- CreateIndex
CREATE INDEX "ai_feedbacks_rating_idx" ON "ai_feedbacks"("rating");

-- CreateIndex
CREATE INDEX "ai_feedbacks_created_at_idx" ON "ai_feedbacks"("created_at");

-- CreateIndex
CREATE INDEX "chart_templates_department_role_idx" ON "chart_templates"("department", "role");

-- CreateIndex
CREATE INDEX "chart_templates_category_idx" ON "chart_templates"("category");

-- CreateIndex
CREATE INDEX "chart_templates_owner_id_idx" ON "chart_templates"("owner_id");

-- CreateIndex
CREATE UNIQUE INDEX "chart_templates_department_name_owner_id_key" ON "chart_templates"("department", "name", "owner_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_chart_preferences_user_id_key" ON "user_chart_preferences"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_ui_preferences_user_id_key" ON "user_ui_preferences"("user_id");

-- CreateIndex
CREATE INDEX "clinical_chart_results_patient_id_chart_id_idx" ON "clinical_chart_results"("patient_id", "chart_id");

-- CreateIndex
CREATE INDEX "clinical_chart_results_patient_id_performed_at_idx" ON "clinical_chart_results"("patient_id", "performed_at");

-- CreateIndex
CREATE INDEX "clinical_chart_results_encounter_id_idx" ON "clinical_chart_results"("encounter_id");

-- CreateIndex
CREATE INDEX "clinical_chart_verifications_chart_id_created_at_idx" ON "clinical_chart_verifications"("chart_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "instrument_sets_name_key" ON "instrument_sets"("name");

-- CreateIndex
CREATE INDEX "instrument_sets_status_idx" ON "instrument_sets"("status");

-- CreateIndex
CREATE INDEX "sterilization_logs_instrument_set_id_idx" ON "sterilization_logs"("instrument_set_id");

-- CreateIndex
CREATE UNIQUE INDEX "instrument_set_templates_name_key" ON "instrument_set_templates"("name");

-- CreateIndex
CREATE UNIQUE INDEX "sterile_packages_lot_no_key" ON "sterile_packages"("lot_no");

-- CreateIndex
CREATE INDEX "sterile_packages_status_idx" ON "sterile_packages"("status");

-- CreateIndex
CREATE INDEX "sterile_packages_load_id_idx" ON "sterile_packages"("load_id");

-- CreateIndex
CREATE INDEX "sterile_packages_expires_at_idx" ON "sterile_packages"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "sterilization_loads_load_no_key" ON "sterilization_loads"("load_no");

-- CreateIndex
CREATE INDEX "sterilization_loads_bi_result_idx" ON "sterilization_loads"("bi_result");

-- CreateIndex
CREATE INDEX "package_events_package_id_idx" ON "package_events"("package_id");

-- CreateIndex
CREATE INDEX "integration_outbox_status_next_attempt_at_idx" ON "integration_outbox"("status", "next_attempt_at");

-- CreateIndex
CREATE INDEX "integration_outbox_domain_idx" ON "integration_outbox"("domain");

-- CreateIndex
CREATE UNIQUE INDEX "integration_outbox_domain_ref_key" ON "integration_outbox"("domain", "ref");

-- CreateIndex
CREATE INDEX "his_webhooks_is_active_idx" ON "his_webhooks"("is_active");

-- CreateIndex
CREATE UNIQUE INDEX "eapproval_relays_approval_id_key" ON "eapproval_relays"("approval_id");

-- CreateIndex
CREATE UNIQUE INDEX "eapproval_relays_idempotency_key_key" ON "eapproval_relays"("idempotency_key");

-- CreateIndex
CREATE INDEX "eapproval_relays_approval_id_idx" ON "eapproval_relays"("approval_id");

-- CreateIndex
CREATE INDEX "eapproval_relays_ref_module_ref_id_idx" ON "eapproval_relays"("ref_module", "ref_id");

-- CreateIndex
CREATE INDEX "pre_auth_requests_patient_id_idx" ON "pre_auth_requests"("patient_id");

-- CreateIndex
CREATE INDEX "pre_auth_requests_status_type_idx" ON "pre_auth_requests"("status", "type");

-- CreateIndex
CREATE INDEX "pre_auth_requests_eapproval_ref_idx" ON "pre_auth_requests"("eapproval_ref");

-- CreateIndex
CREATE UNIQUE INDEX "instrument_items_code_key" ON "instrument_items"("code");

-- CreateIndex
CREATE INDEX "instrument_items_category_idx" ON "instrument_items"("category");

-- CreateIndex
CREATE UNIQUE INDEX "cssd_purchase_orders_po_no_key" ON "cssd_purchase_orders"("po_no");

-- CreateIndex
CREATE INDEX "cssd_purchase_orders_status_idx" ON "cssd_purchase_orders"("status");

-- CreateIndex
CREATE INDEX "cssd_po_lines_po_id_idx" ON "cssd_po_lines"("po_id");

-- CreateIndex
CREATE INDEX "supply_transactions_item_id_idx" ON "supply_transactions"("item_id");

-- CreateIndex
CREATE UNIQUE INDEX "staff_user_id_key" ON "staff"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "staff_employee_number_key" ON "staff"("employee_number");

-- CreateIndex
CREATE UNIQUE INDEX "staff_clinic_user_id_key" ON "staff"("clinic_user_id");

-- CreateIndex
CREATE INDEX "staff_category_idx" ON "staff"("category");

-- CreateIndex
CREATE INDEX "staff_department_idx" ON "staff"("department");

-- CreateIndex
CREATE INDEX "staff_status_idx" ON "staff"("status");

-- CreateIndex
CREATE INDEX "staff_manager_staff_id_idx" ON "staff"("manager_staff_id");

-- CreateIndex
CREATE INDEX "staff_dependents_staff_id_idx" ON "staff_dependents"("staff_id");

-- CreateIndex
CREATE INDEX "staff_documents_staff_id_idx" ON "staff_documents"("staff_id");

-- CreateIndex
CREATE UNIQUE INDEX "staff_payroll_relays_staff_id_key" ON "staff_payroll_relays"("staff_id");

-- CreateIndex
CREATE INDEX "staff_schedules_date_idx" ON "staff_schedules"("date");

-- CreateIndex
CREATE UNIQUE INDEX "staff_schedules_staff_id_date_key" ON "staff_schedules"("staff_id", "date");

-- CreateIndex
CREATE INDEX "meal_orders_admission_id_date_idx" ON "meal_orders"("admission_id", "date");

-- CreateIndex
CREATE INDEX "meal_orders_date_status_idx" ON "meal_orders"("date", "status");

-- CreateIndex
CREATE UNIQUE INDEX "meal_orders_admission_id_date_meal_type_key" ON "meal_orders"("admission_id", "date", "meal_type");

-- CreateIndex
CREATE INDEX "staff_meal_menus_date_idx" ON "staff_meal_menus"("date");

-- CreateIndex
CREATE UNIQUE INDEX "staff_meal_menus_date_meal_type_course_type_key" ON "staff_meal_menus"("date", "meal_type", "course_type");

-- CreateIndex
CREATE INDEX "staff_meal_requests_date_meal_type_idx" ON "staff_meal_requests"("date", "meal_type");

-- CreateIndex
CREATE UNIQUE INDEX "staff_meal_requests_user_id_date_meal_type_key" ON "staff_meal_requests"("user_id", "date", "meal_type");

-- CreateIndex
CREATE INDEX "device_usages_gtin_lot_number_idx" ON "device_usages"("gtin", "lot_number");

-- CreateIndex
CREATE INDEX "device_usages_patient_id_used_at_idx" ON "device_usages"("patient_id", "used_at");

-- CreateIndex
CREATE INDEX "device_usages_serial_number_idx" ON "device_usages"("serial_number");

-- CreateIndex
CREATE UNIQUE INDEX "equipment_asset_number_key" ON "equipment"("asset_number");

-- CreateIndex
CREATE INDEX "equipment_status_idx" ON "equipment"("status");

-- CreateIndex
CREATE INDEX "equipment_category_idx" ON "equipment"("category");

-- CreateIndex
CREATE INDEX "maintenance_logs_equipment_id_idx" ON "maintenance_logs"("equipment_id");

-- CreateIndex
CREATE INDEX "maintenance_logs_type_idx" ON "maintenance_logs"("type");

-- CreateIndex
CREATE INDEX "maintenance_logs_status_idx" ON "maintenance_logs"("status");

-- CreateIndex
CREATE INDEX "equipment_parts_equipment_id_idx" ON "equipment_parts"("equipment_id");

-- CreateIndex
CREATE INDEX "equipment_usage_logs_equipment_id_idx" ON "equipment_usage_logs"("equipment_id");

-- CreateIndex
CREATE INDEX "equipment_usage_logs_used_date_idx" ON "equipment_usage_logs"("used_date");

-- CreateIndex
CREATE INDEX "equipment_inspection_logs_equipment_id_idx" ON "equipment_inspection_logs"("equipment_id");

-- CreateIndex
CREATE INDEX "equipment_inspection_logs_inspection_date_idx" ON "equipment_inspection_logs"("inspection_date");

-- CreateIndex
CREATE UNIQUE INDEX "bots_name_key" ON "bots"("name");

-- CreateIndex
CREATE INDEX "bots_status_idx" ON "bots"("status");

-- CreateIndex
CREATE INDEX "bots_trigger_type_idx" ON "bots"("trigger_type");

-- CreateIndex
CREATE INDEX "bot_executions_bot_id_idx" ON "bot_executions"("bot_id");

-- CreateIndex
CREATE INDEX "bot_executions_created_at_idx" ON "bot_executions"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "dicom_studies_orthanc_study_id_key" ON "dicom_studies"("orthanc_study_id");

-- CreateIndex
CREATE UNIQUE INDEX "dicom_studies_study_instance_uid_key" ON "dicom_studies"("study_instance_uid");

-- CreateIndex
CREATE INDEX "dicom_studies_patient_id_idx" ON "dicom_studies"("patient_id");

-- CreateIndex
CREATE INDEX "dicom_studies_study_date_idx" ON "dicom_studies"("study_date");

-- CreateIndex
CREATE INDEX "dicom_studies_modality_idx" ON "dicom_studies"("modality");

-- CreateIndex
CREATE INDEX "patient_identification_checks_patient_id_idx" ON "patient_identification_checks"("patient_id");

-- CreateIndex
CREATE INDEX "patient_identification_checks_check_type_idx" ON "patient_identification_checks"("check_type");

-- CreateIndex
CREATE INDEX "safety_incidents_type_idx" ON "safety_incidents"("type");

-- CreateIndex
CREATE INDEX "safety_incidents_severity_idx" ON "safety_incidents"("severity");

-- CreateIndex
CREATE UNIQUE INDEX "rca_reports_incident_id_key" ON "rca_reports"("incident_id");

-- CreateIndex
CREATE INDEX "rca_reports_status_due_at_idx" ON "rca_reports"("status", "due_at");

-- CreateIndex
CREATE INDEX "accreditation_items_standard_idx" ON "accreditation_items"("standard");

-- CreateIndex
CREATE INDEX "early_warning_scores_patient_id_recorded_at_idx" ON "early_warning_scores"("patient_id", "recorded_at");

-- CreateIndex
CREATE INDEX "early_warning_scores_risk_level_idx" ON "early_warning_scores"("risk_level");

-- CreateIndex
CREATE INDEX "fall_risk_assessments_patient_id_idx" ON "fall_risk_assessments"("patient_id");

-- CreateIndex
CREATE INDEX "infection_surveillance_patient_id_idx" ON "infection_surveillance"("patient_id");

-- CreateIndex
CREATE INDEX "infection_surveillance_infection_type_idx" ON "infection_surveillance"("infection_type");

-- CreateIndex
CREATE INDEX "hai_cases_hai_type_status_idx" ON "hai_cases"("hai_type", "status");

-- CreateIndex
CREATE INDEX "hai_cases_patient_id_idx" ON "hai_cases"("patient_id");

-- CreateIndex
CREATE INDEX "mdro_registry_mdro_type_active_idx" ON "mdro_registry"("mdro_type", "active");

-- CreateIndex
CREATE INDEX "mdro_registry_patient_id_idx" ON "mdro_registry"("patient_id");

-- CreateIndex
CREATE INDEX "notifiable_disease_reports_status_idx" ON "notifiable_disease_reports"("status");

-- CreateIndex
CREATE INDEX "notifiable_disease_reports_patient_id_idx" ON "notifiable_disease_reports"("patient_id");

-- CreateIndex
CREATE UNIQUE INDEX "quality_indicators_name_key" ON "quality_indicators"("name");

-- CreateIndex
CREATE INDEX "qi_measurements_indicator_id_idx" ON "qi_measurements"("indicator_id");

-- CreateIndex
CREATE UNIQUE INDEX "qi_measurements_indicator_id_period_key" ON "qi_measurements"("indicator_id", "period");

-- CreateIndex
CREATE INDEX "consent_forms_patient_id_idx" ON "consent_forms"("patient_id");

-- CreateIndex
CREATE INDEX "consent_forms_status_created_at_idx" ON "consent_forms"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "consent_sign_sessions_token_key" ON "consent_sign_sessions"("token");

-- CreateIndex
CREATE INDEX "consent_sign_sessions_token_idx" ON "consent_sign_sessions"("token");

-- CreateIndex
CREATE INDEX "consent_sign_sessions_consent_id_status_idx" ON "consent_sign_sessions"("consent_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "consent_signing_devices_device_uid_key" ON "consent_signing_devices"("device_uid");

-- CreateIndex
CREATE INDEX "consent_signing_devices_device_uid_idx" ON "consent_signing_devices"("device_uid");

-- CreateIndex
CREATE INDEX "consent_signing_devices_approval_status_idx" ON "consent_signing_devices"("approval_status");

-- CreateIndex
CREATE INDEX "consent_signing_devices_status_idx" ON "consent_signing_devices"("status");

-- CreateIndex
CREATE UNIQUE INDEX "device_pairing_codes_code_key" ON "device_pairing_codes"("code");

-- CreateIndex
CREATE INDEX "device_pairing_codes_code_idx" ON "device_pairing_codes"("code");

-- CreateIndex
CREATE INDEX "consent_templates_name_language_idx" ON "consent_templates"("name", "language");

-- CreateIndex
CREATE INDEX "consent_templates_type_language_idx" ON "consent_templates"("type", "language");

-- CreateIndex
CREATE INDEX "education_completions_staff_id_idx" ON "education_completions"("staff_id");

-- CreateIndex
CREATE INDEX "education_completions_expires_at_idx" ON "education_completions"("expires_at");

-- CreateIndex
CREATE INDEX "problem_lists_patient_id_status_idx" ON "problem_lists"("patient_id", "status");

-- CreateIndex
CREATE INDEX "problem_lists_patient_id_idx" ON "problem_lists"("patient_id");

-- CreateIndex
CREATE INDEX "allergies_patient_id_is_active_idx" ON "allergies"("patient_id", "is_active");

-- CreateIndex
CREATE INDEX "allergies_allergen_code_idx" ON "allergies"("allergen_code");

-- CreateIndex
CREATE INDEX "allergy_assessments_patient_id_assessed_at_idx" ON "allergy_assessments"("patient_id", "assessed_at");

-- CreateIndex
CREATE UNIQUE INDEX "isolation_protocols_isolation_type_key" ON "isolation_protocols"("isolation_type");

-- CreateIndex
CREATE INDEX "isolation_precautions_patient_id_status_idx" ON "isolation_precautions"("patient_id", "status");

-- CreateIndex
CREATE INDEX "isolation_precautions_status_idx" ON "isolation_precautions"("status");

-- CreateIndex
CREATE INDEX "reference_ranges_test_code_sex_idx" ON "reference_ranges"("test_code", "sex");

-- CreateIndex
CREATE INDEX "reference_ranges_loinc_code_idx" ON "reference_ranges"("loinc_code");

-- CreateIndex
CREATE UNIQUE INDEX "discharge_summaries_admission_id_key" ON "discharge_summaries"("admission_id");

-- CreateIndex
CREATE INDEX "nursing_assessments_admission_id_idx" ON "nursing_assessments"("admission_id");

-- CreateIndex
CREATE INDEX "nursing_diagnoses_assessment_id_idx" ON "nursing_diagnoses"("assessment_id");

-- CreateIndex
CREATE INDEX "nursing_notes_admission_id_recorded_at_idx" ON "nursing_notes"("admission_id", "recorded_at");

-- CreateIndex
CREATE INDEX "nursing_notes_note_type_idx" ON "nursing_notes"("note_type");

-- CreateIndex
CREATE INDEX "nursing_interventions_nursing_diagnosis_id_idx" ON "nursing_interventions"("nursing_diagnosis_id");

-- CreateIndex
CREATE INDEX "nursing_outcomes_nursing_diagnosis_id_idx" ON "nursing_outcomes"("nursing_diagnosis_id");

-- CreateIndex
CREATE INDEX "intake_outputs_admission_id_recorded_at_idx" ON "intake_outputs"("admission_id", "recorded_at");

-- CreateIndex
CREATE INDEX "medication_administrations_patient_id_scheduled_at_idx" ON "medication_administrations"("patient_id", "scheduled_at");

-- CreateIndex
CREATE INDEX "medication_administrations_prescription_id_idx" ON "medication_administrations"("prescription_id");

-- CreateIndex
CREATE INDEX "clinic_schedules_department_name_idx" ON "clinic_schedules"("department_name");

-- CreateIndex
CREATE UNIQUE INDEX "clinic_schedules_doctor_id_day_of_week_period_key" ON "clinic_schedules"("doctor_id", "day_of_week", "period");

-- CreateIndex
CREATE INDEX "clinic_closures_date_idx" ON "clinic_closures"("date");

-- CreateIndex
CREATE UNIQUE INDEX "clinic_closures_doctor_id_date_period_key" ON "clinic_closures"("doctor_id", "date", "period");

-- CreateIndex
CREATE UNIQUE INDEX "waiting_queue_appointment_id_key" ON "waiting_queue"("appointment_id");

-- CreateIndex
CREATE UNIQUE INDEX "waiting_queue_encounter_id_key" ON "waiting_queue"("encounter_id");

-- CreateIndex
CREATE UNIQUE INDEX "waiting_queue_waiting_token_key" ON "waiting_queue"("waiting_token");

-- CreateIndex
CREATE INDEX "waiting_queue_status_idx" ON "waiting_queue"("status");

-- CreateIndex
CREATE INDEX "waiting_queue_doctor_id_status_idx" ON "waiting_queue"("doctor_id", "status");

-- CreateIndex
CREATE INDEX "waiting_queue_department_name_status_idx" ON "waiting_queue"("department_name", "status");

-- CreateIndex
CREATE INDEX "waiting_queue_checked_in_at_idx" ON "waiting_queue"("checked_in_at");

-- CreateIndex
CREATE UNIQUE INDEX "drug_standard_codes_insurance_code_key" ON "drug_standard_codes"("insurance_code");

-- CreateIndex
CREATE INDEX "drug_standard_codes_ingredient_code_idx" ON "drug_standard_codes"("ingredient_code");

-- CreateIndex
CREATE INDEX "drug_standard_codes_atc_code_idx" ON "drug_standard_codes"("atc_code");

-- CreateIndex
CREATE INDEX "drug_standard_codes_product_name_idx" ON "drug_standard_codes"("product_name");

-- CreateIndex
CREATE INDEX "eligibility_checks_patient_id_queried_at_idx" ON "eligibility_checks"("patient_id", "queried_at");

-- CreateIndex
CREATE UNIQUE INDEX "display_api_keys_key_key" ON "display_api_keys"("key");

-- CreateIndex
CREATE UNIQUE INDEX "encounter_templates_name_key" ON "encounter_templates"("name");

-- CreateIndex
CREATE INDEX "encounter_templates_department_idx" ON "encounter_templates"("department");

-- CreateIndex
CREATE INDEX "text_macros_user_id_idx" ON "text_macros"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "text_macros_user_id_shortcut_key" ON "text_macros"("user_id", "shortcut");

-- CreateIndex
CREATE INDEX "medical_record_copies_patient_id_idx" ON "medical_record_copies"("patient_id");

-- CreateIndex
CREATE INDEX "break_the_glass_accesses_user_id_accessed_at_idx" ON "break_the_glass_accesses"("user_id", "accessed_at");

-- CreateIndex
CREATE INDEX "break_the_glass_accesses_patient_id_idx" ON "break_the_glass_accesses"("patient_id");

-- CreateIndex
CREATE UNIQUE INDEX "webauthn_credentials_credential_id_key" ON "webauthn_credentials"("credential_id");

-- CreateIndex
CREATE INDEX "webauthn_credentials_user_id_idx" ON "webauthn_credentials"("user_id");

-- CreateIndex
CREATE INDEX "webauthn_credentials_status_idx" ON "webauthn_credentials"("status");

-- CreateIndex
CREATE UNIQUE INDEX "app_installation_keys_apple_key_id_key" ON "app_installation_keys"("apple_key_id");

-- CreateIndex
CREATE UNIQUE INDEX "app_installation_keys_public_key_fingerprint_key" ON "app_installation_keys"("public_key_fingerprint");

-- CreateIndex
CREATE INDEX "app_installation_keys_app_status_idx" ON "app_installation_keys"("app", "status");

-- CreateIndex
CREATE INDEX "app_installation_keys_staff_user_id_idx" ON "app_installation_keys"("staff_user_id");

-- CreateIndex
CREATE INDEX "app_installation_keys_patient_account_id_idx" ON "app_installation_keys"("patient_account_id");

-- CreateIndex
CREATE INDEX "app_installation_keys_installation_id_idx" ON "app_installation_keys"("installation_id");

-- CreateIndex
CREATE INDEX "identity_verifications_status_expires_at_idx" ON "identity_verifications"("status", "expires_at");

-- CreateIndex
CREATE INDEX "identity_verifications_ci_lookup_hash_idx" ON "identity_verifications"("ci_lookup_hash");

-- CreateIndex
CREATE INDEX "staff_devices_user_id_idx" ON "staff_devices"("user_id");

-- CreateIndex
CREATE INDEX "staff_devices_status_idx" ON "staff_devices"("status");

-- CreateIndex
CREATE UNIQUE INDEX "terminal_registry_device_uuid_key" ON "terminal_registry"("device_uuid");

-- CreateIndex
CREATE INDEX "terminal_registry_device_uuid_idx" ON "terminal_registry"("device_uuid");

-- CreateIndex
CREATE INDEX "terminal_registry_ip_address_idx" ON "terminal_registry"("ip_address");

-- CreateIndex
CREATE UNIQUE INDEX "staff_consent_user_id_key" ON "staff_consent"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "retention_policy_resource_type_key" ON "retention_policy"("resource_type");

-- CreateIndex
CREATE INDEX "staff_calls_sender_id_idx" ON "staff_calls"("sender_id");

-- CreateIndex
CREATE INDEX "staff_calls_target_kind_target_ref_idx" ON "staff_calls"("target_kind", "target_ref");

-- CreateIndex
CREATE INDEX "staff_calls_status_idx" ON "staff_calls"("status");

-- CreateIndex
CREATE INDEX "code_blue_events_patient_id_idx" ON "code_blue_events"("patient_id");

-- CreateIndex
CREATE INDEX "code_blue_events_recognized_at_idx" ON "code_blue_events"("recognized_at");

-- CreateIndex
CREATE INDEX "rrt_activations_patient_id_idx" ON "rrt_activations"("patient_id");

-- CreateIndex
CREATE INDEX "rrt_activations_activated_at_idx" ON "rrt_activations"("activated_at");

-- CreateIndex
CREATE UNIQUE INDEX "staff_call_acks_call_id_user_id_key" ON "staff_call_acks"("call_id", "user_id");

-- CreateIndex
CREATE INDEX "auth_emergency_access_user_id_idx" ON "auth_emergency_access"("user_id");

-- CreateIndex
CREATE INDEX "auth_emergency_access_granted_at_idx" ON "auth_emergency_access"("granted_at");

-- CreateIndex
CREATE INDEX "account_recoveries_user_id_idx" ON "account_recoveries"("user_id");

-- CreateIndex
CREATE INDEX "account_recoveries_status_idx" ON "account_recoveries"("status");

-- CreateIndex
CREATE INDEX "admin_permission_grants_user_id_idx" ON "admin_permission_grants"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "admin_permission_grants_user_id_permission_key" ON "admin_permission_grants"("user_id", "permission");

-- CreateIndex
CREATE INDEX "admin_approvals_status_idx" ON "admin_approvals"("status");

-- CreateIndex
CREATE INDEX "admin_approvals_target_type_target_id_idx" ON "admin_approvals"("target_type", "target_id");

-- CreateIndex
CREATE UNIQUE INDEX "auth_policies_scope_scope_ref_key" ON "auth_policies"("scope", "scope_ref");

-- CreateIndex
CREATE UNIQUE INDEX "vip_patients_patient_id_key" ON "vip_patients"("patient_id");

-- CreateIndex
CREATE UNIQUE INDEX "questionnaire_tokens_token_key" ON "questionnaire_tokens"("token");

-- CreateIndex
CREATE UNIQUE INDEX "questionnaire_tokens_submission_id_key" ON "questionnaire_tokens"("submission_id");

-- CreateIndex
CREATE INDEX "questionnaire_tokens_token_idx" ON "questionnaire_tokens"("token");

-- CreateIndex
CREATE INDEX "questionnaire_tokens_status_idx" ON "questionnaire_tokens"("status");

-- CreateIndex
CREATE INDEX "questionnaire_tokens_patient_id_status_idx" ON "questionnaire_tokens"("patient_id", "status");

-- CreateIndex
CREATE INDEX "clinic_sync_logs_executed_at_idx" ON "clinic_sync_logs"("executed_at");

-- CreateIndex
CREATE UNIQUE INDEX "order_sets_name_key" ON "order_sets"("name");

-- CreateIndex
CREATE INDEX "order_sets_category_idx" ON "order_sets"("category");

-- CreateIndex
CREATE INDEX "order_sets_department_idx" ON "order_sets"("department");

-- CreateIndex
CREATE INDEX "order_sets_diagnosis_code_idx" ON "order_sets"("diagnosis_code");

-- CreateIndex
CREATE INDEX "order_sets_code_idx" ON "order_sets"("code");

-- CreateIndex
CREATE INDEX "order_sets_status_idx" ON "order_sets"("status");

-- CreateIndex
CREATE INDEX "treatment_schedule_templates_status_idx" ON "treatment_schedule_templates"("status");

-- CreateIndex
CREATE INDEX "treatment_schedule_templates_department_idx" ON "treatment_schedule_templates"("department");

-- CreateIndex
CREATE INDEX "treatment_template_items_template_id_day_offset_idx" ON "treatment_template_items"("template_id", "day_offset");

-- CreateIndex
CREATE INDEX "patient_treatment_schedules_patient_id_status_idx" ON "patient_treatment_schedules"("patient_id", "status");

-- CreateIndex
CREATE INDEX "patient_schedule_items_schedule_id_planned_at_idx" ON "patient_schedule_items"("schedule_id", "planned_at");

-- CreateIndex
CREATE INDEX "treatment_template_diagnoses_diagnosis_code_idx" ON "treatment_template_diagnoses"("diagnosis_code");

-- CreateIndex
CREATE UNIQUE INDEX "treatment_template_diagnoses_template_id_diagnosis_code_key" ON "treatment_template_diagnoses"("template_id", "diagnosis_code");

-- CreateIndex
CREATE INDEX "order_set_diagnoses_diagnosis_code_idx" ON "order_set_diagnoses"("diagnosis_code");

-- CreateIndex
CREATE UNIQUE INDEX "order_set_diagnoses_order_set_id_diagnosis_code_key" ON "order_set_diagnoses"("order_set_id", "diagnosis_code");

-- CreateIndex
CREATE INDEX "order_set_usages_order_set_id_idx" ON "order_set_usages"("order_set_id");

-- CreateIndex
CREATE INDEX "favorite_orders_user_id_use_count_idx" ON "favorite_orders"("user_id", "use_count");

-- CreateIndex
CREATE UNIQUE INDEX "icu_beds_unit_name_bed_number_key" ON "icu_beds"("unit_name", "bed_number");

-- CreateIndex
CREATE INDEX "icu_admissions_status_idx" ON "icu_admissions"("status");

-- CreateIndex
CREATE INDEX "icu_records_admission_id_idx" ON "icu_records"("admission_id");

-- CreateIndex
CREATE INDEX "icu_records_record_time_idx" ON "icu_records"("record_time");

-- CreateIndex
CREATE INDEX "diagnostic_tests_patient_id_idx" ON "diagnostic_tests"("patient_id");

-- CreateIndex
CREATE INDEX "diagnostic_tests_test_type_idx" ON "diagnostic_tests"("test_type");

-- CreateIndex
CREATE INDEX "diagnostic_tests_status_idx" ON "diagnostic_tests"("status");

-- CreateIndex
CREATE INDEX "diagnostic_tests_review_status_idx" ON "diagnostic_tests"("review_status");

-- CreateIndex
CREATE UNIQUE INDEX "integration_gates_track_key_key" ON "integration_gates"("track", "key");

-- CreateIndex
CREATE INDEX "integration_gate_events_track_created_at_idx" ON "integration_gate_events"("track", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "system_configs_key_key" ON "system_configs"("key");

-- CreateIndex
CREATE INDEX "system_configs_category_idx" ON "system_configs"("category");

-- CreateIndex
CREATE INDEX "hospital_info_contents_category_is_active_idx" ON "hospital_info_contents"("category", "is_active");

-- CreateIndex
CREATE INDEX "hospital_info_contents_publish_from_publish_until_idx" ON "hospital_info_contents"("publish_from", "publish_until");

-- CreateIndex
CREATE UNIQUE INDEX "hospital_info_contents_category_slug_key" ON "hospital_info_contents"("category", "slug");

-- CreateIndex
CREATE INDEX "hospital_info_audits_content_id_changed_at_idx" ON "hospital_info_audits"("content_id", "changed_at");

-- CreateIndex
CREATE INDEX "hospital_info_audits_changed_by_idx" ON "hospital_info_audits"("changed_by");

-- CreateIndex
CREATE INDEX "homepage_popups_is_active_start_date_end_date_idx" ON "homepage_popups"("is_active", "start_date", "end_date");

-- CreateIndex
CREATE UNIQUE INDEX "cms_categories_code_key" ON "cms_categories"("code");

-- CreateIndex
CREATE INDEX "cms_categories_parent_id_idx" ON "cms_categories"("parent_id");

-- CreateIndex
CREATE INDEX "cms_categories_sort_order_idx" ON "cms_categories"("sort_order");

-- CreateIndex
CREATE INDEX "cms_menus_menu_group_sort_order_idx" ON "cms_menus"("menu_group", "sort_order");

-- CreateIndex
CREATE INDEX "cms_menus_parent_id_idx" ON "cms_menus"("parent_id");

-- CreateIndex
CREATE INDEX "media_files_folder_idx" ON "media_files"("folder");

-- CreateIndex
CREATE INDEX "media_files_mime_type_idx" ON "media_files"("mime_type");

-- CreateIndex
CREATE UNIQUE INDEX "doctor_profiles_user_id_key" ON "doctor_profiles"("user_id");

-- CreateIndex
CREATE INDEX "holiday_calendars_year_idx" ON "holiday_calendars"("year");

-- CreateIndex
CREATE INDEX "holiday_calendars_date_idx" ON "holiday_calendars"("date");

-- CreateIndex
CREATE UNIQUE INDEX "holiday_calendars_date_name_key" ON "holiday_calendars"("date", "name");

-- CreateIndex
CREATE UNIQUE INDEX "patient_accounts_patient_id_key" ON "patient_accounts"("patient_id");

-- CreateIndex
CREATE UNIQUE INDEX "patient_accounts_phone_key" ON "patient_accounts"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "patient_accounts_ci_key" ON "patient_accounts"("ci");

-- CreateIndex
CREATE UNIQUE INDEX "patient_ai_consents_patient_id_key" ON "patient_ai_consents"("patient_id");

-- CreateIndex
CREATE INDEX "patient_consents_account_id_type_idx" ON "patient_consents"("account_id", "type");

-- CreateIndex
CREATE UNIQUE INDEX "patient_devices_account_id_device_id_key" ON "patient_devices"("account_id", "device_id");

-- CreateIndex
CREATE INDEX "patient_families_patient_id_idx" ON "patient_families"("patient_id");

-- CreateIndex
CREATE INDEX "patient_guardians_dependent_account_id_idx" ON "patient_guardians"("dependent_account_id");

-- CreateIndex
CREATE UNIQUE INDEX "patient_guardians_guardian_account_id_dependent_account_id_key" ON "patient_guardians"("guardian_account_id", "dependent_account_id");

-- CreateIndex
CREATE INDEX "patient_notifications_account_id_is_read_idx" ON "patient_notifications"("account_id", "is_read");

-- CreateIndex
CREATE INDEX "patient_notifications_created_at_idx" ON "patient_notifications"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "notification_settings_account_id_type_key" ON "notification_settings"("account_id", "type");

-- CreateIndex
CREATE INDEX "patient_addresses_patient_id_idx" ON "patient_addresses"("patient_id");

-- CreateIndex
CREATE INDEX "sms_verifications_phone_purpose_idx" ON "sms_verifications"("phone", "purpose");

-- CreateIndex
CREATE INDEX "medication_check_logs_patient_id_slot_date_idx" ON "medication_check_logs"("patient_id", "slot_date");

-- CreateIndex
CREATE UNIQUE INDEX "medication_check_logs_prescription_id_slot_date_slot_key" ON "medication_check_logs"("prescription_id", "slot_date", "slot");

-- CreateIndex
CREATE INDEX "document_requests_patient_id_idx" ON "document_requests"("patient_id");

-- CreateIndex
CREATE INDEX "document_requests_status_idx" ON "document_requests"("status");

-- CreateIndex
CREATE INDEX "document_requests_bundle_id_idx" ON "document_requests"("bundle_id");

-- CreateIndex
CREATE INDEX "issuance_artifacts_request_id_idx" ON "issuance_artifacts"("request_id");

-- CreateIndex
CREATE UNIQUE INDEX "portal_sessions_token_key" ON "portal_sessions"("token");

-- CreateIndex
CREATE INDEX "portal_sessions_patient_id_idx" ON "portal_sessions"("patient_id");

-- CreateIndex
CREATE INDEX "portal_sessions_token_idx" ON "portal_sessions"("token");

-- CreateIndex
CREATE INDEX "portal_sessions_expires_at_idx" ON "portal_sessions"("expires_at");

-- CreateIndex
CREATE INDEX "portal_audit_logs_patient_id_idx" ON "portal_audit_logs"("patient_id");

-- CreateIndex
CREATE INDEX "portal_audit_logs_created_at_idx" ON "portal_audit_logs"("created_at");

-- CreateIndex
CREATE INDEX "department_form_mappings_department_name_idx" ON "department_form_mappings"("department_name");

-- CreateIndex
CREATE UNIQUE INDEX "department_form_mappings_department_name_form_schema_id_vis_key" ON "department_form_mappings"("department_name", "form_schema_id", "visit_type");

-- CreateIndex
CREATE INDEX "agent_sessions_channel_created_at_idx" ON "agent_sessions"("channel", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "online_bookings_booking_number_key" ON "online_bookings"("booking_number");

-- CreateIndex
CREATE UNIQUE INDEX "online_bookings_appointment_id_key" ON "online_bookings"("appointment_id");

-- CreateIndex
CREATE INDEX "online_bookings_patient_phone_idx" ON "online_bookings"("patient_phone");

-- CreateIndex
CREATE INDEX "online_bookings_booking_number_idx" ON "online_bookings"("booking_number");

-- CreateIndex
CREATE UNIQUE INDEX "pre_orders_external_ref_key" ON "pre_orders"("external_ref");

-- CreateIndex
CREATE INDEX "pre_orders_patient_id_status_idx" ON "pre_orders"("patient_id", "status");

-- CreateIndex
CREATE INDEX "pre_orders_doctor_id_status_idx" ON "pre_orders"("doctor_id", "status");

-- CreateIndex
CREATE INDEX "pre_orders_scheduled_date_idx" ON "pre_orders"("scheduled_date");

-- CreateIndex
CREATE INDEX "pre_orders_appointment_id_idx" ON "pre_orders"("appointment_id");

-- CreateIndex
CREATE INDEX "pre_order_revisions_pre_order_id_idx" ON "pre_order_revisions"("pre_order_id");

-- CreateIndex
CREATE INDEX "doctor_code_lists_doctor_id_category_idx" ON "doctor_code_lists"("doctor_id", "category");

-- CreateIndex
CREATE UNIQUE INDEX "doctor_code_lists_doctor_id_code_type_code_id_key" ON "doctor_code_lists"("doctor_id", "code_type", "code_id");

-- CreateIndex
CREATE INDEX "doctor_prescription_sets_doctor_id_idx" ON "doctor_prescription_sets"("doctor_id");

-- CreateIndex
CREATE INDEX "formulary_items_domain_status_idx" ON "formulary_items"("domain", "status");

-- CreateIndex
CREATE INDEX "formulary_items_code_id_idx" ON "formulary_items"("code_id");

-- CreateIndex
CREATE UNIQUE INDEX "formulary_items_domain_code_type_code_id_preset_key_key" ON "formulary_items"("domain", "code_type", "code_id", "preset_key");

-- CreateIndex
CREATE INDEX "formulary_lists_domain_idx" ON "formulary_lists"("domain");

-- CreateIndex
CREATE INDEX "formulary_requests_status_domain_idx" ON "formulary_requests"("status", "domain");

-- CreateIndex
CREATE INDEX "formulary_requests_requested_by_idx" ON "formulary_requests"("requested_by");

-- CreateIndex
CREATE INDEX "department_code_catalogs_department_name_subcategory_idx" ON "department_code_catalogs"("department_name", "subcategory");

-- CreateIndex
CREATE UNIQUE INDEX "department_code_catalogs_department_name_code_type_code_id_key" ON "department_code_catalogs"("department_name", "code_type", "code_id");

-- CreateIndex
CREATE UNIQUE INDEX "triage_symptoms_name_key" ON "triage_symptoms"("name");

-- CreateIndex
CREATE INDEX "triage_symptoms_category_idx" ON "triage_symptoms"("category");

-- CreateIndex
CREATE INDEX "triage_rules_department_name_idx" ON "triage_rules"("department_name");

-- CreateIndex
CREATE UNIQUE INDEX "triage_rules_symptom_id_department_name_key" ON "triage_rules"("symptom_id", "department_name");

-- CreateIndex
CREATE UNIQUE INDEX "triage_aliases_alias_key" ON "triage_aliases"("alias");

-- CreateIndex
CREATE INDEX "triage_aliases_alias_idx" ON "triage_aliases"("alias");

-- CreateIndex
CREATE INDEX "charge_of_care_admission_id_released_at_idx" ON "charge_of_care"("admission_id", "released_at");

-- CreateIndex
CREATE INDEX "charge_of_care_doctor_id_idx" ON "charge_of_care"("doctor_id");

-- CreateIndex
CREATE INDEX "journey_delay_acks_patient_id_expires_at_idx" ON "journey_delay_acks"("patient_id", "expires_at");

-- CreateIndex
CREATE INDEX "journey_delay_acks_expires_at_idx" ON "journey_delay_acks"("expires_at");

-- CreateIndex
CREATE INDEX "clinical_handoffs_patient_id_idx" ON "clinical_handoffs"("patient_id");

-- CreateIndex
CREATE INDEX "clinical_handoffs_admission_id_idx" ON "clinical_handoffs"("admission_id");

-- CreateIndex
CREATE INDEX "bed_assignments_admission_id_idx" ON "bed_assignments"("admission_id");

-- CreateIndex
CREATE INDEX "bed_assignments_bed_id_released_at_idx" ON "bed_assignments"("bed_id", "released_at");

-- CreateIndex
CREATE INDEX "rounds_admission_id_rounded_at_idx" ON "rounds"("admission_id", "rounded_at");

-- CreateIndex
CREATE INDEX "patient_journey_events_patient_id_event_at_idx" ON "patient_journey_events"("patient_id", "event_at");

-- CreateIndex
CREATE INDEX "patient_journey_events_event_type_idx" ON "patient_journey_events"("event_type");

-- CreateIndex
CREATE INDEX "patient_journey_events_ref_type_ref_id_idx" ON "patient_journey_events"("ref_type", "ref_id");

-- CreateIndex
CREATE UNIQUE INDEX "space_nodes_code_key" ON "space_nodes"("code");

-- CreateIndex
CREATE INDEX "space_nodes_parent_id_idx" ON "space_nodes"("parent_id");

-- CreateIndex
CREATE INDEX "space_nodes_floor_idx" ON "space_nodes"("floor");

-- CreateIndex
CREATE INDEX "space_nodes_space_type_idx" ON "space_nodes"("space_type");

-- CreateIndex
CREATE INDEX "idx_patient_locations_patient_time" ON "patient_locations"("patient_id", "entered_at");

-- CreateIndex
CREATE INDEX "patient_locations_patient_id_left_at_idx" ON "patient_locations"("patient_id", "left_at");

-- CreateIndex
CREATE INDEX "patient_locations_zone_id_idx" ON "patient_locations"("zone_id");

-- CreateIndex
CREATE INDEX "patient_locations_entered_at_idx" ON "patient_locations"("entered_at");

-- CreateIndex
CREATE INDEX "location_stations_key_hash_idx" ON "location_stations"("key_hash");

-- CreateIndex
CREATE INDEX "location_stations_zone_id_idx" ON "location_stations"("zone_id");

-- CreateIndex
CREATE INDEX "patient_loc_tokens_patient_id_idx" ON "patient_loc_tokens"("patient_id");

-- CreateIndex
CREATE INDEX "cdss_rules_category_idx" ON "cdss_rules"("category");

-- CreateIndex
CREATE INDEX "cdss_rules_drug_a_idx" ON "cdss_rules"("drug_a");

-- CreateIndex
CREATE INDEX "dur_rules_rule_type_is_active_idx" ON "dur_rules"("rule_type", "is_active");

-- CreateIndex
CREATE INDEX "cdss_logs_encounter_id_idx" ON "cdss_logs"("encounter_id");

-- CreateIndex
CREATE INDEX "cdss_logs_patient_id_idx" ON "cdss_logs"("patient_id");

-- CreateIndex
CREATE INDEX "cdss_logs_overall_level_idx" ON "cdss_logs"("overall_level");

-- CreateIndex
CREATE INDEX "gate_violation_logs_gate_key_created_at_idx" ON "gate_violation_logs"("gate_key", "created_at");

-- CreateIndex
CREATE INDEX "patient_messages_patient_id_created_at_idx" ON "patient_messages"("patient_id", "created_at");

-- CreateIndex
CREATE INDEX "patient_messages_doctor_id_is_read_idx" ON "patient_messages"("doctor_id", "is_read");

-- CreateIndex
CREATE INDEX "health_memos_patient_id_created_at_idx" ON "health_memos"("patient_id", "created_at");

-- CreateIndex
CREATE INDEX "satisfaction_surveys_patient_id_idx" ON "satisfaction_surveys"("patient_id");

-- CreateIndex
CREATE UNIQUE INDEX "survey_dispatches_token_key" ON "survey_dispatches"("token");

-- CreateIndex
CREATE INDEX "survey_dispatches_status_idx" ON "survey_dispatches"("status");

-- CreateIndex
CREATE INDEX "survey_dispatches_patient_id_idx" ON "survey_dispatches"("patient_id");

-- CreateIndex
CREATE INDEX "survey_dispatches_device_id_idx" ON "survey_dispatches"("device_id");

-- CreateIndex
CREATE INDEX "vaccinations_patient_id_idx" ON "vaccinations"("patient_id");

-- CreateIndex
CREATE INDEX "vaccinations_patient_id_administered_at_idx" ON "vaccinations"("patient_id", "administered_at");

-- CreateIndex
CREATE INDEX "dental_recalls_patient_id_status_idx" ON "dental_recalls"("patient_id", "status");

-- CreateIndex
CREATE INDEX "chart_template_versions_template_id_created_at_idx" ON "chart_template_versions"("template_id", "created_at");

-- CreateIndex
CREATE INDEX "ortho_exams_patient_id_examined_at_idx" ON "ortho_exams"("patient_id", "examined_at");

-- CreateIndex
CREATE INDEX "obgyn_exams_patient_id_examined_at_idx" ON "obgyn_exams"("patient_id", "examined_at");

-- CreateIndex
CREATE INDEX "delivery_records_status_idx" ON "delivery_records"("status");

-- CreateIndex
CREATE INDEX "delivery_records_patient_id_idx" ON "delivery_records"("patient_id");

-- CreateIndex
CREATE UNIQUE INDEX "newborn_records_id_band_no_key" ON "newborn_records"("id_band_no");

-- CreateIndex
CREATE INDEX "newborn_records_delivery_id_idx" ON "newborn_records"("delivery_id");

-- CreateIndex
CREATE UNIQUE INDEX "newborn_records_delivery_id_birth_order_key" ON "newborn_records"("delivery_id", "birth_order");

-- CreateIndex
CREATE INDEX "labor_progress_records_delivery_id_recorded_at_idx" ON "labor_progress_records"("delivery_id", "recorded_at");

-- CreateIndex
CREATE INDEX "pediatric_growths_patient_id_measured_at_idx" ON "pediatric_growths"("patient_id", "measured_at");

-- CreateIndex
CREATE INDEX "pediatric_immunizations_patient_id_given_at_idx" ON "pediatric_immunizations"("patient_id", "given_at");

-- CreateIndex
CREATE UNIQUE INDEX "uq_pedi_immun_patient_vaccine_dose" ON "pediatric_immunizations"("patient_id", "vaccine_name", "dose_number");

-- CreateIndex
CREATE INDEX "developmental_assessments_patient_id_assessed_at_idx" ON "developmental_assessments"("patient_id", "assessed_at");

-- CreateIndex
CREATE INDEX "psychiatric_admissions_patient_id_status_idx" ON "psychiatric_admissions"("patient_id", "status");

-- CreateIndex
CREATE INDEX "psychiatric_admissions_status_legal_expiry_at_idx" ON "psychiatric_admissions"("status", "legal_expiry_at");

-- CreateIndex
CREATE INDEX "psych_seclusion_orders_patient_id_status_idx" ON "psych_seclusion_orders"("patient_id", "status");

-- CreateIndex
CREATE INDEX "psych_seclusion_orders_status_legal_max_until_idx" ON "psych_seclusion_orders"("status", "legal_max_until");

-- CreateIndex
CREATE INDEX "psych_seclusion_monitorings_order_id_idx" ON "psych_seclusion_monitorings"("order_id");

-- CreateIndex
CREATE INDEX "psych_seclusion_extensions_order_id_idx" ON "psych_seclusion_extensions"("order_id");

-- CreateIndex
CREATE INDEX "ect_sessions_patient_id_status_idx" ON "ect_sessions"("patient_id", "status");

-- CreateIndex
CREATE INDEX "psych_exams_patient_id_examined_at_idx" ON "psych_exams"("patient_id", "examined_at");

-- CreateIndex
CREATE INDEX "neuro_exams_patient_id_examined_at_idx" ON "neuro_exams"("patient_id", "examined_at");

-- CreateIndex
CREATE INDEX "urology_exams_patient_id_examined_at_idx" ON "urology_exams"("patient_id", "examined_at");

-- CreateIndex
CREATE INDEX "urology_procedures_patient_id_performed_at_idx" ON "urology_procedures"("patient_id", "performed_at");

-- CreateIndex
CREATE INDEX "plastic_exams_patient_id_examined_at_idx" ON "plastic_exams"("patient_id", "examined_at");

-- CreateIndex
CREATE INDEX "internal_medicine_exams_patient_id_subspecialty_examined_at_idx" ON "internal_medicine_exams"("patient_id", "subspecialty", "examined_at");

-- CreateIndex
CREATE INDEX "emergency_exams_patient_id_created_at_idx" ON "emergency_exams"("patient_id", "created_at");

-- CreateIndex
CREATE INDEX "emergency_exams_encounter_id_idx" ON "emergency_exams"("encounter_id");

-- CreateIndex
CREATE INDEX "family_med_exams_patient_id_created_at_idx" ON "family_med_exams"("patient_id", "created_at");

-- CreateIndex
CREATE INDEX "family_med_exams_encounter_id_idx" ON "family_med_exams"("encounter_id");

-- CreateIndex
CREATE INDEX "pediatric_exams_patient_id_created_at_idx" ON "pediatric_exams"("patient_id", "created_at");

-- CreateIndex
CREATE INDEX "pediatric_exams_encounter_id_idx" ON "pediatric_exams"("encounter_id");

-- CreateIndex
CREATE INDEX "rehab_exams_patient_id_created_at_idx" ON "rehab_exams"("patient_id", "created_at");

-- CreateIndex
CREATE INDEX "rehab_exams_encounter_id_idx" ON "rehab_exams"("encounter_id");

-- CreateIndex
CREATE UNIQUE INDEX "surgery_op_notes_surgery_id_key" ON "surgery_op_notes"("surgery_id");

-- CreateIndex
CREATE INDEX "burn_assessments_patient_id_assessed_at_idx" ON "burn_assessments"("patient_id", "assessed_at");

-- CreateIndex
CREATE INDEX "care_teams_nurse_id_idx" ON "care_teams"("nurse_id");

-- CreateIndex
CREATE INDEX "care_teams_department_name_idx" ON "care_teams"("department_name");

-- CreateIndex
CREATE UNIQUE INDEX "care_teams_doctor_id_nurse_id_team_type_key" ON "care_teams"("doctor_id", "nurse_id", "team_type");

-- CreateIndex
CREATE INDEX "nurse_patient_assignments_nurse_id_released_at_idx" ON "nurse_patient_assignments"("nurse_id", "released_at");

-- CreateIndex
CREATE INDEX "nurse_patient_assignments_admission_id_idx" ON "nurse_patient_assignments"("admission_id");

-- CreateIndex
CREATE INDEX "nurse_tasks_encounter_id_idx" ON "nurse_tasks"("encounter_id");

-- CreateIndex
CREATE INDEX "nurse_tasks_nurse_id_status_idx" ON "nurse_tasks"("nurse_id", "status");

-- CreateIndex
CREATE INDEX "nurse_tasks_queue_id_idx" ON "nurse_tasks"("queue_id");

-- CreateIndex
CREATE INDEX "pre_visit_vitals_queue_id_idx" ON "pre_visit_vitals"("queue_id");

-- CreateIndex
CREATE INDEX "pre_visit_vitals_encounter_id_idx" ON "pre_visit_vitals"("encounter_id");

-- CreateIndex
CREATE INDEX "pre_visit_vitals_patient_id_measured_at_idx" ON "pre_visit_vitals"("patient_id", "measured_at");

-- CreateIndex
CREATE UNIQUE INDEX "blockchain_certificates_serial_number_key" ON "blockchain_certificates"("serial_number");

-- CreateIndex
CREATE INDEX "blockchain_certificates_owner_type_user_id_idx" ON "blockchain_certificates"("owner_type", "user_id");

-- CreateIndex
CREATE INDEX "blockchain_certificates_owner_type_patient_id_idx" ON "blockchain_certificates"("owner_type", "patient_id");

-- CreateIndex
CREATE INDEX "blockchain_certificates_serial_number_idx" ON "blockchain_certificates"("serial_number");

-- CreateIndex
CREATE INDEX "blockchain_certificates_fingerprint_idx" ON "blockchain_certificates"("fingerprint");

-- CreateIndex
CREATE INDEX "blockchain_certificates_status_idx" ON "blockchain_certificates"("status");

-- CreateIndex
CREATE INDEX "signed_documents_document_type_document_id_idx" ON "signed_documents"("document_type", "document_id");

-- CreateIndex
CREATE INDEX "signed_documents_patient_id_idx" ON "signed_documents"("patient_id");

-- CreateIndex
CREATE INDEX "signed_documents_status_idx" ON "signed_documents"("status");

-- CreateIndex
CREATE INDEX "document_signatures_signed_document_id_idx" ON "document_signatures"("signed_document_id");

-- CreateIndex
CREATE INDEX "document_signatures_signer_user_id_signed_at_idx" ON "document_signatures"("signer_user_id", "signed_at");

-- CreateIndex
CREATE INDEX "document_signatures_signer_patient_id_signed_at_idx" ON "document_signatures"("signer_patient_id", "signed_at");

-- CreateIndex
CREATE UNIQUE INDEX "encryption_key_registry_key_id_key" ON "encryption_key_registry"("key_id");

-- CreateIndex
CREATE INDEX "encryption_key_registry_status_idx" ON "encryption_key_registry"("status");

-- CreateIndex
CREATE INDEX "admission_designated_doctors_admission_id_active_idx" ON "admission_designated_doctors"("admission_id", "active");

-- CreateIndex
CREATE UNIQUE INDEX "admission_designated_doctors_admission_id_doctor_id_key" ON "admission_designated_doctors"("admission_id", "doctor_id");

-- CreateIndex
CREATE INDEX "step_up_approvals_user_id_status_idx" ON "step_up_approvals"("user_id", "status");

-- CreateIndex
CREATE INDEX "step_up_approvals_status_created_at_idx" ON "step_up_approvals"("status", "created_at");

-- CreateIndex
CREATE INDEX "blockchain_anchors_anchor_type_reference_id_idx" ON "blockchain_anchors"("anchor_type", "reference_id");

-- CreateIndex
CREATE INDEX "blockchain_anchors_tx_hash_idx" ON "blockchain_anchors"("tx_hash");

-- CreateIndex
CREATE INDEX "blockchain_anchors_status_idx" ON "blockchain_anchors"("status");

-- CreateIndex
CREATE INDEX "certificate_audit_logs_certificate_id_created_at_idx" ON "certificate_audit_logs"("certificate_id", "created_at");

-- CreateIndex
CREATE INDEX "certificate_audit_logs_user_id_event_type_idx" ON "certificate_audit_logs"("user_id", "event_type");

-- CreateIndex
CREATE INDEX "certificate_audit_logs_patient_id_event_type_idx" ON "certificate_audit_logs"("patient_id", "event_type");

-- CreateIndex
CREATE UNIQUE INDEX "pathology_specimens_accession_no_key" ON "pathology_specimens"("accession_no");

-- CreateIndex
CREATE INDEX "pathology_specimens_patient_id_idx" ON "pathology_specimens"("patient_id");

-- CreateIndex
CREATE INDEX "pathology_specimens_status_idx" ON "pathology_specimens"("status");

-- CreateIndex
CREATE INDEX "pathology_specimens_accession_no_idx" ON "pathology_specimens"("accession_no");

-- CreateIndex
CREATE INDEX "pathology_processing_steps_specimen_id_performed_at_idx" ON "pathology_processing_steps"("specimen_id", "performed_at");

-- CreateIndex
CREATE UNIQUE INDEX "pathology_reports_specimen_id_key" ON "pathology_reports"("specimen_id");

-- CreateIndex
CREATE INDEX "hira_claim_documents_claim_id_idx" ON "hira_claim_documents"("claim_id");

-- CreateIndex
CREATE INDEX "hira_claim_documents_patient_id_idx" ON "hira_claim_documents"("patient_id");

-- CreateIndex
CREATE INDEX "hira_claim_documents_status_idx" ON "hira_claim_documents"("status");

-- CreateIndex
CREATE INDEX "controlled_substance_logs_patient_id_idx" ON "controlled_substance_logs"("patient_id");

-- CreateIndex
CREATE INDEX "controlled_substance_logs_dea_schedule_idx" ON "controlled_substance_logs"("dea_schedule");

-- CreateIndex
CREATE INDEX "controlled_substance_logs_status_idx" ON "controlled_substance_logs"("status");

-- CreateIndex
CREATE INDEX "controlled_substance_logs_prescribed_at_idx" ON "controlled_substance_logs"("prescribed_at");

-- CreateIndex
CREATE INDEX "controlled_substance_stocks_dea_schedule_idx" ON "controlled_substance_stocks"("dea_schedule");

-- CreateIndex
CREATE UNIQUE INDEX "controlled_substance_stocks_drug_code_location_key" ON "controlled_substance_stocks"("drug_code", "location");

-- CreateIndex
CREATE INDEX "controlled_substance_stock_txns_stock_id_occurred_at_idx" ON "controlled_substance_stock_txns"("stock_id", "occurred_at");

-- CreateIndex
CREATE INDEX "controlled_substance_stock_txns_type_idx" ON "controlled_substance_stock_txns"("type");

-- CreateIndex
CREATE INDEX "controlled_substance_incidents_status_idx" ON "controlled_substance_incidents"("status");

-- CreateIndex
CREATE INDEX "controlled_substance_incidents_incident_type_idx" ON "controlled_substance_incidents"("incident_type");

-- CreateIndex
CREATE INDEX "compounding_orders_status_idx" ON "compounding_orders"("status");

-- CreateIndex
CREATE INDEX "compounding_orders_patient_id_status_idx" ON "compounding_orders"("patient_id", "status");

-- CreateIndex
CREATE INDEX "compounding_components_order_id_idx" ON "compounding_components"("order_id");

-- CreateIndex
CREATE INDEX "nims_reports_status_idx" ON "nims_reports"("status");

-- CreateIndex
CREATE INDEX "nims_reports_report_type_idx" ON "nims_reports"("report_type");

-- CreateIndex
CREATE INDEX "nims_reports_event_at_idx" ON "nims_reports"("event_at");

-- CreateIndex
CREATE INDEX "risk_reassessment_schedules_patient_id_assessment_type_idx" ON "risk_reassessment_schedules"("patient_id", "assessment_type");

-- CreateIndex
CREATE INDEX "risk_reassessment_schedules_next_due_at_is_active_idx" ON "risk_reassessment_schedules"("next_due_at", "is_active");

-- CreateIndex
CREATE INDEX "universal_nursing_notes_patient_id_context_type_idx" ON "universal_nursing_notes"("patient_id", "context_type");

-- CreateIndex
CREATE INDEX "universal_nursing_notes_context_type_context_id_idx" ON "universal_nursing_notes"("context_type", "context_id");

-- CreateIndex
CREATE INDEX "universal_nursing_notes_nurse_id_recorded_at_idx" ON "universal_nursing_notes"("nurse_id", "recorded_at");

-- CreateIndex
CREATE INDEX "notifications_user_id_is_read_idx" ON "notifications"("user_id", "is_read");

-- CreateIndex
CREATE INDEX "notifications_created_at_idx" ON "notifications"("created_at");

-- CreateIndex
CREATE INDEX "critical_value_alerts_doctor_id_status_idx" ON "critical_value_alerts"("doctor_id", "status");

-- CreateIndex
CREATE INDEX "critical_value_alerts_patient_id_idx" ON "critical_value_alerts"("patient_id");

-- CreateIndex
CREATE INDEX "critical_value_alerts_status_notified_at_idx" ON "critical_value_alerts"("status", "notified_at");

-- CreateIndex
CREATE INDEX "hand_hygiene_observations_department_observed_at_idx" ON "hand_hygiene_observations"("department", "observed_at");

-- CreateIndex
CREATE INDEX "hand_hygiene_observations_observed_role_idx" ON "hand_hygiene_observations"("observed_role");

-- CreateIndex
CREATE INDEX "hand_hygiene_observations_observed_at_idx" ON "hand_hygiene_observations"("observed_at");

-- CreateIndex
CREATE INDEX "restraint_orders_patient_id_status_idx" ON "restraint_orders"("patient_id", "status");

-- CreateIndex
CREATE INDEX "restraint_orders_status_idx" ON "restraint_orders"("status");

-- CreateIndex
CREATE INDEX "restraint_monitorings_restraint_id_checked_at_idx" ON "restraint_monitorings"("restraint_id", "checked_at");

-- CreateIndex
CREATE INDEX "staff_credentials_user_id_idx" ON "staff_credentials"("user_id");

-- CreateIndex
CREATE INDEX "staff_credentials_type_status_idx" ON "staff_credentials"("type", "status");

-- CreateIndex
CREATE INDEX "staff_credentials_expires_at_idx" ON "staff_credentials"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "staff_educations_idempotency_key_key" ON "staff_educations"("idempotency_key");

-- CreateIndex
CREATE INDEX "staff_educations_user_id_idx" ON "staff_educations"("user_id");

-- CreateIndex
CREATE INDEX "staff_educations_category_status_idx" ON "staff_educations"("category", "status");

-- CreateIndex
CREATE INDEX "staff_educations_expires_at_idx" ON "staff_educations"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "committees_code_key" ON "committees"("code");

-- CreateIndex
CREATE INDEX "committees_type_idx" ON "committees"("type");

-- CreateIndex
CREATE UNIQUE INDEX "opening_task_records_task_key_key" ON "opening_task_records"("task_key");

-- CreateIndex
CREATE INDEX "opening_task_records_state_idx" ON "opening_task_records"("state");

-- CreateIndex
CREATE UNIQUE INDEX "opening_custom_tasks_key_key" ON "opening_custom_tasks"("key");

-- CreateIndex
CREATE INDEX "opening_custom_tasks_is_active_idx" ON "opening_custom_tasks"("is_active");

-- CreateIndex
CREATE INDEX "committee_members_committee_id_idx" ON "committee_members"("committee_id");

-- CreateIndex
CREATE INDEX "committee_members_user_id_idx" ON "committee_members"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "committee_members_committee_id_user_id_key" ON "committee_members"("committee_id", "user_id");

-- CreateIndex
CREATE INDEX "committee_meetings_committee_id_scheduled_at_idx" ON "committee_meetings"("committee_id", "scheduled_at");

-- CreateIndex
CREATE INDEX "committee_meetings_status_idx" ON "committee_meetings"("status");

-- CreateIndex
CREATE INDEX "institutional_policies_category_status_idx" ON "institutional_policies"("category", "status");

-- CreateIndex
CREATE INDEX "institutional_policies_review_date_idx" ON "institutional_policies"("review_date");

-- CreateIndex
CREATE INDEX "committee_agendas_committee_id_status_idx" ON "committee_agendas"("committee_id", "status");

-- CreateIndex
CREATE INDEX "committee_agendas_meeting_id_idx" ON "committee_agendas"("meeting_id");

-- CreateIndex
CREATE UNIQUE INDEX "committee_decisions_agenda_id_key" ON "committee_decisions"("agenda_id");

-- CreateIndex
CREATE UNIQUE INDEX "committee_decisions_decision_no_key" ON "committee_decisions"("decision_no");

-- CreateIndex
CREATE INDEX "committee_decisions_committee_id_status_idx" ON "committee_decisions"("committee_id", "status");

-- CreateIndex
CREATE INDEX "committee_decisions_supersedes_id_idx" ON "committee_decisions"("supersedes_id");

-- CreateIndex
CREATE INDEX "decision_actions_decision_id_idx" ON "decision_actions"("decision_id");

-- CreateIndex
CREATE INDEX "decision_actions_registry_key_idx" ON "decision_actions"("registry_key");

-- CreateIndex
CREATE INDEX "decision_actions_status_idx" ON "decision_actions"("status");

-- CreateIndex
CREATE INDEX "committee_surface_maps_surface_key_idx" ON "committee_surface_maps"("surface_key");

-- CreateIndex
CREATE INDEX "committee_surface_maps_committee_id_idx" ON "committee_surface_maps"("committee_id");

-- CreateIndex
CREATE UNIQUE INDEX "committee_surface_maps_surface_key_committee_id_key" ON "committee_surface_maps"("surface_key", "committee_id");

-- CreateIndex
CREATE INDEX "decision_pathways_code_status_idx" ON "decision_pathways"("code", "status");

-- CreateIndex
CREATE UNIQUE INDEX "decision_pathways_code_version_key" ON "decision_pathways"("code", "version");

-- CreateIndex
CREATE INDEX "decision_pathway_steps_pathway_id_idx" ON "decision_pathway_steps"("pathway_id");

-- CreateIndex
CREATE UNIQUE INDEX "decision_pathway_steps_pathway_id_key_key" ON "decision_pathway_steps"("pathway_id", "key");

-- CreateIndex
CREATE UNIQUE INDEX "decision_pathway_instances_agenda_id_key" ON "decision_pathway_instances"("agenda_id");

-- CreateIndex
CREATE UNIQUE INDEX "decision_pathway_instances_registry_key_key" ON "decision_pathway_instances"("registry_key");

-- CreateIndex
CREATE INDEX "decision_pathway_instances_status_idx" ON "decision_pathway_instances"("status");

-- CreateIndex
CREATE INDEX "decision_pathway_step_states_instance_id_idx" ON "decision_pathway_step_states"("instance_id");

-- CreateIndex
CREATE UNIQUE INDEX "decision_pathway_step_states_instance_id_step_key_key" ON "decision_pathway_step_states"("instance_id", "step_key");

-- CreateIndex
CREATE UNIQUE INDEX "standard_governance_rules_standard_kind_standard_code_key" ON "standard_governance_rules"("standard_kind", "standard_code");

-- CreateIndex
CREATE INDEX "patient_flags_patient_id_flagType_idx" ON "patient_flags"("patient_id", "flagType");

-- CreateIndex
CREATE UNIQUE INDEX "patient_flags_patient_id_flagged_by_flagType_key" ON "patient_flags"("patient_id", "flagged_by", "flagType");

-- CreateIndex
CREATE UNIQUE INDEX "workstation_configs_station_id_key" ON "workstation_configs"("station_id");

-- CreateIndex
CREATE UNIQUE INDEX "workstation_profiles_code_key" ON "workstation_profiles"("code");

-- CreateIndex
CREATE INDEX "workstation_profiles_terminal_id_idx" ON "workstation_profiles"("terminal_id");

-- CreateIndex
CREATE INDEX "peripheral_devices_workstation_profile_id_type_idx" ON "peripheral_devices"("workstation_profile_id", "type");

-- CreateIndex
CREATE INDEX "duty_entries_date_idx" ON "duty_entries"("date");

-- CreateIndex
CREATE INDEX "duty_entries_staff_id_date_idx" ON "duty_entries"("staff_id", "date");

-- CreateIndex
CREATE INDEX "duty_entries_department_date_idx" ON "duty_entries"("department", "date");

-- CreateIndex
CREATE INDEX "duty_swap_requests_status_idx" ON "duty_swap_requests"("status");

-- CreateIndex
CREATE INDEX "duty_leave_requests_status_idx" ON "duty_leave_requests"("status");

-- CreateIndex
CREATE UNIQUE INDEX "duty_staffing_rules_department_shift_day_type_key" ON "duty_staffing_rules"("department", "shift", "day_type");

-- CreateIndex
CREATE INDEX "on_call_schedules_date_idx" ON "on_call_schedules"("date");

-- CreateIndex
CREATE UNIQUE INDEX "on_call_schedules_date_department_call_level_key" ON "on_call_schedules"("date", "department", "call_level");

-- CreateIndex
CREATE INDEX "duty_preferences_staff_id_month_idx" ON "duty_preferences"("staff_id", "month");

-- CreateIndex
CREATE INDEX "training_logbooks_user_id_date_idx" ON "training_logbooks"("user_id", "date");

-- CreateIndex
CREATE INDEX "epa_assessments_user_id_epa_number_idx" ON "epa_assessments"("user_id", "epa_number");

-- CreateIndex
CREATE INDEX "training_rotations_department_idx" ON "training_rotations"("department");

-- CreateIndex
CREATE INDEX "case_presentations_department_idx" ON "case_presentations"("department");

-- CreateIndex
CREATE UNIQUE INDEX "lab_test_templates_procedure_code_key" ON "lab_test_templates"("procedure_code");

-- CreateIndex
CREATE UNIQUE INDEX "therapy_orders_order_id_key" ON "therapy_orders"("order_id");

-- CreateIndex
CREATE INDEX "therapy_orders_scheduled_date_station_id_idx" ON "therapy_orders"("scheduled_date", "station_id");

-- CreateIndex
CREATE INDEX "therapy_orders_therapist_id_scheduled_date_idx" ON "therapy_orders"("therapist_id", "scheduled_date");

-- CreateIndex
CREATE UNIQUE INDEX "checkup_test_masters_code_key" ON "checkup_test_masters"("code");

-- CreateIndex
CREATE INDEX "checkup_test_masters_category_idx" ON "checkup_test_masters"("category");

-- CreateIndex
CREATE INDEX "checkup_test_masters_is_active_idx" ON "checkup_test_masters"("is_active");

-- CreateIndex
CREATE UNIQUE INDEX "checkup_programs_code_key" ON "checkup_programs"("code");

-- CreateIndex
CREATE UNIQUE INDEX "ck_questionnaire_responses_visit_id_key" ON "ck_questionnaire_responses"("visit_id");

-- CreateIndex
CREATE INDEX "ck_questionnaire_responses_patient_id_idx" ON "ck_questionnaire_responses"("patient_id");

-- CreateIndex
CREATE UNIQUE INDEX "ck_stations_station_id_key" ON "ck_stations"("station_id");

-- CreateIndex
CREATE INDEX "ck_station_logs_station_id_arrived_at_idx" ON "ck_station_logs"("station_id", "arrived_at");

-- CreateIndex
CREATE UNIQUE INDEX "ck_station_logs_visit_id_station_id_key" ON "ck_station_logs"("visit_id", "station_id");

-- CreateIndex
CREATE INDEX "checkup_visits_patient_id_idx" ON "checkup_visits"("patient_id");

-- CreateIndex
CREATE INDEX "checkup_visits_scheduled_date_idx" ON "checkup_visits"("scheduled_date");

-- CreateIndex
CREATE INDEX "checkup_visits_status_idx" ON "checkup_visits"("status");

-- CreateIndex
CREATE INDEX "checkup_visits_contract_id_idx" ON "checkup_visits"("contract_id");

-- CreateIndex
CREATE INDEX "checkup_visits_encounter_id_idx" ON "checkup_visits"("encounter_id");

-- CreateIndex
CREATE INDEX "checkup_result_items_visit_id_idx" ON "checkup_result_items"("visit_id");

-- CreateIndex
CREATE UNIQUE INDEX "checkup_summaries_visit_id_key" ON "checkup_summaries"("visit_id");

-- CreateIndex
CREATE UNIQUE INDEX "ck_interpretations_result_item_id_key" ON "ck_interpretations"("result_item_id");

-- CreateIndex
CREATE INDEX "ck_interpretations_department_status_idx" ON "ck_interpretations"("department", "status");

-- CreateIndex
CREATE UNIQUE INDEX "checkup_explainer_contents_test_code_key" ON "checkup_explainer_contents"("test_code");

-- CreateIndex
CREATE INDEX "checkup_explainer_contents_status_idx" ON "checkup_explainer_contents"("status");

-- CreateIndex
CREATE INDEX "checkup_explainer_reviews_content_id_created_at_idx" ON "checkup_explainer_reviews"("content_id", "created_at");

-- CreateIndex
CREATE INDEX "ck_protocols_program_id_status_idx" ON "ck_protocols"("program_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ck_judgment_rules_protocol_id_test_code_sex_key" ON "ck_judgment_rules"("protocol_id", "test_code", "sex");

-- CreateIndex
CREATE INDEX "ck_referrals_visit_id_idx" ON "ck_referrals"("visit_id");

-- CreateIndex
CREATE INDEX "ck_follow_ups_patient_id_due_date_idx" ON "ck_follow_ups"("patient_id", "due_date");

-- CreateIndex
CREATE UNIQUE INDEX "clinical_pathways_code_key" ON "clinical_pathways"("code");

-- CreateIndex
CREATE INDEX "clinical_pathways_department_status_idx" ON "clinical_pathways"("department", "status");

-- CreateIndex
CREATE INDEX "pathway_milestones_pathway_id_day_idx" ON "pathway_milestones"("pathway_id", "day");

-- CreateIndex
CREATE INDEX "pathway_assignments_patient_id_idx" ON "pathway_assignments"("patient_id");

-- CreateIndex
CREATE INDEX "pathway_assignments_status_idx" ON "pathway_assignments"("status");

-- CreateIndex
CREATE INDEX "milestone_outcomes_assignment_id_idx" ON "milestone_outcomes"("assignment_id");

-- CreateIndex
CREATE UNIQUE INDEX "milestone_outcomes_assignment_id_milestone_id_key" ON "milestone_outcomes"("assignment_id", "milestone_id");

-- CreateIndex
CREATE INDEX "mdt_conferences_department_scheduled_at_idx" ON "mdt_conferences"("department", "scheduled_at");

-- CreateIndex
CREATE INDEX "mdt_cases_conference_id_idx" ON "mdt_cases"("conference_id");

-- CreateIndex
CREATE INDEX "mdt_cases_patient_id_idx" ON "mdt_cases"("patient_id");

-- CreateIndex
CREATE UNIQUE INDEX "mdt_attendees_conference_id_user_id_key" ON "mdt_attendees"("conference_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "cancer_registries_registration_no_key" ON "cancer_registries"("registration_no");

-- CreateIndex
CREATE INDEX "cancer_registries_patient_id_idx" ON "cancer_registries"("patient_id");

-- CreateIndex
CREATE INDEX "cancer_registries_primary_site_idx" ON "cancer_registries"("primary_site");

-- CreateIndex
CREATE INDEX "cancer_registries_status_idx" ON "cancer_registries"("status");

-- CreateIndex
CREATE INDEX "cancer_treatments_registry_id_idx" ON "cancer_treatments"("registry_id");

-- CreateIndex
CREATE INDEX "cancer_follow_ups_registry_id_idx" ON "cancer_follow_ups"("registry_id");

-- CreateIndex
CREATE UNIQUE INDEX "research_studies_study_no_key" ON "research_studies"("study_no");

-- CreateIndex
CREATE INDEX "research_studies_department_irb_status_idx" ON "research_studies"("department", "irb_status");

-- CreateIndex
CREATE INDEX "research_subjects_study_id_status_idx" ON "research_subjects"("study_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "research_subjects_study_id_patient_id_key" ON "research_subjects"("study_id", "patient_id");

-- CreateIndex
CREATE INDEX "research_documents_study_id_idx" ON "research_documents"("study_id");

-- CreateIndex
CREATE INDEX "irb_amendments_study_id_idx" ON "irb_amendments"("study_id");

-- CreateIndex
CREATE UNIQUE INDEX "cost_centers_code_key" ON "cost_centers"("code");

-- CreateIndex
CREATE UNIQUE INDEX "cost_drivers_code_key" ON "cost_drivers"("code");

-- CreateIndex
CREATE INDEX "cost_drivers_category_period_idx" ON "cost_drivers"("category", "period");

-- CreateIndex
CREATE INDEX "cost_allocations_cost_center_id_period_idx" ON "cost_allocations"("cost_center_id", "period");

-- CreateIndex
CREATE UNIQUE INDEX "procedure_costs_procedure_code_period_key" ON "procedure_costs"("procedure_code", "period");

-- CreateIndex
CREATE INDEX "flow_sheet_entries_admission_id_recorded_at_idx" ON "flow_sheet_entries"("admission_id", "recorded_at");

-- CreateIndex
CREATE INDEX "nursing_checklists_admission_id_template_type_idx" ON "nursing_checklists"("admission_id", "template_type");

-- CreateIndex
CREATE INDEX "nursing_checklists_nurse_id_created_at_idx" ON "nursing_checklists"("nurse_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "nursing_checklist_templates_code_key" ON "nursing_checklist_templates"("code");

-- CreateIndex
CREATE UNIQUE INDEX "organizations_code_key" ON "organizations"("code");

-- CreateIndex
CREATE INDEX "transfer_records_patient_id_idx" ON "transfer_records"("patient_id");

-- CreateIndex
CREATE INDEX "transfer_records_status_idx" ON "transfer_records"("status");

-- CreateIndex
CREATE INDEX "transfer_records_from_org_id_status_idx" ON "transfer_records"("from_org_id", "status");

-- CreateIndex
CREATE INDEX "transfer_records_to_org_id_status_idx" ON "transfer_records"("to_org_id", "status");

-- CreateIndex
CREATE INDEX "public_access_logs_channel_at_idx" ON "public_access_logs"("channel", "at");

-- CreateIndex
CREATE INDEX "public_access_logs_result_at_idx" ON "public_access_logs"("result", "at");

-- CreateIndex
CREATE INDEX "public_access_logs_subject_hash_at_idx" ON "public_access_logs"("subject_hash", "at");

-- CreateIndex
CREATE INDEX "public_access_logs_patient_id_at_idx" ON "public_access_logs"("patient_id", "at");

-- CreateIndex
CREATE INDEX "smart_access_logs_client_id_at_idx" ON "smart_access_logs"("client_id", "at");

-- CreateIndex
CREATE INDEX "smart_access_logs_user_id_at_idx" ON "smart_access_logs"("user_id", "at");

-- CreateIndex
CREATE INDEX "smart_access_logs_patient_id_at_idx" ON "smart_access_logs"("patient_id", "at");

-- CreateIndex
CREATE UNIQUE INDEX "smart_clients_client_id_key" ON "smart_clients"("client_id");

-- CreateIndex
CREATE INDEX "twin_risk_assessments_patient_id_idx" ON "twin_risk_assessments"("patient_id");

-- CreateIndex
CREATE INDEX "twin_risk_assessments_created_at_idx" ON "twin_risk_assessments"("created_at");

-- CreateIndex
CREATE INDEX "twin_document_references_patient_id_idx" ON "twin_document_references"("patient_id");

-- CreateIndex
CREATE INDEX "twin_document_references_created_at_idx" ON "twin_document_references"("created_at");

-- CreateIndex
CREATE INDEX "issued_documents_patient_id_idx" ON "issued_documents"("patient_id");

-- CreateIndex
CREATE INDEX "issued_documents_document_type_source_id_idx" ON "issued_documents"("document_type", "source_id");

-- CreateIndex
CREATE INDEX "issued_documents_signature_request_id_idx" ON "issued_documents"("signature_request_id");

-- CreateIndex
CREATE UNIQUE INDEX "issued_documents_document_type_date_key_seq_key" ON "issued_documents"("document_type", "date_key", "seq");

-- CreateIndex
CREATE INDEX "partner_requests_status_idx" ON "partner_requests"("status");

-- CreateIndex
CREATE INDEX "api_access_logs_client_id_created_at_idx" ON "api_access_logs"("client_id", "created_at");

-- CreateIndex
CREATE INDEX "api_access_logs_org_id_created_at_idx" ON "api_access_logs"("org_id", "created_at");

-- CreateIndex
CREATE INDEX "api_access_logs_status_code_created_at_idx" ON "api_access_logs"("status_code", "created_at");

-- CreateIndex
CREATE INDEX "hie_exchanges_patient_id_created_at_idx" ON "hie_exchanges"("patient_id", "created_at");

-- CreateIndex
CREATE INDEX "hie_exchanges_direction_status_idx" ON "hie_exchanges"("direction", "status");

-- CreateIndex
CREATE INDEX "hie_exchanges_document_type_idx" ON "hie_exchanges"("document_type");

-- CreateIndex
CREATE INDEX "crm_campaigns_status_scheduled_at_idx" ON "crm_campaigns"("status", "scheduled_at");

-- CreateIndex
CREATE INDEX "crm_campaign_logs_campaign_id_status_idx" ON "crm_campaign_logs"("campaign_id", "status");

-- CreateIndex
CREATE INDEX "crm_campaign_logs_patient_id_idx" ON "crm_campaign_logs"("patient_id");

-- CreateIndex
CREATE INDEX "patient_communication_logs_patient_id_created_at_idx" ON "patient_communication_logs"("patient_id", "created_at");

-- CreateIndex
CREATE INDEX "patient_communication_logs_campaign_id_idx" ON "patient_communication_logs"("campaign_id");

-- CreateIndex
CREATE UNIQUE INDEX "patient_consents_crm_patient_id_channel_type_key" ON "patient_consents_crm"("patient_id", "channel", "type");

-- CreateIndex
CREATE INDEX "crm_foreign_patient_cases_patient_id_idx" ON "crm_foreign_patient_cases"("patient_id");

-- CreateIndex
CREATE INDEX "crm_foreign_patient_cases_assigned_to_status_idx" ON "crm_foreign_patient_cases"("assigned_to", "status");

-- CreateIndex
CREATE INDEX "crm_portal_banners_type_is_active_publish_from_publish_unti_idx" ON "crm_portal_banners"("type", "is_active", "publish_from", "publish_until");

-- CreateIndex
CREATE INDEX "registration_consents_patient_id_type_idx" ON "registration_consents"("patient_id", "type");

-- CreateIndex
CREATE UNIQUE INDEX "registration_consents_patient_id_type_version_key" ON "registration_consents"("patient_id", "type", "version");

-- CreateIndex
CREATE INDEX "remote_consultations_patient_id_status_idx" ON "remote_consultations"("patient_id", "status");

-- CreateIndex
CREATE INDEX "remote_consultations_doctor_id_status_created_at_idx" ON "remote_consultations"("doctor_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "consultation_messages_consultation_id_created_at_idx" ON "consultation_messages"("consultation_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "onboarding_invites_token_hash_key" ON "onboarding_invites"("token_hash");

-- CreateIndex
CREATE INDEX "onboarding_invites_status_idx" ON "onboarding_invites"("status");

-- CreateIndex
CREATE INDEX "onboarding_invites_hire_date_idx" ON "onboarding_invites"("hire_date");

-- CreateIndex
CREATE INDEX "onboarding_sends_invite_id_idx" ON "onboarding_sends"("invite_id");

-- CreateIndex
CREATE INDEX "onboarding_documents_invite_id_status_idx" ON "onboarding_documents"("invite_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "onboarding_profiles_invite_id_key" ON "onboarding_profiles"("invite_id");

-- CreateIndex
CREATE UNIQUE INDEX "onboarding_contracts_invite_id_key" ON "onboarding_contracts"("invite_id");

-- CreateIndex
CREATE UNIQUE INDEX "qr_sessions_token_key" ON "qr_sessions"("token");

-- CreateIndex
CREATE INDEX "qr_sessions_token_idx" ON "qr_sessions"("token");

-- CreateIndex
CREATE INDEX "qr_sessions_purpose_status_idx" ON "qr_sessions"("purpose", "status");

-- CreateIndex
CREATE INDEX "attendance_records_user_id_at_idx" ON "attendance_records"("user_id", "at");

-- CreateIndex
CREATE INDEX "leave_requests_user_id_idx" ON "leave_requests"("user_id");

-- CreateIndex
CREATE INDEX "leave_requests_status_idx" ON "leave_requests"("status");

-- CreateIndex
CREATE UNIQUE INDEX "leave_balances_user_id_year_type_key" ON "leave_balances"("user_id", "year", "type");

-- CreateIndex
CREATE UNIQUE INDEX "employment_certificates_verify_code_key" ON "employment_certificates"("verify_code");

-- CreateIndex
CREATE INDEX "employment_certificates_user_id_idx" ON "employment_certificates"("user_id");

-- CreateIndex
CREATE INDEX "voucher_policies_active_idx" ON "voucher_policies"("active");

-- CreateIndex
CREATE UNIQUE INDEX "voucher_policies_version_key" ON "voucher_policies"("version");

-- CreateIndex
CREATE UNIQUE INDEX "voucher_batches_idempotency_key_key" ON "voucher_batches"("idempotency_key");

-- CreateIndex
CREATE INDEX "voucher_batches_status_idx" ON "voucher_batches"("status");

-- CreateIndex
CREATE INDEX "voucher_batches_program_id_idx" ON "voucher_batches"("program_id");

-- CreateIndex
CREATE UNIQUE INDEX "checkup_vouchers_serial_key" ON "checkup_vouchers"("serial");

-- CreateIndex
CREATE INDEX "checkup_vouchers_batch_id_idx" ON "checkup_vouchers"("batch_id");

-- CreateIndex
CREATE INDEX "checkup_vouchers_status_idx" ON "checkup_vouchers"("status");

-- CreateIndex
CREATE INDEX "checkup_vouchers_current_owner_type_current_owner_id_idx" ON "checkup_vouchers"("current_owner_type", "current_owner_id");

-- CreateIndex
CREATE INDEX "checkup_vouchers_expires_at_idx" ON "checkup_vouchers"("expires_at");

-- CreateIndex
CREATE INDEX "checkup_vouchers_bound_patient_id_idx" ON "checkup_vouchers"("bound_patient_id");

-- CreateIndex
CREATE INDEX "checkup_vouchers_chain_verified_at_idx" ON "checkup_vouchers"("chain_verified_at");

-- CreateIndex
CREATE INDEX "voucher_events_serial_idx" ON "voucher_events"("serial");

-- CreateIndex
CREATE INDEX "voucher_events_hash_idx" ON "voucher_events"("hash");

-- CreateIndex
CREATE INDEX "voucher_events_anchor_status_idx" ON "voucher_events"("anchor_status");

-- CreateIndex
CREATE UNIQUE INDEX "voucher_events_voucher_id_prev_hash_key" ON "voucher_events"("voucher_id", "prev_hash");

-- CreateIndex
CREATE UNIQUE INDEX "voucher_redemptions_idempotency_key_key" ON "voucher_redemptions"("idempotency_key");

-- CreateIndex
CREATE INDEX "voucher_redemptions_voucher_id_idx" ON "voucher_redemptions"("voucher_id");

-- CreateIndex
CREATE INDEX "voucher_redemptions_visit_id_idx" ON "voucher_redemptions"("visit_id");

-- CreateIndex
CREATE INDEX "voucher_redemptions_billing_id_idx" ON "voucher_redemptions"("billing_id");

-- CreateIndex
CREATE INDEX "billing_payments_billing_id_idx" ON "billing_payments"("billing_id");

-- CreateIndex
CREATE UNIQUE INDEX "voucher_distributors_management_no_key" ON "voucher_distributors"("management_no");

-- CreateIndex
CREATE INDEX "voucher_distributors_parent_id_idx" ON "voucher_distributors"("parent_id");

-- CreateIndex
CREATE INDEX "voucher_distributors_status_idx" ON "voucher_distributors"("status");

-- CreateIndex
CREATE INDEX "voucher_distributors_license_expiry_idx" ON "voucher_distributors"("license_expiry");

-- CreateIndex
CREATE UNIQUE INDEX "voucher_distributor_accounts_email_key" ON "voucher_distributor_accounts"("email");

-- CreateIndex
CREATE INDEX "voucher_distributor_accounts_distributor_id_idx" ON "voucher_distributor_accounts"("distributor_id");

-- CreateIndex
CREATE UNIQUE INDEX "voucher_allocations_idempotency_key_key" ON "voucher_allocations"("idempotency_key");

-- CreateIndex
CREATE INDEX "voucher_allocations_to_distributor_id_idx" ON "voucher_allocations"("to_distributor_id");

-- CreateIndex
CREATE INDEX "voucher_allocations_status_idx" ON "voucher_allocations"("status");

-- CreateIndex
CREATE UNIQUE INDEX "voucher_sales_idempotency_key_key" ON "voucher_sales"("idempotency_key");

-- CreateIndex
CREATE INDEX "voucher_sales_distributor_id_idx" ON "voucher_sales"("distributor_id");

-- CreateIndex
CREATE INDEX "voucher_sales_voucher_id_idx" ON "voucher_sales"("voucher_id");

-- CreateIndex
CREATE INDEX "voucher_settlements_distributor_id_status_idx" ON "voucher_settlements"("distributor_id", "status");

-- CreateIndex
CREATE INDEX "voucher_refunds_voucher_id_idx" ON "voucher_refunds"("voucher_id");

-- CreateIndex
CREATE INDEX "voucher_refunds_serial_idx" ON "voucher_refunds"("serial");

-- CreateIndex
CREATE INDEX "voucher_refunds_distributor_id_settled_at_idx" ON "voucher_refunds"("distributor_id", "settled_at");

-- CreateIndex
CREATE INDEX "protocol_templates_code_status_idx" ON "protocol_templates"("code", "status");

-- CreateIndex
CREATE UNIQUE INDEX "protocol_templates_code_version_key" ON "protocol_templates"("code", "version");

-- CreateIndex
CREATE INDEX "protocol_steps_template_id_idx" ON "protocol_steps"("template_id");

-- CreateIndex
CREATE UNIQUE INDEX "protocol_steps_template_id_key_key" ON "protocol_steps"("template_id", "key");

-- CreateIndex
CREATE INDEX "protocol_instances_patient_id_idx" ON "protocol_instances"("patient_id");

-- CreateIndex
CREATE INDEX "protocol_instances_surgery_id_idx" ON "protocol_instances"("surgery_id");

-- CreateIndex
CREATE UNIQUE INDEX "protocol_step_states_instance_id_step_key_key" ON "protocol_step_states"("instance_id", "step_key");

-- CreateIndex
CREATE UNIQUE INDEX "chemo_regimens_code_key" ON "chemo_regimens"("code");

-- CreateIndex
CREATE INDEX "chemo_regimens_status_idx" ON "chemo_regimens"("status");

-- CreateIndex
CREATE INDEX "chemo_regimen_drugs_regimen_id_idx" ON "chemo_regimen_drugs"("regimen_id");

-- CreateIndex
CREATE INDEX "chemo_courses_patient_id_status_idx" ON "chemo_courses"("patient_id", "status");

-- CreateIndex
CREATE INDEX "chemo_cycles_status_planned_date_idx" ON "chemo_cycles"("status", "planned_date");

-- CreateIndex
CREATE UNIQUE INDEX "chemo_cycles_course_id_cycle_number_key" ON "chemo_cycles"("course_id", "cycle_number");

-- CreateIndex
CREATE INDEX "attendance_correction_requests_user_id_status_idx" ON "attendance_correction_requests"("user_id", "status");

-- CreateIndex
CREATE INDEX "overtime_requests_user_id_work_date_idx" ON "overtime_requests"("user_id", "work_date");

-- CreateIndex
CREATE INDEX "approval_delegations_delegate_staff_id_from_date_to_date_idx" ON "approval_delegations"("delegate_staff_id", "from_date", "to_date");

-- CreateIndex
CREATE INDEX "approval_delegations_delegator_staff_id_idx" ON "approval_delegations"("delegator_staff_id");

-- CreateIndex
CREATE INDEX "quality_metric_snapshots_metric_key_captured_on_idx" ON "quality_metric_snapshots"("metric_key", "captured_on");

-- CreateIndex
CREATE UNIQUE INDEX "quality_metric_snapshots_metric_key_captured_on_key" ON "quality_metric_snapshots"("metric_key", "captured_on");

-- CreateIndex
CREATE UNIQUE INDEX "voc_tickets_ticket_no_key" ON "voc_tickets"("ticket_no");

-- CreateIndex
CREATE INDEX "voc_tickets_status_due_at_idx" ON "voc_tickets"("status", "due_at");

-- CreateIndex
CREATE INDEX "voc_tickets_patient_id_idx" ON "voc_tickets"("patient_id");

-- CreateIndex
CREATE INDEX "voc_tickets_type_created_at_idx" ON "voc_tickets"("type", "created_at");

-- CreateIndex
CREATE INDEX "voc_tickets_assignee_id_idx" ON "voc_tickets"("assignee_id");

-- CreateIndex
CREATE INDEX "voc_messages_ticket_id_created_at_idx" ON "voc_messages"("ticket_id", "created_at");

-- CreateIndex
CREATE INDEX "voc_attachments_ticket_id_idx" ON "voc_attachments"("ticket_id");

-- CreateIndex
CREATE UNIQUE INDEX "go_live_items_key_key" ON "go_live_items"("key");

-- CreateIndex
CREATE INDEX "go_live_items_area_status_idx" ON "go_live_items"("area", "status");

-- CreateIndex
CREATE INDEX "go_live_approvals_item_id_created_at_idx" ON "go_live_approvals"("item_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "go_live_snapshots_captured_on_key" ON "go_live_snapshots"("captured_on");

-- CreateIndex
CREATE INDEX "voice_command_sessions_encounter_id_idx" ON "voice_command_sessions"("encounter_id");

-- CreateIndex
CREATE INDEX "voice_command_sessions_doctor_id_idx" ON "voice_command_sessions"("doctor_id");

-- CreateIndex
CREATE INDEX "voice_command_logs_session_id_idx" ON "voice_command_logs"("session_id");

-- CreateIndex
CREATE INDEX "voice_custom_phrases_user_id_type_enabled_idx" ON "voice_custom_phrases"("user_id", "type", "enabled");

-- CreateIndex
CREATE UNIQUE INDEX "uq_voice_phrase" ON "voice_custom_phrases"("user_id", "type", "pattern");

-- CreateIndex
CREATE INDEX "staff_exposure_incidents_staff_id_occurred_at_idx" ON "staff_exposure_incidents"("staff_id", "occurred_at");

-- CreateIndex
CREATE INDEX "staff_exposure_incidents_follow_up_status_idx" ON "staff_exposure_incidents"("follow_up_status");

-- CreateIndex
CREATE INDEX "pharmacist_interventions_patient_id_created_at_idx" ON "pharmacist_interventions"("patient_id", "created_at");

-- CreateIndex
CREATE INDEX "pharmacist_interventions_status_idx" ON "pharmacist_interventions"("status");

-- CreateIndex
CREATE INDEX "tdm_requests_patient_id_requested_at_idx" ON "tdm_requests"("patient_id", "requested_at");

-- CreateIndex
CREATE INDEX "tdm_requests_status_idx" ON "tdm_requests"("status");

-- CreateIndex
CREATE INDEX "sentinel_runs_axis_started_at_idx" ON "sentinel_runs"("axis", "started_at");

-- CreateIndex
CREATE INDEX "sentinel_pulses_metric_at_idx" ON "sentinel_pulses"("metric", "at");

-- CreateIndex
CREATE INDEX "sentinel_runtime_signals_last_seen_at_idx" ON "sentinel_runtime_signals"("last_seen_at");

-- CreateIndex
CREATE UNIQUE INDEX "sentinel_runtime_signals_kind_producer_consumer_key" ON "sentinel_runtime_signals"("kind", "producer", "consumer");

-- CreateIndex
CREATE INDEX "sentinel_findings_axis_severity_resolved_at_idx" ON "sentinel_findings"("axis", "severity", "resolved_at");

-- CreateIndex
CREATE UNIQUE INDEX "sentinel_findings_axis_check_key_key" ON "sentinel_findings"("axis", "check_key");

-- CreateIndex
CREATE INDEX "sentinel_judgments_axis_check_key_judged_at_idx" ON "sentinel_judgments"("axis", "check_key", "judged_at");

-- CreateIndex
CREATE INDEX "ai_proposals_patient_id_created_at_idx" ON "ai_proposals"("patient_id", "created_at");

-- CreateIndex
CREATE INDEX "ai_proposals_target_type_target_id_idx" ON "ai_proposals"("target_type", "target_id");

-- CreateIndex
CREATE INDEX "ai_proposals_kind_status_created_at_idx" ON "ai_proposals"("kind", "status", "created_at");

-- CreateIndex
CREATE INDEX "ai_proposals_model_ref_created_at_idx" ON "ai_proposals"("model_ref", "created_at");

-- CreateIndex
CREATE INDEX "ai_proposal_transitions_proposal_id_at_idx" ON "ai_proposal_transitions"("proposal_id", "at");

-- CreateIndex
CREATE UNIQUE INDEX "ai_model_releases_provider_model_tag_deployed_at_key" ON "ai_model_releases"("provider", "model_tag", "deployed_at");

-- CreateIndex
CREATE INDEX "ai_call_logs_created_at_idx" ON "ai_call_logs"("created_at");

-- CreateIndex
CREATE INDEX "ai_call_logs_model_ref_created_at_idx" ON "ai_call_logs"("model_ref", "created_at");

-- CreateIndex
CREATE INDEX "ai_call_logs_skill_created_at_idx" ON "ai_call_logs"("skill", "created_at");

-- CreateIndex
CREATE INDEX "translation_overrides_locale_status_idx" ON "translation_overrides"("locale", "status");

-- CreateIndex
CREATE INDEX "translation_overrides_area_locale_idx" ON "translation_overrides"("area", "locale");

-- CreateIndex
CREATE INDEX "translation_overrides_status_proposed_at_idx" ON "translation_overrides"("status", "proposed_at");

-- CreateIndex
CREATE UNIQUE INDEX "translation_overrides_locale_key_key" ON "translation_overrides"("locale", "key");

-- CreateIndex
CREATE INDEX "translation_override_transitions_override_id_at_idx" ON "translation_override_transitions"("override_id", "at");

-- AddForeignKey
ALTER TABLE "user_dashboard_configs" ADD CONSTRAINT "user_dashboard_configs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consult_messages" ADD CONSTRAINT "consult_messages_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "consult_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consult_agents" ADD CONSTRAINT "consult_agents_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "consult_teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patients" ADD CONSTRAINT "patients_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patients" ADD CONSTRAINT "patients_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patients" ADD CONSTRAINT "patients_merged_into_id_fkey" FOREIGN KEY ("merged_into_id") REFERENCES "patients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_history" ADD CONSTRAINT "patient_history_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_history" ADD CONSTRAINT "patient_history_changed_by_fkey" FOREIGN KEY ("changed_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_contacts" ADD CONSTRAINT "patient_contacts_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "family_histories" ADD CONSTRAINT "family_histories_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "family_histories" ADD CONSTRAINT "family_histories_diagnosis_code_id_fkey" FOREIGN KEY ("diagnosis_code_id") REFERENCES "diagnosis_codes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_relations" ADD CONSTRAINT "patient_relations_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_relations" ADD CONSTRAINT "patient_relations_related_id_fkey" FOREIGN KEY ("related_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_doctor_id_fkey" FOREIGN KEY ("doctor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_cancelled_by_fkey" FOREIGN KEY ("cancelled_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointment_waitlists" ADD CONSTRAINT "appointment_waitlists_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "procedure_fees" ADD CONSTRAINT "procedure_fees_dataset_id_fkey" FOREIGN KEY ("dataset_id") REFERENCES "reference_datasets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "drug_prices" ADD CONSTRAINT "drug_prices_dataset_id_fkey" FOREIGN KEY ("dataset_id") REFERENCES "reference_datasets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "drg_separate_billings" ADD CONSTRAINT "drg_separate_billings_dataset_id_fkey" FOREIGN KEY ("dataset_id") REFERENCES "reference_datasets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "drg_severity_scores" ADD CONSTRAINT "drg_severity_scores_dataset_id_fkey" FOREIGN KEY ("dataset_id") REFERENCES "reference_datasets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "drg_zero_score_rules" ADD CONSTRAINT "drg_zero_score_rules_dataset_id_fkey" FOREIGN KEY ("dataset_id") REFERENCES "reference_datasets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reference_datasets" ADD CONSTRAINT "reference_datasets_imported_by_fkey" FOREIGN KEY ("imported_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "drug_barcodes" ADD CONSTRAINT "drug_barcodes_dataset_id_fkey" FOREIGN KEY ("dataset_id") REFERENCES "reference_datasets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "drug_barcodes" ADD CONSTRAINT "drug_barcodes_medication_code_id_fkey" FOREIGN KEY ("medication_code_id") REFERENCES "medication_codes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "encounters" ADD CONSTRAINT "encounters_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "encounters" ADD CONSTRAINT "encounters_doctor_id_fkey" FOREIGN KEY ("doctor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "encounters" ADD CONSTRAINT "encounters_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "appointments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "encounters" ADD CONSTRAINT "encounters_admission_id_fkey" FOREIGN KEY ("admission_id") REFERENCES "admissions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "encounter_attachments" ADD CONSTRAINT "encounter_attachments_encounter_id_fkey" FOREIGN KEY ("encounter_id") REFERENCES "encounters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "concierge_sessions" ADD CONSTRAINT "concierge_sessions_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "concierge_messages" ADD CONSTRAINT "concierge_messages_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "concierge_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consultations" ADD CONSTRAINT "consultations_encounter_id_fkey" FOREIGN KEY ("encounter_id") REFERENCES "encounters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consultations" ADD CONSTRAINT "consultations_requesting_doctor_id_fkey" FOREIGN KEY ("requesting_doctor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consultations" ADD CONSTRAINT "consultations_to_doctor_id_fkey" FOREIGN KEY ("to_doctor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consultations" ADD CONSTRAINT "consultations_reply_doctor_id_fkey" FOREIGN KEY ("reply_doctor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referral_letters" ADD CONSTRAINT "referral_letters_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referral_letters" ADD CONSTRAINT "referral_letters_from_doctor_id_fkey" FOREIGN KEY ("from_doctor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referral_letters" ADD CONSTRAINT "referral_letters_to_doctor_id_fkey" FOREIGN KEY ("to_doctor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "encounter_diagnoses" ADD CONSTRAINT "encounter_diagnoses_encounter_id_fkey" FOREIGN KEY ("encounter_id") REFERENCES "encounters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "encounter_diagnoses" ADD CONSTRAINT "encounter_diagnoses_diagnosis_code_id_fkey" FOREIGN KEY ("diagnosis_code_id") REFERENCES "diagnosis_codes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prescriptions" ADD CONSTRAINT "prescriptions_encounter_id_fkey" FOREIGN KEY ("encounter_id") REFERENCES "encounters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prescriptions" ADD CONSTRAINT "prescriptions_diagnosis_code_id_fkey" FOREIGN KEY ("diagnosis_code_id") REFERENCES "diagnosis_codes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prescriptions" ADD CONSTRAINT "prescriptions_medication_code_id_fkey" FOREIGN KEY ("medication_code_id") REFERENCES "medication_codes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prescriptions" ADD CONSTRAINT "prescriptions_procedure_code_id_fkey" FOREIGN KEY ("procedure_code_id") REFERENCES "procedure_codes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_prescription_id_fkey" FOREIGN KEY ("prescription_id") REFERENCES "prescriptions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_cancelled_by_id_fkey" FOREIGN KEY ("cancelled_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_acknowledged_by_fkey" FOREIGN KEY ("acknowledged_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_received_by_id_fkey" FOREIGN KEY ("received_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_started_by_id_fkey" FOREIGN KEY ("started_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_completed_by_id_fkey" FOREIGN KEY ("completed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_sign_logs" ADD CONSTRAINT "order_sign_logs_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billings" ADD CONSTRAINT "billings_encounter_id_fkey" FOREIGN KEY ("encounter_id") REFERENCES "encounters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billings" ADD CONSTRAINT "billings_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_items" ADD CONSTRAINT "billing_items_billing_id_fkey" FOREIGN KEY ("billing_id") REFERENCES "billings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deposits" ADD CONSTRAINT "deposits_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "installment_plans" ADD CONSTRAINT "installment_plans_billing_id_fkey" FOREIGN KEY ("billing_id") REFERENCES "billings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "installment_payments" ADD CONSTRAINT "installment_payments_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "installment_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "form_submissions" ADD CONSTRAINT "form_submissions_form_schema_id_fkey" FOREIGN KEY ("form_schema_id") REFERENCES "form_schemas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "form_submissions" ADD CONSTRAINT "form_submissions_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "form_submissions" ADD CONSTRAINT "form_submissions_encounter_id_fkey" FOREIGN KEY ("encounter_id") REFERENCES "encounters"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dispensings" ADD CONSTRAINT "dispensings_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dispensings" ADD CONSTRAINT "dispensings_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dispensings" ADD CONSTRAINT "dispensings_pharmacist_id_fkey" FOREIGN KEY ("pharmacist_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dispensings" ADD CONSTRAINT "dispensings_split_of_id_fkey" FOREIGN KEY ("split_of_id") REFERENCES "dispensings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dispensing_items" ADD CONSTRAINT "dispensing_items_dispensing_id_fkey" FOREIGN KEY ("dispensing_id") REFERENCES "dispensings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dispensing_items" ADD CONSTRAINT "dispensing_items_medication_code_id_fkey" FOREIGN KEY ("medication_code_id") REFERENCES "medication_codes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dispensing_items" ADD CONSTRAINT "dispensing_items_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "medication_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medication_batches" ADD CONSTRAINT "medication_batches_medication_code_id_fkey" FOREIGN KEY ("medication_code_id") REFERENCES "medication_codes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dispensing_counsels" ADD CONSTRAINT "dispensing_counsels_dispensing_id_fkey" FOREIGN KEY ("dispensing_id") REFERENCES "dispensings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dispensing_counsels" ADD CONSTRAINT "dispensing_counsels_pharmacist_id_fkey" FOREIGN KEY ("pharmacist_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dispensing_counsels" ADD CONSTRAINT "dispensing_counsels_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "generic_substitutions" ADD CONSTRAINT "generic_substitutions_original_prescription_id_fkey" FOREIGN KEY ("original_prescription_id") REFERENCES "prescriptions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "generic_substitutions" ADD CONSTRAINT "generic_substitutions_substitute_medication_code_id_fkey" FOREIGN KEY ("substitute_medication_code_id") REFERENCES "medication_codes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "generic_substitutions" ADD CONSTRAINT "generic_substitutions_pharmacist_id_fkey" FOREIGN KEY ("pharmacist_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "adverse_reaction_reports" ADD CONSTRAINT "adverse_reaction_reports_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "adverse_reaction_reports" ADD CONSTRAINT "adverse_reaction_reports_reporter_id_fkey" FOREIGN KEY ("reporter_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "atc_dispense_jobs" ADD CONSTRAINT "atc_dispense_jobs_dispensing_id_fkey" FOREIGN KEY ("dispensing_id") REFERENCES "dispensings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "atc_dispense_jobs" ADD CONSTRAINT "atc_dispense_jobs_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "pharmacy_devices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_results" ADD CONSTRAINT "lab_results_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_results" ADD CONSTRAINT "lab_results_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_results" ADD CONSTRAINT "lab_results_technician_id_fkey" FOREIGN KEY ("technician_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_result_amendments" ADD CONSTRAINT "lab_result_amendments_lab_result_id_fkey" FOREIGN KEY ("lab_result_id") REFERENCES "lab_results"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_result_items" ADD CONSTRAINT "lab_result_items_lab_result_id_fkey" FOREIGN KEY ("lab_result_id") REFERENCES "lab_results"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_result_attachments" ADD CONSTRAINT "lab_result_attachments_lab_result_id_fkey" FOREIGN KEY ("lab_result_id") REFERENCES "lab_results"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_result_attachments" ADD CONSTRAINT "lab_result_attachments_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_interface_results" ADD CONSTRAINT "lab_interface_results_instrument_id_fkey" FOREIGN KEY ("instrument_id") REFERENCES "lab_instruments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_worksheets" ADD CONSTRAINT "lab_worksheets_instrument_id_fkey" FOREIGN KEY ("instrument_id") REFERENCES "lab_instruments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_worksheets" ADD CONSTRAINT "lab_worksheets_technician_id_fkey" FOREIGN KEY ("technician_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_worksheet_items" ADD CONSTRAINT "lab_worksheet_items_worksheet_id_fkey" FOREIGN KEY ("worksheet_id") REFERENCES "lab_worksheets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_send_out_catalog" ADD CONSTRAINT "lab_send_out_catalog_reference_lab_id_fkey" FOREIGN KEY ("reference_lab_id") REFERENCES "reference_labs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_send_outs" ADD CONSTRAINT "lab_send_outs_reference_lab_id_fkey" FOREIGN KEY ("reference_lab_id") REFERENCES "reference_labs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_send_outs" ADD CONSTRAINT "lab_send_outs_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_send_outs" ADD CONSTRAINT "lab_send_outs_requested_by_fkey" FOREIGN KEY ("requested_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cell_therapy_batches" ADD CONSTRAINT "cell_therapy_batches_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cell_environment_logs" ADD CONSTRAINT "cell_environment_logs_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "cell_therapy_batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cell_qc_tests" ADD CONSTRAINT "cell_qc_tests_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "cell_therapy_batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cell_qc_tests" ADD CONSTRAINT "cell_qc_tests_tested_by_fkey" FOREIGN KEY ("tested_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cell_batch_documents" ADD CONSTRAINT "cell_batch_documents_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "cell_therapy_batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cell_batch_documents" ADD CONSTRAINT "cell_batch_documents_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "genomic_tests" ADD CONSTRAINT "genomic_tests_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "genomic_tests" ADD CONSTRAINT "genomic_tests_ordered_by_fkey" FOREIGN KEY ("ordered_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "genomic_tests" ADD CONSTRAINT "genomic_tests_reference_lab_id_fkey" FOREIGN KEY ("reference_lab_id") REFERENCES "reference_labs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "genomic_variants" ADD CONSTRAINT "genomic_variants_genomic_test_id_fkey" FOREIGN KEY ("genomic_test_id") REFERENCES "genomic_tests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "genomic_reports" ADD CONSTRAINT "genomic_reports_genomic_test_id_fkey" FOREIGN KEY ("genomic_test_id") REFERENCES "genomic_tests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "genomic_reports" ADD CONSTRAINT "genomic_reports_reported_by_fkey" FOREIGN KEY ("reported_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_qc_records" ADD CONSTRAINT "lab_qc_records_instrument_id_fkey" FOREIGN KEY ("instrument_id") REFERENCES "lab_instruments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_qc_records" ADD CONSTRAINT "lab_qc_records_performed_by_fkey" FOREIGN KEY ("performed_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nutrition_assessments" ADD CONSTRAINT "nutrition_assessments_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "diet_orders" ADD CONSTRAINT "diet_orders_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "diet_orders" ADD CONSTRAINT "diet_orders_ordered_by_fkey" FOREIGN KEY ("ordered_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "special_nutrition_orders" ADD CONSTRAINT "special_nutrition_orders_admission_id_fkey" FOREIGN KEY ("admission_id") REFERENCES "admissions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "special_nutrition_orders" ADD CONSTRAINT "special_nutrition_orders_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nutrition_counsels" ADD CONSTRAINT "nutrition_counsels_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nutrition_counsels" ADD CONSTRAINT "nutrition_counsels_counseled_by_fkey" FOREIGN KEY ("counseled_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "or_schedules" ADD CONSTRAINT "or_schedules_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "operating_rooms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "anesthesia_records" ADD CONSTRAINT "anesthesia_records_anesthetist_id_fkey" FOREIGN KEY ("anesthetist_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pacu_records" ADD CONSTRAINT "pacu_records_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pacu_records" ADD CONSTRAINT "pacu_records_nurse_id_fkey" FOREIGN KEY ("nurse_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blood_crossmatches" ADD CONSTRAINT "blood_crossmatches_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blood_crossmatches" ADD CONSTRAINT "blood_crossmatches_blood_product_id_fkey" FOREIGN KEY ("blood_product_id") REFERENCES "blood_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blood_crossmatches" ADD CONSTRAINT "blood_crossmatches_requested_by_fkey" FOREIGN KEY ("requested_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfusion_orders" ADD CONSTRAINT "transfusion_orders_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfusion_orders" ADD CONSTRAINT "transfusion_orders_ordered_by_fkey" FOREIGN KEY ("ordered_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blood_transfusions" ADD CONSTRAINT "blood_transfusions_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "transfusion_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blood_transfusions" ADD CONSTRAINT "blood_transfusions_blood_product_id_fkey" FOREIGN KEY ("blood_product_id") REFERENCES "blood_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blood_transfusions" ADD CONSTRAINT "blood_transfusions_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rehab_assessments" ADD CONSTRAINT "rehab_assessments_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rehab_assessments" ADD CONSTRAINT "rehab_assessments_assessed_by_fkey" FOREIGN KEY ("assessed_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rehab_plans" ADD CONSTRAINT "rehab_plans_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rehab_plans" ADD CONSTRAINT "rehab_plans_prescribed_by_fkey" FOREIGN KEY ("prescribed_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rehab_sessions" ADD CONSTRAINT "rehab_sessions_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "rehab_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rehab_sessions" ADD CONSTRAINT "rehab_sessions_therapist_id_fkey" FOREIGN KEY ("therapist_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "radiation_plans" ADD CONSTRAINT "radiation_plans_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "radiation_plans" ADD CONSTRAINT "radiation_plans_prescribed_by_fkey" FOREIGN KEY ("prescribed_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "radiation_plans" ADD CONSTRAINT "radiation_plans_plan_approved_by_fkey" FOREIGN KEY ("plan_approved_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "radiation_fractions" ADD CONSTRAINT "radiation_fractions_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "radiation_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "radiation_fractions" ADD CONSTRAINT "radiation_fractions_therapist_id_fkey" FOREIGN KEY ("therapist_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "radiation_toxicities" ADD CONSTRAINT "radiation_toxicities_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "radiation_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "radiation_toxicities" ADD CONSTRAINT "radiation_toxicities_assessed_by_fkey" FOREIGN KEY ("assessed_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dialysis_orders" ADD CONSTRAINT "dialysis_orders_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dialysis_orders" ADD CONSTRAINT "dialysis_orders_prescribed_by_fkey" FOREIGN KEY ("prescribed_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dialysis_sessions" ADD CONSTRAINT "dialysis_sessions_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "dialysis_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dialysis_sessions" ADD CONSTRAINT "dialysis_sessions_machine_id_fkey" FOREIGN KEY ("machine_id") REFERENCES "dialysis_machines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dialysis_sessions" ADD CONSTRAINT "dialysis_sessions_nurse_id_fkey" FOREIGN KEY ("nurse_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hospice_registrations" ADD CONSTRAINT "hospice_registrations_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hospice_registrations" ADD CONSTRAINT "hospice_registrations_registered_by_fkey" FOREIGN KEY ("registered_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hospice_symptom_assessments" ADD CONSTRAINT "hospice_symptom_assessments_registration_id_fkey" FOREIGN KEY ("registration_id") REFERENCES "hospice_registrations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hospice_symptom_assessments" ADD CONSTRAINT "hospice_symptom_assessments_assessor_id_fkey" FOREIGN KEY ("assessor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "advance_directives" ADD CONSTRAINT "advance_directives_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hospice_care_conferences" ADD CONSTRAINT "hospice_care_conferences_registration_id_fkey" FOREIGN KEY ("registration_id") REFERENCES "hospice_registrations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hospice_care_conferences" ADD CONSTRAINT "hospice_care_conferences_facilitator_id_fkey" FOREIGN KEY ("facilitator_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transplant_waitlists" ADD CONSTRAINT "transplant_waitlists_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transplant_donors" ADD CONSTRAINT "transplant_donors_donor_patient_id_fkey" FOREIGN KEY ("donor_patient_id") REFERENCES "patients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transplant_crossmatches" ADD CONSTRAINT "transplant_crossmatches_donor_id_fkey" FOREIGN KEY ("donor_id") REFERENCES "transplant_donors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transplant_records" ADD CONSTRAINT "transplant_records_recipient_id_fkey" FOREIGN KEY ("recipient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transplant_records" ADD CONSTRAINT "transplant_records_donor_id_fkey" FOREIGN KEY ("donor_id") REFERENCES "transplant_donors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transplant_records" ADD CONSTRAINT "transplant_records_waitlist_id_fkey" FOREIGN KEY ("waitlist_id") REFERENCES "transplant_waitlists"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transplant_records" ADD CONSTRAINT "transplant_records_surgeon_id_fkey" FOREIGN KEY ("surgeon_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transplant_rejections" ADD CONSTRAINT "transplant_rejections_transplant_id_fkey" FOREIGN KEY ("transplant_id") REFERENCES "transplant_records"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "telehealth_sessions" ADD CONSTRAINT "telehealth_sessions_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "telehealth_sessions" ADD CONSTRAINT "telehealth_sessions_doctor_id_fkey" FOREIGN KEY ("doctor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "telehealth_sessions" ADD CONSTRAINT "telehealth_sessions_encounter_id_fkey" FOREIGN KEY ("encounter_id") REFERENCES "encounters"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dental_charts" ADD CONSTRAINT "dental_charts_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dental_charts" ADD CONSTRAINT "dental_charts_charted_by_fkey" FOREIGN KEY ("charted_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dental_treatment_plans" ADD CONSTRAINT "dental_treatment_plans_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dental_treatment_plans" ADD CONSTRAINT "dental_treatment_plans_planned_by_fkey" FOREIGN KEY ("planned_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dental_treatment_records" ADD CONSTRAINT "dental_treatment_records_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "dental_treatment_plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dental_treatment_records" ADD CONSTRAINT "dental_treatment_records_treated_by_fkey" FOREIGN KEY ("treated_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "eye_exams" ADD CONSTRAINT "eye_exams_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "eye_exams" ADD CONSTRAINT "eye_exams_examined_by_fkey" FOREIGN KEY ("examined_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "eye_surgeries" ADD CONSTRAINT "eye_surgeries_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "eye_surgeries" ADD CONSTRAINT "eye_surgeries_operated_by_fkey" FOREIGN KEY ("operated_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "skin_lesions" ADD CONSTRAINT "skin_lesions_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "skin_lesions" ADD CONSTRAINT "skin_lesions_recorded_by_fkey" FOREIGN KEY ("recorded_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "skin_treatments" ADD CONSTRAINT "skin_treatments_lesion_id_fkey" FOREIGN KEY ("lesion_id") REFERENCES "skin_lesions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "skin_treatments" ADD CONSTRAINT "skin_treatments_treated_by_fkey" FOREIGN KEY ("treated_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ent_exams" ADD CONSTRAINT "ent_exams_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ent_exams" ADD CONSTRAINT "ent_exams_examined_by_fkey" FOREIGN KEY ("examined_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hearing_aids" ADD CONSTRAINT "hearing_aids_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hearing_aids" ADD CONSTRAINT "hearing_aids_prescribed_by_fkey" FOREIGN KEY ("prescribed_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "eye_prescriptions" ADD CONSTRAINT "eye_prescriptions_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "eye_prescriptions" ADD CONSTRAINT "eye_prescriptions_prescribed_by_fkey" FOREIGN KEY ("prescribed_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dental_lab_orders" ADD CONSTRAINT "dental_lab_orders_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dental_lab_orders" ADD CONSTRAINT "dental_lab_orders_ordered_by_fkey" FOREIGN KEY ("ordered_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sleep_studies" ADD CONSTRAINT "sleep_studies_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sleep_studies" ADD CONSTRAINT "sleep_studies_interpreted_by_fkey" FOREIGN KEY ("interpreted_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "imaging_results" ADD CONSTRAINT "imaging_results_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "imaging_results" ADD CONSTRAINT "imaging_results_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "radiation_exposures" ADD CONSTRAINT "radiation_exposures_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "radiation_exposures" ADD CONSTRAINT "radiation_exposures_imaging_result_id_fkey" FOREIGN KEY ("imaging_result_id") REFERENCES "imaging_results"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "claims" ADD CONSTRAINT "claims_billing_id_fkey" FOREIGN KEY ("billing_id") REFERENCES "billings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "claims" ADD CONSTRAINT "claims_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "claim_adjustments" ADD CONSTRAINT "claim_adjustments_claim_id_fkey" FOREIGN KEY ("claim_id") REFERENCES "claims"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "beds" ADD CONSTRAINT "beds_ward_id_fkey" FOREIGN KEY ("ward_id") REFERENCES "wards"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admissions" ADD CONSTRAINT "admissions_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admissions" ADD CONSTRAINT "admissions_bed_id_fkey" FOREIGN KEY ("bed_id") REFERENCES "beds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admissions" ADD CONSTRAINT "admissions_admitting_doctor_id_fkey" FOREIGN KEY ("admitting_doctor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admissions" ADD CONSTRAINT "admissions_attending_doctor_id_fkey" FOREIGN KEY ("attending_doctor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "interim_billings" ADD CONSTRAINT "interim_billings_admission_id_fkey" FOREIGN KEY ("admission_id") REFERENCES "admissions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "progress_notes" ADD CONSTRAINT "progress_notes_admission_id_fkey" FOREIGN KEY ("admission_id") REFERENCES "admissions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "progress_notes" ADD CONSTRAINT "progress_notes_doctor_id_fkey" FOREIGN KEY ("doctor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_issued_by_fkey" FOREIGN KEY ("issued_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "surgeries" ADD CONSTRAINT "surgeries_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "surgeries" ADD CONSTRAINT "surgeries_surgeon_id_fkey" FOREIGN KEY ("surgeon_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pre_anesthesia_evaluations" ADD CONSTRAINT "pre_anesthesia_evaluations_surgery_id_fkey" FOREIGN KEY ("surgery_id") REFERENCES "surgeries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pre_anesthesia_evaluations" ADD CONSTRAINT "pre_anesthesia_evaluations_evaluator_id_fkey" FOREIGN KEY ("evaluator_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "emergency_visits" ADD CONSTRAINT "emergency_visits_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "emergency_reassessments" ADD CONSTRAINT "emergency_reassessments_visit_id_fkey" FOREIGN KEY ("visit_id") REFERENCES "emergency_visits"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "emergency_dispositions" ADD CONSTRAINT "emergency_dispositions_visit_id_fkey" FOREIGN KEY ("visit_id") REFERENCES "emergency_visits"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "emergency_nursing_assessments" ADD CONSTRAINT "emergency_nursing_assessments_visit_id_fkey" FOREIGN KEY ("visit_id") REFERENCES "emergency_visits"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_default_storage_id_fkey" FOREIGN KEY ("default_storage_id") REFERENCES "inventory_storages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "inventory_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_lot_id_fkey" FOREIGN KEY ("lot_id") REFERENCES "inventory_lots"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_storage_id_fkey" FOREIGN KEY ("storage_id") REFERENCES "inventory_storages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_storages" ADD CONSTRAINT "inventory_storages_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "inventory_storages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_item_suppliers" ADD CONSTRAINT "inventory_item_suppliers_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "inventory_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_item_suppliers" ADD CONSTRAINT "inventory_item_suppliers_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "inventory_suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_lots" ADD CONSTRAINT "inventory_lots_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "inventory_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_lots" ADD CONSTRAINT "inventory_lots_storage_id_fkey" FOREIGN KEY ("storage_id") REFERENCES "inventory_storages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "inventory_suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_request_items" ADD CONSTRAINT "inventory_request_items_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "inventory_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "repack_order_items" ADD CONSTRAINT "repack_order_items_repack_order_id_fkey" FOREIGN KEY ("repack_order_id") REFERENCES "repack_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_counts" ADD CONSTRAINT "inventory_counts_storage_id_fkey" FOREIGN KEY ("storage_id") REFERENCES "inventory_storages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_count_items" ADD CONSTRAINT "inventory_count_items_count_id_fkey" FOREIGN KEY ("count_id") REFERENCES "inventory_counts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_count_items" ADD CONSTRAINT "inventory_count_items_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "inventory_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sterilization_logs" ADD CONSTRAINT "sterilization_logs_instrument_set_id_fkey" FOREIGN KEY ("instrument_set_id") REFERENCES "instrument_sets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sterile_packages" ADD CONSTRAINT "sterile_packages_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "instrument_set_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sterile_packages" ADD CONSTRAINT "sterile_packages_load_id_fkey" FOREIGN KEY ("load_id") REFERENCES "sterilization_loads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "package_events" ADD CONSTRAINT "package_events_package_id_fkey" FOREIGN KEY ("package_id") REFERENCES "sterile_packages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "instrument_items" ADD CONSTRAINT "instrument_items_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cssd_po_lines" ADD CONSTRAINT "cssd_po_lines_po_id_fkey" FOREIGN KEY ("po_id") REFERENCES "cssd_purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supply_transactions" ADD CONSTRAINT "supply_transactions_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "instrument_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff" ADD CONSTRAINT "staff_manager_staff_id_fkey" FOREIGN KEY ("manager_staff_id") REFERENCES "staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_dependents" ADD CONSTRAINT "staff_dependents_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "staff"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_documents" ADD CONSTRAINT "staff_documents_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "staff"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_payroll_relays" ADD CONSTRAINT "staff_payroll_relays_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "staff"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_schedules" ADD CONSTRAINT "staff_schedules_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meal_orders" ADD CONSTRAINT "meal_orders_admission_id_fkey" FOREIGN KEY ("admission_id") REFERENCES "admissions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meal_orders" ADD CONSTRAINT "meal_orders_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_meal_menus" ADD CONSTRAINT "staff_meal_menus_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_meal_requests" ADD CONSTRAINT "staff_meal_requests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_usages" ADD CONSTRAINT "device_usages_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_usages" ADD CONSTRAINT "device_usages_recorded_by_fkey" FOREIGN KEY ("recorded_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_logs" ADD CONSTRAINT "maintenance_logs_equipment_id_fkey" FOREIGN KEY ("equipment_id") REFERENCES "equipment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipment_parts" ADD CONSTRAINT "equipment_parts_equipment_id_fkey" FOREIGN KEY ("equipment_id") REFERENCES "equipment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipment_usage_logs" ADD CONSTRAINT "equipment_usage_logs_equipment_id_fkey" FOREIGN KEY ("equipment_id") REFERENCES "equipment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipment_inspection_logs" ADD CONSTRAINT "equipment_inspection_logs_equipment_id_fkey" FOREIGN KEY ("equipment_id") REFERENCES "equipment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bot_executions" ADD CONSTRAINT "bot_executions_bot_id_fkey" FOREIGN KEY ("bot_id") REFERENCES "bots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dicom_studies" ADD CONSTRAINT "dicom_studies_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_identification_checks" ADD CONSTRAINT "patient_identification_checks_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_identification_checks" ADD CONSTRAINT "patient_identification_checks_verified_by_fkey" FOREIGN KEY ("verified_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "early_warning_scores" ADD CONSTRAINT "early_warning_scores_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "early_warning_scores" ADD CONSTRAINT "early_warning_scores_nurse_id_fkey" FOREIGN KEY ("nurse_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fall_risk_assessments" ADD CONSTRAINT "fall_risk_assessments_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "infection_surveillance" ADD CONSTRAINT "infection_surveillance_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qi_measurements" ADD CONSTRAINT "qi_measurements_indicator_id_fkey" FOREIGN KEY ("indicator_id") REFERENCES "quality_indicators"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consent_forms" ADD CONSTRAINT "consent_forms_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consent_forms" ADD CONSTRAINT "consent_forms_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "consent_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consent_forms" ADD CONSTRAINT "consent_forms_encounter_id_fkey" FOREIGN KEY ("encounter_id") REFERENCES "encounters"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consent_forms" ADD CONSTRAINT "consent_forms_surgery_id_fkey" FOREIGN KEY ("surgery_id") REFERENCES "surgeries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consent_forms" ADD CONSTRAINT "consent_forms_doctor_id_fkey" FOREIGN KEY ("doctor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consent_sign_sessions" ADD CONSTRAINT "consent_sign_sessions_consent_id_fkey" FOREIGN KEY ("consent_id") REFERENCES "consent_forms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "education_completions" ADD CONSTRAINT "education_completions_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "education_programs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "problem_lists" ADD CONSTRAINT "problem_lists_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "problem_lists" ADD CONSTRAINT "problem_lists_diagnosis_code_id_fkey" FOREIGN KEY ("diagnosis_code_id") REFERENCES "diagnosis_codes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "problem_lists" ADD CONSTRAINT "problem_lists_added_by_fkey" FOREIGN KEY ("added_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "problem_lists" ADD CONSTRAINT "problem_lists_added_encounter_id_fkey" FOREIGN KEY ("added_encounter_id") REFERENCES "encounters"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "allergies" ADD CONSTRAINT "allergies_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "allergies" ADD CONSTRAINT "allergies_recorded_by_fkey" FOREIGN KEY ("recorded_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "allergy_assessments" ADD CONSTRAINT "allergy_assessments_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "allergy_assessments" ADD CONSTRAINT "allergy_assessments_assessed_by_fkey" FOREIGN KEY ("assessed_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "isolation_precautions" ADD CONSTRAINT "isolation_precautions_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "isolation_precautions" ADD CONSTRAINT "isolation_precautions_ordered_by_fkey" FOREIGN KEY ("ordered_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discharge_summaries" ADD CONSTRAINT "discharge_summaries_admission_id_fkey" FOREIGN KEY ("admission_id") REFERENCES "admissions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discharge_summaries" ADD CONSTRAINT "discharge_summaries_doctor_id_fkey" FOREIGN KEY ("doctor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nursing_assessments" ADD CONSTRAINT "nursing_assessments_admission_id_fkey" FOREIGN KEY ("admission_id") REFERENCES "admissions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nursing_assessments" ADD CONSTRAINT "nursing_assessments_nurse_id_fkey" FOREIGN KEY ("nurse_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nursing_assessments" ADD CONSTRAINT "nursing_assessments_fall_risk_assessment_id_fkey" FOREIGN KEY ("fall_risk_assessment_id") REFERENCES "fall_risk_assessments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nursing_diagnoses" ADD CONSTRAINT "nursing_diagnoses_assessment_id_fkey" FOREIGN KEY ("assessment_id") REFERENCES "nursing_assessments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nursing_diagnoses" ADD CONSTRAINT "nursing_diagnoses_nurse_id_fkey" FOREIGN KEY ("nurse_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nursing_notes" ADD CONSTRAINT "nursing_notes_admission_id_fkey" FOREIGN KEY ("admission_id") REFERENCES "admissions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nursing_notes" ADD CONSTRAINT "nursing_notes_nurse_id_fkey" FOREIGN KEY ("nurse_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nursing_interventions" ADD CONSTRAINT "nursing_interventions_nursing_diagnosis_id_fkey" FOREIGN KEY ("nursing_diagnosis_id") REFERENCES "nursing_diagnoses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nursing_outcomes" ADD CONSTRAINT "nursing_outcomes_nursing_diagnosis_id_fkey" FOREIGN KEY ("nursing_diagnosis_id") REFERENCES "nursing_diagnoses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "intake_outputs" ADD CONSTRAINT "intake_outputs_admission_id_fkey" FOREIGN KEY ("admission_id") REFERENCES "admissions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "intake_outputs" ADD CONSTRAINT "intake_outputs_nurse_id_fkey" FOREIGN KEY ("nurse_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medication_administrations" ADD CONSTRAINT "medication_administrations_prescription_id_fkey" FOREIGN KEY ("prescription_id") REFERENCES "prescriptions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medication_administrations" ADD CONSTRAINT "medication_administrations_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medication_administrations" ADD CONSTRAINT "medication_administrations_dispensing_id_fkey" FOREIGN KEY ("dispensing_id") REFERENCES "dispensings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medication_administrations" ADD CONSTRAINT "medication_administrations_compounding_order_id_fkey" FOREIGN KEY ("compounding_order_id") REFERENCES "compounding_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medication_administrations" ADD CONSTRAINT "medication_administrations_nurse_id_fkey" FOREIGN KEY ("nurse_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medication_administrations" ADD CONSTRAINT "medication_administrations_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medication_administrations" ADD CONSTRAINT "medication_administrations_verified_by_fkey" FOREIGN KEY ("verified_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinic_schedules" ADD CONSTRAINT "clinic_schedules_doctor_id_fkey" FOREIGN KEY ("doctor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinic_closures" ADD CONSTRAINT "clinic_closures_doctor_id_fkey" FOREIGN KEY ("doctor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinic_closures" ADD CONSTRAINT "clinic_closures_substitute_id_fkey" FOREIGN KEY ("substitute_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waiting_queue" ADD CONSTRAINT "waiting_queue_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waiting_queue" ADD CONSTRAINT "waiting_queue_doctor_id_fkey" FOREIGN KEY ("doctor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "eligibility_checks" ADD CONSTRAINT "eligibility_checks_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "encounter_templates" ADD CONSTRAINT "encounter_templates_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "text_macros" ADD CONSTRAINT "text_macros_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medical_record_copies" ADD CONSTRAINT "medical_record_copies_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medical_record_copies" ADD CONSTRAINT "medical_record_copies_issued_by_fkey" FOREIGN KEY ("issued_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "break_the_glass_accesses" ADD CONSTRAINT "break_the_glass_accesses_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "break_the_glass_accesses" ADD CONSTRAINT "break_the_glass_accesses_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "break_the_glass_accesses" ADD CONSTRAINT "break_the_glass_accesses_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webauthn_credentials" ADD CONSTRAINT "webauthn_credentials_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webauthn_credentials" ADD CONSTRAINT "webauthn_credentials_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "staff_devices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app_installation_keys" ADD CONSTRAINT "app_installation_keys_staff_user_id_fkey" FOREIGN KEY ("staff_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app_installation_keys" ADD CONSTRAINT "app_installation_keys_staff_device_id_fkey" FOREIGN KEY ("staff_device_id") REFERENCES "staff_devices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app_installation_keys" ADD CONSTRAINT "app_installation_keys_patient_account_id_fkey" FOREIGN KEY ("patient_account_id") REFERENCES "patient_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_devices" ADD CONSTRAINT "staff_devices_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "terminal_registry" ADD CONSTRAINT "terminal_registry_dedicated_user_id_fkey" FOREIGN KEY ("dedicated_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_consent" ADD CONSTRAINT "staff_consent_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_calls" ADD CONSTRAINT "staff_calls_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_call_acks" ADD CONSTRAINT "staff_call_acks_call_id_fkey" FOREIGN KEY ("call_id") REFERENCES "staff_calls"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_call_acks" ADD CONSTRAINT "staff_call_acks_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_emergency_access" ADD CONSTRAINT "auth_emergency_access_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_recoveries" ADD CONSTRAINT "account_recoveries_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vip_patients" ADD CONSTRAINT "vip_patients_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vip_patients" ADD CONSTRAINT "vip_patients_designated_by_fkey" FOREIGN KEY ("designated_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "questionnaire_tokens" ADD CONSTRAINT "questionnaire_tokens_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "questionnaire_tokens" ADD CONSTRAINT "questionnaire_tokens_form_schema_id_fkey" FOREIGN KEY ("form_schema_id") REFERENCES "form_schemas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "questionnaire_tokens" ADD CONSTRAINT "questionnaire_tokens_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "form_submissions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "questionnaire_tokens" ADD CONSTRAINT "questionnaire_tokens_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinic_sync_logs" ADD CONSTRAINT "clinic_sync_logs_executed_by_fkey" FOREIGN KEY ("executed_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_sets" ADD CONSTRAINT "order_sets_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "treatment_template_items" ADD CONSTRAINT "treatment_template_items_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "treatment_schedule_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_schedule_items" ADD CONSTRAINT "patient_schedule_items_schedule_id_fkey" FOREIGN KEY ("schedule_id") REFERENCES "patient_treatment_schedules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "treatment_template_diagnoses" ADD CONSTRAINT "treatment_template_diagnoses_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "treatment_schedule_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_set_diagnoses" ADD CONSTRAINT "order_set_diagnoses_order_set_id_fkey" FOREIGN KEY ("order_set_id") REFERENCES "order_sets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "favorite_orders" ADD CONSTRAINT "favorite_orders_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "icu_admissions" ADD CONSTRAINT "icu_admissions_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "icu_admissions" ADD CONSTRAINT "icu_admissions_icu_bed_id_fkey" FOREIGN KEY ("icu_bed_id") REFERENCES "icu_beds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "icu_records" ADD CONSTRAINT "icu_records_admission_id_fkey" FOREIGN KEY ("admission_id") REFERENCES "icu_admissions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "diagnostic_tests" ADD CONSTRAINT "diagnostic_tests_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_gate_events" ADD CONSTRAINT "integration_gate_events_gate_id_fkey" FOREIGN KEY ("gate_id") REFERENCES "integration_gates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hospital_info_contents" ADD CONSTRAINT "hospital_info_contents_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hospital_info_contents" ADD CONSTRAINT "hospital_info_contents_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hospital_info_audits" ADD CONSTRAINT "hospital_info_audits_content_id_fkey" FOREIGN KEY ("content_id") REFERENCES "hospital_info_contents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hospital_info_audits" ADD CONSTRAINT "hospital_info_audits_changed_by_fkey" FOREIGN KEY ("changed_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "homepage_popups" ADD CONSTRAINT "homepage_popups_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cms_categories" ADD CONSTRAINT "cms_categories_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "cms_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cms_menus" ADD CONSTRAINT "cms_menus_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "cms_menus"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_files" ADD CONSTRAINT "media_files_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doctor_profiles" ADD CONSTRAINT "doctor_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_accounts" ADD CONSTRAINT "patient_accounts_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_consents" ADD CONSTRAINT "patient_consents_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "patient_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_devices" ADD CONSTRAINT "patient_devices_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "patient_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_families" ADD CONSTRAINT "patient_families_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_families" ADD CONSTRAINT "patient_families_linked_patient_id_fkey" FOREIGN KEY ("linked_patient_id") REFERENCES "patients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_guardians" ADD CONSTRAINT "patient_guardians_guardian_account_id_fkey" FOREIGN KEY ("guardian_account_id") REFERENCES "patient_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_guardians" ADD CONSTRAINT "patient_guardians_dependent_account_id_fkey" FOREIGN KEY ("dependent_account_id") REFERENCES "patient_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_guardians" ADD CONSTRAINT "patient_guardians_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_notifications" ADD CONSTRAINT "patient_notifications_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "patient_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_settings" ADD CONSTRAINT "notification_settings_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "patient_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_addresses" ADD CONSTRAINT "patient_addresses_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_requests" ADD CONSTRAINT "document_requests_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issuance_artifacts" ADD CONSTRAINT "issuance_artifacts_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "document_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portal_sessions" ADD CONSTRAINT "portal_sessions_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "department_form_mappings" ADD CONSTRAINT "department_form_mappings_form_schema_id_fkey" FOREIGN KEY ("form_schema_id") REFERENCES "form_schemas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pre_orders" ADD CONSTRAINT "pre_orders_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pre_orders" ADD CONSTRAINT "pre_orders_doctor_id_fkey" FOREIGN KEY ("doctor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pre_orders" ADD CONSTRAINT "pre_orders_medication_code_id_fkey" FOREIGN KEY ("medication_code_id") REFERENCES "medication_codes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pre_orders" ADD CONSTRAINT "pre_orders_procedure_code_id_fkey" FOREIGN KEY ("procedure_code_id") REFERENCES "procedure_codes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pre_orders" ADD CONSTRAINT "pre_orders_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "appointments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pre_order_revisions" ADD CONSTRAINT "pre_order_revisions_pre_order_id_fkey" FOREIGN KEY ("pre_order_id") REFERENCES "pre_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doctor_code_lists" ADD CONSTRAINT "doctor_code_lists_doctor_id_fkey" FOREIGN KEY ("doctor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doctor_prescription_sets" ADD CONSTRAINT "doctor_prescription_sets_doctor_id_fkey" FOREIGN KEY ("doctor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "triage_rules" ADD CONSTRAINT "triage_rules_symptom_id_fkey" FOREIGN KEY ("symptom_id") REFERENCES "triage_symptoms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "triage_aliases" ADD CONSTRAINT "triage_aliases_symptom_id_fkey" FOREIGN KEY ("symptom_id") REFERENCES "triage_symptoms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "charge_of_care" ADD CONSTRAINT "charge_of_care_admission_id_fkey" FOREIGN KEY ("admission_id") REFERENCES "admissions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "charge_of_care" ADD CONSTRAINT "charge_of_care_doctor_id_fkey" FOREIGN KEY ("doctor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journey_delay_acks" ADD CONSTRAINT "journey_delay_acks_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journey_delay_acks" ADD CONSTRAINT "journey_delay_acks_acked_by_fkey" FOREIGN KEY ("acked_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinical_handoffs" ADD CONSTRAINT "clinical_handoffs_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinical_handoffs" ADD CONSTRAINT "clinical_handoffs_from_doctor_id_fkey" FOREIGN KEY ("from_doctor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinical_handoffs" ADD CONSTRAINT "clinical_handoffs_to_doctor_id_fkey" FOREIGN KEY ("to_doctor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinical_handoffs" ADD CONSTRAINT "clinical_handoffs_admission_id_fkey" FOREIGN KEY ("admission_id") REFERENCES "admissions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bed_assignments" ADD CONSTRAINT "bed_assignments_admission_id_fkey" FOREIGN KEY ("admission_id") REFERENCES "admissions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bed_assignments" ADD CONSTRAINT "bed_assignments_bed_id_fkey" FOREIGN KEY ("bed_id") REFERENCES "beds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rounds" ADD CONSTRAINT "rounds_admission_id_fkey" FOREIGN KEY ("admission_id") REFERENCES "admissions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rounds" ADD CONSTRAINT "rounds_doctor_id_fkey" FOREIGN KEY ("doctor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_journey_events" ADD CONSTRAINT "patient_journey_events_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "space_nodes" ADD CONSTRAINT "space_nodes_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "space_nodes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_messages" ADD CONSTRAINT "patient_messages_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_messages" ADD CONSTRAINT "patient_messages_doctor_id_fkey" FOREIGN KEY ("doctor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "health_memos" ADD CONSTRAINT "health_memos_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "satisfaction_surveys" ADD CONSTRAINT "satisfaction_surveys_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vaccinations" ADD CONSTRAINT "vaccinations_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dental_recalls" ADD CONSTRAINT "dental_recalls_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dental_recalls" ADD CONSTRAINT "dental_recalls_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chart_template_versions" ADD CONSTRAINT "chart_template_versions_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "chart_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ortho_exams" ADD CONSTRAINT "ortho_exams_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ortho_exams" ADD CONSTRAINT "ortho_exams_examined_by_fkey" FOREIGN KEY ("examined_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "obgyn_exams" ADD CONSTRAINT "obgyn_exams_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "obgyn_exams" ADD CONSTRAINT "obgyn_exams_examined_by_fkey" FOREIGN KEY ("examined_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "newborn_records" ADD CONSTRAINT "newborn_records_delivery_id_fkey" FOREIGN KEY ("delivery_id") REFERENCES "delivery_records"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "labor_progress_records" ADD CONSTRAINT "labor_progress_records_delivery_id_fkey" FOREIGN KEY ("delivery_id") REFERENCES "delivery_records"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pediatric_growths" ADD CONSTRAINT "pediatric_growths_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pediatric_growths" ADD CONSTRAINT "pediatric_growths_measured_by_fkey" FOREIGN KEY ("measured_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pediatric_immunizations" ADD CONSTRAINT "pediatric_immunizations_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pediatric_immunizations" ADD CONSTRAINT "pediatric_immunizations_given_by_fkey" FOREIGN KEY ("given_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "developmental_assessments" ADD CONSTRAINT "developmental_assessments_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "developmental_assessments" ADD CONSTRAINT "developmental_assessments_assessed_by_fkey" FOREIGN KEY ("assessed_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "psychiatric_admissions" ADD CONSTRAINT "psychiatric_admissions_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "psychiatric_admissions" ADD CONSTRAINT "psychiatric_admissions_recorded_by_fkey" FOREIGN KEY ("recorded_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "psych_seclusion_monitorings" ADD CONSTRAINT "psych_seclusion_monitorings_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "psych_seclusion_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "psych_seclusion_extensions" ADD CONSTRAINT "psych_seclusion_extensions_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "psych_seclusion_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "psych_exams" ADD CONSTRAINT "psych_exams_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "psych_exams" ADD CONSTRAINT "psych_exams_examined_by_fkey" FOREIGN KEY ("examined_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "neuro_exams" ADD CONSTRAINT "neuro_exams_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "neuro_exams" ADD CONSTRAINT "neuro_exams_examined_by_fkey" FOREIGN KEY ("examined_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "urology_exams" ADD CONSTRAINT "urology_exams_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "urology_exams" ADD CONSTRAINT "urology_exams_examined_by_fkey" FOREIGN KEY ("examined_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "urology_procedures" ADD CONSTRAINT "urology_procedures_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "urology_procedures" ADD CONSTRAINT "urology_procedures_performed_by_fkey" FOREIGN KEY ("performed_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plastic_exams" ADD CONSTRAINT "plastic_exams_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plastic_exams" ADD CONSTRAINT "plastic_exams_examined_by_fkey" FOREIGN KEY ("examined_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "internal_medicine_exams" ADD CONSTRAINT "internal_medicine_exams_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "internal_medicine_exams" ADD CONSTRAINT "internal_medicine_exams_examined_by_fkey" FOREIGN KEY ("examined_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "surgery_op_notes" ADD CONSTRAINT "surgery_op_notes_surgery_id_fkey" FOREIGN KEY ("surgery_id") REFERENCES "surgeries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "surgery_op_notes" ADD CONSTRAINT "surgery_op_notes_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "burn_assessments" ADD CONSTRAINT "burn_assessments_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "burn_assessments" ADD CONSTRAINT "burn_assessments_assessed_by_fkey" FOREIGN KEY ("assessed_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "care_teams" ADD CONSTRAINT "care_teams_doctor_id_fkey" FOREIGN KEY ("doctor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "care_teams" ADD CONSTRAINT "care_teams_nurse_id_fkey" FOREIGN KEY ("nurse_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nurse_patient_assignments" ADD CONSTRAINT "nurse_patient_assignments_nurse_id_fkey" FOREIGN KEY ("nurse_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nurse_patient_assignments" ADD CONSTRAINT "nurse_patient_assignments_admission_id_fkey" FOREIGN KEY ("admission_id") REFERENCES "admissions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nurse_tasks" ADD CONSTRAINT "nurse_tasks_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pre_visit_vitals" ADD CONSTRAINT "pre_visit_vitals_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blockchain_certificates" ADD CONSTRAINT "blockchain_certificates_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blockchain_certificates" ADD CONSTRAINT "blockchain_certificates_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blockchain_certificates" ADD CONSTRAINT "blockchain_certificates_previous_cert_id_fkey" FOREIGN KEY ("previous_cert_id") REFERENCES "blockchain_certificates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "signed_documents" ADD CONSTRAINT "signed_documents_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_signatures" ADD CONSTRAINT "document_signatures_signed_document_id_fkey" FOREIGN KEY ("signed_document_id") REFERENCES "signed_documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_signatures" ADD CONSTRAINT "document_signatures_certificate_id_fkey" FOREIGN KEY ("certificate_id") REFERENCES "blockchain_certificates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_signatures" ADD CONSTRAINT "document_signatures_signer_user_id_fkey" FOREIGN KEY ("signer_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_signatures" ADD CONSTRAINT "document_signatures_signer_patient_id_fkey" FOREIGN KEY ("signer_patient_id") REFERENCES "patients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pathology_specimens" ADD CONSTRAINT "pathology_specimens_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pathology_specimens" ADD CONSTRAINT "pathology_specimens_collected_by_fkey" FOREIGN KEY ("collected_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pathology_processing_steps" ADD CONSTRAINT "pathology_processing_steps_specimen_id_fkey" FOREIGN KEY ("specimen_id") REFERENCES "pathology_specimens"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pathology_reports" ADD CONSTRAINT "pathology_reports_specimen_id_fkey" FOREIGN KEY ("specimen_id") REFERENCES "pathology_specimens"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pathology_reports" ADD CONSTRAINT "pathology_reports_reported_by_fkey" FOREIGN KEY ("reported_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pathology_reports" ADD CONSTRAINT "pathology_reports_signed_by_fkey" FOREIGN KEY ("signed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hira_claim_documents" ADD CONSTRAINT "hira_claim_documents_claim_id_fkey" FOREIGN KEY ("claim_id") REFERENCES "claims"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hira_claim_documents" ADD CONSTRAINT "hira_claim_documents_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hira_claim_documents" ADD CONSTRAINT "hira_claim_documents_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "controlled_substance_logs" ADD CONSTRAINT "controlled_substance_logs_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "controlled_substance_logs" ADD CONSTRAINT "controlled_substance_logs_prescribed_by_fkey" FOREIGN KEY ("prescribed_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "controlled_substance_stock_txns" ADD CONSTRAINT "controlled_substance_stock_txns_stock_id_fkey" FOREIGN KEY ("stock_id") REFERENCES "controlled_substance_stocks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "controlled_substance_incidents" ADD CONSTRAINT "controlled_substance_incidents_reported_by_fkey" FOREIGN KEY ("reported_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compounding_orders" ADD CONSTRAINT "compounding_orders_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compounding_components" ADD CONSTRAINT "compounding_components_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "compounding_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "risk_reassessment_schedules" ADD CONSTRAINT "risk_reassessment_schedules_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "universal_nursing_notes" ADD CONSTRAINT "universal_nursing_notes_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "universal_nursing_notes" ADD CONSTRAINT "universal_nursing_notes_nurse_id_fkey" FOREIGN KEY ("nurse_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "restraint_monitorings" ADD CONSTRAINT "restraint_monitorings_restraint_id_fkey" FOREIGN KEY ("restraint_id") REFERENCES "restraint_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "committee_members" ADD CONSTRAINT "committee_members_committee_id_fkey" FOREIGN KEY ("committee_id") REFERENCES "committees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "committee_members" ADD CONSTRAINT "committee_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "committee_meetings" ADD CONSTRAINT "committee_meetings_committee_id_fkey" FOREIGN KEY ("committee_id") REFERENCES "committees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "institutional_policies" ADD CONSTRAINT "institutional_policies_committee_id_fkey" FOREIGN KEY ("committee_id") REFERENCES "committees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "committee_agendas" ADD CONSTRAINT "committee_agendas_committee_id_fkey" FOREIGN KEY ("committee_id") REFERENCES "committees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "committee_decisions" ADD CONSTRAINT "committee_decisions_committee_id_fkey" FOREIGN KEY ("committee_id") REFERENCES "committees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "committee_decisions" ADD CONSTRAINT "committee_decisions_agenda_id_fkey" FOREIGN KEY ("agenda_id") REFERENCES "committee_agendas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "decision_actions" ADD CONSTRAINT "decision_actions_decision_id_fkey" FOREIGN KEY ("decision_id") REFERENCES "committee_decisions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "decision_pathway_steps" ADD CONSTRAINT "decision_pathway_steps_pathway_id_fkey" FOREIGN KEY ("pathway_id") REFERENCES "decision_pathways"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "decision_pathway_instances" ADD CONSTRAINT "decision_pathway_instances_pathway_id_fkey" FOREIGN KEY ("pathway_id") REFERENCES "decision_pathways"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "decision_pathway_step_states" ADD CONSTRAINT "decision_pathway_step_states_instance_id_fkey" FOREIGN KEY ("instance_id") REFERENCES "decision_pathway_instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_flags" ADD CONSTRAINT "patient_flags_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "peripheral_devices" ADD CONSTRAINT "peripheral_devices_workstation_profile_id_fkey" FOREIGN KEY ("workstation_profile_id") REFERENCES "workstation_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "therapy_orders" ADD CONSTRAINT "therapy_orders_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "therapy_orders" ADD CONSTRAINT "therapy_orders_therapist_id_fkey" FOREIGN KEY ("therapist_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ck_questionnaires" ADD CONSTRAINT "ck_questionnaires_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "checkup_programs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ck_questionnaire_responses" ADD CONSTRAINT "ck_questionnaire_responses_questionnaire_id_fkey" FOREIGN KEY ("questionnaire_id") REFERENCES "ck_questionnaires"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ck_questionnaire_responses" ADD CONSTRAINT "ck_questionnaire_responses_visit_id_fkey" FOREIGN KEY ("visit_id") REFERENCES "checkup_visits"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ck_questionnaire_responses" ADD CONSTRAINT "ck_questionnaire_responses_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ck_station_logs" ADD CONSTRAINT "ck_station_logs_visit_id_fkey" FOREIGN KEY ("visit_id") REFERENCES "checkup_visits"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ck_station_logs" ADD CONSTRAINT "ck_station_logs_station_id_fkey" FOREIGN KEY ("station_id") REFERENCES "ck_stations"("station_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ck_station_logs" ADD CONSTRAINT "ck_station_logs_operator_id_fkey" FOREIGN KEY ("operator_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checkup_visits" ADD CONSTRAINT "checkup_visits_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checkup_visits" ADD CONSTRAINT "checkup_visits_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "checkup_programs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checkup_visits" ADD CONSTRAINT "checkup_visits_encounter_id_fkey" FOREIGN KEY ("encounter_id") REFERENCES "encounters"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checkup_visits" ADD CONSTRAINT "checkup_visits_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "ck_contracts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checkup_result_items" ADD CONSTRAINT "checkup_result_items_visit_id_fkey" FOREIGN KEY ("visit_id") REFERENCES "checkup_visits"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checkup_summaries" ADD CONSTRAINT "checkup_summaries_visit_id_fkey" FOREIGN KEY ("visit_id") REFERENCES "checkup_visits"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checkup_summaries" ADD CONSTRAINT "checkup_summaries_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ck_interpretations" ADD CONSTRAINT "ck_interpretations_visit_id_fkey" FOREIGN KEY ("visit_id") REFERENCES "checkup_visits"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ck_interpretations" ADD CONSTRAINT "ck_interpretations_result_item_id_fkey" FOREIGN KEY ("result_item_id") REFERENCES "checkup_result_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ck_interpretations" ADD CONSTRAINT "ck_interpretations_interpreted_by_fkey" FOREIGN KEY ("interpreted_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ck_judgment_rules" ADD CONSTRAINT "ck_judgment_rules_protocol_id_fkey" FOREIGN KEY ("protocol_id") REFERENCES "ck_protocols"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ck_referrals" ADD CONSTRAINT "ck_referrals_visit_id_fkey" FOREIGN KEY ("visit_id") REFERENCES "checkup_visits"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ck_follow_ups" ADD CONSTRAINT "ck_follow_ups_visit_id_fkey" FOREIGN KEY ("visit_id") REFERENCES "checkup_visits"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ck_follow_ups" ADD CONSTRAINT "ck_follow_ups_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ck_contracts" ADD CONSTRAINT "ck_contracts_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "checkup_programs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pathway_milestones" ADD CONSTRAINT "pathway_milestones_pathway_id_fkey" FOREIGN KEY ("pathway_id") REFERENCES "clinical_pathways"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pathway_assignments" ADD CONSTRAINT "pathway_assignments_pathway_id_fkey" FOREIGN KEY ("pathway_id") REFERENCES "clinical_pathways"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pathway_assignments" ADD CONSTRAINT "pathway_assignments_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "milestone_outcomes" ADD CONSTRAINT "milestone_outcomes_assignment_id_fkey" FOREIGN KEY ("assignment_id") REFERENCES "pathway_assignments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "milestone_outcomes" ADD CONSTRAINT "milestone_outcomes_milestone_id_fkey" FOREIGN KEY ("milestone_id") REFERENCES "pathway_milestones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mdt_cases" ADD CONSTRAINT "mdt_cases_conference_id_fkey" FOREIGN KEY ("conference_id") REFERENCES "mdt_conferences"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mdt_cases" ADD CONSTRAINT "mdt_cases_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mdt_attendees" ADD CONSTRAINT "mdt_attendees_conference_id_fkey" FOREIGN KEY ("conference_id") REFERENCES "mdt_conferences"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cancer_registries" ADD CONSTRAINT "cancer_registries_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cancer_treatments" ADD CONSTRAINT "cancer_treatments_registry_id_fkey" FOREIGN KEY ("registry_id") REFERENCES "cancer_registries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cancer_follow_ups" ADD CONSTRAINT "cancer_follow_ups_registry_id_fkey" FOREIGN KEY ("registry_id") REFERENCES "cancer_registries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "research_subjects" ADD CONSTRAINT "research_subjects_study_id_fkey" FOREIGN KEY ("study_id") REFERENCES "research_studies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "research_subjects" ADD CONSTRAINT "research_subjects_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "research_documents" ADD CONSTRAINT "research_documents_study_id_fkey" FOREIGN KEY ("study_id") REFERENCES "research_studies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "irb_amendments" ADD CONSTRAINT "irb_amendments_study_id_fkey" FOREIGN KEY ("study_id") REFERENCES "research_studies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cost_allocations" ADD CONSTRAINT "cost_allocations_cost_center_id_fkey" FOREIGN KEY ("cost_center_id") REFERENCES "cost_centers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flow_sheet_entries" ADD CONSTRAINT "flow_sheet_entries_admission_id_fkey" FOREIGN KEY ("admission_id") REFERENCES "admissions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flow_sheet_entries" ADD CONSTRAINT "flow_sheet_entries_nurse_id_fkey" FOREIGN KEY ("nurse_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nursing_checklists" ADD CONSTRAINT "nursing_checklists_admission_id_fkey" FOREIGN KEY ("admission_id") REFERENCES "admissions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nursing_checklists" ADD CONSTRAINT "nursing_checklists_nurse_id_fkey" FOREIGN KEY ("nurse_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfer_records" ADD CONSTRAINT "transfer_records_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfer_records" ADD CONSTRAINT "transfer_records_from_org_id_fkey" FOREIGN KEY ("from_org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfer_records" ADD CONSTRAINT "transfer_records_to_org_id_fkey" FOREIGN KEY ("to_org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hie_exchanges" ADD CONSTRAINT "hie_exchanges_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hie_exchanges" ADD CONSTRAINT "hie_exchanges_target_org_id_fkey" FOREIGN KEY ("target_org_id") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hie_exchanges" ADD CONSTRAINT "hie_exchanges_source_org_id_fkey" FOREIGN KEY ("source_org_id") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_campaigns" ADD CONSTRAINT "crm_campaigns_segment_id_fkey" FOREIGN KEY ("segment_id") REFERENCES "crm_segments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_campaigns" ADD CONSTRAINT "crm_campaigns_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "crm_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_campaigns" ADD CONSTRAINT "crm_campaigns_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_campaign_logs" ADD CONSTRAINT "crm_campaign_logs_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "crm_campaigns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_campaign_logs" ADD CONSTRAINT "crm_campaign_logs_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_communication_logs" ADD CONSTRAINT "patient_communication_logs_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_consents_crm" ADD CONSTRAINT "patient_consents_crm_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_foreign_patient_cases" ADD CONSTRAINT "crm_foreign_patient_cases_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_foreign_patient_cases" ADD CONSTRAINT "crm_foreign_patient_cases_assigned_to_fkey" FOREIGN KEY ("assigned_to") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_portal_banners" ADD CONSTRAINT "crm_portal_banners_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registration_consents" ADD CONSTRAINT "registration_consents_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "remote_consultations" ADD CONSTRAINT "remote_consultations_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "remote_consultations" ADD CONSTRAINT "remote_consultations_doctor_id_fkey" FOREIGN KEY ("doctor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consultation_messages" ADD CONSTRAINT "consultation_messages_consultation_id_fkey" FOREIGN KEY ("consultation_id") REFERENCES "remote_consultations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "onboarding_sends" ADD CONSTRAINT "onboarding_sends_invite_id_fkey" FOREIGN KEY ("invite_id") REFERENCES "onboarding_invites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "onboarding_documents" ADD CONSTRAINT "onboarding_documents_invite_id_fkey" FOREIGN KEY ("invite_id") REFERENCES "onboarding_invites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "onboarding_profiles" ADD CONSTRAINT "onboarding_profiles_invite_id_fkey" FOREIGN KEY ("invite_id") REFERENCES "onboarding_invites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "onboarding_contracts" ADD CONSTRAINT "onboarding_contracts_invite_id_fkey" FOREIGN KEY ("invite_id") REFERENCES "onboarding_invites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checkup_vouchers" ADD CONSTRAINT "checkup_vouchers_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "voucher_batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "voucher_events" ADD CONSTRAINT "voucher_events_voucher_id_fkey" FOREIGN KEY ("voucher_id") REFERENCES "checkup_vouchers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "voucher_redemptions" ADD CONSTRAINT "voucher_redemptions_voucher_id_fkey" FOREIGN KEY ("voucher_id") REFERENCES "checkup_vouchers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_payments" ADD CONSTRAINT "billing_payments_billing_id_fkey" FOREIGN KEY ("billing_id") REFERENCES "billings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "voucher_distributor_accounts" ADD CONSTRAINT "voucher_distributor_accounts_distributor_id_fkey" FOREIGN KEY ("distributor_id") REFERENCES "voucher_distributors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "voucher_allocations" ADD CONSTRAINT "voucher_allocations_to_distributor_id_fkey" FOREIGN KEY ("to_distributor_id") REFERENCES "voucher_distributors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "voucher_sales" ADD CONSTRAINT "voucher_sales_distributor_id_fkey" FOREIGN KEY ("distributor_id") REFERENCES "voucher_distributors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "protocol_steps" ADD CONSTRAINT "protocol_steps_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "protocol_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "protocol_instances" ADD CONSTRAINT "protocol_instances_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "protocol_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "protocol_step_states" ADD CONSTRAINT "protocol_step_states_instance_id_fkey" FOREIGN KEY ("instance_id") REFERENCES "protocol_instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chemo_regimen_drugs" ADD CONSTRAINT "chemo_regimen_drugs_regimen_id_fkey" FOREIGN KEY ("regimen_id") REFERENCES "chemo_regimens"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chemo_courses" ADD CONSTRAINT "chemo_courses_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chemo_courses" ADD CONSTRAINT "chemo_courses_regimen_id_fkey" FOREIGN KEY ("regimen_id") REFERENCES "chemo_regimens"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chemo_cycles" ADD CONSTRAINT "chemo_cycles_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "chemo_courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "voc_tickets" ADD CONSTRAINT "voc_tickets_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "voc_messages" ADD CONSTRAINT "voc_messages_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "voc_tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "voc_attachments" ADD CONSTRAINT "voc_attachments_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "voc_tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "go_live_approvals" ADD CONSTRAINT "go_live_approvals_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "go_live_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "voice_command_logs" ADD CONSTRAINT "voice_command_logs_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "voice_command_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_proposal_transitions" ADD CONSTRAINT "ai_proposal_transitions_proposal_id_fkey" FOREIGN KEY ("proposal_id") REFERENCES "ai_proposals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "translation_override_transitions" ADD CONSTRAINT "translation_override_transitions_override_id_fkey" FOREIGN KEY ("override_id") REFERENCES "translation_overrides"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

