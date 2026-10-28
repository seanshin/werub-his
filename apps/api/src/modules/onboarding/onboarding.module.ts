import { Module } from '@nestjs/common';
import { OnboardingController } from './onboarding.controller';
import { OnboardingPublicController } from './onboarding-public.controller';
import { OnboardingWelcomeController } from './onboarding-welcome.controller';
import { OnboardingService } from './onboarding.service';
import { OnboardingTokenGuard } from './guards/onboarding-token.guard';
import { PasskeyModule } from '../auth/passkey/passkey.module';
import { ConfigRuntimeModule } from '../config/config-runtime.module';
import { HrModule } from '../hr/hr.module';
// 발송 판정 정본(SENT/SIMULATED/FAILED) — W6 CRM 리마인더와 같은 채널·같은 판정을 쓴다
import { CrmModule } from '../crm/crm.module';

@Module({
  imports: [PasskeyModule, ConfigRuntimeModule, HrModule, CrmModule],
  controllers: [OnboardingController, OnboardingPublicController, OnboardingWelcomeController],
  providers: [OnboardingService, OnboardingTokenGuard],
  exports: [OnboardingService],
})
export class OnboardingModule {}
