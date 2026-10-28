/**
 * 결정 ↔ 위원회 — **누가 정하는가**를 위원회별로 못박는다(2026-10-11).
 *
 * 🔴 발단(실측): 결정 등록부의 원내 위원회 층 180건은 결정권자를 **자유 문장**(`authority`)으로만 들고 있었다.
 *    표기가 170가지로 갈렸고, 그중 상당수는 원내에 **없는 위원회**를 가리켰다
 *    (정보보호위원회·의료기기·AI 거버넌스 위원회·인사위원회·응급의료위원회 …).
 *    그래서 "위원회 상정" 버튼은 어느 위원회에 올릴지 제안하지 못했고(빈 선택),
 *    결정 화면은 결정을 위원회로 묶어 볼 수 없었다.
 *
 * 이 파일은 두 가지를 정한다.
 *  ① 위원회 9곳 각각의 **결정권한자** — 위원장·간사·당연직 위원(직책)·의결 요건·확인 담당
 *  ② 원내 위원회 층 결정마다 **주관 위원회**(하나)와 **합동 위원회**(0개 이상)
 *
 * 🔴 위원회는 **기존 9곳(거버넌스 시드 코드)만** 쓴다 — 원내에 없는 위원회를 지어내지 않는다.
 *    문장에 나온 없는 위원회는 성격에 따라 9곳에 흡수했다(개인정보·보안·전산·인사·원무 → 운영위원회 OPS,
 *    AI·의료기기 성능 → 질향상·환자안전위원회 QPS — 표면 담당 시드가 AI 기능 6종을 이미 QPS 에 두었다).
 * 🔴 직책 구성은 **개발 시드 제안**이다 — 원내 위원회 규정(헌장)으로 확정해야 하고,
 *    시스템은 위원의 실제 직책을 **검증하지 못한다**(명부 임명 기록만 본다).
 * 🔴 허가권자·직원 층은 위원회를 거치지 않는다 — 위원회가 그 층을 대신 정하지 못한다(하위가 상위를 대체하지 못한다).
 */

export const COMMITTEE_CODES = ['DTC', 'IC', 'MRC', 'QPS', 'TRF', 'ETH', 'NUT', 'SAFE', 'OPS'] as const;
export type CommitteeCode = (typeof COMMITTEE_CODES)[number];

export interface CommitteeAuthority {
  code: CommitteeCode;
  /** 거버넌스 시드 이름과 같아야 한다(가드가 대조) */
  name: string;
  /** 무엇을 정하는가 */
  scope: string;
  /** 의결을 선포하는 사람 */
  chair: string;
  /** 안건 접수·회의 배정·회의록 — ②·③ 단계를 움직이는 사람 */
  secretary: string;
  /** 당연직 위원(직책) — 의결권이 있다 */
  exOfficio: string[];
  /** 정족수 — 거버넌스 시드 `quorum` 과 같아야 한다(가드가 대조) */
  quorum: number;
  /** 의결 요건 — 사람이 지키는 규칙 */
  votingRule: string;
  /** ⑦ 확인 — 실제 동작을 확인하는 사람(시스템은 세지 않는다) */
  verifier: string;
}

/** 🔴 시스템이 실제로 검사하는 것 — 위원회 규칙 문장과 섞지 않는다(검사하지 않는 것을 검사하는 것처럼 말하지 않는다) */
export const COMMITTEE_SYSTEM_CHECKS: readonly string[] = [
  '회의 참석자 수가 정족수 이상인지(미만이면 의결 거부)',
  '참석자가 위원 명부에 있는지(기본 경고 — governance.quorumRosterGate)',
  '선택지가 있는 안건은 선택지를 골라야 의결된다',
  '결정 등록부 안건은 등록부가 정한 주관·합동 위원회에만 올릴 수 있다',
];
export const COMMITTEE_NOT_CHECKED: readonly string[] = [
  '찬성이 과반인지 — 찬성·반대·기권 수는 기록만 한다',
  '위원의 실제 직책 — 명부 임명 기록만 본다',
  '의결을 화면에 입력하는 계정은 관리자(ADMIN)다 — 의결한 사람이 아니라 기록한 사람이다',
];

