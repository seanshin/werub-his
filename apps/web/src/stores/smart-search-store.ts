'use client';

import { create } from 'zustand';

/**
 * 통합검색(Cmd+K) 열림 상태 — 기획 medical-term-display-toggle.plan.md P1(검색 두 벌 통합).
 * 🔴 종전에는 TopBar 인라인 검색과 Cmd+K 모달이 **같은 검색을 두 벌** 구현하고 있었다(P12) —
 *    TopBar 는 이 스토어로 모달을 열기만 하고, 검색 구현은 SmartSearchBar 하나만 남긴다.
 */
export const useSmartSearchStore = create<{ open: boolean; setOpen: (v: boolean) => void }>((set) => ({
  open: false,
  setOpen: (v) => set({ open: v }),
}));
