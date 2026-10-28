import { Module } from '@nestjs/common';
import { ConfigRuntimeModule } from '../config/config-runtime.module';
import { NursingRulesController } from './nursing-rules.controller';
import { NursingRulesService } from './nursing-rules.service';

/** 간호 원내 규정(2026-10-26) — 규정 현황·통증 재평가 대기(읽기 전용 · 잎 모듈) */
@Module({
  imports: [ConfigRuntimeModule],
  controllers: [NursingRulesController],
  providers: [NursingRulesService],
})
export class NursingRulesModule {}
