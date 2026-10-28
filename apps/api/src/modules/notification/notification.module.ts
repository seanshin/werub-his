import { Module } from '@nestjs/common';
import { NotificationController } from './notification.controller';
import { NotificationService } from './notification.service';
import { NotificationListener } from './notification.listener';
import { FcmPushService } from './fcm-push.service';
import { PatientPushGateService } from './patient-push-gate.service';
import { ConfigRuntimeModule } from '../config/config-runtime.module';

@Module({
  imports: [ConfigRuntimeModule], // notification.policy·retentionDays 표면(§7 P1) — 미임포트면 조용히 폴백만 돈다
  controllers: [NotificationController],
  providers: [NotificationService, NotificationListener, FcmPushService, PatientPushGateService],
  exports: [NotificationService, FcmPushService, PatientPushGateService],
})
export class NotificationModule {}
