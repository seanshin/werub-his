import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ScheduleModule as NestScheduleModule } from '@nestjs/schedule';
import { PrismaModule } from './infrastructure/prisma/prisma.module';
import { RedisModule } from './infrastructure/redis/redis.module';
import { HealthModule } from './modules/health/health.module';
import { CommandCenterModule } from './modules/command-center/command-center.module';
import { HimModule } from './modules/him/him.module';
import { AiProposalModule } from './modules/ai-proposal/ai-proposal.module';
import { AiCallLogModule } from './modules/ai-call-log/ai-call-log.module';
import { AiOversightModule } from './modules/ai-oversight/ai-oversight.module';
import { AuthModule } from './modules/auth/auth.module';
import { CodeMasterModule } from './modules/code-master/code-master.module';
import { PatientModule } from './modules/patient/patient.module';
import { ScheduleModule } from './modules/schedule/schedule.module';
import { FhirModule } from './modules/fhir/fhir.module';
import { FhirLabModule } from './modules/fhir-lab/fhir-lab.module';
import { UserModule } from './modules/user/user.module';
import { EncounterModule } from './modules/encounter/encounter.module';
import { ScribeModule } from './modules/scribe/scribe.module';
import { VoiceEmrModule } from './modules/voice-emr/voice-emr.module';
import { ProtocolModule } from './modules/protocol/protocol.module';
import { PrescriptionModule } from './modules/prescription/prescription.module';
import { OrderModule } from './modules/order/order.module';
import { OrderGovernanceModule } from './modules/order-governance/order-governance.module';
import { CpoeQualityModule } from './modules/cpoe-quality/cpoe-quality.module';
import { QualityFlowModule } from './modules/quality-flow/quality-flow.module';
import { OrderSignLogModule } from './modules/order-sign-log/order-sign-log.module';
import { BillingModule } from './modules/billing/billing.module';
import { FormEngineModule } from './modules/form-engine/form-engine.module';
import { PharmacyModule } from './modules/pharmacy/pharmacy.module';
import { LabModule } from './modules/lab/lab.module';
import { MobileModule } from './modules/mobile/mobile.module';
import { ImagingModule } from './modules/imaging/imaging.module';
import { ClaimModule } from './modules/claim/claim.module';
import { InsuranceClaimModule } from './modules/insurance-claim/insurance-claim.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { NonCoveredModule } from './modules/non-covered/non-covered.module';
import { I18nModule } from './modules/i18n/i18n.module';
import { I18nReviewModule } from './modules/i18n-review/i18n-review.module';
import { ConsultModule } from './modules/consult/consult.module';
import { OperationalStatsModule } from './modules/operational-stats/operational-stats.module';
import { IntegrationOutboxModule } from './modules/integration/integration-outbox.module';
import { TwinModule } from './modules/twin/twin.module';
import { DocumentModule } from './modules/document/document.module';
import { SpecialtyCountsModule } from './modules/specialty-counts/specialty-counts.module';
import { DeviceUsageModule } from './modules/device-usage/device-usage.module';
import { FeeIntegrationModule } from './modules/fee-integration/fee-integration.module';
import { BedModule } from './modules/bed/bed.module';
import { InpatientModule } from './modules/inpatient/inpatient.module';
import { AdmissionModule } from './modules/admission/admission.module';
import { JourneyConsoleModule } from './modules/journey-console/journey-console.module';
import { EligibilityModule } from './modules/eligibility/eligibility.module';
import { SignIntegrationModule } from './modules/sign-integration/sign-integration.module';
import { EnvelopeKeyModule } from './common/crypto/envelope-key.module';
import { SurgeryModule } from './modules/surgery/surgery.module';
import { EmergencyModule } from './modules/emergency/emergency.module';
import { EmergencyPathwayModule } from './modules/emergency-pathway/emergency-pathway.module';
import { InventoryModule } from './modules/inventory/inventory.module';
import { CssdModule } from './modules/cssd/cssd.module';
import { HrModule } from './modules/hr/hr.module';
import { NutritionModule } from './modules/nutrition/nutrition.module';
import { HospitalInfoModule } from './modules/hospital-info/hospital-info.module';
import { UploadModule } from './modules/upload/upload.module';
import { EquipmentModule } from './modules/equipment/equipment.module';
import { BotsModule } from './modules/bots/bots.module';
import { FhirFullModule } from './modules/fhir-full/fhir-full.module';
import { BillingAdvancedModule } from './modules/billing-advanced/billing-advanced.module';
import { HieModule } from './modules/hie/hie.module';
import { EmrCertModule } from './modules/emr-cert/emr-cert.module';
import { ExtensionModule } from './modules/extension/extension.module';
import { ConfigRuntimeModule } from './modules/config/config-runtime.module';
// PacsModule 제거됨 — PACS는 OpenPACS 별도 프로젝트로 분리 (2026-05-09)
import { PacsProxyModule } from './modules/pacs-proxy/pacs-proxy.module';
import { PatientSafetyModule } from './modules/patient-safety/patient-safety.module';
import { InfectionControlModule } from './modules/infection-control/infection-control.module';
import { StaffQualificationModule } from './modules/staff-qualification/staff-qualification.module';
import { GldModule } from './modules/gld/gld.module';
import { PatientFlagModule } from './modules/patient-flag/patient-flag.module';
import { QualityModule } from './modules/quality/quality.module';
import { ConsentModule } from './modules/consent/consent.module';
import { EducationModule } from './modules/education/education.module';
import { AuditModule } from './modules/audit/audit.module';
import { PublicAccessModule } from './modules/public-access/public-access.module';
import { RbacAdminModule } from './modules/rbac-admin/rbac-admin.module';
import { ProblemListModule } from './modules/problem-list/problem-list.module';
import { AllergyModule } from './modules/allergy/allergy.module';
import { ReferenceRangeModule } from './modules/reference-range/reference-range.module';
import { CompoundingModule } from './modules/compounding/compounding.module';
import { ChemoModule } from './modules/chemo/chemo.module';
import { DischargeSummaryModule } from './modules/discharge-summary/discharge-summary.module';
import { ConsentTemplateModule } from './modules/consent-template/consent-template.module';
import { NursingModule } from './modules/nursing/nursing.module';
import { ClinicScheduleModule } from './modules/clinic-schedule/clinic-schedule.module';
import { WaitingQueueModule } from './modules/waiting-queue/waiting-queue.module';
import { KioskModule } from './modules/kiosk/kiosk.module';
import { EncounterTemplateModule } from './modules/encounter-template/encounter-template.module';
import { TextMacroModule } from './modules/text-macro/text-macro.module';
import { MedicalRecordCopyModule } from './modules/medical-record-copy/medical-record-copy.module';
import { AuditEnhancedModule } from './modules/audit-enhanced/audit-enhanced.module';
import { QuestionnaireModule } from './modules/questionnaire/questionnaire.module';
import { MedicalRecordSearchModule } from './modules/medical-record-search/medical-record-search.module';
import { ClinicIntegrationModule } from './modules/clinic-integration/clinic-integration.module';
import { OrderSetModule } from './modules/order-set/order-set.module';
import { MedicalAiModule } from './modules/medical-ai/medical-ai.module';
import { AgentSessionModule } from './modules/agent-session/agent-session.module';
import { IcuModule } from './modules/icu/icu.module';
import { CodeBlueModule } from './modules/code-blue/code-blue.module';
import { LisReferenceModule } from './modules/lis-reference/lis-reference.module';
import { DiagnosticTestModule } from './modules/diagnostic-test/diagnostic-test.module';
import { ExecutiveModule } from './modules/executive/executive.module';
import { AccessControlModule } from './modules/access-control/access-control.module';
import { VoucherModule } from './modules/voucher/voucher.module';
import { PreOrderModule } from './modules/pre-order/pre-order.module';
import { DoctorCodeModule } from './modules/doctor-code/doctor-code.module';
import { FormularyModule } from './modules/formulary/formulary.module';
import { ClinicalRulesModule } from './modules/clinical-rules/clinical-rules.module';
import { HumanActionsModule } from './modules/human-actions/human-actions.module';
import { NursingRulesModule } from './modules/nursing-rules/nursing-rules.module';
import { DoctorsModule } from './modules/doctors/doctors.module';
import { TriageModule } from './modules/triage/triage.module';
import { HolidayModule } from './modules/holiday/holiday.module';
import { PatientAuthModule } from './modules/patient-auth/patient-auth.module';
import { JourneyModule } from './modules/journey/journey.module';
import { QiModule } from './modules/qi/qi.module';
import { DataQualityModule } from './modules/data-quality/data-quality.module';
import { SentinelModule } from './sentinel/sentinel.module';
import { Phase0CutoverModule } from './modules/phase0-cutover/phase0-cutover.module';
import { PortalModule } from './modules/portal/portal.module';
import { MedicalRecordIssuanceModule } from './modules/medical-record-issuance/medical-record-issuance.module';
import { ChronicModule } from './modules/chronic/chronic.module';
import { RecordTimelineModule } from './modules/record-timeline/record-timeline.module';
import { PatientScheduleModule } from './modules/patient-schedule/patient-schedule.module';
import { TreatmentTemplateModule } from './modules/treatment-template/treatment-template.module';
import { IntegrationGateModule } from './modules/integration-gate/integration-gate.module';
import { ChartTemplateModule } from './modules/chart-template/chart-template.module';
import { ClinicalChartResultModule } from './modules/clinical-chart-result/clinical-chart-result.module';
import { ClinicalChartVerificationModule } from './modules/clinical-chart-verification/clinical-chart-verification.module';
import { CheckupExplainerModule } from './modules/checkup-explainer/checkup-explainer.module';
import { MedicalTerminologyModule } from './modules/medical-terminology/medical-terminology.module';
import { FloorModule } from './modules/floor/floor.module';
import { PatientFlowModule } from './modules/patient-flow/patient-flow.module';
import { CredentialAdminModule } from './modules/credential-admin/credential-admin.module';
import { SimulatorModule } from './modules/simulator/simulator.module';
import { MetaverseModule } from './modules/metaverse/metaverse.module';
import { OrganizationModule } from './modules/organization/organization.module';
import { PartnerRequestModule } from './modules/partner-request/partner-request.module';
import { SmartClientModule } from './modules/smart-client/smart-client.module';
import { SmartAuthModule } from './modules/smart-auth/smart-auth.module';
import { TransferModule } from './modules/transfer/transfer.module';
import { ForeignPatientModule } from './modules/foreign-patient/foreign-patient.module';
import { PatientEducationModule } from './modules/patient-education/patient-education.module';
import { PrescriptionIssueModule } from './modules/prescription-issue/prescription-issue.module';
import { BedTransferModule } from './modules/bed-transfer/bed-transfer.module';
import { CdssModule } from './modules/cdss/cdss.module';
import { WorkgroupModule } from './modules/workgroup/workgroup.module';
import { BloodBankModule } from './modules/blood-bank/blood-bank.module';
import { RehabModule } from './modules/rehab/rehab.module';
import { RadiationModule } from './modules/radiation/radiation.module';
import { DialysisModule } from './modules/dialysis/dialysis.module';
import { DentalModule } from './modules/dental/dental.module';
import { OphthalmologyModule } from './modules/ophthalmology/ophthalmology.module';
import { DermatologyModule } from './modules/dermatology/dermatology.module';
import { EntModule } from './modules/ent/ent.module';
import { OrthopedicsModule } from './modules/orthopedics/orthopedics.module';
import { ObGynModule } from './modules/obgyn/obgyn.module';
import { PediatricsModule } from './modules/pediatrics/pediatrics.module';
import { SpecialtyExamModule } from './modules/specialty-exam/specialty-exam.module';
import { VitalsModule } from './modules/vitals/vitals.module';
import { PsychiatryModule } from './modules/psychiatry/psychiatry.module';
import { SafetyGateModule } from './modules/safety-gate/safety-gate.module';
import { OutboundChannelModule } from './modules/outbound-channel/outbound-channel.module';
import { DecisionModule } from './modules/decision-registry/decision.module';
import { PrintIssuanceModule } from './modules/print-issuance/print-issuance.module';
import { NeurosurgeryModule } from './modules/neurosurgery/neurosurgery.module';
import { PlasticModule } from './modules/plastic/plastic.module';
import { UrologyModule } from './modules/urology/urology.module';
import { DepositModule } from './modules/deposit/deposit.module';
import { InstallmentModule } from './modules/installment/installment.module';
import { InternalMedicineModule } from './modules/internal-medicine/internal-medicine.module';
import { SurgeryOpnoteModule } from './modules/surgery-opnote/surgery-opnote.module';
import { BurnAssessmentModule } from './modules/burn-assessment/burn-assessment.module';
import { CareTeamModule } from './modules/care-team/care-team.module';
import { TherapyOrderModule } from './modules/therapy-order/therapy-order.module';
import { NurseStationModule } from './modules/nurse-station/nurse-station.module';
import { BlockchainCertModule } from './modules/blockchain-cert/blockchain-cert.module';
import { DocumentSignModule } from './modules/document-sign/document-sign.module';
import { BlockchainAnchorModule } from './modules/blockchain-anchor/blockchain-anchor.module';
import { PathologyModule } from './modules/pathology/pathology.module';
import { HiraEdiModule } from './modules/hira-edi/hira-edi.module';
import { ControlledSubstanceModule } from './modules/controlled-substance/controlled-substance.module';
import { PacuModule } from './modules/pacu/pacu.module';
import { RiskReassessmentModule } from './modules/risk-reassessment/risk-reassessment.module';
import { NursingNoteModule } from './modules/nursing-note/nursing-note.module';
import { NotificationModule } from './modules/notification/notification.module';
import { CheckupModule } from './modules/checkup/checkup.module';
import { HospiceModule } from './modules/hospice/hospice.module';
import { TransplantModule } from './modules/transplant/transplant.module';
import { TelehealthModule } from './modules/telehealth/telehealth.module';
import { WorkstationModule } from './modules/workstation/workstation.module';
import { WorkstationSetupModule } from './modules/workstation-setup/workstation-setup.module';
import { ClinicalPathwayModule } from './modules/clinical-pathway/clinical-pathway.module';
import { MdtModule } from './modules/mdt/mdt.module';
import { CancerRegistryModule } from './modules/cancer-registry/cancer-registry.module';
import { ResearchModule } from './modules/research/research.module';
import { CostAnalysisModule } from './modules/cost-analysis/cost-analysis.module';
import { DutyScheduleModule } from './modules/duty-schedule/duty-schedule.module';
import { SatisfactionModule } from './modules/satisfaction/satisfaction.module';
import { VocModule } from './modules/voc/voc.module';
import { GoLiveModule } from './modules/go-live/go-live.module';
import { OpeningModule } from './modules/opening/opening.module';
import { OmopCdmModule } from './modules/omop-cdm/omop-cdm.module';
import { PharmacistActivityModule } from './modules/pharmacist-activity/pharmacist-activity.module';
import { ConsultationModule } from './modules/consultation/consultation.module';
import { ReferralLetterModule } from './modules/referral-letter/referral-letter.module';
import { ConciergeModule } from './modules/concierge/concierge.module';
import { HomepagePopupModule } from './modules/homepage-popup/homepage-popup.module';
import { MediaModule } from './modules/media/media.module';
import { CmsConfigModule } from './modules/cms-config/cms-config.module';
import { CrmModule } from './modules/crm/crm.module';
import { HisModeModule } from './common/his-mode/his-mode.module';
import { RemoteConsultationModule } from './modules/remote-consultation/remote-consultation.module';
import { PatientMessageModule } from './modules/patient-message/patient-message.module';
import { RegistrationConsentModule } from './modules/registration-consent/registration-consent.module';
import { PasskeyModule } from './modules/auth/passkey/passkey.module';
import { DeviceEnrollModule } from './modules/auth/device-enroll/device-enroll.module';
import { SsoIdpModule } from './modules/auth/sso-idp/sso-idp.module';
import { StepUpModule } from './modules/auth/step-up/step-up.module';
import { TerminalModule } from './modules/terminal/terminal.module';
import { RetentionModule } from './modules/retention/retention.module';
import { LegalHoldModule } from './modules/legal-hold/legal-hold.module';
import { SpaceAssetModule } from './modules/space-asset/space-asset.module';
import { FinanceBenchmarkModule } from './modules/finance-benchmark/finance-benchmark.module';
import { SpaceModelModule } from './modules/space-model/space-model.module';
import { WifiLocationModule } from './modules/wifi-location/wifi-location.module';
import { DevDemoModule } from './modules/dev-demo/dev-demo.module';
import { StaffCallModule } from './modules/staff-call/staff-call.module';
import { BreakGlassModule } from './modules/auth/break-glass/break-glass.module';
import { RecoveryModule } from './modules/auth/recovery/recovery.module';
import { LifecycleModule } from './modules/auth/lifecycle/lifecycle.module';
import { OnboardingModule } from './modules/onboarding/onboarding.module';
import { EssModule } from './modules/ess/ess.module';
import { PreAuthModule } from './modules/pre-auth/pre-auth.module';
import { QrModule } from './modules/qr/qr.module';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ['.env', '../../.env'] }),
    ThrottlerModule.forRoot([
      { name: 'default', ttl: 60000, limit: 600 },   // 조회 600/분 (대시보드 동시 호출 대응)
      { name: 'write', ttl: 60000, limit: 120 },      // 쓰기 120/분
      { name: 'auth', ttl: 60000, limit: 100 },       // 인증 100/분 (배포 테스트 대응)
      { name: 'sensitive', ttl: 60000, limit: 30 },    // 민감 30/분
    ]),
    EventEmitterModule.forRoot(),
    NestScheduleModule.forRoot(),
    PrismaModule,
    RedisModule,
    HealthModule,
    AuthModule,
    CodeMasterModule,
    PatientModule,
    ScheduleModule,
    FhirModule,
    FhirLabModule,
    UserModule,
    EncounterModule,
    ScribeModule,
    VoiceEmrModule,
    ProtocolModule,
    PrescriptionModule,
    OrderModule,
    OrderGovernanceModule,
    CpoeQualityModule,
    // 의료질관리 흐름 — 재원일수·월 마감·관리도·보고서·안건·기구일수·인증(QI-FLOW-001 · 2026-10-08)
    QualityFlowModule,
    OrderSignLogModule,
    BillingModule,
    FormEngineModule,
    PharmacyModule,
    LabModule,
    ImagingModule,
    MobileModule,
    ClaimModule,
    InsuranceClaimModule,
    DashboardModule,
    NonCoveredModule,
    I18nModule,
    I18nReviewModule,
    ConsultModule,
    OperationalStatsModule,
    IntegrationOutboxModule,
    TwinModule,
    DocumentModule,
    SpecialtyCountsModule,
    DeviceUsageModule,
    FeeIntegrationModule,
    BedModule,
    InpatientModule,
    AdmissionModule,
    JourneyConsoleModule,
    EligibilityModule,
    SignIntegrationModule,
    EnvelopeKeyModule,
    SurgeryModule,
    EmergencyModule,
    EmergencyPathwayModule,
    InventoryModule,
    CssdModule,
    HrModule,
    OnboardingModule,
    EssModule,
    PreAuthModule,
    QrModule,
    NutritionModule,
    HospitalInfoModule,
    UploadModule,
    EquipmentModule,
    BotsModule,
    FhirFullModule,
    BillingAdvancedModule,
    HieModule,
    EmrCertModule,
    ExtensionModule,
    ConfigRuntimeModule,
    // PacsModule → OpenPACS 분리 → PacsProxyModule로 프록시 연동
    PacsProxyModule,
    PatientSafetyModule,
    InfectionControlModule,
    StaffQualificationModule,
    GldModule,
    PatientFlagModule,
    QualityModule,
    ConsentModule,
    EducationModule,
    AuditModule,
    PublicAccessModule,
    RbacAdminModule,
    ProblemListModule,
    AllergyModule,
    ReferenceRangeModule,
    CompoundingModule,
    ChemoModule,
    DischargeSummaryModule,
    ConsentTemplateModule,
    NursingModule,
    ClinicScheduleModule,
    WaitingQueueModule,
    KioskModule,
    EncounterTemplateModule,
    TextMacroModule,
    MedicalRecordCopyModule,
    AuditEnhancedModule,
    QuestionnaireModule,
    MedicalRecordSearchModule,
    ClinicIntegrationModule,
    OrderSetModule,
    MedicalAiModule,
    AgentSessionModule,
    IcuModule,
    CodeBlueModule,
    LisReferenceModule,
    DiagnosticTestModule,
    ExecutiveModule,
    AccessControlModule,
    VoucherModule,
    PreOrderModule,
    DoctorCodeModule,
    FormularyModule,
    ClinicalRulesModule, // 임상 규칙 대장(2026-10-21 P4)
    HumanActionsModule, // 사람 몫 할 일(2026-10-26)
    NursingRulesModule, // 간호 원내 규정·통증 재평가 대기(2026-10-26)
    DoctorsModule,
    TriageModule,
    HolidayModule,
    PatientAuthModule,
    JourneyModule,
    QiModule,
    DataQualityModule,
    // 상시 감시자 — API 에서는 **읽기 EP 만** 뜬다(스윕은 별도 프로세스 dist/sentinel.js)
    SentinelModule,
    Phase0CutoverModule,
    PortalModule,
    MedicalRecordIssuanceModule,
    ChronicModule,
    RecordTimelineModule,
    PatientScheduleModule,
    TreatmentTemplateModule,
    IntegrationGateModule,
    ChartTemplateModule,
    ClinicalChartResultModule,
    ClinicalChartVerificationModule,
    CheckupExplainerModule,
    MedicalTerminologyModule,
    FloorModule,
    PatientFlowModule,
    CredentialAdminModule,
    SimulatorModule,
    MetaverseModule,
    OrganizationModule,
    PartnerRequestModule,
    SmartClientModule,
    SmartAuthModule,
    ForeignPatientModule,
    PatientEducationModule,
    PrescriptionIssueModule,
    BedTransferModule,
    TransferModule,
    CdssModule,
    WorkgroupModule,
    BloodBankModule,
    RehabModule,
    RadiationModule,
    DialysisModule,
    DentalModule,
    OphthalmologyModule,
    DermatologyModule,
    EntModule,
    OrthopedicsModule,
    ObGynModule,
    PediatricsModule,
    SpecialtyExamModule,
    VitalsModule,
    PsychiatryModule,
    SafetyGateModule,
    OutboundChannelModule,
    DecisionModule,
    PrintIssuanceModule,
    OpeningModule,
    NeurosurgeryModule,
    PlasticModule,
    UrologyModule,
    DepositModule,
    InstallmentModule,
    InternalMedicineModule,
    SurgeryOpnoteModule,
    BurnAssessmentModule,
    CareTeamModule,
    TherapyOrderModule,
    NurseStationModule,
    BlockchainCertModule,
    DocumentSignModule,
    BlockchainAnchorModule,
    PathologyModule,
    HiraEdiModule,
    ControlledSubstanceModule,
    PacuModule,
    RiskReassessmentModule,
    NursingNoteModule,
    NotificationModule,
    CheckupModule,
    WorkstationModule,
    WorkstationSetupModule,
    ClinicalPathwayModule,
    MdtModule,
    CancerRegistryModule,
    ResearchModule,
    CostAnalysisModule,
    DutyScheduleModule,
    SatisfactionModule,
    VocModule,
    GoLiveModule,
    OmopCdmModule,
    PharmacistActivityModule,
    HospiceModule,
    TransplantModule,
    TelehealthModule,
    ConsultationModule,
    ReferralLetterModule,
    ConciergeModule,
    HomepagePopupModule,
    MediaModule,
    CmsConfigModule,
    CrmModule,
    HisModeModule,
    RemoteConsultationModule,
    PatientMessageModule, // 환자↔담당의 메시지 직원 측(2026-09-14 — 환자 메시지 수신처 0 이었다)
    RegistrationConsentModule,
    PasskeyModule,
    DeviceEnrollModule,
    SsoIdpModule,
    StepUpModule,
    TerminalModule,
    RetentionModule,
    LegalHoldModule, // 법적 보존명령(상용 릴리즈 T10-7)
    SpaceAssetModule, // 공간 자산 배치 원장(워크스테이션·PC·의료기기·장비 위치)
    FinanceBenchmarkModule, // 경영성과 벤치마크(의료기관 회계정보공시 손익 · 동급 비교)
    SpaceModelModule, // 공간 도면 가져오기·기하·길안내(spatial-flow-vision-3d P1~P3)
    WifiLocationModule, // 무선 AP 기반 원내 위치(wifi-location.v1 · 2026-10-09)
    DevDemoModule,
    StaffCallModule,
    BreakGlassModule,
    RecoveryModule,
    LifecycleModule,
    CommandCenterModule,
    HimModule,
    AiProposalModule,
    AiCallLogModule,
    AiOversightModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: GlobalExceptionFilter },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
