'use client';

/**
 * 환자 병합 — 비교 → 확인 → 기록(2026-10-20 환자 목록 P2 · `patients-list-refinement-2026-10.plan.md` A8·R12·R17).
 *
 * 🔴 종전: "Source 환자의 **모든 진료기록**이 Target으로 이관됩니다" — 실제로는 환자에 딸린 190 모델 중 **6개만** 옮긴다.
 *    알레르기·문제 목록·동의서·투약 기록 등은 병합으로 비활성된 원 기록에 남아 대상 차트에서 보이지 않는다.
 *    비교 화면 없이 `confirm()` 하나 · 중복 그룹에서 와도 두 환자를 다시 찾아야 했다 · 이름 붙여 쓰기.
 * 이제: 서버 미리보기(두 환자 나란히 · 옮겨지는 것/남는 것 모델별 건수 · 되돌리기 경로 없음) → 남는 기록이 있으면
 *    확인 칸(서버가 확인 여부와 남은 건수를 병합 이력에 남긴다) → 사유 → 실행. 실패는 창 안에서 그대로 말한다.
 */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { INSURANCE_LABEL, GENDER_LABEL } from '@hospital-run/shared';
import { apiClient, ApiError } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';
import PatientSelector from '@/components/ui/PatientSelector';
import { KDate, PatientName } from '@/components/ui/display';
import { T, Tf, useTAttr } from '@/components/ui/i18n-text';

type MergeSide = {
  id: string; mrn: string; familyName: string; givenName: string; koreanName?: string | null;
  dateOfBirth: string; gender: string; insuranceType: string; createdAt: string; isDeceased?: boolean;
};
type RecordCount = { model: string; policy: 'MOVE' | 'UNIQUE' | 'STAY' | 'MANUAL' | 'BLOCK'; count: number; safetyLabel: string | null };
export type MergePreview = {
  source: MergeSide; target: MergeSide;
  records: { moved: RecordCount[]; unmoved: RecordCount[]; blocking: RecordCount[]; uncounted: string[]; movedTotal: number; unmovedTotal: number };
  reversible: false;
};

const MOVED_LABEL: Record<string, string> = {
  Encounter: '진료 기록', Appointment: '예약', Admission: '입원', Billing: '수납·청구', Dispensing: '조제', LabResult: '검사 결과',
};
/** 원 기록에 남는 이유 — 서버 정책 등록부(`patient-merge.ts`)의 분류 */
const STAY_REASON: Record<string, string> = {
  STAY: '원장·서명본·외부 제출 기록',
  MANUAL: '자동으로 옮기지 않음 — 사람이 정함',
  UNIQUE: '대상 환자에 같은 기록이 있음',
};

function unwrap<T>(res: unknown): T | undefined {
  const r = res as { data?: unknown } | undefined;
  const d = r?.data as { data?: T } | T | undefined;
  return (d && typeof d === 'object' && 'data' in (d as object) ? (d as { data?: T }).data : d) as T | undefined;
}

