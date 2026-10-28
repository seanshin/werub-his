import { Module } from '@nestjs/common';
import { PartnerRequestController } from './partner-request.controller';
import { PartnerRequestService } from './partner-request.service';

@Module({
  controllers: [PartnerRequestController],
  providers: [PartnerRequestService],
  exports: [PartnerRequestService],
})
export class PartnerRequestModule {}
