-- 이연 회수 T1 — 스키마 변경 적용 SQL (2026-08-18)
--
-- 코드(schema.prisma)는 이미 반영돼 있고 `prisma generate` 도 끝났다.
-- 🔴 **운영 DB 반영은 사람 승인 사항**이다. `prisma db push --accept-data-loss` 는 이 저장소에서 금지다.
--    안전 경로: `npx prisma db push`(플래그 없이) 또는 이 SQL 을 직접 적용.
--    적용 전 백업: `./infra/scripts/deploy.sh --backup`
--
-- 무엇을 왜 바꾸는가
--  1) 의료질지표에 **방향·단위·스케일 컬럼**이 없어, 관리자가 화면에서 새 지표를 만들면
--     방향 미등재로 **측정 입력이 422 로 막혔다**(코드 등재표에만 있었다).
--  2) `qi_measurements.meet_target` 이 NOT NULL 이라 **'판정 불가'를 저장할 수 없었다** —
--     모르는 것을 달성/미달로 접도록 강요했다.
--  3) 암등록에 **KCCR 전송 근거 컬럼**이 없어 화면이 구조적으로 전송 사실을 표현할 수 없었다.
--     🔴 연동 전에는 `kccr_transmitted_at` 을 **NULL 로 둔다**(나가지 않은 전송에 시각을 박지 않는다).
--  4) 교육 이수 만료가 NOT NULL 이라 **무기한을 `9999-12-31` 로 우회**하고 있었다 — 무기한은 날짜가 없는 것이다.
--  5) 직원 니들스틱·체액노출이 **프로세스 메모리**에 있어 배포마다 소실됐다.
--     🔴 `safety_incidents`(환자안전 정본) 재사용 금지 — 재사용하면 환자안전 지표가 직원 사고로 오염된다.
--  6) 약사 **처방 중재·TDM** 이 인메모리 배열이라 재시작마다 소실됐다.
--     (ADR·ASP 는 이미 `adverse_reaction_reports`·`asp_requests` 로 영속화돼 있어 대상이 아니다)

BEGIN;

-- 1) 의료질지표 방향·단위·스케일
ALTER TABLE quality_indicators ADD COLUMN IF NOT EXISTS direction   varchar(20);
ALTER TABLE quality_indicators ADD COLUMN IF NOT EXISTS unit        varchar(20);
ALTER TABLE quality_indicators ADD COLUMN IF NOT EXISTS value_scale integer;

-- 2) 판정 불가를 저장할 수 있게
ALTER TABLE qi_measurements ALTER COLUMN meet_target DROP NOT NULL;

-- 3) KCCR 전송 근거
ALTER TABLE cancer_registries ADD COLUMN IF NOT EXISTS kccr_transmitted_at timestamptz;
ALTER TABLE cancer_registries ADD COLUMN IF NOT EXISTS kccr_submission_id  varchar(60);

-- 4) 무기한 교육 이수
ALTER TABLE education_completions ALTER COLUMN expires_at DROP NOT NULL;
-- 기존 `9999-12-31` 우회값 정리는 별도 판단(무기한 정책 확인 후):
--   UPDATE education_completions SET expires_at = NULL WHERE expires_at >= '9999-01-01';

