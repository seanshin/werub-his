'use client';

import { useState } from 'react';
import { kdate } from '@/lib/ui-settings';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { T, useTAttr } from '@/components/ui/i18n-text';

interface Gate {
  key: string; title: string; owner: string; status: string;
  confirmedBy?: string | null; confirmedAt?: string | null;
  evidenceType?: string | null; evidenceRef?: string | null; approvedOn?: string | null;
  approverName?: string | null; evidenceUrl?: string | null; note?: string | null;
}
interface TrackStatus {
  track: string; label: string; configKey: string; live: boolean; allConfirmed: boolean; gates: Gate[];
}
interface GateEvent {
  id: string; key?: string | null; action: string; actorId?: string | null; createdAt: string;
  snapshot?: Record<string, unknown> | null;
}

const TRACKS = ['LIS_REFLEX'];

const EVIDENCE_TYPES: Record<string, string> = {
  APPROVAL_DOC: '전자결재', MEETING: '회의록', OFFICIAL_LETTER: '공문', OTHER: '기타',
};
const EVENT_LABELS: Record<string, { label: string; cls: string }> = {
  CONFIRM: { label: '결재 기록', cls: 'bg-emerald-100 text-emerald-700' },
  REVOKE: { label: '회수', cls: 'bg-amber-100 text-amber-700' },
  ACTIVATE: { label: '개통', cls: 'bg-blue-100 text-blue-700' },
  DEACTIVATE: { label: '개통 중지', cls: 'bg-red-100 text-red-600' },
};

export default function IntegrationGatesPage() {
  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900"><T k="연동 개통 게이트" /></h1>
        <p className="text-sm text-gray-500 mt-1"><T k="조직 결재(정책·프로토콜 승인·자격증명)를 기록하고, 전 게이트 충족 시에만 개통(config ON)합니다" /></p>
      </div>
      {TRACKS.map(t => <TrackBoard key={t} track={t} />)}
    </div>
  );
}

