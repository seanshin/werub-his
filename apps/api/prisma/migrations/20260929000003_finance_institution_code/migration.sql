-- DropIndex
DROP INDEX "finance_disclosures_fiscal_year_institution_name_key";

-- AlterTable
ALTER TABLE "finance_disclosures" ADD COLUMN     "institution_code" VARCHAR(20);

-- CreateIndex
CREATE INDEX "finance_disclosures_fiscal_year_institution_name_idx" ON "finance_disclosures"("fiscal_year", "institution_name");

-- CreateIndex
CREATE INDEX "finance_disclosures_institution_code_idx" ON "finance_disclosures"("institution_code");

-- CreateIndex
CREATE UNIQUE INDEX "finance_disclosures_fiscal_year_institution_code_key" ON "finance_disclosures"("fiscal_year", "institution_code");

