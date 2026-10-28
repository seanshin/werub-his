-- 경영성과 벤치마크(의료기관 회계정보공시 손익) — 테이블 2 추가. 기존 테이블·행 무변경.

-- CreateTable
CREATE TABLE "finance_disclosures" (
    "id" UUID NOT NULL,
    "fiscal_year" INTEGER NOT NULL,
    "institution_name" VARCHAR(200) NOT NULL,
    "beds" INTEGER,
    "hospital_type" VARCHAR(30),
    "founding_type" VARCHAR(30),
    "address" VARCHAR(300),
    "sido" VARCHAR(30),
    "sigungu" VARCHAR(50),
    "lat" DECIMAL(10,7),
    "lng" DECIMAL(10,7),
    "accounts" JSONB NOT NULL,
    "import_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "finance_disclosures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finance_disclosure_imports" (
    "id" UUID NOT NULL,
    "file_name" VARCHAR(200) NOT NULL,
    "source_note" VARCHAR(300),
    "total_rows" INTEGER NOT NULL,
    "created" INTEGER NOT NULL,
    "updated" INTEGER NOT NULL,
    "rejected" INTEGER NOT NULL,
    "rejects" JSONB NOT NULL,
    "imported_by_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "finance_disclosure_imports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "finance_disclosures_fiscal_year_hospital_type_idx" ON "finance_disclosures"("fiscal_year", "hospital_type");

-- CreateIndex
CREATE UNIQUE INDEX "finance_disclosures_fiscal_year_institution_name_key" ON "finance_disclosures"("fiscal_year", "institution_name");

