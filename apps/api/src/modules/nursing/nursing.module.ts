import { Module } from '@nestjs/common';
import { NursingController, MedicationAdministrationController, NursingDiagnosisController, NursingChecklistTemplateController } from './nursing.controller';
import { NursingStationController } from './nursing-station.controller';
import { NursingService } from './nursing.service';
import { MedicationOverdueCronService } from './medication-overdue-cron.service';
import { MedicalAiModule } from '../medical-ai/medical-ai.module';
import { NotificationModule } from '../notification/notification.module';
import { ConfigRuntimeModule } from '../config/config-runtime.module';
import { PatientSafetyModule } from '../patient-safety/patient-safety.module';
import { VitalsIngestModule } from '../vitals/vitals-ingest.module';
import { SafetyGateModule } from '../safety-gate/safety-gate.module';
import { AiProposalModule } from '../ai-proposal/ai-proposal.module';

@Module({
  imports: [MedicalAiModule, NotificationModule, ConfigRuntimeModule, PatientSafetyModule, VitalsIngestModule, SafetyGateModule, AiProposalModule], // PatientSafetyModule: NEWS2 자동 산출 · VitalsIngestModule: 입원 활력 쓰기 단일 진입점 · SafetyGateModule: BCMA 우회 위반 원장 · AiProposalModule: 간호기록 AI 초안 제안 원장
  controllers: [NursingController, MedicationAdministrationController, NursingDiagnosisController, NursingStationController, NursingChecklistTemplateController],
  providers: [NursingService, MedicationOverdueCronService],
  exports: [NursingService],
})
export class NursingModule {}
