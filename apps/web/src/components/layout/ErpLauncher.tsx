'use client';

import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';
import { useTAttr } from '@/components/ui/i18n-text';

interface ConfigEntry { key: string; value: unknown }

// HIS → ERP SSO 런처. 설정(런타임 config)으로 활성화·URL·접근권한 제어.
// 접근권한 = 허용 역할(erp.allowedRoles) ∪ 개별 허용 사용자(erp.allowedUserIds). 접근 권한 관리→외부 시스템 접근.
export function ErpLauncher({ role, userId }: { role: string; userId?: string }) {
  // 🔴 토스트는 문자열을 받는다(티를 그릴 자리가 없다) — 미등록이면 한국어 원문 그대로 나간다
  const tAttr = useTAttr();
  // 🔴 (2026-09-14) 종전 `.catch(() => [])` — 조회 실패가 "설정 없음"으로 읽혀 `erp.enabled` 가 기본 true 가 됐다.
  //    DB 에서 ERP 를 꺼 둔 병원에서도 조회가 실패하면 런처가 나타났다. 실패는 전파하고, 모르는 동안에는 열지 않는다(아래 isError).
  const { data, isError } = useQuery({
    queryKey: ['config', 'integration'],
    queryFn: () => apiClient.get<{ data: ConfigEntry[] }>('/api/v1/config?category=integration').then((r) => r.data ?? []),
    staleTime: 5 * 60 * 1000,
  });

  const cfg = (k: string) => (data as ConfigEntry[] | undefined)?.find((c) => c.key === k)?.value;
  const enabled = cfg('erp.enabled') !== false;
  const url = (cfg('erp.url') as string) || '/erp';
  const ssoPath = (cfg('erp.ssoPath') as string) || '/api/v1/auth/sso/his';
  const allowedRoles = (cfg('erp.allowedRoles') as string[]) || ['ADMIN'];
  const allowedUserIds = (cfg('erp.allowedUserIds') as string[]) || [];
  const handoff = (cfg('erp.handoff') as string) || 'token';

  // 접근권한 = 허용 역할 ∪ 개별 허용 사용자
  const roleAllowed = allowedRoles.includes(role);
  const userAllowed = !!userId && allowedUserIds.includes(userId);
  // 설정을 모르면(조회 실패·로딩 중) 접근 버튼을 기본값으로 열지 않는다 — 넓히는 방향으로는 폴백하지 않는다
  if (isError || data === undefined) return null;
  if (!enabled || (!roleAllowed && !userAllowed)) return null;

  /**
   * 🔴 이 함수의 실패는 전부 **말한다**(2026-09-09 실측: 서버 SSO 는 정상인데 화면이 아무 반응도 없다는
   *    보고가 들어왔다). 종전에는 세 자리가 조용히 끝났다 — ①토큰 없음 `return` ②팝업 차단으로
   *    `window.open` 이 null ③빈 탭(about:blank)에서 상대경로 이동. 무반응은 사용자에게
   *    "인증이 안 넘어갔다"로 보이고, 어디서 끊겼는지 아무도 모른다.
   */
  const open = async () => {
    const t = apiClient.getToken();
    if (!t) {
      toast.error(tAttr('로그인 정보가 없어 ERP 로 이동할 수 없습니다. 다시 로그인해 주세요.'));
      return;
    }
    // 🔴 새 탭(about:blank)에서는 상대경로의 기준 문서가 없다 — 절대 URL 로 만들어 넘긴다.
    const abs = (p: string) => (/^https?:\/\//.test(p) ? p : `${window.location.origin}${p.startsWith('/') ? '' : '/'}${p}`);
    if (handoff === 'cookie') {
      // 방식 C: HIS가 /erp 스코프 단기 쿠키 발급 → ERP가 읽음(URL 토큰 없음)
      const win = window.open('', '_blank'); // 팝업 차단 방지: 클릭 시점 동기 오픈
      if (!win) {
        // 팝업 차단 — 쿠키만 발급하고 같은 탭에서 이동한다(무반응으로 끝내지 않는다)
        try {
          await apiClient.post('/api/v1/auth/erp-sso', {});
          toast.info(tAttr('팝업이 차단되어 이 탭에서 ERP 를 엽니다.'));
          window.location.href = abs(`${url}/`);
        } catch {
          toast.error(tAttr('ERP 연결에 실패했습니다(인증 쿠키 발급 실패).'));
        }
        return;
      }
      try {
        await apiClient.post('/api/v1/auth/erp-sso', {});
        win.location.href = abs(`${url}/`);
      } catch {
        win.close();
        toast.error(tAttr('ERP 연결에 실패했습니다(인증 쿠키 발급 실패).'));
      }
      return;
    }
    // 방식 token: URL 전달 — 🔴 **메인 access 토큰을 싣지 않는다**.
    //    종전엔 8시간짜리 로그인 토큰이 URL 에 실려 ERP 접근 로그·브라우저 기록에 남았고,
    //    `aud`·`jti` 가 없어 ERP 의 audience 검증·재생 방지가 둘 다 동작하지 않았으며,
    //    서버 게이트를 지나지 않아 허용 역할 밖에서도 ERP 계정이 만들어졌다.
    const win = window.open('', '_blank'); // 팝업 차단 방지: 클릭 시점 동기 오픈
    try {
      const res = await apiClient.post<{ data: { token: string } }>('/api/v1/auth/erp-sso-token', {});
      const handoffToken = res?.data?.token ?? '';
      if (!handoffToken) throw new Error('no token');
      const target = abs(`${url}${ssoPath}?token=${encodeURIComponent(handoffToken)}`);
      if (win) win.location.href = target;
      // 팝업이 차단됐으면 한 번 더 시도하고, 그것도 막히면 **말한다**(무반응으로 끝내지 않는다)
      else if (!window.open(target, '_blank', 'noopener')) {
        toast.error(tAttr('팝업이 차단되어 ERP 를 열지 못했습니다. 이 사이트의 팝업을 허용해 주세요.'));
      }
    } catch {
      win?.close();
      toast.error(tAttr('ERP 연결에 실패했습니다(인증 토큰 발급 실패).'));
    }
  };

  return (
    <button onClick={open} title={tAttr('ERP (SSO 자동 로그인)')}
      className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-[12px] font-medium text-slate-300 bg-slate-800/60 hover:bg-slate-700/70 transition-colors mb-2">
      <span aria-hidden="true">🏢</span>
      <span className="flex-1 text-left">ERP</span>
      <svg className="w-3 h-3 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5h5v5m0-5L10 14M9 5H5a2 2 0 00-2 2v12a2 2 0 002 2h12a2 2 0 002-2v-4" />
      </svg>
    </button>
  );
}