const MAJORITY = (q: number) => `재적 위원 과반 출석(시스템 정족수 ${q}명) · 출석 위원 과반 찬성 · 가부 동수면 위원장이 정한다`;

export const COMMITTEE_AUTHORITIES: Record<CommitteeCode, CommitteeAuthority> = {
  DTC: {
    code: 'DTC', name: '약사위원회', quorum: 5,
    scope: '처방·조제·투약 정책 — 원내 처방집·DUR·마약류·처방 중단/갱신·퇴원약',
    chair: '진료부장',
    secretary: '약제부장',
    exOfficio: ['약제부장', '내과계 진료과장', '외과계 진료과장', '간호부장', '마약류관리자', '보험심사 책임자'],
    votingRule: MAJORITY(5),
    verifier: '약제부장',
  },
  IC: {
    code: 'IC', name: '감염관리위원회', quorum: 5,
    scope: '감염 감시·격리·기구일수·접촉자·미생물 보고',
    chair: '병원장',
    secretary: '감염관리실장',
    exOfficio: ['감염관리실장', '감염내과 전문의', '진단검사의학과장', '간호부장', '시설 책임자'],
    votingRule: MAJORITY(5),
    verifier: '감염관리실장',
  },
  MRC: {
    code: 'MRC', name: '의무기록위원회', quorum: 4,
    scope: '진료기록·서식·코드 마스터·기록 보존·음성/초안 기록·서류 발급',
    chair: '진료부장',
    secretary: '의무기록 책임자',
    exOfficio: ['의무기록 책임자', '간호부장', '원무팀장', '의료정보팀장', '개인정보보호책임자(CPO)'],
    votingRule: MAJORITY(4),
    verifier: '의무기록 책임자',
  },
  QPS: {
    code: 'QPS', name: '질향상·환자안전위원회', quorum: 5,
    scope: '의료 질 지표·인증·임상 기준·AI 임상 기능·환자 여정 정의',
    chair: '병원장',
    secretary: '의료질관리실장',
    exOfficio: ['진료부장', '간호부장', '약제부장', '의료질관리실장', '환자안전 전담인력', '의료정보팀장(AI 기능 안건)'],
    votingRule: MAJORITY(5),
    verifier: '의료질관리실장',
  },
  TRF: {
    code: 'TRF', name: '수혈위원회', quorum: 4,
    scope: '혈액 출고·교차시험·베드사이드 확인·혈액 재고',
    chair: '진단검사의학과장',
    secretary: '혈액은행 책임 임상병리사',
    exOfficio: ['진단검사의학과장', '마취통증의학과장', '외과계 진료과장', '간호부 대표'],
    votingRule: MAJORITY(4),
    verifier: '진단검사의학과장',
  },
  ETH: {
    code: 'ETH', name: '병원윤리위원회', quorum: 5,
    scope: '임상 윤리·연구 윤리(IRB 운영)·동의 게이트',
    chair: '병원장이 지명한 위원',
    secretary: '의료질관리실',
    exOfficio: ['진료부장', '간호부장', '외부 위원(법조·윤리)', '사회사업 담당'],
    votingRule: MAJORITY(5),
    verifier: '위원장',
  },
  NUT: {
    code: 'NUT', name: '영양위원회', quorum: 3,
    scope: '식이 오더·금식(NPO)·영양 선별·급양 운영',
    chair: '진료부장이 지명한 임상 의사',
    secretary: '영양팀장',
    exOfficio: ['영양팀장', '간호부 대표', '약제부 대표'],
    votingRule: MAJORITY(3),
    verifier: '영양팀장',
  },
  SAFE: {
    code: 'SAFE', name: '안전관리위원회', quorum: 4,
    scope: '환자안전사고 보고·위해 척도·위급값 상향·경보 라우팅·낙상/욕창 재평가·조영제/방사선 안전',
    chair: '진료부원장',
    secretary: '환자안전 전담인력',
    exOfficio: ['간호부장', '약제부장', '영상의학과장', '진단검사의학과장'],
    votingRule: MAJORITY(4),
    verifier: '환자안전 전담인력',
  },
  OPS: {
    code: 'OPS', name: '운영위원회', quorum: 4,
    scope: '원무·청구·인사·재무·시설·전산·개인정보·보안·대외 연동·제품 범위',
    chair: '병원장',
    secretary: '행정부장(경영기획)',
    exOfficio: ['원무팀장', '전산팀장', '개인정보보호책임자(CPO)', '정보보호책임자(CISO)', '재무 책임자', '간호부장'],
    votingRule: MAJORITY(4),
    verifier: '행정부장(경영기획)',
  },
};

