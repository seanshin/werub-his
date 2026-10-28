import type { DevApplyStatus, AgendaStatus, CommitteeAuthorityRecord, CommitteeAuthoritySource, CommitteeCode, DecisionMechanism, DecisionSettingSource, CommitteeDecisionStage, DecisionDomain, DecisionStageResult } from '@hospital-run/shared';
/**
 * 결정 등록부 화면의 공유 타입·라벨 — 목록(2415)과 브리핑 문서가 **같은 정본**을 쓴다.
 * 🔴 라벨을 화면마다 다시 적으면 갈라진다(이 저장소에서 반복해서 나온 유형).
 */
export type Layer = 'LICENSE_HOLDER' | 'INTERNAL_COMMITTEE' | 'STAFF';
export type ApprovalPath = 'AUTHORIZED_ROLE' | 'COMMITTEE' | 'CODE_CHANGE' | 'PER_EVENT_DIALOG';
export type GoLiveRel = 'REQUIRED_BEFORE' | 'CAN_FOLLOW' | 'NOT_RELATED';

export interface DecisionOption { value: string; label: string; effect: string }

export interface DecisionAttachment {
  id: string; fileName: string; url: string; mimeType: string; sizeBytes: number;
  uploadedByUserId: string; uploadedAt: string;
}

export interface DecisionRecord {
  choice: string; legalReviewRef: string; authorityClaim: string; note?: string;
  decidedByUserId: string; decidedAt: string; applied: boolean; appliedDetail?: string;
  attachments?: DecisionAttachment[];
  /** 위원회 의결로 남은 기록(의결이 곧 기록 — 서버가 옮긴다) */
  committeeDecision?: { id: string; decisionNo: string; committeeCode: string | null; committeeName: string };
}

export interface DecisionItem {
  key: string; title: string; layer: Layer; why: string; legalReview: string[];
  /**
   * 🔴 축 — 층과 **직교**한다(층=누가 정하는가 · 축=무엇에 관한 것인가).
   *    라벨은 여기서 다시 적지 않는다 — 서버가 `payload.tracks` 로 준다(정본은 등록부 하나).
   */
  track: string;
  approvalPath: ApprovalPath;
  authority: string; options: DecisionOption[];
  dependsOn?: string[]; configKey?: string; drillDown?: string; blocks?: string;

  // 설명자료 필드(2026-08-21)
  statusQuo: string;
  opens?: string[];
  verifyHow?: string[];
  afterDecision?: string;
  goLive: GoLiveRel;
  /** 🔴 누가 들고 있는가 — 사람 이름이 아니라 역할·부서 */
  owner: string;
  /** 🔴 개시 기준 상대 표현 — 절대 날짜가 아니다(개시일이 없는데 날짜를 박으면 곧 거짓이 된다) */
  dueBy: 'BEFORE_GO_LIVE' | 'WITHIN_30D' | 'NONE';

  decided: boolean; record: DecisionRecord | null; currentConfigValue: unknown;
  /** 개발 시드 기록(근거에 DEV-SEED) — 🔴 보이되 결정으로 세지 않는다(decided=false) */
  seeded?: boolean;
  pendingAttachments: DecisionAttachment[];
  /** 🔴 상위 층 선행 조건이 미결이면 담긴다 — 기록해도 적용되지 않는다 */
  blockedBy: Array<{ key: string; title: string; reason: string }>;
  /** 이 결정이 직접 풀어주는 후속 결정(dependsOn 의 역방향) */
  unlocks: Array<{ key: string; title: string; layer: Layer }>;
  /** 지금 바로 결정할 수 있는가(미결 + 선행 조건 없음) */
  readyToDecide: boolean;
  /**
   * 🔴 **"정했다"와 "그렇게 됐다"는 다른 사실이다.**
   *    `decided` 하나만 보면 "20건 결정 완료"가 아무것도 바뀌지 않은 상태를 가린다.
   */
  enactment: EnactmentStatus;
  /** 큰 분류(기본 설정·의료·운영·행정·정보보호) — 서버가 shared 정본으로 붙인다(옛 응답이면 없음) */
  domain?: DecisionDomain | null;
  /** 연결된 최신 위원회 안건 · null = 없음 · 'UNKNOWN' = 조회 실패 */
  agenda?: DecisionAgendaLink | null | 'UNKNOWN';
  /** 결정 과정 단계(서버 판정) */
  stage?: DecisionStageResult;
  /** 주관·합동 위원회 — 원내 위원회 층만(서버가 shared 정본으로 붙인다 · 옛 응답이면 없음) */
  committee?: { lead: CommitteeCode; joint: CommitteeCode[] } | null;
  /** 🔴 재검토 필요 — 이 실결정 뒤 바뀐 선행 결정 키 · `null` = 이력 조회 실패(확인 불가) · 빈 배열 = 필요 없음 */
  needsReview?: string[] | null;
  /** 이 결정이 정한 설정과 실제 값(`matches:false` = 결정 경로 밖에서 바뀜) */
  governedConfig?: Array<{ key: string; decided: unknown; current: unknown; matches: boolean }>;
  /** 이력 원장 건수 · `null` = 조회 실패 */
  logCount?: number | null;
  /** 결정 방식(서버가 등록부에서 파생) */
  mechanism?: DecisionMechanism;
  /** 이 결정이 건드리는 설정의 상세 · `null` = 설정 조회 실패(확인 불가) */
  settings?: DecisionSettingDetail[] | null;
  /**
   * 개발 반영 이행(결정 방식 개발 반영만 · 그 밖 null) — 서버가 원장에서 파생 · `status: null` = 확인 불가
   * `implementedChoice` = 판정표상 코드가 이미 이 선택대로 동작(실결정이 다르면 되돌림)
   */
  devApply?: { status: DevApplyStatus | null; version: string | null; since: string | null; implementedChoice: string | null } | null;
}

