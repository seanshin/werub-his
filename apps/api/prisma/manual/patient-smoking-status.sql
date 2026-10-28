-- #7 흡연상태(사회력) — CVD 위험엔진(PCE·PREVENT·K-CVD) 입력 + FHIR Observation(LOINC 72166-2).
-- db push 미실행 → 수동 적용(비파괴 ADD COLUMN).
ALTER TABLE patients ADD COLUMN IF NOT EXISTS smoking_status varchar(12);
