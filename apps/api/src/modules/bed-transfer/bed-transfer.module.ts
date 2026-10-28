import { Module } from '@nestjs/common';
import { NotificationModule } from '../notification/notification.module';
import { BedTransferController } from './bed-transfer.controller';
import { BedTransferService } from './bed-transfer.service';

@Module({
  imports: [NotificationModule],
  controllers: [BedTransferController],
  providers: [BedTransferService],
})
export class BedTransferModule {}
