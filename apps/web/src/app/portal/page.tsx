'use client';

import { useState, useEffect, useRef, Suspense } from 'react';
import { portalDateText } from './_shared/portal-date';
import { Unit } from '@/components/ui/display';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useSearchParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import { useQuery } from '@tanstack/react-query';
import { apiClient, resetSessionExpiredNotice, SESSION_EXPIRED_EVENT } from '@/lib/api-client';
import type { PatientInfo, MainTab, PortalData, PortalItem } from './_types';
import { Icon, AnimatedTab, NotificationBadge } from './_shared';
import { PT, usePortalTAttr } from './_shared/PT';
import { SessionExpiryNotice } from './_auth/SessionExpiryNotice';
import { ICONS } from './_icons';
import LoginForm from './_auth/LoginForm';
import { encounterDiagnosisNames, toDiagnosticTest } from './_helpers';
import { portalSessionEnded } from './_auth/session-check';
import HomeTab from './_home/HomeTab';
import { NotificationPanel, useUnreadCount } from './_shared/NotificationCenter';
import ConsultChat, { PORTAL_OPEN_CONSULT } from './_consult/ConsultChat';
import LocaleToggle from './_consult/LocaleToggle';
import { useHydrateLocale } from '@/lib/i18n/portal-i18n';
import { AI_ORIGIN_TEXT, billingOutstanding, INSURANCE_LABEL } from '@hospital-run/shared';

const CareTab = dynamic(() => import('./_care/CareTab'), {
  loading: () => <div className="space-y-3">{[1,2,3].map(i => <div key={i} className="h-20 bg-gray-100 rounded-2xl animate-pulse" />)}</div>,
});
const HealthTab = dynamic(() => import('./_health/HealthTab'), {
  loading: () => <div className="space-y-3">{[1,2,3].map(i => <div key={i} className="h-20 bg-gray-100 rounded-2xl animate-pulse" />)}</div>,
});
const ServicesTab = dynamic(() => import('./_services/ServicesTab'), {
  loading: () => <div className="space-y-3">{[1,2,3].map(i => <div key={i} className="h-20 bg-gray-100 rounded-2xl animate-pulse" />)}</div>,
});
const ProfileTab = dynamic(() => import('./_profile/ProfileTab'), {
  loading: () => <div className="space-y-3">{[1,2,3].map(i => <div key={i} className="h-20 bg-gray-100 rounded-2xl animate-pulse" />)}</div>,
});
const MoreTab = dynamic(() => import('./_more/MoreTab'), {
  loading: () => <div className="space-y-3">{[1,2,3].map(i => <div key={i} className="h-20 bg-gray-100 rounded-2xl animate-pulse" />)}</div>,
});

// ── 모바일 하단 3탭 (UX 재설계 v2.0) ──
const BOTTOM_TABS: { key: MainTab; icon: string; label: string }[] = [
  { key: 'home', icon: ICONS.home, label: '홈' },
  { key: 'health', icon: ICONS.heart, label: '내 건강' },
  { key: 'more', icon: ICONS.bars3, label: '더보기' },
];

const SIDEBAR_TABS: { key: MainTab; icon: string; label: string; sub?: { key: string; label: string }[] }[] = [
  { key: 'home', icon: ICONS.home, label: '홈' },
  { key: 'care', icon: ICONS.stethoscope, label: '진료', sub: [
    { key: 'appointments', label: '예약/대기' },
    { key: 'schedule', label: '치료 일정' },
    { key: 'encounters', label: '진료이력' },
    { key: 'questionnaire', label: '문진표' },
    { key: 'consent', label: '동의서' },
    { key: 'messages', label: '비대면진료' },
  ]},
  { key: 'health', icon: ICONS.heart, label: '건강', sub: [
    { key: 'labs', label: '검사결과' },
    { key: 'imaging', label: '영상검사' },
    { key: 'medications', label: '투약관리' },
    { key: 'checkup', label: '건강검진' },
  ]},
  { key: 'services', icon: ICONS.cube, label: '서비스', sub: [
    { key: 'billing', label: '진료비/수납' },
    { key: 'documents', label: '서류발급' },
    { key: 'telehealth', label: '원격진료' },
    { key: 'pre-auth', label: '사전승인 신청' },
    { key: 'hospital-info', label: '병원안내' },
  ]},
  { key: 'profile', icon: ICONS.user, label: '내 정보' },
];

const fmt = (d: string) => portalDateText(d, 'date'); // 포털 언어 축 정본(`_shared/portal-date`)

export default function PortalPageWrapper() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="w-10 h-10 border-3 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-sm text-gray-500">포털 로딩 중...</p>
        </div>
      </div>
    }>
      <PortalPage />
    </Suspense>
  );
}

