'use client';

import { useEffect, useRef, useState } from 'react';
import { apiClient } from '@/lib/api-client';
import { useEdgeSafeAlign } from '@/components/ui/useEdgeSafeAlign';

/**
 * 외부 SMART 앱 런처 — 차트/진료에서 **환자·의료진 문맥을 바인딩한 EHR launch** 로 앱을 연다.
 *
 * standalone 진입은 HIS 로그인·동의 화면을 한 번 더 타므로(무인증 코드 발급 결함 봉합),
 * 의료진의 정상 진입 경로는 이 런처다. launch 토큰은 1회용·5분 만료이므로 창을 열 때마다 새로 받는다.
 * 등록된 앱이 없으면 아무것도 렌더하지 않는다(빈 버튼을 남기지 않음).
 */
interface LaunchApp {
  clientId: string;
  name: string;
  scopeCount: number;
  patientScoped: boolean;
  consentOk?: boolean;
}

export function SmartAppLauncher({ patientId, compact }: { patientId: string; compact?: boolean }) {
  const [apps, setApps] = useState<LaunchApp[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  // 🔴 컨테이너(main) 밖으로 뻗어 잘리지 않게 여는 방향을 정한다 — 정본 하나(useEdgeSafeAlign)
  const { alignClass } = useEdgeSafeAlign(open, 288, box);

  useEffect(() => {
    apiClient
      .get<{ data: LaunchApp[] }>(`/api/v1/smart/launch-apps?patientId=${patientId}`)
      .then((r) => setApps(r.data ?? []))
      .catch(() => setApps([]));
  }, [patientId]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const launch = async (app: LaunchApp) => {
    setBusy(app.clientId);
    setError(null);
    try {
      const r = await apiClient.post<{ data: { url: string; appName: string } }>('/api/v1/smart/launch', {
        clientId: app.clientId,
        patientId,
      });
      // 창 이름을 앱별로 고정 — 같은 앱은 재사용, 다른 앱은 나란히.
      // 팝업 차단 시 null — 조용히 실패하면 "눌러도 아무 일 없음"이 되므로 안내를 띄운다.
      const w = window.open(r.data.url, `smart-app-${app.clientId}`, 'width=1280,height=900,resizable=yes,scrollbars=yes');
      if (!w) {
        setError('팝업이 차단되었습니다 — 브라우저 주소창의 팝업 허용 후 다시 눌러 주세요');
        return;
      }
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : '앱 실행에 실패했습니다');
    } finally {
      setBusy(null);
    }
  };

  if (apps.length === 0) return null;

  return (
    <div className="relative" ref={box}>
      <button
        onClick={() => setOpen((v) => !v)}
        className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-xl font-semibold transition-colors bg-violet-50 text-violet-700 hover:bg-violet-100 ${compact ? 'px-2.5 py-1.5 text-[11px]' : 'px-3.5 py-2 text-xs'}`}
        title="이 환자 문맥으로 외부 임상 앱 실행(SMART on FHIR)"
        aria-label="외부 앱"
      >
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-7.5 3l9-9m0 0h-5.25m5.25 0v5.25" />
        </svg>
        <span className={compact ? 'hidden xl:inline' : undefined}>외부 앱</span>
        {apps.length > 1 && <span className="text-[10px] opacity-70">{apps.length}</span>}
      </button>

      {open && (
        <div className={`absolute ${alignClass} z-50 mt-1 w-72 rounded-xl border border-gray-200 bg-white p-1.5 shadow-lg`}>
          <div className="px-2 py-1 text-[10px] font-semibold text-gray-400">SMART on FHIR · 환자 문맥으로 실행</div>
          {apps.map((a) => {
            const blocked = a.patientScoped && a.consentOk === false;
            return (
              <button
                key={a.clientId}
                onClick={() => !blocked && launch(a)}
                disabled={blocked || busy === a.clientId}
                className={`w-full rounded-lg px-2 py-2 text-left transition-colors ${blocked ? 'cursor-not-allowed opacity-60' : 'hover:bg-gray-50'}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-xs font-medium text-gray-900">{a.name}</span>
                  {busy === a.clientId ? (
                    <span className="text-[10px] text-gray-400">여는 중…</span>
                  ) : blocked ? (
                    <span className="shrink-0 rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">동의 필요</span>
                  ) : (
                    <span className="shrink-0 text-[10px] text-gray-400">읽기 {a.scopeCount}</span>
                  )}
                </div>
                <div className="mt-0.5 text-[10px] text-gray-500">
                  {blocked
                    ? 'AI 활용 동의(PIPA §23 별도동의)가 있어야 실행됩니다'
                    : '5분 유효한 1회용 문맥으로 새 창에서 열립니다'}
                </div>
              </button>
            );
          })}
          {error && <div className="px-2 py-1.5 text-[10px] text-red-600">{error}</div>}
        </div>
      )}
    </div>
  );
}
