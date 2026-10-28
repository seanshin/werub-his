import { Module } from '@nestjs/common';
import { ClaimController } from './claim.controller';
import { ClaimErpController } from './claim-erp.controller';
import { ClaimService } from './claim.service';
import { NotificationModule } from '../notification/notification.module';
import { ConfigRuntimeModule } from '../config/config-runtime.module';

@Module({
  imports: [NotificationModule, ConfigRuntimeModule],
  controllers: [ClaimController, ClaimErpController],
  providers: [ClaimService],
})
export class ClaimModule {}
