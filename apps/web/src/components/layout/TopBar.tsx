'use client';

import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { useAuthStore } from '@/stores/auth-store';
import { useRouter } from 'next/navigation';
import { NotificationBell, NotificationPanel } from '@/components/ui/NotificationPanel';
import { ScreenJump } from './ScreenJump';
import { WorkstationBadge } from './WorkstationBadge';
import { HisModeChip } from '@/lib/his-mode';
import { TermLangToggle } from './TermLangToggle';
import { UiLocaleSelect } from './UiLocaleSelect';
import { useSmartSearchStore } from '@/stores/smart-search-store';
import { T, useTAttr } from '@/components/ui/i18n-text';
import { useEdgeSafeAlign } from '@/components/ui/useEdgeSafeAlign';
import { TopBarDensityProvider, TOPBAR_MAX_DENSITY, useFitDensity } from './topbar-density';

export function TopBar({ onMenuClick }: { onMenuClick?: () => void } = {}) {
  const { user, logout } = useAuthStore();
  const router = useRouter();
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);
  // 자리가 모자라면 실제로 재서 단계적으로 접는다(폭 구간이 아니라 남은 자리 — topbar-density.tsx · 2026-09-29)
  //   1 칩 설명 숨김 · 2 화면 언어·의료코드·화면번호를 ⚙ 로 · 3 역할 칩·이름 숨김
  const headerRef = useRef<HTMLElement>(null);
  const searchRef = useRef<HTMLButtonElement>(null);
  const density = useFitDensity(headerRef, searchRef);
  const foldTools = density >= 2;
  const [toolsOpen, setToolsOpen] = useState(false);
  useEffect(() => { if (!foldTools) setToolsOpen(false); }, [foldTools]);
  const toolsRef = useRef<HTMLDivElement>(null);
  // 여는 방향 정본 — 300px 패널이 본문(main) 밖으로 뻗어 잘리지 않게(dropdown-edge-safe 가드)
  const { alignClass: toolsAlign } = useEdgeSafeAlign(toolsOpen, 300, toolsRef);
  useEffect(() => {
    if (!toolsOpen) return;
    const onDown = (e: MouseEvent) => { if (toolsRef.current && !toolsRef.current.contains(e.target as Node)) setToolsOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [toolsOpen]);
  // 🔴 검색 정본은 SmartSearchBar 한 벌(기획 P1 — 두 벌 병존은 P12) — 여기는 열기만 한다
  const openSearch = useSmartSearchStore((s) => s.setOpen);
  // 🔴 속성(aria-label·title)은 티를 그릴 수 없다 — 미등록이면 한국어 원문이 그대로 나온다(지어내지 않는다)
  const tAttr = useTAttr();

  useEffect(() => {
    if (!userMenuOpen) return;
    const onDown = (e: MouseEvent) => { if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) setUserMenuOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [userMenuOpen]);

  const handleLogout = async () => {
    await logout();
    router.push('/login');
  };

  // 현재 페이지를 새창 전체 화면(포커스·사이드바 없음)으로 열기
  const openFocusWindow = () => {
    const u = new URL(window.location.href);
    u.searchParams.set('focus', '1');
    window.open(u.pathname + u.search, '_blank', 'noopener');
  };

  const roleLabel: Record<string, string> = { ADMIN:'관리자', DOCTOR:'의사', NURSE:'간호사', PHARMACIST:'약사', LAB_TECH:'검사실', NUTRITION:'급양', ADMIN_STAFF:'행정직', MEDICAL_RECORDS:'의무기록사', RECEPTIONIST:'원무', EXECUTIVE:'경영진', CHECKUP:'검진센터' };
  const roleColor: Record<string, string> = { ADMIN:'bg-violet-100 text-violet-700', DOCTOR:'bg-blue-100 text-blue-700', NURSE:'bg-emerald-100 text-emerald-700', PHARMACIST:'bg-amber-100 text-amber-700', LAB_TECH:'bg-teal-100 text-teal-700', NUTRITION:'bg-lime-100 text-lime-700', ADMIN_STAFF:'bg-slate-100 text-slate-700', MEDICAL_RECORDS:'bg-cyan-100 text-cyan-700', RECEPTIONIST:'bg-rose-100 text-rose-700', EXECUTIVE:'bg-indigo-100 text-indigo-700', CHECKUP:'bg-teal-100 text-teal-700' };

  return (
    <TopBarDensityProvider value={density}>
    <header ref={headerRef} data-topbar-density={density} className="sticky top-0 z-30 h-14 bg-white/90 backdrop-blur border-b border-gray-100 shadow-[0_1px_3px_rgba(15,23,42,0.04)] flex items-center justify-between px-3 sm:px-4 lg:px-6 gap-2 sm:gap-4">
      <div className="flex items-center gap-2">
        <button onClick={onMenuClick} aria-label={tAttr('사이드바 메뉴 열기')} className="lg:hidden p-1.5 -ml-1 rounded-lg hover:bg-gray-100 transition-colors">
          <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
          </svg>
        </button>
      </div>

      {/* 검색 — 정본은 SmartSearchBar(Cmd+K) 한 벌. 여기서는 연다(기획 P1: 두 벌 병존 해소) */}
      <button
        onClick={() => openSearch(true)}
        className="sm:hidden p-1.5 rounded-lg hover:bg-gray-100 transition-colors"
        aria-label={tAttr('통합 검색 열기')}
      >
        <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
        </svg>
      </button>
      <button
        ref={searchRef}
        onClick={() => openSearch(true)}
        aria-label={tAttr('환자, 약품, 진단코드, 화면 통합 검색 열기')}
        className="hidden sm:flex min-w-0 flex-1 max-w-md items-center gap-2.5 pl-3 pr-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-sm text-gray-400 hover:border-gray-300 hover:bg-white transition-colors"
      >
        <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
        </svg>
        <T k="환자, 약품, 진단코드, 화면 통합 검색..." className="flex-1 text-left truncate" />
        <kbd className="hidden md:inline-flex items-center text-[10px] text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded border border-gray-200">⌘K</kbd>
      </button>

      {/* Notifications + User info */}
      <div className="relative flex min-w-0 shrink-0 items-center gap-1.5 sm:gap-2 xl:gap-3">
        {user && (
          <>
            {/* 모드는 상단 바 안에서 말한다 — 별도 띠를 얹지 않는다(2026-08-26) */}
            <HisModeChip />
            {/* 의료용어 한/영 표시 모드 — 표시만 바꾼다(저장·검색·인쇄 불변). 자리가 모자라면 ⚙ 안으로(값 유지) */}
            {!foldTools && <div className="flex shrink-0 items-center gap-1.5" data-topbar-inline><UiLocaleSelect /><TermLangToggle /></div>}
            <WorkstationBadge />
            {!foldTools && <div className="shrink-0" data-topbar-inline><ScreenJump /></div>}
            {/* 접힘: 위 셋을 ⚙ 하나로 — 값·동작은 같고 자리만 접는다 */}
            {foldTools && <div className="relative" ref={toolsRef} data-topbar-tools>
              <button onClick={() => setToolsOpen((v) => !v)} aria-label={tAttr('화면 도구(언어·의료코드·화면번호)')} title={tAttr('화면 도구(언어·의료코드·화면번호)')}
                aria-expanded={toolsOpen} className="flex p-1.5 rounded-lg text-gray-500 hover:text-gray-700 hover:bg-gray-100 transition-colors">
                <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6} d="M10.5 6h9.75M10.5 6a1.5 1.5 0 11-3 0m3 0a1.5 1.5 0 10-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-9.75 0h9.75" />
                </svg>
              </button>
              {toolsOpen && (
                <TopBarDensityProvider value={TOPBAR_MAX_DENSITY}>
                <div className={`absolute ${toolsAlign} z-50 mt-2 w-[300px] space-y-3 rounded-xl border border-gray-200 bg-white p-3 shadow-lg`}>
                  <div><T k="화면 언어" className="mb-1 block text-[11px] font-semibold text-gray-500" /><UiLocaleSelect /></div>
                  <div><T k="의료코드" className="mb-1 block text-[11px] font-semibold text-gray-500" /><TermLangToggle /></div>
                  <div><T k="화면번호" className="mb-1 block text-[11px] font-semibold text-gray-500" /><ScreenJump /></div>
                </div>
                </TopBarDensityProvider>
              )}
            </div>}
            <button
              onClick={openFocusWindow}
              aria-label={tAttr('새창 전체 화면 보기')}
              title={tAttr('새창 전체 화면 보기')}
              className="hidden sm:flex p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M14 5h5v5m0-5l-7 7M10 19H5v-5m0 5l7-7" />
              </svg>
            </button>
            <NotificationBell />
            <NotificationPanel />
            {density < 3 && <span className={`hidden sm:inline shrink-0 whitespace-nowrap text-[10px] sm:text-[11px] font-medium px-1.5 sm:px-2.5 py-0.5 sm:py-1 rounded-full ${roleColor[user.role] ?? 'bg-gray-100 text-gray-700'}`}>
              <T k={roleLabel[user.role] ?? user.role} />
            </span>}
            <div className="relative" ref={userMenuRef}>
              <button
                onClick={() => setUserMenuOpen((v) => !v)}
                aria-label={tAttr('개인 메뉴')}
                aria-haspopup="menu"
                aria-expanded={userMenuOpen}
                className="flex items-center gap-2 rounded-lg px-1 py-0.5 hover:bg-gray-100 transition-colors"
              >
                <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center">
                  <span className="text-xs font-bold text-slate-600">{user.familyName?.charAt(0)}</span>
                </div>
                {density < 3 && <span className="whitespace-nowrap text-sm font-medium text-gray-700 hidden lg:inline">
                  {user.familyName}{user.givenName}
                </span>}
                <svg className={`w-3.5 h-3.5 text-gray-400 transition-transform ${userMenuOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {userMenuOpen && (
                <div role="menu" className="absolute right-0 mt-2 w-52 bg-white rounded-xl border border-gray-200 shadow-lg py-1.5 z-50">
                  <div className="px-3 py-2 border-b border-gray-100">
                    <p className="text-sm font-semibold text-gray-800 truncate">{user.familyName}{user.givenName}</p>
                    <T k={roleLabel[user.role] ?? user.role} className="text-[11px] text-gray-400" />
                  </div>
                  <Link href="/staff/payroll" role="menuitem" onClick={() => setUserMenuOpen(false)} className="flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">
                    <span aria-hidden="true">💳</span> <T k="급여 기초정보" />
                  </Link>
                  <Link href="/ess" role="menuitem" onClick={() => setUserMenuOpen(false)} className="flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">
                    <span aria-hidden="true">🗂️</span> <T k="내 행정(ESS)" />
                  </Link>
                  <div className="border-t border-gray-100 my-1" />
                  <button onClick={() => { setUserMenuOpen(false); handleLogout(); }} role="menuitem" className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50 text-left">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3 0l3-3m0 0l-3-3m3 3H9" />
                    </svg>
                    <T k="로그아웃" />
                  </button>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </header>
    </TopBarDensityProvider>
  );
}
