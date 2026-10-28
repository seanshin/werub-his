import { Module } from '@nestjs/common';
import { ControlledSubstanceController } from './controlled-substance.controller';
import { ControlledSubstanceService } from './controlled-substance.service';
import { ControlledSubstanceStockService } from './controlled-substance-stock.service';
import { ControlledSubstanceListener } from './controlled-substance.listener';
import { ConfigRuntimeModule } from '../config/config-runtime.module';

@Module({
  imports: [ConfigRuntimeModule], // 재고 부족 차단 게이트 controlled.stockEnforce
  controllers: [ControlledSubstanceController],
  providers: [ControlledSubstanceService, ControlledSubstanceStockService, ControlledSubstanceListener],
  exports: [ControlledSubstanceService], // hospice 마약류 발행 + CPOE 자동발행(prescription) 연동
})
export class ControlledSubstanceModule {}
