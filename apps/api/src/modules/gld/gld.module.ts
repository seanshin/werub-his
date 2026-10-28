import { QualityModule } from '../quality/quality.module';
import { Module } from '@nestjs/common';
import { GldController } from './gld.controller';
import { GldService } from './gld.service';
import { GovernanceService } from './governance.service';
import { GovernanceEnactmentService } from './governance-enactment.service';
import { StandardGovernanceModule } from './standard-governance.module';
import { GovernanceController } from './governance.controller';
import { PrismaModule } from '../../infrastructure/prisma/prisma.module';
import { ConfigRuntimeModule } from '../config/config-runtime.module';
import { AuditModule } from '../audit/audit.module';
import { NotificationModule } from '../notification/notification.module';
import { FormularyModule } from '../formulary/formulary.module';
import { ReferenceRangeModule } from '../reference-range/reference-range.module';
import { CdssModule } from '../cdss/cdss.module';
import { TriageModule } from '../triage/triage.module';
import { CodeMasterModule } from '../code-master/code-master.module';
import { DutyScheduleModule } from '../duty-schedule/duty-schedule.module';
import { DurModule } from '../prescription/dur/dur.module';
import { ConsentTemplateModule } from '../consent-template/consent-template.module';
import { ChartTemplateModule } from '../chart-template/chart-template.module';
import { AccessControlModule } from '../access-control/access-control.module';
import { ProtocolModule } from '../protocol/protocol.module';
import { ClinicalPathwayModule } from '../clinical-pathway/clinical-pathway.module';
import { OrderSetModule } from '../order-set/order-set.module';
import { RetentionModule } from '../retention/retention.module';
import { SignIntegrationModule } from '../sign-integration/sign-integration.module';
import { NursingModule } from '../nursing/nursing.module';
import { SafetyGateModule } from '../safety-gate/safety-gate.module';

/**
 * 거버넌스 배선(P3): 집행 엔진이 기존 정본 서비스만 호출(D2)하므로 대상 도메인 모듈을 전부 imports 한다.
 * 🔴 반복 함정 — 엔진 의존을 늘릴 때 여기 imports 미반영이면 @Optional 주입이 조용히 비어
 *    바인딩이 의결 시점 BINDING_NOT_WIRED 로 거부된다(부팅은 되게, 실패는 보이게).
 * AuditModule·NotificationModule: 집행 감사로그·실패 알림용(미임포트면 조용한 no-op — 2026-08-04 실결함 봉합).
 */
@Module({
  imports: [StandardGovernanceModule, 
    PrismaModule, ConfigRuntimeModule, AuditModule, NotificationModule,
    FormularyModule, ReferenceRangeModule, CdssModule, TriageModule, CodeMasterModule,
    DutyScheduleModule, DurModule, ConsentTemplateModule, ChartTemplateModule,
    AccessControlModule, ProtocolModule, ClinicalPathwayModule, OrderSetModule, RetentionModule,
    SignIntegrationModule, // 의사록·의결 봉인(D5·his-governance)
    NursingModule, // MASTER_DATA nursing-checklist 바인딩(§7 P2)
    QualityModule, // MASTER_DATA quality-indicator 바인딩(2026-10-07 CPOE 지표 등록·목표 — 위원회 의결로만)
    SafetyGateModule, // 🔴 정족수 명부 게이트 위반 원장 — 빠지면 기록만 조용히 사라진다
  ],
  controllers: [GldController, GovernanceController],
  providers: [GldService, GovernanceService, GovernanceEnactmentService],
  // 🔴 결정 등록부가 집행을 위임한다(2026-08-27) — 집행 로직을 복제하지 않기 위해 엔진을 내보낸다
  // GovernanceService — 오더 위원회 기준 점검(order-governance)이 provenance 를 같은 규칙으로 읽는다
  exports: [GldService, GovernanceEnactmentService, GovernanceService],
})
export class GldModule {}
