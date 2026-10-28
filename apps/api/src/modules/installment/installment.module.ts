import { Module } from '@nestjs/common';
import { InstallmentController } from './installment.controller';
import { InstallmentService } from './installment.service';
import { BillingModule } from '../billing/billing.module';

@Module({
  // 분납 회차 납부 정본이 BillingService 에 있다(구현 2벌 통합). BillingModule 은 이 모듈을 되부르지 않는다
  imports: [BillingModule],
  controllers: [InstallmentController],
  providers: [InstallmentService],
  exports: [InstallmentService],
})
export class InstallmentModule {}
