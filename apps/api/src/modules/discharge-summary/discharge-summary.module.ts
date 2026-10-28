import { Module } from '@nestjs/common';
import { DischargeSummaryController } from './discharge-summary.controller';
import { DischargeSummaryService } from './discharge-summary.service';
import { ChronicModule } from '../chronic/chronic.module';
import { ConfigRuntimeModule } from '../config/config-runtime.module';
import { DiagnosisPoaService } from './diagnosis-poa.service';

@Module({
  imports: [ChronicModule, ConfigRuntimeModule], // 퇴원요약 만성질환 경과 자동초안(P2b)
  controllers: [DischargeSummaryController],
  providers: [DischargeSummaryService, DiagnosisPoaService],
  exports: [DischargeSummaryService],
})
export class DischargeSummaryModule {}
