'use client';

/**
 * 위원회가 정할 것을 그 기능 화면에서 안건으로 올리기(2026-10-07).
 *
 * 🔴 이 화면은 값을 바꾸지 않는다 — 후보를 적어 담당 위원회에 안건으로 올린다. "정하지 않음"도 선택지다.
 *    바뀌는 것은 위원회가 의결한 선택지를 집행 엔진이 반영할 때다(기록 ≠ 적용). 담당 위원회는 서버(표면 매핑)가 정한다.
 * 🔴 열린 안건이 있으면 다시 올리지 않고 그 상태를 보인다(같은 것을 두 번 의결하지 않게).
 */
import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AGENDA_STATUS_LABEL, OPEN_AGENDA_STATUSES, type AgendaStatus } from '@hospital-run/shared';
import { apiClient } from '@/lib/api-client';
import { extractErrorMessage } from '@/lib/error-utils';
import { toast } from '@/stores/toast-store';
import { useHasRole } from '@/hooks/use-admin-write';
import { KDate } from '@/components/ui/display';
import { T, useTAttr } from '@/components/ui/i18n-text';

export interface ScreenAgenda {
  id: string; title: string; status: AgendaStatus; createdAt: string; source: string | null; key: string | null;
  committee: { code: string | null; name: string } | null; decision: { decisionNo: string | null; status: string } | null;
}

export function useScreenAgendas() {
  // 서버 @Roles(ADMIN·DOCTOR·NURSE·PHARMACIST·LAB_TECH) 와 같은 판정
  const canView = useHasRole('DOCTOR', 'NURSE', 'PHARMACIST', 'LAB_TECH');
  return useQuery({
    queryKey: ['screen-agendas'],
    queryFn: () => apiClient.get<{ data: ScreenAgenda[] }>('/api/v1/orders/governance/agendas').then((r) => r.data ?? []),
    enabled: canView,
  });
}
/** 대상의 가장 최근 안건(목록은 최신순) */
export const latestAgenda = (list: ScreenAgenda[] | undefined, source: string, key: string) => list?.find((a) => a.source === source && a.key === key) ?? null;
export const isOpenAgenda = (a: ScreenAgenda | null) => !!a && (OPEN_AGENDA_STATUSES as readonly string[]).includes(a.status);

export function AgendaBadge({ a }: { a: ScreenAgenda }) {
  const open = isOpenAgenda(a);
  return (
    <p className={`flex flex-wrap items-center gap-1.5 text-[11px] ${open ? 'text-blue-800' : 'text-gray-600'}`} data-agenda-badge={a.status}>
      <span className={`rounded px-1.5 py-0.5 font-semibold ${open ? 'bg-blue-50' : a.status === 'RESOLVED' ? 'bg-emerald-50 text-emerald-800' : 'bg-gray-100'}`}>
        <T k="위원회 안건" /> · <T k={AGENDA_STATUS_LABEL[a.status] ?? a.status} />
      </span>
      {a.committee && <span><T k={a.committee.name} /></span>}
      {a.decision?.decisionNo && <span className="font-mono">{a.decision.decisionNo}</span>}
      <span className="text-gray-400"><KDate value={a.createdAt} /></span>
      <Link href="/admin/governance" className="text-blue-700 hover:underline"><T k="거버넌스에서 보기 →" /></Link>
      {a.status === 'RESOLVED' && <span className="text-gray-500"><T k="반영은 집행 엔진이 합니다 — 반영 여부는 거버넌스 화면에서" /></span>}
    </p>
  );
}

const PRIORITIES = ['STAT', 'URGENT', 'ROUTINE'] as const;
type Cand = Record<(typeof PRIORITIES)[number], string>;
const EMPTY: Cand = { STAT: '', URGENT: '', ROUTINE: '' };

/** 기준 점검 화면의 주의 기준 칸 — 열린 안건이면 상태만 · 없으면 올리기 */
export function AttentionAgendaSlot() {
  const q = useScreenAgendas();
  const [open, setOpen] = useState(false);
  const a = latestAgenda(q.data, 'ORDER_ATTENTION', 'orders.tracking.attentionMin');
  if (q.isError) return <p className="text-[11px] text-amber-700"><T k="위원회 안건 상태를 확인하지 못했습니다." /></p>;
  return (
    <div className="space-y-1.5" data-agenda-slot="attention">
      {a && <AgendaBadge a={a} />}
      {!isOpenAgenda(a) && !open && (
        <button type="button" onClick={() => setOpen(true)} data-agenda-open="attention"
          className="min-h-[36px] rounded-lg border border-blue-300 bg-white px-3 text-[11px] font-semibold text-blue-800">
          <T k="위원회 안건으로 올리기" />
        </button>
      )}
      {open && <AttentionAgendaForm onClose={() => setOpen(false)} />}
    </div>
  );
}

