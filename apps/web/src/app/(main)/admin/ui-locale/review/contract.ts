/**
 * 언어팩 사람 검수 — **서버 계약 미러** (정본: `apps/api/src/modules/i18n-review/**`).
 *
 * 🔴 이 파일은 **서버를 베낀 사본이다.** 사본은 낡는다 — 그래서 낡으면 실패하도록
 *    `apps/web/test/architecture/i18n-review-contract.spec.ts` 가 컨트롤러·DTO·서비스 소스를
 *    파싱해 **경로·메서드·요청 필드·응답 필드**를 기계 대조한다(수기 목록 복사 금지 규약).
 *
 * 🔴 이 저장소가 실제로 겪은 것: `{data:{balanceDue}}` 를 최상위에서 읽어 퇴원 게이트가 무발동,
 *    없는 EP 를 부르는 배지가 개통 이래 사망, 서버에 없는 이름(`type`/`amount`)으로 읽어 I/O 가 0.
 *    전부 "타입은 맞는데 사실이 아닌" 결함이라 tsc 가 못 잡는다. 대조는 소스에서 파생한다.
 */

/** 컨트롤러 `@Controller('api/v1/i18n')` */
export const I18N_REVIEW_BASE = '/api/v1/i18n';

/**
 * 🔴 **일괄 승인 경로가 없다**(기획서 §2.3). 여기에 `approveAll`/`ids` 를 추가하는 순간
 *    무확인 일괄 적용이 된다 — 이 저장소는 코드 매핑 `autoConfirm` 으로 이미 사고를 냈다.
 */
export const I18N_REVIEW_EP = {
  /**
   * GET — 승인분 런타임 오버레이.
   * 🔴 **이 화면은 부르지 않는다** — 부팅 시 오버레이를 등록하는 일(P0)은 이 화면 밖에 있다.
   *    여기에 적어 두는 이유는 경로 대조(양방향)를 위해서다. "쓴다"고 적으면 그것부터 거짓말이 된다.
   */
  overrides: `${I18N_REVIEW_BASE}/overrides`,
  /** GET 워크리스트 · POST 교정 제안 */
  review: `${I18N_REVIEW_BASE}/review`,
  /** GET 통계(분모 병기) */
  stats: `${I18N_REVIEW_BASE}/review/stats`,
  /** GET 내보내기 텍스트 */
  export: `${I18N_REVIEW_BASE}/review/export`,
  /**
   * POST — **키만으로 "번역하지 않음"(REJECTED + 사유)** 을 남긴다(기획서 §2.4 · 2026-09-09 신설).
   * 🔴 이 경로가 없을 때는 안전 키를 반려하려면 쓰지도 않은 교정값을 먼저 저장해야 했다
   *    — 목적지는 있는데 도로가 없던 자리다. 사유는 여기서만 필수다(값이 없어 사유가 곧 내용이다).
   */
  rejectKey: `${I18N_REVIEW_BASE}/review/reject-key`,
  /** POST 건별 승인 */
  approve: (id: string) => `${I18N_REVIEW_BASE}/review/${id}/approve`,
  /** POST 건별 반려(제안된 행에 대한 판정) */
  reject: (id: string) => `${I18N_REVIEW_BASE}/review/${id}/reject`,
  /** POST 코드 반영 표시(ADMIN) */
  merged: (id: string) => `${I18N_REVIEW_BASE}/review/${id}/merged`,
} as const;

/** 서버 `REVIEW_FILTERS`(dto) 와 **집합이 같아야 한다** — 대조 스펙이 못박는다 */
export const REVIEW_FILTERS = [
  'all',
  'unreviewed',
  'proposed',
  'approved',
  'rejected',
  'merged',
  'contextGap',
  'safety',
  'untranslated',
  'baseChanged',
] as const;
export type ReviewFilter = (typeof REVIEW_FILTERS)[number];

/** 필터 라벨 — 어휘를 지어내지 않는다(서버 필터 의미를 그대로 한국어로 적는다) */
export const REVIEW_FILTER_LABEL: Record<ReviewFilter, string> = {
  all: '전체',
  unreviewed: '미검수',
  proposed: '제안됨',
  approved: '승인됨',
  rejected: '반려됨',
  merged: '코드 반영됨',
  contextGap: '문맥 결손',
  safety: '안전 키',
  untranslated: '미번역',
  baseChanged: '원본 바뀜',
};

/* ── 응답 ────────────────────────────────────────────────────────────────────── */

