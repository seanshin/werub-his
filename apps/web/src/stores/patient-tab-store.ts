'use client';

import { create } from 'zustand';

const STORAGE_KEY = 'patient-tab-config';

interface TabConfig {
  /** 사용자가 설정한 주요 탭 키 (순서대로) */
  primaryKeys: string[];
  /** 숨긴 탭 키 */
  hiddenKeys: string[];
}

const BOARD_KEY = 'patient-board-enabled';
const BOARD_ROUND_KEY = 'patient-board-round';
const BOARD_LAYOUT_KEY = 'patient-board-layout';
const BOARD_PINNED_KEY = 'patient-board-pinned';

function loadBoardLayout(): string[] | null {
  if (typeof window === 'undefined') return null;
  try {
    const saved = localStorage.getItem(BOARD_LAYOUT_KEY);
    if (saved) {
      const arr = JSON.parse(saved);
      if (Array.isArray(arr) && arr.length) return arr as string[];
    }
  } catch { /* ignore */ }
  return null;
}

function loadBoardPinned(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const saved = localStorage.getItem(BOARD_PINNED_KEY);
    const parsed = saved ? JSON.parse(saved) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

interface PatientTabState {
  config: TabConfig;
  setConfig: (config: TabConfig) => void;
  resetConfig: () => void;
  /** 큰 화면 보기(멀티패널 board) 활성 여부 — 사용자 뷰 선호(전 환자 공통·localStorage 지속) */
  boardEnabled: boolean;
  setBoardEnabled: (v: boolean) => void;
  toggleBoard: () => void;
  /** board 회진 밀도(대형 폰트) 여부 */
  boardRound: boolean;
  toggleBoardRound: () => void;
  /** board 패널 레이아웃(사용자 커스텀 키 순서). null = 역할 기본 프리셋 사용 */
  boardLayout: string[] | null;
  setBoardLayout: (keys: string[]) => void;
  resetBoardLayout: () => void;
  /** board 핀 고정 패널 키 — 마소너리 배치에서 항상 상단(먼저) 배치 */
  boardPinned: string[];
  setBoardPinned: (keys: string[]) => void;
}

const DEFAULT_CONFIG: TabConfig = {
  primaryKeys: ['overview', 'encounters', 'medications', 'labresults', 'vitals', 'orders'],
  hiddenKeys: [],
};

function loadConfig(): TabConfig {
  if (typeof window === 'undefined') return DEFAULT_CONFIG;
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) return JSON.parse(saved);
  } catch { /* ignore */ }
  return DEFAULT_CONFIG;
}

function loadBoardEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return localStorage.getItem(BOARD_KEY) === '1';
  } catch { return false; }
}

function persistBoardEnabled(v: boolean) {
  if (typeof window === 'undefined') return;
  try {
    if (v) localStorage.setItem(BOARD_KEY, '1');
    else localStorage.removeItem(BOARD_KEY);
  } catch { /* ignore */ }
}

export const usePatientTabStore = create<PatientTabState>((set, get) => ({
  config: loadConfig(),

  setConfig: (config) => {
    set({ config });
    if (typeof window !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
    }
  },

  resetConfig: () => {
    set({ config: DEFAULT_CONFIG });
    if (typeof window !== 'undefined') {
      localStorage.removeItem(STORAGE_KEY);
    }
  },

  boardEnabled: loadBoardEnabled(),

  setBoardEnabled: (v) => {
    set({ boardEnabled: v });
    persistBoardEnabled(v);
  },

  toggleBoard: () => {
    const next = !get().boardEnabled;
    set({ boardEnabled: next });
    persistBoardEnabled(next);
  },

  boardRound: typeof window !== 'undefined' && (() => { try { return localStorage.getItem(BOARD_ROUND_KEY) === '1'; } catch { return false; } })(),

  toggleBoardRound: () => {
    const next = !get().boardRound;
    set({ boardRound: next });
    if (typeof window !== 'undefined') {
      try { if (next) localStorage.setItem(BOARD_ROUND_KEY, '1'); else localStorage.removeItem(BOARD_ROUND_KEY); } catch { /* ignore */ }
    }
  },

  boardLayout: loadBoardLayout(),

  setBoardLayout: (keys) => {
    set({ boardLayout: keys });
    if (typeof window !== 'undefined') {
      try { localStorage.setItem(BOARD_LAYOUT_KEY, JSON.stringify(keys)); } catch { /* ignore */ }
    }
  },

  resetBoardLayout: () => {
    set({ boardLayout: null });
    if (typeof window !== 'undefined') {
      try { localStorage.removeItem(BOARD_LAYOUT_KEY); } catch { /* ignore */ }
    }
  },

  boardPinned: loadBoardPinned(),

  setBoardPinned: (keys) => {
    set({ boardPinned: keys });
    if (typeof window !== 'undefined') {
      try {
        if (keys.length) localStorage.setItem(BOARD_PINNED_KEY, JSON.stringify(keys));
        else localStorage.removeItem(BOARD_PINNED_KEY);
      } catch { /* ignore */ }
    }
  },
}));
