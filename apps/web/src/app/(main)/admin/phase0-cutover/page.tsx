'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';
import { kdate } from '@/lib/ui-settings';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { T, useTAttr } from '@/components/ui/i18n-text';

interface ChecklistItem { key: string; label: string }
/** 대사 실측 — 시스템이 자동 검증할 수 있는지 여부 자체를 화면이 말한다 */
interface Reconcile { autoVerifiable: boolean; patientCount: number | null; capturedAt: string; note: string }
interface Status {
  checklist: ChecklistItem[];
  reconcile?: Reconcile;
  technicalReady: { pseudonymKeySet: boolean; gateEnabled: boolean };
  approval: { approvedByName?: string; approvedAt?: string; reason?: string; checklist?: Record<string, boolean>; executedAt?: string };
  approved: boolean; executed: boolean; canExecute: boolean;
}

const unwrap = <T,>(d: unknown): T => {
  const raw = (d as { data?: unknown })?.data;
  return (raw && typeof raw === 'object' && 'data' in (raw as object) ? (raw as { data: T }).data : raw) as T;
};

/** Phase0 가명화 컷오버 승인 게이트 — 법무/CPO 승인 없이 게이트 플립 불가(관리 기능화) */
export default function Phase0CutoverPage() {
  const tAttr = useTAttr();
  const qc = useQueryClient();
  const [checks, setChecks] = useState<Record<string, boolean>>({});
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['phase0-cutover'],
    queryFn: () => apiClient.get<{ data: Status }>('/api/v1/admin/phase0-cutover/status'),
  });
  const st = unwrap<Status>(data);

  if (isError) return <QueryErrorFallback error={error} onRetry={refetch} />;
  if (isLoading || !st) return <div className="py-16 text-center text-gray-400"><T k="불러오는 중..." /></div>;

  const invalidate = () => qc.invalidateQueries({ queryKey: ['phase0-cutover'] });
  const act = async (path: string, body?: object, ok?: string) => {
    setBusy(true);
    try {
      await apiClient.post(`/api/v1/admin/phase0-cutover/${path}`, body ?? {});
      toast.success(ok ?? '처리되었습니다');
      invalidate();
    } catch (e) { toast.error((e as { message?: string })?.message || '처리 실패'); }
    setBusy(false);
  };

  const allChecked = st.checklist.every((c) => checks[c.key]);

  return (
    <div className="max-w-3xl">
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-gray-900"><T k="Phase0 가명화 컷오버 승인" /></h2>
        <p className="text-sm text-gray-500 mt-1"><T k="환자식별번호(chartNo) 외부 전송을 가명 토큰(patientRef)으로 전환하는 컷오버 — 법무/CPO 승인 게이트" /></p>
      </div>

      {/* 상태 배너 */}
      <div className={`mb-5 rounded-2xl border p-4 ${st.executed ? 'border-emerald-200 bg-emerald-50' : st.approved ? 'border-blue-200 bg-blue-50' : 'border-amber-200 bg-amber-50'}`}>
        <p className="text-sm font-bold">
          <T k={st.executed ? '✅ 컷오버 실행됨 — 가명화 게이트 ON' : st.approved ? '🔵 승인 완료 — 실행 대기' : '⏳ 승인 대기'} />
        </p>
        <p className="text-xs text-gray-600 mt-1">
          <T k="가명화 키" />: <T k={st.technicalReady.pseudonymKeySet ? '설정됨' : '미설정'} /> · <T k="게이트" />: {st.technicalReady.gateEnabled ? 'ON' : 'OFF'}
          {st.approval.approvedAt && ` · 승인: ${st.approval.approvedByName} (${kdate(st.approval.approvedAt, 'datetime')})`}
        </p>
      </div>

      {/* 승인 전: 체크리스트 */}
      {!st.approved && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 mb-4">
          <h3 className="text-sm font-bold text-gray-900 mb-3"><T k="재식별위험 검토 체크리스트 (전항 확인 필수)" /></h3>
          {/* 🔴 체크박스가 "시스템이 검증했다"로 읽히지 않게, 자동 검증 불가 사실을 체크리스트 위에 먼저 밝힌다 */}
          {st.reconcile && !st.reconcile.autoVerifiable && (
            <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2">
              <p className="text-[11px] font-semibold text-amber-800">⚠️ <T k="대사 자동 검증 불가 — 아래 확인은 승인자의 외부 확인입니다" /></p>
              <p className="text-[11px] text-amber-700 mt-0.5 leading-relaxed">{st.reconcile.note}</p>
              {st.reconcile.patientCount !== null && (
                <p className="text-[10px] text-amber-600 mt-0.5">환자 원장 실측 {st.reconcile.patientCount}건 · {kdate(st.reconcile.capturedAt, 'datetime')} 기준</p>
              )}
            </div>
          )}
          <div className="space-y-2.5 mb-4">
            {st.checklist.map((c) => (
              <label key={c.key} className="flex items-start gap-2.5 cursor-pointer">
                <input type="checkbox" checked={!!checks[c.key]} className="mt-0.5"
                  onChange={(e) => setChecks((p) => ({ ...p, [c.key]: e.target.checked }))} />
                <span className="text-xs text-gray-700">{c.label}</span>
              </label>
            ))}
          </div>
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2}
            placeholder={tAttr('승인 근거(법무/CPO 검토 결과 요약) — 필수')}
            className="w-full border border-gray-200 rounded-xl px-3 py-2 text-xs mb-3" />
          <button disabled={busy || !allChecked || !reason.trim()}
            onClick={() => act('approve', { reason, checklist: checks }, '승인이 기록되었습니다')}
            className="px-4 py-2 rounded-xl bg-blue-600 text-white text-sm font-medium disabled:opacity-40">
            <T k="승인 기록" />
          </button>
          <p className="text-[10px] text-gray-400 mt-2"><T k="법적 판단(가명처리 적정성)은 승인권자의 책임이며, 이 기록은 절차·감사 추적용입니다." /></p>
        </div>
      )}

      {/* 승인 후: 실행/철회 */}
      {st.approved && !st.executed && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 mb-4">
          <p className="text-xs text-gray-600 mb-1"><T k="승인 근거" />: <span className="text-gray-900">{st.approval.reason}</span></p>
          <div className="flex gap-2 mt-3">
            <button disabled={busy || !st.canExecute}
              onClick={() => { if (confirm('가명화 게이트를 ON으로 플립합니다. ERP와 합의된 일시입니까?')) act('execute', {}, '컷오버 실행 — 가명화 게이트 ON'); }}
              className="px-4 py-2 rounded-xl bg-rose-600 text-white text-sm font-medium disabled:opacity-40">
              🔴 <T k="컷오버 실행 (게이트 ON)" />
            </button>
            <button disabled={busy} onClick={() => act('revoke', {}, '승인이 철회되었습니다')}
              className="px-4 py-2 rounded-xl bg-white border border-gray-200 text-gray-600 text-sm"><T k="승인 철회" /></button>
          </div>
        </div>
      )}

      {/* 실행 후: 롤백 */}
      {st.executed && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <p className="text-xs text-gray-600 mb-3"><T k="가명화 게이트가 ON입니다. 문제 발생 시 롤백(게이트 OFF·1초·무재시작)." /></p>
          <button disabled={busy} onClick={() => { if (confirm('가명화 게이트를 OFF로 롤백합니다.')) act('rollback', {}, '롤백 — 게이트 OFF'); }}
            className="px-4 py-2 rounded-xl bg-white border border-rose-200 text-rose-600 text-sm font-medium"><T k="롤백 (게이트 OFF)" /></button>
        </div>
      )}
    </div>
  );
}
