import { Module } from '@nestjs/common';
import { ConfigRuntimeModule } from '../config/config-runtime.module';
import { FormularyModule } from '../formulary/formulary.module';
import { OrderGovernanceModule } from '../order-governance/order-governance.module';
import { CatalogAgendaService } from './catalog-agenda.service';
import { ClinicalRulesController } from './clinical-rules.controller';
import { ClinicalRulesLedgerService } from './clinical-rules-ledger.service';

/** 임상 규칙 대장(2026-10-21 임상 규칙·템플릿 P4) — 읽기 전용 집계 · P5 B4 카탈로그 변경 → 위원회 안건(잎 모듈 — 아무도 import 하지 않는다) */
@Module({
  imports: [ConfigRuntimeModule, FormularyModule, OrderGovernanceModule],
  controllers: [ClinicalRulesController],
  providers: [ClinicalRulesLedgerService, CatalogAgendaService],
})
export class ClinicalRulesModule {}
