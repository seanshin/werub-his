/**
 * 결정 등록부 — 영역 안의 **세부 분류** 정본(2026-10-12).
 *
 * 사용자 요청: "기본 설정은 의료법인의 기본설정, 시스템 설정, 행정 설정 등으로 · 의료도 의료 행정과 의료법, 규제, 질 등으로 ·
 *   운영도 행정운영, 의료운영, 질관련운영, 환자환경 등으로 · 행정도 행정규제, 행정편의, 행정프로세스 등으로 ·
 *   정보보호·보안도 규제와 내부보안규정 등으로 구분할 것."
 *
 * 🔴 세부 분류는 영역(`decision-domains.ts`)을 **나눌 뿐 바꾸지 않는다** — 세부 분류는 반드시 그 결정의 영역에 속한다(가드).
 * 🔴 정하는 순서: 키 단위 예외 → 축·층 규칙 → 영역 기본. 예외는 키마다 이유(api 테스트가 키 실재·영역 소속을 대조한다).
 * 🔴 "등"으로 열어 둔 자리 — 요청 목록에 없는 묶음은 두 개만 더했다(의료 '임상 진료' · 운영 '시스템·AI 운영').
 *    의료 결정 80건 대부분이 진료 기준(퇴실 점수·재평가·처방 중단)이라 행정·법·규제·질 어디에 넣어도 거짓 분류가 된다.
 */
import type { DecisionDomain } from './decision-domains';

export const DECISION_SUBDOMAINS: ReadonlyArray<{ key: string; domain: DecisionDomain; label: string; description: string }> = [
  // 기본 설정
  { key: 'F_CORPORATE', domain: 'FOUNDATION', label: '의료법인 기본설정', description: '기관 정체성·요양기관 종별·국가·관할·위원회 거버넌스' },
  { key: 'F_SYSTEM', domain: 'FOUNDATION', label: '시스템 설정', description: '운영 모드·시드·제품 범위·화면 언어·결정 보호' },
  { key: 'F_ADMIN', domain: 'FOUNDATION', label: '행정 설정', description: '코드 마스터·카탈로그·용어 사전·참조 원천' },
  // 의료
  { key: 'M_CLINICAL', domain: 'MEDICAL', label: '임상 진료', description: '진료·간호·투약·퇴원·회복실 기준' },
  { key: 'M_ADMIN', domain: 'MEDICAL', label: '의료 행정', description: '전동·기록 작성 지원·알림 경로·저장 구조·표시 범위' },
  { key: 'M_LAW', domain: 'MEDICAL', label: '의료법', description: '면허 범위·처방전·진료기록 작성자 — 의료법 직접 요건' },
  { key: 'M_REGULATION', domain: 'MEDICAL', label: '규제', description: '마약류·의료기기·인증·심평원 평가·환자안전 보고' },
  { key: 'M_QUALITY', domain: 'MEDICAL', label: '질', description: '질 지표 정의·산출·환자안전사고·방문 정의' },
  // 운영
  { key: 'O_ADMIN', domain: 'OPERATIONS', label: '행정운영', description: '도면·공간 모델·행정 증빙 판독·장비 위치 기록' },
  { key: 'O_MEDICAL', domain: 'OPERATIONS', label: '의료운영', description: '임상 AI·비대면 진료·환자 위치 측위' },
  { key: 'O_QUALITY', domain: 'OPERATIONS', label: '질관련운영', description: 'AI 품질 임계·기록 유실 대응·관제·대외 감시 보고' },
  { key: 'O_PATIENT_ENV', domain: 'OPERATIONS', label: '환자환경', description: '환자 앱·알림·포털·원내 안내·공개 정보' },
  { key: 'O_SYSTEM', domain: 'OPERATIONS', label: '시스템·AI 운영', description: 'DB·재해 복구·루프 플랫폼·AI 자동실행·데이터 전송 경계' },
  // 행정
  { key: 'A_REGULATION', domain: 'ADMIN', label: '행정규제', description: '청구·검진권 법정 기준·본인부담 산정·청구 수량' },
  { key: 'A_CONVENIENCE', domain: 'ADMIN', label: '행정편의', description: '증명서 미리 작성·자동 연락·조회 범위·수납 연결' },
  { key: 'A_PROCESS', domain: 'ADMIN', label: '행정프로세스', description: '원무 접수·발번·ERP·결재·구매·입고·분납·대사' },
  // 정보보호·보안
  { key: 'S_REGULATION', domain: 'SECURITY', label: '규제', description: '개인정보·위치·영상·생체정보·보존기간 — 법적 근거와 동의' },
  { key: 'S_INTERNAL', domain: 'SECURITY', label: '내부보안규정', description: '인증·비밀번호·키·SSO·역할 열람 범위·단말' },
];

