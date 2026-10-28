import { Module, forwardRef } from '@nestjs/common';
import { PacsProxyModule } from '../pacs-proxy/pacs-proxy.module';
import { PortalController, DocumentAdminController, PortalCheckupController } from './portal.controller';
import { PortalPublicCheckupController } from './portal-public.controller';
import { PortalService } from './portal.service';
import { ErFlowDisplayService } from '../emergency/er-flow-display.service';
import { PacsExportService } from './pacs-export.service';
import { MedicationReminderCronService } from './medication-reminder.cron';
import { DrugInfoResolver } from './drug-info.resolver';
import { DrugExplainService } from './drug-explain.service';
import { DrugExplainAdminController } from './drug-explain-admin.controller';
import { PatientAuthModule } from '../patient-auth/patient-auth.module';
import { ConfigRuntimeModule } from '../config/config-runtime.module';
import { MedicalAiModule } from '../medical-ai/medical-ai.module';
import { RegistrationConsentModule } from '../registration-consent/registration-consent.module';
import { RemoteConsultationModule } from '../remote-consultation/remote-consultation.module';
import { ClinicScheduleModule } from '../clinic-schedule/clinic-schedule.module';
import { WaitingQueueModule } from '../waiting-queue/waiting-queue.module';
import { ScheduleModule } from '../schedule/schedule.module';
import { ChronicModule } from '../chronic/chronic.module';
import { AllergyModule } from '../allergy/allergy.module';
import { TelehealthModule } from '../telehealth/telehealth.module';
import { DriftRecorderService } from '../../sentinel/drift-recorder.service';
import { SpaceModelModule } from '../space-model/space-model.module';

// ⚠️ BillingModule import 금지 — Portal→Billing→Voucher→PatientAuth→Portal 순환으로 부트 실패(2026-07-07 운영 장애).
//    interim-bill의 ERP 호출은 portal.service에 인라인(configRuntime 직접).
@Module({
  imports: [forwardRef(() => PatientAuthModule), PacsProxyModule, ConfigRuntimeModule, MedicalAiModule, RegistrationConsentModule, RemoteConsultationModule, ClinicScheduleModule, WaitingQueueModule, ScheduleModule, ChronicModule, AllergyModule, TelehealthModule, SpaceModelModule],
  controllers: [PortalController, DocumentAdminController, PortalCheckupController, PortalPublicCheckupController, DrugExplainAdminController],
  // F-7 DrugExplain은 신규 provider만 추가(신규 모듈 import 0) — WeRU.B는 기존 MedicalAiModule(리프: →ConfigRuntime뿐) 경유
  providers: [PortalService, PacsExportService, MedicationReminderCronService, DrugInfoResolver, DrugExplainService, ErFlowDisplayService, DriftRecorderService], // ErFlow·DriftRecorder=Prisma 리프 — 모듈 import 없이 클래스 재등록(관례: 신규 모듈 import 0)
  exports: [PortalService],
})
export class PortalModule {}
