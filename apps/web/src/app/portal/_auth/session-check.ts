/**
 * 🔴 (2026-10-19 v4.93.1) 포털이 받은 "세션 만료" 통지가 정말 세션이 끝났다는 뜻인지 확인한다.
 *    401 은 세션 만료만이 아니다 — 등록번호(레거시) 세션의 알림 조회(`patient-auth/notifications/*`)는 설계상 401 이다.
 *    v4.93.0 은 그 401 을 세션 끝으로 읽어 등록번호 로그인 직후 로그인 화면으로 튕겼다(사용자 신고).
 *    세션 정본 조회(프로필)가 401 일 때만 끝났다고 판정한다 — 확인 실패(네트워크 등)는 끝났다고 단정하지 않는다.
 */
import { useQuery } from '@tanstack/react-query';
import type { PortalAccountFeature, PortalSessionInfo } from '@hospital-run/shared';
import { apiClient } from '@/lib/api-client';

const API_URL = process.env.NEXT_PUBLIC_API_URL || '';

export async function portalSessionEnded(token: string | null): Promise<boolean> {
  if (!token) return true;
  try {
    const res = await fetch(`${API_URL}/api/v1/portal/profile`, { headers: { Authorization: `Bearer ${token}` } });
    return res.status === 401;
  } catch {
    return false;
  }
}

/**
 * 🔴 (2026-10-19 v4.93.2) 계정 전용 기능(`patient-auth/*`)을 등록번호·보호자 세션으로 부르면 서버가 403 PATIENT_ACCOUNT_REQUIRED 로 답한다.
 *    조회 실패도 세션 만료도 아니다 — "계정으로 로그인하면 쓸 수 있다"는 안내로 그린다.
 */
export const PATIENT_ACCOUNT_REQUIRED = 'PATIENT_ACCOUNT_REQUIRED';
export function isAccountRequired(e: unknown): boolean {
  return !!e && typeof e === 'object' && (e as { code?: unknown }).code === PATIENT_ACCOUNT_REQUIRED;
}

/**
 * 🔴 (2026-10-19 포털 세련화 A1) 세션 능력표 — 화면이 계정 전용 기능을 **불러 보기 전에** 쓸 수 있는지 안다.
 *    정본 shared `portal-session.ts` · 서버 `GET /api/v1/portal/session`(가드와 기계 대조).
 */
export function usePortalSession(enabled = true) {
  // 🔴 (v4.95.1) 토큰이 없을 때(로그인 전) 부르면 401 → 세션 만료 통지 → 로그인 화면에 "로그인 시간이 지나…" 가 뜬다.
  //    토큰이 있을 때만 부르고, 토큰이 바뀌면(로그인·계정 전환) 다시 받는다 — 키에 토큰 꼬리를 넣는다(토큰 전체는 넣지 않는다).
  const token = apiClient.getToken();
  return useQuery({
    queryKey: ['portal-session', token ? token.slice(-16) : null],
    queryFn: () => apiClient.get<{ data: PortalSessionInfo }>('/api/v1/portal/session').then((r) => r.data),
    enabled: enabled && !!token,
    staleTime: 60_000,
  });
}

/**
 * 계정 전용 기능을 이 세션이 쓸 수 있는가 — true(쓸 수 있음) · false(계정 없음 — 부르지 말고 안내) ·
 * undefined(능력표가 아직 오는 중 — 부르지 말고 기다린다) · null(능력표 조회 실패 — 모른다).
 * 🔴 모름(null)은 false 로 접지 않는다 — 그때는 종전대로 불러 보고 서버 응답(403 PATIENT_ACCOUNT_REQUIRED)으로 가른다.
 * 🔴 오는 중(undefined)과 모름(null)은 다른 사실이다 — 오는 중에 부르면 계정 없는 세션도 한 번씩 부른다.
 */
export function useAccountFeature(feature: PortalAccountFeature): boolean | null | undefined {
  const { data, isPending, isError } = usePortalSession();
  if (isPending) return undefined; // 오는 중 · 토큰 없음(로그인 전) — 둘 다 부르지 않는다
  if (isError || !data) return null;
  return data.features?.[feature] ?? null;
}

/** 계정 전용 EP 를 불러도 되는가 — 능력표가 왔고 false 가 아니면(또는 능력표 실패로 모르면) */
export const mayCallAccountFeature = (allowed: boolean | null | undefined) => allowed !== undefined && allowed !== false;

/** 병원 설정으로 켜고 끄는 포털 기능 — true · false(꺼짐: 부르지 않는다) · undefined(오는 중) · null(모름: 불러서 서버로 판정) */
export function usePortalService(service: keyof PortalSessionInfo['services']): boolean | null | undefined {
  const { data, isPending, isError } = usePortalSession();
  if (isPending) return undefined;
  if (isError || !data?.services) return null;
  return data.services[service] ?? null;
}
