'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { pollMs, kdate } from '@/lib/ui-settings';
import { toast } from '@/stores/toast-store';

import { EmptyState, Ratio, Unit, Duration } from '@/components/ui/display';
import { AI_ORIGIN_TEXT } from '@hospital-run/shared';
import { DraftBanner, type DraftProvenance } from '@/components/ai/DraftBanner';
import { T, useTAttr } from '@/components/ui/i18n-text';

interface InboxItem {
  kind: 'ticket' | 'consult'; id: string; ref: string; type: string; status: string; severity: string;
  channel: string; title: string; department?: string | null; assigneeId?: string | null;
  dueAt?: string | null; firstResponseAt?: string | null; overdue?: boolean; waitingSec?: number;
  escalationLevel?: number; identityVerified?: boolean;
  patient?: { mrn: string; name: string } | null; updatedAt: string; createdAt: string;
}
interface Kpi { unassigned: number; overdue: number; openTickets: number; waitingConsult: number }
interface TicketMsg { id: string; authorType: string; authorName?: string | null; body: string; internal: boolean; aiDraft: boolean; createdAt: string }
interface TicketDetail {
  id: string; ticketNo: string; type: string; status: string; severity: string; channel: string;
  title: string; department?: string | null; category?: string | null; assigneeId?: string | null;
  dueAt?: string | null; firstResponseAt?: string | null; identityVerified: boolean;
  submitterName?: string | null; contactPhone?: string | null; contactEmail?: string | null;
  messages: TicketMsg[];
  attachments?: { id: string; url: string; fileName: string; uploadedBy: string }[];
  patient?: { id: string; mrn: string; familyName: string; givenName: string; dateOfBirth?: string; gender?: string; phone?: string } | null;
}

const VOC_API_BASE = process.env.NEXT_PUBLIC_API_URL || '';

const unwrap = <T,>(d: unknown): T => {
  const raw = (d as { data?: unknown })?.data;
  return (raw && typeof raw === 'object' && 'data' in (raw as object) ? (raw as { data: T }).data : raw) as T;
};

const TYPE_LABEL: Record<string, string> = { QUESTION: '질문', COMPLAINT: '불만', SUGGESTION: '건의', COMPLIMENT: '칭찬', CONSULT: '상담' };
const STATUS_LABEL: Record<string, string> = {
  // 🔴 상태 어휘는 동작 버튼과 원문이 겹친다(접수/분류/종결) — 기존 카탈로그 en 이
  //    Reception·Category·Close(명령형)라 상태 배지에 그대로 쓰면 거짓이 된다. 문맥 키로 가른다.
  RECEIVED: '접수@티켓상태', TRIAGED: '분류@티켓상태', IN_PROGRESS: '처리중', ANSWERED: '답변완료', ON_HOLD: '보류', CLOSED: '종결@티켓상태', REOPENED: '재문의',
  OPEN: '대기', WAITING: '대기', ACTIVE: '상담중',
};
const SEV_TONE: Record<string, string> = { LOW: 'text-gray-500', NORMAL: 'text-gray-600', HIGH: 'text-amber-600', URGENT: 'text-rose-600' };
const STATUS_OPTS = ['RECEIVED', 'TRIAGED', 'IN_PROGRESS', 'ANSWERED', 'ON_HOLD', 'CLOSED', 'REOPENED'];
const SEV_OPTS = ['LOW', 'NORMAL', 'HIGH', 'URGENT'];

