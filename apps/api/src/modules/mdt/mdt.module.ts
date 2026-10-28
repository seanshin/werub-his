import { Module } from '@nestjs/common';
import { MdtController } from './mdt.controller';
import { MdtService } from './mdt.service';
import { MedicalAiModule } from '../medical-ai/medical-ai.module';
// AI 제안 원장(AiProposal) — 임상요약 초안이 제안으로 남는다(P1)
import { AiProposalModule } from '../ai-proposal/ai-proposal.module';

@Module({
  imports: [MedicalAiModule, AiProposalModule],
  controllers: [MdtController],
  providers: [MdtService],
  exports: [MdtService],
})
export class MdtModule {}
