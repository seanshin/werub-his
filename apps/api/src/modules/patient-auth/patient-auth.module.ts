import { Module, forwardRef } from '@nestjs/common';
import { PatientAuthController, PatientAccountAdminController } from './patient-auth.controller';
import { PatientProfileController } from './patient-profile.controller';
import { PatientAuthService } from './patient-auth.service';
import { EncryptionService } from './services/encryption.service';
import { SmsOtpService } from './services/sms-otp.service';
import { PatientAccountAuthGuard } from './guards/patient-account-auth.guard';
import { PortalOrPatientGuard } from './guards/portal-or-patient.guard';
import { PortalModule } from '../portal/portal.module';
// 발송 판정 정본(SENT/SIMULATED/FAILED) — W6 CRM 리마인더·W8 온보딩/문진과 같은 채널·같은 판정.
// CrmModule 은 아무 모듈도 import 하지 않으므로 순환 없음(questionnaire·onboarding 과 동일 선례).
import { CrmModule } from '../crm/crm.module';
import { MobileModule } from '../mobile/mobile.module';
import { HisModeModule } from '../../common/his-mode/his-mode.module';

@Module({
  imports: [forwardRef(() => PortalModule), CrmModule, forwardRef(() => MobileModule), HisModeModule],
  controllers: [PatientAuthController, PatientProfileController, PatientAccountAdminController],
  providers: [PatientAuthService, EncryptionService, SmsOtpService, PatientAccountAuthGuard, PortalOrPatientGuard],
  exports: [PatientAuthService, EncryptionService, SmsOtpService, PatientAccountAuthGuard, PortalOrPatientGuard],
})
export class PatientAuthModule {}
