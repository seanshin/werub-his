'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { apiClient } from '@/lib/api-client';
import { T } from '@/components/ui/i18n-text';

interface DashboardData {
  stats: { campaignCount: number; checkupTargets: number; foreignCases: number; churnRisk: number };
  recentCampaigns: { id: string; name: string; type: string; channel: string; status: string; sentCount: number; deliveredCount: number; createdAt: string }[];
  segmentStats: { id: string; name: string; type: string; patientCount: number }[];
}

const sections = [
  {
    title: '검진 CRM',
    color: 'from-blue-500 to-indigo-600',
    items: [
      { label: '검진 대상자 관리', href: '/crm/checkup/targets', icon: '🎯', desc: '국가검진/직장/재검/VIP/해외 대상자' },
      { label: '이상 소견 추적', href: '/crm/checkup/follow-ups', icon: '📋', desc: '검진 이상 소견 추적 관리 (D+7~D+60)' },
      { label: '프로그램 실적', href: '/crm/checkup/analytics', icon: '📊', desc: '프로그램별 예약/완료/매출 분석' },
    ],
  },
  {
    title: '해외환자 CRM',
    color: 'from-emerald-500 to-teal-600',
    items: [
      { label: '케이스 관리', href: '/crm/international/cases', icon: '🌏', desc: '해외환자 유치~사후관리 전체 추적' },
      { label: '에이전시 관리', href: '/crm/international/agencies', icon: '🤝', desc: '의료관광 에이전시 계약/실적' },
      { label: '해외환자 실적', href: '/crm/international/analytics', icon: '📈', desc: '국적별/패키지별/에이전시별 분석' },
    ],
  },
  {
    title: '캠페인',
    color: 'from-violet-500 to-purple-600',
    items: [
      { label: '캠페인 관리', href: '/crm/campaigns', icon: '📢', desc: '멀티채널 캠페인 생성/발송/분석' },
      { label: '템플릿', href: '/crm/templates', icon: '📝', desc: 'SMS/Push/포털/이메일 템플릿' },
      { label: '세그먼트', href: '/crm/segments', icon: '👥', desc: 'RFM 분석 + 조건 기반 환자 분류' },
    ],
  },
  {
    title: '상담/대행',
    color: 'from-amber-500 to-orange-600',
    items: [
      { label: 'CRM 상담', href: '/crm/consultation', icon: '📞', desc: '환자 검색 + 예약 대행 + 소통 이력' },
      { label: '소통 이력', href: '/crm/communications', icon: '💬', desc: '전체 채널 커뮤니케이션 로그' },
      { label: '자동화 설정', href: '/crm/automation', icon: '⚙️', desc: '리마인더/이탈감지 Cron 설정' },
    ],
  },
];

export default function CrmDashboardPage() {
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);

  useEffect(() => {
    apiClient.fetch<{ data: DashboardData }>('/api/v1/crm/dashboard')
      .then(r => setDashboard(r.data))
      .catch(() => {});
  }, []);

  const stats = dashboard?.stats;

  return (
    <div className="p-6 space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">CRM</h1>
        <p className="text-gray-500 mt-1"><T k="환자 관계 관리 — 검진, 해외환자, 캠페인, 상담" /></p>
      </div>

      {/* 통계 카드 */}
      <div className="grid grid-cols-4 gap-4">
        {[
          // 라벨은 서버 집계의 실제 의미와 1:1 — checkupTargets 는 '미완료 이상소견 추적' 카운트다(2026-08-04 교정)
          { label: '이번 달 캠페인', value: stats?.campaignCount ?? '-', color: 'text-violet-700', bg: 'bg-violet-50', href: '/crm/campaigns' },
          { label: '이상소견 추적 미완', value: stats?.checkupTargets ?? '-', color: 'text-blue-700', bg: 'bg-blue-50', href: '/crm/checkup/follow-ups' },
          { label: '해외환자 케이스(진행)', value: stats?.foreignCases ?? '-', color: 'text-emerald-700', bg: 'bg-emerald-50', href: '/crm/international/cases' },
          { label: '이탈 위험(HIGH)', value: stats?.churnRisk ?? '-', color: 'text-red-700', bg: 'bg-red-50', href: '/crm/segments' },
        ].map(s => (
          // KPI 는 해당 워크리스트로 통한다 — 숫자만 보여주고 끝나는 카드 방지
          <Link key={s.label} href={s.href} className={`${s.bg} rounded-2xl border border-gray-100 p-5 text-center hover:shadow-sm transition-shadow`}>
            <p className={`text-3xl font-bold ${s.color}`}>{s.value}</p>
            <p className="text-xs text-gray-500 mt-1"><T k={s.label} /></p>
          </Link>
        ))}
      </div>

      {/* 최근 캠페인 */}
      {dashboard?.recentCampaigns && dashboard.recentCampaigns.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <h2 className="text-sm font-bold text-gray-700 mb-3"><T k="최근 캠페인" /></h2>
          <div className="space-y-2">
            {dashboard.recentCampaigns.map(c => (
              <div key={c.id} className="flex items-center justify-between text-sm p-2 rounded-lg hover:bg-gray-50">
                <div className="flex items-center gap-3">
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap bg-violet-100 text-violet-700">{c.type}</span>
                  <span className="text-gray-900 font-medium">{c.name}</span>
                </div>
                <div className="flex items-center gap-4 text-xs text-gray-500">
                  <span>{c.channel}</span>
                  <span>발송 {c.sentCount}</span>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap bg-gray-100">{c.status}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 섹션 카드 */}
      <div className="grid grid-cols-2 gap-6">
        {sections.map(section => (
          <div key={section.title} className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
            <div className={`bg-gradient-to-r ${section.color} px-6 py-4`}>
              <h2 className="text-lg font-bold text-white"><T k={section.title} /></h2>
            </div>
            <div className="p-4 space-y-2">
              {section.items.map(item => (
                <Link key={item.href} href={item.href}
                  className="flex items-center gap-3 p-3 rounded-xl hover:bg-gray-50 transition-colors group">
                  <span className="text-2xl">{item.icon}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-900 group-hover:text-blue-600"><T k={item.label} /></p>
                    <p className="text-xs text-gray-400 truncate"><T k={item.desc} /></p>
                  </div>
                  <svg className="w-4 h-4 text-gray-300 group-hover:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </Link>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* 🔴 (2026-09-14 G12 실측) CRM 시드 계정 안내 카드를 지웠다 — 조건 없이 그려져 REAL 번들에 시드 계정 4개가 남았고,
          적힌 비밀번호도 정본(`lib/test-accounts` TEST_PASSWORD)과 달랐다. 시드 계정 안내는 로그인 화면 TestAccountPanel(빌드 상한 분기) 하나뿐이다. */}
    </div>
  );
}
