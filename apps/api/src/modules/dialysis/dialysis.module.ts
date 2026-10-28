import { Module } from '@nestjs/common';
import { DialysisController } from './dialysis.controller';
import { DialysisService } from './dialysis.service';
import { ConfigRuntimeModule } from '../config/config-runtime.module';
// 게이트 위반 원장 — UF율 게이트의 WARN/BLOCK 이 남아야 승격 근거가 생긴다
import { SafetyGateModule } from '../safety-gate/safety-gate.module';

@Module({
  imports: [ConfigRuntimeModule, SafetyGateModule], // UF율 게이트(dialysis.ufRateEnforce) — 비글로벌이라 명시 import 필수
  controllers: [DialysisController],
  providers: [DialysisService],
})
export class DialysisModule {}
