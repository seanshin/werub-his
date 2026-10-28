import { Module } from '@nestjs/common';
import { ClinicalChartVerificationController } from './clinical-chart-verification.controller';
import { ClinicalChartVerificationService } from './clinical-chart-verification.service';

@Module({
  controllers: [ClinicalChartVerificationController],
  providers: [ClinicalChartVerificationService],
})
export class ClinicalChartVerificationModule {}
