/**
 * 결정 등록부 — **영역(큰 분류)** 과 **위원회 결정 과정 단계**의 정본(2026-10-10).
 *
 * 사용자 요청: "/admin/decisions 위원회의 의사결정과정에 대한 순서와 기본 설정, 의료, 운영, 행정 등의 카테고리가 더 구분되어야 함."
 *
 * 🔴 영역은 축(track)을 **대신하지 않는다** — 축은 "무엇에 관한 것인가"의 세부, 영역은 그 위의 큰 묶음이다.
 *    축이 대부분을 정하고, 축과 성격이 다른 결정만 키 단위 예외(DECISION_DOMAIN_OVERRIDES)로 옮긴다(키마다 이유).
 * 🔴 단계는 **원장에서 판정**한다 — 연결된 안건 상태와 실결정 기록·집행 상태만 본다.
 *    개발 시드(DEV-SEED)는 실결정이 아니다(단계를 앞당기지 않는다). 확인(VERIFIED)은 사람이 확인한 기록이 없어 시스템이 판정하지 않는다.
 */
import type { AgendaStatus } from './governance-agenda';

export const DECISION_DOMAIN_KEYS = ['FOUNDATION', 'MEDICAL', 'OPERATIONS', 'ADMIN', 'SECURITY'] as const;
export type DecisionDomain = (typeof DECISION_DOMAIN_KEYS)[number];

/** 순서 = 결정 순서 안내(기본 설정부터 — 다른 영역의 결정이 그 위에 선다) */
export const DECISION_DOMAINS: ReadonlyArray<{ key: DecisionDomain; label: string; description: string }> = [
  { key: 'FOUNDATION', label: '기본 설정', description: '기관 정체성·국가·운영 모드·거버넌스·코드 마스터·언어 — 다른 결정이 그 위에 선다' },
  { key: 'MEDICAL', label: '의료', description: '진료·간호·약제·임상 기록·의료 질 지표·환자안전' },
  { key: 'OPERATIONS', label: '운영', description: '플랫폼·연동·알림·AI 운영·공간·위치 — 시스템이 어떻게 돌아가는가' },
  { key: 'ADMIN', label: '행정', description: '원무·수납·청구·서류 발급·ERP·인사·구매·CRM' },
  { key: 'SECURITY', label: '정보보호·보안', description: '개인정보 처리 경계·열람 범위·보존·인증·키' },
];

/** 축 → 영역 기본 매핑(축은 등록부 `DECISION_TRACKS` 와 같은 어휘 — api 테스트가 전 축 매핑을 대조한다) */
export const DECISION_TRACK_DOMAIN: Readonly<Record<string, DecisionDomain>> = {
  GOVERNANCE: 'FOUNDATION',
  COUNTRY: 'FOUNDATION',
  AE: 'FOUNDATION',
  I18N: 'FOUNDATION',
  MASTER: 'FOUNDATION',
  CLINICAL: 'MEDICAL',
  DRAFT: 'MEDICAL',
  QUALITY: 'MEDICAL',
  PLATFORM: 'OPERATIONS',
  NOTIFY: 'OPERATIONS',
  AI: 'OPERATIONS',
  BILLING: 'ADMIN',
  PRIVACY: 'SECURITY',
  SECURITY: 'SECURITY',
};

/**
 * 키 단위 예외 — 축은 다른데 **성격이 다른 영역**인 결정(등록부를 읽고 고름 · api 테스트가 키 실재를 대조).
 */
