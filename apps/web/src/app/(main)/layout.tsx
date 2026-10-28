'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/stores/auth-store';
import { useNotificationStore } from '@/stores/notification-store';
import { useHydrateTermLang } from '@/stores/term-lang-store';
import { useHydrateUiLocale, useUiLocale } from '@/stores/ui-locale-store';
import { useHydrateReviewOverlay } from '@/stores/i18n-overlay-store';
import { localeDirOf } from '@hospital-run/shared';
import { useAiChatStore } from '@/stores/ai-chat-store';
import { apiClient } from '@/lib/api-client';
import { SessionExpiryWatcher } from '@/components/auth/SessionExpiryWatcher';
import { PasswordStatusBanner } from '@/components/auth/PasswordStatusBanner';
import { Sidebar } from '@/components/layout/Sidebar';
import { isRailCollapsed, nextSidebarMode, parseSidebarMode, SIDEBAR_MODE_KEY, type SidebarMode } from '@/components/layout/sidebar-mode';
import { A11yRoot } from '@/components/layout/A11yRoot';
import { TopBar } from '@/components/layout/TopBar';
import { Toaster } from '@/components/ui/Toaster';
import { NetworkStatusBanner } from '@/components/ui/NetworkStatusBanner';
import { AiChatBar } from '@/components/ai/AiChatBar';
import { SmartSearchBar } from '@/components/layout/SmartSearchBar';
import { CertificationBadge } from '@/components/CertificationBadge';
import { CriticalValueAlertBanner } from '@/components/CriticalValueAlertBanner';
import { HotkeyProvider } from '@/components/hotkeys/HotkeyProvider';
import { DailyPinPrompt } from '@/components/terminal/DailyPinPrompt';
import { StepUpApprovalPrompt } from '@/components/terminal/StepUpApprovalPrompt';
import { initStaffFcm } from '@/lib/fcm';
import { HisModeBanner } from '@/lib/his-mode';
import { T } from '@/components/ui/i18n-text';

// URL 해시에서 인증 토큰 복원 (두번째 모니터/시크릿 모드 지원)
// 컴포넌트 외부에서 동기 실행 — useEffect보다 먼저 처리
if (typeof window !== 'undefined') {
  const hash = window.location.hash;
  const authMatch = hash.match(/auth=([^&]+)/);
  if (authMatch) {
    const token = decodeURIComponent(authMatch[1]);
    if (token && token.length > 20) {
      localStorage.setItem('accessToken', token);
      apiClient.setToken(token);
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
    }
  }
}

