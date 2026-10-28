import { Module } from '@nestjs/common';
import { FhirController } from './fhir.controller';
import { FhirPatientMapper } from './fhir-patient.mapper';
import { PatientModule } from '../patient/patient.module';
import { SmartAuthModule } from '../smart-auth/smart-auth.module';
import { FhirLabModule } from '../fhir-lab/fhir-lab.module';
import { PreOrderModule } from '../pre-order/pre-order.module';
import { ConfigRuntimeModule } from '../config/config-runtime.module';

@Module({
  imports: [PatientModule, SmartAuthModule, FhirLabModule, PreOrderModule, ConfigRuntimeModule],
  controllers: [FhirController],
  providers: [FhirPatientMapper],
})
export class FhirModule {}