export interface DecisionSettingDetail {
  key: string; role: 'SETS' | 'RELATED';
  description: string | null; category: string | null; registered: boolean;
  current: unknown; source: DecisionSettingSource; defaultValue: unknown;
  allowed: unknown;
  options: Array<{ value: string; label: string; sets: boolean; setValue: unknown }>;
  decidedValue: unknown; decidedSets: boolean; matchesDecision: boolean | null; currentOption: string | null;
  updatedAt: string | null; updatedByName: string | null;
}

/** 결정 이력 원장 한 줄 — 어휘는 shared `decision-log.ts` */
export interface DecisionLogEntry {
  id: string; decisionKey: string; kind: string; choice: string | null; prevChoice: string | null;
  basisRef: string | null; authorityClaim: string | null; actorUserId: string | null; sourceKey: string | null;
  committeeDecisionId: string | null; detail: Record<string, unknown> | null; occurredAt: string; title?: string | null;
}

export interface DecisionAgendaLink {
  id: string; status: AgendaStatus; meetingId: string | null;
  committee: { code: string | null; name: string } | null; updatedAt: string;
}
export interface DomainRoll { domain: DecisionDomain; label: string; description: string; total: number; decided: number; seeded: number; readyToDecide: number; blocked: number }
export interface StageRoll { stage: CommitteeDecisionStage; count: number | null }
/** 위원회별 — 명부 `null` = 조회 실패(0명으로 접지 않는다) · 시드 위원은 임명이 아니다 */
export interface CommitteeRoll {
  code: CommitteeCode; name: string; lead: number; joint: number; decided: number; seeded: number; inProcess: number;
  roster: { active: number; manual: number; seed: number; chairAppointed: boolean } | null;
  /** 결정권한자 표 기록 · `null` = 조회 실패 · 옛 응답이면 없음 */
  authority?: { source: CommitteeAuthoritySource; record: CommitteeAuthorityRecord | null } | null;
}

export type EnactmentState = 'UNDECIDED' | 'ENACTED' | 'PENDING' | 'FAILED' | 'MANUAL_CONFIRMED';

export interface EnactmentStatus {
  state: EnactmentState;
  label: string;
  detail: string | null;
  actions: Array<{ kind: string; status: string; error: string | null; enactedAt: string | null; target: unknown }>;
}

/**
 * 🔴 색을 상태마다 **다르게** 준다. `PENDING`(반영대기)을 `ENACTED`(반영됨)와 같은 초록으로
 *    그리면 화면이 실제보다 진척된 것처럼 말한다 — 이 저장소에서 반복해 나온 결함이다.
 */
export const ENACT_STYLE: Record<EnactmentState, string> = {
  UNDECIDED: 'bg-gray-100 text-gray-600 border-gray-200',
  ENACTED: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  PENDING: 'bg-amber-50 text-amber-800 border-amber-200',
  FAILED: 'bg-red-50 text-red-700 border-red-300',
  MANUAL_CONFIRMED: 'bg-sky-50 text-sky-800 border-sky-200',
};

export interface LayerMeta { label: string; scope: string; cannot: string }

export interface LayerRoll { layer: Layer; total: number; decided: number; blocked: number; readyToDecide: number }

/** 축별 집계 — 🔴 항목이 0인 축은 서버가 내지 않는다(빈 필터는 없는 일감을 만든다) */
export interface TrackRoll { track: string; label: string; total: number; decided: number; readyToDecide: number }

