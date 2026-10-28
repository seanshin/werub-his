import { Module } from '@nestjs/common';
import { PharmacistActivityController } from './pharmacist-activity.controller';
import { PharmacistActivityService } from './pharmacist-activity.service';
import { NotificationModule } from '../notification/notification.module';

@Module({
  // NotificationModule: 중재 등록 → 책임 처방의 인앱 알림(잎 모듈 — 순환 없음)
  imports: [NotificationModule],
  controllers: [PharmacistActivityController],
  providers: [PharmacistActivityService],
})
export class PharmacistActivityModule {}