function PortalPage() {
  const searchParams = useSearchParams();
  const initialTab = (searchParams.get('tab') as MainTab) || 'home';
  const [activeTab, setActiveTab] = useState<MainTab>(initialTab);
  useHydrateLocale();
  // 🔴 JSX 텍스트 자리는 <PT>(미번역 티가 뜬다) · tAttr 은 티를 그릴 수 없는 속성 자리(aria-label)만
  const tAttr = usePortalTAttr();
  const [patient, setPatient] = useState<PatientInfo | null>(null);
  /** 조회하지 못한 축 — 빈 목록이 "없음"으로 읽히지 않게 화면이 말한다 */
  const [loadFailed, setLoadFailed] = useState<string[]>([]);
  const [portalData, setPortalData] = useState<PortalData>({
    appointments: [], encounters: [], labResults: [], diagnosticTests: [],
    billings: [], allergies: [], medications: [], questionnaires: [],
  });

  // ── 접근성 설정 복원 ──
  useEffect(() => {
    const root = document.documentElement;
    const fs = localStorage.getItem('portal-font-size');
    const hc = localStorage.getItem('portal-high-contrast');
    if (fs === 'large') root.classList.add('portal-font-lg');
    if (fs === 'xlarge') root.classList.add('portal-font-xl');
    if (hc === 'true') root.classList.add('portal-high-contrast');
    const dm = localStorage.getItem('portal-dark-mode');
    if (dm === 'true') root.classList.add('portal-dark');
    return () => {
      root.classList.remove('portal-font-lg', 'portal-font-xl', 'portal-high-contrast', 'portal-dark');
    };
  }, []);

  // ── 데이터 로딩 ──
  async function loadPortalData(pid: string) {
    try {
      const [appts, encs, labs, diags, bills] = await Promise.all([
        apiClient.fetch<{ data: unknown }>(`/api/v1/portal/appointments?patientId=${pid}`),
        apiClient.fetch<{ data: unknown }>(`/api/v1/portal/encounters?patientId=${pid}`),
        apiClient.fetch<{ data: unknown }>(`/api/v1/portal/lab-results?patientId=${pid}`),
        apiClient.fetch<{ data: unknown }>(`/api/v1/portal/diagnostic-tests?patientId=${pid}`),
        apiClient.fetch<{ data: unknown }>(`/api/v1/portal/billings?patientId=${pid}`),
      ]);
      const unwrap = (d: unknown): Record<string, unknown>[] => Array.isArray(d) ? d : (d as PortalItem)?.data as PortalItem[] ?? [];

      const appointments = unwrap(appts.data).map((a: Record<string, unknown>) => ({
        ...a,
        doctorName: a.doctor ? `${(a.doctor as PortalItem).familyName}${(a.doctor as PortalItem).givenName}` : (a.doctorName as string) ?? '',
        department: (a.doctor as PortalItem)?.department ?? a.department ?? '',
      })) as PortalData['appointments'];

      const encounters = unwrap(encs.data).map((e: Record<string, unknown>) => ({
        ...e,
        encounteredAt: (e.createdAt ?? e.encounteredAt) as string,
        doctorName: e.doctor ? `${(e.doctor as PortalItem).familyName}${(e.doctor as PortalItem).givenName} (${(e.doctor as PortalItem).department})` : (e.doctorName as string) ?? '',
        diagnosisNames: e.diagnoses ? encounterDiagnosisNames(e.diagnoses) : (e.diagnosisNames as string[]) ?? [],
      })) as PortalData['encounters'];

      const billings = unwrap(bills.data).map((b: Record<string, unknown>) => ({
        ...b,
        billedAt: (b.createdAt ?? b.billedAt) as string,
        total: (b.totalAmount ?? b.total ?? 0) as number,
        insuranceCovered: (b.insuranceCovered ?? 0) as number,
        copay: (b.patientCopay ?? b.copay ?? 0) as number,
        paidAmount: (b.paidAmount ?? 0) as number,
        refundAmount: (b.refundAmount ?? null) as number | null,
        discount: (b.discountAmount ?? 0) as number,
        outstanding: billingOutstanding({ patientCopay: (b.patientCopay ?? null) as number | null, discountAmount: (b.discountAmount ?? 0) as number, paidAmount: (b.paidAmount ?? 0) as number }),
      })) as PortalData['billings'];

      const labResults = unwrap(labs.data) as unknown as PortalData['labResults'];
      const diagnosticTests = unwrap(diags.data).map(toDiagnosticTest);

      let allergies: PortalData['allergies'] = [];
      let allergyStatus: PortalData['allergyStatus'] = 'NOT_ASSESSED';
      let allergyAssessedAt: PortalData['allergyAssessedAt'] = null;
      let questionnaires: PortalData['questionnaires'] = [];
      let medications: PortalData['medications'] = [];
      /**
       * 🔴 **조회 실패를 "없음"으로 번역하지 않는다**(2026-09-02).
       *    종전엔 네 축 모두 `.catch(() => ({ data: [] }))` 라, 알레르기 조회가 실패하면 헤더의
       *    "알레르기 N건" 배지가 사라지고 건강 탭이 "알레르기 문진 정보가 없습니다"를 그렸다 —
       *    이미 확정된 알레르기가 있는 환자가 **자기 기록이 안 들어갔다고 오해**한다.
       *    실패한 축을 모아 화면이 그대로 말한다.
       */
      const axisFailed: string[] = [];
      const guard = async <T,>(label: string, p: Promise<T>, empty: T): Promise<T> => {
        try { return await p; } catch { axisFailed.push(label); return empty; }
      };
      try {
        const [allergyRes, allergyStatusRes, questRes, medRes] = await Promise.all([
          guard('알레르기', apiClient.fetch<{ data: unknown }>('/api/v1/portal/allergies'), { data: [] as unknown }),
          guard('알레르기 확인상태', apiClient.fetch<{ data: unknown }>('/api/v1/portal/allergies/status'), { data: null as unknown }),
          guard('문진표', apiClient.fetch<{ data: unknown }>('/api/v1/portal/questionnaires'), { data: [] as unknown }),
          guard('복약', apiClient.fetch<{ data: unknown }>('/api/v1/portal/medications'), { data: [] as unknown }),
        ]);
        allergies = unwrap(allergyRes.data) as unknown as PortalData['allergies'];
        // 상태는 단일 객체 — 배열 unwrap 쓰면 []로 뭉개져 상태가 사장됨. .data를 직접 사용.
        const _sd = allergyStatusRes.data as { data?: unknown } | null;
        const statusObj = (_sd && typeof _sd === 'object' && 'status' in _sd ? _sd : (_sd?.data as unknown)) as { status?: PortalData['allergyStatus']; assessedAt?: string | null } | null;
        if (statusObj?.status) { allergyStatus = statusObj.status; allergyAssessedAt = statusObj.assessedAt ?? null; }
        questionnaires = unwrap(questRes.data) as unknown as PortalData['questionnaires'];
        medications = unwrap(medRes.data) as unknown as PortalData['medications'];
      } catch { axisFailed.push('건강 정보'); }

      setPortalData({ appointments, encounters, labResults, diagnosticTests, billings, allergies, allergyStatus, allergyAssessedAt, medications, questionnaires });
      setLoadFailed([...new Set(axisFailed)]);
    } catch {
      /**
       * 🔴 바깥 `try/catch {}` 가 예약·진료·검사결과·영상·청구 **5축을 통째로 삼켰다** —
       *    `setPortalData` 자체를 건너뛰어 초기 빈 배열이 남고, 환자는 "검사 결과가 없습니다"·
       *    미수납 0건을 자기 사실로 읽었다(2026-09-02).
       */
      setLoadFailed(['예약·진료·검사결과·영상·청구']);
    }
  }

  // 🔴 (2026-10-19) 세션이 끝나면 로그인 화면으로 돌아간다 — 종전엔 포털이 만료 통지를 듣지 않아
  //    카드마다 "세션이 만료되었습니다"를 그리면서 다른 카드는 옛 데이터를 그대로 보여 줬다(로그인한 것처럼 보이는 화면).
  const [sessionExpired, setSessionExpired] = useState(false);
  useEffect(() => {
    const onExpired = async () => {
      // 401 이 곧 세션 끝은 아니다(등록번호 세션의 알림 조회는 설계상 401) — 세션 정본으로 확인한 뒤에만 로그아웃
      if (!(await portalSessionEnded(apiClient.getToken()))) { resetSessionExpiredNotice(); return; }
      apiClient.setToken(null); setPatient(null); setActiveTab('home'); setSessionExpired(true);
    };
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired);
  }, []);

  // ── 로그인 처리 ──
  const handleLogin = async (p: PatientInfo) => {
    resetSessionExpiredNotice();
    setSessionExpired(false);
    setPatient(p);
    await loadPortalData(p.id);
  };

  const handleLogout = () => {
    apiClient.post('/api/v1/portal/auth/logout').catch(() => {});
    apiClient.setToken(null);
    setPatient(null);
    setActiveTab('home');
  };

  const urlSegment = searchParams.get('segment') || undefined; // 홈페이지 딥링크(예: ?tab=services&segment=documents)
  const [careInitialSegment, setCareInitialSegment] = useState<string | undefined>(initialTab === 'care' ? urlSegment : undefined);
  const [healthInitialSegment, setHealthInitialSegment] = useState<string | undefined>(initialTab === 'health' ? urlSegment : undefined);
  const [servicesInitialSegment, setServicesInitialSegment] = useState<string | undefined>(initialTab === 'services' ? urlSegment : undefined);
  const handleNavigate = (tab: MainTab, segment?: string) => {
    setActiveTab(tab);
    if (tab === 'care' && segment) setCareInitialSegment(segment);
    if (tab === 'health' && segment) setHealthInitialSegment(segment);
    if (tab === 'services' && segment) setServicesInitialSegment(segment);
  };

  // ── F-1 알림 센터 (레거시 세션 401→패널 내 안내 폴백 / 위임 세션은 벨 숨김 — 설계 §1.3) ──
  const [showNotifPanel, setShowNotifPanel] = useState(false);
  const [isGuardianMode, setIsGuardianMode] = useState(false);
  useEffect(() => {
    setIsGuardianMode(!!localStorage.getItem('guardian-mode'));
  }, [patient]);
  // 🔴 조회 실패를 '알림 없음'으로 그리지 않는다 — 배지 대신 '!' 로 못 불러왔다는 사실을 보인다
  const { data: unreadCount, loadFailed: unreadLoadFailed } = useUnreadCount(!!patient && !isGuardianMode);

  // ── 로그인 화면 ──
  if (!patient) {
    return (
      <>
        {sessionExpired && (
          <p className="mx-auto mt-4 max-w-md rounded-xl bg-amber-50 border border-amber-200 px-4 py-2 text-xs text-amber-800" data-portal-session-expired>
            <PT k="로그인 시간이 지나 안전을 위해 로그아웃되었습니다. 다시 로그인해 주세요." />
          </p>
        )}
        <LoginForm onLogin={handleLogin} initialSignup={searchParams.get('signup') === '1'} />
      </>
    );
  }

  // ── 포털 메인 ──
  const patientName = `${patient.familyName}${patient.givenName}`;
  const genderLabel = patient.gender === 'MALE' ? '남' : patient.gender === 'FEMALE' ? '여' : patient.gender;
  const pendingQCount = portalData.questionnaires.filter(q => q.status !== 'COMPLETED' && new Date(q.expiresAt) > new Date()).length;
  const unpaidCount = portalData.billings.filter(b => b.status !== 'PAID').length;

  // ── 탭리스트 키보드 네비게이션 (WAI-ARIA tabs 패턴) ──
  const SIDEBAR_KEYS = SIDEBAR_TABS.map(t => t.key);
  const BOTTOM_KEYS = BOTTOM_TABS.map(t => t.key);
  const onTabListKeyDown = (
    e: ReactKeyboardEvent<HTMLElement>,
    keys: MainTab[],
    idPrefix: string,
    orientation: 'vertical' | 'horizontal',
  ) => {
    const fwd = orientation === 'vertical' ? 'ArrowDown' : 'ArrowRight';
    const back = orientation === 'vertical' ? 'ArrowUp' : 'ArrowLeft';
    const cur = keys.includes(activeTab) ? activeTab : keys[keys.length - 1];
    const idx = keys.indexOf(cur);
    let target: MainTab | null = null;
    if (e.key === fwd) target = keys[(idx + 1) % keys.length];
    else if (e.key === back) target = keys[(idx - 1 + keys.length) % keys.length];
    else if (e.key === 'Home') target = keys[0];
    else if (e.key === 'End') target = keys[keys.length - 1];
    if (!target) return;
    e.preventDefault();
    setActiveTab(target);
    const id = `${idPrefix}${target}`;
    requestAnimationFrame(() => document.getElementById(id)?.focus());
  };

  return (
    <div className="min-h-screen bg-[#f0f4f8] pb-20 md:pb-0" style={{ fontFamily: "'Pretendard Variable', -apple-system, system-ui, sans-serif" }}>
      {/* 본문 바로가기 (스킵 링크) — 키보드 포커스 시에만 노출 */}
      <a
        href="#portal-main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:bg-blue-600 focus:text-white focus:px-4 focus:py-2 focus:rounded-lg focus:text-sm focus:font-medium focus:shadow-lg"
      >
        본문 바로가기
      </a>
      <h1 className="sr-only">위루비병원 환자 포털 — {patientName} 님</h1>
      <GuardianBanner />
      {/* ── 헤더 (Glass) ── */}
      <header className="bg-white/80 backdrop-blur-xl border-b border-gray-200/50 sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-blue-600 to-indigo-600 flex items-center justify-center shadow-sm">
              <svg className="w-4.5 h-4.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" /></svg>
            </div>
            <div>
              <span className="font-bold text-gray-900 text-sm tracking-tight">위루비병원</span>
              <p className="text-[9px] text-gray-400 -mt-0.5"><PT k="환자 포털" /></p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {/* 🔴 종전 언어 선택은 **데스크톱 사이드바(`hidden md:block`) 안에만** 있었다 —
                포털의 주 사용 기기인 휴대폰에서는 언어를 바꿀 방법이 아예 없었다(카탈로그가 있어도 도달 불가).
                모바일 헤더에 같은 부품을 둔다(데스크톱은 사이드바 것 하나만 — 중복 노출 금지). */}
            <LocaleToggle className="md:hidden" />
            {!isGuardianMode && (
              <button
                onClick={() => setShowNotifPanel(true)}
                className="relative p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-xl transition-all"
                aria-label={unreadLoadFailed ? '알림 — 새 알림이 있는지 지금 확인하지 못했습니다. 눌러서 다시 시도하세요' : `알림${unreadCount ? ` ${unreadCount}건 미읽음` : ''}`}
                title={unreadLoadFailed ? '새 알림이 있는지 지금 확인하지 못했습니다. 눌러서 다시 확인하세요.' : undefined}
              >
                <Icon d={ICONS.bell} cls="w-5 h-5" />
                {unreadLoadFailed ? (
                  <span
                    aria-hidden
                    className="absolute -top-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-amber-500 text-[9px] font-bold text-white"
                  >
                    !
                  </span>
                ) : (
                  <NotificationBadge count={unreadCount ?? 0} />
                )}
              </button>
            )}
          </div>
        </div>
      </header>

      <SessionExpiryNotice />

      <div className="max-w-5xl mx-auto px-4 py-5">
        {/* ── 환자 카드 (Hero Gradient + Glass) ── */}
        <div className="relative bg-gradient-to-br from-blue-600 via-blue-700 to-indigo-700 rounded-3xl p-5 text-white mb-5 overflow-hidden shadow-lg shadow-blue-600/20" role="region" aria-label="환자 정보">
          <div className="absolute -top-16 -right-16 w-48 h-48 bg-white/5 rounded-full" />
          <div className="absolute -bottom-12 -left-12 w-32 h-32 bg-white/5 rounded-full" />
          <div className="relative z-10 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 bg-white/15 backdrop-blur-sm rounded-2xl flex items-center justify-center border border-white/20">
                <Icon d={ICONS.user} cls="w-5 h-5 text-white" />
              </div>
              <div>
                <p className="text-lg font-bold tracking-tight">{patientName} 님</p>
                <p className="text-blue-200 text-xs mt-0.5">{fmt(patient.dateOfBirth)} · {genderLabel} · <PT k={INSURANCE_LABEL[patient.insuranceType ?? ''] ?? '보험 정보 확인 필요'} /></p>
              </div>
            </div>
            <div className="text-right">
              <p className="text-blue-300 text-[10px] font-mono">{patient.mrn}</p>
              {portalData.allergies.length > 0 && (
                <div className="flex items-center gap-1 mt-1.5 bg-yellow-500/20 backdrop-blur-sm px-2 py-0.5 rounded-lg border border-yellow-400/30">
                  <Icon d={ICONS.shield} cls="w-3 h-3 text-yellow-300" />
                  <p className="text-yellow-200 text-[10px] font-semibold whitespace-nowrap">알레르기 {portalData.allergies.length}<Unit>건</Unit></p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── 데스크톱: 사이드바 + 콘텐츠 ── */}
        <div className="md:flex md:gap-5">
          {/* 사이드 네비게이션 (Glass 카드) */}
          <nav className="hidden md:block w-52 shrink-0" aria-label="포털 메뉴">
            <div className="sticky top-20 bg-white/70 backdrop-blur-sm rounded-2xl border border-gray-200/50 p-2 shadow-sm" role="tablist" aria-orientation="vertical" aria-label="포털 탭 메뉴"
              onKeyDown={e => onTabListKeyDown(e, SIDEBAR_KEYS, 'portal-stab-', 'vertical')}>
              <div className="px-1 pb-2 mb-1 border-b border-gray-100"><LocaleToggle className="w-full" /></div>
              {SIDEBAR_TABS.map(tab => (
                <div key={tab.key}>
                  <button onClick={() => setActiveTab(tab.key)}
                    id={`portal-stab-${tab.key}`}
                    role="tab" aria-selected={activeTab === tab.key} aria-controls="portal-main" aria-label={`${tAttr(tab.label)} 탭`}
                    tabIndex={activeTab === tab.key ? 0 : -1}
                    className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-medium transition-all text-left ${
                      activeTab === tab.key
                        ? 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-md shadow-blue-600/25'
                        : 'text-gray-500 hover:bg-gray-100/80 hover:text-gray-700'
                    }`}>
                    <Icon d={tab.icon} cls="w-4.5 h-4.5" /> <PT k={tab.label} />
                  </button>
                  {tab.sub && activeTab === tab.key && (
                    <div className="ml-4 mt-1 mb-1 space-y-0.5 border-l-2 border-blue-100 pl-3">
                      {tab.sub.map(s => (
                        <button key={s.key} onClick={() => handleNavigate(tab.key, s.key)}
                          className="w-full text-left text-xs py-1.5 px-2 rounded-lg text-blue-600 font-medium hover:bg-blue-50 transition-colors">
                          <PT k={s.label} />
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </nav>

          {/* ── 콘텐츠 영역 ── */}
          <main id="portal-main" tabIndex={-1} className="flex-1 min-w-0 space-y-4 focus:outline-none" role="tabpanel" aria-label={`${tAttr(SIDEBAR_TABS.find(s => s.key === activeTab)?.label ?? '홈')} 콘텐츠`}>
            {/* 🔴 조회 실패 고지 — 비어 있는 목록이 "없음"으로 읽히지 않게(모바일 앱이 이미 쓰는 방식) */}
            {loadFailed.length > 0 && (
              <div role="status" className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
                {loadFailed.join(' · ')} 정보를 불러오지 못했습니다. 아래 목록이 비어 있어도 <b>&ldquo;없음&rdquo;이 아닙니다.</b>
                <button onClick={() => patient && loadPortalData(patient.id)} className="ml-2 font-bold underline"><PT k="다시 시도" /></button>
              </div>
            )}
            <AnimatedTab tabKey={activeTab}>
              {activeTab === 'home' && (
                <HomeTab patient={patient} data={portalData} onNavigate={handleNavigate} />
              )}
              {activeTab === 'care' && (
                <CareTab patient={patient} data={portalData} initialSegment={careInitialSegment as any} />
              )}
              {activeTab === 'health' && (
                <HealthTab patient={patient} data={portalData} initialSegment={healthInitialSegment as any} />
              )}
              {activeTab === 'services' && (
                <ServicesTab patient={patient} data={portalData} initialSegment={servicesInitialSegment as any} />
              )}
              {activeTab === 'profile' && (
                <ProfileTab patient={patient} onLogout={handleLogout} />
              )}
              {activeTab === 'more' && (
                <MoreTab patient={patient} data={portalData} onNavigate={handleNavigate} onLogout={handleLogout} />
              )}
            </AnimatedTab>
          </main>
        </div>
      </div>

      {/* ── 하단 네비게이션 (모바일 Glass) ── */}
      <nav className="fixed bottom-0 left-0 right-0 bg-white/90 backdrop-blur-xl border-t border-gray-200/50 safe-area-bottom md:hidden z-20" aria-label="모바일 네비게이션">
        <div className="max-w-2xl mx-auto grid grid-cols-3" role="tablist" aria-label="포털 탭 메뉴"
          onKeyDown={e => onTabListKeyDown(e, BOTTOM_KEYS, 'portal-btab-', 'horizontal')}>
          {BOTTOM_TABS.map(n => {
            const isActive = n.key === 'more'
              ? ['more', 'care', 'services', 'profile'].includes(activeTab)
              : activeTab === n.key;
            return (
              <button key={n.key} onClick={() => setActiveTab(n.key)}
                id={`portal-btab-${n.key}`}
                role="tab" aria-selected={isActive} aria-controls="portal-main" aria-label={`${tAttr(n.label)} 탭`}
                tabIndex={isActive ? 0 : -1}
                className={`py-3 flex flex-col items-center gap-1 text-[10px] transition-all active:scale-[0.92] relative ${
                  isActive ? 'text-blue-600 font-bold' : 'text-gray-400 active:text-gray-600'
                }`}>
                {isActive && (
                  <span className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-1 bg-gradient-to-r from-blue-500 to-indigo-500 rounded-full" />
                )}
                <div className={`relative p-1.5 rounded-xl transition-all ${isActive ? 'bg-blue-50' : ''}`}>
                  <Icon d={n.icon} cls={`w-5 h-5 transition-colors ${isActive ? 'text-blue-600' : 'text-gray-400'}`} />
                  {n.key === 'more' && <NotificationBadge count={pendingQCount + unpaidCount} />}
                </div>
                <span className="tracking-tight"><PT k={n.label} /></span>
              </button>
            );
          })}
        </div>
      </nav>

      {/* ── 플로팅 WeRU.B 버튼 (FAB) ── */}
      <FloatingAiButton />

      {/* ── 상담실 (채팅·다국어·AI 1차, 좌하단) ── */}
      <ConsultChat />

      {/* ── 풀스크린 대기 화면 ── */}
      <FullscreenWaiting />

      {/* ── F-1 알림 패널 ── */}
      <NotificationPanel open={showNotifPanel} onClose={() => setShowNotifPanel(false)} onNavigate={handleNavigate} />
    </div>
  );
}

// ── 플로팅 WeRU.B 채팅 ──
interface ChatMessage { role: 'user' | 'ai'; text: string; ts: number }

function FloatingAiButton() {
  const tAttr = usePortalTAttr();
  const [open, setOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);

  const ask = async (q?: string) => {
    const question = (q ?? query).trim();
    if (!question || loading) return;

    // 사용자 메시지 추가 + 입력 클리어
    setMessages(prev => [...prev, { role: 'user', text: question, ts: Date.now() }]);
    setQuery('');
    setLoading(true);
    scrollToBottom();

    try {
      const res = await apiClient.post<{ data: { answer?: string } }>('/api/v1/portal/ai/ask', { question });
      const answer = (res?.data?.answer ?? '') as string;
      setMessages(prev => [...prev, { role: 'ai', text: answer || '답변을 생성하지 못했습니다.', ts: Date.now() }]);
    } catch {
      setMessages(prev => [...prev, { role: 'ai', text: '죄송합니다, 일시적으로 응답에 실패했습니다. 잠시 후 다시 시도해주세요.', ts: Date.now() }]);
    }
    setLoading(false);
    scrollToBottom();
  };

  const suggestions = ['검사결과가 궁금해요', '복용약 부작용이 걱정돼요', '다음 진료 예약은 언제인가요?', '수납 금액이 궁금합니다', '건강검진 준비사항 알려주세요'];

  return (
    <>
      {/* 🔴 (2026-10-19 포털 세련화 A5) 도움 버튼 하나 — 상담실(직원·다국어)과 AI 도우미를 메뉴로 고른다.
          종전엔 왼쪽 아래 상담실 버튼·오른쪽 아래 AI 버튼이 따로 떠 모바일에서 하단 탭·본문을 가렸다. */}
      {menuOpen && (
        <div className="fixed bottom-40 right-4 md:bottom-24 md:right-8 z-30 w-56 rounded-2xl bg-white shadow-xl border border-gray-100 p-1.5" role="menu" data-portal-help-menu>
          <button role="menuitem" onClick={() => { setMenuOpen(false); window.dispatchEvent(new Event(PORTAL_OPEN_CONSULT)); }}
            className="w-full min-h-[44px] text-left px-3 py-2 rounded-xl text-sm text-gray-800 hover:bg-gray-50">
            💬 <PT k="상담실" /> <span className="block text-[11px] text-gray-500"><PT k="병원 직원과 대화 · 다국어" /></span>
          </button>
          <button role="menuitem" onClick={() => { setMenuOpen(false); setOpen(true); }}
            className="w-full min-h-[44px] text-left px-3 py-2 rounded-xl text-sm text-gray-800 hover:bg-gray-50">
            ✨ {AI_ORIGIN_TEXT} <PT k="도우미" /> <span className="block text-[11px] text-gray-500"><PT k="AI 가 답합니다 — 진단이 아닙니다" /></span>
          </button>
        </div>
      )}
      <button
        onClick={() => setMenuOpen((v) => !v)}
        className="fixed bottom-24 right-4 md:bottom-8 md:right-8 w-14 h-14 bg-gradient-to-br from-blue-600 to-indigo-600 rounded-full shadow-lg hover:shadow-xl flex items-center justify-center z-30 transition-all hover:scale-105 active:scale-95"
        aria-label={tAttr('도움 메뉴')} aria-expanded={menuOpen} data-portal-help-launcher
      >
        <Icon d={menuOpen ? ICONS.xMark : ICONS.sparkles} cls="w-6 h-6 text-white" />
      </button>

      {/* WeRU.B 채팅 패널 */}
      {open && (
        <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center">
          <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={() => setOpen(false)} />
          <div className="relative w-full max-w-md mx-4 mb-4 md:mb-0 bg-white rounded-2xl shadow-2xl overflow-hidden flex flex-col" style={{ maxHeight: '80vh' }}>
            {/* 헤더 */}
            <div className="bg-gradient-to-r from-blue-600 to-indigo-600 px-4 py-3 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2">
                <Icon d={ICONS.sparkles} cls="w-5 h-5 text-white" />
                <div>
                  <span className="text-white font-bold text-sm">{AI_ORIGIN_TEXT} 건강 도우미</span>
                  <p className="text-blue-200 text-[10px]">건강, 예약, 검사결과 등 무엇이든 물어보세요</p>
                </div>
              </div>
              <button onClick={() => setOpen(false)} className="text-white/70 hover:text-white p-1">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>

            {/* 채팅 영역 */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3 min-h-[200px]">
              {/* 초기 상태: 추천 질문 */}
              {messages.length === 0 && !loading && (
                <div className="text-center py-4">
                  <div className="w-12 h-12 bg-blue-100 rounded-2xl flex items-center justify-center mx-auto mb-3">
                    <Icon d={ICONS.sparkles} cls="w-6 h-6 text-blue-600" />
                  </div>
                  <p className="text-sm font-medium text-gray-700 mb-1">안녕하세요!</p>
                  <p className="text-xs text-gray-500 mb-4">궁금한 점을 물어보시거나, 아래 질문을 선택해주세요.</p>
                  <div className="flex flex-wrap gap-1.5 justify-center">
                    {suggestions.map(q => (
                      <button key={q} onClick={() => ask(q)}
                        className="px-3 py-1.5 bg-blue-50 text-blue-700 text-xs rounded-full hover:bg-blue-100 transition-colors border border-blue-100">
                        {q}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* 대화 메시지 */}
              {messages.map((msg, i) => (
                <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  {msg.role === 'ai' && (
                    <div className="w-7 h-7 bg-blue-100 rounded-lg flex items-center justify-center mr-2 mt-1 shrink-0">
                      <Icon d={ICONS.sparkles} cls="w-3.5 h-3.5 text-blue-600" />
                    </div>
                  )}
                  <div className={`max-w-[80%] rounded-2xl px-3.5 py-2.5 text-sm ${
                    msg.role === 'user'
                      ? 'bg-blue-600 text-white rounded-br-md'
                      : 'bg-gray-100 text-gray-800 rounded-bl-md'
                  }`}>
                    <p className="whitespace-pre-wrap leading-relaxed">{msg.text}</p>
                    {msg.role === 'ai' && (
                      <p className="text-[11px] text-gray-500 mt-1.5">{AI_ORIGIN_TEXT} 참고용 — 정확한 판단은 의료진에게 문의하세요</p>
                    )}
                  </div>
                </div>
              ))}

              {/* 로딩 인디케이터 */}
              {loading && (
                <div className="flex justify-start">
                  <div className="w-7 h-7 bg-blue-100 rounded-lg flex items-center justify-center mr-2 mt-1 shrink-0">
                    <Icon d={ICONS.sparkles} cls="w-3.5 h-3.5 text-blue-600" />
                  </div>
                  <div className="bg-gray-100 rounded-2xl rounded-bl-md px-4 py-3">
                    <div className="flex gap-1.5">
                      <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                      <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                      <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                    </div>
                  </div>
                </div>
              )}

              <div ref={chatEndRef} />
            </div>

            {/* 대화 중 추천 질문 (3개 이상 대화 후) */}
            {messages.length > 0 && messages.length < 8 && !loading && (
              <div className="px-4 pb-2 flex gap-1.5 overflow-x-auto shrink-0">
                {['다른 질문이 있어요', '더 자세히 알려주세요', '감사합니다'].map(q => (
                  <button key={q} onClick={() => ask(q)}
                    className="px-2.5 py-1 bg-gray-50 text-gray-500 text-[10px] rounded-full hover:bg-gray-100 transition-colors border border-gray-200 whitespace-nowrap shrink-0">
                    {q}
                  </button>
                ))}
              </div>
            )}

            {/* 입력 */}
            <div className="border-t px-4 py-3 flex gap-2 shrink-0 bg-white">
              <input
                type="text"
                value={query}
                onChange={e => setQuery(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && !e.nativeEvent.isComposing && ask()}
                placeholder="질문을 입력하세요..."
                disabled={loading}
                className="flex-1 px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-50"
              />
              <button onClick={() => ask()} disabled={loading || !query.trim()}
                className="px-4 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors">
                {loading ? (
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                ) : (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" /></svg>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ── 풀스크린 대기 화면 ──
function FullscreenWaiting() {
  const [show, setShow] = useState(false);

  const { data } = useQuery({
    queryKey: ['portal-waiting-fullscreen'],
    queryFn: () => apiClient.get<{ data: unknown[] }>('/api/v1/portal/waiting-status'),
    refetchInterval: 15000,
  });
  const raw = data?.data;
  const queues = (Array.isArray(raw) ? raw : (raw as unknown as PortalItem)?.data ?? []) as PortalItem[];
  const myQueue = queues[0];

  if (!myQueue) return null;

  if (!show) {
    return (
      <button
        onClick={() => setShow(true)}
        className="fixed top-20 right-4 px-3 py-1.5 bg-emerald-600 text-white text-xs font-medium rounded-full shadow-lg z-30 animate-pulse hover:bg-emerald-700 transition-colors"
      >
        대기 #{String(myQueue.queueNumber ?? '')} · 앞 {String(myQueue.aheadCount ?? '')}명
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 bg-gradient-to-b from-blue-600 via-blue-700 to-indigo-800 flex flex-col items-center justify-center text-white">
      <button onClick={() => setShow(false)}
        className="absolute top-4 right-4 text-white/50 hover:text-white p-2">
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
      </button>

      <p className="text-blue-200 text-sm font-medium uppercase tracking-widest mb-4">대기 번호</p>

      <div className="text-8xl font-bold mb-6" style={{ fontFamily: 'JetBrains Mono, monospace' }}>
        {String(myQueue.queueNumber ?? '')}
      </div>

      <p className="text-xl font-medium mb-2">
        앞에 <span className="text-2xl font-bold">{String(myQueue.aheadCount ?? '')}</span>명 대기 중
      </p>
      {/* 🔴 W9(2026-08-14): 종전 `{estimatedMinutes ?? ''}분` — 서버가 어제부터 '모른다'(null)를 내는데
          화면은 그것을 빈 문자열로 받아 **"예상 대기 시간: 약  분"** 이라는 깨진 문장을 띄웠다.
          (상수 8분/명 날조를 BE 에서 걷어냈지만 그 null 을 받는 화면 3곳을 같이 고치지 않은 결과 — P11.)
          예상 시각을 뒷받침할 표본이 없으면 그 줄은 **아예 말하지 않는다**. */}
      {myQueue.estimatedMinutes != null && (
        <p className="text-blue-200 mb-8">
          예상 대기 시간: 약 <span className="font-bold">{String(myQueue.estimatedMinutes)}</span>분
        </p>
      )}

      {/* 프로그레스 바 */}
      {myQueue.totalCount != null && (
        <div className="w-64 h-2 bg-blue-500/30 rounded-full overflow-hidden mb-8">
          <div
            className="h-full bg-white/70 rounded-full transition-all duration-500"
            style={{ width: `${Math.max(10, (1 - Number(myQueue.aheadCount ?? 0) / Number(myQueue.totalCount)) * 100)}%` }}
          />
        </div>
      )}

      <div className="text-center">
        <p className="text-blue-200 text-sm">{String(myQueue.departmentName ?? '')}</p>
        {myQueue.doctorName != null && <p className="text-blue-200 text-sm">{String(myQueue.doctorName ?? '')} · 진료실 {String(myQueue.roomNumber ?? '')}</p>}
      </div>

      <button onClick={() => setShow(false)}
        className="mt-12 px-6 py-3 bg-white/10 border border-white/20 rounded-xl text-sm font-medium hover:bg-white/20 transition-colors">
        닫기
      </button>
    </div>
  );
}

/* ── 보호자 열람 모드 배너 (피부양자 전환 시 상단 고정) ── */
const GUARD_SCOPE_LABELS: Record<string, string> = { appointments: '예약', encounters: '진료', labs: '검사', billing: '수납', documents: '서류', imaging: '영상' };
function GuardianBanner() {
  const [mode, setMode] = useState<{ name: string; scope?: Record<string, boolean>; btg?: boolean } | null>(null);
  useEffect(() => {
    try { const raw = localStorage.getItem('guardian-mode'); if (raw) setMode(JSON.parse(raw)); } catch { /* noop */ }
  }, []);
  if (!mode) return null;
  const scopeStr = mode.scope
    ? Object.entries(mode.scope).filter(([k, v]) => v && k !== 'sensitive').map(([k]) => GUARD_SCOPE_LABELS[k] ?? k).join('/') || '제한'
    : '전체';
  const back = () => {
    const orig = localStorage.getItem('portal-token-original');
    const origPt = localStorage.getItem('portal-token-original-pt');
    if (orig) apiClient.setToken(orig);
    if (origPt !== null) localStorage.setItem('portal-token', origPt);
    localStorage.removeItem('portal-token-original');
    localStorage.removeItem('portal-token-original-pt');
    localStorage.removeItem('guardian-mode');
    window.location.reload();
  };
  return (
    <div className={`${mode.btg ? 'bg-red-600' : 'bg-amber-500'} text-white px-4 py-2 text-xs flex items-center justify-between gap-2 sticky top-0 z-20`}>
      <span className="truncate">{mode.btg ? '🚨 긴급 열람' : '👤'} <strong>{mode.name}</strong> 님의 정보 열람 중 · 범위: {scopeStr}{mode.btg ? ' · 24h' : ''}</span>
      <button onClick={back} className="underline font-semibold whitespace-nowrap">본인으로 돌아가기</button>
    </div>
  );
}

