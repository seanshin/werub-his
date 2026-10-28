import { Module } from '@nestjs/common';
import { GoLiveController } from './go-live.controller';
import { GoLiveService } from './go-live.service';
import { GoLiveCronService } from './go-live-cron.service';
import { ConfigRuntimeModule } from '../config/config-runtime.module';
import { NotificationModule } from '../notification/notification.module';

@Module({
  // 어댑터는 config/DB 직접조회 — SafetyGate·Phase0·DataQuality 모듈 미import(순환 원천 차단)
  // ConfigRuntimeModule 비글로벌(명시 import), NotificationModule(지연 알림 크론)
  imports: [ConfigRuntimeModule, NotificationModule],
  controllers: [GoLiveController],
  providers: [GoLiveService, GoLiveCronService],
  exports: [GoLiveService],
})
export class GoLiveModule {}
