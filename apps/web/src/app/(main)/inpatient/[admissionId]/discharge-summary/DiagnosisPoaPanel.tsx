'use client';

/**
 * 진단별 입원 시 존재(POA · 2026-10-09) — 입원 기간 진료 진단마다 하나.
 * 🔴 필수 여부는 결정 safety.poaFlag(의무기록위원회)가 정한다 — 필수가 아니면 비어도 서명되고, 그 사실을 말한다.
 * 🔴 선택은 비어 있는 채로 시작한다(값을 미리 채우지 않는다) · PSI 는 이것만으로 산출되지 않는다.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { POA_LABEL, POA_VALUES, type PoaValue } from '@hospital-run/shared';
import { apiClient } from '@/lib/api-client';
import { extractErrorMessage } from '@/lib/error-utils';
import { toast } from '@/stores/toast-store';
import { useHasRole } from '@/hooks/use-admin-write';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { T, Tf, useTAttr } from '@/components/ui/i18n-text';

interface PoaList { required: boolean; items: { code: string; name: string | null; poa: PoaValue | null }[]; missing: string[] }

export function DiagnosisPoaPanel({ admissionId, readOnly }: { admissionId: string; readOnly: boolean }) {
  const tAttr = useTAttr();
  const qc = useQueryClient();
  // 서버 @Roles(DOCTOR·MEDICAL_RECORDS·ADMIN) 와 같은 판정(쓰기) · 조회는 간호사까지
  const canWrite = useHasRole('DOCTOR', 'MEDICAL_RECORDS');
  const canView = useHasRole('DOCTOR', 'MEDICAL_RECORDS', 'NURSE');
  const key = ['discharge-poa', admissionId];
  const q = useQuery({
    enabled: canView,
    queryKey: key,
    queryFn: () => apiClient.get<{ data: PoaList }>(`/api/v1/admissions/${admissionId}/discharge-summary/poa`).then((r) => r.data),
  });
  const save = useMutation({
    mutationFn: (p: { diagnosisCode: string; poa: string }) => {
      if (!canWrite) return Promise.reject(new Error(tAttr('POA 는 의사·의무기록사가 기록합니다')));
      return apiClient.put(`/api/v1/admissions/${admissionId}/discharge-summary/poa`, p);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
    onError: (e) => toast.error(extractErrorMessage(e) || tAttr('POA 를 저장하지 못했습니다.')),
  });
  if (!canView) return null;
  if (q.isError) return <QueryErrorFallback error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data;
  if (!d) return <div className="h-10 animate-pulse rounded-lg bg-gray-100" />;
  return (
    <section className="rounded-xl border border-gray-100 p-3" data-discharge-poa={admissionId} data-required={d.required ? 'yes' : 'no'}>
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <p className="text-sm font-semibold text-gray-800"><T k="진단별 입원 시 존재(POA)" /></p>
        <span className={`rounded px-1.5 text-[10px] ${d.required ? 'bg-rose-50 text-rose-700' : 'bg-gray-100 text-gray-500'}`}>
          <T k={d.required ? '서명 전 필수(위원회 결정)' : '필수 아님 — 비어도 서명됩니다'} />
        </span>
        {d.missing.length > 0 && <span className="text-[11px] text-amber-700"><Tf k="미기록 {n}건" params={{ n: d.missing.length }} /></span>}
      </div>
      {d.items.length === 0 ? (
        <p className="text-xs text-gray-400" data-discharge-poa-empty><T k="입원 기간 진료 진단이 없습니다." /></p>
      ) : (
        <ul className="space-y-1 text-xs">
          {d.items.map((it) => (
            <li key={it.code} className="flex flex-wrap items-center gap-2" data-poa-item={it.code}>
              <span className="font-mono text-gray-700">{it.code}</span>
              <span className="min-w-0 flex-1 truncate text-gray-600">{it.name ?? ''}</span>
              {readOnly || !canWrite ? (
                <span className={it.poa ? 'text-gray-700' : 'text-amber-700'}>{it.poa ? <T k={POA_LABEL[it.poa]} /> : <T k="미기록" />}</span>
              ) : (
                <select value={it.poa ?? ''} disabled={save.isPending} aria-label={tAttr('입원 시 존재')}
                  onChange={(e) => e.target.value && save.mutate({ diagnosisCode: it.code, poa: e.target.value })}
                  className="rounded-lg border border-gray-200 px-2 py-1" data-poa-select={it.code}>
                  <option value="">{tAttr('선택')}</option>
                  {POA_VALUES.map((v) => <option key={v} value={v}>{tAttr(POA_LABEL[v])}</option>)}
                </select>
              )}
            </li>
          ))}
        </ul>
      )}
      <p className="mt-1 text-[10px] text-gray-400"><T k="환자안전지표(PSI) 산출에는 POA 외에 지표별 코드셋·제외 기준 등재가 더 필요합니다." /></p>
    </section>
  );
}
