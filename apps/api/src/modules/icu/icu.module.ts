import { Module } from '@nestjs/common';
import { IcuController } from './icu.controller';
import { IcuService } from './icu.service';
import { PatientSafetyModule } from '../patient-safety/patient-safety.module';
import { VitalsIngestModule } from '../vitals/vitals-ingest.module';

@Module({
  imports: [PatientSafetyModule, VitalsIngestModule], // PatientSafetyModule: NEWS2(병동과 동일 EWS 경로) · VitalsIngestModule: 중환자 활력 쓰기 단일 진입점
  controllers: [IcuController],
  providers: [IcuService],
})
export class IcuModule {}