/** 지표 카드의 원장 등록·목표 칸 */
export function QiAgendaSlot({ indicatorKey, registered, needsDirection }: { indicatorKey: string; registered: boolean; needsDirection: boolean }) {
  const q = useScreenAgendas();
  const [open, setOpen] = useState(false);
  const a = latestAgenda(q.data, 'CPOE_QI', indicatorKey);
  if (q.isError) return null;
  return (
    <div className="space-y-1" data-agenda-slot={`qi-${indicatorKey}`}>
      {a && <AgendaBadge a={a} />}
      {!isOpenAgenda(a) && !open && (
        <button type="button" onClick={() => setOpen(true)} data-agenda-open={`qi-${indicatorKey}`} className="text-[11px] font-medium text-blue-700">
          <T k={registered ? '목표 변경을 위원회에 올리기' : '원장 등록·목표를 위원회에 올리기'} /> →
        </button>
      )}
      {open && <QiAgendaForm indicatorKey={indicatorKey} registered={registered} needsDirection={needsDirection} onClose={() => setOpen(false)} />}
    </div>
  );
}

/** 오더 처리 주의 기준 — 후보 1~3(긴급도별 분) */
export function AttentionAgendaForm({ onClose }: { onClose: () => void }) {
  const tAttr = useTAttr();
  const qc = useQueryClient();
  // 서버 @Roles(ADMIN·DOCTOR·NURSE·PHARMACIST·LAB_TECH) — 안건 제안은 전 직원
  const canPropose = useHasRole('DOCTOR', 'NURSE', 'PHARMACIST', 'LAB_TECH');
  const [cands, setCands] = useState<Cand[]>([{ ...EMPTY }]);
  const [note, setNote] = useState('');
  const parsed = cands.map((c) => Object.fromEntries(PRIORITIES.filter((p) => c[p].trim()).map((p) => [p, Number(c[p])])));
  const valid = parsed.length > 0 && parsed.every((c) => Object.keys(c).length > 0 && Object.values(c).every((v) => Number.isInteger(v) && v >= 1 && v <= 1440));
  const submit = useMutation({
    mutationFn: () => {
      if (!canPropose) throw new Error(tAttr('안건을 올릴 권한이 없습니다.'));
      return apiClient.post('/api/v1/orders/governance/attention-agenda', { candidates: parsed, ...(note.trim() ? { note } : {}) });
    },
    onSuccess: () => { toast.success(tAttr('위원회 안건으로 올렸습니다 — 의결 전에는 설정이 바뀌지 않습니다.')); qc.invalidateQueries({ queryKey: ['screen-agendas'] }); onClose(); },
    onError: (e) => toast.error(extractErrorMessage(e) || tAttr('안건을 올리지 못했습니다.')),
  });
  if (!canPropose) return null;
  return (
    <div className="space-y-2 rounded-xl border border-blue-200 bg-blue-50/40 p-3" data-agenda-form="attention">
      <p className="text-xs font-semibold text-blue-900"><T k="주의 기준 후보(분) — 위원회가 고릅니다" /></p>
      {cands.map((c, i) => (
        <div key={i} className="flex flex-wrap items-center gap-1.5 text-xs" data-agenda-cand={i}>
          <span className="w-12 text-gray-500"><T k="후보" /> {i + 1}</span>
          {PRIORITIES.map((p) => (
            <label key={p} className="flex items-center gap-1">{p}
              <input type="number" min={1} max={1440} value={c[p]} aria-label={`${p} ${i + 1}`}
                onChange={(e) => setCands(cands.map((x, j) => (j === i ? { ...x, [p]: e.target.value } : x)))}
                className="w-20 rounded border border-gray-200 px-1.5 py-1" />
            </label>
          ))}
          {cands.length > 1 && <button type="button" onClick={() => setCands(cands.filter((_, j) => j !== i))} className="text-gray-400" aria-label="remove">✕</button>}
        </div>
      ))}
      {cands.length < 3 && <button type="button" onClick={() => setCands([...cands, { ...EMPTY }])} className="text-[11px] text-blue-700">+ <T k="후보 추가" /></button>}
      <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder={tAttr('제안 사유(선택)')} aria-label={tAttr('제안 사유')} className="w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-sm" />
      <div className="flex items-center gap-2">
        <button type="button" disabled={!valid || submit.isPending} onClick={() => submit.mutate()} data-agenda-submit
          className="min-h-[44px] rounded-lg bg-blue-700 px-4 text-sm font-semibold text-white disabled:opacity-40">
          <T k="위원회 안건으로 올리기" />
        </button>
        <button type="button" onClick={onClose} className="text-xs text-gray-500"><T k="닫기" /></button>
        <span className="text-[10px] text-gray-500"><T k="'정하지 않음'이 선택지로 함께 올라갑니다 · 1~1440 분 정수" /></span>
      </div>
    </div>
  );
}

