'use client';

import { LabTerm } from '@/components/ui/lab-term';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';
import { useAuthStore } from '@/stores/auth-store';
import { PatientName, StaffName, EmptyState, Unit, KDate } from '@/components/ui/display';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { pollMs } from '@/lib/ui-settings';
import { isAbnormalFlag, isJudgedFlag, LAB_FLAG_UNJUDGED_TEXT, LAB_FLAG_UNJUDGED_HINT } from '@hospital-run/shared';
import { T, useTAttr } from '@/components/ui/i18n-text';

/**
 * 검사 결과 검증 대기 워크리스트 — 2026-08-03 신설.
 *
 * 🔴 verify EP(독립 이중검증·원자 전이·정정 재검증)는 처음부터 있었는데 **여기로 오는 목록·화면이
 *    없어** 검증 단계가 사실상 미운영이었다(운영 실측 COMPLETED 256 vs VERIFIED 2).
 *    COMPLETED 는 예비 결과다 — 검증 없이 소비되면 이중검증 규정(독립 검증)이 장식이 된다.
 *
 * 규칙(서버가 강제·화면은 안내):
 *  - 결과 입력자 본인은 검증 불가 → 버튼 비활성 + 사유 표시(눌러서 403 보게 하지 않는다)
 *  - 정정(amend)된 결과는 재검증 대상 → '정정' 배지로 구분
 */
type PendingRow = {
  id: string;
  orderId: string;
  patient: { id: string; familyName: string; givenName: string; mrn: string };
  technician: { id: string; familyName: string; givenName: string };
  completedAt: string | null;
  notes: string | null;
  items: { testName: string; value: string; unit: string; flag: string | null; normalMin: string | null; normalMax: string | null }[];
  abnormalCount: number;
  amended: boolean;
};

