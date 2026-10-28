import { VitalsIngestModule } from '../vitals/vitals-ingest.module';
import { Module } from '@nestjs/common';
import { MedicalAiController } from './medical-ai.controller';
import { MedicalAiService } from './medical-ai.service';
import { PatientBriefService } from './patient-brief.service';
import { ConfigRuntimeModule } from '../config/config-runtime.module';
// AuditModule 전이 imports = BlockchainAnchorModule(무 import) — MedicalAiModule 로의 순환 없음(검증 완료)
import { AuditModule } from '../audit/audit.module';
import { AllergyModule } from '../allergy/allergy.module';
// DUR leaf 모듈(Prisma+Allergy 만 import · 순환 없음) — PrescriptionModule 전체(Order/StepUp/ControlledSubstance 순환 그래프)를 끌어오지 않는다
import { DurModule } from '../prescription/dur/dur.module';
import { DriftRecorderService } from '../../sentinel/drift-recorder.service';
// AI 제안 원장(P1) — AiProposalModule 은 아무 모듈도 import 하지 않는 리프다(순환 없음 · Prisma 는 @Global)
import { AiProposalModule } from '../ai-proposal/ai-proposal.module';

@Module({
  imports: [VitalsIngestModule, ConfigRuntimeModule,
    AuditModule,
    AiProposalModule, // SOAP·퇴원요약 초안을 제안 원장 1행으로(기획서 §2.1)
    AllergyModule, // 알레르기 3상태 정본(NKA) — 프롬프트가 "없음"을 지어내지 않게
    DurModule, // 약물추천 durVerdict = DUR 정본 재검증(P1) — RedisService 는 @Global RedisModule
],
  controllers: [MedicalAiController],
  // 🔴 DriftRecorderService 등록이 빠지면 @Optional() drift 가 undefined 로 조용히 아무것도 안 남는다(Prisma 리프 재등록 관례)
  providers: [MedicalAiService, PatientBriefService, DriftRecorderService],
  exports: [MedicalAiService, PatientBriefService],
})
export class MedicalAiModule {}
