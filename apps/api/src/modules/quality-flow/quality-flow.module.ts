import { Module } from '@nestjs/common';
import { QualityModule } from '../quality/quality.module';
import { QiModule } from '../qi/qi.module';
import { CpoeQualityModule } from '../cpoe-quality/cpoe-quality.module';
import { OrderGovernanceModule } from '../order-governance/order-governance.module';
import { ConfigRuntimeModule } from '../config/config-runtime.module';
import { QualityFlowController } from './quality-flow.controller';
import { PatientDaysService } from './patient-days.service';
import { MonthCloseService } from './month-close.service';
import { QiReportService } from './qi-report.service';
import { QiAgendaService } from './qi-agenda.service';
import { DeviceDaysService } from './device-days.service';
import { AccreditationService } from './accreditation.service';
import { QiFlowSettingsService } from './qi-flow-settings.service';
import { DeviceLineService } from './device-line.service';

/**
 * 의료질관리 흐름(QI-FLOW-001 · 2026-10-08) — **잎 모듈**(아무도 import 하지 않는다).
 * 질 지표 원장(quality)·운영 지표(qi)·CPOE·위원회 안건 다리를 함께 쓰는 쪽을 따로 둔다(순환 방지).
 */
@Module({
  imports: [QualityModule, QiModule, CpoeQualityModule, OrderGovernanceModule, ConfigRuntimeModule],
  controllers: [QualityFlowController],
  providers: [PatientDaysService, MonthCloseService, QiReportService, QiAgendaService, DeviceDaysService, AccreditationService, QiFlowSettingsService, DeviceLineService],
})
export class QualityFlowModule {}