export function MergePatientsModal({ onClose, initial }: { onClose: () => void; initial?: { sourceId: string; targetId: string } }) {
  const tAttr = useTAttr();
  const qc = useQueryClient();
  const [sourceId, setSourceId] = useState(initial?.sourceId ?? '');
  const [targetId, setTargetId] = useState(initial?.targetId ?? '');
  const [reason, setReason] = useState('');
  // 쓰기 폼의 초기값은 미선택 — 확인은 사람이 직접 누른다
  const [ack, setAck] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const merge = useMutation({
    mutationFn: (acknowledgeUnmoved: boolean | undefined) => apiClient.post('/api/v1/patients/merge', { sourceId, targetId, reason: reason.trim(), acknowledgeUnmoved }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['patients'] });
      qc.invalidateQueries({ queryKey: ['patient-duplicate-groups'] });
      qc.invalidateQueries({ queryKey: ['patient-quality-dashboard'] });
      toast.success(tAttr('환자 병합이 완료되었습니다.'));
      onClose();
    },
    // 🔴 실패는 창을 닫지 않고 그 자리에서 — 서버가 말한 이유 그대로
    onError: (e) => setSubmitError(e instanceof ApiError ? e.message : tAttr('병합에 실패했습니다.')),
  });

  const ready = !!sourceId && !!targetId && sourceId !== targetId;
  const preview = useQuery({
    queryKey: ['patient-merge-preview', sourceId, targetId],
    queryFn: () => apiClient.get('/api/v1/patients/merge-preview', { sourceId, targetId }),
    enabled: ready,
    retry: false,
  });
  const p = unwrap<MergePreview>(preview.data);
  const needsAck = !!p && (p.records.unmovedTotal > 0 || p.records.uncounted.length > 0);
  // 🔴 활성 법적 보존명령 — 서버가 병합을 거부한다(확인으로 넘어갈 수 없다)
  const blocked = !!p?.records.blocking?.length;

  const swap = () => { setSourceId(targetId); setTargetId(sourceId); setAck(false); setSubmitError(null); };
  const canSubmit = !!p && !blocked && !!reason.trim() && (!needsAck || ack) && !merge.isPending;
  const previewError = preview.isError ? (preview.error instanceof ApiError ? preview.error.message : tAttr('미리보기를 불러오지 못했습니다.')) : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" data-merge-modal>
      <div className="max-h-[90vh] w-full max-w-3xl overflow-auto rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
          <h3 className="text-lg font-semibold text-gray-900"><T k="환자 병합" /></h3>
          <button onClick={onClose} aria-label={tAttr('닫기')} className="p-1 text-gray-400 hover:text-gray-600"><svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg></button>
        </div>
        <div className="space-y-4 p-6">
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800" data-merge-scope-note>
            <T k="병합하면 원 환자는 비활성되고 임상·업무 기록은 대상 환자로 옮겨집니다. 감사·열람 원장, 서명본·발급본, 외부 제출 기록, 위치·여정 원장은 원 기록에 그대로 남고 포털 계정은 옮기지 않습니다. 병합을 되돌리는 기능은 없습니다." />
          </div>

          <div className="grid gap-3 md:grid-cols-[1fr_auto_1fr] md:items-end">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700"><T k="원 환자 (병합 후 비활성)" /></label>
              <PatientSelector value={sourceId} onChange={(id) => { setSourceId(id); setAck(false); setSubmitError(null); }} placeholder={tAttr('이름 또는 MRN 검색')} />
            </div>
            <button type="button" onClick={swap} disabled={!sourceId && !targetId} className="h-10 rounded-xl border border-gray-200 px-3 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-40" data-merge-swap>
              ⇄ <T k="바꾸기" />
            </button>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700"><T k="대상 환자 (남는 기록)" /></label>
              <PatientSelector value={targetId} onChange={(id) => { setTargetId(id); setAck(false); setSubmitError(null); }} placeholder={tAttr('이름 또는 MRN 검색')} />
            </div>
          </div>
          {sourceId && targetId && sourceId === targetId && <p className="text-xs text-rose-600"><T k="같은 환자를 병합할 수 없습니다." /></p>}

          {ready && preview.isLoading && <p className="text-sm text-gray-400"><T k="불러오는 중…" /></p>}
          {previewError && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700" data-merge-preview-error>{previewError}</p>}

          {p && (
            <>
              {blocked && (
                <p className="rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-800" data-merge-blocked>
                  <T k="원 환자에 활성 법적 보존명령이 있어 병합할 수 없습니다 — 보존명령을 해제한 뒤 다시 하세요." />
                </p>
              )}
              <CompareTable p={p} />
              <RecordLists p={p} />
              {needsAck && (
                <label className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800" data-merge-ack>
                  <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-0.5" />
                  <span><Tf k="원 기록에 남는 {수}건은 대상 환자 차트에서 보이지 않는다는 것을 확인했습니다(확인 사실과 건수는 병합 이력에 남습니다)." params={{ 수: p.records.unmovedTotal.toLocaleString() }} /></span>
                </label>
              )}
            </>
          )}

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700"><T k="병합 사유" /></label>
            <input type="text" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={tAttr('예: 중복 등록 환자')} className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:border-transparent focus:ring-2 focus:ring-blue-500" />
          </div>
          {submitError && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700" data-merge-submit-error>{submitError}</p>}
          <div className="flex gap-3 pt-2">
            <button onClick={() => { setSubmitError(null); merge.mutate(needsAck ? ack : undefined); }} disabled={!canSubmit} className="rounded-xl bg-red-600 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-red-700 disabled:opacity-50" data-merge-submit>
              {merge.isPending ? <T k="병합 중..." /> : <T k="병합 실행 — 되돌릴 수 없음" />}
            </button>
            <button onClick={onClose} className="rounded-xl border border-gray-300 px-5 py-2.5 text-sm text-gray-700 transition-colors hover:bg-gray-50"><T k="취소" /></button>
          </div>
        </div>
      </div>
    </div>
  );
}