export interface DecisionsPayload {
  items: DecisionItem[];
  layers: Record<Layer, LayerMeta>;
  /** 축 코드 → 사람 말 라벨. 🔴 서버(등록부)가 정본이다 — 화면이 사본을 두지 않는다 */
  tracks: Record<string, string>;
  summary: {
    byLayer: LayerRoll[]; byTrack: TrackRoll[]; goLiveRequired: { total: number; decided: number; seeded?: number }; seeded?: number;
    byDomain?: DomainRoll[]; byStage?: StageRoll[]; agendaUnknown?: boolean; byCommittee?: CommitteeRoll[];
    /** 결정 엔진 — 보호 수준·재검토 필요·결정과 다른 설정·이력 수(`null` = 확인 불가) */
    byMechanism?: Array<{ mechanism: DecisionMechanism; total: number; decided: number; seeded: number }>;
    engine?: { protectionMode: 'OFF' | 'WARN' | 'BLOCK' | null; reviewNeeded: number | null; configDrift: number; logTotal: number | null };
    /** 개발 반영 이행 상태별 수 · `null` = 확인 불가 */
    devApply?: { total: number; byStatus: Record<DevApplyStatus, number>; requiredBeforeGoLive: { total: number; byStatus: Record<DevApplyStatus, number> } } | null;
  };
  measuredAt: string;
  caveat: string;
}

/** 🔴 표시 순서 = 서열. 위에서 아래로 읽으면 "무엇이 무엇을 전제하는가"가 보인다 */
export const LAYER_ORDER: Layer[] = ['LICENSE_HOLDER', 'INTERNAL_COMMITTEE', 'STAFF'];

/** 문서에 쓰는 짧은 층 이름 */
export const LAYER_TITLE: Record<Layer, string> = {
  LICENSE_HOLDER: '허가권자 — 법적 운영 요건',
  INTERNAL_COMMITTEE: '원내 위원회 — 운영 정책',
  STAFF: '직원 — 건별 현장 판단',
};

export const PATH_LABEL: Record<ApprovalPath, { label: string; note: string }> = {
  AUTHORIZED_ROLE: { label: '권한자 의사결정 시 적용', note: '의사결정하면 설정이 바뀝니다.' },
  COMMITTEE: { label: '위원회 의결', note: '이 화면은 적용하지 않습니다 — 안건으로 올려야 합니다.' },
  CODE_CHANGE: { label: '코드·스키마 변경', note: '이 화면은 의사결정만 받습니다 — 배포로만 반영됩니다.' },
  PER_EVENT_DIALOG: { label: '업무 화면에서 건별', note: '🔴 이 화면에서 결정하지 않습니다 — 승인 다이얼로그가 그 자리입니다.' },
};

export const GO_LIVE_LABEL: Record<GoLiveRel, string> = {
  REQUIRED_BEFORE: '🔴 개시 전 필수',
  CAN_FOLLOW: '개시 후에도 가능',
  NOT_RELATED: '개시와 무관',
};

/** 요약 카드용 짧은 이름 — 문서용 `LAYER_TITLE` 과 용도가 다르다(좁은 칸) */
export const LAYER_TITLE_SHORT: Record<Layer, string> = {
  LICENSE_HOLDER: '허가권자(법적 요건)',
  INTERNAL_COMMITTEE: '원내 위원회(정책)',
  STAFF: '직원(건별 판단)',
};

export const DUE_LABEL: Record<DecisionItem['dueBy'], string> = {
  BEFORE_GO_LIVE: '개시 전',
  WITHIN_30D: '30일 내',
  NONE: '기한 없음',
};

/**
 * 상태 필터 — 🔴 "미결"과 "선행 대기"를 한 덩어리로 묶지 않는다.
 *    선행 대기는 **지금 고를 수 없는 것**이라, 미결과 같이 세면 "왜 아무도 안 하지"로 읽힌다.
 */
export type DecisionStatusFilter = 'ALL' | 'READY' | 'BLOCKED' | 'DECIDED';

export const STATUS_FILTER_LABEL: Record<DecisionStatusFilter, string> = {
  ALL: '전체',
  READY: '지금 결정 가능',
  BLOCKED: '선행 대기',
  DECIDED: '결정됨',
};

/**
 * 🔴 거르기 **정본** — 화면이 인라인으로 다시 적으면 가드가 검사하는 것과 화면이 하는 일이 갈라진다.
 *    규칙은 하나다: 축은 교집합, 상태는 서로 배타.
 *    · `READY`   = 미결 + 선행 조건 없음(오늘 고를 수 있는 것)
 *    · `BLOCKED` = 미결 + 상위 층 선행 미충족(고를 수는 있으나 **적용되지 않는다**)
 *    · `DECIDED` = 기록됨(적용 여부는 다른 축 — `enactment` 가 말한다)
 */
