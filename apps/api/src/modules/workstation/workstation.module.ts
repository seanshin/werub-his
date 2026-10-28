import { Module } from '@nestjs/common';
import { WorkstationController } from './workstation.controller';
import { WorkstationService } from './workstation.service';
import { PharmacyModule } from '../pharmacy/pharmacy.module';
import { ImagingModule } from '../imaging/imaging.module';
import { DiagnosticTestModule } from '../diagnostic-test/diagnostic-test.module';

@Module({
  // 약국 큐 위임 + 영상 안전게이트(ImagingSafetyService) 공유 + 기초검사 자리 큐 위임
  imports: [PharmacyModule, ImagingModule, DiagnosticTestModule],
  controllers: [WorkstationController],
  providers: [WorkstationService],
  exports: [WorkstationService],
})
export class WorkstationModule {}
