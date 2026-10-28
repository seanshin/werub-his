import { Module } from '@nestjs/common';
import { InsuranceClaimController } from './insurance-claim.controller';
import { InsuranceClaimService } from './insurance-claim.service';

/**
 * 개별 청구 파이프라인(경로B) — Billing 1건 지정 생성/제출/심사.
 * 🔴 2026-07-23 발견: 컨트롤러/서비스만 존재하고 모듈이 없어 **한 번도 배선된 적 없는 dead code**였음
 * (경로A claim.service 주석의 "정책 통일" 대상이었으나 실제 미노출). 입원 EDI 청구 P3에서 정식 등록 —
 * 수납 전 개별 청구 생성 경로(경로A는 PAID 배치만)로 입원료 Billing 청구화에 사용.
 */
@Module({
  controllers: [InsuranceClaimController],
  providers: [InsuranceClaimService],
  exports: [InsuranceClaimService],
})
export class InsuranceClaimModule {}
