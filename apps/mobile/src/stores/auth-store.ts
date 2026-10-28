import { create } from 'zustand';
import { Platform } from 'react-native';
import { getOrCreateDeviceId, getItem, setItem } from '../lib/secure-storage';
import { apiClient } from '../lib/api-client';

interface User {
  id: string;
  phoneNumber: string;
  name: string;
  patientId?: string;
  /**
   * 환자에게 보여주는 등록번호(예: P2026-0001).
   * 🔴 종전 저장하지 않아서 '더보기' 화면이 `patientId`(UUID)를 "환자번호"로 찍고 있었다.
   *    로그인 응답과 /portal/profile 이 모두 mrn 을 준다.
   */
  mrn?: string;
}

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;

  login: (phoneNumber: string, password: string) => Promise<void>;
  /** 🔴 서버 PatientLoginPinDto 는 phone·pin·deviceId 를 모두 필수로 받는다 — phone 없이는 400. */
  loginWithPin: (phone: string, pin: string) => Promise<void>;
  /**
   * 🔴 서버 `PatientSignupDto` 필수값은 ci·name·dateOfBirth·gender·phone·password 다.
   *    종전 앱은 `{ phoneNumber, password, name, birthDate }` 를 보냈다 — 이름이 다른 필드 2개
   *    (phone/dateOfBirth)에 더해 gender·ci 가 아예 빠져 **항상 400** 이었다.
   *    ci 는 NICE 본인인증 결과값인데 이 앱에는 본인인증 연동이 없다(patient-auth 라우트 전수 확인:
   *    sms/verify 는 `{verified:boolean}` 만 돌려주고 ci 를 주지 않는다).
   *    → 필드명은 서버 정본에 맞추되, ci 없이 호출하지 않는다(아래 signup 참조).
   */
  signup: (params: {
    phone: string;
    password: string;
    name: string;
    dateOfBirth: string;
    gender: string;
    ci: string;
  }) => Promise<void>;
  logout: () => Promise<void>;
  restoreSession: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isAuthenticated: false,
  isLoading: true,

  login: async (phoneNumber, password) => {
    const deviceId = await getOrCreateDeviceId();
    const platform = Platform.OS === 'web' ? 'Web' : Platform.OS === 'ios' ? 'iOS' : 'Android';
    const { data } = await apiClient.post<{
      data: { accessToken: string; refreshToken: string; patientId: string; patientName: string; accountId: string; mrn: string };
    }>('/api/v1/patient-auth/login', { phone: phoneNumber, password, deviceId, platform }, { skipAuth: true });

    await apiClient.saveTokens({
      accessToken: data.accessToken,
      refreshToken: data.refreshToken,
    });
    // PIN 로그인은 서버가 phone 을 요구하는데 PIN 화면에는 입력란이 없다 —
    // 기기 바인딩 로그인이므로 직전 로그인 번호를 이 기기에 기억해 둔다.
    await setItem('lastPhone', phoneNumber);

    set({
      user: {
        id: data.patientId,
        name: data.patientName,
        patientId: data.patientId,
        phoneNumber,
        mrn: data.mrn,
      },
      isAuthenticated: true,
    });
  },

  loginWithPin: async (phone, pin) => {
    const deviceId = await getOrCreateDeviceId();
    // 🔴 종전엔 phone 을 빼고 `{ pin, deviceId }` 만 보내 항상 400 이었다(PIN 로그인 전면 불가).
    const { data } = await apiClient.post<{
      data: { accessToken: string; refreshToken: string; accountId: string; patientId: string };
    }>('/api/v1/patient-auth/login/pin', { phone, pin, deviceId }, { skipAuth: true });

    await apiClient.saveTokens({
      accessToken: data.accessToken,
      refreshToken: data.refreshToken,
    });

    // 🔴 서버는 `user` 를 주지 않는다(accountId·patientId + 토큰). 종전 `data.user` 는 undefined 라
    //    로그인 직후 이름·환자번호가 전부 빈칸이었다. 프로필로 사용자 정보를 채운다.
    set({
      user: { id: data.patientId, name: '', patientId: data.patientId, phoneNumber: phone },
      isAuthenticated: true,
    });
    await useAuthStore.getState().restoreSession();
  },

  signup: async (params) => {
    const { data } = await apiClient.post<{
      data: {
        accessToken: string; refreshToken: string;
        patientId: string; patientName: string; accountId: string; mrn: string;
      };
    }>('/api/v1/patient-auth/signup', params, { skipAuth: true });

    await apiClient.saveTokens({
      accessToken: data.accessToken,
      refreshToken: data.refreshToken,
    });

    // 🔴 종전 `set({ user: data.user })` — 서버는 `user` 를 주지 않는다(로그인과 같은 flat 형태).
    //    가입에 성공했더라도 user 가 undefined 가 되어 이름·환자번호가 전부 빈칸이었다.
    set({
      user: {
        id: data.patientId,
        name: data.patientName,
        patientId: data.patientId,
        phoneNumber: params.phone,
        mrn: data.mrn,
      },
      isAuthenticated: true,
    });
  },

  logout: async () => {
    try {
      await apiClient.post('/api/v1/patient-auth/logout');
    } catch {
      // 로그아웃 API 실패해도 로컬 세션 정리
    }
    await apiClient.clearTokens();
    // React Query 캐시 초기화 (다른 환자 데이터 잔류 방지)
    const { queryClient } = await import('../lib/query-client');
    queryClient.clear();
    set({ user: null, isAuthenticated: false });
  },

  restoreSession: async () => {
    try {
      const token = await apiClient.getAccessToken();
      if (!token) {
        set({ isLoading: false });
        return;
      }

      const res = await apiClient.get<{ data: any }>('/api/v1/portal/profile');
      const data = (res as any)?.data;
      if (!data?.id) {
        throw new Error('NO_PROFILE');
      }
      set({
        user: {
          id: data.id,
          name: `${data.familyName ?? ''}${data.givenName ?? ''}`,
          patientId: data.id,
          phoneNumber: data.phone,
          mrn: data.mrn,
        },
        isAuthenticated: true,
        isLoading: false,
      });
    } catch {
      await apiClient.clearTokens();
      set({ user: null, isAuthenticated: false, isLoading: false });
    }
  },
}));
