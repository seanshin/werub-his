import { ConfigRuntimeModule } from '../config/config-runtime.module';
import { Module } from '@nestjs/common';
import { GoLiveModule } from '../go-live/go-live.module';
import { DecisionModule } from '../decision-registry/decision.module';
import { EvidenceModule } from '../evidence/evidence.module';
import { OpeningController } from './opening.controller';
import { OpeningService } from './opening.service';

/**
 * 🔴 상태를 **파생만** 한다 — 자기 테이블이 없다(P0).
 *    go-live·결정 등록부의 서비스를 import 하지만 그 둘은 이 모듈을 모른다(순환 없음).
 *    순환 의존은 tsc·테스트가 못 잡고 운영 502 로만 드러난다(2026-08-27 실제 사고).
 */
@Module({
  // 🔴 (2026-10-01) ConfigRuntimeModule 미import → `@Optional() config` 가 조용히 undefined 였다(설정이 개통 이래 무시됨)
  //    — 기관 국가(hospital.country)를 설정해도 늘 기본(KR)으로 판정했다
  imports: [GoLiveModule, DecisionModule, EvidenceModule, ConfigRuntimeModule],
  controllers: [OpeningController],
  providers: [OpeningService],
  exports: [OpeningService],
})
export class OpeningModule {}
