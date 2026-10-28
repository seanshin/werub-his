'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { apiClient } from '@/lib/api-client';
import { kdate } from '@/lib/ui-settings';
import { T } from '@/components/ui/i18n-text';

const ORDER_STATUS_LABEL: Record<string, string> = {
  PENDING: '대기', CROSSMATCHED: '교차완료', ISSUED: '출고', IN_PROGRESS: '수혈 중',
  COMPLETED: '완료', CANCELLED: '취소', REACTION: '부작용',
};
const ORDER_STATUS_COLOR: Record<string, string> = {
  PENDING: 'bg-yellow-100 text-yellow-700', CROSSMATCHED: 'bg-blue-100 text-blue-700',
  ISSUED: 'bg-indigo-100 text-indigo-700', IN_PROGRESS: 'bg-emerald-100 text-emerald-700',
  COMPLETED: 'bg-gray-100 text-gray-600', CANCELLED: 'bg-gray-100 text-gray-400',
  REACTION: 'bg-red-100 text-red-700',
};
const PRODUCT_TYPE_LABEL: Record<string, string> = {
  PRBC: '농축적혈구', PC: '혈소판', FFP: '신선동결혈장', CRYO: '동결침전', WB: '전혈',
};
const CROSSMATCH_RESULT_LABEL: Record<string, string> = { COMPATIBLE: '적합', INCOMPATIBLE: '부적합', PENDING: '대기중' };
const CROSSMATCH_RESULT_COLOR: Record<string, string> = {
  COMPATIBLE: 'bg-emerald-100 text-emerald-700', INCOMPATIBLE: 'bg-red-100 text-red-700',
  PENDING: 'bg-yellow-100 text-yellow-700',
};
const REACTION_SEVERITY_COLOR: Record<string, string> = {
  MILD: 'bg-yellow-100 text-yellow-700', MODERATE: 'bg-orange-100 text-orange-700',
  SEVERE: 'bg-red-100 text-red-700', LIFE_THREATENING: 'bg-red-200 text-red-900',
};

type BloodBankSubTab = 'orders' | 'reactions';

interface BloodBankTabProps {
  patientId: string;
}

