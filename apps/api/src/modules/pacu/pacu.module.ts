import { Module } from '@nestjs/common';
import { PacuController } from './pacu.controller';
import { PacuService } from './pacu.service';
import { NotificationModule } from '../notification/notification.module';
import { ConfigRuntimeModule } from '../config/config-runtime.module';

@Module({
  // 이상 활력 알림 팬아웃 (JourneyModule은 @Global) · 감시 주기/임계는 ConfigRuntime 이 정본
  imports: [NotificationModule, ConfigRuntimeModule],
  controllers: [PacuController],
  providers: [PacuService],
  // 수술실 질 지표가 회복실 지연 기준 정본(getMonitoringSettings)을 쓴다 — 같은 기준을 두 곳에 두지 않게
  exports: [PacuService],
})
export class PacuModule {}
