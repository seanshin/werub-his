import { Module } from '@nestjs/common';
import { EmergencyController } from './emergency.controller';
import { EmsIntegrationController } from './ems-integration.controller';
import { EmergencyService } from './emergency.service';
import { ErBedService } from './er-bed.service';
import { ErFlowDisplayService } from './er-flow-display.service';
import { ErFlowDisplayController } from './er-flow-display.controller';
import { MedicalAiModule } from '../medical-ai/medical-ai.module';
import { EncounterModule } from '../encounter/encounter.module';
import { AdmissionModule } from '../admission/admission.module';
import { PatientSafetyModule } from '../patient-safety/patient-safety.module';
import { ConfigRuntimeModule } from '../config/config-runtime.module';
import { IntegrationAuthModule } from '../integration/integration-auth.module';
import { NotificationModule } from '../notification/notification.module';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [MedicalAiModule, EncounterModule, AdmissionModule, PatientSafetyModule, ConfigRuntimeModule, IntegrationAuthModule, NotificationModule, AuditModule], // AuditModule=처분 변경 시 변경 전 스냅샷 보존(전용 이력 테이블 부재의 잠정 보존처) // NotificationModule=코드 알림 방송 // Config=NEDOCS ED병상수·IntegrationAuth=119 사전통보 수신키(ER 잔여 2026-07-23) // EncounterModule: ER_CONSULT 진료기록 생성·서명(수납 A) / AdmissionModule: 응급 경유 입원 정합 admit / PatientSafetyModule: ER 활력 NEWS2 이력화(P3)
  controllers: [EmergencyController, EmsIntegrationController, ErFlowDisplayController],
  providers: [EmergencyService, ErBedService, ErFlowDisplayService],
  exports: [EmergencyService], // command-center 집계 재사용
})
export class EmergencyModule {}