export function matchesDecisionFilter(
  i: Pick<DecisionItem, 'track' | 'decided' | 'readyToDecide' | 'blockedBy'>,
  track: string,
  status: DecisionStatusFilter,
): boolean {
  if (track !== 'ALL' && i.track !== track) return false;
  if (status === 'READY') return i.readyToDecide;
  if (status === 'BLOCKED') return !i.decided && i.blockedBy.length > 0;
  if (status === 'DECIDED') return i.decided;
  return true;
}

/**
 * 제목·키 검색(2026-10-10 카테고리 정리) — 공백으로 나눈 낱말이 **모두** 제목·키·허가권·축 라벨 중 어딘가에 있어야 한다.
 *  🔴 거르기만 한다 — 분모(전체 건수)는 화면이 항상 함께 낸다.
 */
export function matchesDecisionQuery(
  i: Pick<DecisionItem, 'key' | 'title' | 'authority'>,
  query: string,
  trackLabel = '',
): boolean {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = `${i.title} ${i.key} ${i.authority} ${trackLabel}`.toLowerCase();
  return words.every((w) => hay.includes(w));
}

/**
 * 한 줄 상태 — 🔴 개발 시드는 `decided=false` 지만 "아무것도 안 정함"과 다르다(무엇으로 해 두었는지 보인다).
 *    `READY`·`BLOCKED` 보다 시드가 먼저다: 시드 기록이 있으면 선행 조건이 풀려 있어도 "시드로 해 둠"이 사실이다.
 */
export type DecisionRowState = 'READY' | 'BLOCKED' | 'UNDECIDED' | 'SEEDED' | 'DECIDED';

export function decisionRowState(i: Pick<DecisionItem, 'decided' | 'seeded' | 'readyToDecide' | 'blockedBy'>): DecisionRowState {
  if (i.decided) return 'DECIDED';
  if (i.seeded) return 'SEEDED';
  if (i.readyToDecide) return 'READY';
  if (i.blockedBy.length > 0) return 'BLOCKED';
  return 'UNDECIDED';
}

/** 섹션 안 정렬 — 지금 가능 → 선행 대기·미결 → 개발 시드 → 결정됨(사람은 위에서부터 처리한다) */
export const DECISION_ROW_RANK: Record<DecisionRowState, number> = { READY: 0, BLOCKED: 1, UNDECIDED: 1, SEEDED: 2, DECIDED: 3 };

export function sortDecisionRows<T extends Pick<DecisionItem, 'decided' | 'seeded' | 'readyToDecide' | 'blockedBy' | 'goLive'>>(rows: T[]): T[] {
  return rows
    .map((r, idx) => ({ r, idx }))
    .sort((a, b) =>
      DECISION_ROW_RANK[decisionRowState(a.r)] - DECISION_ROW_RANK[decisionRowState(b.r)]
      || (a.r.goLive === 'REQUIRED_BEFORE' ? 0 : 1) - (b.r.goLive === 'REQUIRED_BEFORE' ? 0 : 1)
      || a.idx - b.idx)
    .map((x) => x.r);
}

export const ROW_STATE_LABEL: Record<Exclude<DecisionRowState, 'SEEDED'>, string> = {
  READY: '지금 가능',
  BLOCKED: '선행 대기',
  UNDECIDED: '미결',
  DECIDED: '결정됨',
};

export const ROW_STATE_STYLE: Record<DecisionRowState, string> = {
  READY: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  BLOCKED: 'bg-amber-50 text-amber-800 border-amber-200',
  UNDECIDED: 'bg-gray-50 text-gray-700 border-gray-200',
  SEEDED: 'bg-violet-50 text-violet-800 border-violet-200',
  DECIDED: 'bg-sky-50 text-sky-800 border-sky-200',
};

/** 원 숫자 — 위원회 결정 과정 단계 번호 표시 */
export const STAGE_NO = ['①', '②', '③', '④', '⑤', '⑥', '⑦'] as const;
/** 위원회를 거치지 않는 층(허가권자·직원)의 짧은 경로 라벨 */
export const DIRECT_STAGE_LABEL: Partial<Record<CommitteeDecisionStage, string>> = {
  PREPARE: '검토', RECORDED: '의사결정', ENACTED: '집행',
};
export type StageFilter = CommitteeDecisionStage | 'ALL';
/** 단계 거르기 — 위원회 층만 단계가 있다(다른 층은 단계 필터에 들지 않는다) */
export function matchesStageFilter(i: Pick<DecisionItem, 'layer' | 'stage'>, f: StageFilter): boolean {
  if (f === 'ALL') return true;
  return i.layer === 'INTERNAL_COMMITTEE' && i.stage?.stage === f;
}