/** 위원회를 거치지 않는 층의 결정권한자 — 위원회 표와 나란히 보여 주되 섞지 않는다 */
export const NON_COMMITTEE_AUTHORITIES = {
  LICENSE_HOLDER: {
    label: '허가권자 — 법적 운영 요건',
    holders: ['개설자·병원장', '개인정보보호책임자(CPO)', '정보보호책임자(CISO)', '법무'],
    rule: '항목에 적힌 직책이 근거 문서를 첨부해 기록한다 — 위원회 의결로 대신할 수 없다',
  },
  STAFF: {
    label: '직원 — 건별 현장 판단',
    holders: ['업무 화면의 담당 직원'],
    rule: '업무 화면의 승인 다이얼로그에서 건별로 정한다 — 설정을 바꾸지 못한다',
  },
} as const;

/**
 * 원내 위원회 층 결정 → `[주관, ...합동]`.
 * 🔴 합동은 그 위원회 **의견을 받는다**는 뜻이다 — 안건은 주관·합동 어디에든 올릴 수 있고, 의결은 올린 위원회가 한다.
 * 근거: 등록부 `authority` 문장 · 표면 담당 시드(`config:` 키가 있으면 그 위원회가 주관) · 결정 성격.
 */
export const DECISION_COMMITTEE_ASSIGNMENT: Readonly<Record<string, readonly [CommitteeCode, ...CommitteeCode[]]>> = {
  // ── DTC 주관 16
  'pharmacy.splitDispensingSchema': ['DTC', 'OPS'],
  'pharmacy.prescriptionValidityBasis': ['DTC'],
  'policy.gate.narcoticRx': ['DTC'],
  'policy.formulary.fourEyes': ['DTC'],
  'policy.portal.medicationInfoExposure': ['DTC', 'OPS'],
  'policy.master.englishNameSource': ['DTC'],
  'policy.order.reasonPresets': ['DTC'],
  'policy.controlledSubstance.prescriberSource': ['DTC'],
  'space.assets.controlledSubstance': ['DTC', 'OPS'],
  'order.discontinue.billingQuantity': ['DTC', 'OPS'],
  'order.discontinue.onDeath': ['DTC'],
  'order.renewal.autoExpire': ['DTC'],
  'order.renewal.noEndReviewDays': ['DTC'],
  'discharge.stopInpatientMedsOnDischarge': ['DTC'],
  'discharge.medsDispensedForReady': ['DTC', 'OPS'],
  'rx.external.verifyDisclosure': ['DTC', 'OPS'],
  // ── IC 주관 4
  'policy.microbiology.scope': ['IC'],
  'policy.reporting.externalSubmitterIdentity': ['IC'],
  'infection.contactCandidates': ['IC'],
  'qi.deviceDays.source': ['IC'],
  // ── MRC 주관 26
  'policy.catalogOwnership': ['MRC', 'DTC', 'OPS'],
  'policy.vitalsSourceMeta': ['MRC', 'OPS'],
  'draft.cacheTtl': ['MRC', 'OPS'],
  'draft.visibility': ['MRC'],
  'draft.retention': ['MRC'],
  'draft.certificatePrewrite': ['MRC'],
  'draft.phraseSharing': ['MRC'],
  'draft.personalLayout': ['MRC'],
  'draft.sampleApproval': ['MRC'],
  'codes.newCodeApproval': ['MRC', 'OPS'],
  'identity.documentSnapshot': ['MRC'],
  'identity.unsetIssuance': ['MRC', 'OPS'],
  'policy.mrn.numbering': ['MRC', 'OPS'],
  'policy.term.displayDefaults': ['MRC', 'OPS'],
  'policy.voice.readOpen': ['MRC', 'OPS'],
  'policy.voice.dictateWriteScope': ['MRC'],
  'policy.voice.guardianSpeech': ['MRC', 'OPS'],
  'policy.scribe.transcriptRetentionDays': ['MRC', 'OPS'],
  'nursing.lateEntry.graceMinutes': ['MRC'],
  'imaging.radiologistIdentity': ['MRC'],
  'lis.panelEdiMapping': ['MRC'],
  'safety.poaFlag': ['MRC', 'QPS'],
  'qi.docIssuance.slaHours': ['MRC', 'OPS'],
  'print.verify.publicScope': ['MRC'],
  'print.issue.phiRetention': ['MRC'],
  'documents.fee.billingLink': ['MRC', 'OPS'],
  // ── QPS 주관 51
  'policy.ai.autonomyScope': ['QPS'],
  'policy.labResult.staffNotify': ['QPS'],
  'policy.loopspec.adopt': ['QPS', 'OPS'],
  'policy.loopspec.lifecycleAuthority': ['QPS'],
  'policy.aiQualityThreshold': ['QPS'],
  'qi.waitThresholdUnify': ['QPS', 'OPS'],
  'policy.ai.clinicalFeatureScope': ['QPS'],
  'schema.pressureUlcer.reassessment': ['QPS'],
  'i18n.reviewOwnership': ['QPS', 'OPS'],
  'i18n.safetyStringTranslation': ['QPS', 'DTC'],
  'i18n.packActivationCriteria': ['QPS', 'OPS'],
  'qi.measurementSource': ['QPS', 'IC'],
  'release.emrCertification': ['QPS', 'OPS'],
  'release.saleLanguages': ['QPS', 'OPS'],
  'ai.draftProvenanceSchema': ['QPS'],
  'policy.lab.referenceRangeSource': ['QPS', 'MRC'],
  'policy.er.reassessNotify': ['QPS'],
  'policy.monitor.notesAndNotify': ['QPS', 'OPS'],
  'policy.accreditation.cctv': ['QPS', 'OPS'],
  'policy.ui.accessibilityDefaults': ['QPS'],
  'policy.workflow.procedureBypassViaUpdate': ['QPS', 'ETH', 'OPS'],
  'policy.clinical.gateOverrideAuthority': ['QPS', 'DTC'],
  'policy.clinical.actorAttribution': ['QPS'],
  'space.drawingExtract.provider': ['QPS', 'OPS'],
  'space.drawingExtract.acceptance': ['QPS', 'OPS'],
  'er.arrival.recordRequirement': ['QPS'],
  'order.entryScope.policy': ['QPS', 'OPS'],
  'education.understandingRequired': ['QPS'],
  'discharge.educationForReady': ['QPS', 'OPS'],
  'pacu.dischargeCriteria': ['QPS'],
  'journey.backfillOccurredAt': ['QPS', 'MRC'],
  'journey.erToAdmissionBoundary': ['QPS'],
  'journey.emitDurability': ['QPS', 'OPS'],
  'journey.userClaimedInMetrics': ['QPS'],
  'journey.outpatientEnd': ['QPS', 'OPS'],
  'emergency.departureTimeSource': ['QPS'],
  'surgery.durationDefinition': ['QPS', 'OPS'],
  'quality.readmission30Definition': ['QPS'],
  'or.recording.requestFlow': ['QPS', 'OPS'],
  'or.recording.retentionAccess': ['QPS', 'OPS'],
  'or.procedureVideo': ['QPS', 'OPS'],
  'qi.autoMeasure.denominator': ['QPS'],
  'qi.autoMeasure.enable': ['QPS'],
  'qi.autoManual.precedence': ['QPS'],
  'qi.indicator.directEdit': ['QPS'],
  'accreditation.framework': ['QPS'],
  'qi.staffRoleModel': ['QPS'],
  'qi.hiraIndicatorSet': ['QPS'],
  'doctor.inbox.dueHours': ['QPS'],
  'nursing.io.noOutputAlertHours': ['QPS'],
  'pediatrics.growth.reference': ['QPS'],
  // ── ETH 주관 1
  'governance.irb.operation': ['ETH', 'OPS'],
  // ── NUT 주관 2
  'policy.nutrition.npoAndScreening': ['NUT'],
  'order.entryScope.dietitian': ['NUT'],
  // ── SAFE 주관 13
  'policy.criticalValue.patientNotify': ['SAFE'],
  'policy.alertRouting': ['SAFE', 'DTC'],
  'policy.clinicalChartLibrary.exposure': ['SAFE'],
  'policy.criticalValue.escalation': ['SAFE'],
  'policy.journey.patientExposure': ['SAFE', 'OPS'],
  'policy.allergy.assessment': ['SAFE', 'DTC'],
  'policy.device.pilotAndCalibration': ['SAFE'],
  'pacu.vitalAlertThresholds': ['SAFE'],
  'journey.unexposedRecording': ['SAFE', 'IC', 'OPS'],
  'safety.anonymousReport': ['SAFE'],
  'safety.harmLevelScale': ['SAFE'],
  'nursing.reassessment.autoScheduleOnAdmission': ['SAFE'],
  'nursing.initialAssessment.bradenInput': ['SAFE', 'QPS'],
  // ── OPS 주관 74
  'governance.decisionConfigGuard': ['OPS'],
  'print.issue.roles': ['OPS'],
  'governance.registerPeriodicIssue': ['OPS'],
  'governance.devEnactmentConfirmer': ['OPS'],
  'governance.seedImplementedPolicy': ['OPS'],
  'policy.copay.rounding': ['OPS', 'MRC'],
  'policy.patientPush.enable': ['OPS'],
  'policy.metrics.upstreamScope': ['OPS'],
  'draft.cacheKeyScope': ['OPS'],
  'draft.staffInitiatedFee': ['OPS'],
  'i18n.unwiredScreenScope': ['OPS'],
  'country.slotScope': ['OPS'],
  'country.settingExposure': ['OPS'],
  'country.codeCanonLocation': ['OPS'],
  'billing.paymentRefReconciliation': ['OPS'],
  'billing.discountAuthorization': ['OPS'], // 2026-10-14 배치 10-I — 수납 감면 권한·상한
  'billing.unpricedLinePolicy': ['OPS'], // 2026-10-14 배치 10-I — 미등재 단가 라인
  'billing.depositRefundRestore': ['OPS'], // 2026-10-14 배치 10-I — 선수금 환불 복원
  'portal.costEstimate': ['OPS'], // 2026-10-20 배치 10-J — 포털 예상 진료비
  'portal.visitSummaryScope': ['MRC'], // 2026-10-20 배치 10-J — 진료 후 요약 범위
  'portal.labResultRelease': ['MRC', 'QPS'], // 2026-10-20 배치 10-J — 검사 결과 공개 시점
  'portal.patientReportedVitals': ['QPS', 'MRC'], // 2026-10-20 배치 10-J — 가정 측정 값
  'patient.listScopeByRole': ['MRC', 'OPS'], // 2026-10-20 배치 10-K — 환자 목록 역할 범위(원내 정보보호 위원회 없음 → MRC 주관)
  'patient.contactSearch': ['MRC', 'OPS'], // 2026-10-20 배치 10-K — 전화번호로 찾기
  'patient.dormantDefinition': ['OPS', 'MRC'], // 2026-10-20 배치 10-K — 휴면 정의
  'patient.photoPolicy': ['OPS', 'SAFE'], // 2026-10-20 배치 10-K — 환자 사진
  'patient.mergeReversal': ['MRC'], // 2026-10-20 배치 10-K — 병합 되돌리기
  'access.roleDataAccess.scope': ['MRC', 'OPS'], // 2026-10-20 배치 10-K — 역할 데이터 접근 설정 범위
  'catalog.ownership': ['OPS'], // 2026-10-21 배치 10-L — 임상 카탈로그 소유 위원회
  'catalog.activeEdit': ['DTC', 'MRC'], // 2026-10-21 배치 10-L — 사용 중 세트 수정
  'cdss.legacyRules': ['DTC'], // 2026-10-21 배치 10-L — 옛 CDSS 규칙 17건
  'orderSet.nurseUse': ['DTC', 'OPS'], // 2026-10-21 배치 10-L — 간호사 약속처방 사용
  'triage.ruleAuthority': ['OPS', 'SAFE'], // 2026-10-21 배치 10-L — 접수 상담 규칙 수정 권한
  'prescription.delegatePolicy': ['MRC', 'DTC'], // 2026-10-21 배치 10-L — 위임 처방(허가권자 검토 후)
  'clinicalChart.verifyPolicy': ['QPS', 'MRC'], // 2026-10-21 배치 10-L — 임상도구 검수 승인 수
  'policy.evidenceExtract.enable': ['OPS'],
  'governance.quorumRosterGate': ['OPS'],
  'identity.canonSource': ['OPS'],
  'release.deploymentForm': ['OPS'],
  'release.externalTransmitScope': ['OPS'],
  'release.versionScheme': ['OPS'],
  'policy.careTeam.accessModel': ['OPS'],
  'policy.voucher.settlement': ['OPS'],
  'policy.healthContent.medicalReview': ['OPS'],
  'policy.disasterRecovery': ['OPS'],
  'policy.consent.requiredBeforeIntake': ['OPS'],
  'policy.consent.translation': ['OPS'],
  'policy.db.unappliedIndexes': ['OPS'],
  'policy.facilityInfo.floorGuide': ['OPS'],
  'policy.security.patientPasswordRules': ['OPS'],
  'policy.security.keyCustody': ['OPS'],
  'policy.telehealth.operations': ['OPS'],
  'policy.portal.disclaimerAndAccessibility': ['OPS'],
  'policy.notify.quietHours': ['OPS'],
  'policy.audit.diagnosisFreeText': ['OPS'],
  'policy.terminal.bindingAndPrint': ['OPS'],
  'policy.integration.erpHr': ['OPS'],
  'release.productName': ['OPS'],
  'policy.er.publicCongestion': ['OPS'],
  'policy.security.firstLoginPasswordChange': ['OPS'],
  'policy.security.passwordChangeLockout': ['OPS'],
  'policy.billing.installmentRules': ['OPS'],
  'policy.billing.installmentViewRoles': ['OPS'],
  'policy.crm.automatedOutreach': ['OPS'],
  'policy.crm.checkupProxyScope': ['OPS'],
  'policy.integration.clinicAccountIssuance': ['OPS'],
  'policy.rbac.checkupScreensForDoctor': ['OPS'],
  'policy.db.migrationHistoryAdoption': ['OPS'],
  'policy.workflow.operationalStateTransitions': ['OPS', 'NUT'],
  'seed.rehearsalFeatureDefaults': ['OPS', 'DTC'],
  'mode.essErpPull': ['OPS'],
  'ops.rehearsalOutboxAtCutover': ['OPS'],
  'policy.voice.aiDraftOn': ['OPS'],
  'policy.inventory.duplicateSubmit': ['OPS'],
  'policy.cssd.partialReceiptResend': ['OPS'],
  'space.geometry.confirmAuthority': ['OPS'],
  'location.inferred.display': ['OPS'],
  'wayfinding.patientExposure': ['OPS'],
  'space.assets.readRoles': ['OPS'],
  'er.arrival.belongingsCustody': ['OPS'],
  'pacu.icuWardBedHold': ['OPS'],
  'bedTransfer.requireAcceptance': ['OPS'],
  'bedTransfer.reserveOnRequest': ['OPS'],
  'journey.performerObjects': ['OPS'],
  'journey.demoSeparation': ['OPS'],
  'auth.staffIdleTimeout': ['OPS'],
  'integration.eapprovalUndeliveredBacklog': ['OPS'],
  'integration.clinicSsoRedesign': ['OPS'],
  'integration.clinicSsoLegacyTokenCutoff': ['OPS'],
  'location.wifi.consentMethod': ['OPS'],
  'location.wifi.calibration': ['OPS', 'IC'],
  'notification.patientPush.documentReady': ['OPS'],
  'notification.patientPush.documentRejected': ['OPS'],
  'location.wifi.autoUnbindOnEnd': ['OPS'],
};

