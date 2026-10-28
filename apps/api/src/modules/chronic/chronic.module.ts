import { Module } from '@nestjs/common';
import { ChronicService } from './chronic.service';
import { ChronicController } from './chronic.controller';
import { ChronicDashboardController } from './chronic-dashboard.controller';
import { ChronicSyncService } from './chronic-sync.service';
import { ChronicRecallCronService } from './chronic-recall-cron.service';
import { NotificationModule } from '../notification/notification.module';
import { JourneyModule } from '../journey/journey.module';

// 만성질환(당뇨 등) 시계열 관찰값 추이 + 측정 자동 미러링(P1) + 추적관리 알림·리콜 cron(P2). PrismaService 글로벌.
@Module({
  imports: [NotificationModule, JourneyModule],
  controllers: [ChronicController, ChronicDashboardController],
  providers: [ChronicService, ChronicSyncService, ChronicRecallCronService],
  exports: [ChronicService],
})
export class ChronicModule {}
