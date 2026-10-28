import { Module } from '@nestjs/common';
import { EncounterController, PatientEncounterController } from './encounter.controller';
import { EncounterAttachmentFileController } from './encounter-attachment-file.controller';
import { EncounterService } from './encounter.service';
import { DraftChartReminderCron } from './draft-chart-reminder.cron';
import { StepUpModule } from '../auth/step-up/step-up.module';
import { ConfigRuntimeModule } from '../config/config-runtime.module';
import { NotificationModule } from '../notification/notification.module';

@Module({
  // StepUp=차트 서명 step-up deps · ConfigRuntime(리프·순환 없음)=상병 제한 게이트 config
  // Notification(잎 모듈)=미서명 차트 회수 알림 크론
  imports: [StepUpModule, ConfigRuntimeModule, NotificationModule],
  controllers: [EncounterController, PatientEncounterController, EncounterAttachmentFileController],
  providers: [EncounterService, DraftChartReminderCron],
  exports: [EncounterService],
})
export class EncounterModule {}
