import { Module } from '@nestjs/common';
import { SafetyGateController } from './safety-gate.controller';
import { SafetyGateService } from './safety-gate.service';
import { ConfigRuntimeModule } from '../config/config-runtime.module';
import { DriftRecorderService } from '../../sentinel/drift-recorder.service';

// ConfigRuntimeModule 비글로벌 — 게이트 모드 조회 필수
@Module({
  imports: [ConfigRuntimeModule],
  controllers: [SafetyGateController],
  // 🔴 DriftRecorderService 등록이 빠지면 @Optional() drift 가 undefined 로 조용히 아무것도 안 남는다(Prisma 리프 재등록 관례)
  providers: [SafetyGateService, DriftRecorderService],
  exports: [SafetyGateService], // 타 모듈의 위반 기록(record) 재사용
})
export class SafetyGateModule {}