export function BloodBankTab({ patientId }: BloodBankTabProps) {
  const [tab, setTab] = useState<BloodBankSubTab>('orders');

  const { data: ordersData, isLoading: ordersLoading, isError, error, refetch } = useQuery({
    queryKey: ['blood-bank-orders', patientId],
    queryFn: () => apiClient.get<{ data: Record<string, unknown>[] }>(`/api/v1/blood-bank/orders`, { patientId }),
    enabled: !!patientId,
  });

  const orders: Record<string, unknown>[] = (() => { const r = ordersData?.data; return Array.isArray(r) ? r : (r as Record<string, unknown> | undefined)?.data as Record<string, unknown>[] ?? []; })();

  // Extract reactions from orders that have them
  const reactions = orders.filter((o) => {
    const transfusion = o.transfusion as Record<string, unknown> | undefined;
    return transfusion?.reactionType || transfusion?.reactionSeverity || o.status === 'REACTION';
  });

  const LoadingRows = ({ cols }: { cols: number }) => (
    <>{Array.from({ length: 5 }).map((_, i) => <tr key={i}><td colSpan={cols} className="px-4 py-3"><div className="h-4 bg-gray-100 rounded animate-pulse" /></td></tr>)}</>
  );

  // Derive patient blood type from orders if available
  const patientBloodType = orders.length > 0
    ? (orders[0].patientBloodType ?? orders[0].bloodType) as string | undefined
    : undefined;

  if (isError) return <QueryErrorFallback error={error} onRetry={refetch} size="compact" />;
  return (
    <div>
      {/* Summary */}
      <div className="grid grid-cols-3 gap-3 mb-5">
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
          <p className="text-[10px] text-gray-500 mb-1"><T k="혈액형" /></p>
          <p className="text-xl font-bold text-gray-900">{patientBloodType ?? '-'}</p>
        </div>
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
          <p className="text-[10px] text-gray-500 mb-1"><T k="수혈 횟수" /></p>
          <p className="text-xl font-bold text-gray-900">{orders.filter(o => o.status === 'COMPLETED').length}</p>
        </div>
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
          <p className="text-[10px] text-gray-500 mb-1"><T k="부작용" /></p>
          <p className={`text-xl font-bold ${reactions.length > 0 ? 'text-red-600' : 'text-gray-900'}`}>{reactions.length}</p>
        </div>
      </div>

      <div className="flex gap-1 mb-5 bg-gray-100/80 p-1 rounded-xl w-fit">
        {([
          { key: 'orders' as BloodBankSubTab, label: '수혈 이력' },
          { key: 'reactions' as BloodBankSubTab, label: '부작용 기록' },
        ]).map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition-all ${tab === t.key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>{t.label}</button>
        ))}
      </div>

      {/* 수혈 이력 */}
      {tab === 'orders' && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-gray-100 bg-gray-50/50">
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="날짜" /></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">혈액제제</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="단위" /></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="교차시험" /></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="상태" /></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="처방의" /></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="사유" /></th>
            </tr></thead>
            <tbody>
              {ordersLoading ? <LoadingRows cols={7} />
              : orders.length === 0 ? <tr><td colSpan={7} className="py-12 text-center text-gray-400"><T k="수혈 이력 없음" /></td></tr>
              : orders.map((o) => {
                const status = (o.status as string) ?? '';
                const doc = o.orderer as Record<string, unknown> | undefined ?? o.orderedBy as Record<string, unknown> | undefined ?? o.prescriber as Record<string, unknown> | undefined;
                const crossmatch = o.crossmatch as Record<string, unknown> | undefined;
                const crossResult = (crossmatch?.result as string) ?? (o.crossmatchResult as string);
                const productType = (o.productType ?? o.bloodProductType) as string ?? '';
                return (
                  <tr key={o.id as string} className="border-b border-gray-50 hover:bg-gray-50/50">
                    <td className="px-4 py-3 text-xs text-gray-700">{(o.orderedAt ?? o.createdAt) ? kdate(((o.orderedAt ?? o.createdAt) as string)) : '-'}</td>
                    <td className="px-4 py-3"><span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 whitespace-nowrap">{(PRODUCT_TYPE_LABEL[productType] ?? productType) || '-'}</span></td>
                    <td className="px-4 py-3 text-xs font-bold text-gray-900">{(o.units ?? o.quantity ?? 1) as number}</td>
                    <td className="px-4 py-3">
                      {crossResult
                        ? <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${CROSSMATCH_RESULT_COLOR[crossResult] ?? 'bg-gray-100'}`}>{CROSSMATCH_RESULT_LABEL[crossResult] ?? crossResult}</span>
                        : <span className="text-xs text-gray-400">-</span>
                      }
                    </td>
                    <td className="px-4 py-3"><span className={`text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${ORDER_STATUS_COLOR[status] ?? 'bg-gray-100'}`}>{(ORDER_STATUS_LABEL[status] ?? status) || '-'}</span></td>
                    <td className="px-4 py-3 text-xs text-gray-700">{doc ? `${(doc.familyName as string) ?? ''}${(doc.givenName as string) ?? ''}` : '-'}</td>
                    <td className="px-4 py-3 text-xs text-gray-400 max-w-[120px] truncate">{(o.indication ?? o.reason ?? o.notes) as string ?? '-'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* 부작용 기록 */}
      {tab === 'reactions' && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-gray-100 bg-gray-50/50">
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="날짜" /></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">혈액제제</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">반응유형</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="중증도" /></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="증상" /></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="조치" /></th>
            </tr></thead>
            <tbody>
              {ordersLoading ? <LoadingRows cols={6} />
              : reactions.length === 0 ? <tr><td colSpan={6} className="py-12 text-center text-gray-400"><T k="부작용 기록 없음" /></td></tr>
              : reactions.map((o) => {
                const transfusion = (o.transfusion as Record<string, unknown>) ?? o;
                const severity = (transfusion.reactionSeverity as string) ?? '';
                const productType = (o.productType ?? o.bloodProductType) as string ?? '';
                return (
                  <tr key={o.id as string} className="border-b border-gray-50 hover:bg-gray-50/50">
                    <td className="px-4 py-3 text-xs text-gray-700">{(transfusion.reactionAt ?? o.createdAt) ? kdate(((transfusion.reactionAt ?? o.createdAt) as string)) : '-'}</td>
                    <td className="px-4 py-3"><span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 whitespace-nowrap">{(PRODUCT_TYPE_LABEL[productType] ?? productType) || '-'}</span></td>
                    <td className="px-4 py-3 text-xs font-medium text-gray-900">{(transfusion.reactionType as string) ?? '-'}</td>
                    <td className="px-4 py-3"><span className={`text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${REACTION_SEVERITY_COLOR[severity] ?? 'bg-gray-100'}`}>{severity || '-'}</span></td>
                    <td className="px-4 py-3 text-xs text-gray-700 max-w-[150px] truncate">{(transfusion.symptoms as string) ?? '-'}</td>
                    <td className="px-4 py-3 text-xs text-gray-700 max-w-[150px] truncate">{(transfusion.management ?? transfusion.action) as string ?? '-'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
