'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { ItemsTab } from './components/ItemsTab';
import { TransactionsTab } from './components/TransactionsTab';
import { StoragesTab } from './components/StoragesTab';
import { SuppliersTab } from './components/SuppliersTab';
import { PurchaseOrdersTab } from './components/PurchaseOrdersTab';
import { ReceivingTab } from './components/ReceivingTab';
import { RequestsTab } from './components/RequestsTab';
import { LotsTab } from './components/LotsTab';
import { RepackTab } from './components/RepackTab';
import { QrTab } from './components/QrTab';
import { CountsTab } from './components/CountsTab';
import { ReportsTab } from './components/ReportsTab';
import { T, Tf } from '@/components/ui/i18n-text';

const TABS = [
  { id: 'items', label: '품목관리' },
  { id: 'transactions', label: '입출고' },
  { id: 'storages', label: '보관장소' },
  { id: 'suppliers', label: '거래처' },
  { id: 'pos', label: '발주관리' },
  { id: 'receiving', label: '입고검수' },
  { id: 'requests', label: '부서불출' },
  { id: 'lots', label: 'LOT/유효기간' },
  { id: 'repack', label: '재포장/키트' },
  { id: 'qr', label: 'QR코드' },
  { id: 'counts', label: '실사관리' },
  { id: 'reports', label: '리포트' },
] as const;

type TabId = typeof TABS[number]['id'];

export default function InventoryPage() {
  const [activeTab, setActiveTab] = useState<TabId>('items');
  const { data: alertData, isError, error, refetch } = useQuery({ queryKey: ['inventory-alerts'], queryFn: () => apiClient.get<{ data: { id: string; type: string; message: string }[] }>('/api/v1/inventory/alerts') });
  const _alertsRaw = alertData?.data;
  const alerts = Array.isArray(_alertsRaw) ? _alertsRaw : (_alertsRaw as unknown as { data?: { id: string; type: string; message: string }[] })?.data ?? [];

  if (isError) return <QueryErrorFallback error={error} onRetry={refetch} />;

  return (
    <div>
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900"><T k="자재/재고 관리" /></h2>
          <p className="text-sm text-gray-500 mt-1"><T k="입출고, 발주, LOT 유효기간 통합 관리" /></p>
        </div>
        {alerts.length > 0 && (
          <div className="flex items-center gap-2 bg-rose-50 border border-rose-100 rounded-xl px-4 py-2">
            <span className="text-rose-600 text-sm font-medium"><Tf k="경고 {건수}건" params={{ 건수: alerts.length }} /></span>
          </div>
        )}
      </div>
      <div className="flex gap-1 border-b border-gray-100 mb-6 overflow-x-auto">
        {TABS.map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2.5 text-sm font-medium whitespace-nowrap transition-colors border-b-2 -mb-px ${activeTab === tab.id ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-800'}`}>
            <T k={tab.label} />
          </button>
        ))}
      </div>
      {activeTab === 'items' && <ItemsTab />}
      {activeTab === 'transactions' && <TransactionsTab />}
      {activeTab === 'storages' && <StoragesTab />}
      {activeTab === 'suppliers' && <SuppliersTab />}
      {activeTab === 'pos' && <PurchaseOrdersTab />}
      {activeTab === 'receiving' && <ReceivingTab />}
      {activeTab === 'requests' && <RequestsTab />}
      {activeTab === 'lots' && <LotsTab />}
      {activeTab === 'repack' && <RepackTab />}
      {activeTab === 'qr' && <QrTab />}
      {activeTab === 'counts' && <CountsTab />}
      {activeTab === 'reports' && <ReportsTab />}
    </div>
  );
}
