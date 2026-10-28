'use client';

import { useEffect } from 'react';
import { create } from 'zustand';
import { UI_LOCALE_DEFAULT, localeLabelOf, isActiveLocale, type UiLocale } from '@hospital-run/shared';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';

/**
 * UI 크롬 언어 — 사용자 단위 선호(기획 ui-locale-i18n.plan.md §2.3 · term-lang-store 미러).
 *
 * 🔴 표시만 바꾼다 — 기록·저장·검색·집계·인쇄(법정 서식) 불변.
 * 저장 3층 우선순위: 직원 개인(UserUiPreference.uiLocale) > 기관 기본(hospital.defaultUiLocale) > ko.
 * 하이드레이션: 로컬 캐시 즉시 → 서버 개인값이 이김 → 개인 미설정(null)이면 기관 기본.
 * 🔴 서버 저장 실패는 조용히 삼키지 않는다 — "이 기기에만 저장됨" 토스트.
 */

const KEY = 'ui.locale';

export const useUiLocaleStore = create<{ locale: UiLocale; setLocale: (l: UiLocale) => void }>((set) => ({
  locale: UI_LOCALE_DEFAULT,
  setLocale: (l) => {
    try { localStorage.setItem(KEY, l); } catch { /* 저장 실패해도 이번 세션 표시는 바꾼다 */ }
    set({ locale: l });
    // 🔴 P2 이전엔 번역된 화면이 적다 — 무엇이 바뀌는지(그리고 아직 안 바뀐 것)를 그 자리에서 말한다
    toast.info(`화면 언어: ${localeLabelOf(l)} — 번역이 등재된 화면부터 적용됩니다(미번역은 한국어 원문+표시)`);
    apiClient.put('/api/v1/users/me/ui-preferences', { uiLocale: l }).catch(() => {
      toast.warning('화면 언어 설정이 이 기기에만 저장됐습니다(서버 저장 실패)');
    });
  },
}));

function applyLocal(l: UiLocale) {
  try { localStorage.setItem(KEY, l); } catch { /* */ }
  useUiLocaleStore.setState({ locale: l });
}

/**
 * 마운트 후 저장값 적용 — 서버 개인값 > 기관 기본 > 로컬 캐시. 레이아웃 진입점에서 1회.
 * `server:false` 면 로컬 캐시만 적용한다 — 🔴 로그인 전 화면(`/staff/login`)에서 서버를 부르면 401 → refresh 실패 →
 * 세션 만료 알림 → 로그인 화면으로 재이동이 입력 중에 일어난다. 로그인되면 `server` 가 true 로 바뀌어 다시 돈다.
 */
export function useHydrateUiLocale(opts: { server?: boolean } = {}) {
  const server = opts.server ?? true;
  useEffect(() => {
    let cancelled = false;
    try {
      const saved = localStorage.getItem(KEY);
      if (isActiveLocale(saved) && saved !== UI_LOCALE_DEFAULT) applyLocal(saved);
    } catch { /* 읽기 실패 = 기본값 유지 */ }
    if (!server) return () => { cancelled = true; };
    apiClient
      .get<{ data: { uiLocale: string | null } }>('/api/v1/users/me/ui-preferences')
      .then((r) => {
        if (cancelled) return;
        const personal = r?.data?.uiLocale;
        if (isActiveLocale(personal)) { applyLocal(personal); return; }
        // 개인 미설정 → 기관 기본(hospital.defaultUiLocale). 조회 실패는 현 상태 유지(지어내지 않음)
        apiClient
          .get<{ data: unknown }>('/api/v1/config/hospital.defaultUiLocale')
          .then((c) => {
            if (cancelled) return;
            const v = c?.data; // GET /config/:key 는 값 자체를 data 로 돌려준다
            if (isActiveLocale(v) && v !== UI_LOCALE_DEFAULT) applyLocal(v);
          })
          .catch(() => { /* 기관 기본 조회 실패 = 로컬/기본 유지 */ });
      })
      .catch(() => { /* 조회 실패 = 로컬 캐시 유지 */ });
    return () => { cancelled = true; };
  }, [server]);
}

/** 현재 UI 언어 — t()/tOf 소비 부품이 읽는 훅 */
export function useUiLocale(): UiLocale {
  return useUiLocaleStore((s) => s.locale);
}
