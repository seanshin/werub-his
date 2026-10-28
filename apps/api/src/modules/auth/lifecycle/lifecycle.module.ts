import { Module } from '@nestjs/common';
import { LifecycleController } from './lifecycle.controller';
import { LifecycleService } from './lifecycle.service';
import { NotificationModule } from '../../notification/notification.module';

// AuthService(Global)·Prisma·Redis 주입
@Module({
  imports: [NotificationModule],
  controllers: [LifecycleController],
  providers: [LifecycleService],
  exports: [LifecycleService],
})
export class LifecycleModule {}
