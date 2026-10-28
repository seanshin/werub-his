'use client';

import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { T, Tf } from '@/components/ui/i18n-text';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { EmptyState, KDate, PatientName, StaffName } from '@/components/ui/display';

/** 서버 계약 — `GET /api/v1/pharmacy/dur-overrides` (pharmacy.service `getDurOverrides`) */
export interface DurOverrideItem {
  prescriptionId: string;
  status: string;
  drugName: string | null;
  drugCode: string | null;
  patient: { id: string; familyName: string | null; givenName: string | null; mrn: string | null } | null;
  /** 무시 사유 원문 — 비어 있으면 null(사유 미기록이라는 사실) */
  reason: string | null;
  overriddenBy: string | null;
  overriddenByName: string | null;
  overriddenByRole: string | null;
  overriddenAt: string | null;
  prescriberId: string;
  prescriberName: string | null;
}

interface DurOverrideResponse {
  data: DurOverrideItem[];
  meta: { truncated: boolean; limit: number; windowDays: number; scope: 'MINE' | 'ALL' };
}

/**
 * DUR 경고 무시(오버라이드) 기록 — **읽기 전용** 검토 목록.
 *
 * 🔴 무시 사유는 처방 행에 남기만 하고 아무 화면도 모아 보여주지 않았다(QI 가 건수만 셌다).
 *    약사·관리자는 전건, 의사는 서버가 자기 처방으로 좁힌다(scope=MINE) — 화면은 범위를 그대로 말한다.
 *    조회 실패는 "기록 없음"이 아니다 — 실패로 그린다.
 */
export default function DurOverrideList() {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['pharmacy-dur-overrides'],
    queryFn: () => apiClient.get<DurOverrideResponse>('/api/v1/pharmacy/dur-overrides'),
  });

  if (isError) return <QueryErrorFallback error={error} onRetry={refetch} />;
  if (isLoading || !data) return <div className="py-8 text-center text-gray-400 text-sm"><T k="로딩 중..." /></div>;

  const items = Array.isArray(data.data) ? data.data : [];
  const days = data.meta?.windowDays ?? 30;

  return (
    <div className="space-y-3" data-dur-override-list>
      <p className="text-xs text-gray-500">
        <Tf k="최근 {일}일 DUR 경고 무시 기록 · 읽기 전용" params={{ 일: days }} /> · <T k={data.meta?.scope === 'MINE' ? '내가 책임 처방의인 처방만 보입니다' : '전체 처방의 기록입니다'} />
      </p>
      {data.meta?.truncated && (
        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          <Tf k="최근 {건}건만 표시했습니다 — 기록이 더 있습니다" params={{ 건: data.meta.limit }} />
        </p>
      )}
      {items.length === 0 ? (
        <EmptyState icon="✅" title={<Tf k="최근 {일}일 DUR 경고 무시 기록이 없습니다" params={{ 일: days }} />} className="bg-white rounded-2xl border" />
      ) : (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-x-auto">
          <table className="w-full text-sm min-w-[820px]">
            <thead><tr className="border-b border-gray-100 bg-gray-50/50">
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 w-[110px]"><T k="무시 시각" /></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="환자" /></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="처방약" /></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="무시 사유" /></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="무시한 사람" /></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="책임 처방의" /></th>
            </tr></thead>
            <tbody>
              {items.map((r) => (
                <tr key={r.prescriptionId} className="border-b border-gray-50" data-dur-override-row>
                  <td className="px-4 py-3 text-[11px] text-gray-500"><KDate value={r.overriddenAt} mode="datetime" unknown="UNRECORDED" /></td>
                  <td className="px-4 py-3 text-xs text-gray-900">
                    {r.patient ? <PatientName familyName={r.patient.familyName} givenName={r.patient.givenName} mrn={r.patient.mrn} /> : <span className="text-gray-400"><T k="이름 미상" /></span>}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-700">{r.drugName ?? <span className="text-gray-400"><T k="미기재" /></span>}</td>
                  <td className="px-4 py-3 text-xs text-gray-700 max-w-[260px]">
                    {/* 사유가 없으면 그 사실을 말한다 — 빈칸은 "사유를 읽었다"로 보인다 */}
                    {r.reason ?? <span className="text-red-600 font-medium"><T k="사유 미기록" /></span>}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-700"><StaffName name={r.overriddenByName} /></td>
                  <td className="px-4 py-3 text-xs text-gray-700"><StaffName name={r.prescriberName} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
