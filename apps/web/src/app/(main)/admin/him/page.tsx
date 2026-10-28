'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { pollMs, kdate } from '@/lib/ui-settings';
import { T, Tf, useTAttr, useTfAttr } from '@/components/ui/i18n-text';

interface Deficiency {
  type: 'DISCHARGE_SUMMARY' | 'UNSIGNED_ENCOUNTER' | 'UNSIGNED_NURSING_NOTE' | 'MISSING_DIAGNOSIS';
  refId: string;
  patient: { mrn: string; name: string };
  responsibleName: string;
  since: string;
  overdueDays: number;
  detail: string;
  responsibleId?: string | null;
  /** 미서명 진료기록만 — 작성자가 활성 의사인가(아니면 독촉·회수 알림을 받을 사람이 없다) */
  authorIsDoctor?: boolean;
  prescribers?: Array<{ id: string; name: string | null }>;
  empty?: boolean;
}
interface DeficiencyReport {
  items: Deficiency[];
  counts: { total: number; overdue: number; byType: Record<string, number> };
  policy: { summaryDueDays: number; encounterDueDays: number; noteDueDays: number; lookbackDays: number };
}

const TYPE_META: Record<string, { label: string; cls: string }> = {
  DISCHARGE_SUMMARY: { label: '퇴원요약', cls: 'bg-rose-100 text-rose-700' },
  UNSIGNED_ENCOUNTER: { label: '진료기록', cls: 'bg-amber-100 text-amber-700' },
  UNSIGNED_NURSING_NOTE: { label: '간호기록', cls: 'bg-blue-100 text-blue-700' },
  // 서명은 끝났는데 상병이 없는 건 — 청구 삭감·반려로 이어진다(DRAFT 미비와 성격이 달라 별도 표시)
  MISSING_DIAGNOSIS: { label: '상병 미입력', cls: 'bg-purple-100 text-purple-700' },
};

