import { Module } from '@nestjs/common';
import { ClinicalChartResultController } from './clinical-chart-result.controller';
import { ClinicalChartResultService } from './clinical-chart-result.service';

@Module({
  controllers: [ClinicalChartResultController],
  providers: [ClinicalChartResultService],
})
export class ClinicalChartResultModule {}