export const DECISION_DOMAIN_OVERRIDES: Readonly<Record<string, DecisionDomain>> = {
  // ── 행정 — 원무·서류·ERP·결재·구매·CRM 업무인데 임상·플랫폼·품질 축에 있는 것
  'qi.docIssuance.slaHours': 'ADMIN', // 서류 발급 처리 기한 — 의무기록·원무 창구 업무(축은 질 지표)
  'draft.certificatePrewrite': 'ADMIN', // 증명서 미리 작성 — 제증명 발급 행정
  'draft.staffInitiatedFee': 'ADMIN', // 원내 선작성 증명서의 수수료·처리기한
  'policy.mrn.numbering': 'ADMIN', // 환자번호 발번 — 원무 등록
  'policy.consent.requiredBeforeIntake': 'ADMIN', // 필수 동의 미완료 환자를 접수에서 막을지 — 원무 접수 절차
  'policy.integration.erpHr': 'ADMIN', // ERP 근태·결재 라우팅
  'integration.eapprovalUndeliveredBacklog': 'ADMIN', // 전자결재 미전달 승인 결과 처리
  'mode.essErpPull': 'ADMIN', // 리허설 중 ERP 조회 — 인사·급여 ESS
  'policy.crm.automatedOutreach': 'ADMIN', // 예약 D-1·검진·리콜 자동 연락 — CRM 업무
  'policy.workflow.procedureBypassViaUpdate': 'ADMIN', // 승인·퇴직·중도탈락 전용 절차
  'policy.workflow.operationalStateTransitions': 'ADMIN', // 해외환자 케이스·급양 조리·포털 배너 상태
  'policy.inventory.duplicateSubmit': 'ADMIN', // 발주·부서청구·소분·실사 중복
  'policy.cssd.partialReceiptResend': 'ADMIN', // CSSD 발주 부분 입고 — 구매 입고
  // ── 기본 설정 — 기관 정체성·요양기관 종별·운영 모드·시드 정책·제품 범위 선언
  'billing.institutionType': 'FOUNDATION', // 요양기관 종별 — 수가 단가 이전에 정하는 기관 속성
  'identity.documentSnapshot': 'FOUNDATION', // 발급 서식의 기관 정보 보존 방식 — 기관 정체성
  'identity.unsetIssuance': 'FOUNDATION', // 기관 정보 미설정 시 법정 서식 발급 — 기관 정체성
  'seed.rehearsalFeatureDefaults': 'FOUNDATION', // 개발·리허설 설치본 기본 기능 — 시드 정책
  'journey.demoSeparation': 'FOUNDATION', // 데모·시드 사건 분리 — 운영 모드 정책
  'ops.rehearsalOutboxAtCutover': 'FOUNDATION', // 리얼 전환 때 리허설 발신 대기 건 — 운영 모드 전환
  'release.deploymentForm': 'FOUNDATION', // 첫 상용 패키지 범위 선언
  'release.emrCertification': 'FOUNDATION',
  'release.versionScheme': 'FOUNDATION',
  'release.saleLanguages': 'FOUNDATION',
  'release.productName': 'FOUNDATION',
  'release.externalTransmitScope': 'FOUNDATION',
  // ── 운영 — 청구 축에 있지만 서비스 운영안인 것
  'policy.telehealth.operations': 'OPERATIONS', // 비대면 진료 운영안(진료과 범위·응답 시한·결제 대행 — 수가는 그 일부)
};

export function decisionDomainOf(key: string, track: string): DecisionDomain | null {
  return DECISION_DOMAIN_OVERRIDES[key] ?? DECISION_TRACK_DOMAIN[track] ?? null;
}

// ─────────────────────────────────────────────────────────────────────────────
// 위원회 결정 과정 단계
// ─────────────────────────────────────────────────────────────────────────────

export const COMMITTEE_DECISION_STAGE_KEYS = ['PREPARE', 'SUBMITTED', 'DELIBERATION', 'RESOLVED', 'RECORDED', 'ENACTED', 'VERIFIED'] as const;
export type CommitteeDecisionStage = (typeof COMMITTEE_DECISION_STAGE_KEYS)[number];

