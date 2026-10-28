'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { extractErrorMessage } from '@/lib/error-utils';
import { toast } from '@/stores/toast-store';
import { useHasRole } from '@/hooks/use-admin-write';
import { apiClient } from '@/lib/api-client';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { Ratio, KDate, Duration } from '@/components/ui/display';
import { pollMs } from '@/lib/ui-settings';
import { T, useTAttr } from '@/components/ui/i18n-text';

/**
 * 경보 등록부 관제(P0 · 읽기 전용) — 정본 `apps/api/src/modules/notification/alert-registry.ts`,
 * 기획서 `docs/01-plan/features/alert-registry.plan.md`.
 *
 * 🔴 이 화면은 **인구조사**다. tier·대상은 오늘 코드가 하는 대로 적힌 값이다.
 * 2026-10-09 — 승인은 코드 상수가 아니라 **승인 원장**(사람이 근거와 함께 기록 · 그때 값 snapshot)이다.
 *    승인 뒤 코드가 tier·대상·억제 창을 바꾸면 "승인 후 변경됨 — 재승인 필요"로 되돌아간다. 승인자 직책은 검증하지 못한다(근거로 남긴다).
 *    읽음률은 발화(분모)와 함께 낸다 — 발화 0 이면 0% 도 100% 도 아니라 산출 불가.
 *    미등재 코드는 막히지 않고 여기 모인다(막으면 방치된다).
 */
interface RegistryItem {
  code: string; label: string; domain: string; tier: 1 | 2 | 3 | 4; targetKind: string; targetRoles: string[];
  dedupHours: number | null; actionHref: string; approvedBy: string; reviewDue: string; budgetClass: string;
  emitters: string[]; note?: string;
  approval?: { status: 'UNAPPROVED' | 'APPROVED' | 'CHANGED'; approvedAt: string | null; basis: string | null; approvedBy: string | null };
  fired: number; read: number; medianReadMin: number | null; unreadOver24h: number; reviewOverdue: boolean;
}
interface RegistryReport {
  windowDays: number; generatedAt: string; items: RegistryItem[];
  unregistered: { sinceBoot: string; seen: Array<{ code: string; count: number; firstSeenAt: string; lastSeenAt: string; sampleTitle: string }>; inDb: Array<{ code: string; fired: number; read: number; seedOnly?: boolean }> };
  retentionDays: { read: number; unread: number; override: unknown };
  summary: { registered: number; unapproved: number; changedSinceApproval?: number; withoutDedup: number; attendingRouted: number; unregisteredCodesInDb: number };
}

const TIER_STYLE: Record<number, string> = { 1: 'bg-rose-100 text-rose-700', 2: 'bg-amber-100 text-amber-700', 3: 'bg-blue-100 text-blue-700', 4: 'bg-gray-100 text-gray-600' };
/** 🔴 `담당자` 는 먼저 등재된 카탈로그에서 "Contact person"(연락 담당자)이라 이 문맥(배정 대상)과 뜻이 다르다 → 문맥 키로 가른다 */
const TARGET_LABEL: Record<string, string> = { ATTENDING: '주치의', ROLE: '역할', ASSIGNEE: '담당자@경보대상', BROADCAST: '전체' };