/** 키 단위 예외 — 축·층 규칙과 성격이 다른 결정(이유 한 줄) */
export const DECISION_SUBDOMAIN_OVERRIDES: Readonly<Record<string, string>> = {
  // ── 기본 설정
  'billing.institutionType': 'F_CORPORATE', // 요양기관 종별 = 기관 속성
  'governance.decisionConfigGuard': 'F_SYSTEM', // 결정에 묶인 설정의 보호 수준 — 시스템 설정
  'print.issue.roles': 'F_SYSTEM', // 인쇄본 발급 역할 — 시스템 권한
  'governance.registerPeriodicIssue': 'F_ADMIN', // 결정 대장 정기 발급 — 행정 설정
  'governance.devEnactmentConfirmer': 'F_SYSTEM', // 개발 반영 확인자 — 시스템 거버넌스
  'governance.seedImplementedPolicy': 'F_SYSTEM', // 시드대로 구현된 동작 처리 원칙
  'release.emrCertification': 'F_SYSTEM', // 제품 범위 선언
  'release.externalTransmitScope': 'F_SYSTEM',
  'country.codeCanonLocation': 'F_SYSTEM', // 국가 코드 정본 위치 — 시스템 구조
  'country.slotScope': 'F_SYSTEM', // 국가별 화면 슬롯 범위
  'country.settingExposure': 'F_SYSTEM', // 기관 세팅 화면 노출 범위
  'country.procedureCodeSystem': 'F_ADMIN', // 처치·수가 코드 체계 이름 — 코드 마스터
  'policy.consent.translation': 'F_ADMIN', // 동의서 번역판 — 서식 관리
  // ── 의료
  'rx.external.transmission': 'M_LAW', // 원외처방전 전자 전송 — 의료법 처방전 요건
  'rx.external.verifyDisclosure': 'M_LAW',
  'pharmacy.prescriptionValidityBasis': 'M_LAW', // 처방전 유효기간 근거
  'imaging.radiologistIdentity': 'M_LAW', // 판독 기록 작성자 — 진료기록 작성 책임
  'policy.clinical.actorAttribution': 'M_LAW', // 시행자·책임 의사 지정 — 기록 책임자
  'order.entryScope.policy': 'M_LAW', // 비의사 직종 오더 범위 — 면허 범위
  'order.entryScope.dietitian': 'M_LAW',
  'legal.device.softwareClass': 'M_REGULATION', // 의료기기 해당 여부
  'safety.kopsTransmit': 'M_REGULATION', // 환자안전법 보고
  'policy.controlledSubstance.prescriberSource': 'M_REGULATION', // 마약류관리법
  'policy.gate.narcoticRx': 'M_REGULATION',
  'space.assets.controlledSubstance': 'M_REGULATION', // 마약류 금고 위치
  'accreditation.framework': 'M_REGULATION', // 인증 체계
  'policy.accreditation.cctv': 'M_REGULATION',
  'qi.hiraIndicatorSet': 'M_REGULATION', // 심평원 적정성 평가
  'bedTransfer.requireAcceptance': 'M_ADMIN', // 병동 간 전동 절차
  'bedTransfer.reserveOnRequest': 'M_ADMIN',
  'pacu.icuWardBedHold': 'M_ADMIN', // 병상 운영
  'doctor.inbox.dueHours': 'M_ADMIN', // 할 일함 처리 기한
  'er.arrival.belongingsCustody': 'M_ADMIN', // 소지품 보관 절차
  'er.arrival.recordRequirement': 'M_ADMIN',
  'policy.order.reasonPresets': 'M_ADMIN', // 사유 문안
  'pharmacy.splitDispensingSchema': 'M_ADMIN', // 저장 구조
  'schema.pressureUlcer.reassessment': 'M_ADMIN',
  'policy.vitalsSourceMeta': 'M_ADMIN',
  'policy.alertRouting': 'M_ADMIN', // 경보 라우팅표
  'policy.labResult.staffNotify': 'M_ADMIN',
  'policy.criticalValue.patientNotify': 'M_ADMIN',
  'policy.voice.dictateWriteScope': 'M_ADMIN', // 구술 기록 범위
  'policy.voice.guardianSpeech': 'M_ADMIN',
  'policy.voice.readOpen': 'M_ADMIN',
  'policy.clinicalChartLibrary.exposure': 'M_ADMIN',
  'policy.portal.medicationInfoExposure': 'M_ADMIN',
  'location.inferred.display': 'M_ADMIN',
  'or.procedureVideo': 'M_ADMIN', // 장비 영상 연결
  // ── 운영
  'policy.ai.clinicalFeatureScope': 'O_MEDICAL',
  'ai.draftProvenanceSchema': 'O_MEDICAL', // 임상 기록의 AI 초안 출처
  'policy.voice.aiDraftOn': 'O_MEDICAL', // 진료 대화 AI 초안
  'legal.ai.deviceClassification': 'O_MEDICAL',
  'location.wifi.calibration': 'O_MEDICAL', // 환자 위치 측위
  'policy.telehealth.operations': 'O_MEDICAL',
  'policy.aiQualityThreshold': 'O_QUALITY',
  'policy.reporting.externalSubmitterIdentity': 'O_QUALITY', // 감염 감시 대외 보고
  'journey.emitDurability': 'O_QUALITY', // 기록 유실 대응
  'policy.monitor.notesAndNotify': 'O_QUALITY',
  'policy.evidenceExtract.enable': 'O_ADMIN', // 행정 증빙 판독
  'space.drawingExtract.acceptance': 'O_ADMIN',
  'space.drawingExtract.provider': 'O_ADMIN',
  'space.geometry.confirmAuthority': 'O_ADMIN',
  'space.assets.legacyText': 'O_ADMIN',
  'space.floorApi.fallbackGeometry': 'O_ADMIN',
  'policy.facilityInfo.floorGuide': 'O_PATIENT_ENV', // 환자 층별 안내
  'policy.portal.disclaimerAndAccessibility': 'O_PATIENT_ENV',
  'mobile.appStoreRelease': 'O_PATIENT_ENV', // 환자 앱 배포
  'policy.ai.autonomyScope': 'O_SYSTEM',
  'legal.aiEgress.transferScope': 'O_SYSTEM',
  // ── 행정
  'policy.copay.rounding': 'A_REGULATION', // 본인부담 산정
  'order.discontinue.billingQuantity': 'A_REGULATION', // 청구 수량
  'draft.certificatePrewrite': 'A_CONVENIENCE',
  'draft.staffInitiatedFee': 'A_CONVENIENCE',
  'documents.fee.billingLink': 'A_CONVENIENCE',
  'policy.crm.automatedOutreach': 'A_CONVENIENCE',
  'policy.billing.installmentViewRoles': 'A_CONVENIENCE',
  'mode.essErpPull': 'A_CONVENIENCE', // 리허설 ERP 조회
  // ── 정보보호·보안
  'policy.careTeam.accessModel': 'S_INTERNAL', // 원내 열람 범위 규정
  'policy.crm.checkupProxyScope': 'S_INTERNAL', // 역할 권한
  'policy.audit.diagnosisFreeText': 'S_INTERNAL', // 감사 원장 기록 방식
  'security.keyDerivationUnify': 'S_INTERNAL', // 키 파생·로테이션
  'legal.esign.biometricStepUp': 'S_REGULATION', // 전자서명 법적 효력
  'legal.regulatoryAxis.review': 'S_REGULATION', // 의료법 고시·CSAP·N2SF
};

