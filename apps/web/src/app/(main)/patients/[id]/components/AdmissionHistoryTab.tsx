'use client';

import { useQuery } from '@tanstack/react-query';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { apiClient } from '@/lib/api-client';
import { stayDays, ADMISSION_STATUS_LABEL } from '@hospital-run/shared';

import { EmptyState, Unit } from '@/components/ui/display';
import { T, useTAttr } from '@/components/ui/i18n-text';

// BE inpatient/patient/:id 응답은 raw Admission(@map). FE가 admissionDate/reason/flat ward 를 보던 필드명 오류로
// Invalid Date(raw format throw → 탭 크래시) + 병동칸 [object Object] 가 나던 것을 실제 응답(admitDate·admitReason·bed.ward) 기준으로 교정.
interface AdmissionRecord {
  id: string;
  patientId: string;
  admitDate: string;
  dischargeDate?: string | null;
  bed?: { roomNumber?: string; bedNumber?: string; ward?: { name?: string; floor?: number } } | null;
  admitReason?: string | null;
  status: 'ADMITTED' | 'DISCHARGED' | 'TRANSFERRED';
  admittingDoctor?: { familyName?: string; givenName?: string };
}

// 잘못된/누락 날짜에 raw format 이 throw 해 탭 전체가 크래시하던 것을 방지(Invalid Date → '-').
function fmtDate(d?: string | null): string {
  if (!d) return '-';
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return '-';
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

// 라벨은 정본(ADMISSION_STATUS_LABEL) 경유 — 색상만 로컬. 종전 전과/전동 드리프트(정본=전원) 근절.
const STATUS_STYLES: Record<string, { bg: string; text: string }> = {
  ADMITTED: { bg: 'bg-blue-100', text: 'text-blue-700' },
  DISCHARGED: { bg: 'bg-emerald-100', text: 'text-emerald-700' },
  TRANSFERRED: { bg: 'bg-amber-100', text: 'text-amber-700' },
};

// 재원일수는 입원료 청구와 같은 산식(shared stayDays) — 종전 date-fns floor 는 청구보다 하루 적게 보였다
const calcLos = (admitDate: string, dischargeDate?: string | null): number =>
  stayDays(admitDate, dischargeDate) ?? 1;

export function AdmissionHistoryTab({ patientId }: { patientId: string }) {
  const tAttr = useTAttr();
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['patient-admissions', patientId],
    queryFn: () => apiClient.get<{ data: AdmissionRecord[] }>(`/api/v1/inpatient/patient/${patientId}`),
    enabled: !!patientId,
  });

  const _raw = data?.data;
  const admissions: AdmissionRecord[] = Array.isArray(_raw)
    ? _raw
    : (_raw as Record<string, unknown> | undefined)?.data as AdmissionRecord[] ?? [];

  const totalCount = admissions.length;
  const currentlyAdmitted = admissions.some((a) => a.status === 'ADMITTED');

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-lg font-semibold text-gray-900"><T k="입퇴원 이력" /></h3>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-50 rounded-full">
            <span className="text-xs text-gray-500"><T k="총 입원" /></span>
            <span className="text-sm font-bold text-gray-900">{totalCount}<Unit>회</Unit></span>
          </div>
          <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full ${currentlyAdmitted ? 'bg-blue-50' : 'bg-gray-50'}`}>
            <span className={`w-2 h-2 rounded-full ${currentlyAdmitted ? 'bg-blue-500 animate-pulse' : 'bg-gray-300'}`} />
            <span className={`text-xs font-medium ${currentlyAdmitted ? 'text-blue-700' : 'text-gray-500'}`}>
              {currentlyAdmitted ? '현재 입원중' : '입원 없음'}
            </span>
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => <div key={i} className="h-16 bg-gray-100 rounded-xl animate-pulse" />)}
        </div>
      ) : isError ? (
        /* 🔴 조회 실패를 "없습니다"로 그리지 않는다 — import 만 있고 렌더가 없던 자리(2026-09-02) */
        <QueryErrorFallback error={error} onRetry={() => refetch()} />
      ) : admissions.length === 0 ? (
        <EmptyState icon="🛏️" title="입퇴원 기록이 없습니다" />
      ) : (
        <div className="border border-gray-100 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 whitespace-nowrap"><T k="상태" /></th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 whitespace-nowrap"><T k="입원일" /></th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 whitespace-nowrap"><T k="퇴원일" /></th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 whitespace-nowrap"><T k="병동" /></th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 whitespace-nowrap"><T k="사유" /></th>
                  <th className="px-4 py-2 text-center text-xs font-medium text-gray-500 whitespace-nowrap"><T k="재원일수" /></th>
                  <th className="px-4 py-2 text-center text-xs font-medium text-gray-500 whitespace-nowrap"><T k="바로가기" /></th>
                </tr>
              </thead>
              <tbody>
                {admissions.map((a) => {
                  const style = STATUS_STYLES[a.status] ?? { bg: 'bg-gray-100', text: 'text-gray-600' };
                  const los = calcLos(a.admitDate, a.dischargeDate);
                  const bedLabel = [a.bed?.roomNumber, a.bed?.bedNumber].filter(Boolean).join('-');
                  const wardDisplay = [a.bed?.ward?.name, bedLabel].filter(Boolean).join(' / ') || '-';
                  return (
                    <tr key={a.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                      <td className="px-4 py-2">
                        <span className={`inline-flex px-2 py-0.5 text-[11px] font-medium rounded-full whitespace-nowrap ${style.bg} ${style.text}`}>
                          {ADMISSION_STATUS_LABEL[a.status] ?? a.status}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-gray-700 whitespace-nowrap">
                        {fmtDate(a.admitDate)}
                      </td>
                      <td className="px-4 py-2 text-gray-700 whitespace-nowrap">
                        {fmtDate(a.dischargeDate)}
                      </td>
                      <td className="px-4 py-2 text-gray-700 whitespace-nowrap">{wardDisplay}</td>
                      <td className="px-4 py-2 text-gray-600 max-w-[200px] truncate">{a.admitReason || '-'}</td>
                      <td className="px-4 py-2 text-center font-mono text-gray-900">{los}<Unit>일</Unit></td>
                      <td className="px-4 py-2 text-center">
                        <div className="flex items-center justify-center gap-2">
                          <button className="text-[11px] text-blue-600 hover:text-blue-800 font-medium whitespace-nowrap">
                            <T k="퇴원요약" />
                          </button>
                          <span className="text-gray-200">|</span>
                          <button className="text-[11px] text-blue-600 hover:text-blue-800 font-medium whitespace-nowrap">
                            <T k="간호기록" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