export default function VocAdminPage() {
  const tAttr = useTAttr();
  const [view, setView] = useState<'inbox' | 'analytics'>('inbox');
  const [status, setStatus] = useState('');
  const [type, setType] = useState('');
  const [sla, setSla] = useState('');
  const [channel, setChannel] = useState('');
  const [selId, setSelId] = useState<string | null>(null);

  const qs = new URLSearchParams();
  if (status) qs.set('status', status);
  if (type) qs.set('type', type);
  if (sla) qs.set('sla', sla);
  if (channel) qs.set('channel', channel);

  const { data, refetch } = useQuery({
    queryKey: ['voc-inbox', status, type, sla, channel],
    queryFn: () => apiClient.get(`/api/v1/admin/voc/inbox?${qs.toString()}`),
    refetchInterval: pollMs('normal'),
  });
  const inbox = unwrap<{ items: InboxItem[]; kpi: Kpi }>(data);
  const items = inbox?.items ?? [];
  const kpi = inbox?.kpi;

  return (
    <div className="p-4 max-w-[1400px] mx-auto">
      <div className="mb-4 flex items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold text-gray-900"><T k="고객의 소리(VoC) 관제" /></h1>
          <p className="text-sm text-gray-500"><T k="홈페이지 접수·포털 상담실을 통합 관리합니다." /></p>
        </div>
        <div className="flex bg-gray-100 rounded-lg p-0.5 text-xs">
          {(['inbox', 'analytics'] as const).map((v) => (
            <button key={v} onClick={() => setView(v)}
              className={`px-3 py-1.5 rounded-md font-medium transition-colors ${view === v ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}>
              <T k={v === 'inbox' ? '인박스' : '통계'} />
            </button>
          ))}
        </div>
      </div>

      {view === 'analytics' ? <AnalyticsPanel /> : <>

      {/* KPI */}
      {kpi && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
          <Kpi label="미배정" value={kpi.unassigned} tone="text-blue-600" />
          <Kpi label="SLA 초과" value={kpi.overdue} tone="text-rose-600" />
          <Kpi label="미종결 티켓" value={kpi.openTickets} tone="text-gray-800" />
          <Kpi label="대기 상담" value={kpi.waitingConsult} tone="text-amber-600" />
        </div>
      )}

      {/* 필터 */}
      <div className="flex flex-wrap gap-2 mb-3 text-xs">
        <Select value={channel} onChange={setChannel} opts={[['', '전체 채널'], ['ticket', '접수 티켓'], ['consult', '상담 세션']]} />
        <Select value={status} onChange={setStatus} opts={[['', '전체 상태'], ...STATUS_OPTS.map((s) => [s, STATUS_LABEL[s]] as [string, string])]} />
        <Select value={type} onChange={setType} opts={[['', '전체 유형'], ['QUESTION', '질문'], ['COMPLAINT', '불만'], ['SUGGESTION', '건의'], ['COMPLIMENT', '칭찬']]} />
        <button onClick={() => setSla(sla ? '' : 'overdue')}
          className={`px-3 py-1.5 rounded-lg border transition-colors ${sla ? 'bg-rose-50 border-rose-300 text-rose-700' : 'bg-white border-gray-200 text-gray-600'}`}>
          <T k="SLA 초과만" />
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[380px_1fr] gap-4">
        {/* 인박스 */}
        <div className="space-y-2 max-h-[calc(100vh-260px)] overflow-y-auto">
          {items.length === 0 ? (
            <EmptyState icon="📋" title="항목이 없습니다." className="bg-white rounded-xl border border-gray-100" />
          ) : items.map((it) => (
            <div key={`${it.kind}-${it.id}`}
              onClick={() => it.kind === 'ticket' ? setSelId(it.id) : (window.location.href = '/consult')}
              className={`cursor-pointer bg-white border rounded-xl p-3 transition-colors ${selId === it.id ? 'border-blue-400 ring-1 ring-blue-200' : 'border-gray-100 hover:border-blue-200'}`}>
              <div className="flex items-center justify-between gap-2 mb-1">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${it.kind === 'consult' ? 'bg-indigo-50 text-indigo-600' : 'bg-gray-100 text-gray-600'}`}><T k={TYPE_LABEL[it.type] ?? it.type} /></span>
                  <span className="text-sm font-medium text-gray-900 truncate">{it.title || <T k="(제목 없음)" />}</span>
                </div>
                <span className={`shrink-0 text-[10px] font-semibold ${SEV_TONE[it.severity] ?? 'text-gray-500'}`}><T k={STATUS_LABEL[it.status] ?? it.status} /></span>
              </div>
              <div className="flex items-center gap-1.5 text-[10px] text-gray-400 flex-wrap">
                <span className="font-mono">{it.ref}</span>
                {it.patient && <><span>·</span><span>{it.patient.name}{it.identityVerified === false ? <T k="(미확인)" /> : ''}</span></>}
                {it.overdue && <span className="px-1 py-0.5 bg-rose-100 text-rose-600 rounded font-medium"><T k="SLA 초과" /></span>}
                {typeof it.waitingSec === 'number' && it.waitingSec > 0 && <span className="px-1 py-0.5 bg-amber-100 text-amber-700 rounded font-medium"><T k="대기" /> <Duration minutes={Math.floor(it.waitingSec / 60)} /></span>}
                {!it.assigneeId && <span className="px-1 py-0.5 bg-blue-50 text-blue-600 rounded"><T k="미배정" /></span>}
                {it.kind === 'consult' && (
                  <button onClick={(e) => { e.stopPropagation(); apiClient.post(`/api/v1/admin/voc/consult/${it.id}/promote`, { type: 'COMPLAINT' }).then(() => { toast.success('VoC 티켓으로 승격되었습니다.'); refetch(); }).catch((err) => toast.error((err as { message?: string })?.message || '승격 실패')); }}
                    className="ml-auto px-1.5 py-0.5 bg-violet-50 text-violet-700 rounded hover:bg-violet-100"><T k="VoC 승격" /></button>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* 상세 */}
        <div>
          {selId ? <TicketDetailPane id={selId} onChanged={refetch} /> : (
            <div className="text-center text-sm text-gray-400 py-24 bg-white rounded-xl border border-gray-100"><T k="티켓을 선택하세요. 상담 세션은 상담 데스크에서 처리됩니다." /></div>
          )}
        </div>
      </div>
      </>}
    </div>
  );
}

function AnalyticsPanel() {
  const tAttr = useTAttr();
  const { data } = useQuery({
    queryKey: ['voc-analytics'],
    queryFn: () => apiClient.get(`/api/v1/admin/voc/analytics?days=30`),
    refetchInterval: pollMs('slow'),
  });
  const a = unwrap<{
    total: number; consultCount: number; combinedTotal: number;
    byType: Record<string, number>; byStatus: Record<string, number>; byDept: Record<string, number>;
    avgFirstResponseHours: number | null; avgResolutionHours: number | null;
    slaComplianceRate: number | null; reopenRate: number | null; avgRating: number | null;
    // 🔴 2026-08-20 서버 추가 — 비율만 오던 것에 분자·분모를 붙였다.
    //    SLA 분모는 **기한(dueAt)이 있는 티켓 전량**이라 재오픈율 분모(티켓 전량)와 다르다.
    slaNumerator?: number; slaDenominator?: number; reopenNumerator?: number; reopenDenominator?: number;
  }>(data);
  if (!a) return <div className="text-sm text-gray-400 py-12 text-center"><T k="불러오는 중..." /></div>;

  return (
    <div className="space-y-4">
      <p className="text-xs text-gray-400">최근 30일 · 접수 티켓 {a.total}<Unit>건</Unit> + 상담 세션 {a.consultCount}<Unit>건</Unit> = 합산 {a.combinedTotal}<Unit>건</Unit></p>
      {/* 🔴 서버는 표본이 없으면 `null`(산출 불가)을 보내는데 FE 가 `?? 0` 으로 접었다 —
           "SLA 준수율 0%"(빨강 실패)와 "평균 첫응답 0h"(=즉시 응답, 초록)를 **동시에** 지어냈다(P1). */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Kpi label="SLA 준수(기한내/기한있는 티켓)" value={a.slaComplianceRate} tone="text-emerald-600" ratio={{ n: a.slaNumerator, d: a.slaDenominator, hint: tAttr('기한이 설정된 티켓 없음') }} />
        <Kpi label="평균 첫응답" value={a.avgFirstResponseHours} tone="text-blue-600" suffix="h" />
        <Kpi label="평균 처리시간" value={a.avgResolutionHours} tone="text-gray-800" suffix="h" />
        <Kpi label="재오픈(재오픈/전체 티켓)" value={a.reopenRate} tone="text-amber-600" ratio={{ n: a.reopenNumerator, d: a.reopenDenominator, hint: tAttr('기간 내 티켓 없음') }} />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <DistCard title={tAttr('유형별')} map={a.byType} labelMap={TYPE_LABEL} />
        <DistCard title={tAttr('상태별')} map={a.byStatus} labelMap={STATUS_LABEL} />
        <DistCard title={tAttr('부서별')} map={a.byDept} />
      </div>
      {a.avgRating != null && <p className="text-sm text-gray-600"><T k="답변 만족도 평균" /> <span className="font-bold text-gray-900">{a.avgRating}</span> / 5</p>}
    </div>
  );
}

function DistCard({ title, map, labelMap }: { title: string; map: Record<string, number>; labelMap?: Record<string, string> }) {
  const entries = Object.entries(map ?? {}).sort((x, y) => y[1] - x[1]);
  const max = Math.max(1, ...entries.map((e) => e[1]));
  return (
    <div className="bg-white rounded-xl border border-gray-100 p-3">
      <p className="text-xs font-semibold text-gray-700 mb-2">{title}</p>
      {entries.length === 0 ? <p className="text-xs text-gray-400"><T k="데이터 없음" /></p> : (
        <div className="space-y-1.5">
          {entries.map(([k, v]) => (
            <div key={k} className="flex items-center gap-2">
              <span className="text-[11px] text-gray-600 w-20 truncate">{labelMap?.[k] ? <T k={labelMap[k]} /> : k}</span>
              <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden"><div className="h-full bg-blue-400 rounded-full" style={{ width: `${(v / max) * 100}%` }} /></div>
              <span className="text-[11px] font-medium text-gray-700 w-6 text-right">{v}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** 🔴 `null` = 표본 부재(산출 불가). 0 으로 칠하지 않는다 — 0% 도 0h 도 값이지 '모름'이 아니다. */
/**
 * KPI 한 칸. `ratio` 를 주면 **분모와 함께** 그린다(정본 `<Ratio>`) — 비율에는 분모가 필수다(§3.3).
 * `ratio` 가 없는 지표(평균 시간 등)는 분자·분모가 애초에 없으므로 종전대로 값만 그린다.
 */
function Kpi({ label, value, tone, suffix, ratio }: {
  label: string; value: number | null | undefined; tone: string; suffix?: string;
  ratio?: { n: number | null | undefined; d: number | null | undefined; hint?: string };
}) {
  const tAttr = useTAttr();
  const unknown = value == null;
  return (
    // 🔴 라벨(SLA 준수(기한내/기한있는 티켓))이 4열에서 2~3줄로 접혀 행 높이가 튄다 —
    //    남는 높이는 위아래로 나누고, 값은 한 줄 고정한다.
    <div className="flex flex-col justify-center bg-white rounded-xl border border-gray-100 p-3">
      <p className="text-xs leading-tight text-gray-500"><T k={label} /></p>
      {ratio
        ? <p className={`text-xl font-bold pt-1 ${unknown ? 'text-gray-400' : tone}`}><Ratio numerator={ratio.n} denominator={ratio.d} unavailableHint={ratio.hint} /></p>
        : unknown
          ? <p className="text-base font-semibold text-gray-400 pt-1" title={tAttr('표본이 없어 산출할 수 없습니다')}><T k="산출 불가" /></p>
          : <p className={`text-2xl font-bold ${tone}`}>{value}{suffix && <span className="text-sm font-medium ml-0.5">{suffix}</span>}</p>}
    </div>
  );
}

function Select({ value, onChange, opts }: { value: string; onChange: (v: string) => void; opts: [string, string][] }) {
  const tAttr = useTAttr();
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className="px-3 py-1.5 border border-gray-200 rounded-lg bg-white text-gray-700">
      {opts.map(([v, l]) => <option key={v} value={v}>{tAttr(l)}</option>)}
    </select>
  );
}

function TicketDetailPane({ id, onChanged }: { id: string; onChanged: () => void }) {
  const tAttr = useTAttr();
  const [reply, setReply] = useState('');
  const [internal, setInternal] = useState(false);
  const [busy, setBusy] = useState(false);
  // 🔴 초안≠확정 — 답변이 AI 초안에서 출발했는지(프로비넌스). 발송 시 aiDraft 로 서버에 남고, 비우면 사라진다(§7.6-b)
  const [replyProvenance, setReplyProvenance] = useState<DraftProvenance | null>(null);

  const { data, refetch } = useQuery({
    queryKey: ['voc-ticket', id],
    queryFn: () => apiClient.get(`/api/v1/admin/voc/tickets/${id}`),
  });
  const t = unwrap<TicketDetail>(data);

  const act = async (fn: () => Promise<unknown>, okMsg?: string) => {
    setBusy(true);
    try { await fn(); if (okMsg) toast.success(okMsg); refetch(); onChanged(); }
    catch (e) { toast.error((e as { message?: string })?.message || '처리 실패'); }
    setBusy(false);
  };

  const send = () => {
    if (!reply.trim()) return;
    act(async () => {
      await apiClient.post(`/api/v1/admin/voc/tickets/${id}/messages`, { body: reply.trim(), internal, aiDraft: !!replyProvenance });
      setReply(''); setReplyProvenance(null);
    }, internal ? '내부 메모 저장' : '답변 등록');
  };

  const aiDraft = async () => {
    setBusy(true);
    try {
      const r = unwrap<{ mode: string; draft?: string }>(await apiClient.post(`/api/v1/admin/voc/tickets/${id}/ai/reply-assist`, { note: reply.trim() || undefined }));
      if (r.mode === 'off') toast.error(`${AI_ORIGIN_TEXT} 답변 보조가 비활성입니다(설정: voc.ai.enabled·voc.ai.replyAssist).`);
      else if (r.mode === 'error') toast.error('AI 초안 생성 실패');
      else if (r.draft) {
        setReply(r.draft);
        // VocMessage.aiDraft 가 스키마 프로비넌스 — 감사 원장 기록은 하지 않는다(정본이 둘이 되지 않게). recorded=null
        setReplyProvenance({ source: 'GENERATOR', fields: ['답변'], appliedAt: new Date().toISOString(), model: null, recorded: null });
        toast.success(`${AI_ORIGIN_TEXT} 초안 — 검토·수정 후 발송하세요.`);
      }
    } catch (e) { toast.error((e as { message?: string })?.message || 'AI 호출 실패'); }
    setBusy(false);
  };

  const aiClassify = async () => {
    setBusy(true);
    try {
      const r = unwrap<{ mode: string; suggestion?: { type?: string; severity?: string; department?: string; category?: string } }>(await apiClient.post(`/api/v1/admin/voc/tickets/${id}/ai/classify`, {}));
      if (r.mode === 'off') toast.error(`${AI_ORIGIN_TEXT} 분류가 비활성입니다(설정: voc.ai.enabled·voc.ai.classify).`);
      else if (r.mode === 'error' || !r.suggestion) toast.error('AI 분류 실패');
      else {
        const s = r.suggestion;
        if (window.confirm(`${AI_ORIGIN_TEXT} 분류 제안:\n유형 ${s.type} · 심각도 ${s.severity} · 부서 ${s.department} · 주제 ${s.category}\n\n적용하시겠습니까?`)) {
          await act(() => apiClient.patch(`/api/v1/admin/voc/tickets/${id}`, { severity: s.severity, department: s.department, category: s.category }), '분류 적용');
        }
      }
    } catch (e) { toast.error((e as { message?: string })?.message || 'AI 호출 실패'); }
    setBusy(false);
  };

  if (!t) return <div className="bg-white rounded-xl border border-gray-100 p-6 text-sm text-gray-400"><T k="불러오는 중..." /></div>;

  return (
    <div className="bg-white rounded-xl border border-gray-100 p-4 space-y-4">
      {/* 헤더 */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[10px] px-1.5 py-0.5 bg-gray-100 text-gray-600 rounded font-medium"><T k={TYPE_LABEL[t.type] ?? t.type} /></span>
            <h2 className="text-base font-bold text-gray-900 truncate">{t.title}</h2>
          </div>
          <p className="text-xs text-gray-400 font-mono mt-0.5">{t.ticketNo}</p>
        </div>
        <div className="flex gap-1.5 shrink-0">
          <button disabled={busy} onClick={() => act(() => apiClient.post(`/api/v1/admin/voc/tickets/${id}/claim`, {}), '나에게 배정')}
            className="text-[11px] px-2 py-1 bg-blue-50 text-blue-700 rounded-lg hover:bg-blue-100"><T k="담당@배정" /></button>
          <button disabled={busy} onClick={() => { const dept = window.prompt('개선과제 담당 부서를 입력하세요', t?.department ?? ''); if (dept) act(() => apiClient.post(`/api/v1/admin/voc/tickets/${id}/promote-action`, { department: dept }), '개선과제로 승격'); }}
            className="text-[11px] px-2 py-1 bg-violet-50 text-violet-700 rounded-lg hover:bg-violet-100"><T k="개선과제" /></button>
          {t.status !== 'CLOSED'
            ? <button disabled={busy} onClick={() => act(() => apiClient.post(`/api/v1/admin/voc/tickets/${id}/close`, {}), '종결')} className="text-[11px] px-2 py-1 bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200"><T k="종결" /></button>
            : <button disabled={busy} onClick={() => act(() => apiClient.post(`/api/v1/admin/voc/tickets/${id}/reopen`, {}), '재오픈')} className="text-[11px] px-2 py-1 bg-amber-50 text-amber-700 rounded-lg hover:bg-amber-100"><T k="재오픈" /></button>}
        </div>
      </div>

      {/* 분류 컨트롤 */}
      <div className="flex flex-wrap gap-2 text-xs">
        <label className="flex items-center gap-1"><T k="상태" />
          <select value={t.status} disabled={busy} onChange={(e) => act(() => apiClient.patch(`/api/v1/admin/voc/tickets/${id}`, { status: e.target.value }))}
            className="border border-gray-200 rounded-lg px-2 py-1 bg-white">
            {STATUS_OPTS.map((s) => <option key={s} value={s}>{tAttr(STATUS_LABEL[s])}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-1"><T k="심각도" />
          <select value={t.severity} disabled={busy} onChange={(e) => act(() => apiClient.patch(`/api/v1/admin/voc/tickets/${id}`, { severity: e.target.value }))}
            className="border border-gray-200 rounded-lg px-2 py-1 bg-white">
            {SEV_OPTS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <button disabled={busy} onClick={aiClassify} className="px-2 py-1 bg-violet-50 text-violet-700 rounded-lg hover:bg-violet-100">✦ {AI_ORIGIN_TEXT} 분류</button>
      </div>

      {/* 신청자 컨텍스트 */}
      <div className="bg-gray-50 rounded-lg p-3 text-xs text-gray-600 space-y-0.5">
        {t.patient ? (
          <>
            <p><span className="text-gray-400"><T k="환자" /></span> {t.patient.familyName}{t.patient.givenName} · {t.patient.mrn} {t.patient.gender === 'MALE' ? '남' : t.patient.gender === 'FEMALE' ? '여' : ''}</p>
            {t.patient.phone && <p><span className="text-gray-400"><T k="연락처" /></span> {t.patient.phone}</p>}
          </>
        ) : (
          <>
            <p><span className="text-gray-400"><T k="비회원" /></span> {t.submitterName || '-'} <span className="text-[10px] text-amber-600"><T k="(신원 미확인)" /></span></p>
            {(t.contactPhone || t.contactEmail) && <p><span className="text-gray-400"><T k="연락처" /></span> {t.contactPhone || t.contactEmail}</p>}
          </>
        )}
      </div>

      {/* 스레드 */}
      <div className="space-y-2 max-h-[40vh] overflow-y-auto">
        {t.messages.map((m) => {
          const staff = m.authorType === 'STAFF';
          return (
            <div key={m.id} className={`flex ${staff ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm ${m.internal ? 'bg-yellow-50 border border-yellow-200 text-yellow-900' : staff ? 'bg-blue-600 text-white rounded-br-md' : 'bg-gray-100 text-gray-800 rounded-bl-md'}`}>
                <p className="text-[10px] font-semibold opacity-70 mb-0.5">{m.internal ? <T k="🔒 내부메모" /> : m.authorType === 'AI' ? `${AI_ORIGIN_TEXT}` : staff ? (m.authorName || <T k="담당자" />) : <T k="고객" />}{staff && m.aiDraft && m.authorType !== 'AI' ? ` · ${AI_ORIGIN_TEXT} 초안 기반` : ''}</p>
                <p className="whitespace-pre-wrap leading-relaxed">{m.body}</p>
                <p className="text-[9px] opacity-50 mt-1">{kdate(m.createdAt, 'datetimeSec')}</p>
              </div>
            </div>
          );
        })}
      </div>

      {/* 첨부 */}
      {(t.attachments?.length ?? 0) > 0 && (
        <div className="flex flex-wrap gap-2">
          {t.attachments!.map((a) => (
            /\.(png|jpe?g|webp)$/i.test(a.url)
              ? <a key={a.id} href={`${VOC_API_BASE}${a.url}`} target="_blank" rel="noopener">{/* eslint-disable-next-line @next/next/no-img-element */}<img src={`${VOC_API_BASE}${a.url}`} alt={a.fileName} className="w-16 h-16 object-cover rounded-lg border border-gray-200" /></a>
              : <a key={a.id} href={`${VOC_API_BASE}${a.url}`} target="_blank" rel="noopener" className="text-xs text-blue-600 underline px-2 py-1 bg-blue-50 rounded-lg">📎 {a.fileName}</a>
          ))}
        </div>
      )}

      {/* 답변 입력 */}
      <div className="border-t border-gray-100 pt-3 space-y-2">
        <div className="flex items-center justify-between">
          <label className="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer">
            <input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} className="rounded border-gray-300 text-yellow-500" />
            <T k="내부 메모(고객 비노출)" />
          </label>
          <button disabled={busy} onClick={aiDraft} className="text-[11px] px-2 py-1 bg-violet-50 text-violet-700 rounded-lg hover:bg-violet-100">✦ {AI_ORIGIN_TEXT} 답변 초안</button>
        </div>
        <DraftBanner provenance={replyProvenance} signLabel="발송" className="mb-2" />
        <div className="flex gap-2">
          <textarea value={reply} rows={2} onChange={(e) => { setReply(e.target.value); if (!e.target.value.trim()) setReplyProvenance(null); }}
            placeholder={internal ? tAttr('내부 메모 입력') : tAttr('고객에게 보낼 답변 입력')}
            className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm resize-none focus:ring-2 focus:ring-blue-500 focus:border-transparent" />
          <button onClick={send} disabled={busy || !reply.trim()}
            className={`px-4 self-stretch text-white text-sm rounded-lg disabled:opacity-40 ${internal ? 'bg-yellow-500 hover:bg-yellow-600' : 'bg-blue-600 hover:bg-blue-700'}`}>
            <T k={internal ? '메모' : '답변'} />
          </button>
        </div>
      </div>
    </div>
  );
}
