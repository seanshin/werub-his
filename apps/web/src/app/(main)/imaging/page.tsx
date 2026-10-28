'use client';

import { useState } from 'react';
import { T } from '@/components/ui/i18n-text';
import { PacsHealthBadge } from './components/PacsHealthBadge';
import { OrdersTab } from './components/OrdersTab';
import { StudiesTab } from './components/StudiesTab';
import { ReportsTab } from './components/ReportsTab';
import { StatsTab } from './components/StatsTab';

type TabKey = 'orders' | 'studies' | 'reports' | 'stats';

function getPacsSsoUrl(basePath: string, params?: Record<string, string>) {
  const token = typeof window !== 'undefined' ? sessionStorage.getItem('accessToken') : null;
  const qs = new URLSearchParams(params);
  if (token) qs.set('token', token);
  const qsStr = qs.toString();
  return qsStr ? `${basePath}?${qsStr}` : basePath;
}

export default function ImagingPage() {
  const [tab, setTab] = useState<TabKey>('orders');

  return (
    <div className="max-w-5xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold text-gray-900"><T k="영상실" /></h2>
          <p className="text-sm text-gray-500 mt-1"><T k="영상 촬영, Study 목록, 판독 현황" /></p>
        </div>
        <div className="flex gap-2">
          <PacsHealthBadge />
          <button
            onClick={() => window.open(getPacsSsoUrl('/pacs-admin'), '_blank')}
            className="inline-flex items-center gap-2 px-4 py-2 bg-violet-600 text-white rounded-xl text-sm font-medium hover:bg-violet-700 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0z" />
            </svg>
            PACS
          </button>
        </div>
      </div>

      <div className="flex gap-2 mb-6">
        {([
          { key: 'orders' as const, label: '촬영 대기' },
          { key: 'studies' as const, label: 'Study 목록' },
          { key: 'reports' as const, label: '판독' },
          { key: 'stats' as const, label: '통계' },
        ]).map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm font-medium rounded-full transition-colors ${
              tab === t.key ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            <T k={t.label} />
          </button>
        ))}
      </div>

      {tab === 'orders' && <OrdersTab />}
      {tab === 'studies' && <StudiesTab />}
      {tab === 'reports' && <ReportsTab />}
      {tab === 'stats' && <StatsTab />}
    </div>
  );
}
