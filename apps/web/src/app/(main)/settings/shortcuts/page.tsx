'use client';

import { useMemo } from 'react';
import { sanctionedPrint } from '@/components/print/PrintGuard';
import { Unit } from '@/components/ui/display';
import { useAuthStore } from '@/stores/auth-store';
import { SCREEN_REGISTRY, SCREEN_CODE_CONFLICTS, SCREEN_CODE_UNFROZEN, type ScreenEntry } from '@/components/layout/Sidebar';
import { comboLabel } from '@/components/hotkeys/HotkeyProvider';
import { T } from '@/components/ui/i18n-text';
import { ShortcutsPrint } from '@/components/print/ShortcutsPrint';
import { joinPatientName } from '@hospital-run/shared';

const GLOBAL_KEYS: Array<[string, string]> = [
  ['g', '화면번호 입력칸 포커스(지정 가능)'],
  ['?', '현재 화면 단축키 도움말'],
  [comboLabel('mod+k'), '통합 검색(환자·약품·화면번호)'],
];
const ACTION_KEYS: Array<[string, string]> = [
  [comboLabel('mod+Enter'), '확정/저장(접수·수납 등)'],
  [comboLabel('alt+n'), '신규(환자 등)'],
  [comboLabel('alt+r'), '초기화'],
  [comboLabel('alt+s'), 'QR 스캔(접수 WS)'],
  [comboLabel('alt+o'), '새 처방(CPOE)'],
  [comboLabel('alt+a'), '기록 추가(간호)'],
];

export default function ShortcutsCheatsheetPage() {
  const { user } = useAuthStore();
  const role = user?.role ?? '';

  const grouped = useMemo(() => {
    const allowed = SCREEN_REGISTRY.filter((e) => role === 'ADMIN' || e.roles.includes(role));
    const m = new Map<string, ScreenEntry[]>();
    for (const e of allowed) { const a = m.get(e.section) ?? []; a.push(e); m.set(e.section, a); }
    return [...m.entries()];
  }, [role]);
  const screenCount = grouped.reduce((n, [, l]) => n + l.length, 0);

  return (
    <div className="max-w-5xl mx-auto p-4 print:p-0">
      <div className="flex items-center justify-between mb-4 print:mb-2">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900"><T k="단축키 · 화면번호 치트시트" /></h1>
          {/* 🔴 '접근 가능한 화면'이라 적었지만 실제로는 **사이드바 노출 수**다(API 권한과 다를 수 있음). 라벨을 사실대로. */}
          <p className="text-sm text-gray-500 mt-1">{user?.department ?? ''} {user?.familyName}{user?.givenName} · <T k="사이드바에 보이는 화면" /> {screenCount}<Unit>개</Unit></p>
        </div>
        <button onClick={() => sanctionedPrint()} className="px-4 py-2 rounded-xl bg-gray-900 text-white text-sm font-semibold hover:bg-gray-800 print:hidden">🖨️ <T k="인쇄" /></button>
      </div>

      {/* 🔴 화면번호 무결성 — 운영에서도 드러낸다(중복은 사람을 다른 화면으로 보낸다) */}
      {(SCREEN_CODE_CONFLICTS.length > 0 || SCREEN_CODE_UNFROZEN.length > 0) && (
        <div className="mb-4 rounded-2xl border border-rose-200 bg-rose-50 p-4 print:hidden">
          <p className="text-sm font-bold text-rose-800">⚠ <T k="화면번호 무결성 경고" /></p>
          {SCREEN_CODE_CONFLICTS.length > 0 && (
            <div className="mt-1 text-[12px] text-rose-700">
              <p>중복된 화면번호 {SCREEN_CODE_CONFLICTS.length}<Unit>건</Unit> — 해당 번호는 <b>이동이 거부</b>됩니다(다른 화면으로 보내지 않기 위함).</p>
              <ul className="mt-1 space-y-0.5 font-mono text-[11px]">
                {SCREEN_CODE_CONFLICTS.map((c) => <li key={c.code}>{c.code}: {c.hrefs.join(' ↔ ')}</li>)}
              </ul>
            </div>
          )}
          {SCREEN_CODE_UNFROZEN.length > 0 && (
            <p className="mt-1 text-[12px] text-rose-700">
              번호가 고정되지 않은 화면 {SCREEN_CODE_UNFROZEN.length}<Unit>개</Unit>(임시 9xxx) — 관리자에게 알려 <code>screen-codes.frozen.ts</code> 등재가 필요합니다.
            </p>
          )}
        </div>
      )}

      {/* 단축키 안내 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-5">
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
          <h3 className="text-sm font-bold text-gray-800 mb-2"><T k="전역 단축키" /></h3>
          <div className="space-y-1">
            {GLOBAL_KEYS.map(([k, d]) => (
              <div key={k} className="flex items-center justify-between text-sm">
                <span className="text-gray-700"><T k={d} /></span>
                <kbd className="text-[11px] font-semibold bg-gray-100 border border-gray-200 rounded px-1.5 py-0.5">{k}</kbd>
              </div>
            ))}
          </div>
        </div>
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
          <h3 className="text-sm font-bold text-gray-800 mb-2"><T k="화면 내 액션 단축키" /></h3>
          <div className="space-y-1">
            {ACTION_KEYS.map(([k, d]) => (
              <div key={k} className="flex items-center justify-between text-sm">
                <span className="text-gray-700"><T k={d} /></span>
                <kbd className="text-[11px] font-semibold bg-gray-100 border border-gray-200 rounded px-1.5 py-0.5">{k}</kbd>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 화면번호 목록 */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
        <h3 className="text-sm font-bold text-gray-800 mb-3"><T k="화면번호" /></h3>
        {screenCount === 0 && (
          <p className="py-6 text-center text-sm text-gray-400">
            현재 역할({role || '미상'})로 사이드바에 노출되는 화면이 없습니다. 필요한 화면이 있으면 관리자에게 메뉴 권한을 요청하세요.
          </p>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-4">
          {grouped.map(([section, list]) => (
            <div key={section} className="break-inside-avoid">
              <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-1"><T k={section} /></p>
              <div className="space-y-0.5">
                {list.map((e) => (
                  <div key={e.code} className="flex items-center gap-2 text-sm">
                    <span className="text-[11px] tabular-nums text-blue-600 font-bold w-9">{e.code}</span>
                    <span className="text-gray-700 truncate"><T k={e.label} /></span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      <p className="text-[11px] text-gray-400 mt-4 print:mt-2">💡 화면번호로 이동: <kbd className="bg-gray-100 border border-gray-200 rounded px-1">g</kbd> → 번호 입력 → Enter. 이 목록은 <b>사이드바 노출 기준</b>이며, 화면 안의 기능별 권한은 서버(API)가 별도로 판단합니다.</p>
      {/* 🔴 인쇄는 화면 격자를 찍지 않고 한 표 인쇄본으로(2026-10-12 — 종전엔 빈 종이) */}
      <ShortcutsPrint globalKeys={GLOBAL_KEYS} actionKeys={ACTION_KEYS} grouped={grouped} role={role} who={[user?.department, joinPatientName(user?.familyName, user?.givenName)].filter(Boolean).join(' ')} />
    </div>
  );
}
