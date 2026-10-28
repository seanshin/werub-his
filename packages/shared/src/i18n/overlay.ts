import { getLocalePack, registerLocalePack } from './pack';

/**
 * 검수 오버레이 — **사람이 승인한 번역**을 런타임에 얹는 층 (정본 `i18n-human-review.plan.md` §2.2).
 *
 * 🔴 **정본은 코드다**(`packages/shared/src/i18n/messages/*.ts`·`packs/*.ts`). 이 층은
 *    "코드 초안(AI) 위에 사람 검수 결과를 덮는 것"이고, 코드로 수렴하면(export → 커밋) 사라진다.
 *    DB 를 정본으로 만들지 않는다 — 같은 사실에 정본이 둘이 되면 다음 배포가 조용히 되돌린다(P12).
 *
 * 🔴 **왜 `registerCatalog` 가 아니라 팩 병합인가** (기획서 문구와의 차이 — 명시해 둔다):
 *    `tOf()` 의 조회 순서는 ① **팩**(`packLookup`) ② 빌트인 영역 카탈로그(`CATALOGS`) 다.
 *    빌트인 카탈로그는 부팅 시 이미 **팩으로 조립**되므로(`messages/registry.ts`),
 *    오버레이를 `CATALOGS` **맨 앞**에 넣어도 ①에서 조립된 빌트인 팩이 먼저 이겨
 *    **오버레이가 화면에 나오지 않는다**. "만든 것 ≠ 소비처가 쓰는 것"이 되는 자리다.
 *    그래서 팩의 공식 확장점(같은 코드 재등록 = 병합·나중 등록이 이김)을 쓴다.
 *
 * 🔴 승인된 오버레이는 `verified` 로 등록한다 — 사람이 검수한 값이므로 AI 초안 티를 달지 않는다.
 *    (`PROPOSED`/`REJECTED` 는 애초에 서버가 이 경로로 내려보내지 않는다 — 반영은 `APPROVED` 만.)
 */

export interface ReviewOverlayEntry {
  /** 카탈로그 키 = 한국어 원문(문맥 키는 `원문@문맥`) */
  key: string;
  /** 검수자가 확정한 번역 */
  value: string;
}

export type OverlayApplyReason =
  /** 적용됨 */
  | 'APPLIED'
  /** 🔴 그 언어의 팩이 없다 — 팩을 **지어내지 않는다**(없는 언어를 선택지에 띄우게 된다) */
  | 'NO_PACK'
  /** 보낼 항목이 0건이었다(실패가 아니다 — 승인분이 아직 없다는 사실) */
  | 'EMPTY';

export interface OverlayApplyResult {
  code: string;
  /** 실제로 얹힌 키 수 */
  applied: number;
  /** 값이 비어 얹지 않은 항목 수 — 빈 값으로 코드 초안을 지우지 않는다 */
  skipped: number;
  reason: OverlayApplyReason;
  /**
   * 🔴 **회수되지 않은 키** — 앞선 적용에서 얹혔는데 이번 목록에는 없는 키다(승인이 취소·반려됐다는 뜻).
   *    팩 등록은 **병합**이라 값을 되돌리거나 `verified` 에서 빼는 경로가 없다(`pack.ts` 규약).
   *    그래서 이 키들은 **이 세션 동안 옛 승인값이 그대로 보인다** — 완전한 회수는 새로고침(팩 재조립)뿐이다.
   *    0 이 아닌 값을 조용히 두지 않는다: 소비처(관제 화면)가 이 사실을 말해야 한다.
   */
  staleKeys: string[];
}

/** 언어별로 오버레이가 덮은 키 — 화면·가드가 "이 값의 출처가 검수인가"를 물을 수 있게 */
const OVERLAY_KEYS = new Map<string, Set<string>>();

/**
 * 승인된 검수 결과를 그 언어 팩 위에 얹는다.
 *
 * 🔴 팩이 없으면 **만들지 않는다**: `registerLocalePack` 은 미등록 코드를 새 팩으로 등재하므로
 *    label/dir/tag/status 를 지어내야 하고, `status:'ACTIVE'` 로 잘못 지으면 **번역이 거의 없는
 *    언어가 선택지에 뜬다**. 모르는 것은 모른다고 답한다(`NO_PACK`).
 */