export default function HimDeficiencyPage() {
  const tAttr = useTAttr();
  const tfAttr = useTfAttr();
  const qc = useQueryClient();
  const [overdueOnly, setOverdueOnly] = useState(false);
  // 2026-10-10 작성자가 의사가 아닌 미서명 진료 — 알림 대상이 없어 아무도 모르는 채 남는다
  const [noDoctorOnly, setNoDoctorOnly] = useState(false);
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['him-deficiencies', overdueOnly],
    queryFn: () => apiClient.get<{ data: DeficiencyReport }>(`/api/v1/admin/him/deficiencies?overdue=${overdueOnly}`).then(r => {
      const raw = r.data as unknown as { data?: DeficiencyReport };
      return raw?.data ?? (r.data as unknown as DeficiencyReport);
    }),
    refetchInterval: pollMs('slow'),
  });
  const remind = useMutation({
    mutationFn: () => apiClient.post<{ data: { notified: number; deficiencies: number } }>('/api/v1/admin/him/deficiencies/remind'),
    onSuccess: (r) => {
      const raw = r.data as unknown as { data?: { notified: number } };
      const n = raw?.data?.notified ?? (r.data as unknown as { notified?: number })?.notified ?? 0;
      toast.success(tfAttr('책임자 {수}명에게 독촉 알림 발송', { 수: n }));
      qc.invalidateQueries({ queryKey: ['him-deficiencies'] });
    },
    onError: (e) => toast.error((e as { message?: string })?.message || tAttr('독촉 실패')),
  });

  if (isError) return <QueryErrorFallback error={error} onRetry={refetch} />;

  return (
    <div className="max-w-5xl space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900"><T k="미비기록 관리 (HIM)" /></h1>
          <p className="text-sm text-gray-500 mt-1">
            <T k="퇴원요약·미서명 진료/간호기록의 완결도 점검" />
            {data?.policy && <>{' — '}<Tf
              k="기한: 퇴원요약 {퇴원요약}일 · 진료 {진료}일 · 간호 {간호}일 (조회 {조회}일)"
              params={{ 퇴원요약: data.policy.summaryDueDays, 진료: data.policy.encounterDueDays, 간호: data.policy.noteDueDays, 조회: data.policy.lookbackDays }} /></>}
          </p>
        </div>
        <button onClick={() => remind.mutate()} disabled={remind.isPending || (data?.counts.overdue ?? 0) === 0}
          className="px-3 py-1.5 text-xs font-medium bg-rose-600 text-white rounded-lg hover:bg-rose-700 disabled:opacity-40">
          <T k="기한 초과 독촉 알림" />
        </button>
      </div>

      {data && (() => {
        const orphan = data.items.filter((d) => d.type === 'UNSIGNED_ENCOUNTER' && d.authorIsDoctor === false);
        if (!orphan.length) return null;
        return (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900" data-him-orphan-drafts={orphan.length}>
            <p className="font-semibold"><Tf k="작성자가 의사가 아닌 미서명 진료 {n}건 — 독촉·회수 알림을 받을 사람이 없습니다" params={{ n: orphan.length }} /></p>
            <p className="mt-1"><Tf k="처방이 달린 것 {a}건(처방의에게 확인) · 내용·진단·처방이 모두 빈 초안 {b}건" params={{ a: orphan.filter((d) => !!d.prescribers?.length).length, b: orphan.filter((d) => d.empty).length }} /></p>
            <p className="mt-1 text-amber-800"><T k="시스템은 서명을 대신하지 않습니다 — 서명·정리는 진료 책임자가 합니다." /></p>
          </div>
        );
      })()}

      {data && (
        <div className="flex flex-wrap gap-3">
          {[
            { label: '전체 미비', value: data.counts.total, tone: 'text-gray-900' },
            { label: '기한 초과', value: data.counts.overdue, tone: data.counts.overdue > 0 ? 'text-rose-600' : 'text-gray-900' },
            ...Object.entries(TYPE_META).map(([k, m]) => ({ label: m.label, value: data.counts.byType[k] ?? 0, tone: 'text-gray-700' })),
          ].map((c) => (
            <div key={c.label} className="flex items-baseline gap-2 bg-white rounded-xl border border-gray-100 shadow-sm px-4 py-2.5">
              <span className={`text-xl font-bold leading-none ${c.tone}`}>{c.value}</span>
              <span className="text-[11px] text-gray-400"><T k={c.label} /></span>
            </div>
          ))}
          <label className="ml-auto flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer">
            <input type="checkbox" checked={overdueOnly} onChange={(e) => setOverdueOnly(e.target.checked)} className="w-3.5 h-3.5 rounded" />
            <T k="기한 초과만" />
          </label>
          <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer">
            <input type="checkbox" checked={noDoctorOnly} onChange={(e) => setNoDoctorOnly(e.target.checked)} className="w-3.5 h-3.5 rounded" data-him-filter-no-doctor />
            <T k="작성자 의사 아님만" />
          </label>
        </div>
      )}

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50/50 text-xs text-gray-500 text-left">
              <th className="px-3 py-3"><T k="유형" /></th><th className="px-3 py-3"><T k="환자" /></th><th className="px-3 py-3"><T k="내용" /></th>
              <th className="px-3 py-3"><T k="책임자" /></th><th className="px-3 py-3"><T k="기준일" /></th><th className="px-3 py-3 text-right"><T k="경과" /></th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={6} className="py-12 text-center text-gray-400"><T k="불러오는 중…" /></td></tr>
            ) : !data?.items.length ? (
              <tr><td colSpan={6} className="py-12 text-center text-gray-400"><T k="미비기록이 없습니다 🎉" /></td></tr>
            ) : data.items.filter((d) => !noDoctorOnly || (d.type === 'UNSIGNED_ENCOUNTER' && d.authorIsDoctor === false)).map((d) => {
              const meta = TYPE_META[d.type];
              return (
                <tr key={`${d.type}-${d.refId}`} className={`border-b border-gray-50 ${d.overdueDays > 0 ? 'bg-rose-50/30' : ''}`}>
                  <td className="px-3 py-2.5"><span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${meta.cls}`}><T k={meta.label} /></span></td>
                  <td className="px-3 py-2.5 text-xs text-gray-800">{d.patient.name} <span className="text-gray-400">{d.patient.mrn}</span></td>
                  <td className="px-3 py-2.5 text-xs text-gray-600">{d.detail}</td>
                  <td className="px-3 py-2.5 text-xs text-gray-700">
                    {d.responsibleName}
                    {d.type === 'UNSIGNED_ENCOUNTER' && d.authorIsDoctor === false && (
                      <span className="ml-1 rounded bg-amber-100 px-1 py-0.5 text-[10px] text-amber-800" data-him-author-not-doctor={d.refId}><T k="작성자 의사 아님 · 알림 대상 없음" /></span>
                    )}
                    {d.empty && <span className="ml-1 rounded bg-gray-100 px-1 py-0.5 text-[10px] text-gray-600" data-him-empty-draft={d.refId}><T k="빈 초안" /></span>}
                    {!!d.prescribers?.length && (
                      <p className="mt-0.5 text-[10px] text-gray-500" data-him-prescribers={d.refId}>
                        <T k="처방의" />: {d.prescribers!.map((p) => p.name ?? '—').join(', ')}
                      </p>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-xs text-gray-400">{kdate(new Date(d.since))}</td>
                  <td className={`px-3 py-2.5 text-xs text-right font-medium ${d.overdueDays > 0 ? 'text-rose-600' : 'text-gray-400'}`}>
                    {d.overdueDays > 0
                      ? <Tf k="기한 +{일}일" params={{ 일: d.overdueDays }} />
                      : <Tf k="여유 {일}일" params={{ 일: -d.overdueDays }} />}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
