'use client';

import { create } from 'zustand';
import { fetchContext, type SecurityProfile } from '@/lib/terminal';

// 멀티세션풀 — PHI 격리(§6.4.1): 인증 컨텍스트(표시 메타)만 보유. 차트 등 PHI 본문 미보유.
export interface SessionEntry {
  userId: string;
  name: string;
  role: string;
}

interface TerminalState {
  profile: SecurityProfile | null;
  sessionPool: SessionEntry[]; // 당일 인증·대기 세션(표시용 최소 식별정보)
  activeUserId: string | null;
  lock: { state: 'OPEN' | 'LOCKED'; reason?: string };
  loading: boolean;

  refreshProfile: () => Promise<void>;
  addToPool: (entry: SessionEntry) => void;
  removeFromPool: (userId: string) => void;
  setActive: (userId: string) => void; // 무새로고침 전환(토큰 스왑은 호출측)
  lockScreen: (reason?: string) => void;
  unlock: () => void;
}

export const useTerminalStore = create<TerminalState>((set, get) => ({
  profile: null,
  sessionPool: [],
  activeUserId: null,
  lock: { state: 'OPEN' },
  loading: false,

  refreshProfile: async () => {
    set({ loading: true });
    try {
      const profile = await fetchContext();
      set({ profile });
    } catch {
      set({ profile: null });
    } finally {
      set({ loading: false });
    }
  },

  addToPool: (entry) => {
    const pool = get().sessionPool.filter((e) => e.userId !== entry.userId);
    set({ sessionPool: [...pool, entry], activeUserId: entry.userId });
  },

  removeFromPool: (userId) =>
    set({ sessionPool: get().sessionPool.filter((e) => e.userId !== userId) }),

  // 화면 주권 전환 — activeUserId만 교체(reload 금지). 토큰 체인 스왑은 호출측 책임.
  setActive: (userId) => set({ activeUserId: userId, lock: { state: 'OPEN' } }),

  lockScreen: (reason) => set({ lock: { state: 'LOCKED', reason } }),
  unlock: () => set({ lock: { state: 'OPEN' } }),
}));
