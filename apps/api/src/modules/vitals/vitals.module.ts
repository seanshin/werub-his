import { Module } from '@nestjs/common';
import { VitalsController } from './vitals.controller';
import { VitalsService } from './vitals.service';
import { DriftRecorderService } from '../../sentinel/drift-recorder.service';
import { VitalsIngestModule } from './vitals-ingest.module';
import { NotificationModule } from '../notification/notification.module';
import { PatientSafetyModule } from '../patient-safety/patient-safety.module';
import { ConfigRuntimeModule } from '../config/config-runtime.module';
import { VitalsThresholdsController } from './vitals-thresholds.controller';
import { VitalsConformanceController } from './vitals-conformance.controller';
import { VitalsConformanceService } from './vitals-conformance.service';

/**
 * 활력징후 정본 쓰기(PreVisitVitals) — 부가 로직(이상 알림·NEWS2)을 위해 알림·안전 모듈 의존.
 * 저장·정규화·멱등·이벤트는 `VitalsIngestModule`(수집 포트)이 담당한다.
 */
@Module({
  // 🔴 (2026-10-01) ConfigRuntimeModule 이 없어 `@Optional() config` 가 **조용히 undefined** 였다 —
  //    환자안전위 임계 개정(clinical.vitals.thresholds)·위급 알림 억제(clinical.vitals.criticalAlert)가 개통 이래 한 번도 반영되지 않았다.
  imports: [VitalsIngestModule, NotificationModule, PatientSafetyModule, ConfigRuntimeModule],
  controllers: [VitalsController, VitalsThresholdsController, VitalsConformanceController],
  // 🔴 DriftRecorderService 등록이 빠지면 @Optional() drift 가 undefined 로 조용히 아무것도 안 남는다(Prisma 리프 재등록 관례)
  providers: [VitalsService, DriftRecorderService, VitalsConformanceService],
  exports: [VitalsService],
})
export class VitalsModule {}
