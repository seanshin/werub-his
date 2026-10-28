/**
 * 사람 몫 할 일(2026-10-26 · 명세 정본 `docs/05-reference/human-actions-2026-10-26.md`) — 화면 `/admin/human-actions` 의 정의.
 *
 * 🔴 개발이 끝났고 사람의 결정·입력·확인만 남은 일이다. 이 화면은 **체크박스로 "했다"고 적지 않는다** —
 *    각 확인 항목의 상태를 서버가 정본(결정 등록부 기록·설정·원장)에서 **파생**한다. 판정 수단이 없는 일은
 *    `derivable: false` 로 두고 "자동 판정 없음"이라고 말한다(가짜 완료 표시를 만들지 않는다).
 *  · 결정은 **실결정만** 충족이다 — 개발 시드(DEV-SEED)는 결정이 아니다(go-live 준비율 65%↔45% 함정).
 *  · 조회 실패는 UNKNOWN(확인 불가) — 미충족·0 으로 접지 않는다.
 *  · 서버는 코드와 값만 — 라벨·설명·이동 경로는 이 파일이 정본이다.
 */

export const HUMAN_ACTION_IDS = ['H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'H7', 'H8', 'H9', 'H10', 'H11', 'H12'] as const;
export type HumanActionId = (typeof HUMAN_ACTION_IDS)[number];

/** 확인 항목 상태 — INFO 는 판정에 들어가지 않는 참고 값 */
export type HumanCheckState = 'MET' | 'UNMET' | 'UNKNOWN' | 'INFO';
/** 항목 상태 — MANUAL = 자동 판정 수단 없음(사람이 확인) */
export type HumanActionState = 'DONE' | 'PARTIAL' | 'PENDING' | 'UNKNOWN' | 'MANUAL';

/** 결정 기록 상태 — REAL 실결정 · SEED 개발 시드(결정 아님) · NONE 기록 없음 */
export type DecisionRecordState = 'REAL' | 'SEED' | 'NONE';

export interface HumanCheckValue {
  /** 확인 항목 코드(라벨은 HUMAN_CHECK_LABELS) */
  code: string;
  state: HumanCheckState;
  /** 결정 키·설정 키 등 대상(화면이 그대로 보여 준다) */
  target?: string;
  /** 결정 기록 상태 */
  decision?: DecisionRecordState;
  /** 결정 선택지(실결정·시드 모두 — 시드면 화면이 "시드"라고 붙인다) */
  choice?: string | null;
  /** 수(미설정·조회 실패는 null) */
  count?: number | null;
  /** 이름 목록(잘렸으면 truncated) */
  names?: string[];
  truncated?: boolean;
}

export interface HumanActionValue {
  id: HumanActionId;
  state: HumanActionState;
  checks: HumanCheckValue[];
}

export interface HumanActionDef {
  id: HumanActionId;
  title: string;
  /** 누가(직책·조직 — 개인을 지어내지 않는다) */
  owner: string;
  /** 무엇이 막혀 있는가 */
  blocks: string;
  phase: 'BEFORE_GO_LIVE' | 'OPTIONAL' | 'REAL_PREP' | 'EXTERNAL';
  /** 판정 수단이 있는가 — false 면 화면이 "자동 판정 없음" */
  derivable: boolean;
  /** 판정 뒤에도 사람이 해야 하는 마지막 단계 — 시스템이 확인하지 못한다 */
  manualTail?: string;
  /** 하러 가는 곳 */
  links: { href: string; label: string }[];
}

export const HUMAN_ACTIONS: readonly HumanActionDef[] = [
  { id: 'H1', title: '리허설 발신 보류분 처리 의결·리얼 전환 일시', owner: '원내 위원회(OPS)', blocks: '리얼 전환', phase: 'BEFORE_GO_LIVE', derivable: true,
    manualTail: '의결과 전환 일시를 ERP 에 통지한다(시스템이 확인하지 못한다)',
    links: [{ href: '/admin/decisions', label: '중요 결정' }, { href: '/admin/erp', label: '연동 모니터' }] },
  { id: 'H2', title: '요양기관 종별 결정', owner: '원무·경영', blocks: '진찰료·입원료 종별 단가', phase: 'BEFORE_GO_LIVE', derivable: true,
    links: [{ href: '/admin/billing-calc', label: '종별 설정·계산기' }] },
  { id: 'H3', title: '입원료 코드 매핑·병상 일당', owner: '원무', blocks: '입원료가 기본 일당(상수)으로 계산된다', phase: 'BEFORE_GO_LIVE', derivable: true,
    manualTail: '정한 코드·단가를 ERP 에 알린다(ERP 수가 마스터 동시 반영)',
    links: [{ href: '/admin/ai-settings', label: '시스템 설정' }] },
  { id: 'H4', title: '결정 10-K·10-L 위원회 상정·의결', owner: '원내 위원회', blocks: '개발 시드로 동작 중(실결정 아님)', phase: 'BEFORE_GO_LIVE', derivable: true,
    links: [{ href: '/admin/decisions', label: '중요 결정(위원회 안건 일괄 상정)' }] },
  { id: 'H5', title: '사용 중 약속처방·치료일정 승인 기록', owner: '관리자(승인권자)', blocks: '승인 근거 없이 사용 중', phase: 'BEFORE_GO_LIVE', derivable: true,
    links: [{ href: '/admin/order-sets', label: '약속처방' }, { href: '/admin/treatment-templates', label: '치료일정 템플릿' }, { href: '/admin/clinical-rules', label: '임상 규칙 대장' }] },
  { id: 'H6', title: '진료 차례 임박 푸시 켜기', owner: '원내 정책·관리자·인프라', blocks: '차례 임박 알림이 만들어지지 않는다', phase: 'OPTIONAL', derivable: true,
    links: [{ href: '/admin/outbound-channels', label: '대외 발신 관제' }, { href: '/admin/safety-gates', label: '경보 등록부' }, { href: '/admin/ai-settings', label: '시스템 설정' }] },
  { id: 'H7', title: '진료실 도면 연결', owner: '시설·관리자', blocks: '연결 안 된 진료실은 길안내 대신 "위치 미등록"', phase: 'OPTIONAL', derivable: true,
    links: [{ href: '/admin/space-assets', label: '공간 자산 배치' }] },
  { id: 'H8', title: '포털 세션 3종 실화면 순회', owner: 'QA(사람 로그인)', blocks: '실화면 미확인', phase: 'OPTIONAL', derivable: false,
    links: [{ href: '/portal', label: '환자 포털' }] },
  { id: 'H9', title: 'ERP 1131 재분류 결정 통지 수령', owner: 'ERP(외부) → 연동 담당', blocks: 'ERP 게이트 ON 전', phase: 'EXTERNAL', derivable: false,
    links: [{ href: '/admin/erp', label: 'ERP 연동' }] },
  { id: 'H10', title: '포털 본인확인 강화·온라인 결제(실서비스 직전)', owner: '개인정보·원무·계약', blocks: '리얼 전환', phase: 'REAL_PREP', derivable: false,
    links: [{ href: '/admin/go-live', label: 'Go-Live 관제' }] },
  { id: 'H11', title: '신체보호대 점검 간격 원내 규정 입력', owner: '간호부·환자안전(QPS)', blocks: '코드 기본값(120분)으로 감시 중', phase: 'BEFORE_GO_LIVE', derivable: true,
    links: [{ href: '/admin/nursing-rules', label: '간호 원내 규정' }, { href: '/safety', label: '환자안전(신체보호대)' }] },
  { id: 'H12', title: '통증 재평가 규정·인계 인수 방식·위험 재평가 주기 원내 결정 입력', owner: '간호부', blocks: '개발 시드·코드 기본값으로 동작 중(원내 규정 아님)', phase: 'BEFORE_GO_LIVE', derivable: true,
    links: [{ href: '/admin/nursing-rules', label: '간호 원내 규정' }, { href: '/nurse-station', label: '간호 스테이션' }] },
];

/** 확인 항목 라벨 정본 */
export const HUMAN_CHECK_LABELS: Readonly<Record<string, string>> = {
  DECISION_REAL: '실결정 기록',
  OUTBOX_PENDING: '리허설 보류 발신(PENDING) 건수',
  STAY_PRICE_CONFIGURED: '병상 등급 입원료 코드 또는 일당 설정',
  ORDER_SETS_UNAPPROVED: '승인 기록 없는 사용 중 약속처방',
  TEMPLATES_UNAPPROVED: '승인 기록 없는 사용 중 치료일정 템플릿',
  QUEUE_NEAR_THRESHOLD: '차례 임박 기준 인원(원내 정책)',
  PUSH_MASTER_ON: '환자 푸시 마스터 스위치',
  PUSH_TYPE_ON: '차례 임박 유형 스위치',
  ALERT_APPROVED: '경보 승인(PATIENT_PUSH_QUEUE_NEAR)',
  FCM_CREDENTIALS: '단말 푸시 자격(FCM)',
  CLINIC_ROOMS_LINKED: '진료표 진료실 도면 연결',
  RESTRAINT_INTERVAL_CONFIGURED: '보호대 점검 간격 원내 설정(nursing.restraint.checkIntervalMinutes)',
  PAIN_RULE_CONFIGURED: '통증 재평가 원내 규정(nursing.pain.reassessRule)',
  HANDOFF_ACK_MODE_CONFIGURED: '인계 인수 방식 원내 설정(nursing.handoff.ackTakeOverMode)',
  RISK_INTERVALS_CONFIGURED: '낙상·욕창 재평가 주기 원내 설정(nursing.riskReassess.intervalHours)',
};

export const HUMAN_ACTION_STATE_LABELS: Readonly<Record<HumanActionState, string>> = {
  DONE: '끝남', PARTIAL: '일부', PENDING: '남음', UNKNOWN: '확인 불가', MANUAL: '자동 판정 없음',
};

export const HUMAN_PHASE_LABELS: Readonly<Record<HumanActionDef['phase'], string>> = {
  BEFORE_GO_LIVE: '개시 전', OPTIONAL: '선택', REAL_PREP: '실서비스 직전', EXTERNAL: '외부',
};

/** 결정 10-K·10-L 키 — H4 의 확인 항목(등록부와 기계 대조) */
export const HUMAN_H4_DECISION_KEYS = [
  'patient.listScopeByRole', 'patient.contactSearch', 'patient.dormantDefinition', 'patient.photoPolicy', 'patient.mergeReversal', 'access.roleDataAccess.scope',
  'catalog.ownership', 'catalog.activeEdit', 'cdss.legacyRules', 'orderSet.nurseUse', 'triage.ruleAuthority', 'prescription.delegatePolicy', 'clinicalChart.verifyPolicy',
] as const;

/**
 * 항목 상태 파생 — 판정 수단이 없으면 MANUAL · INFO 는 세지 않는다 ·
 * 🔴 하나라도 확인 불가면(나머지가 다 충족이어도) "끝남"이라 말하지 않는다.
 */
export function humanActionState(derivable: boolean, checks: readonly Pick<HumanCheckValue, 'state'>[]): HumanActionState {
  if (!derivable) return 'MANUAL';
  const judged = checks.filter((c) => c.state !== 'INFO');
  if (judged.length === 0) return 'UNKNOWN';
  const met = judged.filter((c) => c.state === 'MET').length;
  const unknown = judged.filter((c) => c.state === 'UNKNOWN').length;
  if (met === judged.length) return 'DONE';
  if (unknown > 0 && met + unknown === judged.length) return 'UNKNOWN';
  return met > 0 ? 'PARTIAL' : 'PENDING';
}
