import { Module } from '@nestjs/common';
import { VitalsIngestModule } from '../vitals/vitals-ingest.module';
import { AdmissionController } from './admission.controller';
import { AdmissionService } from './admission.service';
import { InpatientModule } from '../inpatient/inpatient.module';

@Module({
  imports: [VitalsIngestModule, InpatientModule],
  controllers: [AdmissionController],
  providers: [AdmissionService],
  exports: [AdmissionService], // 응급 경유 입원(EmergencyService)에서 정합 admit 재사용
})
export class AdmissionModule {}
