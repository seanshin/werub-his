import { Module } from '@nestjs/common';
import { ScheduleController } from './schedule.controller';
import { ScheduleService } from './schedule.service';
import { ConfigModule } from '../config/config.module';
import { WaitingQueueModule } from '../waiting-queue/waiting-queue.module';
import { NotificationModule } from '../notification/notification.module';

@Module({
  // NotificationModule=환자앱 도착 확인 호출(FcmPushService) — @Optional 주입이라 누락 시 조용한 no-op, 임포트 필수
  imports: [ConfigModule, WaitingQueueModule, NotificationModule],
  controllers: [ScheduleController],
  providers: [ScheduleService],
  exports: [ScheduleService],
})
export class ScheduleModule {}
