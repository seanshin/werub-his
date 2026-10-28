import { Module } from '@nestjs/common';
import { IntegrationAuthService } from './integration-auth.service';
import { ConfigRuntimeModule } from '../config/config-runtime.module';

// ERP 연동 인증(키 클래스 분리) — PII 조회 컨트롤러 모듈이 import.
@Module({
  imports: [ConfigRuntimeModule],
  providers: [IntegrationAuthService],
  exports: [IntegrationAuthService],
})
export class IntegrationAuthModule {}
