import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { DocumentModule } from '../document/document.module';
import { DecisionModule } from '../decision-registry/decision.module';
import { GoLiveModule } from '../go-live/go-live.module';
import { DutyScheduleModule } from '../duty-schedule/duty-schedule.module';
import { PrintIssuanceController } from './print-issuance.controller';
import { PrintIssuanceService } from './print-issuance.service';

@Module({
  imports: [AuditModule, DocumentModule, DecisionModule, GoLiveModule, DutyScheduleModule],
  controllers: [PrintIssuanceController],
  providers: [PrintIssuanceService],
})
export class PrintIssuanceModule {}
