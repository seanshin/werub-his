import { Module } from '@nestjs/common';
import { ConfigRuntimeModule } from '../config/config-runtime.module';
import { AuditModule } from '../audit/audit.module';
import { GldModule } from '../gld/gld.module';
import { EvidenceModule } from '../evidence/evidence.module';
import { DecisionController } from './decision.controller';
import { DecisionService } from './decision.service';
import { DecisionEngineService } from './decision-engine.service';
import { DecisionBulkService } from './decision-bulk.service';
import { DecisionPrintService } from './decision-print.service';

@Module({
  imports: [ConfigRuntimeModule, AuditModule, GldModule, EvidenceModule],
  controllers: [DecisionController],
  providers: [DecisionService, DecisionEngineService, DecisionBulkService, DecisionPrintService],
  exports: [DecisionService, DecisionEngineService, DecisionPrintService],
})
export class DecisionModule {}