export default function MainLayout({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading, loadProfile } = useAuthStore();
  const router = useRouter();
  // 새창 포커스 모드(?focus=1) — 빌드 안전을 위해 window에서 직접 판독(useSearchParams Suspense 회피)
  const [focusMode] = useState(() => typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('focus') === '1');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  // 사이드바 아이콘 줄(rail) — 좁은 화면(< 1280) 자동 접힘 + 사용자 선택 기억(규칙: components/layout/sidebar-mode.ts · 2026-09-29)
  const [railPref, setRailPref] = useState<SidebarMode>('auto');
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    try { setRailPref(parseSidebarMode(localStorage.getItem(SIDEBAR_MODE_KEY))); } catch { /* 저장소 불가 — 자동 */ }
    const mq = window.matchMedia('(max-width: 1279.98px)');
    const on = () => setNarrow(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  const railCollapsed = isRailCollapsed(railPref, narrow, sidebarOpen);
  const toggleRail = () => {
    const next = nextSidebarMode(railCollapsed, narrow);
    setRailPref(next);
    try { if (next === 'auto') localStorage.removeItem(SIDEBAR_MODE_KEY); else localStorage.setItem(SIDEBAR_MODE_KEY, next); } catch { /* 무시 */ }
  };
  // 어시스턴트 열림 — 스토어 승격(검색 옴니박스에서도 연다 · ai-chat-store)
  const aiChatOpen = useAiChatStore((s) => s.open);
  const toggleAiChat = useAiChatStore((s) => s.toggle);
  const closeAiChat = useAiChatStore((s) => s.close);
  const aiChatWide = useAiChatStore((s) => s.wide);
  // 의료용어 표시 모드 — 저장된 사용자 선호를 마운트 후 적용(하이드레이션 안전)
  useHydrateTermLang();
  useHydrateUiLocale();
  // 🔴 승인된 사람 검수 번역을 런타임 팩에 얹는 **유일한 경로**(정본 `i18n-human-review.plan.md` §2.2).
  //    이 한 줄이 없으면 검수 화면에서 승인해도 어느 화면에도 나가지 않는다(2026-09-09 실측: 소비처 0).
  useHydrateReviewOverlay();
  // lang 속성 — 크롬 언어를 하위 트리에 선언(zh/layout 우회 선례 — 루트 동적화 회피).
  // 🔴 dir 은 P3(RTL 웨이브)까지 ltr 고정 — 아랍어는 텍스트만(선택 UI 가 고지)
  const uiLocale = useUiLocale();
  void localeDirOf; // RTL 언어가 활성화되면 dir={localeDirOf(uiLocale)} — 현재 활성 팩은 전부 ltr(§8)
  // SmartSearchBar가 Cmd+K를 처리합니다

  useEffect(() => {
    loadProfile();
  }, [loadProfile]);

  /**
   * 🔴 인증 확인이 오래 걸리면 **그 사실을 말한다.** 종전에는 `isLoading` 동안 스피너만 돌았고,
   *    끝나지 않으면 사용자는 빈 화면에서 이유를 알 수 없었다(2026-08-25 사람 신고 — 새 창에서
   *    스피너만 계속 돌았다). 규약: **조회 실패를 영구 로딩으로 굳히지 않는다.**
   *    원인을 몰라도 **막힌 채 침묵하지는 않는다** — 다시 시도·로그인 경로를 준다.
   */
  const [authSlow, setAuthSlow] = useState(false);
  useEffect(() => {
    if (!isLoading) { setAuthSlow(false); return; }
    const t = setTimeout(() => setAuthSlow(true), 8000);
    return () => clearTimeout(t);
  }, [isLoading]);

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.push('/login');
    }
  }, [isLoading, isAuthenticated, router]);

  /**
   * 🔴 **세션이 끝나면 화면을 전환한다** (2026-08-28 사람 신고).
   *
   * 종전에는 refresh 실패 후에도 인증 상태가 그대로라 위 리다이렉트가 발동하지 않았고,
   * 화면에는 "재시도" 버튼만 남았다 — 눌러도 같은 401 로 돌아오는 버튼이다.
   * *"시간이 한참 지나면 재시도는 의미가 없으니, 로그아웃이 맞거나 다른 화면으로 전환되어야 함."*
   *
   * 🔴 2026-09-02: 그 처리가 **여기에만** 있어서 `(main)` 밖 인증 화면(태블릿·직원 포털·기록 새 창)은
   *    세션이 끝나도 아무 일도 일어나지 않았다 → 공용 `SessionExpiryWatcher` 로 뽑고 여기서도 그것을 쓴다.
   *    (같은 처리를 두 곳에 적으면 갈라진다.)
   */

  // SSE 실시간 알림 연결
  useEffect(() => {
    if (isAuthenticated) {
      useNotificationStore.getState().connectSSE();
      return () => useNotificationStore.getState().disconnectSSE();
    }
  }, [isAuthenticated]);

  // 스태프 FCM 푸시 토큰 등록 (Tier2 승인 알림) — VAPID 미설정 시 no-op
  useEffect(() => {
    if (isAuthenticated) void initStaffFcm();
  }, [isAuthenticated]);

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 min-h-screen px-6 text-center">
        <svg className="animate-spin h-6 w-6 text-blue-600" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
        </svg>
        {authSlow && (
          <>
            <T k="로그인 상태를 확인하지 못하고 있습니다." className="text-sm text-gray-600" />
            <T
              k="네트워크 또는 서버 응답을 기다리는 중입니다. 계속 이 화면이면 아래에서 다시 시도하세요."
              className="text-xs text-gray-400"
            />
            <div className="flex items-center gap-2 pt-1">
              <button onClick={() => window.location.reload()}
                className="rounded-lg border px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50"><T k="다시 시도" /></button>
              <a href="/login" className="rounded-lg border px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50"><T k="로그인 화면" /></a>
            </div>
          </>
        )}
      </div>
    );
  }

  if (!isAuthenticated) return null;

  // 새창 전체 화면(포커스) 모드 — 사이드바/네비 없이 콘텐츠만 최대화
  if (focusMode) {
    return (
      <HotkeyProvider>
        <div className="flex flex-col h-screen bg-gray-50 overflow-hidden">
          {/* 접근성 표면(ui.a11y.*) — 기본값이면 no-op(§4.6) */}
          <A11yRoot />
          {/* 초점 모드는 상단 바가 없다 — 여기서는 띠로 말한다(리얼이면 아무것도 그리지 않는다) */}
          <HisModeBanner />
          <NetworkStatusBanner />
          <div className="flex items-center gap-3 px-4 h-10 border-b border-gray-200 bg-white flex-shrink-0">
            <span className="text-xs font-semibold text-gray-500">⤢ <T k="전체 화면 보기" /></span>
            <button onClick={() => { const u = new URL(window.location.href); u.searchParams.delete('focus'); window.location.href = u.pathname + u.search; }} className="text-xs text-blue-600 hover:underline"><T k="사이드바 표시" /></button>
            <button onClick={() => window.close()} className="ml-auto text-xs text-gray-400 hover:text-gray-700"><T k="닫기" /></button>
          </div>
          {/* 어시스턴트가 열리면 넓은 화면(xl)에서 본문이 패널 폭만큼 비켜선다 — 덮지 않는다(그보다 좁으면 오른쪽 시트로 덮는다) */}
        <main className={`flex-1 p-3 sm:p-4 lg:p-6 overflow-x-hidden overflow-y-auto ${aiChatOpen ? (aiChatWide ? 'xl:pr-[656px]' : 'xl:pr-[436px]') : ''}`}>{children}</main>
          <Toaster />
          <SmartSearchBar />
          <DailyPinPrompt />
          <StepUpApprovalPrompt />
        </div>
      </HotkeyProvider>
    );
  }

  return (
    <HotkeyProvider>
      <SessionExpiryWatcher />
    <div lang={uiLocale} className="flex h-screen bg-gray-50 overflow-hidden">
      {/* 접근성 표면(ui.a11y.*) — 기본값이면 no-op(§4.6) */}
      <A11yRoot />
      <NetworkStatusBanner />
      <CriticalValueAlertBanner />
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/40 z-40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar
          🔴 (2026-10-01) 넓은 화면에서 이동 값을 남기면(Tailwind v4 `lg:translate-x-0` 은 CSS `translate` 속성 — 0 이어도 none 이 아니다) 이 상자가 쌓임 맥락이 돼
             아이콘 줄의 펼침 메뉴(fixed z-[60])가 그 안에 갇혀 본문 카드 **아래**에 깔렸다 — `lg:translate-none lg:transform-none` 으로 푼다.
             좁은 화면(서랍)은 미끄러짐이 필요해 transform 을 유지한다(그때는 상자 자체가 z-50). */}
      <div data-sidebar-shell className={`
        fixed inset-y-0 left-0 z-50 lg:static lg:z-auto bg-slate-900
        transform transition-transform duration-200 ease-in-out lg:translate-none lg:transform-none
        ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
      `}>
        <Sidebar onNavigate={() => setSidebarOpen(false)} onLogoClick={toggleAiChat} collapsed={railCollapsed} onToggleCollapse={toggleRail} />
      </div>

      <div className="flex-1 flex flex-col min-w-0">
        {/* 🔴 모드 표시는 **상단 바 안의 칩**(`HisModeChip`)이 한다 — 여기에 띠를 얹으면
            상단 바 위에 줄이 하나 더 생겨 정돈되지 않는다(2026-08-26 사람 신고).
            상단 바가 없는 초점 모드에서만 띠를 쓴다(위 분기). */}
        <TopBar onMenuClick={() => setSidebarOpen(!sidebarOpen)} />
        {/* 비밀번호 변경 필요 — 세로(flex-col) 열 안 한 줄 띠 · 강제 아님(사실+변경 길) */}
        <PasswordStatusBanner />
        <main className="flex-1 p-3 sm:p-4 lg:p-6 overflow-x-hidden overflow-y-auto">{children}</main>
        <Toaster />
        <AiChatBar isOpen={aiChatOpen} onClose={closeAiChat} />
        <SmartSearchBar />
        <CertificationBadge />
        <DailyPinPrompt />
        <StepUpApprovalPrompt />
      </div>

      {/* SmartSearchBar가 Cmd+K 통합 검색을 제공합니다 */}
    </div>
    </HotkeyProvider>
  );
}
