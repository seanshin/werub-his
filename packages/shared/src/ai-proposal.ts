/**
 * AI 제안(review-pending) 어휘 정본 — 기획서 `docs/01-plan/features/ai-judgment-governance.plan.md` §2.1.
 *
 * 🔴 **제안은 정본이 아니다.** 이 목록이 정하는 것은 "AI 가 무엇에 대한 초안을 냈는가"(kind)와
 *    "그 초안이 사람 손을 어디까지 거쳤는가"(status)뿐이다. 정본 반영은 각 도메인 정본 서비스가 한다.
 * 🔴 어휘가 둘이면 갈라진다 — Prisma enum(`AiProposalStatus`·`AiProposalSource`)·DTO(@IsIn)·FE 필터가
 *    전부 이 파일 하나를 읽는다. kind 는 Prisma 에서 enum 이 아니라 VarChar 다(도메인 갈래가 붙을 때마다
 *    스키마 마이그레이션을 강제하지 않으려는 의도) — 그래서 **검증의 정본이 여기다**.
 */

/* ───────────────── kind — 무엇에 대한 초안인가 ───────────────── */

export const AI_PROPOSAL_KINDS = [
  'SOAP_DRAFT',
  'NURSING_DRAFT',
  'DISCHARGE_DRAFT',
  'CONSENT_DRAFT',
  'REFERRAL_DRAFT',
  'MDT_SUMMARY',
  'VOC_REPLY',
  'CHECKUP_OPINION',
  'LAB_INTERPRET',
  'RX_WARNING',
  'CODE_MAPPING',
] as const;

export type AiProposalKind = (typeof AI_PROPOSAL_KINDS)[number];

export const AI_PROPOSAL_KIND_LABEL: Record<AiProposalKind, string> = {
  SOAP_DRAFT: '진료기록(SOAP) 초안',
  NURSING_DRAFT: '간호기록 초안',
  DISCHARGE_DRAFT: '퇴원요약 초안',
  CONSENT_DRAFT: '동의서 초안',
  REFERRAL_DRAFT: '의뢰서 초안',
  MDT_SUMMARY: '다학제 요약 초안',
  VOC_REPLY: 'VoC 응답 초안',
  CHECKUP_OPINION: '검진 소견 초안',
  LAB_INTERPRET: '검사 해석 초안',
  RX_WARNING: '처방 경고 초안',
  CODE_MAPPING: '코드 매핑 제안',
};

export function isAiProposalKind(v: unknown): v is AiProposalKind {
  return typeof v === 'string' && (AI_PROPOSAL_KINDS as readonly string[]).includes(v);
}

/* ───────────────── status — 사람 손을 어디까지 거쳤는가 ───────────────── */

export const AI_PROPOSAL_STATUSES = [
  'GENERATED',
  'PRESENTED',
  'ACCEPTED',
  'EDITED',
  'REJECTED',
  'EXPIRED',
  'SUPERSEDED',
] as const;

export type AiProposalStatusValue = (typeof AI_PROPOSAL_STATUSES)[number];

export const AI_PROPOSAL_STATUS_LABEL: Record<AiProposalStatusValue, string> = {
  GENERATED: '생성됨(미노출)',
  PRESENTED: '사람에게 노출됨',
  ACCEPTED: '그대로 수용',
  EDITED: '수정 후 수용',
  REJECTED: '거부',
  EXPIRED: '만료',
  SUPERSEDED: '새 버전으로 대체됨',
};

/**
 * 화면 도움말 — 각 상태가 **무엇을 뜻하지 않는지**까지 적는다.
 * 🔴 `GENERATED` 를 "사람이 봤다"로 읽으면 노출률·검토시간 지표가 통째로 거짓이 된다.
 */
export const AI_PROPOSAL_STATUS_EFFECT: Record<AiProposalStatusValue, string> = {
  GENERATED:
    '서버가 초안을 만들었다. 사람이 봤다는 뜻이 아니다 — 화면이 실제로 렌더한 시점에만 PRESENTED 가 된다.',
  PRESENTED: '화면이 사람에게 보여줬다. 사람이 읽었다는 보증은 아니다(노출 시점만 기록한다).',
  ACCEPTED: '사람이 초안 그대로 정본에 반영했다. 정본 내용의 책임은 승인한 사람에게 있다.',
  EDITED: '사람이 고쳐서 반영했다. 수정량(편집거리)만 기록하고 최종 본문은 정본 테이블에 있다.',
  REJECTED: '사람이 쓰지 않기로 했다. 사유는 선택이다 — 강제하면 거짓 사유가 쌓인다.',
  EXPIRED: '결정 없이 유효기간이 지났다. 거부가 아니다(둘을 섞으면 거부율이 부풀려진다).',
  SUPERSEDED: '같은 대상에 새 버전 제안이 생겨 대체됐다. 제안 본문은 수정되지 않는다(불변).',
};

