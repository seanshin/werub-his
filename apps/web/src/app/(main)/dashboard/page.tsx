'use client';

import { useState } from 'react';
import { CloudSun, Moon, Pencil, Sun } from 'lucide-react';
import { kdate } from '@/lib/ui-settings';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { useAuthStore } from '@/stores/auth-store';
import { USER_ROLE_LABEL } from '@hospital-run/shared';
import Link from 'next/link';
import DashboardShell from './components/DashboardShell';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { T, useTAttr } from '@/components/ui/i18n-text';
import { useDashboardStore } from './stores/dashboard-store';
import { DashboardRoleLine } from './components/DashboardRoleLine';

export default function DashboardPage() {
  const tt = useTAttr();
  const { user } = useAuthStore();
  const isEditing = useDashboardStore((st) => st.isEditing);
  const startEditing = useDashboardStore((st) => st.startEditing);

  const { data: hrData, isError, error, refetch } = useQuery({
    queryKey: ['hr-me'],
    queryFn: () => apiClient.get<{ data: { department?: string; specialty?: string } | null }>('/api/v1/hr/me'),
    retry: false,
  });
  const hrProfile = hrData?.data;

  if (isError) return <QueryErrorFallback error={error} onRetry={refetch} />;

  const now = new Date();
  const h = now.getHours();
  const greeting = h < 12 ? '좋은 아침입니다' : h < 18 ? '좋은 오후입니다' : '수고하셨습니다';
  const TimeIcon = h < 12 ? Sun : h < 18 ? CloudSun : Moon;
  const initial = (user?.familyName || user?.givenName || '?').charAt(0);

  return (
    /* 위젯이 폭에 따라 열 수를 늘리므로(widget-size) 상한을 두지 않는다 — 넓을수록 한 행에 더 들어간다 */
    <main aria-label={tt('대시보드')}>
      {/* Hero 헤더 — 인사·날짜·소속 + 역할·편집(편집 버튼이 격자 위에 따로 떠 있던 줄을 없앤다 · 2026-09-29) */}
      <div className="relative mb-4 overflow-hidden rounded-2xl bg-gradient-to-br from-slate-900 via-slate-800 to-indigo-900 px-5 py-4 text-white shadow-[0_8px_24px_-12px_rgba(30,41,59,0.55)] sm:px-6 sm:py-5">
        <div className="pointer-events-none absolute -right-10 -top-16 h-52 w-52 rounded-full bg-indigo-400/10 blur-2xl" aria-hidden="true" />
        <div className="pointer-events-none absolute right-24 -bottom-12 h-32 w-32 rounded-full bg-sky-300/10 blur-2xl" aria-hidden="true" />
        <div className="relative flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-4">
            <span className="grid h-12 w-12 flex-shrink-0 place-items-center rounded-2xl bg-white/10 text-lg font-bold ring-1 ring-white/15 sm:h-14 sm:w-14 sm:text-xl">
              {initial}
            </span>
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 text-[12px] font-medium text-white/60">
                <TimeIcon className="h-3.5 w-3.5 text-amber-200/90" aria-hidden />
                <T k={greeting} />
              </p>
              <h2 className="truncate text-lg font-bold tracking-tight sm:text-xl">{user?.familyName}{user?.givenName}</h2>
              <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-white/60">
                <span>{kdate(now, 'dateWeekday')}</span>
                {hrProfile?.department && <span className="before:mr-2 before:content-['·']">{hrProfile.department}{hrProfile.specialty ? ` (${hrProfile.specialty})` : ''}</span>}
              </p>
              {/* 🔴 (2026-10-02) 이 화면이 무엇을 답하는지 — 내 업무 · 역할 판정은 부품 안에(페이지에 두면 역할 스캐너가 형제 조회까지 게이트로 본다) */}
              <DashboardRoleLine role={user?.role} />
            </div>
          </div>
          <div className="flex flex-shrink-0 items-center gap-2">
            {user?.role && (
              <span className="hidden rounded-full bg-white/10 px-3 py-1 text-[11px] font-semibold ring-1 ring-white/15 sm:inline-flex">
                {USER_ROLE_LABEL[user.role] ?? user.role}
              </span>
            )}
            {!isEditing && (
              <button type="button" onClick={startEditing} data-dashboard-edit
                className="inline-flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-1.5 text-[12px] font-medium text-white/90 ring-1 ring-white/15 transition hover:bg-white/20">
                <Pencil className="h-3.5 w-3.5" aria-hidden />
                <T k="대시보드 편집" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* 전자인증서 온보딩 배너 */}
      <CertOnboardBanner />

      {/* 위젯 그리드 시스템 */}
      <DashboardShell />
    </main>
  );
}

/** 전자 인증서 조회 역할 — 서버 `blockchain-cert.controller` `GET my` 의 @Roles 와 같다(가드가 소스로 대조 · page.tsx 는 임의 export 불가) */
const CERT_ROLES = ['DOCTOR', 'NURSE', 'ADMIN', 'PHARMACIST'] as const;

function CertOnboardBanner() {
  const tt = useTAttr();
  const [dismissed, setDismissed] = useState(false);
  // 🔴 (2026-10-03) 종전엔 모든 역할이 대시보드를 열 때마다 불러 서명 권한 없는 9역할이 늘 403 이었다(배너는 숨어서 보이지 않았다)
  const role = useAuthStore((s) => s.user?.role);
  const canCert = !!role && (CERT_ROLES as readonly string[]).includes(role);
  const { data: certData, isError: certIsError } = useQuery({
    queryKey: ['my-blockchain-cert'],
    queryFn: () => apiClient.get<{ data: Array<{ id: string; status: string }> }>('/api/v1/blockchain-cert/my'),
    staleTime: 60000,
    enabled: canCert,
  });

  const certs = Array.isArray(certData?.data) ? certData.data : (certData?.data as unknown as Record<string, unknown>)?.data as Array<{ id: string; status: string }> ?? [];
  const hasActiveCert = certs.some(c => c.status === 'ACTIVE');

  // 🔴 조회 실패를 "인증서 없음"으로 단정하지 않는다 — 이미 발급받은 사용자에게 설정하라고 말하게 된다.
  //    (권유 배너라 에러 표시를 띄우는 대신 단정 자체를 하지 않는다)
  if (!canCert || certIsError || hasActiveCert || dismissed) return null;

  return (
    <div role="status" aria-live="polite" className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-2xl p-4 mb-4 flex items-center justify-between shadow-sm">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 bg-blue-100 rounded-xl flex items-center justify-center flex-shrink-0" aria-hidden="true">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/images/cert/icons/cert-active.svg" alt="" width={40} height={40} />
        </div>
        <div>
          <p className="text-sm font-bold text-gray-900"><T k="전자 인증서를 설정하세요" /></p>
          <p className="text-xs text-gray-500"><T k="의료 문서에 법적 효력이 있는 블록체인 전자서명을 사용할 수 있습니다." /></p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Link href="/settings/my-certificate" className="px-4 py-2 bg-blue-600 text-white text-xs font-bold rounded-lg hover:bg-blue-700 whitespace-nowrap">
          <T k="지금 설정하기" />
        </Link>
        <button onClick={() => setDismissed(true)} aria-label={tt('전자 인증서 배너 닫기')} className="p-1.5 text-gray-500 hover:text-gray-600">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
        </button>
      </div>
    </div>
  );
}
