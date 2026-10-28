import { Module } from '@nestjs/common';
import { ConfigRuntimeModule } from '../config/config-runtime.module';
import { KioskController } from './kiosk.controller';
import { KioskService } from './kiosk.service';
import { WaitingQueueModule } from '../waiting-queue/waiting-queue.module';
import { BillingModule } from '../billing/billing.module';

@Module({
  imports: [ConfigRuntimeModule, WaitingQueueModule, BillingModule],
  controllers: [KioskController],
  providers: [KioskService],
})
export class KioskModule {}
