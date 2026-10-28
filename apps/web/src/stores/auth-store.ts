'use client';

import { create } from 'zustand';
import { apiClient } from '@/lib/api-client';

interface UserProfile {
  id: string;
  email: string;
  familyName: string;
  givenName: string;
  role: string;
  department?: string;
  specialty?: string;
  permissions: string[];
}

interface AuthState {
  user: UserProfile | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  /**
   * 🔴 **서버를 부르지 않고** 로컬 인증 상태만 정리한다.
   *    세션이 이미 만료된 상태에서 `/auth/logout` 을 부르면 또 401 이고, 할 일은 정리뿐이다.
   *    (사용자가 스스로 나가는 `logout` 과는 다른 행위다 — 섞으면 서버 로그아웃이 조용히 실패한다)
   */
  clearSession: () => void;
  loadProfile: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isAuthenticated: typeof window !== 'undefined' && !!localStorage.getItem('accessToken'),
  isLoading: false,

  login: async (email, password) => {
    set({ isLoading: true });
    try {
      const res = await apiClient.post<{ data: { accessToken: string } }>(
        '/api/v1/auth/login',
        { email, password },
      );
      apiClient.setToken(res.data.accessToken);
      if (typeof window !== 'undefined') {
        localStorage.setItem('accessToken', res.data.accessToken);
      }

      const profile = await apiClient.get<{ data: UserProfile }>('/api/v1/auth/me');
      const raw = profile.data as any;
      set({ user: raw?.data ?? raw, isAuthenticated: true });
    } finally {
      set({ isLoading: false });
    }
  },

  clearSession: () => {
    apiClient.setToken(null);
    if (typeof window !== 'undefined') {
      try { localStorage.removeItem('accessToken'); } catch { /* 저장소 접근 불가여도 상태는 정리한다 */ }
    }
    set({ user: null, isAuthenticated: false });
  },

  logout: async () => {
    try {
      await apiClient.post('/api/v1/auth/logout');
    } catch {
      // ignore
    }
    apiClient.setToken(null);
    if (typeof window !== 'undefined') {
      localStorage.removeItem('accessToken');
    }
    set({ user: null, isAuthenticated: false });
  },

  loadProfile: async () => {
    try {
      set({ isLoading: true });
      // Restore token from localStorage
      if (!apiClient.getToken() && typeof window !== 'undefined') {
        const saved = localStorage.getItem('accessToken');
        if (saved) apiClient.setToken(saved);
      }
      if (!apiClient.getToken()) {
        set({ user: null, isAuthenticated: false });
        return;
      }
      const profile = await apiClient.get<{ data: UserProfile }>('/api/v1/auth/me');
      const raw = profile.data as any;
      set({ user: raw?.data ?? raw, isAuthenticated: true });
    } catch {
      if (typeof window !== 'undefined') {
        localStorage.removeItem('accessToken');
      }
      apiClient.setToken(null);
      set({ user: null, isAuthenticated: false });
    } finally {
      set({ isLoading: false });
    }
  },
}));
