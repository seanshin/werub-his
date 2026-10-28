-- integration_outbox 멱등키 (domain, ref) UNIQUE — 이중 enqueue/백필 동시성 방어
-- 적용: docker exec -i docker-postgres-1 psql -U hospital -d hospitalrun < this.sql
-- 안전: 재실행 무해(dedupe 후엔 삭제 0건, 인덱스 IF NOT EXISTS)
-- 주의: db push 차단 환경(procedure_codes 드리프트)이라 서버 직접 적용. schema.prisma 의 @@unique([domain, ref]) 와 동일.

-- 1) 기존 중복 (domain, ref) 정리 — 그룹당 1행만 유지.
--    유지 우선순위: SENT 우선(이미 ERP 발송 완료 이력 보존) → 그 다음 created_at 빠른 행.
--    삭제 대상은 동일 멱등키의 잉여 행뿐(미발송 PENDING 단일 행은 유지되어 유실 없음).
DELETE FROM integration_outbox
WHERE id IN (
  SELECT id FROM (
    SELECT id,
           row_number() OVER (
             PARTITION BY domain, ref
             ORDER BY (status = 'SENT') DESC, created_at ASC
           ) AS rn
    FROM integration_outbox
  ) t
  WHERE t.rn > 1
);

-- 2) UNIQUE 인덱스 — Prisma @@unique([domain, ref]) 기본 인덱스명과 일치(스키마↔DB 정합)
CREATE UNIQUE INDEX IF NOT EXISTS integration_outbox_domain_ref_key
  ON integration_outbox (domain, ref);
