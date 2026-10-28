import { Module } from '@nestjs/common';
import { PreOrderController } from './pre-order.controller';
import { PreOrderService } from './pre-order.service';
import { PrescriptionModule } from '../prescription/prescription.module';
import { ConfigRuntimeModule } from '../config/config-runtime.module';
import { AuditModule } from '../audit/audit.module';
import { PreAuthGateService } from '../pre-auth/pre-auth-gate.service';
import { FormularyGateService } from '../formulary/formulary-gate.service';

// 🔴 W8-R3(2026-08-14) — FormularyGateService 등록이 빠지면 승인 발행 경로에서 게이트가 조용히
//    no-op 이 된다(서비스가 @Optional 주입). 배선 가드 스펙 test/formulary/formulary-gate.bypass-paths.spec.ts
//    가 이 providers 목록을 검사한다. PreAuthGateService 와 동일하게 순수 게이트라 모듈 순환 0.
@Module({
  imports: [PrescriptionModule, ConfigRuntimeModule, AuditModule], // DurService — DUR / config — ON_CHECKIN 게이트 / 감사 — 승인 DUR 재검증 실패 기록
  controllers: [PreOrderController],
  providers: [PreOrderService, PreAuthGateService, FormularyGateService], // 발행 게이트(순수·provider 직접등록, 순환 0)
  exports: [PreOrderService],
})
export class PreOrderModule {}
