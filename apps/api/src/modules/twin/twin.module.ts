import { Module } from '@nestjs/common';
import { TwinController } from './twin.controller';
import { FhirWritebackController } from './fhir-writeback.controller';
import { AuditModule } from '../audit/audit.module';
import { SmartAuthModule } from '../smart-auth/smart-auth.module';

@Module({
  imports: [AuditModule, SmartAuthModule],
  controllers: [TwinController, FhirWritebackController],
})
export class TwinModule {}