function TrackBoard({ track }: { track: string }) {
  const qc = useQueryClient();
  const tAttr = useTAttr();
  const [confirmTarget, setConfirmTarget] = useState<Gate | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['integration-gate', track],
    queryFn: () => apiClient.get<{ data: TrackStatus }>(`/api/v1/admin/integration-gates/${track}`),
  });
  const raw = data?.data as unknown;
  const status: TrackStatus | null = raw ? ((raw as { data?: TrackStatus })?.data ?? (raw as TrackStatus)) : null;

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['integration-gate', track] });
    qc.invalidateQueries({ queryKey: ['integration-gate-events', track] });
  };
  const revokeMut = useMutation({
    mutationFn: ({ key, note }: { key: string; note?: string }) =>
      apiClient.patch(`/api/v1/admin/integration-gates/${track}/gates/${key}/revoke`, { note }),
    onSuccess: () => { invalidate(); toast.success(tAttr('회수되었습니다 (이전 근거는 이력에 보존)')); },
    onError: (e) => toast.error((e as { message?: string })?.message || tAttr('실패')),
  });
  const liveMut = useMutation({
    mutationFn: (action: 'activate' | 'deactivate') =>
      apiClient.post(`/api/v1/admin/integration-gates/${track}/${action}`),
    onSuccess: (_r, action) => { invalidate(); toast.success(action === 'activate' ? tAttr('개통되었습니다 (config ON)') : tAttr('개통을 중지했습니다')); },
    onError: (e) => toast.error((e as { message?: string })?.message || tAttr('실패')),
  });

  const revoke = (g: Gate) => {
    const note = window.prompt(`[${g.key}] ${tAttr('확인을 회수합니다 — 사유 (선택)')}`) ?? undefined;
    revokeMut.mutate({ key: g.key, note });
  };

  if (isError) return <QueryErrorFallback error={error} onRetry={refetch} />;
  if (isLoading || !status) return <div className="h-40 bg-gray-100 rounded-2xl animate-pulse" />;

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-bold text-gray-900">{status.label}</h2>
          <p className="text-[11px] text-gray-400 font-mono mt-0.5">{status.configKey}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${status.live ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
            <T k={status.live ? '● 개통 중' : '○ 미개통'} />
          </span>
          {status.live ? (
            <button onClick={() => window.confirm(tAttr('개통을 중지할까요? (LIS 발신이 403으로 거절됩니다)')) && liveMut.mutate('deactivate')}
              className="px-3 py-1.5 text-xs font-medium bg-red-50 text-red-600 rounded-lg hover:bg-red-100"><T k="개통 중지" /></button>
          ) : (
            <button onClick={() => liveMut.mutate('activate')} disabled={!status.allConfirmed}
              title={status.allConfirmed ? tAttr('전 게이트 충족 — 개통 가능') : tAttr('미결 게이트가 있어 비활성')}
              className="px-3 py-1.5 text-xs font-medium bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed">
              <T k="개통 (config ON)" />
            </button>
          )}
        </div>
      </div>

      <div className="space-y-2">
        {status.gates.map(g => (
          <div key={g.key} className={`flex items-start gap-3 p-3 rounded-xl border ${g.status === 'CONFIRMED' ? 'border-emerald-100 bg-emerald-50/40' : 'border-gray-100'}`}>
            <span className={`text-lg ${g.status === 'CONFIRMED' ? '' : 'grayscale opacity-40'}`}>{g.status === 'CONFIRMED' ? '✅' : '☐'}</span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-900">
                <span className="font-mono text-gray-400 mr-1.5">{g.key}</span>{g.title}
              </p>
              <p className="text-[11px] text-gray-400">
                <T k="주관" />: {g.owner}
                {g.confirmedAt && ` · 기록 ${kdate(g.confirmedAt, 'datetimeShort')}`}
              </p>
              {g.status === 'CONFIRMED' && (g.evidenceRef || g.note) && (
                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px]">
                  {g.evidenceType && (
                    <span className="px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 font-medium">
                      <T k={EVIDENCE_TYPES[g.evidenceType] ?? g.evidenceType} />
                    </span>
                  )}
                  {g.evidenceRef && <span className="text-gray-600 font-medium">{g.evidenceRef}</span>}
                  {g.approvedOn && <span className="text-gray-400"><T k="결재일" /> {String(g.approvedOn).slice(0, 10)}</span>}
                  {g.approverName && <span className="text-gray-400"><T k="결재자" /> {g.approverName}</span>}
                  {g.evidenceUrl && (
                    <a href={g.evidenceUrl} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline"><T k="문서 열기" /> ↗</a>
                  )}
                </div>
              )}
              {g.note && <p className="text-[11px] text-gray-500 mt-0.5 truncate" title={g.note}><T k="비고" />: {g.note}</p>}
            </div>
            {g.status === 'CONFIRMED' ? (
              <button onClick={() => revoke(g)} disabled={status.live}
                title={status.live ? tAttr('개통 중에는 회수 불가 — 먼저 개통 중지') : tAttr('확인 회수')}
                className="px-2.5 py-1 text-[11px] font-medium bg-gray-100 text-gray-500 rounded-lg hover:bg-red-50 hover:text-red-600 disabled:opacity-40"><T k="회수" /></button>
            ) : (
              <button onClick={() => setConfirmTarget(g)}
                className="px-2.5 py-1 text-[11px] font-medium bg-emerald-600 text-white rounded-lg hover:bg-emerald-700"><T k="결재 완료 기록" /></button>
            )}
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between">
        <p className="text-[10px] text-gray-400">
          <T k="결재 주체는 각 주관 부서이며 이 화면은 결재 결과의 기록·게이팅입니다. 개통 절차 상세:" /> docs/handoff/HIS_파일럿_리허설_런북.md
        </p>
        <button onClick={() => setShowHistory(v => !v)}
          className="shrink-0 text-[11px] text-gray-400 hover:text-gray-600">
          <T k={showHistory ? '이력 접기 ▲' : '이력 보기 ▼'} />
        </button>
      </div>
      {showHistory && <EventHistory track={track} />}

      {/* 실 서비스 전환 절차 — 개발 시드를 실결재로 교체하는 공식 4단계 (전부 이 보드에서 수행·배포 불요) */}
      <div className="rounded-xl border border-amber-100 bg-amber-50/50 p-3.5">
        <p className="text-[11px] font-semibold text-amber-800 mb-1.5"><T k="실 서비스 전환 절차 — 개발 시드 → 실결재 교체 (이 보드에서 수행)" /></p>
        <ol className="space-y-0.5 text-[11px] text-amber-900/80 list-decimal list-inside">
          <li><b><T k="개통 중지" /></b> — <T k="외부 발신이 403으로 차단되므로 상대 시스템과 전환 창 협의 후 실행" /></li>
          <li><T k="게이트별" /> <b><T k="회수" /></b> — <T k="&lsquo;개발 시드&rsquo; 근거는 이력에 자동 보존" /></li>
          <li><T k="실결재 완료 시마다" /> <b><T k="결재 완료 기록" /></b> — <T k="실제 결재 유형·문서번호·결재일·결재자로 입력" /></li>
          <li><T k="전 게이트 기록 완료" /> → <b><T k="개통" /></b> — <T k="교체 전 과정이 이력에 추적됨" /></li>
        </ol>
        <p className="mt-1.5 text-[10px] text-amber-700/70"><T k="시드는 멱등(기존 기록 보존)이라 DB 재시드가 있어도 실결재 기록은 덮어쓰지 않습니다. 잘못 기록한 경우 수정 대신 회수 후 재기록하세요(이력 보존)." /></p>
      </div>

      {confirmTarget && (
        <ConfirmModal track={track} gate={confirmTarget}
          onClose={() => setConfirmTarget(null)}
          onSaved={() => { setConfirmTarget(null); invalidate(); }} />
      )}
    </div>
  );
}

function EventHistory({ track }: { track: string }) {
  const tAttr = useTAttr();
  const { data, isLoading } = useQuery({
    queryKey: ['integration-gate-events', track],
    queryFn: () => apiClient.get<{ data: GateEvent[] }>(`/api/v1/admin/integration-gates/${track}/events`),
  });
  const raw = data?.data as unknown;
  const events: GateEvent[] = Array.isArray(raw) ? raw : ((raw as { data?: GateEvent[] })?.data ?? []);

  if (isLoading) return <div className="h-16 bg-gray-50 rounded-xl animate-pulse" />;
  if (!events.length) return <p className="text-[11px] text-gray-400 py-2"><T k="이력이 없습니다 (이력 기록은 기능 배포 이후 액션부터 남습니다)" /></p>;

  return (
    <div className="border border-gray-100 rounded-xl divide-y divide-gray-50 max-h-72 overflow-y-auto">
      {events.map(ev => {
        const meta = EVENT_LABELS[ev.action] ?? { label: ev.action, cls: 'bg-gray-100 text-gray-500' };
        const snap = (ev.snapshot ?? {}) as Record<string, unknown>;
        const prior = (snap.prior ?? null) as Record<string, unknown> | null;
        const detail = ev.action === 'CONFIRM'
          ? [snap.evidenceType && tAttr(String(EVIDENCE_TYPES[String(snap.evidenceType)] ?? snap.evidenceType)), snap.evidenceRef, snap.approverName].filter(Boolean).join(' · ')
          : ev.action === 'REVOKE'
            ? [snap.revokeReason && `${tAttr('사유')}: ${snap.revokeReason}`, prior?.evidenceRef && `${tAttr('이전 근거')}: ${prior.evidenceRef}`].filter(Boolean).join(' · ')
            : '';
        return (
          <div key={ev.id} className="flex items-center gap-2 px-3 py-2 text-[11px]">
            <span className={`shrink-0 px-1.5 py-0.5 rounded font-medium ${meta.cls}`}><T k={meta.label} /></span>
            {ev.key && <span className="shrink-0 font-mono text-gray-500">{ev.key}</span>}
            <span className="flex-1 min-w-0 truncate text-gray-500" title={detail}>{detail}</span>
            <span className="shrink-0 text-gray-400">
              {kdate(ev.createdAt, 'datetime')}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function ConfirmModal({ track, gate, onClose, onSaved }: {
  track: string; gate: Gate; onClose: () => void; onSaved: () => void;
}) {
  const tAttr = useTAttr();
  const [form, setForm] = useState({
    evidenceType: 'APPROVAL_DOC', evidenceRef: '', approvedOn: '', approverName: '', evidenceUrl: '', note: '',
  });
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }));

  const mut = useMutation({
    mutationFn: () => apiClient.patch(`/api/v1/admin/integration-gates/${track}/gates/${gate.key}/confirm`, {
      evidenceType: form.evidenceType,
      evidenceRef: form.evidenceRef.trim(),
      ...(form.approvedOn ? { approvedOn: form.approvedOn } : {}),
      ...(form.approverName.trim() ? { approverName: form.approverName.trim() } : {}),
      ...(form.evidenceUrl.trim() ? { evidenceUrl: form.evidenceUrl.trim() } : {}),
      ...(form.note.trim() ? { note: form.note.trim() } : {}),
    }),
    onSuccess: () => { toast.success(tAttr('결재 완료가 기록되었습니다')); onSaved(); },
    onError: (e) => toast.error((e as { message?: string })?.message || tAttr('실패')),
  });

  const refLabel = { APPROVAL_DOC: '결재문서 번호', MEETING: '회의명·회차', OFFICIAL_LETTER: '공문 번호', OTHER: '근거 식별자' }[form.evidenceType] ?? '근거 식별자';
  const canSave = form.evidenceRef.trim().length > 0 && !mut.isPending;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-5 space-y-4" onClick={e => e.stopPropagation()}>
        <div>
          <h3 className="text-base font-bold text-gray-900"><T k="결재 완료 기록" /></h3>
          <p className="text-xs text-gray-500 mt-0.5">
            <span className="font-mono text-gray-400 mr-1">{gate.key}</span>{gate.title}
            <span className="text-gray-400"> · <T k="주관" /> {gate.owner}</span>
          </p>
        </div>

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-[11px] font-medium text-gray-600"><T k="결재 유형" /> <span className="text-red-500">*</span></span>
              <select value={form.evidenceType} onChange={set('evidenceType')}
                className="mt-1 w-full text-sm border border-gray-200 rounded-lg px-2.5 py-1.5 bg-white">
                {Object.entries(EVIDENCE_TYPES).map(([v, l]) => <option key={v} value={v}>{tAttr(l)}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="text-[11px] font-medium text-gray-600"><T k="결재일" /></span>
              <input type="date" value={form.approvedOn} onChange={set('approvedOn')}
                className="mt-1 w-full text-sm border border-gray-200 rounded-lg px-2.5 py-1.5" />
            </label>
          </div>
          <label className="block">
            <span className="text-[11px] font-medium text-gray-600"><T k={refLabel} /> <span className="text-red-500">*</span></span>
            <input value={form.evidenceRef} onChange={set('evidenceRef')} maxLength={120}
              placeholder={form.evidenceType === 'APPROVAL_DOC' ? tAttr('예: 결재-2026-0712') : form.evidenceType === 'MEETING' ? tAttr('예: 진단검사운영위 7월 정례회의') : ''}
              className="mt-1 w-full text-sm border border-gray-200 rounded-lg px-2.5 py-1.5" />
          </label>
          <label className="block">
            <span className="text-[11px] font-medium text-gray-600"><T k="결재자 (성명·직책)" /></span>
            <input value={form.approverName} onChange={set('approverName')} maxLength={50} placeholder={tAttr('예: 김진단 진단검사의학과장')}
              className="mt-1 w-full text-sm border border-gray-200 rounded-lg px-2.5 py-1.5" />
          </label>
          <label className="block">
            <span className="text-[11px] font-medium text-gray-600"><T k="문서 링크 (그룹웨어 등)" /></span>
            <input value={form.evidenceUrl} onChange={set('evidenceUrl')} maxLength={300} placeholder="https://…"
              className="mt-1 w-full text-sm border border-gray-200 rounded-lg px-2.5 py-1.5" />
          </label>
          <label className="block">
            <span className="text-[11px] font-medium text-gray-600"><T k="비고" /></span>
            <textarea value={form.note} onChange={set('note')} maxLength={500} rows={2}
              className="mt-1 w-full text-sm border border-gray-200 rounded-lg px-2.5 py-1.5 resize-none" />
          </label>
        </div>

        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-1.5 text-xs font-medium text-gray-500 rounded-lg hover:bg-gray-100"><T k="취소" /></button>
          <button onClick={() => mut.mutate()} disabled={!canSave}
            className="px-3 py-1.5 text-xs font-medium bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-40">
            <T k={mut.isPending ? '기록 중…' : '결재 완료 기록'} />
          </button>
        </div>
      </div>
    </div>
  );
}
