import { Module } from '@nestjs/common';
import { TreatmentTemplateController } from './treatment-template.controller';
import { TreatmentTemplateService } from './treatment-template.service';
import { PreOrderModule } from '../pre-order/pre-order.module';

@Module({
  imports: [PreOrderModule], // 전개 시 LAB/IMAGING → PreOrder 초안 연결
  controllers: [TreatmentTemplateController],
  providers: [TreatmentTemplateService],
  exports: [TreatmentTemplateService],
})
export class TreatmentTemplateModule {}
