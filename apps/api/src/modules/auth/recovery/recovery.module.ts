import { Module } from '@nestjs/common';
import { RecoveryController } from './recovery.controller';
import { RecoveryService } from './recovery.service';
import { NotificationModule } from '../../notification/notification.module';

// AuthService(Global)·PrismaService(Global) 주입
@Module({
  imports: [NotificationModule],
  controllers: [RecoveryController],
  providers: [RecoveryService],
  exports: [RecoveryService],
})
export class RecoveryModule {}
