import { Module } from '@nestjs/common';
import { FhirFullController } from './fhir-full.controller';
import { FhirFullService } from './fhir-full.service';
import { SmartAuthModule } from '../smart-auth/smart-auth.module';
import { ConfigRuntimeModule } from '../config/config-runtime.module';

@Module({
  // FhirDualAuthGuard 가 SmartAuthService·ConfigRuntimeService 를 주입받는다(허용 역할 설정 정본)
  imports: [SmartAuthModule, ConfigRuntimeModule],
  controllers: [FhirFullController],
  providers: [FhirFullService],
})
export class FhirFullModule {}
