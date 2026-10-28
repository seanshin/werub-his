import { Module } from '@nestjs/common';
import { ConsentController, PatientConsentController } from './consent.controller';
import { ConsentSignController } from './consent-sign.controller';
import { ConsentDevicesController } from './consent-devices.controller';
import { ConsentDevicePublicController } from './consent-device-public.controller';
import { ConsentService } from './consent.service';
import { ConsentDeviceService } from './consent-device.service';
import { MedicalRecordCopyModule } from '../medical-record-copy/medical-record-copy.module';
import { MedicalAiModule } from '../medical-ai/medical-ai.module';
import { ConsentDeviceStreamGuard } from './consent-device-stream.guard';
import { AiProposalModule } from '../ai-proposal/ai-proposal.module';
import { RegistrationConsentModule } from '../registration-consent/registration-consent.module';
import { RegistrationConsentCollectController, RegistrationConsentUnappliedController } from './registration-consent-collect.controller';
import { RegistrationConsentCollectService } from './registration-consent-collect.service';

@Module({
  imports: [MedicalRecordCopyModule, MedicalAiModule,
    AiProposalModule, // 동의서 AI 초안 제안 원장(기획서 §2.1)
    RegistrationConsentModule, // 초진 동의 묶음 서명 → 등록 동의 원장(2026-10-02)
],
  controllers: [ConsentController, PatientConsentController, ConsentSignController, ConsentDevicesController, ConsentDevicePublicController, RegistrationConsentCollectController, RegistrationConsentUnappliedController],
  providers: [ConsentDeviceStreamGuard, ConsentService, ConsentDeviceService, RegistrationConsentCollectService],
  exports: [ConsentService],
})
export class ConsentModule {}
