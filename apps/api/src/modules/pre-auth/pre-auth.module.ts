import { Module, forwardRef } from '@nestjs/common';
import { PreAuthController } from './pre-auth.controller';
import { PreAuthPortalController } from './pre-auth-portal.controller';
import { PreAuthService } from './pre-auth.service';
import { ConfigRuntimeModule } from '../config/config-runtime.module';
import { PatientAuthModule } from '../patient-auth/patient-auth.module';
import { PortalModule } from '../portal/portal.module';

// 사전승인 백본. PrescriptionModule을 컴파일/모듈 레벨에서 참조하지 않는다(순환 방지 — 발행은 ModuleRef lazy resolve).
// PatientAuthModule/PortalModule(forwardRef)=포털 컨트롤러 PortalOrPatientGuard 및 그 의존(PortalService) 제공.
// 둘 다 PreAuth를 미참조하므로 순환 없음(forwardRef는 방어적). 로컬 부팅 검증 완료.
@Module({
  imports: [ConfigRuntimeModule, forwardRef(() => PatientAuthModule), forwardRef(() => PortalModule)],
  controllers: [PreAuthController, PreAuthPortalController],
  providers: [PreAuthService],
  exports: [PreAuthService],
})
export class PreAuthModule {}
