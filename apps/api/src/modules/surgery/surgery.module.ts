import { Module } from '@nestjs/common';
import { SurgeryController } from './surgery.controller';
import { SurgeryService } from './surgery.service';
import { SurgeryAdvancedController } from './surgery-advanced.controller';
import { SurgeryAdvancedService } from './surgery-advanced.service';
import { MedicalAiModule } from '../medical-ai/medical-ai.module';
import { ConfigRuntimeModule } from '../config/config-runtime.module';
// 게이트 위반 원장(GateViolationLog) — WARN 도 기록돼야 승격 판단 근거가 생긴다
import { SafetyGateModule } from '../safety-gate/safety-gate.module';
import { PacuModule } from '../pacu/pacu.module';
import { SurgeryMonitorService } from './surgery-monitor.service';
import { OrChartController } from './or-chart.controller';
import { OrChartService } from './or-chart.service';
import { HisModeModule } from '../../common/his-mode/his-mode.module';

@Module({
  imports: [MedicalAiModule, ConfigRuntimeModule, SafetyGateModule, PacuModule, HisModeModule],
  // SurgeryAdvanced 먼저 — 정적 /rooms 가 SurgeryController의 /:id 보다 우선 매칭되도록
  controllers: [SurgeryAdvancedController, OrChartController, SurgeryController],
  providers: [SurgeryService, SurgeryAdvancedService, SurgeryMonitorService, OrChartService],
})
export class SurgeryModule {}
