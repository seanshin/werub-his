import { Module } from '@nestjs/common';
import { ConfigRuntimeModule } from '../config/config-runtime.module';
import { MedicalAiModule } from '../medical-ai/medical-ai.module';
import { EvidenceExtractService } from './evidence-extract.service';

/**
 * 🔴 얇게 둔다 — 개원·결정 두 축이 이 모듈만 import 한다.
 *    각 축이 `MedicalAiModule` 을 직접 끌면 의존 그래프가 두 갈래가 되고,
 *    순환은 tsc·테스트가 못 잡고 운영 502 로만 드러난다(2026-08-27 실제 사고).
 */
@Module({
  imports: [ConfigRuntimeModule, MedicalAiModule],
  providers: [EvidenceExtractService],
  exports: [EvidenceExtractService],
})
export class EvidenceModule {}
