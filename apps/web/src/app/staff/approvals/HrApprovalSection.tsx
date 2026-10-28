'use client';
import { ReasonInput, reasonFilled } from '@/components/ui/ReasonInput';
import { kdate } from '@/lib/ui-settings';

import { useCallback, useEffect, useState } from 'react';
import { Unit } from '@/components/ui/display';
import { apiClient } from '@/lib/api-client';
import { T, Tf, useTAttr } from '@/components/ui/i18n-text';
import StatusBadge from '@/components/ui/StatusBadge';

// HR 전자결재 수신함/상신함 (P0 INTERNAL 모드) — step-up 생체승인과 별개 섹션
interface InboxItem {
  relayId: string;
  docType?: string;
  title: string;
  createdAt: string;
  delegated?: boolean;
  leave: { id: string; type: string; fromDate: string; toDate: string; days: number; reason?: string | null; attachmentDocId?: string | null; sameDayLeaves?: number } | null;
  correction?: { workDate: string; correctedType: string; correctedAt: string; reason: string } | null;
  overtime?: { workDate: string; otType: string; hours: number; isPostFacto: boolean; reason: string } | null;
  drafter: { name: string; department?: string | null } | null;
}
interface OutboxItem {
  id: string; type: string; fromDate: string; toDate: string; days: number;
  status: string; createdAt: string;
  approvalLine: { order: number; result?: string; actedAt?: string; comment?: string }[];
  relayStatus: string | null;
}

const LEAVE_TYPE: Record<string, string> = { ANNUAL: '연차', SICK: '병가', HALF: '반차', OUTING: '외출', CORRECTION: '근태정정' };
// 🔴 (2026-09-14) 로컬 STATUS_BADGE 색표·삼항 라벨을 지웠다 — shared `HR_REQUEST_STATUS_LABEL` + `<StatusBadge domain="hrRequest">`
const unwrap = <T,>(r: unknown): T => {
  const raw = (r as { data?: unknown })?.data as { data?: T } | T | undefined;
  return ((raw as { data?: T })?.data ?? raw) as T;
};
const OT_TYPE: Record<string, string> = { EXTENDED: '연장', NIGHT: '야간', HOLIDAY: '휴일' };
const fmt = (d: string) =>kdate(d, 'monthDay');

/**
 * 🔴 (2026-09-12) 증빙 보기가 `<a href="/api/v1/…">` 였다 — 직원 JWT 는 **Authorization 헤더로만** 실리므로
 *    브라우저가 여는 링크는 토큰 없이 가고 **401**이 된다(개통 이래 열린 적이 없다). 토큰을 실어 받아 blob 으로 연다.
 *    실패는 서버가 말한 사유 그대로 알린다(조용히 빈 탭을 띄우지 않는다).
 */
