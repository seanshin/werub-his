import { Module } from '@nestjs/common';
import { QualityModule } from '../quality/quality.module';
import { OrderGovernanceModule } from '../order-governance/order-governance.module';
import { CpoeAgendaService } from './cpoe-agenda.service';
import { CpoeQualityController } from './cpoe-quality.controller';
import { CpoeQualityService } from './cpoe-quality.service';
import { CpoeImprovementService } from './cpoe-improvement.service';

/** 잎 모듈 — 처방·오더 원장을 읽고 질 지표 원장(QualityService)에 기록한다 */
@Module({
  imports: [QualityModule, OrderGovernanceModule],
  controllers: [CpoeQualityController],
  providers: [CpoeQualityService, CpoeImprovementService, CpoeAgendaService],
  // 질관리 월 마감(quality-flow)이 CPOE 지표도 같은 날 기록한다
  exports: [CpoeQualityService],
})
export class CpoeQualityModule {}
