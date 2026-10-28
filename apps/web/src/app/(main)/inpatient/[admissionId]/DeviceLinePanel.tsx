'use client';

/**
 * 삽입 기구 원장(2026-10-09) — 중심정맥관·유치도뇨관·인공호흡기의 삽입·제거 시각.
 *
 * 🔴 감염률 분모(기구일수)가 될 수 있는 기록이다 — 결정 qi.deviceDays.source = DEVICE_LEDGER 일 때만 분모로 쓰인다.
 *    기록 자체는 결정과 무관한 임상 사실이라 받는다.
 * 🔴 쓰기 폼은 미선택으로 시작한다(기구 종류·시각을 미리 채우지 않는다) · 지우지 않고 무효(사유) · 제거는 한 번
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { QI_DEVICE_TYPES, QI_DEVICE_TYPE_LABEL, type QiDeviceType } from '@hospital-run/shared';
import { apiClient } from '@/lib/api-client';
import { extractErrorMessage } from '@/lib/error-utils';
import { toast } from '@/stores/toast-store';
import { useHasRole } from '@/hooks/use-admin-write';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { KDate } from '@/components/ui/display';
import { T, useTAttr } from '@/components/ui/i18n-text';

interface DeviceLine {
  id: string; deviceType: QiDeviceType; site: string | null; insertedAt: string; removedAt: string | null; note: string | null; voidedAt: string | null;
}

/** datetime-local 값 → ISO(로컬 시각으로 해석) */
const toIso = (v: string) => new Date(v).toISOString();

