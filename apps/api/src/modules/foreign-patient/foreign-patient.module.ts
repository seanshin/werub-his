import { Module } from '@nestjs/common';
import { ForeignPatientController } from './foreign-patient.controller';
import { ForeignPatientService } from './foreign-patient.service';
import { PatientModule } from '../patient/patient.module';
import { ConfigRuntimeModule } from '../config/config-runtime.module';

@Module({
  imports: [PatientModule, ConfigRuntimeModule],
  controllers: [ForeignPatientController],
  providers: [ForeignPatientService],
  exports: [ForeignPatientService],
})
export class ForeignPatientModule {}
