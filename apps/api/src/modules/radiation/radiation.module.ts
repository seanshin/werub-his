import { Module } from '@nestjs/common';
import { RadiationController } from './radiation.controller';
import { RadiationService } from './radiation.service';
import { ConfigRuntimeModule } from '../config/config-runtime.module';
// 게이트 위반 원장 — doseEnforce·igrtEnforce 의 WARN/BLOCK 이 남아야 승격 판단 근거가 생긴다
import { SafetyGateModule } from '../safety-gate/safety-gate.module';

@Module({
  imports: [ConfigRuntimeModule, SafetyGateModule], // 과선량 안전 게이트 radiation.doseEnforce
  controllers: [RadiationController],
  providers: [RadiationService],
})
export class RadiationModule {}
