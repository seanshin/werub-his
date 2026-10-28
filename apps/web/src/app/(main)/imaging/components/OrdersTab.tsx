'use client';

import { T, Tf, useTAttr } from '@/components/ui/i18n-text';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';
import { pollMs } from '@/lib/ui-settings';

interface ImagingOrder {
  id: string;
  status: string;
  prescription?: {
    procedureCode?: { nameKo?: string };
    encounter?: {
      patient?: {
        familyName?: string;
        givenName?: string;
        mrn?: string;
      };
    };
  };
}

export function OrdersTab() {
  const tAttr = useTAttr();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['imaging-orders'],
    queryFn: () => apiClient.get<{ data: ImagingOrder[] | { data: ImagingOrder[] } }>('/api/v1/orders', { department: 'IMAGING', limit: 50 }),
    refetchInterval: pollMs('fast'),
  });
  // 🔴 촬영 완료 = ORDERED→IN_PROGRESS(판독 대기). 종전엔 COMPLETED 로 보내 서버 전이표
  //    (ORDERED→COMPLETED 금지)에 걸려 **버튼이 100% 실패**했고, '판독 대기'로 가는 경로가
  //    화면에 없어 판독 대기 카운트는 구조적으로 영구 0이었다(2026-08-13 실측 8건 전부 ORDERED).
  const acquire = useMutation({
    mutationFn: (orderId: string) => apiClient.patch<{ data: ImagingOrder }>(`/api/v1/orders/${orderId}/status`, { status: 'IN_PROGRESS' }),
    onSuccess: () => {
      toast.success(tAttr('촬영 완료 — 판독 대기로 이동했습니다.'));
      qc.invalidateQueries({ queryKey: ['imaging-orders'] });
    },
    onError: () => toast.error(tAttr('촬영 완료 처리 실패')),
  });
  const completeReading = useMutation({
    mutationFn: (orderId: string) => apiClient.patch<{ data: ImagingOrder }>(`/api/v1/orders/${orderId}/status`, { status: 'COMPLETED' }),
    onSuccess: () => {
      toast.success(tAttr('판독 완료 처리되었습니다.'));
      qc.invalidateQueries({ queryKey: ['imaging-orders'] });
    },
    onError: () => toast.error(tAttr('판독 완료 처리 실패')),
  });

  const openPacs = (mrn?: string) => {
    const token = sessionStorage.getItem('accessToken');
    const params = new URLSearchParams();
    if (mrn) params.set('PatientID', mrn);
    if (token) params.set('token', token);
    const qs = params.toString();
    window.open(`/pacs-admin${qs ? '?' + qs : ''}`, '_blank');
  };

  const _ordersRaw = data?.data;
  const orders: ImagingOrder[] = Array.isArray(_ordersRaw) ? _ordersRaw : (_ordersRaw as { data: ImagingOrder[] })?.data ?? [];
  const pendingCount = orders.filter((o: ImagingOrder) => o.status === 'ORDERED').length;
  const readingCount = orders.filter((o: ImagingOrder) => o.status === 'IN_PROGRESS').length;
  // 버킷 합=전체 — 종전엔 완료·취소가 어느 버킷에도 없어 '촬영 8 · 판독 0 · 전체 12'로 4건이 실종(P3)
  const doneCount = orders.filter((o: ImagingOrder) => o.status === 'COMPLETED').length;
  const cancelledCount = orders.filter((o: ImagingOrder) => o.status === 'CANCELLED').length;

  return (
    <>
      <div className="flex gap-3 mb-4">
        <span className="text-xs font-medium px-3 py-1.5 rounded-lg bg-amber-50 text-amber-700">
          <Tf k="촬영 대기 {수}" params={{ 수: pendingCount }} />
        </span>
        <span className="text-xs font-medium px-3 py-1.5 rounded-lg bg-violet-50 text-violet-700">
          <Tf k="판독 대기 {수}" params={{ 수: readingCount }} />
        </span>
        <span className="text-xs font-medium px-3 py-1.5 rounded-lg bg-emerald-50 text-emerald-700">
          <Tf k="완료 {수}" params={{ 수: doneCount }} />
        </span>
        {cancelledCount > 0 && (
          <span className="text-xs font-medium px-3 py-1.5 rounded-lg bg-gray-100 text-gray-500">
            <Tf k="취소 {수}" params={{ 수: cancelledCount }} />
          </span>
        )}
        <span className="text-xs font-medium px-3 py-1.5 rounded-lg bg-gray-50 text-gray-600">
          <Tf k="전체 {수}" params={{ 수: orders.length }} />
        </span>
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        {isLoading ? (
          <div className="p-5 space-y-4">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-14 bg-gray-100 rounded-lg animate-pulse" />
            ))}
          </div>
        ) : !orders.length ? (
          <div className="p-12 text-center">
            <svg className="w-12 h-12 mx-auto text-gray-200 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169" />
            </svg>
            <p className="text-sm text-gray-400"><T k="대기 중인 영상이 없습니다." /></p>
          </div>
        ) : (
          <div className="divide-y divide-gray-50">
            {orders.map((order: ImagingOrder) => (
              <div key={order.id} className="p-4 flex items-center justify-between hover:bg-blue-50/30 transition-colors">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-violet-50 flex items-center justify-center">
                    <svg className="w-4.5 h-4.5 text-violet-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z" />
                    </svg>
                  </div>
                  <div>
                    <p className="font-medium text-sm text-gray-900">{order.prescription?.procedureCode?.nameKo}</p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {order.prescription?.encounter?.patient?.familyName}{order.prescription?.encounter?.patient?.givenName}
                      {order.prescription?.encounter?.patient?.mrn && ` (${order.prescription.encounter.patient.mrn})`}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {order.prescription?.encounter?.patient?.mrn && (
                    <button
                      onClick={() => openPacs(order.prescription?.encounter?.patient?.mrn)}
                      className="px-2.5 py-1.5 bg-gray-50 text-gray-600 rounded-xl text-xs font-medium hover:bg-gray-100 transition-colors"
                      title={tAttr('Orthanc에서 영상 관리')}
                    >
                      PACS
                    </button>
                  )}
                  {order.status === 'ORDERED' && (
                    <button
                      onClick={() => acquire.mutate(order.id)}
                      className="px-3.5 py-1.5 bg-blue-600 text-white rounded-xl text-xs font-medium hover:bg-blue-700 transition-colors"
                    >
                      <T k="촬영 완료" />
                    </button>
                  )}
                  {order.status === 'IN_PROGRESS' && (
                    <>
                      <span className="text-[11px] font-medium px-2.5 py-1 rounded-full bg-amber-50 text-amber-700"><T k="판독 대기" /></span>
                      <button
                        onClick={() => completeReading.mutate(order.id)}
                        className="px-3.5 py-1.5 bg-emerald-600 text-white rounded-xl text-xs font-medium hover:bg-emerald-700 transition-colors"
                      >
                        <T k="판독 완료" />
                      </button>
                    </>
                  )}
                  {order.status === 'COMPLETED' && (
                    <span className="text-[11px] font-medium px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700"><T k="완료" /></span>
                  )}
                  {order.status === 'CANCELLED' && (
                    <span className="text-[11px] font-medium px-2.5 py-1 rounded-full bg-gray-100 text-gray-500"><T k="취소@상태" /></span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
