import { Module } from '@nestjs/common';
import { CdssController } from './cdss.controller';
import { CdssService } from './cdss.service';
import { DurService } from '../prescription/dur/dur.service';
import { DurRulesRepo } from '../prescription/dur/dur-rules.repo';
import { AllergyModule } from '../allergy/allergy.module';

@Module({
  // 🔴 (2026-10-01) AllergyModule 이 없어 이 모듈의 DurService 는 `@Optional() allergyService` 가 **조용히 undefined** 였다 —
  //    CDSS 경로(/cdss 점검·CPOE cdss.enforce 게이트)의 DUR 이 구조화 알레르기(Allergy 원장)를 보지 못했다(운영 13건 전부 누락 — 페니실린·아스피린 등).
  //    AllergyModule 은 임포트 0 이라 순환 없음.
  imports: [AllergyModule],
  controllers: [CdssController],
  providers: [CdssService, DurService, DurRulesRepo],
  exports: [CdssService],
})
export class CdssModule {}