/** 승인 칸 — 상태 · 근거 · 기록/철회(관리자) */
function ApprovalCell({ item }: { item: RegistryItem }) {
  const tAttr = useTAttr();
  const qc = useQueryClient();
  // 서버 @Roles(ADMIN) 와 같은 판정
  const canWrite = useHasRole();
  const [mode, setMode] = useState<'approve' | 'revoke' | null>(null);
  // 🔴 근거·사유는 빈칸으로 시작한다(지어 넣지 않는다)
  const [text, setText] = useState('');
  const mut = useMutation({
    mutationFn: () => {
      if (!canWrite) return Promise.reject(new Error(tAttr('경보 승인은 관리자가 기록합니다')));
      return mode === 'approve'
        ? apiClient.post(`/api/v1/notifications/registry/${encodeURIComponent(item.code)}/approve`, { basis: text.trim() })
        : apiClient.post(`/api/v1/notifications/registry/${encodeURIComponent(item.code)}/revoke`, { reason: text.trim() });
    },
    onSuccess: () => { toast.success(tAttr(mode === 'approve' ? '승인을 기록했습니다.' : '승인을 철회했습니다.')); setMode(null); setText(''); qc.invalidateQueries({ queryKey: ['alert-registry'] }); },
    onError: (e) => toast.error(extractErrorMessage(e) || tAttr('저장하지 못했습니다.')),
  });
  const st = item.approval?.status ?? 'UNAPPROVED';
  return (
    <div data-alert-approval={st}>
      <span className={st === 'APPROVED' ? 'text-emerald-700' : st === 'CHANGED' ? 'text-amber-700 font-semibold' : 'text-rose-600'}>
        <T k={st === 'APPROVED' ? '승인됨' : st === 'CHANGED' ? '승인 후 변경됨 — 재승인 필요' : '미승인'} />
      </span>
      {item.reviewOverdue && <span className="ml-1 text-[10px] text-amber-600"><T k="재검토 경과" /></span>}
      {st === 'APPROVED' && item.approval?.basis && <div className="text-[10px] text-gray-500" title={item.approval.basis}>{item.approval.basis.slice(0, 40)}{item.approval.approvedAt && <> · <KDate value={item.approval.approvedAt} /></>}</div>}
      {canWrite && !mode && (
        <div className="mt-0.5 flex gap-1">
          {st !== 'APPROVED' && <button type="button" onClick={() => setMode('approve')} className="rounded border border-gray-300 px-1.5 text-[10px]" data-alert-approve={item.code}><T k="승인 기록" /></button>}
          {st !== 'UNAPPROVED' && <button type="button" onClick={() => setMode('revoke')} className="rounded border border-gray-200 px-1.5 text-[10px] text-gray-500"><T k="철회" /></button>}
        </div>
      )}
      {mode && (
        <div className="mt-1 space-y-1">
          <input value={text} onChange={(e) => setText(e.target.value)} aria-label={tAttr(mode === 'approve' ? '승인 근거' : '철회 사유')}
            placeholder={tAttr(mode === 'approve' ? '근거 — 위원회 의결 번호·문서(5자 이상)' : '철회 사유(5자 이상)')} className="w-48 rounded border border-gray-200 px-1.5 py-0.5 text-[10px]" />
          <div className="flex gap-1">
            <button type="button" disabled={text.trim().length < 5 || mut.isPending} onClick={() => mut.mutate()} className="rounded bg-gray-900 px-1.5 text-[10px] text-white disabled:opacity-40" data-alert-approval-save>
              <T k="저장" />
            </button>
            <button type="button" onClick={() => { setMode(null); setText(''); }} className="rounded border border-gray-200 px-1.5 text-[10px]"><T k="취소" /></button>
          </div>
          {mode === 'approve' && <p className="text-[10px] text-gray-400"><T k="지금 단계·대상·억제 시간을 승인으로 남깁니다 — 승인자의 직책은 시스템이 확인하지 못합니다." /></p>}
        </div>
      )}
    </div>
  );
}

