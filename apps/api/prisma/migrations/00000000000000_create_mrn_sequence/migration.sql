-- MRN daily sequence for concurrent-safe MRN generation
CREATE SEQUENCE IF NOT EXISTS mrn_daily_seq START 1;

-- pg_trgm extension for Korean text search on code master tables
CREATE EXTENSION IF NOT EXISTS pg_trgm;
