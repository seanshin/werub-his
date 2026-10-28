import { Module } from '@nestjs/common';
import { VitalsIngestModule } from '../vitals/vitals-ingest.module';
import { InpatientController } from './inpatient.controller';
import { InpatientService } from './inpatient.service';
import { HandoffReminderCron } from './handoff-reminder.cron';
import { ConfigRuntimeModule } from '../config/config-runtime.module';
import { IntegrationOutboxModule } from '../integration/integration-outbox.module';
import { BillingModule } from '../billing/billing.module';
import { NotificationModule } from '../notification/notification.module';
// 퇴원 게이트 위반·면제 원장(GateViolationLog)
import { SafetyGateModule } from '../safety-gate/safety-gate.module';

@Module({
  imports: [VitalsIngestModule, ConfigRuntimeModule, IntegrationOutboxModule, BillingModule, NotificationModule, SafetyGateModule], // outbox=정산 ERP export(A-6)·billing=입원료 Billing(P1)·notification=인수인계 인앱 알림(잎 모듈)
  controllers: [InpatientController],
  providers: [InpatientService, HandoffReminderCron],
  exports: [InpatientService],
})
export class InpatientModule {}