export default function VerifyTab() {
  const tAttr = useTAttr();
  const qc = useQueryClient();
  const { user } = useAuthStore();
  const [openId, setOpenId] = useState<string | null>(null);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['lab-pending-verification'],
    queryFn: () => apiClient.get<{ data: PendingRow[] }>('/api/v1/lab/results/pending-verification'),
    refetchInterval: pollMs('normal'),
  });
  const rows = data?.data ?? [];

  const verifyMut = useMutation({
    mutationFn: (orderId: string) => apiClient.patch(`/api/v1/lab/result/${orderId}/verify`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['lab-pending-verification'] });
      toast.success('검증·확정되었습니다.');
    },
    onError: (e) => toast.error((e as { message?: string })?.message || '검증 실패'),
  });

  if (isError) return <QueryErrorFallback error={error} onRetry={refetch} />;
  if (isLoading) return <div className="p-8 text-center text-sm text-gray-400"><T k="불러오는 중…" /></div>;
  if (!rows.length) return <EmptyState icon="✅" title="검증 대기 중인 결과가 없습니다." hint="결과 입력이 완료되면 여기서 독립 검증을 진행합니다." />;

  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-500">
        {/* 🔴 키는 한 줄 단위로 쪼갠다 — 여러 줄에 걸치면 개행+들여쓰기가 키에 섞여
            카탈로그와 영원히 매칭되지 않는다(2026-09-09 P3 라운드 4 정규화).
            HTML 공백 병합으로 렌더 결과(한국어)는 종전과 글자 단위로 같다. */}
        <T k="입력 완료된 예비 결과" /> <b className="text-gray-800">{rows.length}</b>
        <T k="건 — 오래된 순." />{' '}
        <T k="결과 입력자 본인은 검증할 수 없습니다(독립 이중검증)." />
      </p>

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 text-[11px] text-gray-400 text-left">
              <th className="px-4 py-2 font-medium"><T k="환자" /></th>
              <th className="px-3 py-2 font-medium"><T k="항목" /></th>
              <th className="px-3 py-2 font-medium"><T k="이상치" /></th>
              <th className="px-3 py-2 font-medium"><T k="입력자" /></th>
              <th className="px-3 py-2 font-medium"><T k="완료 시각" /></th>
              <th className="px-3 py-2 font-medium text-right"><T k="검증" /></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const isSelf = r.technician.id === user?.id;
              const open = openId === r.id;
              return [
                <tr key={r.id} onClick={() => setOpenId(open ? null : r.id)}
                  className="border-b border-gray-50 hover:bg-gray-50/60 cursor-pointer">
                  <td className="px-4 py-2.5">
                    <PatientName familyName={r.patient.familyName} givenName={r.patient.givenName} mrn={r.patient.mrn} />
                    {r.amended && <span className="ml-1.5 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-violet-50 text-violet-700" title={tAttr('정정된 결과 — 재검증 대상')}><T k="정정" /></span>}
                  </td>
                  <td className="px-3 py-2.5 text-gray-600">{r.items.length}<Unit><T k="건" /></Unit></td>
                  <td className="px-3 py-2.5">
                    {r.abnormalCount > 0
                      ? <span className="text-rose-600 font-semibold">{r.abnormalCount}<Unit><T k="건" /></Unit></span>
                      : <span className="text-gray-300">-</span>}
                  </td>
                  <td className="px-3 py-2.5"><StaffName familyName={r.technician.familyName} givenName={r.technician.givenName} className="text-gray-600" /></td>
                  <td className="px-3 py-2.5 text-[11px] text-gray-500"><KDate value={r.completedAt} mode="datetime" unknown="UNRECORDED" /></td>
                  <td className="px-3 py-2.5 text-right">
                    <button
                      onClick={(e) => { e.stopPropagation(); verifyMut.mutate(r.orderId); }}
                      disabled={isSelf || verifyMut.isPending}
                      title={tAttr(isSelf ? '결과 입력자 본인은 검증할 수 없습니다(독립 검증)' : '검증·확정')}
                      className={`px-3 py-1.5 text-xs font-semibold rounded-lg ${isSelf
                        ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                        : 'bg-emerald-600 text-white hover:bg-emerald-700'}`}
                    >
                      <T k={isSelf ? '본인 입력' : '검증·확정'} />
                    </button>
                  </td>
                </tr>,
                open && (
                  <tr key={`${r.id}-detail`} className="border-b border-gray-50 bg-gray-50/40">
                    <td colSpan={6} className="px-6 py-3">
                      <div className="grid gap-1">
                        {r.items.map((it, i) => (
                          <div key={i} className="flex items-center gap-3 text-xs">
                            <span className="w-44 truncate text-gray-600"><LabTerm name={it.testName} /></span>
                            <span className={`font-semibold tabular-nums ${isAbnormalFlag(it.flag) ? 'text-rose-600' : 'text-gray-800'}`}>{it.value} {it.unit}</span>
                            {(it.normalMin || it.normalMax) && <span className="text-gray-400">참고 {it.normalMin ?? ''}–{it.normalMax ?? ''}</span>}
                            {isAbnormalFlag(it.flag) && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-rose-50 text-rose-700">{it.flag}</span>}
                            {/* 🔴 미판정(flag null)은 정상과 다른 사실이다 — 기준치가 없어 서버가 판정하지 않은 것을
                                   화면이 'N' 과 똑같이 비워 두면 검증자가 정상으로 읽는다. 초록도 빨강도 아닌 색으로 말한다. */}
                            {!isJudgedFlag(it.flag) && (
                              <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200" title={tAttr(LAB_FLAG_UNJUDGED_HINT)}>
                                <T k={LAB_FLAG_UNJUDGED_TEXT} />
                              </span>
                            )}
                          </div>
                        ))}
                        {r.notes && <p className="mt-1 text-[11px] text-gray-500">비고: {r.notes}</p>}
                      </div>
                    </td>
                  </tr>
                ),
              ];
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