/** CPOE 지표 — 질 지표 원장 등록·목표(%) 후보 1~3 · 방향이 정해지지 않은 지표는 방향도 */
export function QiAgendaForm({ indicatorKey, registered, needsDirection, onClose }: {
  indicatorKey: string; registered: boolean; needsDirection: boolean; onClose: () => void;
}) {
  const tAttr = useTAttr();
  const qc = useQueryClient();
  // 서버 @Roles(ADMIN·DOCTOR)
  const canPropose = useHasRole('DOCTOR');
  const [targets, setTargets] = useState<string[]>(['']);
  const [direction, setDirection] = useState('');
  const [note, setNote] = useState('');
  const nums = targets.map((t) => Number(t));
  const valid = targets.every((t) => t.trim() !== '') && nums.every((n) => Number.isFinite(n) && n >= 0 && n <= 100)
    && new Set(nums).size === nums.length && (!needsDirection || !!direction);
  const submit = useMutation({
    mutationFn: () => {
      if (!canPropose) throw new Error(tAttr('안건을 올릴 권한이 없습니다.'));
      return apiClient.post('/api/v1/orders/quality/agenda', { key: indicatorKey, targets: nums, ...(needsDirection ? { direction } : {}), ...(note.trim() ? { note } : {}) });
    },
    onSuccess: () => { toast.success(tAttr('위원회 안건으로 올렸습니다 — 의결 전에는 원장이 바뀌지 않습니다.')); qc.invalidateQueries({ queryKey: ['screen-agendas'] }); onClose(); },
    onError: (e) => toast.error(extractErrorMessage(e) || tAttr('안건을 올리지 못했습니다.')),
  });
  if (!canPropose) return null;
  return (
    <div className="space-y-2 rounded-lg border border-blue-200 bg-blue-50/40 p-2.5" data-agenda-form={`qi-${indicatorKey}`}>
      <p className="text-[11px] font-semibold text-blue-900"><T k={registered ? '목표 변경 후보(%) — 위원회가 고릅니다' : '원장 등록과 목표 후보(%) — 위원회가 고릅니다'} /></p>
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        {targets.map((t, i) => (
          <input key={i} type="number" min={0} max={100} step="0.1" value={t} aria-label={`${tAttr('목표 후보')} ${i + 1}`}
            onChange={(e) => setTargets(targets.map((x, j) => (j === i ? e.target.value : x)))} className="w-20 rounded border border-gray-200 px-1.5 py-1" />
        ))}
        {targets.length < 3 && <button type="button" onClick={() => setTargets([...targets, ''])} className="text-[11px] text-blue-700">+ <T k="후보" /></button>}
        {needsDirection && (
          <select value={direction} onChange={(e) => setDirection(e.target.value)} aria-label={tAttr('방향')} className="rounded border border-gray-200 px-1.5 py-1" data-agenda-direction>
            <option value="">{tAttr('방향 선택')}</option>
            <option value="LOWER_IS_BETTER">{tAttr('낮을수록 바람직')}</option>
            <option value="HIGHER_IS_BETTER">{tAttr('높을수록 바람직')}</option>
          </select>
        )}
      </div>
      <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder={tAttr('제안 사유(선택)')} aria-label={tAttr('제안 사유')} className="w-full rounded border border-gray-200 px-2 py-1 text-xs" />
      <div className="flex items-center gap-2">
        <button type="button" disabled={!valid || submit.isPending} onClick={() => submit.mutate()} data-agenda-submit
          className="min-h-[44px] rounded-lg bg-blue-700 px-3 text-xs font-semibold text-white disabled:opacity-40">
          <T k="위원회 안건으로 올리기" />
        </button>
        <button type="button" onClick={onClose} className="text-[11px] text-gray-500"><T k="닫기" /></button>
      </div>
      {needsDirection && <p className="text-[10px] text-amber-700"><T k="이 지표는 방향이 정해져 있지 않습니다 — 방향도 위원회가 확인합니다." /></p>}
    </div>
  );
}
