import { Module } from '@nestjs/common';
import { StaffCallController } from './staff-call.controller';
import { StaffCallService } from './staff-call.service';
import { NotificationModule } from '../notification/notification.module';

@Module({
  imports: [NotificationModule], // NotificationService(SSE) 재사용
  controllers: [StaffCallController],
  providers: [StaffCallService],
  exports: [StaffCallService],
})
export class StaffCallModule {}
