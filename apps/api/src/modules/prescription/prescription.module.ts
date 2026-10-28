import { Module, forwardRef } from '@nestjs/common';
import { PrescriptionController } from './prescription.controller';
import { PrescriptionService } from './prescription.service';
import { VerbalCosignController } from './verbal-cosign.controller';
import { VerbalCosignService } from './verbal-cosign.service';
import { DurService } from './dur/dur.service';
import { DurRulesRepo } from './dur/dur-rules.repo';
import { OrderModule } from '../order/order.module';
import { OrderSignLogModule } from '../order-sign-log/order-sign-log.module';
import { AllergyModule } from '../allergy/allergy.module';
import { StepUpModule } from '../auth/step-up/step-up.module';
import { AuditModule } from '../audit/audit.module';
import { PreAuthGateService } from '../pre-auth/pre-auth-gate.service';
import { FormularyGateService } from '../formulary/formulary-gate.service';
import { CdssModule } from '../cdss/cdss.module';
import { ControlledSubstanceModule } from '../controlled-substance/controlled-substance.module';

// PreAuthGateService(순수 발행 게이트)는 별도 모듈 import 없이 provider로 직접 등록 → 모듈 순환 원천 차단.
// ConfigRuntimeService는 StepUpModule이 re-export하여 스코프에 존재.
// CdssModule은 무의존(임포트 0) 모듈이라 순환 위험 없음 — CPOE cdss.enforce 게이트용.
// 🔴 FormularyGateService(원내 처방집 시행 게이트)도 같은 이유로 provider 직접 등록.
//    이 등록이 빠지면 처방 발행 경로에서 게이트가 조용히 no-op 이 된다 → 배선 가드 스펙
//    test/formulary/formulary-gate.enforcement.spec.ts 가 providers 목록을 검사한다.
@Module({
  imports: [forwardRef(() => OrderModule), OrderSignLogModule, AllergyModule, StepUpModule, AuditModule, CdssModule, ControlledSubstanceModule,
],
  controllers: [PrescriptionController, VerbalCosignController],
  providers: [PrescriptionService, VerbalCosignService, DurService, DurRulesRepo, PreAuthGateService, FormularyGateService],
  exports: [PrescriptionService, DurService],
})
export class PrescriptionModule {}