-- 5) 직원 노출 사고
CREATE TABLE IF NOT EXISTS staff_exposure_incidents (
  id                uuid PRIMARY KEY,
  staff_id          uuid NOT NULL,
  occurred_at       timestamptz NOT NULL,
  exposure_type     varchar(30) NOT NULL,
  body_part         varchar(50),
  device_type       varchar(60),
  place             varchar(60),
  source_patient_id uuid,
  source_hbv        boolean,
  source_hcv        boolean,
  source_hiv        boolean,
  ppe_used          varchar(100),
  immediate_action  text,
  prophylaxis       text,
  follow_up_status  varchar(20) NOT NULL DEFAULT 'OPEN',
  follow_up_notes   text,
  reported_by       uuid NOT NULL,
  reported_at       timestamptz NOT NULL DEFAULT now(),
  closed_at         timestamptz
);
CREATE INDEX IF NOT EXISTS idx_staff_exposure_staff  ON staff_exposure_incidents (staff_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_staff_exposure_status ON staff_exposure_incidents (follow_up_status);

-- 6) 약사 처방 중재
CREATE TABLE IF NOT EXISTS pharmacist_interventions (
  id              uuid PRIMARY KEY,
  pharmacist_id   uuid NOT NULL,
  patient_id      uuid NOT NULL,
  prescription_id uuid,
  drug_text       varchar(200),
  type            varchar(20) NOT NULL,
  reason          text NOT NULL,
  suggestion      text NOT NULL,
  status          varchar(20) NOT NULL DEFAULT 'PENDING',
  doctor_response text,
  responded_by    uuid,
  responded_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ph_intervention_patient ON pharmacist_interventions (patient_id, created_at);
CREATE INDEX IF NOT EXISTS idx_ph_intervention_status  ON pharmacist_interventions (status);

-- 6') TDM
CREATE TABLE IF NOT EXISTS tdm_requests (
  id                    uuid PRIMARY KEY,
  patient_id            uuid NOT NULL,
  drug_name             varchar(120) NOT NULL,
  indication            varchar(200),
  target_range_min      numeric(8,2),
  target_range_max      numeric(8,2),
  target_unit           varchar(20),
  status                varchar(20) NOT NULL DEFAULT 'REQUESTED',
  result_level          numeric(8,2),
  result_interpretation text,
  dose_recommendation   text,
  requested_by          uuid NOT NULL,
  requested_at          timestamptz NOT NULL DEFAULT now(),
  sampled_at            timestamptz,
  resulted_at           timestamptz,
  reviewed_by           uuid,
  reviewed_at           timestamptz
);
CREATE INDEX IF NOT EXISTS idx_tdm_patient ON tdm_requests (patient_id, requested_at);
CREATE INDEX IF NOT EXISTS idx_tdm_status  ON tdm_requests (status);

-- 7) QI 측정 정정·무효화 (T2-14 · 2026-08-18)
--    🔴 종전엔 **오기를 고칠 방법이 없었고**, 같은 기간을 다시 넣으면 별도 행으로 쌓여
--       어느 것이 맞는지 화면도 집계도 알 수 없었다.
--    무효화는 **지우지 않는다** — QI 는 인증·대외 보고 근거라 "무엇이 있었는지"가 남아야 한다.
ALTER TABLE qi_measurements ADD COLUMN IF NOT EXISTS voided_at   timestamptz;
ALTER TABLE qi_measurements ADD COLUMN IF NOT EXISTS voided_by   uuid;
ALTER TABLE qi_measurements ADD COLUMN IF NOT EXISTS void_reason text;

-- ⚠️ 유니크 제약은 **중복이 있으면 실패한다.** 적용 전 반드시 확인:
--   SELECT indicator_id, period, count(*) FROM qi_measurements
--    GROUP BY 1,2 HAVING count(*) > 1;
--   (2026-08-18 운영 실측: 측정 300건 · 중복 0건 — 안전)
--   중복이 있으면 남길 1건을 고르고 나머지를 무효화한 뒤 제약을 건다:
--   UPDATE qi_measurements SET voided_at = now(), void_reason = '기간 중복 정리'
--    WHERE id IN (…남기지 않을 id…);
--
-- 🔴 확인을 사람 눈에만 맡기지 않는다 — 중복이 있으면 **여기서 트랜잭션 전체가 중단**된다.
--    (주석으로만 두면 건너뛸 수 있고, 그 경우 CREATE UNIQUE INDEX 가 통째로 실패해
--     앞선 ALTER 까지 함께 롤백된 사실을 놓치기 쉽다.)
DO $$
DECLARE dup_rows int; dup_sample text;
BEGIN
  SELECT count(*), COALESCE(string_agg(t.indicator_id::text || ' / ' || t.period, ', '), '')
    INTO dup_rows, dup_sample
    FROM (SELECT indicator_id, period FROM qi_measurements
           GROUP BY 1,2 HAVING count(*) > 1 LIMIT 10) t;
  IF dup_rows > 0 THEN
    RAISE EXCEPTION '중단: qi_measurements 에 (indicator_id, period) 중복이 있습니다 — 유니크 인덱스를 걸 수 없습니다. 표본: %', dup_sample
      USING HINT = '남길 1건을 고르고 나머지를 voided_at 으로 무효화(또는 삭제)한 뒤 다시 실행하십시오.';
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS qi_measurements_indicator_period_key
  ON qi_measurements (indicator_id, period);

COMMIT;

-- FK 는 이 저장소의 `chronic_observations` 선례대로 **선언하지 않는다**(Prisma 관계 미선언).
-- 참조 무결성이 필요하다고 판단되면 아래를 별도 검토 후 적용:
--   ALTER TABLE pharmacist_interventions ADD CONSTRAINT fk_ph_int_patient
--     FOREIGN KEY (patient_id) REFERENCES patients(id);
