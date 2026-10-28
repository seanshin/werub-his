import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { StepUpController } from './step-up.controller';
import { PushApprovalController } from './push-approval.controller';
import { StepUpService } from './step-up.service';
import { PushApprovalService } from './push-approval.service';
import { StepUpGuard } from './step-up.guard';
import { GatedStepUpGuard } from './gated-step-up.guard';
import { PasskeyModule } from '../passkey/passkey.module';
import { NotificationModule } from '../../notification/notification.module';
import { ConfigRuntimeModule } from '../../config/config-runtime.module';
import { TerminalModule } from '../../terminal/terminal.module';
import { AuditModule } from '../../audit/audit.module';

// 독립 키로 step-up 토큰 서명. 다른 모듈에서 가드 사용 위해 export.
// PushApproval(Tier2 푸시 생체승인)은 FcmPushService(NotificationModule) 사용.
// PIN 승인은 TerminalPinService(TerminalModule) 사용 — 승인 시 생체/PIN 선택.
// GatedStepUpGuard 는 타 모듈에서 인스턴스화되므로 그 deps(StepUpService·ConfigRuntimeService)를
//   함께 노출: StepUpService(직접) + ConfigRuntimeModule(재노출).
@Module({
  imports: [JwtModule.register({}), PasskeyModule, NotificationModule, ConfigRuntimeModule, TerminalModule, AuditModule],
  controllers: [StepUpController, PushApprovalController],
  providers: [StepUpService, PushApprovalService, StepUpGuard, GatedStepUpGuard],
  exports: [StepUpService, PushApprovalService, StepUpGuard, GatedStepUpGuard, ConfigRuntimeModule],
})
export class StepUpModule {}
