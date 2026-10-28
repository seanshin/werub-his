import { Module } from '@nestjs/common';
import { RiskReassessmentController } from './risk-reassessment.controller';
import { RiskReassessmentService } from './risk-reassessment.service';
import { RiskReassessmentListener } from './risk-reassessment.listener';
import { ConfigRuntimeModule } from '../config/config-runtime.module';

/**
 * 🔴 원 결함: 서비스를 `exports` 하지 않아 입원 처리 등 다른 모듈에서 주입 자체가 불가능했고,
 *    `auto-create/:patientId` EP 는 있었지만 호출처가 전역 0 → risk_reassessment_schedules 0행이었다.
 *
 * 2026-08-18 배선 — 미뤄뒀던 3개 사유를 각각 해소하고 이벤트로 붙였다(상세: risk-reassessment.listener.ts):
 *   1) 퇴원 스케줄 종료 경로 부재 → `admission.closed` 신설(퇴원·전원·입원취소 공통) + deactivateByAdmission.
 *      **닫는 쪽은 게이트와 무관하게 항상 돈다**(수동 생성분도 닫아야 하므로).
 *   2) 입원 생성 경로 둘 중 하나만 `admission.created` emit → inpatient.admit 도 emit 하도록 통일.
 *   3) 주기 표 미확정(환자안전위원회) → **생성만** `risk.reassessment.autoCreate` 게이트 뒤(기본 OFF).
 *      🔴 이 키를 켜는 것은 사람 판단이다. 켜기 전까지 스케줄은 0행이고, 화면은 그것을 사실대로 말한다.
 */
@Module({
  imports: [ConfigRuntimeModule],
  controllers: [RiskReassessmentController],
  providers: [RiskReassessmentService, RiskReassessmentListener],
  exports: [RiskReassessmentService],
})
export class RiskReassessmentModule {}
