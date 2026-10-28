import { Module } from '@nestjs/common';
import { ObGynController } from './obgyn.controller';
import { ObGynService } from './obgyn.service';
import { ConfigRuntimeModule } from '../config/config-runtime.module';
// 게이트 위반 원장 — 밴드 없는 등록이 WARN 에서도 남아야 승격 근거가 생긴다
import { SafetyGateModule } from '../safety-gate/safety-gate.module';

@Module({
  imports: [ConfigRuntimeModule, SafetyGateModule], // 모아 식별밴드 게이트(obgyn.newbornId.enforce) — 비글로벌이라 명시 import 필수
  controllers: [ObGynController],
  providers: [ObGynService],
})
export class ObGynModule {}