export function applyReviewOverlay(code: string, entries: ReviewOverlayEntry[]): OverlayApplyResult {
  const prev = getLocalePack(code);
  if (!prev) return { code, applied: 0, skipped: entries.length, reason: 'NO_PACK', staleKeys: [] };
  const messages: Record<string, string> = {};
  let skipped = 0;
  for (const e of entries) {
    if (!e || !e.key || e.value == null || e.value === '') {
      skipped++;
      continue;
    }
    messages[e.key] = e.value;
  }
  const keys = Object.keys(messages);
  // 🔴 앞서 얹혔는데 이번엔 빠진 키 = 회수되지 않은 값(위 `staleKeys` 주석 참조)
  const staleKeys = [...(OVERLAY_KEYS.get(code) ?? [])].filter((k) => !(k in messages)).sort();
  if (keys.length === 0) return { code, applied: 0, skipped, reason: 'EMPTY', staleKeys };
  // 같은 코드 재등록 = 병합(pack.ts 규약) — 나중 등록이 같은 키를 덮고 verified 는 합집합이다.
  registerLocalePack({
    code: prev.code,
    label: prev.label,
    dir: prev.dir,
    tag: prev.tag,
    status: prev.status,
    note: prev.note,
    messages,
    verified: new Set(keys),
  });
  const seen = OVERLAY_KEYS.get(code) ?? new Set<string>();
  for (const k of keys) seen.add(k);
  OVERLAY_KEYS.set(code, seen);
  return { code, applied: keys.length, skipped, reason: 'APPLIED', staleKeys };
}

/** 이 언어에서 검수 오버레이가 덮은 키 집합(읽기 전용 사본) */
export function reviewOverlayKeys(code: string): string[] {
  return [...(OVERLAY_KEYS.get(code) ?? [])].sort();
}

/** 이 키의 현재 값이 검수 오버레이에서 왔는가 */
export function isReviewOverlayKey(code: string, key: string): boolean {
  return OVERLAY_KEYS.get(code)?.has(key) ?? false;
}

/** 테스트 전용 — 오버레이 기록 초기화(팩 자체는 되돌리지 않는다) */
export function __resetReviewOverlayKeysForTest(): void {
  OVERLAY_KEYS.clear();
}

/* ── 값의 출처(어휘 정본) ──────────────────────────────────────────────────────
 * 🔴 화면은 **어느 쪽이 보이는지를 항상 말한다**(기획서 §1-1). 어휘를 FE 가 따로 지어내면
 *    서버 판정과 갈라지므로 여기 하나로 둔다(FE·API·가드가 같은 상수를 쓴다).
 */
export const I18N_VALUE_ORIGINS = ['UNTRANSLATED', 'CODE_AI_DRAFT', 'CODE_VERIFIED', 'REVIEW_APPROVED'] as const;
export type I18nValueOrigin = (typeof I18N_VALUE_ORIGINS)[number];

/** 출처 배지 문구 — 지어내지 않고 이 표를 쓴다 */
export const I18N_VALUE_ORIGIN_TEXT: Record<I18nValueOrigin, string> = {
  UNTRANSLATED: '미번역(원문 표시)',
  CODE_AI_DRAFT: '코드 AI 초안',
  CODE_VERIFIED: '코드 검수 완료',
  REVIEW_APPROVED: '검수 완료(오버레이)',
};

/** 검수 상태 어휘 — DB enum(`TranslationOverrideStatus`) + '제안 없음' */
export const I18N_REVIEW_STATES = ['NONE', 'PROPOSED', 'APPROVED', 'REJECTED', 'MERGED'] as const;
export type I18nReviewState = (typeof I18N_REVIEW_STATES)[number];

export const I18N_REVIEW_STATE_TEXT: Record<I18nReviewState, string> = {
  NONE: '미검수',
  PROPOSED: '제안됨',
  APPROVED: '승인됨',
  REJECTED: '반려됨(번역하지 않음 포함)',
  MERGED: '코드 반영됨',
};