/** 서버 `I18nReviewService.ReviewRow` 미러 — **필드 이름을 지어내지 않는다** */
export interface ReviewRow {
  id: string | null;
  locale: string;
  key: string;
  source: string;
  context: string | null;
  area: string;
  codeValue: string | null;
  codeVerified: boolean;
  overlayValue: string | null;
  status: 'NONE' | 'PROPOSED' | 'APPROVED' | 'REJECTED' | 'MERGED';
  effectiveValue: string | null;
  effectiveOrigin: 'UNTRANSLATED' | 'CODE_AI_DRAFT' | 'CODE_VERIFIED' | 'REVIEW_APPROVED';
  effectiveOriginText: string;
  safetyKey: boolean;
  safetyReason: string | null;
  /** 🔴 `null` = 팩이 없어 **산출 불가**(false = 결손 없음과 다른 사실) */
  contextGap: boolean | null;
  baseChanged: boolean;
  baseValue: string | null;
  /** 제안자가 왜 이렇게 고쳤는지 — 🔴 판정 사유가 이 칸을 덮지 않는다 */
  note: string | null;
  /** 최신 전이 원장에서 파생한 **판정 사유**(승인·반려) */
  decisionReason: string | null;
  decisionAt: string | null;
  proposedBy: string | null;
  proposedByName: string | null;
  proposedAt: string | null;
  reviewedBy: string | null;
  reviewedByName: string | null;
  reviewedAt: string | null;
  mergedAt: string | null;
  selfApproved: boolean;
  /**
   * 🔴 "이 키는 번역하지 않는다"로 판정된 행(§2.4). 서버가 준 어휘를 그대로 쓴다 —
   *    `overlayValue: ''` 를 화면이 "값 있음"으로 읽지 않게 하려고 서버가 붙여 준 필드다.
   */
  noTranslate: boolean;
  /** 🔴 `null` = 셀 수 없었다(빈 배열 = 쓰는 곳 없음과 **다른 사실**) */
  usedIn: string[] | null;
}

/** 서버 `ReviewPermission` 미러 */
export interface ReviewPermission {
  locale: string;
  canPropose: boolean;
  canApprove: boolean;
  canMarkMerged: boolean;
  /** 🔴 왜 되는가/왜 안 되는가 — 화면이 **그대로** 보여준다(숨김 ≠ 권한 회수) */
  reason: string;
  /** null = 설정 조회 실패(0 명과 다른 사실) */
  reviewerCount: number | null;
  configKey: string;
}

export interface ReviewMeta {
  total: number;
  returned: number;
  offset: number;
  limit: number;
  truncated: boolean;
  catalogTotal: number;
  filter: string;
  areas: string[];
  contextGapAvailable: boolean;
  contextGapUnavailableReason: string | null;
  usage: { available: boolean; scannedFiles: number | null; unavailableReason: string | null };
  permission: ReviewPermission;
}

export interface ReviewListResponse {
  data: ReviewRow[];
  meta: ReviewMeta;
}

export interface ReviewRatio {
  value: number | null;
  numerator: number;
  denominator: number;
  unavailableReason: string | null;
}

export interface ReviewStats {
  locale: string;
  packPresent: boolean;
  catalogTotal: number;
  translated: number;
  untranslated: number;
  safetyTotal: number;
  /** null = 팩이 없어 산출 불가(0 이 아니다) */
  contextGaps: number | null;
  contextGapsUnavailableReason: string | null;
  review: { proposed: number; approved: number; rejected: number; merged: number; reviewed: number; unreviewed: number };
  /** 카탈로그에 더 이상 없는 키의 검수 기록 수 — 검수율 분자에서 빠져 있다(지우지 않고 드러낸다) */
  orphanOverrides: number;
  approvedNotInCode: number;
  /** "이 키는 번역하지 않는다"로 판정된 키 수(§2.4) */
  noTranslate: number;
  /**
   * 🔴 그중 **코드에 AI 초안이 남아 화면에는 여전히 번역이 나가는** 키 수.
   *    이걸 안 그리면 "N건 번역 안 함"이라 말하면서 화면은 번역을 보여주는 P17 이 된다.
   */
  noTranslateButCodeStillShows: number;
  reviewedRatio: ReviewRatio;
  translatedRatio: ReviewRatio;
  codeVerifiedCount: number;
}

export interface ReviewStatsResponse {
  data: ReviewStats;
  meta: { permission: ReviewPermission };
}

export interface ProposeResult {
  id: string;
  status: string;
  /** 🔴 기록 ≠ 적용 — 저장은 됐고 화면에는 아직 안 나간다 */
  appliedToRuntime: boolean;
  appliedNote: string;
  previousStatus: string | null;
}

export interface DecisionResult {
  id: string;
  status: string;
  fourEyes: { satisfied: boolean; selfApproved: boolean; message: string };
  appliedToRuntime: boolean;
  appliedNote: string;
}

/**
 * 키만으로 "번역하지 않음" 판정한 결과.
 * 🔴 **기록 ≠ 적용** — 반려는 코드 카탈로그의 AI 초안을 지우지 않는다. `codeStillShows` 가 true 면
 *    화면에는 그 초안이 계속 나간다(§2.5 코드 수렴이 남아 있다는 뜻). 이 사실을 화면이 말한다.
 */
export interface RejectKeyResult {
  id: string;
  status: string;
  /** 항상 false — 반려는 런타임에 아무것도 얹지 않는다 */
  appliedToRuntime: boolean;
  codeStillShows: boolean;
  codeValue: string | null;
  appliedNote: string;
  /** 제안 행이 없어 새로 만들었는가(기존 행이면 기존 반려 경로로 흘렀다) */
  createdRow: boolean;
  noTranslate: boolean;
  /** 기존 행을 반려한 경우에만 실린다(제안이 없던 새 행에는 4-eyes 판정 자체가 없다) */
  fourEyes?: { satisfied: boolean; selfApproved: boolean; message: string };
}

export interface MergedResult {
  id: string;
  status: string;
  /** 표시는 사람의 주장이다 — 코드가 실제로 같은지는 서버가 따로 답한다 */
  codeMatches: boolean;
  codeValue: string | null;
  appliedToRuntime: boolean;
  appliedNote: string;
}

export interface ExportResult {
  text: string;
  count: number;
  alreadyInCode: number;
}
