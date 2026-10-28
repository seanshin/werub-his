import { Module } from '@nestjs/common';
import { ReferralLetterController } from './referral-letter.controller';
import { ReferralLetterService } from './referral-letter.service';
import { MedicalAiModule } from '../medical-ai/medical-ai.module';
// 협진 생성 정본(ConsultationService) 재사용 — 서명 시점에만 만든다(초안 단계 생성 폐기)
import { ConsultationModule } from '../consultation/consultation.module';
// AI 제안 원장(AiProposal) — 초안 생성·서명·폐기가 제안 상태를 남긴다(P1)
import { AiProposalModule } from '../ai-proposal/ai-proposal.module';

@Module({
  imports: [MedicalAiModule, ConsultationModule, AiProposalModule],
  controllers: [ReferralLetterController],
  providers: [ReferralLetterService],
  exports: [ReferralLetterService],
})
export class ReferralLetterModule {}
