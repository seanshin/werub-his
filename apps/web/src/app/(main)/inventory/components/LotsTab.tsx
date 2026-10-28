'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { Lot, statusBadge, Th, Td, EmptyRow, Btn, Card } from './shared-ui';
import { kdate } from '@/lib/ui-settings';
import { T } from '@/components/ui/i18n-text';

export function LotsTab() {
  const qc = useQueryClient();
  /**
   * 🔴 종전에는 `?expiring=true`(30일 내 만료) 로 **고정**되어 있었다. 실제 LOT 5건은 모두
   * 만료가 한참 남아 있어 이 탭은 **늘 "LOT 정보가 없습니다"** 였고, 재고가 5건 있는데도
   * 화면은 없다고 말했다. 폐기처리 버튼도 어느 LOT 에서도 누를 수 없었다.
   */
  const [onlyExpiring, setOnlyExpiring] = useState(false);
  const [showDisposed, setShowDisposed] = useState(false);
  const query = `?${onlyExpiring ? 'expiring=true&' : ''}status=${showDisposed ? 'ALL' : 'ACTIVE'}`;
  const { data, isLoading } = useQuery({
    queryKey: ['inventory-lots', onlyExpiring, showDisposed],
    queryFn: () => apiClient.get<{ data: Lot[] }>(`/api/v1/inventory/lots${query}`),
  });
  const update = useMutation({ mutationFn: ({ id, status }: { id: string; status: string }) => apiClient.patch(`/api/v1/inventory/lots/${id}`, { status }), onSuccess: () => qc.invalidateQueries({ queryKey: ['inventory-lots'] }) });
  const _lotsRaw = data?.data;
  const lots: Lot[] = Array.isArray(_lotsRaw) ? _lotsRaw : (_lotsRaw as unknown as { data?: Lot[] })?.data ?? [];
  const expiryColor = (d: string) => {
    const days = Math.ceil((new Date(d).getTime() - Date.now()) / 86400000);
    if (days < 0) return 'text-rose-700 font-semibold';
    if (days < 7) return 'text-rose-600 font-semibold';
    if (days < 30) return 'text-amber-600 font-medium';
    return 'text-gray-700';
  };
  const expiryBg = (d: string) => {
    const days = Math.ceil((new Date(d).getTime() - Date.now()) / 86400000);
    if (days < 7) return 'bg-rose-50/40';
    if (days < 30) return 'bg-amber-50/40';
    return '';
  };
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-4 text-xs text-gray-500">
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-rose-200 inline-block" /><T k="7일 미만" /></span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-amber-200 inline-block" /><T k="30일 미만" /></span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-gray-100 inline-block" /><T k="정상" /></span>
        <label className="ml-auto flex items-center gap-1.5 cursor-pointer">
          <input type="checkbox" checked={onlyExpiring} onChange={(e) => setOnlyExpiring(e.target.checked)} />
          <T k="30일 내 만료만" />
        </label>
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input type="checkbox" checked={showDisposed} onChange={(e) => setShowDisposed(e.target.checked)} />
          <T k="폐기분 포함" />
        </label>
      </div>
      <Card>
        <table className="w-full text-sm">
          <thead className="border-b border-gray-100 bg-gray-50/50">
            <tr><Th><T k="LOT 번호" /></Th><Th><T k="품목명" /></Th><Th right><T k="수량" /></Th><Th><T k="유효기간" /></Th><Th><T k="상태" /></Th><Th><T k="변경" /></Th></tr>
          </thead>
          <tbody>
            {isLoading ? <EmptyRow cols={6} msg="로딩 중..." /> : !lots.length ? <EmptyRow cols={6} msg={onlyExpiring ? '30일 내 만료 예정 LOT 이 없습니다.' : 'LOT 정보가 없습니다.'} /> : lots.map(l => (
              <tr key={l.id} className={`border-b border-gray-50 hover:bg-blue-50/30 transition-colors ${expiryBg(l.expiryDate)}`}>
                <Td mono>{l.lotNumber}</Td><Td>{l.itemName}</Td>
                <Td right>{l.quantity?.toLocaleString()}</Td>
                <td className={`px-4 py-3 text-sm ${expiryColor(l.expiryDate)}`}>{kdate(new Date(l.expiryDate))}</td>
                <td className="px-4 py-3">{statusBadge(l.status)}</td>
                <td className="px-4 py-3">
                  {l.status !== 'EXPIRED' && (
                    <Btn sm variant="ghost" onClick={() => update.mutate({ id: l.id, status: 'EXPIRED' })}><T k="폐기처리" /></Btn>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