export interface DecisionCommitteeRef { lead: CommitteeCode; joint: CommitteeCode[] }

/** 결정의 주관·합동 위원회 — 원내 위원회 층이 아니면 `null`(위원회를 거치지 않는다) */
export function decisionCommitteeOf(key: string): DecisionCommitteeRef | null {
  const a = DECISION_COMMITTEE_ASSIGNMENT[key];
  return a ? { lead: a[0], joint: a.slice(1) as CommitteeCode[] } : null;
}

/** 이 위원회가 이 결정의 안건을 받을 수 있는가(주관 또는 합동) */
export function committeeMayDecide(key: string, code: string | null | undefined): boolean {
  const a = DECISION_COMMITTEE_ASSIGNMENT[key];
  return !!a && !!code && (a as readonly string[]).includes(code);
}

// ─────────────────────────────────────────────────────────────────────────────
// 결정권한자 표의 **기록** — 2026-10-11 사용자 "결정권한자 표도 시드 데이터로 확정해둘것"
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 🔴 위 `COMMITTEE_AUTHORITIES` 는 **정의(제안)** 이고, 병원이 그 표를 채택했다는 사실은 **기록**이다 — 둘은 다른 사실이다.
 *    기록은 `system_configs` 의 이 키에 남는다. 개발·리허설에서는 시드가 정의를 그대로 **개발 시드(DEV-SEED)** 로 기록해 둔다
 *    (위원회 결정 시드와 같은 규칙 — 없을 때만 · 실채택으로 세지 않는다 · 원내 위원회 규정으로 바꿔 적어야 실채택이다).
 */
