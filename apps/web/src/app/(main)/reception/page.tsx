'use client';

import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { T } from '@/components/ui/i18n-text';
import { AppointmentTab } from './components/AppointmentTab';
import { WalkInTab } from './components/WalkInTab';
import { QueueTab } from './components/QueueTab';
import { NewPatientTab, type NewPatientPrefill } from './components/NewPatientTab';
import { ReceptionSideRail } from './components/ReceptionSideRail';
import { ErArrivalBanner } from './components/ErArrivalBanner';
import { UnappliedSignaturesCard } from '@/components/consent/RegistrationConsentCollector';

const VALID_TABS = ['appointment', 'walkin', 'newpatient', 'queue'] as const;
type RecTab = typeof VALID_TABS[number];

export default function ReceptionPage() {
  const sp = useSearchParams();
  const initial = (VALID_TABS as readonly string[]).includes(sp.get('tab') ?? '') ? (sp.get('tab') as RecTab) : 'walkin';
  const [tab, setTab] = useState<RecTab>(initial);
  const [npPrefill, setNpPrefill] = useState<NewPatientPrefill | null>(null);

  const goNewPatient = (prefill: NewPatientPrefill) => { setNpPrefill(prefill); setTab('newpatient'); };

  return (
    // 본문은 폭 상한 없이 flex-1 로 우측 여백을 전부 흡수(탭 내부가 2컬럼 분할이라 넓을수록 이득),
    // 초광폭(1600px+)에선 맨 오른쪽에 참조 레일 — flex 형제라 겹침이 없다
    <div className="flex gap-4" style={{ height: 'calc(100vh - 120px)' }}>
    <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
      <div className="mb-4 flex-shrink-0">
        <h2 className="text-2xl font-bold text-gray-900"><T k="접수 데스크" /></h2>
        <p className="text-sm text-gray-500 mt-1"><T k="예약 접수, 당일 접수, 대기 현황을 관리합니다." /></p>
      </div>

      {/* 응급 원무 통합 운영(er.reception.separated=false) 시에만 — 응급 도착 알림(D10) */}
      <ErArrivalBanner />
      {/* 초진 동의 — 서명은 됐는데 원장에 없는 환자(0건이면 그리지 않는다) */}
      <div className="mb-3 empty:hidden"><UnappliedSignaturesCard /></div>


      <div className="flex gap-1 mb-4 bg-gray-100 rounded-xl p-1 w-fit flex-shrink-0">
        {[
          { key: 'appointment' as const, label: '예약 접수' },
          { key: 'walkin' as const, label: '당일 접수' },
          { key: 'newpatient' as const, label: '신규 환자 등록' },
          { key: 'queue' as const, label: '대기 현황' },
        ].map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-5 py-2 rounded-lg text-sm font-medium transition-all ${
              tab === t.key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            <T k={t.label} />
          </button>
        ))}
      </div>

      <div className="flex-1 min-h-0">
        {tab === 'appointment' && <AppointmentTab />}
        {tab === 'walkin' && <WalkInTab onNewPatient={goNewPatient} />}
        {tab === 'newpatient' && <NewPatientTab onGoCheckIn={() => { setNpPrefill(null); setTab('walkin'); }} initial={npPrefill} />}
        {tab === 'queue' && <QueueTab />}
      </div>
    </div>
    <ReceptionSideRail onGoTab={setTab} />
    </div>
  );
}