/** 사람 결정이 내려진 상태 — 여기서 다시 다른 결정으로 넘어가지 않는다(종결) */
export const AI_PROPOSAL_TERMINAL_STATUSES: readonly AiProposalStatusValue[] = [
  'ACCEPTED',
  'EDITED',
  'REJECTED',
  'EXPIRED',
  'SUPERSEDED',
] as const;

/** 사람이 결정할 수 있는 값(decide 입력) — EXPIRED·SUPERSEDED 는 시스템이 만드는 상태다 */
export const AI_PROPOSAL_DECISIONS = ['ACCEPTED', 'EDITED', 'REJECTED'] as const;
export type AiProposalDecision = (typeof AI_PROPOSAL_DECISIONS)[number];

export function isAiProposalStatus(v: unknown): v is AiProposalStatusValue {
  return typeof v === 'string' && (AI_PROPOSAL_STATUSES as readonly string[]).includes(v);
}

/* ───────────────── source — 3상태(기존 정본과 같은 어휘) ───────────────── */

/**
 * `AI` = 모델이 답했다 · `FALLBACK` = 규칙/캐시가 대신 답했다 · `UNAVAILABLE` = 답을 못 얻었다.
 * 🔴 `UNAVAILABLE` 을 빈 초안으로 바꿔 저장하지 않는다 — "없음"과 "모름"은 다른 사실이다.
 */
export const AI_PROPOSAL_SOURCES = ['AI', 'FALLBACK', 'UNAVAILABLE'] as const;
export type AiProposalSourceValue = (typeof AI_PROPOSAL_SOURCES)[number];

export const AI_PROPOSAL_SOURCE_LABEL: Record<AiProposalSourceValue, string> = {
  AI: 'AI 응답',
  FALLBACK: '대체 경로(규칙/캐시)',
  UNAVAILABLE: '산출 불가',
};

/* ───────────────── 전이 규칙 — 서비스·화면이 같은 표를 본다 ───────────────── */

/**
 * 허용 전이. 🔴 `GENERATED → ACCEPTED|EDITED|REJECTED` 를 **막지 않는다**(노출 기록 없이 결정되는
 * 경로가 실제로 있다 — 배치·API 직행). 대신 전이 원장에 `NOT_PRESENTED` 사유를 남겨 지표가
 * "검토 시간 0" 을 정상으로 읽지 않게 한다.
 */
export const AI_PROPOSAL_ALLOWED_TRANSITIONS: Record<AiProposalStatusValue, readonly AiProposalStatusValue[]> = {
  GENERATED: ['PRESENTED', 'ACCEPTED', 'EDITED', 'REJECTED', 'EXPIRED', 'SUPERSEDED'],
  PRESENTED: ['ACCEPTED', 'EDITED', 'REJECTED', 'EXPIRED', 'SUPERSEDED'],
  ACCEPTED: ['SUPERSEDED'],
  EDITED: ['SUPERSEDED'],
  REJECTED: ['SUPERSEDED'],
  EXPIRED: ['SUPERSEDED'],
  SUPERSEDED: [],
};

export function canTransitionAiProposal(from: AiProposalStatusValue, to: AiProposalStatusValue): boolean {
  return (AI_PROPOSAL_ALLOWED_TRANSITIONS[from] ?? []).includes(to);
}

/** 전이 원장 사유 코드 — 사람이 적는 자유 사유와 섞지 않는다(둘 다 `reason` 한 칸에 들어간다) */
export const AI_PROPOSAL_TRANSITION_REASONS = {
  /** 노출 기록 없이 결정됐다 — 검토시간 지표에서 이 건을 "0초 검토"로 세지 않는다 */
  NOT_PRESENTED: 'NOT_PRESENTED',
  /** expiresAt 경과로 시스템이 만료시켰다 */
  EXPIRED_DUE: 'EXPIRED_DUE',
  /** 새 버전 제안이 생겨 대체됐다 */
  SUPERSEDED_BY_NEW_VERSION: 'SUPERSEDED_BY_NEW_VERSION',
} as const;

/** targetId 가 UUID 가 아닌 정본(코드·문자열 키)을 가리킬 때 쓰는 자리표시자 — 추정하지 않는다 */
export const AI_PROPOSAL_ZERO_UUID = '00000000-0000-0000-0000-000000000000';
