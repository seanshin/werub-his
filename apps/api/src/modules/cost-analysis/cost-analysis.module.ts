import { Module } from '@nestjs/common';
import { CostAnalysisController } from './cost-analysis.controller';
import { CostAnalysisService } from './cost-analysis.service';

@Module({
  controllers: [CostAnalysisController],
  providers: [CostAnalysisService],
  exports: [CostAnalysisService],
})
export class CostAnalysisModule {}