export function decisionSubdomainOf(key: string, track: string, layer: string, domain: DecisionDomain | null | undefined): string | null {
  if (!domain) return null;
  const o = DECISION_SUBDOMAIN_OVERRIDES[key];
  if (o) return o;
  switch (domain) {
    case 'FOUNDATION':
      if (key.startsWith('identity.') || track === 'COUNTRY' || track === 'AE' || track === 'GOVERNANCE') return 'F_CORPORATE';
      if (track === 'MASTER') return 'F_ADMIN';
      return 'F_SYSTEM';
    case 'MEDICAL':
      if (track === 'QUALITY') return 'M_QUALITY';
      if (track === 'DRAFT') return 'M_ADMIN';
      if (layer === 'LICENSE_HOLDER') return 'M_LAW';
      return 'M_CLINICAL';
    case 'OPERATIONS':
      if (track === 'NOTIFY') return 'O_PATIENT_ENV';
      return 'O_SYSTEM';
    case 'ADMIN':
      if (layer === 'LICENSE_HOLDER') return 'A_REGULATION';
      return 'A_PROCESS';
    case 'SECURITY':
      if (track === 'PRIVACY' || layer === 'LICENSE_HOLDER') return 'S_REGULATION';
      return 'S_INTERNAL';
  }
  return null;
}

export function decisionSubdomainMeta(key: string) {
  return DECISION_SUBDOMAINS.find((s) => s.key === key) ?? null;
}
