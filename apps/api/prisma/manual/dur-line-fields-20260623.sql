-- DUR 라인레벨 보강(ERP 사전심사) — 주성분코드(#2)·임신상태(#3). db push 미실행 → 수동 적용.
-- 적용: docker exec -i docker-postgres-1 psql -U hospital -d hospitalrun -f <this>
ALTER TABLE medication_codes ADD COLUMN IF NOT EXISTS ingredient_code varchar(20);
ALTER TABLE encounters ADD COLUMN IF NOT EXISTS pregnancy_status varchar(16);