export const COMMITTEE_DECISION_STAGES: ReadonlyArray<{ key: CommitteeDecisionStage; no: number; label: string; description: string; nextAction: string }> = [
  { key: 'PREPARE', no: 1, label: '검토 준비', description: '설명자료(검토 요청서)를 읽고 선행 결정이 풀렸는지 확인한다', nextAction: '설명자료를 확인하고 항목의 "위원회 상정" 버튼으로 안건을 올린다' },
  { key: 'SUBMITTED', no: 2, label: '안건 접수', description: '위원회 안건으로 접수돼 회의 상정(배정)을 기다린다(안건 상태 "접수")', nextAction: '위원회 간사가 회의에 배정한다(/admin/gld)' },
  { key: 'DELIBERATION', no: 3, label: '상정·심의', description: '회의에 상정됐거나 보류되어 심의를 기다린다(안건 상태 "상정"·"보류")', nextAction: '회의에서 선택지 중 하나를 의결한다' },
  { key: 'RESOLVED', no: 4, label: '의결', description: '위원회가 의결했지만 아직 의사결정으로 확정되지 않았다', nextAction: '의결 번호를 근거로 이 화면에서 의사결정을 확정한다' },
  { key: 'RECORDED', no: 5, label: '의사결정 확정', description: '의사결정이 확정됐다 — 집행이 없거나 반영 대기·실패다', nextAction: '집행 상태(반영 대기·실패)를 확인한다' },
  { key: 'ENACTED', no: 6, label: '집행', description: '설정이 반영됐다(또는 수동 확인됨)', nextAction: '확인 방법대로 실제 동작을 사람이 확인한다' },
  { key: 'VERIFIED', no: 7, label: '확인', description: '사람이 실제 동작을 확인한다 — 확인 기록이 없어 시스템이 세지 않는다', nextAction: '' },
];

/** 허가권자·직원 층은 위원회를 거치지 않는다 — 짧은 경로(라벨만) */
export const DIRECT_DECISION_PATH: ReadonlyArray<{ label: string }> = [
  { label: '검토' }, { label: '의사결정' }, { label: '집행' },
];

export type DecisionEnactmentStateLike = 'UNDECIDED' | 'ENACTED' | 'PENDING' | 'FAILED' | 'MANUAL_CONFIRMED';

export interface DecisionStageInput {
  layer: string;
  seeded: boolean;
  /** 실결정(시드 아님) */
  decided: boolean;
  readyToDecide: boolean;
  /** 연결된 최신 안건 상태 · null = 안건 없음 · 'UNKNOWN' = 조회 실패(없음으로 접지 않는다) */
  agenda: AgendaStatus | 'UNKNOWN' | null;
  enactmentState: DecisionEnactmentStateLike;
}

export interface DecisionStageResult {
  stage: CommitteeDecisionStage;
  /** 단계에 붙는 표식 — 선행 대기·부결·철회·안건 확인 불가·개발 시드·반영 대기/실패 */
  flags: Array<'BLOCKED' | 'REJECTED' | 'WITHDRAWN' | 'AGENDA_UNKNOWN' | 'SEEDED' | 'ENACT_PENDING' | 'ENACT_FAILED'>;
}

export function decisionStageOf(i: DecisionStageInput): DecisionStageResult {
  const flags: DecisionStageResult['flags'] = [];
  if (i.seeded) flags.push('SEEDED');
  if (i.decided) {
    if (i.enactmentState === 'ENACTED' || i.enactmentState === 'MANUAL_CONFIRMED') return { stage: 'ENACTED', flags };
    if (i.enactmentState === 'PENDING') flags.push('ENACT_PENDING');
    if (i.enactmentState === 'FAILED') flags.push('ENACT_FAILED');
    return { stage: 'RECORDED', flags };
  }
  // 🔴 실결정 없음 — 시드는 단계를 앞당기지 않는다
  if (i.agenda === 'UNKNOWN') flags.push('AGENDA_UNKNOWN');
  switch (i.agenda) {
    case 'SUBMITTED': return { stage: 'SUBMITTED', flags };
    case 'SCHEDULED':
    case 'DEFERRED': return { stage: 'DELIBERATION', flags };
    case 'RESOLVED': return { stage: 'RESOLVED', flags };
    case 'REJECTED': flags.push('REJECTED'); break;
    case 'WITHDRAWN': flags.push('WITHDRAWN'); break;
    default: break;
  }
  if (!i.readyToDecide) flags.push('BLOCKED');
  return { stage: 'PREPARE', flags };
}

export const DECISION_STAGE_FLAG_LABEL: Record<DecisionStageResult['flags'][number], string> = {
  BLOCKED: '선행 대기',
  REJECTED: '부결',
  WITHDRAWN: '철회',
  AGENDA_UNKNOWN: '안건 확인 불가',
  SEEDED: '개발 시드',
  ENACT_PENDING: '반영 대기',
  ENACT_FAILED: '반영 실패',
};