function CompareTable({ p }: { p: MergePreview }) {
  // [라벨, 비교할 원값, 그리기] — 다른 칸은 강조(이름·생년월일은 같아서 중복 의심이 된 것이고 등록일은 늘 다르다)
  const rows: Array<[string, (s: MergeSide) => string, (s: MergeSide) => React.ReactNode, boolean]> = [
    ['등록번호', (s) => s.mrn, (s) => s.mrn, false],
    ['이름', (s) => `${s.familyName}|${s.givenName}`, (s) => <PatientName familyName={s.familyName} givenName={s.givenName} koreanName={s.koreanName} showMrn={false} />, true],
    ['생년월일', (s) => String(s.dateOfBirth).slice(0, 10), (s) => <KDate value={s.dateOfBirth} />, true],
    ['성별', (s) => s.gender, (s) => <T k={GENDER_LABEL[s.gender] ?? s.gender} />, true],
    ['보험', (s) => s.insuranceType, (s) => <T k={INSURANCE_LABEL[s.insuranceType] ?? s.insuranceType} />, true],
    ['등록일', (s) => s.createdAt, (s) => <KDate value={s.createdAt} />, false],
  ];
  return (
    <table className="w-full text-sm" data-merge-compare>
      <thead>
        <tr className="text-xs text-gray-500">
          <th className="w-24 py-1 text-left font-medium" />
          <th className="py-1 text-left font-medium"><T k="원 환자 (비활성됨)" /></th>
          <th className="py-1 text-left font-medium"><T k="대상 환자 (남음)" /></th>
        </tr>
      </thead>
      <tbody>
        {rows.map(([label, raw, draw, compare]) => {
          const differs = compare && raw(p.source) !== raw(p.target);
          return (
            <tr key={label} className={`border-t border-gray-100 ${differs ? 'bg-amber-50/60' : ''}`} data-merge-row={label} data-differs={differs ? '1' : undefined}>
              <td className="py-1.5 text-xs text-gray-500"><T k={label} /></td>
              <td className="py-1.5">{draw(p.source)}</td>
              <td className="py-1.5">{draw(p.target)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function RecordLists({ p }: { p: MergePreview }) {
  const { moved, unmoved, uncounted, movedTotal, unmovedTotal } = p.records;
  return (
    <div className="grid gap-3 md:grid-cols-2">
      <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-3" data-merge-moved>
        <p className="mb-1.5 text-xs font-semibold text-emerald-800"><Tf k="대상 환자로 옮겨짐 {수}건" params={{ 수: movedTotal.toLocaleString() }} /></p>
        {moved.length === 0 ? <p className="text-xs text-gray-500"><T k="옮길 기록이 없습니다" /></p> : (
          <ul className="max-h-40 space-y-0.5 overflow-auto text-xs text-gray-700">
            {moved.map((r) => (
              <li key={r.model} data-merge-moved-model={r.model}>
                {r.safetyLabel || MOVED_LABEL[r.model] ? <T k={r.safetyLabel ?? MOVED_LABEL[r.model]} /> : <span className="font-mono text-[11px]">{r.model}</span>} <span className="tabular-nums text-gray-500">{r.count}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="rounded-xl border border-rose-200 bg-rose-50/50 p-3" data-merge-unmoved>
        <p className="mb-1.5 text-xs font-semibold text-rose-800"><Tf k="원 기록에 남음 {수}건 — 대상 차트에서 보이지 않음" params={{ 수: unmovedTotal.toLocaleString() }} /></p>
        {unmoved.length === 0 && uncounted.length === 0 ? <p className="text-xs text-gray-500"><T k="남는 기록이 없습니다" /></p> : (
          <ul className="max-h-40 space-y-0.5 overflow-auto text-xs text-gray-700">
            {unmoved.map((r) => (
              <li key={r.model} data-merge-unmoved-model={r.model} className={r.safetyLabel ? 'font-semibold text-rose-700' : ''}>
                {r.safetyLabel ? <T k={r.safetyLabel} /> : <span className="font-mono text-[11px]">{r.model}</span>} <span className="tabular-nums text-gray-500">{r.count}</span>
                {STAY_REASON[r.policy] && <span className="ml-1 text-[10px] font-normal text-gray-400" data-merge-stay-reason={r.policy}>· <T k={STAY_REASON[r.policy]} /></span>}
              </li>
            ))}
          </ul>
        )}
        {uncounted.length > 0 && (
          <p className="mt-1.5 text-[11px] text-amber-700" data-merge-uncounted><Tf k="건수를 세지 못한 기록 종류 {수}개 — 남아 있을 수 있습니다" params={{ 수: uncounted.length }} /></p>
        )}
      </div>
    </div>
  );
}
