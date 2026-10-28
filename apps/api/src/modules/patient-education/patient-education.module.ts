import { Module } from '@nestjs/common';
import { PatientEducationController } from './patient-education.controller';
import { PatientEducationService } from './patient-education.service';

@Module({
  controllers: [PatientEducationController],
  providers: [PatientEducationService],
  exports: [PatientEducationService],
})
export class PatientEducationModule {}
