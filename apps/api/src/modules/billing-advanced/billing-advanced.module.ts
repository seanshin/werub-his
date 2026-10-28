import { Module } from '@nestjs/common';
import { BillingAdvancedController } from './billing-advanced.controller';
import { BillingAdvancedService } from './billing-advanced.service';
import { TierPriceService } from '../billing/tier-price.service';
import { EligibilityModule } from '../eligibility/eligibility.module';

@Module({
  imports: [EligibilityModule],
  controllers: [BillingAdvancedController],
  providers: [BillingAdvancedService, TierPriceService], // TierPriceService = Prisma 리프 — 모듈 import 없이 재등록
})
export class BillingAdvancedModule {}
