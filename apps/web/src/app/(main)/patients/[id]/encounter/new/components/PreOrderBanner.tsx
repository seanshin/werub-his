'use client';

import { useState } from 'react';
import { Unit } from '@/components/ui/display';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';
import { MutationError } from '@hospital-run/shared';
import { T } from '@/components/ui/i18n-text';

interface PreOrderItem {
  id: string;
  type: string;
  priority?: string;
  dosage?: string;
  frequency?: string;
  duration?: string;
  reason?: string;
  medicationCode?: { nameKo?: string };
  procedureCode?: { nameKo?: string };
}

export function PreOrderBanner({ patientId, encounterId }: { patientId: string; encounterId: string }) {
  const [showPanel, setShowPanel] = useState(false);
  const { data: preOrderData, refetch } = useQuery({
    queryKey: ['pre-orders-patient', patientId],
    queryFn: () => apiClient.get<{ data: PreOrderItem[] }>(`/api/v1/pre-orders/patient/${patientId}`),
    enabled: !!patientId,
  });

  const _preOrderRaw = preOrderData?.data;
  const pending: PreOrderItem[] = Array.isArray(_preOrderRaw) ? _preOrderRaw : (_preOrderRaw as unknown as Record<string, unknown>)?.data as PreOrderItem[] ?? [];

  const handleApprove = async (id: string) => {
    try {
      const res = await apiClient.patch<{ data?: { data?: { durCheck?: { status?: string } }; durCheck?: { status?: string } } }>(`/api/v1/pre-orders/${id}/approve`, { encounterId });
      toast.success('Pre-Order 승인 → 처방 생성 완료');
      // 🔴 (2026-09-15 T2) 승인 시점 DUR 재검증이 실패하면 서버는 막지 않고 FAILED 로 기록한다 —
      //    "경고 없음"으로 보이지 않게 비차단 경고로 드러낸다(처방 durChecked=false·감사 PreOrderDurRecheck).
      const durStatus = res?.data?.data?.durCheck?.status ?? res?.data?.durCheck?.status;
      if (durStatus === 'FAILED') {
        toast.warning('DUR 재검증을 하지 못한 채 승인되었습니다 — 처방 화면에서 DUR 을 다시 확인하세요');
      }
      refetch();
    } catch (err: unknown) {
      const msg = (err as MutationError)?.message;
      toast.error(msg || 'Pre-Order 승인 실패');
    }
  };

  const handleCancel = async (id: string) => {
    try {
      await apiClient.patch(`/api/v1/pre-orders/${id}/cancel`);
      refetch();
    } catch {}
  };

  if (pending.length === 0) return null;

  return (
    <>
      <button onClick={() => setShowPanel(!showPanel)}
        className="px-3 py-1.5 text-xs font-medium rounded-lg flex items-center gap-1.5 bg-amber-100 text-amber-700 hover:bg-amber-200 relative">
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
        Pre-Order
        <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center">{pending.length}</span>
      </button>
      {showPanel && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-4">
          <h4 className="text-sm font-bold text-amber-900 mb-2">미결 사전 오더 ({pending.length}<Unit>건</Unit>)</h4>
          <div className="space-y-2 max-h-48 overflow-y-auto">
            {pending.map((po: PreOrderItem) => (
              <div key={po.id} className="bg-white rounded-lg px-3 py-2">
                <div className="flex items-center justify-between">
                  <div>
                    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${
                      po.type === 'MEDICATION' ? 'bg-blue-100 text-blue-700' :
                      po.type === 'LAB' ? 'bg-purple-100 text-purple-700' : 'bg-teal-100 text-teal-700'
                    }`}>{po.type === 'MEDICATION' ? '약' : po.type === 'LAB' ? '검사' : '영상'}</span>
                    <span className="text-xs font-medium text-gray-900 ml-2">
                      {po.medicationCode?.nameKo ?? po.procedureCode?.nameKo ?? '미지정'}
                    </span>
                    {po.priority === 'STAT' && <span className="text-[9px] bg-red-600 text-white px-1 rounded ml-1">STAT</span>}
                  </div>
                  <div className="flex gap-1">
                    <button onClick={() => handleApprove(po.id)} className="px-2 py-1 text-[10px] bg-emerald-600 text-white rounded hover:bg-emerald-700"><T k="승인" /></button>
                    <button onClick={() => handleCancel(po.id)} className="px-2 py-1 text-[10px] bg-gray-200 text-gray-600 rounded hover:bg-gray-300"><T k="취소" /></button>
                  </div>
                </div>
                {po.dosage && <p className="text-[10px] text-gray-500 mt-1 ml-8">{po.dosage} / {po.frequency} / {po.duration}<Unit>일</Unit></p>}
                {po.reason && <p className="text-[10px] text-amber-600 mt-0.5 ml-8">사유: {po.reason}</p>}
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
