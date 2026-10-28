import { Module } from '@nestjs/common';
import { PatientSafetyController } from './patient-safety.controller';
import { PatientSafetyService } from './patient-safety.service';
import { ConfigRuntimeModule } from '../config/config-runtime.module';
@Module({ imports: [ConfigRuntimeModule], controllers: [PatientSafetyController], providers: [PatientSafetyService], exports: [PatientSafetyService] })
export class PatientSafetyModule {}
