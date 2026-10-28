'use client';

import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { T, useTAttr } from '@/components/ui/i18n-text';

interface ConfigEntry { key: string; value: unknown }

// HIS → edu(사내교육) SSO 런처. aud=edu staff-token(RS256·공개 JWKS 검증)을 발급해 핸드오프.
// 설정(runtime config): edu.enabled·edu.url·edu.ssoPath. 실패 시 일반 링크로 폴백.
export function EduLauncher() {
  const tAttr = useTAttr();
  const { data } = useQuery({
    queryKey: ['config', 'integration'],
    queryFn: () => apiClient.get<{ data: ConfigEntry[] }>('/api/v1/config?category=integration').then((r) => r.data ?? []),
    staleTime: 5 * 60 * 1000,
  });

  const cfg = (k: string) => (data as ConfigEntry[] | undefined)?.find((c) => c.key === k)?.value;
  const enabled = cfg('edu.enabled') !== false;
  // 🔴 기본 도메인으로 떨어지지 않는다 — 종전엔 미설정이면 **다른 기관의 edu 도메인**으로
  //    staff-token(10분)을 URL 에 실어 새 창을 열었다. 주소를 모르면 버튼을 내지 않는다.
  const url = ((cfg('edu.url') as string) || '').trim().replace(/\/+$/, '');
  const ssoPath = (cfg('edu.ssoPath') as string) || '/sso';

  if (!enabled || !url) return null;

  const open = async () => {
    const win = window.open('', '_blank'); // 팝업 차단 방지: 클릭 시점 동기 오픈
    try {
      const res = await apiClient.get<{ data: { token: string } }>('/api/v1/sign-integration/edu-sso-token');
      const token = res?.data?.token ?? '';
      if (!token) throw new Error('no token');
      const target = `${url}${ssoPath}?token=${encodeURIComponent(token)}`;
      if (win) win.location.href = target;
      else window.open(target, '_blank', 'noopener');
    } catch {
      // SSO 실패 → 일반 링크(edu 로그인 페이지)로 폴백
      if (win) win.location.href = `${url}/`;
      else window.open(`${url}/`, '_blank', 'noopener');
    }
  };

  return (
    <button onClick={open} title={tAttr('사내교육 (SSO 자동 로그인)')}
      className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-[12px] font-medium text-slate-300 bg-slate-800/60 hover:bg-slate-700/70 transition-colors mb-2">
      <span aria-hidden="true">🎓</span>
      <T k="사내교육" className="flex-1 text-left" />
      <svg className="w-3 h-3 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5h5v5m0-5L10 14M9 5H5a2 2 0 00-2 2v12a2 2 0 002 2h12a2 2 0 002-2v-4" />
      </svg>
    </button>
  );
}
