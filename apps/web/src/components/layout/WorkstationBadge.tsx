'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { useEdgeSafeAlign } from '@/components/ui/useEdgeSafeAlign';
import { T, useTAttr } from '@/components/ui/i18n-text';
import { useTopBarDensity } from '@/components/layout/topbar-density';

const LS_KEY = 'hr.workstation.code';

const unwrap = <T,>(d: unknown): T => {
  const raw = (d as { data?: unknown })?.data;
  return (raw && typeof raw === 'object' && 'data' in (raw as object) ? (raw as { data: T }).data : raw) as T;
};

interface Pick { id: string; code: string; label: string; department?: string | null; location?: string | null }
interface Resolved { resolved: boolean; via: string | null; workstation: { code: string; label: string } | null; defaultsByType: Record<string, { name: string; host?: string | null; port?: number | null }> }

/**
 * 런타임 워크스테이션 선택기 — 단말 자동해석 or code 선택(localStorage).
 *
 * 🔴 **화면이 목적을 말하지 않고 있었다**(2026-08-26 사람 신고). `WS-DIAG-CARDIAC` 같은 코드만
 *    나열돼 있어 무엇을 고르는 것인지, 고르면 뭐가 달라지는지 알 수 없었다.
 *
 * 🔴 **넓혀 말하지 않는다** — 실측상 이 선택이 바꾸는 것은 **인쇄가 어느 프린터로 나가는가** 하나뿐이다
 *    (`lib/print.ts` 가 이 코드를 서버에 넘겨 그 자리 프린터로 보낸다). 워크리스트·권한·환자 목록은
 *    바뀌지 않는다. 그래서 안내도 딱 그만큼만 적는다.
 */
