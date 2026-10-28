-- 예약관리 보완 P3a — 포털 셀프예약 위해 created_by nullable화 (2026-07-08·멱등)
-- 배포: deploy.sh --schema 가 prisma db push로 반영. 본 SQL은 기록/수동 재적용용.
-- 포털 셀프예약(bookedVia=PORTAL)은 스태프 생성자(User FK)가 없으므로 created_by NULL 허용.
ALTER TABLE appointments ALTER COLUMN created_by DROP NOT NULL;
