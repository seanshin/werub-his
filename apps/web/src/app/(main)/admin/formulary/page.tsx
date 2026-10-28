'use client';

// 원내 처방집(포뮬러리) 관리 — 위원회가 결정한 사용 가능 코드(7영역)와 등재 요청 심의.
// 기획: docs/01-plan/features/formulary-committee-management.plan.md

import { useEffect, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';
import { truncatedFieldsOf, truncationSummary } from '@/lib/truncated-fields';
import { kdate } from '@/lib/ui-settings';

import { EmptyState, Unit } from '@/components/ui/display';
import { ProposeAgendaButton } from '@/components/governance/ProposeAgendaModal';
import { AI_ORIGIN_TEXT, FORMULARY_PRESETS } from '@hospital-run/shared';
import { T, Tf, useTAttr, useTfAttr } from '@/components/ui/i18n-text';
import { FormularyCsvImport } from './FormularyCsvImport';

const DOMAINS = [
  { key: 'MEDICATION', label: '약처방' },
  { key: 'LAB', label: '검사' },
  { key: 'IMAGING', label: '영상' },
  { key: 'THERAPY', label: '치료' },
  { key: 'DIET', label: '식이' },
  { key: 'ACTIVITY', label: '활동' },
  { key: 'NURSING', label: '간호지시' },
] as const;
type DomainKey = (typeof DOMAINS)[number]['key'];

// 프리셋 영역(치료/활동) 키 정본은 shared `FORMULARY_PRESETS` — 서버 CSV 일괄 등재도 같은 목록으로 검증한다
const PRESETS: Record<string, readonly { key: string; name: string }[]> = FORMULARY_PRESETS;

interface FmItem {
  id: string; domain: string; codeType: string; codeId?: string | null; presetKey?: string | null;
  status: string; note?: string | null; committee?: string | null; decidedAt?: string | null; masterActive?: boolean;
  code?: string | null; label?: string | null;
}
interface FmRequest {
  id: string; domain: string; codeId?: string | null; codeLabel?: string | null; freeText?: string | null;
  reason: string; urgency: string; requesterName?: string; department?: string | null; status: string; createdAt: string;
}
interface MasterCode { id: string; code: string; nameKo: string }
interface FmList {
  id: string; domain: string; name: string; description?: string | null; aiGenerated: boolean; createdAt: string;
  items: { category: string; items: { codeId: string; code: string; label: string }[] }[];
}

function unwrap<T>(raw: unknown): T[] {
  if (Array.isArray(raw)) return raw as T[];
  const inner = (raw as { data?: unknown } | undefined)?.data;
  return Array.isArray(inner) ? (inner as T[]) : [];
}

export default function FormularyAdminPage() {
  const tAttr = useTAttr();
  const tfAttr = useTfAttr();
  const qc = useQueryClient();
  const [domain, setDomain] = useState<DomainKey>('MEDICATION');
  const [view, setView] = useState<'list' | 'requests' | 'lists'>('list');
  // AI 체크리스트
  const [aiTopic, setAiTopic] = useState('');
  const [draft, setDraft] = useState<{ topic: string; categories: { category: string; items: { codeId: string; code: string; label: string }[] }[]; candidateCount: number } | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [listName, setListName] = useState('');
  const [openList, setOpenList] = useState<FmList | null>(null);
  const [filter, setFilter] = useState('');
  const [committee, setCommittee] = useState('');
  const [note, setNote] = useState('');
  const [masterQ, setMasterQ] = useState('');
  const [cart, setCart] = useState<{ codeId?: string; presetKey?: string; label: string }[]>([]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['fm-list'] });
    qc.invalidateQueries({ queryKey: ['fm-requests'] });
    qc.invalidateQueries({ queryKey: ['fm-summary'] });
    qc.invalidateQueries({ queryKey: ['codes-fm-status'] }); // 코드마스터 화면 배지 stale 방지(크로스 페이지)
  };

  // 요약(탭 배지)
  const { data: summaryData } = useQuery({
    queryKey: ['fm-summary'],
    queryFn: () => apiClient.get<{ data: { items: { domain: string; status: string; _count: number }[]; pending: { domain: string; _count: number }[] } }>('/api/v1/formulary/summary'),
    staleTime: 30_000,
  });
  const summary = summaryData?.data;

  // 시행 모드(OFF/WARN/BLOCK — 영역별)
  const { data: policyData } = useQuery({
    queryKey: ['fm-policy'],
    queryFn: () => apiClient.get<{ data: Record<string, string> }>('/api/v1/formulary/policy'),
    staleTime: 30_000,
  });
  const policy: Record<string, string> = (policyData?.data as unknown as { data?: Record<string, string> })?.data ?? (policyData?.data as Record<string, string>) ?? {};
  const policyMut = useMutation({
    mutationFn: (patch: Record<string, string>) => apiClient.patch('/api/v1/formulary/policy', patch),
    onSuccess: () => { toast.success(tAttr('시행 모드가 변경되었습니다')); qc.invalidateQueries({ queryKey: ['fm-policy'] }); qc.invalidateQueries({ queryKey: ['fm-enforcement'] }); },
  });

  // 🔴 W8-R2 F3 — 모드(OFF/WARN/BLOCK)는 '무엇을 하려는가'일 뿐, '실제로 집행되는가'가 아니다.
  //   프리셋(치료·활동)·간호지시는 처방 레코드에 대조할 코드 키가 없어 모드를 올려도 막히지 않는다.
  //   서버가 집행점 유무를 알려주므로 화면이 그대로 말한다(안전 화면에서 근거 없는 안심 금지).
  type Enforcement = { mode: string; enforced: boolean; enforcedAt: string[]; notEnforcedAt: string[]; reason: string | null };
  const { data: enfData } = useQuery({
    queryKey: ['fm-enforcement'],
    queryFn: () => apiClient.get<{ data: Record<string, Enforcement> }>('/api/v1/formulary/policy/enforcement'),
    staleTime: 30_000,
  });
  const enforcement: Record<string, Enforcement> =
    (enfData?.data as unknown as { data?: Record<string, Enforcement> })?.data ?? (enfData?.data as Record<string, Enforcement>) ?? {};
  const enf: Enforcement | undefined = enforcement[domain];
  const activeCount = (d: string) => summary?.items?.filter((i) => i.domain === d && i.status === 'ACTIVE').reduce((s, i) => s + i._count, 0) ?? 0;
  const pendingCount = (d?: string) => summary?.pending?.filter((p) => !d || p.domain === d).reduce((s, p) => s + p._count, 0) ?? 0;

  // 승인 목록
  const { data: listData, isLoading } = useQuery({
    queryKey: ['fm-list', domain],
    queryFn: () => apiClient.get<{ data: FmItem[] }>('/api/v1/formulary', { domain }),
  });
  const items = unwrap<FmItem>(listData?.data ?? listData).filter(
    (i) => !filter.trim() || (i.label ?? '').includes(filter) || (i.code ?? '').includes(filter),
  );

  // 요청함
  const { data: reqData } = useQuery({
    queryKey: ['fm-requests', domain],
    queryFn: () => apiClient.get<{ data: FmRequest[] }>('/api/v1/formulary/requests', { status: 'PENDING', domain }),
    enabled: view === 'requests',
  });
  const requests = unwrap<FmRequest>(reqData?.data ?? reqData);

  // 마스터 검색(등재용)
  const masterEndpoint = domain === 'MEDICATION' ? '/api/v1/codes/medication' : domain === 'NURSING' ? '/api/v1/codes/nursing' : '/api/v1/codes/procedure';
  const { data: masterData } = useQuery({
    queryKey: ['fm-master', domain, masterQ],
    queryFn: () => apiClient.get<{ data: MasterCode[] }>(masterEndpoint, domain === 'NURSING' ? { codeSystem: 'NIC', q: masterQ } : { q: masterQ, limit: 20 }),
    enabled: masterQ.trim().length >= 1 && !PRESETS[domain],
  });
  const masterResults = unwrap<MasterCode>(masterData?.data ?? masterData).slice(0, 20);

  const addMut = useMutation({
    mutationFn: () => apiClient.post('/api/v1/formulary', { domain, items: cart, committee: committee || undefined, note: note || undefined }),
    onSuccess: (r: unknown) => {
      const d = (r as { data?: { created?: number; reactivated?: number } })?.data;
      toast.success(tfAttr('등재 완료 — 신규 {신규}·재활성 {재활성}', { 신규: d?.created ?? 0, 재활성: d?.reactivated ?? 0 }));
      setCart([]); invalidate();
    },
  });
  const patchMut = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => apiClient.patch(`/api/v1/formulary/${id}`, { status }),
    onSuccess: () => { toast.success(tAttr('변경되었습니다')); invalidate(); },
  });
  const decideMut = useMutation({
    mutationFn: ({ id, approve, decision }: { id: string; approve: boolean; decision?: string }) =>
      apiClient.post(`/api/v1/formulary/requests/${id}/decide`, { approve, decision, committee: committee || undefined }),
    onSuccess: (_r, v) => { toast.success(v.approve ? tAttr('승인 — 처방집에 반영되었습니다') : tAttr('반려되었습니다')); invalidate(); },
  });
  const seedMut = useMutation({
    mutationFn: () => apiClient.post('/api/v1/formulary/seed-from-usage', { months: 6 }),
    onSuccess: (r: unknown) => {
      const d = (r as { data?: { seeded?: number } })?.data;
      toast.success(tfAttr('실적 일괄 등재 {수}건', { 수: d?.seeded ?? 0 }));
      invalidate();
    },
  });

  // 체크리스트
  const { data: listsData } = useQuery({
    queryKey: ['fm-lists', domain],
    queryFn: () => apiClient.get<{ data: FmList[] }>('/api/v1/formulary/lists', { domain }),
    enabled: view === 'lists',
  });
  const savedLists = unwrap<FmList>(listsData?.data ?? listsData);

  // AI 초안 — 비동기 잡(nginx 60s 타임아웃 회피): 시작→jobId→3초 폴링
  const [aiRunning, setAiRunning] = useState(false);
  // 언마운트 후 폴링 계속/setState 방지 + 폴링 중 탭 전환 시 오저장 방지(시작 시점 domain 캡처)
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);
  const draftDomainRef = useRef<DomainKey>(domain);
  const applyDraft = (d: NonNullable<typeof draft>) => {
    if (!d.categories?.length) { toast.warning(tAttr('관련 코드를 찾지 못했습니다 — 주제를 더 구체적으로 입력해보세요.')); return; }
    setDraft(d);
    setChecked(new Set(d.categories.flatMap((c) => c.items.map((i) => i.codeId))));
    setListName(d.topic);
    // `{출처}` 는 AI 표기(AI기본법 §31)라 번역하지 않고 그대로 넣는다(comp1 선례)
    toast.success(tfAttr('{출처} 초안 — {카테고리}개 카테고리·{건}건', {
      출처: AI_ORIGIN_TEXT, 카테고리: d.categories.length, 건: d.categories.reduce((s2, c) => s2 + c.items.length, 0),
    }));
  };
  const runAiDraft = async () => {
    if (!aiTopic.trim() || aiRunning) return;
    setAiRunning(true); setDraft(null);
    draftDomainRef.current = domain; // 저장 페이로드는 시작 시점 domain 사용
    try {
      const start = await apiClient.post<{ data: { jobId: string } }>('/api/v1/formulary/lists/ai-draft', { domain, topic: aiTopic.trim() });
      const jobId = (start as { data?: { jobId?: string } })?.data?.jobId;
      if (!jobId) throw new Error('no job');
      for (let i = 0; i < 60; i++) { // 최대 3분
        await new Promise((r) => setTimeout(r, 3000));
        if (!mountedRef.current) return; // 언마운트 — 폴링 중단
        const st = await apiClient.get<{ data: { status: string; result?: NonNullable<typeof draft>; error?: string } }>(`/api/v1/formulary/lists/ai-draft/${jobId}`);
        if (!mountedRef.current) return;
        const job = (st as { data?: { status: string; result?: NonNullable<typeof draft>; error?: string } })?.data;
        if (job?.status === 'DONE') { applyDraft(job.result as NonNullable<typeof draft>); return; }
        if (job?.status === 'ERROR') { toast.error(tfAttr('{출처} 초안 생성 실패: {사유}', { 출처: AI_ORIGIN_TEXT, 사유: job.error ?? '' })); return; }
      }
      toast.error(tfAttr('{출처} 초안 생성이 너무 오래 걸립니다 — 잠시 후 다시 시도하세요.', { 출처: AI_ORIGIN_TEXT }));
    } catch {
      if (mountedRef.current) toast.error(tfAttr('{출처} 초안 생성 시작 실패', { 출처: AI_ORIGIN_TEXT }));
    } finally {
      if (mountedRef.current) setAiRunning(false);
    }
  };
  const saveListMut = useMutation({
    mutationFn: () => {
      const items = (draft?.categories ?? [])
        .map((c) => ({ category: c.category, items: c.items.filter((i) => checked.has(i.codeId)) }))
        .filter((c) => c.items.length > 0);
      // domain은 초안 시작 시점 캡처값 — 폴링 중 탭 전환 시 다른 영역으로 오저장 방지
      return apiClient.post('/api/v1/formulary/lists', { domain: draftDomainRef.current, name: listName.trim(), items, aiGenerated: true });
    },
    onSuccess: (res: unknown) => {
      toast.success(tAttr('체크리스트가 저장되었습니다'));
      // 🔴 (U4) 리스트 이름 120자를 넘으면 서버가 잘라 저장한다 — 그 사실을 말한다
      const cut = truncatedFieldsOf(res);
      if (cut.length) toast.warning(`${tAttr('저장 한도를 넘은 칸을 잘라 저장했습니다')}: ${truncationSummary(cut)}`);
      setDraft(null); setAiTopic(''); qc.invalidateQueries({ queryKey: ['fm-lists'] }); },
  });
  const deleteListMut = useMutation({
    mutationFn: (id: string) => apiClient.del(`/api/v1/formulary/lists/${id}`),
    onSuccess: () => { toast.success(tAttr('삭제되었습니다')); setOpenList(null); qc.invalidateQueries({ queryKey: ['fm-lists'] }); },
  });
  const enrollFromListMut = useMutation({
    mutationFn: (codeIds: string[]) => apiClient.post('/api/v1/formulary', { domain, items: codeIds.map((codeId) => ({ codeId })), committee: committee || undefined, note: note || (openList ? `체크리스트 '${openList.name}'에서 등재` : undefined) }),
    onSuccess: (r: unknown) => {
      const d = (r as { data?: { created?: number; reactivated?: number } })?.data;
      toast.success(tfAttr('처방집 등재 — 신규 {신규}·재활성 {재활성}', { 신규: d?.created ?? 0, 재활성: d?.reactivated ?? 0 }));
      invalidate();
    },
  });
  const toggleCheck = (id: string) => setChecked((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const inCart = (id?: string, key?: string) => cart.some((c) => (id && c.codeId === id) || (key && c.presetKey === key));
  const registered = new Set(items.map((i) => i.codeId ?? i.presetKey));

  return (
    <div className="max-w-6xl space-y-5">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900"><T k="원내 처방집(포뮬러리) 관리" /></h1>
          <p className="text-sm text-gray-500 mt-1"><T k="위원회가 승인한 사용 가능 코드 관리 · 등재 요청 심의 — 처방 화면에 즉시 반영" /></p>
        </div>
        <button onClick={() => confirm(tAttr('최근 6개월 처방에 사용된 코드를 일괄 등재합니다. 진행할까요?')) && seedMut.mutate()}
          disabled={seedMut.isPending}
          className="min-h-[44px] px-3 py-2 text-xs font-medium rounded-xl border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 disabled:opacity-50">
          <T k={seedMut.isPending ? '등재 중…' : '사용 실적 일괄 등재(6개월)'} />
        </button>
      </div>

      {/* 영역 탭 */}
      <div className="flex gap-1.5 flex-wrap">
        {DOMAINS.map((d) => (
          <button key={d.key} onClick={() => { setDomain(d.key); setCart([]); setMasterQ(''); }}
            className={`px-3.5 py-2 text-sm font-medium rounded-full transition-colors flex items-center gap-1.5 ${
              domain === d.key ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}>
            <T k={d.label} />
            <span className={`text-[10px] font-bold px-1.5 rounded-full ${domain === d.key ? 'bg-white/20' : 'bg-white text-gray-500'}`}>{activeCount(d.key)}</span>
            {pendingCount(d.key) > 0 && <span className="text-[10px] font-bold px-1.5 rounded-full bg-amber-400 text-white"><T k="요청@건수" /> {pendingCount(d.key)}</span>}
            {/* 모드는 켜져 있는데 서버가 집행하지 못하는 영역 — 탭에서 바로 보이게(F3) */}
            {enforcement[d.key]?.enforced === false && (enforcement[d.key]?.mode ?? 'OFF') !== 'OFF' && (
              <span title={tAttr('서버 집행점 없음 — 모드를 올려도 막히지 않습니다')} className="text-[10px] font-bold px-1.5 rounded-full bg-red-500 text-white"><T k="표시전용" /></span>
            )}
          </button>
        ))}
      </div>

      {/* 시행 모드 — 현재 영역 */}
      <div className="bg-white rounded-xl border border-gray-100 px-3 py-2 space-y-1.5">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-semibold text-gray-600"><T k={DOMAINS.find((d) => d.key === domain)?.label ?? ''} /> <T k="시행 모드" /></span>
          {(['OFF', 'WARN', 'BLOCK'] as const).map((m) => (
            <button key={m} onClick={() => policyMut.mutate({ [domain]: m })}
              className={`min-h-[44px] px-3 py-2 text-xs font-medium rounded-lg transition ${
                (policy[domain] ?? 'OFF') === m
                  ? m === 'BLOCK' ? 'bg-red-600 text-white' : m === 'WARN' ? 'bg-amber-500 text-white' : 'bg-gray-600 text-white'
                  : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
              }`}>{m}</button>
          ))}
          {/* 집행점이 없는 영역은 모드 설명을 하지 않는다 — 하지 못하는 일을 하겠다고 쓰지 않는다 */}
          {enf?.enforced !== false && (
            <span className="text-[11px] text-gray-400 ml-1">
              <T k={(policy[domain] ?? 'OFF') === 'OFF' ? '표시만 — 비승인 코드도 처방 가능(배지 안내)'
                : (policy[domain] ?? 'OFF') === 'WARN' ? '경고 — 비승인 처방은 통과하되 서버가 위반으로 기록(관제 집계)'
                : '차단 — 비승인 코드는 서버가 처방을 거부(등재 요청으로 유도)'} />
            </span>
          )}
        </div>
        {/* 🔴 실제 집행 여부 — 모드만 보고 "적용 중"이라 믿지 않도록 서버 사실을 그대로 적는다 */}
        {enf && (
          enf.enforced ? (
            <>
              <p className="text-[11px] text-emerald-700">
                <T k="서버 집행됨" /> — {enf.enforcedAt.join(' · ')}
                <span className="text-gray-400"> <T k="(처방 화면 확인창은 보조이며, 모바일·API 직접 호출도 같은 게이트를 통과합니다)" /></span>
              </p>
              {/* 집행됨이라도 아직 게이트를 부르지 않는 발행 경로가 있으면 그대로 적는다 — '전부'가 아닌 것을 전부라 하지 않는다 */}
              {enf.notEnforcedAt?.length > 0 && (
                <p className="text-[11px] text-amber-700">
                  ⚠ <T k="아직 게이트를 부르지 않는 발행 경로:" /> {enf.notEnforcedAt.join(' · ')} — <T k="이 경로로 만든 처방은 대조되지 않습니다." />
                </p>
              )}
            </>
          ) : (
            <p className="text-[11px] text-red-600">
              ⚠ <Tf k="서버 집행점 없음 — 이 영역의 모드는 {강조}입니다(WARN/BLOCK 으로 올려도 처방이 막히지 않습니다)." params={{ 강조: <b><T k="표시 전용" /></b> }} />
              <span className="text-gray-500"> <T k="사유:" /> {enf.reason}</span>
            </p>
          )
        )}
      </div>

      {/* 보기 전환 + 공통 입력 */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex rounded-xl bg-gray-100 p-1">
          <button onClick={() => setView('list')} className={`px-3 py-1.5 text-xs font-medium rounded-lg ${view === 'list' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500'}`}><T k="① 사용 승인 코드" /></button>
          <button onClick={() => setView('lists')} className={`px-3 py-1.5 text-xs font-medium rounded-lg ${view === 'lists' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500'}`}>✨ <Tf k="{출처} 체크리스트" params={{ 출처: AI_ORIGIN_TEXT }} /></button>
          <button onClick={() => setView('requests')} className={`px-3 py-1.5 text-xs font-medium rounded-lg flex items-center gap-1 ${view === 'requests' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500'}`}>
            <T k="② 등재 요청 심의" /> {pendingCount(domain) > 0 &&<span className="text-[10px] font-bold px-1.5 rounded-full bg-amber-400 text-white">{pendingCount(domain)}</span>}
          </button>
        </div>
        <span className="text-[11px] text-gray-400">
          {view === 'list' ? <T k="위원회가 승인한 코드 — 처방 화면에 초록 「원내」 배지로 표시됩니다" />
            : view === 'requests' ? <T k="의료진이 처방 화면의 「비승인·등재요청」 버튼으로 보낸 요청 — 승인하면 즉시 사용 승인됩니다" />
            : <Tf k="{출처}가 주제 관련 코드를 모아 분류 — 검토 후 저장·일괄 등재" params={{ 출처: AI_ORIGIN_TEXT }} />}
        </span>
      </div>

      {view === 'list' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* 좌: 등재 패널 */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 space-y-3">
            <h3 className="text-sm font-semibold text-gray-700"><T k="새 코드 등재" /> — <T k={DOMAINS.find((d) => d.key === domain)?.label ?? ''} /></h3>
            <div className="flex gap-2">
              <input value={committee} onChange={(e) => setCommittee(e.target.value)} placeholder={tAttr('결정 위원회(예: 약사위원회)')}
                className="px-3 py-1.5 border border-gray-200 rounded-xl text-xs w-44" />
              <input value={note} onChange={(e) => setNote(e.target.value)} placeholder={tAttr('결정 메모(선택)')}
                className="px-3 py-1.5 border border-gray-200 rounded-xl text-xs flex-1 min-w-[120px]" />
            </div>
            {PRESETS[domain] ? (
              <div className="grid grid-cols-2 gap-1.5 max-h-[380px] overflow-y-auto pr-1">
                {PRESETS[domain].map((p) => {
                  const on = inCart(undefined, p.key);
                  const done = registered.has(p.key);
                  return (
                    <button key={p.key} disabled={done}
                      onClick={() => setCart((prev) => on ? prev.filter((c) => c.presetKey !== p.key) : [...prev, { presetKey: p.key, label: p.name }])}
                      className={`px-2.5 py-2 rounded-lg border text-left text-xs transition ${
                        done ? 'border-gray-100 bg-gray-50 text-gray-300' : on ? 'border-blue-400 bg-blue-50 text-blue-700' : 'border-gray-200 hover:bg-gray-50 text-gray-700'
                      }`}>
                      <T k={p.name} /> {done && <span className="text-[9px]"><T k="등재됨" /></span>}
                    </button>
                  );
                })}
              </div>
            ) : (
              <>
                <input value={masterQ} onChange={(e) => setMasterQ(e.target.value)} placeholder={tAttr('마스터 검색(명칭·코드)…')}
                  className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm" />
                <div className="max-h-[300px] overflow-y-auto space-y-1">
                  {masterResults.map((m) => {
                    const on = inCart(m.id);
                    const done = registered.has(m.id);
                    return (
                      <button key={m.id} disabled={done}
                        onClick={() => setCart((prev) => on ? prev.filter((c) => c.codeId !== m.id) : [...prev, { codeId: m.id, label: `${m.code} ${m.nameKo}` }])}
                        className={`w-full flex items-center gap-2 px-3 py-1.5 rounded-lg border text-left text-xs ${
                          done ? 'border-gray-100 bg-gray-50 text-gray-300' : on ? 'border-blue-400 bg-blue-50 text-blue-700' : 'border-gray-200 hover:bg-gray-50 text-gray-700'
                        }`}>
                        <span className="font-mono shrink-0">{m.code}</span>
                        <span className="truncate flex-1">{m.nameKo}</span>
                        {done && <span className="text-[9px] shrink-0"><T k="등재됨" /></span>}
                      </button>
                    );
                  })}
                  {masterQ.trim() && masterResults.length === 0 && <p className="text-xs text-gray-400 py-4 text-center"><T k="검색 결과 없음" /></p>}
                </div>
              </>
            )}
            {cart.length > 0 && (
              <div className="border-t border-gray-100 pt-3 space-y-2">
                <div className="flex gap-1.5 flex-wrap">
                  {cart.map((c) => (
                    <span key={c.codeId ?? c.presetKey} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-50 border border-blue-200 text-blue-700 text-[11px]">
                      {c.label}
                      <button onClick={() => setCart((prev) => prev.filter((x) => x !== c))} className="text-blue-300 hover:text-blue-600">✕</button>
                    </span>
                  ))}
                </div>
                <button onClick={() => addMut.mutate()} disabled={addMut.isPending}
                  className="w-full min-h-[44px] px-3 py-2 bg-blue-600 text-white text-xs font-medium rounded-xl hover:bg-blue-700 disabled:opacity-50">
                  <Tf k="{수}건 등재" params={{ 수: cart.length }} />
                </button>
              </div>
            )}
            <FormularyCsvImport domain={domain} isPreset={!!PRESETS[domain]} committee={committee} note={note} onApplied={invalidate} />
          </div>

          {/* 우: 승인 목록 */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-gray-700"><T k="사용 승인 코드" /> <span className="text-gray-400 font-normal">({items.length})</span></h3>
              <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={tAttr('목록 내 검색…')}
                className="px-3 py-1.5 border border-gray-200 rounded-xl text-xs w-40" />
            </div>
            <div className="max-h-[430px] overflow-y-auto divide-y divide-gray-50">
              {isLoading ? (
                <p className="text-xs text-gray-400 py-6 text-center"><T k="불러오는 중…" /></p>
              ) : items.length === 0 ? (
                <EmptyState icon="📋" title="등재된 항목이 없습니다" hint={"왼쪽에서 등재하거나 '사용 실적 일괄 등재'를 실행하세요"} />
              ) : items.map((i) => (
                <div key={i.id} className="flex items-center gap-2 py-2 text-xs">
                  <span className="font-mono text-gray-400 shrink-0 w-20 truncate">{i.code}</span>
                  <span className={`truncate flex-1 ${i.status === 'SUSPENDED' ? 'text-gray-400 line-through' : 'text-gray-800'}`}>{i.label}</span>
                  {i.masterActive === false && (
                    <span className="px-1.5 py-0.5 rounded bg-red-50 text-red-500 text-[9px] font-bold shrink-0" title={tAttr('코드마스터에서 비활성/삭제된 코드 — 처방 검색에는 자동 미노출. 정리(제거) 권장')}><T k="마스터 비활성" /></span>
                  )}
                  {i.committee && <span className="text-[10px] text-gray-400 shrink-0">{i.committee}</span>}
                  <button onClick={() => patchMut.mutate({ id: i.id, status: i.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE' })}
                    className={`min-h-[44px] px-3 py-2 rounded text-xs font-medium shrink-0 ${i.status === 'ACTIVE' ? 'bg-emerald-50 text-emerald-600 hover:bg-emerald-100' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}
                    title={tAttr(i.status === 'ACTIVE' ? '일시 중지' : '재개')}>
                    <T k={i.status === 'ACTIVE' ? '사용중@처방집' : '중지됨'} />
                  </button>
                  <button onClick={() => confirm(tfAttr("'{항목}' 을(를) 처방집에서 제거할까요?", { 항목: String(i.label) })) && patchMut.mutate({ id: i.id, status: 'REMOVED' })}
                    className="min-h-[44px] px-3 py-2 text-xs font-medium text-gray-300 hover:text-red-500 shrink-0" title={tAttr('제거')}>✕</button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {view === 'lists' && (
        <div className="space-y-4">
          {/* AI 생성 */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 space-y-3">
            <h3 className="text-sm font-semibold text-gray-700">✨ <Tf k="{출처}로 체크리스트 만들기 — {영역}" params={{ 출처: AI_ORIGIN_TEXT, 영역: tAttr(DOMAINS.find((d) => d.key === domain)?.label ?? '') }} /></h3>
            <p className="text-xs text-gray-400"><Tf k="주제를 입력하면 {출처}가 코드마스터에서 관련 코드를 모아 카테고리로 정리합니다. 검토·체크 후 저장하고, 리스트에서 바로 처방집에 등재하세요." params={{ 출처: AI_ORIGIN_TEXT }} /></p>
            <div className="flex gap-2">
              <input value={aiTopic} onChange={(e) => setAiTopic(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') runAiDraft(); }}
                placeholder={tAttr('예: 고혈압 외래 초진 / 당뇨 정기검사 패널 / 수술 전 기본검사…')}
                className="flex-1 px-3 py-2 border border-gray-200 rounded-xl text-sm" />
              <button onClick={runAiDraft} disabled={!aiTopic.trim() || aiRunning}
                className="shrink-0 px-4 py-2 rounded-xl text-sm font-medium bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50">
                {aiRunning
                  ? <Tf k="{출처} 분석 중… (최대 1~2분)" params={{ 출처: AI_ORIGIN_TEXT }} />
                  : <Tf k="{출처} 초안 생성" params={{ 출처: AI_ORIGIN_TEXT }} />}
              </button>
            </div>

            {draft && (
              <div className="border-t border-gray-100 pt-3 space-y-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <input value={listName} maxLength={120} onChange={(e) => setListName(e.target.value)} placeholder={tAttr('리스트 이름')}
                    className="px-3 py-1.5 border border-gray-200 rounded-xl text-sm font-medium flex-1 min-w-[200px]" />
                  <span className="text-[11px] text-gray-400"><Tf k="후보 {후보} 중 선별 · 체크 {체크}" params={{ 후보: <>{draft.candidateCount}<Unit>건</Unit></>, 체크: <>{checked.size}<Unit>건</Unit></> }} /></span>
                  <button onClick={() => saveListMut.mutate()} disabled={!listName.trim() || checked.size === 0 || saveListMut.isPending}
                    className="min-h-[44px] px-3 py-2 rounded-xl text-xs font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"><T k="리스트 저장" /></button>
                  <button onClick={() => { setDraft(null); setChecked(new Set()); }} className="px-3 py-1.5 rounded-xl text-xs text-gray-500 hover:bg-gray-100"><T k="버리기" /></button>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-[440px] overflow-y-auto pr-1">
                  {draft.categories.map((cat) => {
                    const allOn = cat.items.every((i) => checked.has(i.codeId));
                    return (
                    <div key={cat.category} className="border border-gray-100 rounded-xl p-3">
                      <label className="flex items-center gap-2 mb-2 cursor-pointer">
                        <input type="checkbox" checked={allOn}
                          onChange={() => setChecked((prev) => { const n = new Set(prev); cat.items.forEach((i) => allOn ? n.delete(i.codeId) : n.add(i.codeId)); return n; })}
                          className="accent-violet-600" />
                        <span className="text-xs font-bold text-violet-700">{cat.category}</span>
                        <span className="text-[10px] text-gray-400">{cat.items.length}<Unit><T k="건" /></Unit></span>
                      </label>
                      <div className="space-y-1">
                        {cat.items.map((i) => (
                          <label key={i.codeId} className="flex items-center gap-2 text-xs cursor-pointer hover:bg-gray-50 rounded px-1 py-0.5">
                            <input type="checkbox" checked={checked.has(i.codeId)} onChange={() => toggleCheck(i.codeId)} className="accent-blue-600" />
                            <span className="font-mono text-gray-400 shrink-0">{i.code}</span>
                            <span className="text-gray-700 truncate">{i.label}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* 저장된 리스트 */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 space-y-2">
            <h3 className="text-sm font-semibold text-gray-700"><T k="저장된 체크리스트" /> <span className="text-gray-400 font-normal">({savedLists.length})</span></h3>
            {savedLists.length === 0 ? (
              <EmptyState icon="📋" title="저장된 리스트가 없습니다" hint={<Tf k="위에서 {출처}로 만들어보세요" params={{ 출처: AI_ORIGIN_TEXT }} />} />
            ) : savedLists.map((l) => {
              const total = (l.items ?? []).reduce((s2, c) => s2 + (c.items?.length ?? 0), 0);
              const opened = openList?.id === l.id;
              return (
                <div key={l.id} className="border border-gray-100 rounded-xl">
                  <button onClick={() => setOpenList(opened ? null : l)} className="w-full flex items-center gap-2 px-3 py-2.5 text-left hover:bg-gray-50 rounded-xl">
                    {l.aiGenerated && <span className="text-[9px] px-1.5 py-0.5 rounded bg-violet-50 text-violet-600 font-bold shrink-0">{AI_ORIGIN_TEXT}</span>}
                    <span className="text-sm font-medium text-gray-900 truncate">{l.name}</span>
                    <span className="text-[11px] text-gray-400 ml-auto shrink-0">{total}<Unit><T k="건" /></Unit> · {kdate(new Date(l.createdAt))}</span>
                    <span className="text-gray-300">{opened ? '▲' : '▼'}</span>
                  </button>
                  {opened && (
                    <div className="px-3 pb-3 space-y-2">
                      {(l.items ?? []).map((cat) => (
                        <div key={cat.category}>
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-xs font-bold text-violet-700">{cat.category}</span>
                            <button onClick={() => enrollFromListMut.mutate(cat.items.map((i) => i.codeId))}
                              className="min-h-[44px] px-3 py-2 text-xs font-medium rounded bg-blue-50 text-blue-600 hover:bg-blue-100"><T k="이 카테고리 등재" /></button>
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-3">
                            {cat.items.map((i) => (
                              <div key={i.codeId} className="flex items-center gap-2 text-xs py-0.5">
                                <span className="font-mono text-gray-400 shrink-0">{i.code}</span>
                                <span className="text-gray-700 truncate">{i.label}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                      <div className="flex gap-2 justify-end pt-1 border-t border-gray-50">
                        <button onClick={() => confirm(tAttr('이 리스트를 삭제할까요?')) && deleteListMut.mutate(l.id)}
                          className="min-h-[44px] px-3 py-2 text-xs font-medium rounded-lg text-gray-400 hover:bg-red-50 hover:text-red-500"><T k="삭제" /></button>
                        <button onClick={() => enrollFromListMut.mutate((l.items ?? []).flatMap((c) => c.items.map((i) => i.codeId)))}
                          disabled={enrollFromListMut.isPending}
                          className="min-h-[44px] px-3 py-2 text-xs font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"><Tf k="전체 {건수} 처방집 등재" params={{ 건수: <>{total}<Unit>건</Unit></> }} /></button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {view === 'requests' && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 space-y-2">
          <div>
            <h3 className="text-sm font-semibold text-gray-700"><T k="등재 요청 심의" /> — <T k={DOMAINS.find((d) => d.key === domain)?.label ?? ''} /></h3>
            <p className="text-[11px] text-gray-400 mt-0.5"><T k="의료진이 처방 화면에서 비승인 코드에 「등재요청」을 누르면 여기에 쌓입니다. 승인 시 위원회명(위 입력)과 함께 즉시 사용 승인 목록에 추가됩니다." /></p>
          </div>
          <div className="flex gap-2">
            <input value={committee} onChange={(e) => setCommittee(e.target.value)} placeholder={tAttr('결정 위원회(예: 약사위원회)')}
              className="px-3 py-1.5 border border-gray-200 rounded-xl text-xs w-44" />
          </div>
          {requests.length === 0 ? (
            <EmptyState icon="💊" title="대기 중인 요청이 없습니다" hint="의료진이 처방 화면에서 「비승인·등재요청」을 누르면 여기에 표시됩니다" />
          ) : requests.map((r) => (
            <div key={r.id} className="border border-gray-100 rounded-xl p-3 space-y-1.5">
              <div className="flex items-center gap-2 text-sm">
                {r.urgency === 'URGENT' && <span className="px-1.5 py-0.5 rounded bg-red-100 text-red-700 text-[10px] font-bold"><T k="긴급" /></span>}
                <span className="font-medium text-gray-900">{r.codeLabel ?? r.freeText ?? '-'}</span>
                <span className="text-[11px] text-gray-400 ml-auto">{r.requesterName} · {r.department ?? '-'} · {kdate(new Date(r.createdAt))}</span>
              </div>
              <p className="text-xs text-gray-600 bg-gray-50 rounded-lg px-2.5 py-1.5">{r.reason}</p>
              <div className="flex gap-2 justify-end">
                <ProposeAgendaButton
                  sourceRef={{ type: 'FORMULARY_REQUEST', key: r.id }}
                  surfaceKey="config:formulary.enforce"
                  defaultTitle={`[포뮬러리] ${r.codeLabel ?? r.freeText ?? '신규 항목'} 등재 심의`}
                  defaultBody={`영역: ${r.domain}\n요청: ${r.codeLabel ?? r.freeText ?? '-'}\n사유: ${r.reason}\n요청자: ${r.requesterName ?? '-'} (${r.department ?? '-'})${r.urgency === 'URGENT' ? '\n긴급 요청' : ''}\n\n의결 바인딩 예: [{"kind":"FORMULARY","target":{"op":"decide","requestId":"${r.id}","approve":true}}]`}
                  className="px-3 py-1.5 text-xs rounded-lg border border-indigo-200 bg-indigo-50 text-indigo-600 hover:bg-indigo-100"
                  label={tAttr('위원회 상정')} />
                <button onClick={() => { const d = prompt(tAttr('반려 사유(필수)')); if (d?.trim()) decideMut.mutate({ id: r.id, approve: false, decision: d.trim() }); }}
                  className="min-h-[44px] px-3 py-2 text-xs font-medium rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50"><T k="반려@버튼" /></button>
                {r.codeId ? (
                  <button onClick={() => decideMut.mutate({ id: r.id, approve: true })}
                    title={tAttr('승인 — 즉시 처방집 반영')}
                    className="min-h-[44px] px-3 py-2 text-xs font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700"><T k="승인·등재" /></button>
                ) : (
                  <a href="/admin/codes" target="_blank" rel="noreferrer"
                    title={tAttr('마스터에 없는 신규 항목 — 코드마스터에서 먼저 등록한 뒤, 이 화면에서 등재하고 요청을 승인 처리하세요')}
                    className="px-3 py-1.5 text-xs rounded-lg border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100"><T k="코드마스터 등록 →" /></a>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
