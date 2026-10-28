import { Module } from '@nestjs/common';
import { BillingController } from './billing.controller';
import { BillingErpController } from './billing-erp.controller';
import { BillingService } from './billing.service';
import { GradeCalculatorService } from './grade-calculator.service';
import { TierPriceService } from './tier-price.service';
import { ReceptionBillingBoardController } from './reception-billing-board.controller';
import { ReceptionBillingBoardService } from './reception-billing-board.service';
import { BillingListener } from './billing.listener';
import { BillingAccrualListener } from './billing-accrual.listener';
import { MedicalAiModule } from '../medical-ai/medical-ai.module';
import { ConfigRuntimeModule } from '../config/config-runtime.module';
import { EligibilityModule } from '../eligibility/eligibility.module';
import { DocumentModule } from '../document/document.module';
import { VoucherModule } from '../voucher/voucher.module';
import { IntegrationAuthModule } from '../integration/integration-auth.module';
import { DriftRecorderService } from '../../sentinel/drift-recorder.service';

@Module({
  imports: [MedicalAiModule, ConfigRuntimeModule, EligibilityModule, DocumentModule, VoucherModule, IntegrationAuthModule],
  controllers: [BillingController, BillingErpController, ReceptionBillingBoardController],
  // 🔴 DriftRecorderService 등록이 빠지면 @Optional() drift 가 undefined 로 조용히 아무것도 안 남는다(Prisma 리프 재등록 관례)
  providers: [BillingService, BillingListener, BillingAccrualListener, ReceptionBillingBoardService, DriftRecorderService, GradeCalculatorService, TierPriceService],
  exports: [BillingService],
})
export class BillingModule {}
