import { Module } from '@nestjs/common';
import { BloodBankController } from './blood-bank.controller';
import { BloodBankService } from './blood-bank.service';
import { ConfigRuntimeModule } from '../config/config-runtime.module';
import { PreAuthGateService } from '../pre-auth/pre-auth-gate.service';
import { SafetyGateModule } from '../safety-gate/safety-gate.module';

// PreAuthGateService(순수)는 provider 직접 등록 — 모듈 import 없이 순환 원천 차단(pre-auth 패턴).
@Module({
  // 🔴 2026-08-26: `BloodBankService` 는 `@Optional() gates?: SafetyGateService` 로 위반을 기록하는데
  //    이 모듈이 SafetyGateModule 을 import 하지 않아 **주입이 undefined** 였다 —
  //    `bloodbank.issueEnforce`·`bloodBank.bedsideScan.enforce` 의 차단은 되면서 원장만 비어 있었다.
  imports: [ConfigRuntimeModule, SafetyGateModule], // 출고 안전 게이트 bloodbank.issueEnforce
  controllers: [BloodBankController],
  providers: [BloodBankService, PreAuthGateService],
})
export class BloodBankModule {}
