import { Module } from '@nestjs/common';
import { ChartTemplateController } from './chart-template.controller';
import { ChartTemplateService } from './chart-template.service';

@Module({
  
  controllers: [ChartTemplateController],
  providers: [ChartTemplateService],
  exports: [ChartTemplateService],
})
export class ChartTemplateModule {}
