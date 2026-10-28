import { Module } from '@nestjs/common';
import { PortalVocController, VocPublicController } from './voc.controller';
import { VocAdminController } from './voc-admin.controller';
import { VocService } from './voc.service';
import { VocAdminService } from './voc-admin.service';
import { VocAiService } from './voc-ai.service';
import { VocSlaCronService } from './voc-sla-cron.service';
import { PatientAuthModule } from '../patient-auth/patient-auth.module';
import { PortalModule } from '../portal/portal.module';
import { NotificationModule } from '../notification/notification.module';
import { JourneyModule } from '../journey/journey.module';
import { ConfigRuntimeModule } from '../config/config-runtime.module';

@Module({
  // PortalOrPatientGuard 의존성: PatientAuthModule + PortalModule
  // NotificationModule(담당자 알림), JourneyModule(voc.received 이벤트)
  // ConfigRuntimeModule 비글로벌(기존 함정) — 명시 import
  imports: [PatientAuthModule, PortalModule, NotificationModule, JourneyModule, ConfigRuntimeModule],
  controllers: [PortalVocController, VocPublicController, VocAdminController],
  providers: [VocService, VocAdminService, VocAiService, VocSlaCronService],
  exports: [VocService],
})
export class VocModule {}