export function AlertRegistryPanel() {
  const tAttr = useTAttr();
  const [days, setDays] = useState(30);
  const [onlyFired, setOnlyFired] = useState(false);
  const q = useQuery({
    queryKey: ['alert-registry', days],
    queryFn: () => apiClient.get<{ data: RegistryReport }>(`/api/v1/notifications/registry?days=${days}`),
    refetchInterval: pollMs('slow'),
  });
  if (q.isError) return <QueryErrorFallback error={q.error} onRetry={q.refetch} size="compact" />;
  const r = q.data?.data;
  if (!r) return <div className="text-xs text-gray-400 py-4"><T k="경보 등록부 불러오는 중…" /></div>;

  const items = onlyFired ? r.items.filter((i) => i.fired > 0) : r.items;
  const totalFired = r.items.reduce((s, i) => s + i.fired, 0);
  const totalRead = r.items.reduce((s, i) => s + i.read, 0);

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 space-y-3" data-panel="alert-registry">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-bold text-gray-900"><T k="경보 등록부" /> <span className="text-xs font-normal text-gray-400"><T k="인구조사 · 승인은 원장" /></span></h3>
          <p className="text-[11px] text-gray-500 mt-0.5">
            <T k="등재@경보등록부" /> {r.summary.registered}<T k="종" /> · <span className="text-rose-600 font-semibold"><T k="미승인" /> {r.summary.unapproved}</span>{(r.summary.changedSinceApproval ?? 0) > 0 && <> (<T k="승인 후 변경" /> {r.summary.changedSinceApproval})</>} · <T k="억제 없음" /> {r.summary.withoutDedup} ·
            {' '}<T k="주치의 직행" /> {r.summary.attendingRouted} · <T k="DB 미등재 코드" /> {r.summary.unregisteredCodesInDb}
          </p>
        </div>
        <div className="flex items-center gap-2 text-[11px]">
          <select value={days} onChange={(e) => setDays(Number(e.target.value))} className="border border-gray-200 rounded-lg px-2 py-1">
            <option value={7}>{tAttr('7일')}</option><option value={30}>{tAttr('30일')}</option><option value={90}>{tAttr('90일')}</option><option value={180}>{tAttr('180일')}</option>
          </select>
          <label className="flex items-center gap-1 text-gray-600"><input type="checkbox" checked={onlyFired} onChange={(e) => setOnlyFired(e.target.checked)} /> <T k="발화 있는 것만" /></label>
        </div>
      </div>

      {/* 🔴 baseline 창의 한계 — 원장이 삭제된다 */}
      <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-2 py-1">
        <T k="보존:" /> <T k="읽음" /> {r.retentionDays.read}<T k="일" /> · <T k="미읽음" /> {r.retentionDays.unread}<T k="일 뒤 삭제" />(config `notification.retentionDays`) — <T k="이 표의 분모는 그 창 안의 것이다." />
        {' '}<T k="전체" /> {r.windowDays}<T k="일" /> <T k="발화" /> {totalFired}<T k="건" /> · <T k="읽음" /> <Ratio numerator={totalRead} denominator={totalFired} unavailableHint="발화 없음" />
      </p>

      <div className="overflow-x-auto">
        <table className="w-full text-[11px]">
          <thead className="text-gray-500 border-b border-gray-100">
            <tr>
              <th className="text-left py-1 pr-2"><T k="코드 · 라벨" /></th>
              <th className="text-left pr-2"><T k="영역" /></th>
              <th className="text-center pr-2">tier</th>
              <th className="text-left pr-2"><T k="대상" /></th>
              <th className="text-center pr-2"><T k="억제" /></th>
              <th className="text-left pr-2"><T k="액션" /></th>
              <th className="text-right pr-2"><T k="발화" /></th>
              <th className="text-right pr-2"><T k="읽음 n/N" /></th>
              <th className="text-right pr-2"><T k="읽음 중앙값" /></th>
              <th className="text-right pr-2"><T k="24h+ 미확인" /></th>
              <th className="text-left"><T k="승인" /></th>
            </tr>
          </thead>
          <tbody>
            {items.map((i) => (
              <tr key={i.code} className="border-b border-gray-50 align-top">
                <td className="py-1 pr-2">
                  <div className="font-mono text-gray-800">{i.code}</div>
                  <div className="text-gray-500">{i.label}{i.note && <span className="ml-1 text-gray-400" title={i.note}>ⓘ</span>}</div>
                </td>
                <td className="pr-2 text-gray-600">{i.domain}</td>
                <td className="pr-2 text-center"><span className={`px-1.5 py-0.5 rounded font-bold ${TIER_STYLE[i.tier]}`}>{i.tier}</span></td>
                <td className="pr-2 text-gray-600"><T k={TARGET_LABEL[i.targetKind] ?? i.targetKind} />{i.targetRoles.length ? ` · ${i.targetRoles.join('/')}` : ''}</td>
                <td className="pr-2 text-center">{i.dedupHours == null ? <span className="text-gray-300">—</span> : `${i.dedupHours}h`}</td>
                <td className="pr-2 font-mono text-gray-500">{i.actionHref}</td>
                <td className="pr-2 text-right tabular-nums">{i.fired}</td>
                <td className="pr-2 text-right tabular-nums"><Ratio numerator={i.read} denominator={i.fired} pctOnly decimals={0} unavailableHint="발화 0" /></td>
                <td className="pr-2 text-right tabular-nums">{i.medianReadMin == null ? <span className="text-gray-300" title={tAttr('읽힌 건이 없음')}>—</span> : <Duration minutes={i.medianReadMin} dense />}</td>
                <td className={`pr-2 text-right tabular-nums ${i.unreadOver24h > 0 && i.tier <= 2 ? 'text-rose-600 font-semibold' : ''}`}>{i.unreadOver24h}</td>
                <td><ApprovalCell item={i} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {(r.unregistered.inDb.length > 0 || r.unregistered.seen.length > 0) && (
        <div className="rounded-lg border border-rose-100 bg-rose-50/40 p-2 text-[11px]">
          <p className="font-semibold text-rose-700"><T k="미등재 코드 — 막지 않았다, 세었다" /></p>
          {r.unregistered.inDb.length > 0 && (
            <p className="text-gray-700 mt-0.5">DB({r.windowDays}<T k="일" />): {r.unregistered.inDb.map((u) => `${u.code}(${u.fired}${u.seedOnly ? '·시드 전용' : ''})`).join(' · ')}</p>
          )}
          {r.unregistered.seen.length > 0 && (
            <p className="text-gray-700 mt-0.5"><T k="기동 후" />(<KDate value={r.unregistered.sinceBoot} mode="datetime" />·<T k="재기동 시 초기화" />): {r.unregistered.seen.map((u) => `${u.code}(${u.count})`).join(' · ')}</p>
          )}
        </div>
      )}
      <p className="text-[11px] text-gray-400"><T k="기준" /> <KDate value={r.generatedAt} mode="datetime" /> · <T k="tier·대상은 현행 코드 실측이다 — 승인 칸이 '승인됨'인 경보만 그 값이 사람이 승인한 값과 같다." /></p>
    </div>
  );
}