export const committeeAuthorityConfigKey = (code: CommitteeCode) => `governance.committeeAuthority.${code}`;
export const COMMITTEE_AUTHORITY_SEED_REF = '개발 시드(DEV-SEED) — 2026-10-11 사용자 지시(원내 위원회 규정 채택 전)';

export interface CommitteeAuthorityRecord {
  chair: string;
  secretary: string;
  exOfficio: string[];
  votingRule: string;
  verifier: string;
  /** 채택 근거 — 위원회 규정 문서 번호·의결 번호 등 · 개발 시드는 `DEV-SEED` 표식 */
  basisRef: string;
  recordedAt: string;
  recordedByUserId?: string;
}

/** 정의를 개발 시드 기록으로 — 시드와 운영 SQL 이 **같은 함수**로 만든다(값이 둘로 갈라지지 않게) */
export function committeeAuthoritySeedRecord(code: CommitteeCode, recordedAt: string): CommitteeAuthorityRecord {
  const a = COMMITTEE_AUTHORITIES[code];
  return {
    chair: a.chair, secretary: a.secretary, exOfficio: [...a.exOfficio], votingRule: a.votingRule, verifier: a.verifier,
    basisRef: COMMITTEE_AUTHORITY_SEED_REF, recordedAt,
  };
}

