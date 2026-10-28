'use client';

import { useState } from 'react';
import { Unit } from '@/components/ui/display';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { pollMs } from '@/lib/ui-settings';
import { toast } from '@/stores/toast-store';
import { useAuthStore } from '@/stores/auth-store';
import { ProposeAgendaButton } from '@/components/governance/ProposeAgendaModal';
import { GoLiveBriefing } from '@/components/golive/GoLiveBriefing';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { T, useTAttr } from '@/components/ui/i18n-text';
import { ServerText } from '@/components/ui/server-text';
import type { ServerMessage } from '@hospital-run/shared';

interface Item {
  id: string; area: string; areaLabel: string; key: string; title: string; type: string;
  owner?: string | null; status: string; detail?: string; detailMsg?: ServerMessage | null; auto: boolean; overdue?: boolean;
  evidence?: 'VERIFIED' | 'SELF_REPORTED';
  blocker?: string | null; drillDown?: string | null; targetMode?: string | null;
  isBlocking: boolean; targetDate?: string | null; updatedAt: string;
  approvalCount?: number; lastApproval?: { action: string; actorName: string; reason: string; at: string } | null;
  note?: string | null; // 개시 시 확인 사항(레지스트리 정본)
}
interface AreaRoll { area: string; label: string; total: number; ready: number; blocked: number }
/** 준비율 분해 — 실검증과 자가신고를 섞지 않는다(섞인 숫자는 스스로를 증명한다) */
interface Readiness {
  computable: boolean; pct: number | null; verifiedPct: number | null;
  total: number; ready: number; verifiedReady: number; selfReportedReady: number; basis: string; basisMsg?: ServerMessage | null;
}
interface Rollup {
  readinessPct: number | null; blockingTotal: number; blockingReady: number; overdueCount: number; canGoLive: boolean;
  readiness: Readiness; areas: AreaRoll[]; criticalPath: Item[]; items: Item[];
}

const unwrap = <T,>(d: unknown): T => {
  const raw = (d as { data?: unknown })?.data;
  return (raw && typeof raw === 'object' && 'data' in (raw as object) ? (raw as { data: T }).data : raw) as T;
};

const STATUS_META: Record<string, { label: string; cls: string }> = {
  NOT_READY: { label: '미준비', cls: 'bg-gray-100 text-gray-500' },
  IN_PROGRESS: { label: '진행중', cls: 'bg-amber-100 text-amber-700' },
  READY: { label: '준비완료', cls: 'bg-emerald-100 text-emerald-700' },
  DONE: { label: '전환완료', cls: 'bg-emerald-600 text-white' },
  BLOCKED: { label: '차단', cls: 'bg-rose-100 text-rose-700' },
};
const TYPE_LABEL: Record<string, string> = { CONFIG_GATE: 'config 게이트', APPROVAL: '승인@명사', EXTERNAL: '외부', MANUAL: '수동', HARDWARE: '하드웨어', SERVICE_FLAG: '개시 설정', DB_PROBE: 'DB 실측' };
const STATUS_OPTS = ['NOT_READY', 'IN_PROGRESS', 'READY', 'DONE', 'BLOCKED'];

