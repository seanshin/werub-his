import { Module } from '@nestjs/common';
import { ConsultController } from './consult.controller';
import { ConsultStaffController } from './consult-staff.controller';
import { ConsultAdminController } from './consult-admin.controller';
import { ConsultService } from './consult.service';
import { ConsultPortalStreamGuard, ConsultStaffStreamGuard } from './consult-stream.guards';
import { ConsultTeamService } from './consult-team.service';
import { ConsultAgentService } from './consult-agent.service';
import { ConsultAgentGuard } from './consult-agent.guard';
import { ConsultTemplateService } from './consult-template.service';
import { I18nModule } from '../i18n/i18n.module';
import { PatientAuthModule } from '../patient-auth/patient-auth.module';
import { PortalModule } from '../portal/portal.module';
import { AuditModule } from '../audit/audit.module';
import { NotificationModule } from '../notification/notification.module';
import { AccessControlModule } from '../access-control/access-control.module';
import { ConfigRuntimeModule } from '../config/config-runtime.module';

@Module({
  // PortalOrPatientGuard 의존성: PatientAuthService(PatientAuthModule) + PortalService(PortalModule)
  // AuditModule(감사·설계 C-2), NotificationModule(팀장 알림·P2)
  // AccessControlModule: ConsultAgentGuard 가 FeatureAccessService(기능 접근 매트릭스) 사용
  // 🔴 `ConfigRuntimeService` 는 @Optional() 주입이다 — 여기서 주지 않으면 설정이
  //    조용히 무시되고 "저장했는데 안 바뀐다"가 된다(가드가 이 import 를 강제한다).
  imports: [I18nModule, PatientAuthModule, PortalModule, AuditModule, NotificationModule, AccessControlModule, ConfigRuntimeModule],
  controllers: [ConsultController, ConsultStaffController, ConsultAdminController],
  providers: [ConsultService, ConsultTeamService, ConsultAgentService, ConsultTemplateService, ConsultAgentGuard, ConsultPortalStreamGuard, ConsultStaffStreamGuard],
})
export class ConsultModule {}