export function WorkstationBadge() {
  const density = useTopBarDensity();
  const [code, setCode] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  // 🔴 컨테이너(main) 밖으로 뻗어 잘리지 않게 여는 방향을 정한다 — 정본 하나(useEdgeSafeAlign)
  const { alignClass } = useEdgeSafeAlign(open, 288, ref);
  // 🔴 title 은 티를 그릴 자리가 없다 — 미등록이면 한국어 원문 그대로(지어내지 않는다)
  const tAttr = useTAttr();

  useEffect(() => { setCode(localStorage.getItem(LS_KEY)); }, []);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h);
  }, []);

  const { data: resData } = useQuery({
    queryKey: ['ws-resolve', code],
    queryFn: () => apiClient.get(`/api/v1/workstation-setup/resolve${code ? `?code=${encodeURIComponent(code)}` : ''}`),
    staleTime: 60_000,
  });
  const { data: pickData } = useQuery({ queryKey: ['ws-pick'], queryFn: () => apiClient.get('/api/v1/workstation-setup/pick-list'), enabled: open, staleTime: 300_000 });

  const res = unwrap<Resolved>(resData);
  const picks = unwrap<Pick[]>(pickData) ?? [];
  const ws = res?.workstation ?? null;
  const printer = res?.defaultsByType?.['LABEL_PRINTER'] ?? res?.defaultsByType?.['DOC_PRINTER'];

  const select = (c: string) => { localStorage.setItem(LS_KEY, c); setCode(c); setOpen(false); setQ(''); };
  const clear = () => { localStorage.removeItem(LS_KEY); setCode(null); setOpen(false); setQ(''); };

  // 목록이 길어 사람이 스크롤로 찾고 있었다 — 이름·부서·코드 아무거나로 좁힌다
  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return picks;
    return picks.filter((p) =>
      [p.code, p.label, p.department ?? '', p.location ?? ''].some((v) => v.toLowerCase().includes(t)),
    );
  }, [picks, q]);

  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen(v => !v)}
        className={`hidden md:flex shrink-0 items-center gap-1.5 whitespace-nowrap px-2.5 py-1.5 rounded-lg border text-xs transition-colors ${ws ? 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100' : 'border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100'}`}
        title={ws
          ? `이 컴퓨터는 ${ws.label}(으)로 지정돼 있습니다${printer ? ` · 인쇄는 ${printer.name} 로 나갑니다` : ''}`
          : tAttr('이 컴퓨터가 병원 어느 자리인지 아직 정하지 않았습니다 — 검체 라벨·팔찌 인쇄가 이 자리 프린터로 나가지 않습니다')}>
        <span>🖥</span>
        {/* 자리가 모자라면(상단 바 밀도 2 이상) 🖥 아이콘만 — 이름은 title·펼친 목록이 말한다 */}
        {density < 2 && <span className="max-w-[120px] truncate font-medium">{ws ? ws.code : <T k="워크스테이션 선택" />}</span>}
        {!ws && density >= 2 && <span className="h-1.5 w-1.5 rounded-full bg-amber-500" aria-hidden />}
        {res?.via === 'TERMINAL' && <span className="text-[10px] px-1 rounded bg-emerald-200/70"><T k="자동" /></span>}
      </button>

      {open && (
        <div className={`absolute ${alignClass} mt-2 w-72 bg-white rounded-xl border border-gray-100 shadow-lg z-50 p-2`}>
          {/* 무엇을 고르는 것인지 · 고르면 무엇이 달라지는지 — 코드만 나열하면 사람은 알 수 없다 */}
          <div className="px-2 pt-1 pb-2 border-b border-gray-100">
            <T k="이 컴퓨터가 놓인 자리" className="block text-[12px] font-semibold text-gray-800" />
            <p className="mt-0.5 text-[11px] leading-relaxed text-gray-500">
              검사실·처치실처럼 <b>장소</b>를 고릅니다. 고르면 <b>검체 라벨·팔찌 인쇄가 그 자리 프린터로</b> 나갑니다.
              <span className="text-gray-400"> 환자 목록·권한은 바뀌지 않습니다.</span>
            </p>
          </div>

          <div className="px-2 py-1.5 text-[11px] text-gray-400">
            <T k="현재" /> {ws ? <b className="text-gray-700">{ws.label}</b> : <T k="미선택" className="text-amber-600" />}
            {res?.via === 'TERMINAL' && <span className="ml-1 text-emerald-600">· <T k="등록된 단말이라 자동으로 정해졌습니다" /></span>}
          </div>
          {ws && printer && <div className="px-2 pb-1.5 text-[11px] text-gray-500"><T k="인쇄 대상:" /> <b>{printer.name}</b>{printer.host ? ` (${printer.host}${printer.port ? ':' + printer.port : ''})` : ''}</div>}
          {ws && !printer && (
            // 🔴 자리는 정해졌는데 프린터가 없으면 인쇄는 파일 내려받기로 떨어진다 — 그 사실을 말한다
            <T k="이 자리에 등록된 프린터가 없습니다 — 인쇄는 파일로 내려받게 됩니다" className="block px-2 pb-1.5 text-[11px] text-amber-600" />
          )}

          {picks.length > 6 && (
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={tAttr('자리 이름·부서로 찾기 (예: 내시경, 영상의학과)')}
              className="w-full mb-1 px-2 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-400"
            />
          )}

          <div className="max-h-64 overflow-y-auto border-t border-gray-50 pt-1">
            {picks.length === 0 ? (
              <T k="등록된 자리가 없습니다 — 전산실에 문의하세요" className="block text-xs text-gray-400 px-2 py-3 text-center" />
            ) : filtered.length === 0 ? (
              <T k="찾는 자리가 없습니다" className="block text-xs text-gray-400 px-2 py-3 text-center" />
            ) : filtered.map(p => (
              <button key={p.id} onClick={() => select(p.code)} className={`w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded-lg text-xs hover:bg-gray-50 ${code === p.code ? 'bg-blue-50' : ''}`}>
                {/* 🔴 사람은 "내시경실"로 찾는다 — 이름을 앞에, 코드는 보조로 */}
                <span className="min-w-0 text-left">
                  <span className="text-gray-800 font-medium">{p.label}</span>
                  <span className="ml-1 font-mono text-[10px] text-gray-400">{p.code}</span>
                  {p.location && <span className="block text-[10px] text-gray-400">{p.location}</span>}
                </span>
                <span className="text-[11px] text-gray-400 shrink-0">{p.department ?? ''}</span>
              </button>
            ))}
          </div>
          {code && <button onClick={clear} className="w-full mt-1 py-1.5 text-[11px] text-gray-500 hover:text-red-500 border-t border-gray-50"><T k="선택 해제" /></button>}
          {/* 이 선택은 이 브라우저에만 남는다 — 다른 컴퓨터에서 다시 골라야 한다는 사실을 밝힌다 */}
          <p className="px-2 pt-1.5 text-[10px] leading-relaxed text-gray-400 border-t border-gray-50">
            선택은 <b>이 브라우저에만</b> 저장됩니다. 다른 컴퓨터에서는 다시 골라야 합니다.
          </p>
        </div>
      )}
    </div>
  );
}
