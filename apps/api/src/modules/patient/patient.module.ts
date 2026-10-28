import { Module } from '@nestjs/common';
import { VitalsIngestModule } from '../vitals/vitals-ingest.module';
import { MulterModule } from '@nestjs/platform-express';
import { PatientController } from './patient.controller';
import { PatientErpController } from './patient-erp.controller';
import { PatientService } from './patient.service';
import { VisitComparisonController } from './visit-comparison.controller';
import { VisitComparisonService } from './visit-comparison.service';
import { AuditModule } from '../audit/audit.module';
import { AccessControlModule } from '../access-control/access-control.module';
import { ConfigRuntimeModule } from '../config/config-runtime.module';
import { IntegrationAuthModule } from '../integration/integration-auth.module';
// 사망 자동 퇴원의 퇴원 게이트 면제 기록(GateViolationLog severity=EXEMPT)
import { SafetyGateModule } from '../safety-gate/safety-gate.module';

@Module({
  imports: [VitalsIngestModule, 
    MulterModule.register({
      dest: 'uploads/patients',
    }),
    ConfigRuntimeModule,
    IntegrationAuthModule,
    AuditModule, // 대량 반출 감사
    SafetyGateModule,
    AccessControlModule, // 목록 능력표 — 역할 데이터 접근 설정(좁히기만)
  ],
  controllers: [PatientController, PatientErpController, VisitComparisonController],
  providers: [PatientService, VisitComparisonService],
  exports: [PatientService],
})
export class PatientModule {}