async function openAttachment(relayId: string, tAttr: (k: string) => string): Promise<void> {
  const token = apiClient.getToken();
  try {
    const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || ''}/api/v1/ess/approvals/${relayId}/attachment`, {
      credentials: 'include', headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      const msg = (body as { error?: { message?: string } } | null)?.error?.message;
      alert(msg || `${tAttr('증빙을 불러오지 못했습니다')} (HTTP ${res.status})`);
      return;
    }
    const href = URL.createObjectURL(await res.blob());
    window.open(href, '_blank', 'noopener');
    setTimeout(() => URL.revokeObjectURL(href), 60_000);
  } catch (e) {
    alert((e as Error)?.message || tAttr('증빙을 불러오지 못했습니다'));
  }
}

export default function HrApprovalSection() {
  const [inbox, setInbox] = useState<InboxItem[]>([]);
  const [outbox, setOutbox] = useState<OutboxItem[]>([]);
  const [tab, setTab] = useState<'inbox' | 'outbox'>('inbox');
  const [rejectFor, setRejectFor] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const tAttr = useTAttr();

  const load = useCallback(async () => {
    try {
      const [i, o] = await Promise.all([
        apiClient.get('/api/v1/ess/approvals/inbox'),
        apiClient.get('/api/v1/ess/approvals/outbox'),
      ]);
      setInbox(unwrap<InboxItem[]>(i) ?? []);
      setOutbox(unwrap<OutboxItem[]>(o) ?? []);
    } catch { /* 미로그인 등 — 섹션 침묵 */ }
  }, []);

  useEffect(() => { void load(); const t = setInterval(load, 30000); return () => clearInterval(t); }, [load]);

  const decide = async (relayId: string, decision: 'APPROVED' | 'REJECTED') => {
    setBusy(true); setMsg(null);
    try {
      await apiClient.post(`/api/v1/ess/approvals/${relayId}/decide`, { decision, ...(decision === 'REJECTED' ? { comment: reason } : {}) });
      setMsg(decision === 'APPROVED' ? tAttr('승인했습니다') : tAttr('반려했습니다'));
      setRejectFor(null); setReason('');
      await load();
    } catch (e) {
      setMsg((e as { message?: string })?.message || tAttr('처리 실패'));
    } finally { setBusy(false); }
  };

  if (!inbox.length && !outbox.length) return null;

  return (
    <div className="mb-4 rounded-2xl bg-white border border-gray-100 shadow-sm overflow-hidden">
      <div className="flex items-center justify-between px-3.5 pt-3">
        <span className="text-sm font-bold text-gray-900">📋 <T k="전자결재 (휴가·근태)" /></span>
        <div className="flex gap-1 text-[11px]">
          {(['inbox', 'outbox'] as const).map((k) => (
            <button key={k} onClick={() => setTab(k)}
              className={`px-2 py-1 rounded-lg ${tab === k ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-500'}`}>
              {k === 'inbox' ? <Tf k="수신함 {수}" params={{ 수: inbox.length }} /> : <T k="상신함" />}
            </button>
          ))}
        </div>
      </div>
      {msg && <div className="mx-3.5 mt-2 rounded-lg bg-blue-50 px-3 py-1.5 text-[11px] text-blue-700">{msg}</div>}

      {tab === 'inbox' ? (
        <div className="divide-y divide-gray-50 mt-2">
          {!inbox.length ? (
            <div className="px-4 py-5 text-center text-xs text-gray-400"><T k="결재할 문서가 없습니다" /></div>
          ) : inbox.map((it) => (
            <div key={it.relayId} className="px-3.5 py-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-gray-900">
                  {it.drafter?.name ?? '—'} <span className="text-gray-400">{it.drafter?.department}</span>
                  {it.docType === 'HR_LEAVE_CANCEL' && <span className="ml-1 px-1 py-0.5 rounded text-[9px] bg-red-50 text-red-600"><T k="회수@행위" /></span>}
                  {it.delegated && <span className="ml-1 px-1 py-0.5 rounded text-[9px] bg-purple-50 text-purple-600"><T k="대결" /></span>}
                </span>
                <span className="text-[10px] text-gray-400">{fmt(it.createdAt)}</span>
              </div>
              {it.leave && (
                <div className="mt-1 text-[11px] text-gray-600">
                  <T k={LEAVE_TYPE[it.leave.type] ?? it.leave.type} /> · {fmt(it.leave.fromDate)}~{fmt(it.leave.toDate)} (<Tf k="{일수}일" params={{ 일수: it.leave.days }} />)
                  {it.leave.reason && <span className="text-gray-400"> — {it.leave.reason}</span>}
                  {typeof it.leave.sameDayLeaves === 'number' && it.leave.sameDayLeaves > 0 && (
                    <span className="ml-1 text-amber-600">· <Tf k="같은 기간 휴가 {건수}" params={{ 건수: <>{it.leave.sameDayLeaves}<Unit>건</Unit></> }} /></span>
                  )}
                  {it.leave.attachmentDocId && (
                    <button type="button" onClick={() => void openAttachment(it.relayId, tAttr)} className="ml-1 text-blue-600 underline"><T k="증빙 보기" /></button>
                  )}
                </div>
              )}
              {it.correction && (
                <div className="mt-1 text-[11px] text-gray-600">
                  <T k="근태정정" /> · {fmt(it.correction.workDate)} <T k={it.correction.correctedType === 'CLOCK_IN' ? '출근' : '퇴근'} /> → {kdate(it.correction.correctedAt, 'time')}
                  <span className="text-gray-400"> — {it.correction.reason}</span>
                </div>
              )}
              {it.overtime && (
                <div className="mt-1 text-[11px] text-gray-600">
                  <T k="초과근무" /> · {fmt(it.overtime.workDate)} <T k={OT_TYPE[it.overtime.otType] ?? it.overtime.otType} /> {it.overtime.hours}h{it.overtime.isPostFacto ? <> <T k="(사후)" /></> : ''}
                  <span className="text-gray-400"> — {it.overtime.reason}</span>
                </div>
              )}
              <div className="mt-2 flex gap-1.5">
                <button disabled={busy} onClick={() => decide(it.relayId, 'APPROVED')}
                  className="flex-1 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-medium disabled:opacity-40"><T k="승인@버튼" /></button>
                <button disabled={busy} onClick={() => setRejectFor(rejectFor === it.relayId ? null : it.relayId)}
                  className="flex-1 py-1.5 rounded-lg border border-red-200 text-red-600 text-xs font-medium disabled:opacity-40"><T k="반려@버튼" /></button>
              </div>
              {rejectFor === it.relayId && (
                <div className="mt-2 flex gap-1.5">
                  <div className="flex-1"><ReasonInput domain="approvalReject" required value={reason} onChange={setReason} placeholder="반려 사유(필수)"
                    className="w-full px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg" /></div>
                  <button disabled={busy || !reasonFilled(reason)} onClick={() => decide(it.relayId, 'REJECTED')}
                    className="px-3 py-1.5 rounded-lg bg-red-600 text-white text-xs disabled:opacity-40"><T k="확정@정산버튼" /></button>
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="divide-y divide-gray-50 mt-2">
          {!outbox.length ? (
            <div className="px-4 py-5 text-center text-xs text-gray-400"><T k="상신한 문서가 없습니다" /></div>
          ) : outbox.slice(0, 8).map((o) => (
            <div key={o.id} className="px-3.5 py-2.5 flex items-center justify-between">
              <div className="text-[11px] text-gray-700">
                <T k={LEAVE_TYPE[o.type] ?? o.type} /> · {fmt(o.fromDate)}~{fmt(o.toDate)} (<Tf k="{일수}일" params={{ 일수: o.days }} />)
                {o.approvalLine?.some((a) => a.comment) && (
                  <div className="text-[10px] text-red-500"><Tf k="사유: {사유}" params={{ 사유: o.approvalLine.find((a) => a.comment)?.comment ?? '' }} /></div>
                )}
              </div>
              <StatusBadge domain="hrRequest" status={o.status} className="text-[10px]" />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