export function DeviceLinePanel({ admissionId, patientId }: { admissionId: string; patientId: string | null }) {
  const tAttr = useTAttr();
  const qc = useQueryClient();
  // 서버 @Roles(ADMIN·DOCTOR·NURSE) 와 같은 판정
  const canWrite = useHasRole('DOCTOR', 'NURSE');
  const [form, setForm] = useState({ deviceType: '' as QiDeviceType | '', site: '', insertedAt: '' });
  const [removing, setRemoving] = useState<{ id: string; at: string } | null>(null);
  const [voiding, setVoiding] = useState<{ id: string; reason: string } | null>(null);
  const key = ['device-lines', admissionId];
  const q = useQuery({
    enabled: canWrite,
    queryKey: key,
    queryFn: () => apiClient.get<{ data: DeviceLine[] }>(`/api/v1/quality-flow/device-lines?admissionId=${admissionId}`).then((r) => r.data ?? []),
  });
  const refresh = () => qc.invalidateQueries({ queryKey: key });
  const record = useMutation({
    mutationFn: () => {
      if (!canWrite) return Promise.reject(new Error(tAttr('기구 기록은 의사·간호사가 합니다.')));
      return apiClient.post('/api/v1/quality-flow/device-lines', {
        patientId, admissionId, deviceType: form.deviceType, insertedAt: toIso(form.insertedAt), ...(form.site.trim() ? { site: form.site.trim() } : {}),
      });
    },
    onSuccess: () => { toast.success(tAttr('기구 삽입을 기록했습니다.')); setForm({ deviceType: '', site: '', insertedAt: '' }); refresh(); },
    onError: (e) => toast.error(extractErrorMessage(e) || tAttr('기구 삽입을 기록하지 못했습니다.')),
  });
  const remove = useMutation({
    mutationFn: (p: { id: string; at: string }) => {
      if (!canWrite) return Promise.reject(new Error(tAttr('기구 기록은 의사·간호사가 합니다.')));
      return apiClient.patch(`/api/v1/quality-flow/device-lines/${p.id}/remove`, { removedAt: toIso(p.at) });
    },
    onSuccess: () => { toast.success(tAttr('기구 제거를 기록했습니다.')); setRemoving(null); refresh(); },
    onError: (e) => toast.error(extractErrorMessage(e) || tAttr('기구 제거를 기록하지 못했습니다.')),
  });
  const voidMut = useMutation({
    mutationFn: (p: { id: string; reason: string }) => {
      if (!canWrite) return Promise.reject(new Error(tAttr('기구 기록은 의사·간호사가 합니다.')));
      return apiClient.post(`/api/v1/quality-flow/device-lines/${p.id}/void`, { reason: p.reason });
    },
    onSuccess: () => { toast.success(tAttr('기구 기록을 무효 처리했습니다.')); setVoiding(null); refresh(); },
    onError: (e) => toast.error(extractErrorMessage(e) || tAttr('무효 처리하지 못했습니다.')),
  });
  if (!canWrite) return null;
  const rows = q.data ?? [];
  const input = 'rounded-lg border border-gray-200 px-2 py-1 text-xs';
  return (
    <section className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm" data-device-lines={admissionId}>
      <h3 className="mb-1 text-sm font-bold text-gray-900"><T k="삽입 기구" /></h3>
      <p className="mb-3 text-[11px] text-gray-500"><T k="중심정맥관·유치도뇨관·인공호흡기의 삽입·제거 시각 — 기구 관련 감염률의 분모(기구일수)가 될 수 있는 기록입니다." /></p>
      {q.isError ? <QueryErrorFallback error={q.error} onRetry={() => q.refetch()} />
        : !q.data ? <div className="h-10 animate-pulse rounded-lg bg-gray-100" />
          : rows.length === 0 ? <p className="text-xs text-gray-400" data-device-lines-empty><T k="기록된 삽입 기구가 없습니다." /></p>
            : (
              <ul className="space-y-1.5 text-xs">
                {rows.map((r) => (
                  <li key={r.id} className="rounded-lg border border-gray-100 px-2 py-1.5" data-device-line={r.id} data-active={r.removedAt ? 'no' : 'yes'}>
                    <div className="flex flex-wrap items-center gap-2">
                      <b><T k={QI_DEVICE_TYPE_LABEL[r.deviceType] ?? r.deviceType} /></b>
                      {r.site && <span className="text-gray-500">{r.site}</span>}
                      <span className="text-gray-500"><T k="삽입" /> <KDate value={r.insertedAt} mode="datetimeShort" /></span>
                      {r.removedAt
                        ? <span className="text-gray-500"><T k="제거" /> <KDate value={r.removedAt} mode="datetimeShort" /></span>
                        : <span className="rounded bg-sky-50 px-1.5 text-[10px] text-sky-700"><T k="유지 중" /></span>}
                      <span className="ml-auto flex gap-1">
                        {!r.removedAt && (
                          <button type="button" onClick={() => setRemoving(removing?.id === r.id ? null : { id: r.id, at: '' })} className="min-h-[36px] rounded border border-gray-300 px-2" data-device-line-remove={r.id}>
                            <T k="제거 기록" />
                          </button>
                        )}
                        <button type="button" onClick={() => setVoiding(voiding?.id === r.id ? null : { id: r.id, reason: '' })} className="min-h-[36px] rounded border border-gray-200 px-2 text-gray-500">
                          <T k="무효" />
                        </button>
                      </span>
                    </div>
                    {removing?.id === r.id && (
                      <div className="mt-1.5 flex flex-wrap items-center gap-2">
                        <input type="datetime-local" value={removing.at} onChange={(e) => setRemoving({ ...removing, at: e.target.value })} aria-label={tAttr('제거 시각')} className={input} />
                        <button type="button" disabled={!removing.at || remove.isPending} onClick={() => remove.mutate(removing)} className="min-h-[44px] rounded-lg bg-gray-900 px-3 text-xs font-semibold text-white disabled:opacity-40">
                          <T k="제거 저장" />
                        </button>
                      </div>
                    )}
                    {voiding?.id === r.id && (
                      <div className="mt-1.5 flex flex-wrap items-center gap-2">
                        <input value={voiding.reason} onChange={(e) => setVoiding({ ...voiding, reason: e.target.value })} aria-label={tAttr('무효 사유')} placeholder={tAttr('무효 사유(5자 이상)')} className={`${input} min-w-[14rem] flex-1`} />
                        <button type="button" disabled={voiding.reason.trim().length < 5 || voidMut.isPending} onClick={() => voidMut.mutate(voiding)} className="min-h-[44px] rounded-lg border border-red-300 px-3 text-xs font-semibold text-red-700 disabled:opacity-40">
                          <T k="무효 처리" />
                        </button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-gray-100 pt-3" data-device-line-form>
        <select value={form.deviceType} onChange={(e) => setForm({ ...form, deviceType: e.target.value as QiDeviceType | '' })} aria-label={tAttr('기구')} className={input}>
          <option value="">{tAttr('기구 선택')}</option>
          {QI_DEVICE_TYPES.map((t) => <option key={t} value={t}>{tAttr(QI_DEVICE_TYPE_LABEL[t])}</option>)}
        </select>
        <input value={form.site} onChange={(e) => setForm({ ...form, site: e.target.value })} aria-label={tAttr('부위')} placeholder={tAttr('부위(선택)')} className={`${input} w-36`} />
        <input type="datetime-local" value={form.insertedAt} onChange={(e) => setForm({ ...form, insertedAt: e.target.value })} aria-label={tAttr('삽입 시각')} className={input} />
        <button type="button" disabled={!form.deviceType || !form.insertedAt || !patientId || record.isPending} onClick={() => record.mutate()} data-device-line-save
          className="min-h-[44px] rounded-lg bg-gray-900 px-3 text-xs font-semibold text-white disabled:opacity-40">
          <T k="삽입 기록" />
        </button>
      </div>
    </section>
  );
}
