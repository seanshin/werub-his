import { Module } from '@nestjs/common';
import { AiProposalController } from './ai-proposal.controller';
import { AiProposalService } from './ai-proposal.service';

/**
 * AI 제안(review-pending) 코어 — 기획서 `docs/01-plan/features/ai-judgment-governance.plan.md` P1.
 * 🔴 다른 도메인 모듈(SOAP·간호·퇴원요약·동의서·의뢰서·MDT)이 `AiProposalService` 를 주입해
 *    **서버 안에서** 제안을 만든다. 그래서 exports 가 이 모듈의 존재 이유다.
 */
@Module({
  controllers: [AiProposalController],
  providers: [AiProposalService],
  exports: [AiProposalService],
})
export class AiProposalModule {}