export const COMMITTEE_AUTHORITY_SEED_RE = /DEV-SEED|개발 시드/i;

/** 저장된 값 → 기록(모양이 다르면 `null` — 지어내지 않는다) */
export function readCommitteeAuthorityRecord(raw: unknown): CommitteeAuthorityRecord | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const str = (k: string) => typeof r[k] === 'string' && (r[k] as string).trim().length > 0;
  if (!['chair', 'secretary', 'votingRule', 'verifier', 'basisRef', 'recordedAt'].every(str)) return null;
  if (!Array.isArray(r.exOfficio) || !r.exOfficio.every((x) => typeof x === 'string')) return null;
  return r as unknown as CommitteeAuthorityRecord;
}

/** 기록 상태 — `RECORDED`(원내 채택) · `DEV_SEED`(개발 시드로 확정) · `NONE`(기록 없음 — 정의만) · `INVALID`(모양이 다름) */
export type CommitteeAuthoritySource = 'RECORDED' | 'DEV_SEED' | 'NONE' | 'INVALID';
export function committeeAuthoritySourceOf(raw: unknown): CommitteeAuthoritySource {
  if (raw == null) return 'NONE';
  const rec = readCommitteeAuthorityRecord(raw);
  if (!rec) return 'INVALID';
  return COMMITTEE_AUTHORITY_SEED_RE.test(rec.basisRef) ? 'DEV_SEED' : 'RECORDED';
}
