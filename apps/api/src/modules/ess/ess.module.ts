import { Module, forwardRef } from '@nestjs/common';
import { EssController } from './ess.controller';
import { EssIntegrationController } from './ess-integration.controller';
import { EssService } from './ess.service';
import { EssApprovalReminderCron } from './ess-approval-reminder.cron';
import { ConfigRuntimeModule } from '../config/config-runtime.module';
import { MedicalRecordIssuanceModule } from '../medical-record-issuance/medical-record-issuance.module';
import { ConsentModule } from '../consent/consent.module';
import { PreAuthModule } from '../pre-auth/pre-auth.module';
import { HisModeModule } from '../../common/his-mode/his-mode.module';

@Module({
  // HisModeModule — ESS→ERP 쓰기(계좌·주민번호 릴레이)의 운영 모드 게이트(리얼이 아니면 나가지 않는다)
  imports: [ConfigRuntimeModule, MedicalRecordIssuanceModule, ConsentModule, forwardRef(() => PreAuthModule), HisModeModule],
  controllers: [EssController, EssIntegrationController],
  providers: [EssService, EssApprovalReminderCron],
  exports: [EssService],
})
export class EssModule {}
