'use client';

import { useEffect } from 'react';
import { create } from 'zustand';
import { applyReviewOverlay, UI_LOCALE_DEFAULT, type ReviewOverlayEntry } from '@hospital-run/shared';
import { apiClient } from '@/lib/api-client';
import { useUiLocale } from '@/stores/ui-locale-store';

/**
 * 검수 오버레이 런타임 등록 — **사람이 승인한 번역을 실제 화면에 얹는 유일한 경로**
 * (정본 `docs/01-plan/features/i18n-human-review.plan.md` §2.2).
 *
 * 🔴 이 파일이 생기기 전까지, 승인된 번역은 **어느 화면에도 나가지 않았다**(2026-09-09 실측:
 *    `applyReviewOverlay`·`GET /i18n/overrides` 소비처 0). 원장·화면·EP 는 다 있었고
 *    적용만 없었다 — 이 저장소가 반복해 겪은 "만든 것 ≠ 소비처가 쓰는 것"의 자리다.
 *
 * 🔴 **실패를 '없음'으로 번역하지 않는다.** 조회가 실패하면 화면은 코드 초안으로 그려지지만,
 *    그 사실을 상태로 남겨 관제 화면(`/admin/ui-locale/review`)이 말한다. `.catch(() => [])` 로
 *    빈 배열을 만들면 "승인분이 0건"과 "불러오지 못함"이 같은 그림이 된다 — 다른 사실이다.
 */

/** 🔴 세 갈래를 뭉개지 않는다: 아직 안 함 / 부를 필요 없음(ko) / 불러왔음 / 못 불러왔음 */
export type OverlayLoadStatus =
  | 'IDLE'
  | 'LOADING'
  /** 한국어는 원문이 곧 정본이라 오버레이 대상이 아니다(실패가 아니다) */
  | 'SKIPPED_KO'
  | 'APPLIED'
  /** 조회는 성공했고 승인분이 0건이었다(실패가 아니다) */
  | 'EMPTY'
  /** 그 언어의 팩이 없어 얹을 곳이 없다 — 팩을 지어내지 않는다 */
  | 'NO_PACK'
  /** 🔴 조회 자체가 실패했다 — 화면은 코드 초안이고, 그 사실을 말해야 한다 */
  | 'FAILED';

export interface OverlayLoadState {
  status: OverlayLoadStatus;
  locale: string | null;
  /** 실제로 얹힌 키 수 */
  applied: number;
  /** 값이 비어 얹지 않은 항목 수 */
  skipped: number;
  /**
   * 앞선 적용에서 얹혔는데 이번 목록엔 없는 키(승인 취소·반려). 팩 병합에는 회수 경로가 없어
   * **이 세션 동안 옛 승인값이 그대로 보인다** — 0 이 아니면 화면이 말한다(shared `overlay.ts`).
   */
  staleKeys: string[];
  /** 실패 사유(사람이 읽는 문장). 성공 시 null */
  error: string | null;
  /** 마지막 시도 시각(ISO). 한 번도 시도하지 않았으면 null */
  at: string | null;
}

const INITIAL: OverlayLoadState = {
  status: 'IDLE', locale: null, applied: 0, skipped: 0, staleKeys: [], error: null, at: null,
};

export const useI18nOverlayStore = create<OverlayLoadState>(() => ({ ...INITIAL }));

/** 테스트 전용 — 스토어 초기화 */
export function __resetI18nOverlayStoreForTest(): void {
  useI18nOverlayStore.setState({ ...INITIAL });
}

interface OverridesResponse {
  data?: { entries?: ReviewOverlayEntry[] } | ReviewOverlayEntry[];
}

/** `{ data: { entries } }` / `{ data: [] }` 양쪽 언랩 — 서버 봉투가 바뀌어도 조용히 0건이 되지 않게 */
function entriesOf(res: unknown): ReviewOverlayEntry[] | null {
  const d = (res as OverridesResponse | undefined)?.data;
  if (Array.isArray(d)) return d;
  if (d && Array.isArray((d as { entries?: ReviewOverlayEntry[] }).entries)) {
    return (d as { entries: ReviewOverlayEntry[] }).entries;
  }
  return null;
}

/**
 * 부팅·언어 전환 시 1회 — 승인된 검수 결과를 그 언어 팩에 얹는다.
 * `(main)` 레이아웃 진입점에서 부른다(`useHydrateUiLocale` 옆).
 */
export function useHydrateReviewOverlay(opts: { enabled?: boolean } = {}): void {
  const locale = useUiLocale();
  // 🔴 로그인 전에는 부르지 않는다(JWT EP — 401 이 세션 만료 알림으로 번진다). 로그인되면 다시 돈다.
  const enabled = opts.enabled ?? true;
  useEffect(() => {
    let cancelled = false;
    const at = () => new Date().toISOString();
    if (!enabled) return () => { cancelled = true; };

    if (locale === UI_LOCALE_DEFAULT) {
      // 한국어는 원문이 정본 — 부르지 않는 것이 맞고, 그 사실을 상태로 남긴다
      useI18nOverlayStore.setState({ ...INITIAL, status: 'SKIPPED_KO', locale, at: at() });
      return;
    }
    useI18nOverlayStore.setState({ ...INITIAL, status: 'LOADING', locale, at: at() });

    apiClient
      .get<OverridesResponse>(`/api/v1/i18n/overrides?locale=${encodeURIComponent(locale)}`)
      .then((res) => {
        if (cancelled) return;
        const entries = entriesOf(res);
        if (entries === null) {
          // 🔴 응답 모양이 계약과 다르다 — 0건으로 읽지 않는다(그건 다른 사실이다)
          useI18nOverlayStore.setState({
            ...INITIAL, status: 'FAILED', locale, at: at(),
            error: '검수 오버레이 응답을 해석할 수 없습니다(서버 응답 모양이 계약과 다릅니다).',
          });
          return;
        }
        const r = applyReviewOverlay(locale, entries);
        useI18nOverlayStore.setState({
          status: r.reason === 'APPLIED' ? 'APPLIED' : r.reason,
          locale, applied: r.applied, skipped: r.skipped, staleKeys: r.staleKeys, error: null, at: at(),
        });
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        const msg = e instanceof Error ? e.message : String(e);
        useI18nOverlayStore.setState({
          ...INITIAL, status: 'FAILED', locale, at: at(),
          error: `검수 오버레이를 불러오지 못했습니다 — 화면은 코드 초안으로 표시됩니다. (${msg})`,
        });
      });

    return () => { cancelled = true; };
  }, [locale, enabled]);
}

/** 관제 화면이 읽는 훅 */
export function useI18nOverlayState(): OverlayLoadState {
  return useI18nOverlayStore();
}
