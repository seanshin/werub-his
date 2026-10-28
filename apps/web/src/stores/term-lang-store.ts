'use client';

import { useEffect } from 'react';
import { create } from 'zustand';
import { TERM_LANG_DEFAULT, TERM_LANG_MODES, TERM_LANG_LABEL, type TermLangMode } from '@hospital-run/shared';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';

/**
 * 의료용어 한/영 표시 모드 — 사용자 단위 선호(기기 간 동기화 · 기획 P2).
 *
 * 🔴 표시만 바꾼다 — 저장 값·검색·집계·인쇄/대외 문서 불변(기획 §2.1).
 * 🔴 SSR/최초 렌더는 항상 기본값(KO)으로 시작하고 저장값은 마운트 후 적용한다.
 * 저장 두 층: localStorage(즉시·이 기기) + 서버 UserUiPreference(기기 간 동기화).
 *  - 하이드레이션: 서버 값 우선, 못 받으면 localStorage — 로컬 값도 **사용자 자신의 마지막
 *    선택 캐시**라 폴백이 사실을 지어내지 않는다.
 *  - 🔴 서버 저장 실패는 조용히 삼키지 않는다 — "이 기기에만 저장됨"을 토스트로 밝힌다.
 */

const KEY = 'term.lang';

const isMode = (v: unknown): v is TermLangMode =>
  typeof v === 'string' && (TERM_LANG_MODES as readonly string[]).includes(v);

export const useTermLangStore = create<{ mode: TermLangMode; setMode: (m: TermLangMode) => void }>((set) => ({
  mode: TERM_LANG_DEFAULT,
  setMode: (m) => {
    try { localStorage.setItem(KEY, m); } catch { /* 저장 실패해도 이번 세션 표시는 바꾼다 */ }
    set({ mode: m });
    // 🔴 즉시 피드백 — 대상 용어가 없는 화면(상황판 등)에서 누르면 아무 변화가 없어
    //    죽은 스위치로 읽혔다(2026-09-06 사람 신고). 무엇에 적용되는지를 그 자리에서 말한다.
    toast.info(`용어 표시: ${TERM_LANG_LABEL[m]} — 진단명·약품명·검사 항목명이 있는 화면에 적용됩니다`);
    // 서버 동기화(기기 간) — 실패를 없음으로 번역하지 않는다
    apiClient.put('/api/v1/users/me/ui-preferences', { termLang: m }).catch(() => {
      toast.warning('용어 표시 설정이 이 기기에만 저장됐습니다(서버 저장 실패)');
    });
  },
}));

/** 하이드레이션 전용 — 서버 PUT 없이 화면 상태만 맞춘다(받은 값을 되쓰면 무한 왕복) */
function applyLocal(m: TermLangMode) {
  try { localStorage.setItem(KEY, m); } catch { /* */ }
  useTermLangStore.setState({ mode: m });
}

/** 마운트 후 저장된 모드 적용(하이드레이션 안전) — 서버 우선·로컬 폴백. 레이아웃 진입점에서 1회 */
export function useHydrateTermLang() {
  useEffect(() => {
    let cancelled = false;
    // 로컬 캐시를 먼저(즉시) — 서버 응답이 오면 그 값이 이긴다
    try {
      const saved = localStorage.getItem(KEY);
      if (isMode(saved) && saved !== TERM_LANG_DEFAULT) applyLocal(saved);
    } catch { /* 읽기 실패 = 기본값 유지 */ }
    apiClient
      .get<{ data: { termLang: string | null } }>('/api/v1/users/me/ui-preferences')
      .then((r) => {
        if (cancelled) return;
        const server = r?.data?.termLang;
        if (isMode(server)) applyLocal(server);
        // null = 서버 미설정 — 로컬/기본값 유지(미설정을 KO 선택으로 만들지 않는다)
      })
      .catch(() => { /* 조회 실패 = 로컬 캐시 유지(사용자 자신의 마지막 선택) */ });
    return () => { cancelled = true; };
  }, []);
}

/** 현재 표시 모드 — 정본 부품(<Term>·DrugName·LabTerm)이 읽는 훅 */
export function useTermLang(): TermLangMode {
  return useTermLangStore((s) => s.mode);
}