export default function GoLivePage() {
  const [areaFilter, setAreaFilter] = useState('');
  /** 개시 회의용 브리핑 — 화면에서 미리 보고 인쇄한다(문서가 화면과 다르면 안 된다) */
  const [briefOpen, setBriefOpen] = useState(false);
  const { data, refetch, isLoading: rollupLoading, isError: rollupError, error: rollupErr } = useQuery({
    queryKey: ['go-live'],
    queryFn: () => apiClient.get('/api/v1/admin/go-live'),
    refetchInterval: pollMs('slow'),
  });
  const r = unwrap<Rollup>(data);
  const { data: trendData } = useQuery({
    queryKey: ['go-live-trend'],
    queryFn: () => apiClient.get('/api/v1/admin/go-live/trend'),
    refetchInterval: pollMs('slow'),
  });
  const trend = unwrap<{ capturedOn: string; readinessPct: number }[]>(trendData) ?? [];
  const items = (r?.items ?? []).filter((i) => !areaFilter || i.area === areaFilter);

  // 🔴 산출 불가(필수 항목 0건)를 100% 로 칠하지 않는다 — 색도 숫자도 '모름'이어야 한다
  const pct = r?.readiness?.computable ? r.readiness.pct : null;
  const gaugeColor = pct === null ? 'text-gray-400' : pct === 100 ? 'text-emerald-600' : pct >= 60 ? 'text-amber-500' : 'text-rose-500';

  return (
    <div className="p-4 max-w-[1400px] mx-auto">
      <div className="mb-4 flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-gray-900"><T k="운영 전환(Go-Live) 관제" /></h1>
          <p className="text-sm text-gray-500"><T k="실운영 전환에 필요한 게이트·승인·외부·데이터·인프라 항목을 한 곳에서 관제합니다." /></p>
          <p className="text-[11px] text-gray-400 mt-0.5">
            🔴 <T k="기술 항목이 모두 준비돼도" /> <b><T k="개시 전 필수 사람 결정" /></b> <T k="없이는 개시할 수 없습니다 —" />{' '}
            <a href="/admin/decisions" className="text-blue-600 underline underline-offset-2"><T k="결정 등록부(2415)" /></a>
          </p>
        </div>
        <button onClick={() => setBriefOpen((o) => !o)}
          className="shrink-0 px-3.5 py-2 text-sm font-semibold bg-gray-900 text-white rounded-xl hover:bg-gray-800">
          <T k={briefOpen ? '브리핑 닫기' : '📄 개시 브리핑'} />
        </button>
      </div>

      {briefOpen && r && (
        <div className="mb-5">
          <GoLiveBriefing rollup={r as never} />
        </div>
      )}

      {/* 🔴 최상위 조회 실패·로딩을 구분한다 — 종전엔 `{r && …}` 하나라 실패하면 게이지·항목이
          통째로 사라지고 제목만 남았다(영구 로딩으로 굳는다) */}
      {rollupLoading && !r && <div className="py-12 text-center text-sm text-gray-400"><T k="불러오는 중…" /></div>}
      {rollupError && !r && <QueryErrorFallback error={rollupErr} onRetry={() => refetch()} />}
      {r && (
        <>
          {/* 준비도 게이지 + 배너 */}
          <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-4 mb-4">
            <div className="bg-white rounded-2xl border border-gray-100 p-5 flex flex-col items-center justify-center">
              {pct === null ? (
                <>
                  <div className="text-2xl font-bold text-gray-400"><T k="산출 불가" /></div>
                  <p className="text-xs text-gray-500 mt-1 text-center">{r.readiness ? <ServerText msg={r.readiness.basisMsg} fallback={r.readiness.basis} /> : <T k="필수 항목이 없어 준비율을 낼 수 없습니다" />}</p>
                </>
              ) : (
                <>
                  <div className={`text-5xl font-bold ${gaugeColor}`}>{pct}<span className="text-2xl">%</span></div>
                  <p className="text-xs text-gray-500 mt-1"><T k="전환 준비도" /> (<T k="필수" /> {r.blockingReady}/{r.blockingTotal})</p>
                  <div className="w-full h-2 bg-gray-100 rounded-full mt-3 overflow-hidden">
                    <div className={`h-full rounded-full ${pct === 100 ? 'bg-emerald-500' : pct >= 60 ? 'bg-amber-400' : 'bg-rose-400'}`} style={{ width: `${pct}%` }} />
                  </div>
                  {/* 근거 종류 — 시스템이 확인한 것과 사람이 신고한 것을 갈라서 보여준다 */}
                  <p className="text-[10px] text-gray-500 mt-2 text-center leading-relaxed">
                    <T k="시스템 실검증" /> <span className="font-semibold text-gray-700">{r.readiness.verifiedReady}</span>
                    {' · '}<T k="담당자 자가신고" /> <span className="font-semibold text-gray-700">{r.readiness.selfReportedReady}</span>
                    {' / '}<T k="필수" /> {r.readiness.total}
                    {r.readiness.selfReportedReady > 0 && (
                      <span className="block text-amber-600 mt-0.5">자가신고 {r.readiness.selfReportedReady}건은 시스템이 확인한 사실이 아닙니다</span>
                    )}
                  </p>
                </>
              )}
              {trend.length > 1 && <Sparkline data={trend.map((t) => t.readinessPct)} />}
            </div>
            <div className={`rounded-2xl border p-5 flex items-center ${r.canGoLive ? 'bg-emerald-50 border-emerald-200' : pct === null ? 'bg-gray-50 border-gray-200' : 'bg-amber-50 border-amber-100'}`}>
              {pct === null ? (
                /* 🔴 분모가 비면 "막는 항목 0건"으로 읽히지 않게 못 센다는 사실을 말한다 */
                <div>
                  <p className="text-lg font-bold text-gray-700"><T k="판정 불가" /></p>
                  <p className="text-sm text-gray-600 mt-0.5"><T k="필수(blocking) 항목이 등재돼 있지 않아 전환 가능 여부를 판정할 수 없습니다. 레지스트리 시딩을 확인하세요." /></p>
                </div>
              ) : r.canGoLive ? (
                <div><p className="text-lg font-bold text-emerald-800">✅ <T k="실운영 전환 가능" /></p><p className="text-sm text-emerald-700 mt-0.5"><T k="필수 전환 항목이 모두 준비되었습니다. 각 항목 상세에서 개별 실행하세요." /></p></div>
              ) : (
                <div>
                  <p className="text-lg font-bold text-amber-800"><T k="전환을 막는 항목" /> {r.criticalPath.length}건{r.overdueCount > 0 && <span className="text-rose-600"> · <T k="목표일 지연" /> {r.overdueCount}<Unit>건</Unit></span>}</p>
                  <p className="text-sm text-amber-700 mt-0.5"><T k="아래 크리티컬 패스의 항목을 담당자가 해소해야 실운영 전환이 가능합니다." /></p>
                </div>
              )}
            </div>
          </div>

          {/* 크리티컬 패스 */}
          {r.criticalPath.length > 0 && (
            <div className="bg-white rounded-xl border border-rose-100 p-3 mb-4">
              <p className="text-xs font-semibold text-rose-700 mb-2">🚧 <T k="크리티컬 패스 — 실운영을 막는 필수 항목" /></p>
              <div className="space-y-1.5">
                {r.criticalPath.map((it) => (
                  <div key={it.key} className="flex items-center gap-2 text-xs">
                    <span className={`px-1.5 py-0.5 rounded font-medium ${STATUS_META[it.status]?.cls}`}><T k={STATUS_META[it.status]?.label ?? it.status} /></span>
                    <span className="font-medium text-gray-800">{it.title}</span>
                    <span className="text-gray-400">· {it.areaLabel} · {it.owner ?? <T k="미지정" />}</span>
                    {(it.detailMsg || it.detail) && <span className="text-gray-400">· <ServerText msg={it.detailMsg} fallback={it.detail} /></span>}
                    {it.drillDown && <a href={it.drillDown} className="ml-auto text-blue-600 hover:underline shrink-0"><T k="상세 →" /></a>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 영역 롤업 */}
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2 mb-4">
            <button onClick={() => setAreaFilter('')} className={`rounded-xl border p-2 text-left ${!areaFilter ? 'border-blue-400 bg-blue-50' : 'border-gray-100 bg-white'}`}>
              <p className="text-[10px] text-gray-500"><T k="전체" /></p>
              <p className="text-lg font-bold text-gray-800">{r.items.length}</p>
            </button>
            {r.areas.map((a) => (
              <button key={a.area} onClick={() => setAreaFilter(a.area === areaFilter ? '' : a.area)}
                className={`rounded-xl border p-2 text-left ${areaFilter === a.area ? 'border-blue-400 bg-blue-50' : 'border-gray-100 bg-white'}`}>
                <p className="text-[10px] text-gray-500 truncate">{a.area}. {a.label}</p>
                <p className="text-sm font-bold text-gray-800">{a.ready}/{a.total}{a.blocked > 0 && <span className="text-rose-500 text-xs"> ⚠{a.blocked}</span>}</p>
              </button>
            ))}
          </div>

          {/* 항목 리스트 */}
          <div className="space-y-2">
            {items.map((it) => <ItemRow key={it.key} item={it} onChanged={refetch} />)}
          </div>
        </>
      )}
    </div>
  );
}

function Sparkline({ data }: { data: number[] }) {
  const w = 220, h = 28, max = 100;
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * w},${h - (v / max) * h}`).join(' ');
  return (
    <div className="mt-2 w-full">
      <p className="text-[9px] text-gray-400 mb-0.5"><T k="준비도 추이" /> ({data.length}<Unit>일</Unit>)</p>
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-7" preserveAspectRatio="none">
        <polyline points={pts} fill="none" stroke="#3b82f6" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
      </svg>
    </div>
  );
}

function ItemRow({ item, onChanged }: { item: Item; onChanged: () => void }) {
  const tAttr = useTAttr();
  /**
   * 🔴 경영진(EXECUTIVE)은 이 관제를 **읽기 전용**으로 본다 — 서버가 `PATCH items/:key`·`approve` 를
   *    ADMIN 에게만 열어 두므로, 버튼을 띄우면 누를 때마다 403 이다(dead-button 금지).
   *    '상정'은 위원회 안건 제출이라 그대로 둔다 — 경영진이 할 수 있는 일이 그쪽이다.
   */
  const canWrite = useAuthStore((st) => st.user?.role) === 'ADMIN';
  const [editing, setEditing] = useState(false);
  const [status, setStatus] = useState(item.status);
  const [blocker, setBlocker] = useState(item.blocker ?? '');
  const [owner, setOwner] = useState(item.owner ?? '');
  const [targetDate, setTargetDate] = useState(item.targetDate ? item.targetDate.slice(0, 10) : '');
  const [busy, setBusy] = useState(false);
  const st = STATUS_META[item.status] ?? { label: item.status, cls: 'bg-gray-100 text-gray-500' };

  const save = async () => {
    setBusy(true);
    try {
      await apiClient.patch(`/api/v1/admin/go-live/items/${item.key}`, { ...(item.auto ? {} : { status }), blocker, owner, targetDate });
      toast.success(tAttr('저장되었습니다.')); setEditing(false); onChanged();
    } catch (e) { toast.error((e as { message?: string })?.message || tAttr('저장 실패')); }
    setBusy(false);
  };

  const approve = async () => {
    const reason = window.prompt(`"${item.title}" ` + tAttr('승인 근거(사유)를 입력하세요'));
    if (!reason?.trim()) return;
    try {
      await apiClient.post(`/api/v1/admin/go-live/items/${item.key}/approve`, { action: 'APPROVE', reason: reason.trim() });
      toast.success(tAttr('승인이 기록되었습니다.')); onChanged();
    } catch (e) { toast.error((e as { message?: string })?.message || tAttr('승인 실패')); }
  };

  return (
    <div className={`bg-white border rounded-xl p-3 ${item.status === 'BLOCKED' ? 'border-rose-200' : 'border-gray-100'}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[10px] px-1.5 py-0.5 bg-gray-100 text-gray-500 rounded shrink-0">{item.area}</span>
          <span className="text-sm font-medium text-gray-900 truncate">{item.title}</span>
          {!item.isBlocking && <span className="text-[10px] px-1 py-0.5 bg-gray-50 text-gray-400 rounded shrink-0"><T k="선택" /></span>}
          {item.auto && <span className="text-[10px] px-1 py-0.5 bg-indigo-50 text-indigo-500 rounded shrink-0"><T k="자동" /></span>}
          {/* 🔴 준비완료로 보이는 근거가 사람의 신고인지 시스템 확인인지 항목마다 밝힌다 */}
          {item.evidence === 'VERIFIED'
            ? <span className="text-[10px] px-1 py-0.5 bg-sky-50 text-sky-600 rounded shrink-0" title={tAttr('시스템이 config·DB 를 조회해 확인한 상태')}><T k="실검증" /></span>
            : <span className="text-[10px] px-1 py-0.5 bg-amber-50 text-amber-600 rounded shrink-0" title={tAttr('담당자가 화면에서 표시한 상태 — 근거는 시스템 밖에 있습니다')}><T k="자가신고" /></span>}
          {item.overdue && <span className="text-[10px] px-1 py-0.5 bg-rose-100 text-rose-600 rounded font-medium shrink-0"><T k="지연" /></span>}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {(item.approvalCount ?? 0) > 0 && <span className="text-[10px] px-1.5 py-0.5 bg-cyan-50 text-cyan-700 rounded font-medium" title={item.lastApproval ? `${item.lastApproval.actorName}: ${item.lastApproval.reason}` : ''}>✔ <T k="승인@명사" /> {item.approvalCount}</span>}
          <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${st.cls}`}><T k={st.label} /></span>
          {item.drillDown && <a href={item.drillDown} className="text-[11px] text-blue-600 hover:underline"><T k="상세" /></a>}
          {canWrite && <button onClick={approve} className="text-[11px] text-cyan-600 hover:underline"><T k="승인@버튼" /></button>}
          <ProposeAgendaButton
            sourceRef={{ type: 'GO_LIVE', key: item.key }}
            defaultTitle={`[Go-Live] ${item.title} — 운영 개시 판단`}
            defaultBody={`항목: ${item.key} (${item.areaLabel})\n상태: ${STATUS_META[item.status]?.label ?? item.status}${item.owner ? `\n담당: ${item.owner}` : ''}${item.blocker ? `\n막는 사유: ${item.blocker}` : ''}${item.targetDate ? `\n목표일: ${item.targetDate.slice(0, 10)}` : ''}${item.note ? `\n확인 사항: ${item.note}` : ''}`}
            className="text-[11px] text-indigo-500 hover:underline whitespace-nowrap" label={tAttr('상정')} />
          {canWrite
            ? <button onClick={() => setEditing(!editing)} className="text-[11px] text-gray-400 hover:text-gray-600"><T k={editing ? '접기' : '편집'} /></button>
            : <span className="text-[10px] text-gray-300" title={tAttr('개시 항목 편집·승인은 관리자 권한입니다')}><T k="읽기 전용" /></span>}
        </div>
      </div>
      <div className="flex items-center gap-2 text-[10px] text-gray-400 mt-1 flex-wrap">
        <span><T k={TYPE_LABEL[item.type] ?? item.type} /></span>
        {item.owner && <><span>·</span><span>{item.owner}</span></>}
        {(item.detailMsg || item.detail) && <><span>·</span><span><ServerText msg={item.detailMsg} fallback={item.detail} /></span></>}
        {item.targetDate && <><span>·</span><span className={item.overdue ? 'text-rose-500 font-medium' : ''}><T k="목표" /> {item.targetDate.slice(0, 10)}</span></>}
        {item.blocker && <><span>·</span><span className="text-rose-500"><T k="막힘" />: {item.blocker}</span></>}
      </div>
      {/* 개시 시 확인 사항 — 무엇을 판단해야 하는지(레지스트리 정본) */}
      {item.note && <p className="text-[10px] text-gray-500 bg-gray-50 border border-gray-100 rounded-lg px-2 py-1 mt-1.5 leading-relaxed">{item.note}</p>}
      {editing && (
        <div className="mt-2 pt-2 border-t border-gray-100 grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
          <label className="flex flex-col gap-0.5"><T k="상태" />
            <select value={status} disabled={item.auto} onChange={(e) => setStatus(e.target.value)} className="border border-gray-200 rounded px-2 py-1 bg-white disabled:bg-gray-50">
              {STATUS_OPTS.map((s) => <option key={s} value={s}>{tAttr(STATUS_META[s].label)}</option>)}
            </select>
            {item.auto && <span className="text-[9px] text-gray-400"><T k="자동 파생(상세 화면에서 조작)" /></span>}
          </label>
          <label className="flex flex-col gap-0.5"><T k="담당@개원" />
            <input value={owner} onChange={(e) => setOwner(e.target.value)} className="border border-gray-200 rounded px-2 py-1" />
          </label>
          <label className="flex flex-col gap-0.5"><T k="막는 사유" />
            <input value={blocker} onChange={(e) => setBlocker(e.target.value)} className="border border-gray-200 rounded px-2 py-1" />
          </label>
          <label className="flex flex-col gap-0.5"><T k="목표일" />
            <input type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} className="border border-gray-200 rounded px-2 py-1" />
          </label>
          <button onClick={save} disabled={busy} className="sm:col-span-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"><T k="저장" /></button>
        </div>
      )}
    </div>
  );
}
