import { Module } from '@nestjs/common';
import { SmartAuthModule } from '../smart-auth/smart-auth.module';
import { LabModule } from '../lab/lab.module';
import { ConfigRuntimeModule } from '../config/config-runtime.module';
import { AuditModule } from '../audit/audit.module';
import { FhirLabController } from './fhir-lab.controller';
import { FhirLabIngestService } from './fhir-lab-ingest.service';

@Module({
  imports: [SmartAuthModule, LabModule, ConfigRuntimeModule, AuditModule],
  controllers: [FhirLabController],
  providers: [FhirLabIngestService],
  exports: [FhirLabIngestService], // FhirController(processBundle)에서 사용
})
export class FhirLabModule {}
