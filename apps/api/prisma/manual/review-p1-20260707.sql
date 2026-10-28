-- 전체 검토 P1 후속 데이터 정리 (2026-07-07) — 멱등, deploy.sh --schema 후 수동 적용
-- 적용: docker exec docker-postgres-1 psql -U hospital -d hospitalrun -f <this>

BEGIN;

-- ── 1. 포뮬러리 중복 방지 인덱스 보강 ─────────────────────────────
-- 기존 formulary_items_uniq는 NULLS DISTINCT라 (code_id|preset_key 한쪽 null) 행의
-- 중복을 못 막음(서비스 add()의 findUnique null 실패와 결합해 중복 행 발생 가능했음).
-- coalesce 표현식 인덱스로 null 포함 중복을 DB 레벨에서 차단. (2026-07-07 운영 중복 0건 확인)
CREATE UNIQUE INDEX IF NOT EXISTS formulary_items_uniq_nn
  ON formulary_items (domain, code_type, coalesce(code_id::text, '-'), coalesce(preset_key, '-'));

-- ── 2. 약가마스터 8자리 유령 행 정리 ──────────────────────────────
-- 배경: 표준코드 CSV 임포트 시 선행 0 소실로 8자리 코드 행 생성(가격 없음),
--       약가 SQL이 정확일치 실패로 9자리 행을 신규 삽입(가격 보유·HIRA식 명칭).
--       → 동일 약이 검색에 이중 노출 (2026-07-07 운영 1,157쌍 확인, 8자리 행 처방 참조 0건)
-- 2-1. 9자리(가격) 행에 8자리(마스터) 행의 메타데이터 보강 — null인 필드만
UPDATE medication_codes b
SET ingredient      = coalesce(b.ingredient, a.ingredient),
    ingredient_code = coalesce(b.ingredient_code, a.ingredient_code)
FROM medication_codes a
WHERE b.code = lpad(a.code, 9, '0') AND a.code <> b.code AND length(a.code) = 8;

-- 2-2. 8자리 쌍둥이 행 비활성화 (참조 0건 확인 — 삭제 대신 비활성화로 보수적 처리)
UPDATE medication_codes a
SET is_active = false
WHERE length(a.code) = 8
  AND a.is_active = true
  AND EXISTS (SELECT 1 FROM medication_codes b WHERE b.code = lpad(a.code, 9, '0'));

-- ── 2.5 진료 첨부(PHI) URL 전환 ──────────────────────────────────
-- 배경: /uploads 정적 경로(무인증·nginx 공개 캐시 30d)로 서빙되던 진료 첨부를
--       HMAC 토큰 스트리밍 EP로 전환 — DB url을 정본 API 경로로 재작성.
-- ⚠️ 배포 시 서버에서 파일 이동 필수(이동해야 공개 서빙이 닫힘):
--    cd /home/deploy/hospital-run/apps/api
--    mkdir -p storage/encounter-attachments
--    [ -d uploads/encounters ] && mv uploads/encounters/* storage/encounter-attachments/ 2>/dev/null; rmdir uploads/encounters 2>/dev/null
--    (nginx /uploads/ 캐시에 최대 30일 잔존 가능 — proxy_cache 디렉터리 purge 권장)
UPDATE encounter_attachments
SET url = regexp_replace(url, '^/uploads/encounters/([0-9a-fA-F-]+)/(.+)$', '/api/v1/encounters/\1/attachments/file/\2')
WHERE url LIKE '/uploads/encounters/%';

-- ── 3. 처방 오더 부서 오염 백필 ──────────────────────────────────
-- 배경: prescription.service 인라인 매핑이 MEDICATION/LAB 외 전부 IMAGING으로 생성
--       (정본 TYPE_TO_DEPARTMENT: THERAPY→THERAPY, DIET/ACTIVITY/NURSING→PHARMACY)
-- 완료/취소된 오더는 건드리지 않음 — 진행 전 단계만 재배정
UPDATE orders o
SET department = CASE p.type
                   WHEN 'THERAPY' THEN 'THERAPY'::"OrderDepartment"
                   ELSE 'PHARMACY'::"OrderDepartment"
                 END
FROM prescriptions p
WHERE o.prescription_id = p.id
  AND o.department = 'IMAGING'
  AND p.type IN ('THERAPY', 'DIET', 'ACTIVITY', 'NURSING')
  AND o.status IN ('ORDERED', 'RECEIVED');

COMMIT;
