'use client';

import { useMemo, useState } from 'react';
import { SCREEN_REGISTRY, SCREEN_CODE_ORPHANS, OFF_NAV_SCREENS, type ScreenEntry } from '@/components/layout/Sidebar';
import { SCREEN_CODE_FROZEN } from '@/components/layout/screen-codes.frozen';

import { EmptyState } from '@/components/ui/display';
import { T, useTAttr } from '@/components/ui/i18n-text';

const ROLE_LABEL: Record<string, string> = { ADMIN: '관리', DOCTOR: '의사', NURSE: '간호', PHARMACIST: '약사', LAB_TECH: '검사' };

export default function ScreenCodesAdminPage() {
  const tAttr = useTAttr();
  const [q, setQ] = useState('');

  const offNavHrefs = useMemo(() => new Set(OFF_NAV_SCREENS.map((e) => e.href)), []);
  const { rows, stats } = useMemo(() => {
    const byCode: Record<string, string> = {};
    const dupCodes = new Set<string>();
    for (const e of SCREEN_REGISTRY) { if (byCode[e.code]) dupCodes.add(e.code); else byCode[e.code] = e.href; }
    const t = q.trim().toLowerCase();
    const rows = SCREEN_REGISTRY
      .filter((e) => !t || e.code.includes(t) || e.label.toLowerCase().includes(t) || e.section.toLowerCase().includes(t) || e.href.toLowerCase().includes(t))
      .map((e) => ({ ...e, frozen: e.href in SCREEN_CODE_FROZEN, dup: dupCodes.has(e.code), offNav: offNavHrefs.has(e.href) }));
    const unfrozen = SCREEN_REGISTRY.filter((e) => !(e.href in SCREEN_CODE_FROZEN)).length;
    return { rows, stats: { total: SCREEN_REGISTRY.length, frozen: SCREEN_REGISTRY.length - unfrozen, unfrozen, dups: dupCodes.size, orphans: SCREEN_CODE_ORPHANS.length, offNav: offNavHrefs.size } };
  }, [q, offNavHrefs]);

  const grouped = useMemo(() => {
    const m = new Map<string, Array<ScreenEntry & { frozen: boolean; dup: boolean; offNav: boolean }>>();
    for (const r of rows) { const a = m.get(r.section) ?? []; a.push(r); m.set(r.section, a); }
    return [...m.entries()];
  }, [rows]);

  return (
    <div className="max-w-5xl mx-auto p-4">
      <h1 className="text-2xl font-bold tracking-tight text-gray-900 mb-1"><T k="화면번호 레지스트리" /></h1>
      <p className="text-sm text-gray-500 mb-4">전체 화면 코드 조회·검증(읽기 전용). 코드는 변경 금지(freeze) — 무결성은 <code className="text-xs bg-gray-100 px-1 rounded">npm run check:screen-codes</code> CI로 보장.</p>
      <p className="text-xs text-gray-500 mb-4 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
        🔴 이 목록은 <b>번호가 부여된 화면</b>만이다. 번호가 없는 화면이 곧 없는 화면은 아니다 —
        진입점이 없는 화면 <b>14건</b>은 2026-08-21 실측에서 <b>일부러 부여하지 않았다</b>(번호를 주면 “정상 경로로 도달한다”는 거짓 신호가 된다).
        부여 기준·미부여 목록: <code className="bg-gray-100 px-1 rounded">docs/05-reference/screen-code-assignment.md</code>
      </p>

      <div className="flex flex-wrap gap-2 mb-4">
        {([['전체', stats.total, 'bg-gray-100 text-gray-700'], ['고정(freeze)', stats.frozen, 'bg-emerald-100 text-emerald-700'], ['미고정', stats.unfrozen, stats.unfrozen ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-400'], ['중복', stats.dups, stats.dups ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-400'], ['메뉴 밖', stats.offNav, 'bg-blue-50 text-blue-700'], ['고아(이동 불가)', stats.orphans, stats.orphans ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-400']] as [string, number, string][]).map(([l, n, c]) => (
          <div key={l} className={`px-3 py-1.5 rounded-xl text-sm font-medium ${c}`}><T k={l} /> <b>{n}</b></div>
        ))}
      </div>

      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={tAttr('코드·이름·섹션·경로 검색')}
        className="w-full mb-4 px-3.5 py-2 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-100 outline-none" />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4">
        {grouped.map(([section, list]) => (
          <div key={section}>
            <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-1"><T k={section} /></p>
            <div className="space-y-0.5">
              {list.map((e) => (
                <div key={e.href} className="flex items-center gap-2 text-sm py-0.5">
                  <span className={`text-[11px] tabular-nums font-bold w-9 ${e.dup ? 'text-red-600' : 'text-blue-600'}`}>{e.code}</span>
                  <span className="text-gray-800 truncate flex-1"><T k={e.label} /></span>
                  <span className="text-[10px] text-gray-400">{e.roles.length ? e.roles.map((r) => ROLE_LABEL[r] ?? r).join('·') : <T k="전체" />}</span>
                  {!e.frozen && <span className="text-[9px] bg-amber-100 text-amber-700 px-1 rounded"><T k="임시" /></span>}
                  {e.dup && <span className="text-[9px] bg-red-100 text-red-700 px-1 rounded"><T k="중복" /></span>}
                  {e.offNav && <span className="text-[9px] bg-blue-50 text-blue-700 px-1 rounded" title={tAttr('사이드바에는 없지만 다른 화면에서 진입하는 화면')}><T k="메뉴 밖" /></span>}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      {!rows.length && <EmptyState icon="🔍" title="검색 결과가 없습니다." />}
    </div>
  );
}
