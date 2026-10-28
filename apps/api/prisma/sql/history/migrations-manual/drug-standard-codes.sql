-- HIRA 의약품 표준코드 마스터 — 추가 전용 DDL
CREATE TABLE IF NOT EXISTS drug_standard_codes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  insurance_code  varchar(16) UNIQUE NOT NULL,
  product_name    varchar(300) NOT NULL,
  manufacturer    varchar(200),
  spec            varchar(100),
  standard_code   varchar(20),
  ingredient_code varchar(20),
  atc_code        varchar(20),
  dosage_form     varchar(40),
  rx_otc          varchar(20),
  base_code       varchar(20),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS drug_standard_codes_ingredient_idx ON drug_standard_codes(ingredient_code);
CREATE INDEX IF NOT EXISTS drug_standard_codes_atc_idx ON drug_standard_codes(atc_code);
CREATE INDEX IF NOT EXISTS drug_standard_codes_name_idx ON drug_standard_codes(product_name);
