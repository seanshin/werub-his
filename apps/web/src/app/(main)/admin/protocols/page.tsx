'use client';
import { useEffect, useMemo, useState } from 'react';
import { Unit, useDurationText } from '@/components/ui/display';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { kdate } from '@/lib/ui-settings';
import { T, Tf, useTAttr, useTfAttr } from '@/components/ui/i18n-text';

type Issue = { severity: 'ERROR' | 'WARN'; step: string; message: string };
type Transition = { toKey: string; condition?: string };
type Step = { key: string; title: string; sortOrder: number; phase: string | null; ownerRoles: string[]; actionType: string; gate: boolean; gateRule: string | null; chartView: string | null; slaMinutes: number | null; transitions: Transition[] };
type Validation = { ok: boolean; issues: Issue[] };
type Template = { id: string; code: string; name: string; domain: string; version: number; status: string; description: string | null; editable: boolean; validation: Validation; steps: Step[] };
type Mon = { instanceId: string; domain: string; patientName: string; mrn: string; currentStepKey: string | null; blocked: boolean; gate: { done: number; total: number; detail?: string } | null; activeMinutes: number };
type ConditionField = { field: string; label: string; type: string; domains: string[]; values?: string[] };
type Predicates = { gatePredicates: { rule: string; label: string; domains: string[] }[]; ownerRoles: string[]; actionTypes: string[]; chartViews: string[]; conditionFields?: ConditionField[] };

// 조건식 DSL 클라 검증(서버 validateCondition 미러)
const COND_CMP = /^([a-zA-Z_][\w.]*)\s*(==|!=|>=|<=|>|<|in)\s+(.+)$/;
function condError(expr: string | undefined, knownFields: Set<string>): string | null {
  if (!expr || !expr.trim()) return null;
  for (const orP of expr.split('||')) for (const andP of orP.split('&&')) {
    const c = andP.trim();
    const m = c.match(COND_CMP);
    if (!m) return `조건식 형식 오류: "${c}"`;
    if (knownFields.size && !knownFields.has(m[1])) return `미지원 조건 필드: ${m[1]}`;
  }
  return null;
}
type HistVer = { id: string; version: number; status: string; publishedAt: string | null; publishedBy: string | null; instanceCount: number; stepCount: number; validation: Validation };
type ActiveInst = { instanceId: string; domain: string; currentStepKey: string | null; label: string; patientName: string; mrn: string };
type GateResultR = { rule: string | null; passed: boolean; done: number; total: number; detail?: string };
type RealSim = { path: { key: string; title: string; gate: boolean; gateRule: string | null; gatePassed: boolean | null; blocked: boolean }[]; blockedAt: string | null; completed: boolean; unreached: string[]; currentStepKey: string | null; gateResults: Record<string, GateResultR> };

const DOMAIN_KO: Record<string, string> = { SURGERY: '수술', IPD: '입원', OPD: '외래', ER: '응급' };
const ROLE_KO: Record<string, string> = { DOCTOR: '의사', NURSE: '간호', ADMIN: '원무', PHARMACIST: '약사' };
// 🔴 '운영'·'은퇴' 단독 키는 다른 뜻(Operations·Retire 동사)으로 먼저 등재돼 있다 — 버전 상태는 문맥 키로 가른다
//    (같은 이유로 발행 **버튼**은 '발행@프로토콜' — 단독 '발행'은 상태어 Issued 로 먼저 등재돼 버튼이 'Issued' 로 나갔다)
const STATUS_KO: Record<string, string> = { ACTIVE: '운영@프로토콜버전', DRAFT: '편집중', RETIRED: '은퇴@프로토콜버전' };

// 표시 정본은 `useDurationText()` — 단위 낱말이 UI 언어를 따른다(모듈 헬퍼로 두면 훅을 못 쓴다)
/** 역할 코드 → 표시 라벨. `tr` 을 주면 라벨을 번역한다(역할 코드 자체는 번역하지 않는다 — 미등록이면 원문 그대로) */
function rolesKo(rs: string[], tr: (k: string) => string = (k) => k) { return rs.map((r) => tr(ROLE_KO[r] ?? r)).join('/'); }

/**
 * 검증 문구 → 표시 키. 🔴 서버(`protocol.service.ts` validateSteps · `condition-dsl.ts`)와 이 화면의 클라 미러가
 * **값이 든 문구**(`전이 대상 단계 없음: X`)를 만든다. 문구 통째를 키로 쓰면 값마다 다른 키가 되어 영원히
 * 미등록 티로 나간다 → 알려진 틀만 자리표시자 키로 바꾸고 값(단계 키·술어·조건식)은 번역하지 않는다.
 * 모르는 문구는 그대로 키로 둔다(미등록이면 원문+티 — 지어내지 않는다).
 */
const ISSUE_PARAM_KEYS: { re: RegExp; k: string }[] = [
  { re: /^전이 대상 단계 없음: ([\s\S]*)$/, k: '전이 대상 단계 없음: {단계}' },
  { re: /^미지원 게이트 술어: ([\s\S]*)$/, k: '미지원 게이트 술어: {술어}' },
  { re: /^미지원 조건 필드: ([\s\S]*)$/, k: '미지원 조건 필드: {필드}' },
  // 서버 condition-dsl 은 예시를 덧붙이고, 클라 미러는 붙이지 않는다 — 둘 다 받는다(서버 먼저)
  { re: /^조건식 형식 오류: "([\s\S]*)" \(예: ktas <= 2\)$/, k: '조건식 형식 오류: "{조건식}" (예: ktas <= 2)' },
  { re: /^조건식 형식 오류: "([\s\S]*)"$/, k: '조건식 형식 오류: "{조건식}"' },
];
/** 자리표시자 이름은 키에서 읽는다 — 이름을 따로 적으면 키와 갈라진다 */
function issueKey(message: string): { k: string; params: Record<string, string> } {
  for (const p of ISSUE_PARAM_KEYS) {
    const m = message.match(p.re);
    const name = p.k.match(/\{([^{}\s]+)\}/)?.[1];
    if (m && name) return { k: p.k, params: { [name]: m[1] } };
  }
  return { k: message, params: {} };
}
/** 이슈의 단계 표기 — 키가 빈 단계는 클라 미러가 `(빈 키)` 로 적는다(표시 문구라 번역, 실제 단계 키는 번역하지 않는다) */
function StepRef({ step }: { step: string }) {
  return step === '(빈 키)' ? <T k="(빈 키)" /> : <>{step}</>;
}
function IssueText({ message }: { message: string }) {
  const { k, params } = issueKey(message);
  return <Tf k={k} params={params} />;
}

// ── 클라이언트 검증(서버 validateSteps 미러 — 입력 중 즉시 피드백, 발행은 서버가 최종 권위) ──
function validateClient(steps: Step[], knownGateRules: Set<string>, knownCondFields: Set<string> = new Set()): Validation {
  const issues: Issue[] = [];
  const keys = new Set(steps.map((s) => s.key));
  let terminals = 0;
  for (const s of steps) {
    const ts = s.transitions ?? [];
    if (ts.length === 0) terminals++;
    for (const t of ts) {
      if (!t.toKey) issues.push({ severity: 'ERROR', step: s.key, message: '전이 대상 미선택' });
      else if (!keys.has(t.toKey)) issues.push({ severity: 'ERROR', step: s.key, message: `전이 대상 단계 없음: ${t.toKey}` });
      const ce = condError(t.condition, knownCondFields);
      if (ce) issues.push({ severity: 'ERROR', step: s.key, message: ce });
    }
    if (ts.filter((t) => !t.condition).length > 1) issues.push({ severity: 'ERROR', step: s.key, message: '비결정 분기(무조건 전이 2개 이상)' });
    if (!s.ownerRoles?.length) issues.push({ severity: 'WARN', step: s.key, message: '담당 역할 미지정' });
    if (s.gate && !s.gateRule) issues.push({ severity: 'ERROR', step: s.key, message: '게이트 규칙(gateRule) 누락' });
    if (s.gate && s.gateRule && !knownGateRules.has(s.gateRule)) issues.push({ severity: 'ERROR', step: s.key, message: `미지원 게이트 술어: ${s.gateRule}` });
    if (!s.key) issues.push({ severity: 'ERROR', step: '(빈 키)', message: '단계 키가 비어 있음' });
  }
  if (steps.length && terminals === 0) issues.push({ severity: 'ERROR', step: '*', message: '종료 단계(전이 없음)가 없음 — 무한 경로' });
  // 도달성 BFS(첫 단계 기준)
  if (steps.length) {
    const seen = new Set([steps[0].key]); const q = [steps[0].key];
    const byKey = new Map(steps.map((s) => [s.key, s]));
    while (q.length) { const k = q.shift()!; for (const t of byKey.get(k)?.transitions ?? []) if (t.toKey && keys.has(t.toKey) && !seen.has(t.toKey)) { seen.add(t.toKey); q.push(t.toKey); } }
    for (const s of steps) if (!seen.has(s.key)) issues.push({ severity: 'WARN', step: s.key, message: '시작 단계에서 도달 불가' });
  }
  return { ok: !issues.some((i) => i.severity === 'ERROR'), issues };
}

// ── 클라이언트 what-if(서버 simulate 미러 — 자동 실행, DB 미변경) ──
function simulateClient(steps: Step[], flags: Record<string, boolean>) {
  const byKey = new Map<string, Step>(steps.map((s) => [s.key, s]));
  const path: { key: string; title: string; gate: boolean; gateRule: string | null; gatePassed: boolean | null; blocked: boolean; roles: string[]; sla: number | null }[] = [];
  const seen = new Set<string>();
  let cur: string | null = steps[0]?.key ?? null;
  let blockedAt: string | null = null;
  let lastNext: string | null = null;
  while (cur && byKey.has(cur) && !seen.has(cur) && path.length < 100) {
    seen.add(cur);
    const s: Step = byKey.get(cur)!;
    const gatePassed = s.gate && s.gateRule ? !!flags[s.gateRule] : null;
    const blocked = s.gate ? gatePassed === false : false;
    let next: string | null = null;
    if (!blocked) {
      const conditional = s.transitions.find((t: Transition) => t.condition && flags[t.condition]);
      next = (conditional ?? s.transitions.find((t: Transition) => !t.condition) ?? s.transitions[0])?.toKey ?? null;
    }
    path.push({ key: s.key, title: s.title, gate: s.gate, gateRule: s.gateRule, gatePassed, blocked, roles: s.ownerRoles, sla: s.slaMinutes });
    lastNext = next;
    if (blocked) { blockedAt = s.key; break; }
    cur = next;
  }
  const reached = new Set(path.map((p) => p.key));
  const unreached = steps.filter((s) => !reached.has(s.key)).map((s) => s.key);
  const totalSla = path.filter((p) => !p.blocked).reduce((a, p) => a + (p.sla ?? 0), 0);
  // 역할 핸드오프 체인(연속 동일 역할군 병합)
  // 🔴 병합 판정은 종전과 같은 한국어 라벨로 하고, 저장은 **역할 코드**로 한다 — 표시 시점에 번역하기 위해서다
  const handoff: string[][] = [];
  let lastLabel: string | undefined;
  for (const p of path) { const label = rolesKo(p.roles); if (label && lastLabel !== label) { handoff.push(p.roles); lastLabel = label; } }
  return { path, blockedAt, completed: !blockedAt && path.length > 0 && !lastNext, unreached, totalSla, handoff };
}

// ── DRAFT ↔ ACTIVE 변경 diff ──
function diffSteps(active: Step[] | undefined, draft: Step[]) {
  if (!active) return null;
  const a = new Map(active.map((s) => [s.key, s]));
  const d = new Map(draft.map((s) => [s.key, s]));
  const added = draft.filter((s) => !a.has(s.key)).map((s) => s.key);
  const removed = active.filter((s) => !d.has(s.key)).map((s) => s.key);
  const changed: { key: string; fields: string[] }[] = [];
  for (const s of draft) {
    const o = a.get(s.key); if (!o) continue;
    const f: string[] = [];
    if (o.title !== s.title) f.push('이름@명칭');
    if (o.ownerRoles.join(',') !== s.ownerRoles.join(',')) f.push('역할');
    if (o.gate !== s.gate || o.gateRule !== s.gateRule) f.push('게이트');
    if (o.chartView !== s.chartView) f.push('차트뷰');
    if ((o.slaMinutes ?? null) !== (s.slaMinutes ?? null)) f.push('SLA');
    if ((o.phase ?? null) !== (s.phase ?? null)) f.push('단계상');
    if (o.actionType !== s.actionType) f.push('액션');
    if (JSON.stringify(o.transitions) !== JSON.stringify(s.transitions)) f.push('전이');
    if (f.length) changed.push({ key: s.key, fields: f });
  }
  const reordered = active.map((s) => s.key).filter((k) => d.has(k)).join(',') !== draft.map((s) => s.key).filter((k) => a.has(k)).join(',');
  return { added, removed, changed, reordered, total: added.length + removed.length + changed.length + (reordered ? 1 : 0) };
}

export default function AdminProtocolsPage() {
  const fmtMin = useDurationText();
  const qc = useQueryClient();
  const { data: tplRes } = useQuery({ queryKey: ['admin-protocol-templates'], queryFn: () => apiClient.get<{ data: Template[] }>('/api/v1/protocols/templates') });
  const { data: monRes } = useQuery({ queryKey: ['admin-protocol-monitor'], queryFn: () => apiClient.get<{ data: Mon[] }>('/api/v1/protocols/monitor'), refetchInterval: 20000 });
  const { data: predRes } = useQuery({ queryKey: ['admin-protocol-predicates'], queryFn: () => apiClient.get<{ data: Predicates }>('/api/v1/protocols/predicates') });
  const templates = (tplRes?.data ?? []) as Template[];
  const monitor = (monRes?.data ?? []) as Mon[];
  const predicates = predRes?.data;

  const [editingId, setEditingId] = useState<string | null>(null);
  const [historyCode, setHistoryCode] = useState<string | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ['admin-protocol-templates'] });

  const cloneM = useMutation({
    mutationFn: (id: string) => apiClient.post<{ data: Template }>(`/api/v1/protocols/templates/${id}/clone`),
    onSuccess: (r) => { refresh(); setEditingId(r.data.id); setHistoryCode(null); },
  });
  const discardM = useMutation({
    mutationFn: (id: string) => apiClient.del<{ data: unknown }>(`/api/v1/protocols/drafts/${id}`),
    onSuccess: () => { refresh(); setEditingId(null); },
  });

  const groups = useMemo(() => {
    const byCode = new Map<string, { active?: Template; draft?: Template }>();
    for (const t of templates) {
      const g = byCode.get(t.code) ?? {};
      if (t.status === 'DRAFT') g.draft = t; else if (t.status === 'ACTIVE') g.active = t;
      byCode.set(t.code, g);
    }
    return [...byCode.entries()].map(([code, g]) => ({ code, ...g })).sort((a, b) => (a.active?.domain ?? '').localeCompare(b.active?.domain ?? ''));
  }, [templates]);

  const editing = editingId ? templates.find((t) => t.id === editingId && t.status === 'DRAFT') : null;
  const editingActive = editing ? templates.find((t) => t.code === editing.code && t.status === 'ACTIVE') : undefined;

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900"><T k="환자여정 프로토콜 관리" /></h1>
        <p className="text-sm text-gray-500 mt-1"><T k="프로토콜 정의를 저작·발행하면 그대로 다음단계 예측의 단일 소스가 됩니다. 발행은 새 버전을 만들며 진행 중 환자는 영향받지 않습니다." /></p>
      </div>

      {/* 인스턴스 모니터 */}
      <section className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
        <h2 className="text-sm font-bold text-gray-700 mb-3"><T k="진행 인스턴스 모니터" /> ({monitor.length})</h2>
        {monitor.length === 0 ? <p className="text-sm text-gray-400"><T k="진행 중 프로토콜 없음" /></p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-gray-400 border-b border-gray-100"><th className="py-1.5 pr-3"><T k="상태" /></th><th className="pr-3"><T k="도메인" /></th><th className="pr-3"><T k="환자" /></th><th className="pr-3"><T k="현재 단계" /></th><th className="pr-3"><T k="게이트" /></th><th><T k="경과" /></th></tr></thead>
              <tbody>
                {monitor.map((m) => (
                  <tr key={m.instanceId} className={`border-b border-gray-50 ${m.blocked ? 'bg-red-50' : ''}`}>
                    <td className="py-1.5 pr-3">{m.blocked ? <span className="text-xs font-bold text-red-600 whitespace-nowrap">🔒 <T k="차단" /></span> : <span className="text-xs text-emerald-600"><T k="진행" /></span>}</td>
                    <td className="pr-3 text-gray-600"><T k={DOMAIN_KO[m.domain] ?? m.domain} /></td>
                    <td className="pr-3 font-medium text-gray-800">{m.patientName} <span className="text-xs text-gray-400">{m.mrn}</span></td>
                    <td className="pr-3 text-gray-700">{m.currentStepKey ?? '—'}</td>
                    <td className="pr-3 text-gray-500">{m.gate ? `${m.gate.done}/${m.gate.total}${m.gate.detail ? ` · ${m.gate.detail}` : ''}` : '—'}</td>
                    <td className="text-gray-500 whitespace-nowrap">{fmtMin(m.activeMinutes)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* 편집기 */}
      {editing && predicates && (
        <DraftEditor key={editing.id} draft={editing} activeSteps={editingActive?.steps} predicates={predicates} onClose={() => setEditingId(null)} onPublished={() => { refresh(); setEditingId(null); }} onSaved={refresh} onDiscard={() => discardM.mutate(editing.id)} />
      )}

      {/* 프로토콜 정의 목록 */}
      <section className="space-y-4">
        {groups.map((g) => {
          const t = g.active ?? g.draft!;
          const view = g.active ?? t;
          return (
            <div key={g.code} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
              <div className="flex items-center justify-between mb-3 gap-2">
                <h3 className="text-base font-bold text-gray-800">{t.name} <span className="text-xs text-gray-400 whitespace-nowrap">{g.code} · <T k={DOMAIN_KO[t.domain] ?? t.domain} /> v{g.active?.version ?? t.version}</span></h3>
                <div className="flex items-center gap-2 shrink-0">
                  <span className={`text-xs font-bold px-2.5 py-1 rounded-full whitespace-nowrap ${view.validation.ok ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>{view.validation.ok ? <T k="✓ 발행 유효" /> : <><T k="✕ 오류" /> {view.validation.issues.filter((i) => i.severity === 'ERROR').length}</>}</span>
                  <button onClick={() => setHistoryCode(historyCode === g.code ? null : g.code)} className="text-xs font-medium px-3 py-1.5 rounded-lg bg-gray-50 text-gray-600 hover:bg-gray-100 whitespace-nowrap"><T k="버전 이력" /></button>
                  {g.draft ? (
                    <button onClick={() => setEditingId(g.draft!.id)} className="text-xs font-bold px-3 py-1.5 rounded-lg bg-amber-100 text-amber-700 hover:bg-amber-200 whitespace-nowrap">✎ DRAFT v{g.draft.version} <T k="편집" /></button>
                  ) : (
                    <button onClick={() => g.active && cloneM.mutate(g.active.id)} disabled={cloneM.isPending} className="text-xs font-bold px-3 py-1.5 rounded-lg bg-blue-50 text-blue-700 hover:bg-blue-100 disabled:opacity-50 whitespace-nowrap">{cloneM.isPending ? '…' : <T k="편집(DRAFT 생성)" />}</button>
                  )}
                </div>
              </div>
              {view.validation.issues.length > 0 && (
                <ul className="mb-3 space-y-1">
                  {view.validation.issues.map((i, k) => (
                    <li key={k} className={`text-xs ${i.severity === 'ERROR' ? 'text-red-600' : 'text-amber-600'}`}>[{i.severity}] <StepRef step={i.step} />: <IssueText message={i.message} /></li>
                  ))}
                </ul>
              )}
              <FlowGraph steps={view.steps} validation={view.validation} />
              {historyCode === g.code && <VersionHistory code={g.code} onRollback={(id) => cloneM.mutate(id)} />}
            </div>
          );
        })}
      </section>
    </div>
  );
}

// ── 분기 그래프(해피패스 + 분기/조건 + 미도달/종료 표시) ──
function FlowGraph({ steps, validation, dirtyKeys }: { steps: Step[]; validation: Validation; dirtyKeys?: Set<string> }) {
  const tAttrG = useTAttr();
  const tfAttrG = useTfAttr();
  const issueStr = (i: Issue) => { const { k, params } = issueKey(i.message); return tfAttrG(k, params); };
  const keys = new Set(steps.map((s) => s.key));
  const issueByStep = new Map<string, Issue[]>();
  for (const i of validation.issues) { const a = issueByStep.get(i.step) ?? []; a.push(i); issueByStep.set(i.step, a); }
  // 해피패스: 첫 단계 → 첫 무조건 전이 체인
  const byKey = new Map<string, Step>(steps.map((s) => [s.key, s]));
  const happy: string[] = []; const seen = new Set<string>();
  let cur: string | null = steps[0]?.key ?? null;
  while (cur && byKey.has(cur) && !seen.has(cur)) { seen.add(cur); happy.push(cur); const cs: Step = byKey.get(cur)!; cur = (cs.transitions.find((t: Transition) => !t.condition) ?? cs.transitions[0])?.toKey ?? null; }
  const reached = new Set<string>(); { const q = [steps[0]?.key].filter(Boolean) as string[]; const sn = new Set(q); while (q.length) { const k = q.shift()!; reached.add(k); for (const t of byKey.get(k)?.transitions ?? []) if (t.toKey && keys.has(t.toKey) && !sn.has(t.toKey)) { sn.add(t.toKey); q.push(t.toKey); } } }
  const branchy = steps.filter((s) => s.transitions.length > 1 || s.transitions.some((t) => t.condition));

  const node = (key: string) => {
    const s = byKey.get(key); if (!s) return null;
    const errs = (issueByStep.get(key) ?? []).filter((i) => i.severity === 'ERROR').length;
    const warns = (issueByStep.get(key) ?? []).filter((i) => i.severity === 'WARN').length;
    const terminal = s.transitions.length === 0;
    return (
      <span key={key} className="inline-flex items-center gap-1" title={(issueByStep.get(key) ?? []).map(issueStr).join('\n')}>
        <span className={`px-3 py-1.5 rounded-xl text-sm border ${errs ? 'border-red-400 bg-red-50 text-red-800 ring-1 ring-red-300' : warns ? 'border-amber-300 bg-amber-50/60 text-amber-800' : s.gate ? 'bg-amber-50 text-amber-800 border-amber-200' : 'bg-gray-50 text-gray-700 border-gray-200'} ${dirtyKeys?.has(key) ? 'shadow-[0_0_0_2px_rgba(59,130,246,0.35)]' : ''}`}>
          {s.title}{s.gate ? ' 🔒' : ''}{terminal ? ' ⏹' : ''}{errs ? ' ⚠' : ''}
          <span className="block text-[10px] text-gray-400">{rolesKo(s.ownerRoles, tAttrG) || tAttrG('역할?')}{s.slaMinutes ? ` · ${s.slaMinutes}m` : ''}{s.gateRule ? ` · ${s.gateRule}` : ''}</span>
        </span>
      </span>
    );
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {happy.map((k, idx) => (
          <span key={k} className="inline-flex items-center gap-1">{node(k)}{idx < happy.length - 1 && <span className="text-gray-300">→</span>}</span>
        ))}
      </div>
      {/* 해피패스 밖 단계(분기 타깃·고립) */}
      {steps.filter((s) => !happy.includes(s.key)).length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 pl-2 border-l-2 border-dashed border-gray-200">
          <span className="text-[11px] text-gray-400"><T k="기타:" /></span>
          {steps.filter((s) => !happy.includes(s.key)).map((s) => node(s.key))}
        </div>
      )}
      {/* 분기/조건 요약 */}
      {branchy.length > 0 && (
        <div className="text-[11px] text-gray-500 space-y-0.5 pt-1">
          {branchy.map((s) => (
            <div key={s.key}><span className="font-medium text-gray-600">{s.title}</span> {s.transitions.map((t, i) => <span key={i} className="ml-1">→ {(byKey.get(t.toKey)?.title ?? t.toKey) || '?'}{t.condition ? <span className="text-indigo-500"> [{t.condition}]</span> : ''}</span>)}</div>
          ))}
        </div>
      )}
      {steps.some((s) => !reached.has(s.key)) && <div className="text-[11px] text-amber-600">⚠ <T k="도달 불가:" /> {steps.filter((s) => !reached.has(s.key)).map((s) => s.key).join(', ')}</div>}
    </div>
  );
}

// ── 버전 히스토리 ──
function VersionHistory({ code, onRollback }: { code: string; onRollback: (id: string) => void }) {
  const { data, isLoading } = useQuery({ queryKey: ['admin-protocol-history', code], queryFn: () => apiClient.get<{ data: HistVer[] }>('/api/v1/protocols/history', { code }) });
  const vers = (data?.data ?? []) as HistVer[];
  return (
    <div className="mt-3 border-t border-gray-100 pt-3">
      <h4 className="text-xs font-bold text-gray-500 mb-2"><T k="버전 이력" /></h4>
      {isLoading ? <p className="text-xs text-gray-400"><T k="불러오는 중…" /></p> : (
        <table className="w-full text-xs">
          <thead><tr className="text-left text-gray-400"><th className="pr-3 py-1"><T k="버전" /></th><th className="pr-3"><T k="상태" /></th><th className="pr-3"><T k="단계" /></th><th className="pr-3"><T k="발행" /></th><th className="pr-3"><T k="사용 인스턴스" /></th><th></th></tr></thead>
          <tbody>
            {vers.map((v) => (
              <tr key={v.id} className="border-t border-gray-50">
                <td className="pr-3 py-1 font-mono">v{v.version}</td>
                <td className="pr-3"><span className={`px-1.5 py-0.5 rounded ${v.status === 'ACTIVE' ? 'bg-emerald-100 text-emerald-700' : v.status === 'DRAFT' ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-500'}`}><T k={STATUS_KO[v.status] ?? v.status} /></span></td>
                <td className="pr-3 text-gray-500">{v.stepCount}<Unit>단계</Unit> {v.validation.ok ? '' : <span className="text-red-500">✕</span>}</td>
                <td className="pr-3 text-gray-500">{v.publishedAt ? `${kdate(new Date(v.publishedAt))}${v.publishedBy ? ` · ${v.publishedBy}` : ''}` : '—'}</td>
                <td className="pr-3 text-gray-500">{v.instanceCount}<Unit><T k="건" /></Unit></td>
                <td>{v.status === 'RETIRED' && <button onClick={() => onRollback(v.id)} className="text-blue-600 hover:underline"><T k="이 버전으로 되돌리기" /></button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ── DRAFT 편집기 ──
function DraftEditor({ draft, activeSteps, predicates, onClose, onPublished, onSaved, onDiscard }: { draft: Template; activeSteps?: Step[]; predicates: Predicates; onClose: () => void; onPublished: () => void; onSaved: () => void; onDiscard: () => void }) {
  const fmtMin = useDurationText();
  const tAttr = useTAttr();
  const initial = useMemo(() => ({ name: draft.name, description: draft.description ?? '', steps: draft.steps.map((s) => ({ ...s, transitions: [...(s.transitions ?? [])] })) }), [draft]);
  const [name, setName] = useState(initial.name);
  const [description, setDescription] = useState(initial.description);
  const [steps, setSteps] = useState<Step[]>(initial.steps);
  const [sampleFlags, setSampleFlags] = useState<Record<string, boolean>>({});
  const [savedSnapshot, setSavedSnapshot] = useState(() => JSON.stringify(initial));
  const [confirmAction, setConfirmAction] = useState<null | 'publish' | 'discard' | 'close'>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [overIdx, setOverIdx] = useState<number | null>(null);
  const [whatifMode, setWhatifMode] = useState<'sample' | 'real'>('sample');
  const [realInstanceId, setRealInstanceId] = useState('');

  const knownGateRules = useMemo(() => new Set(predicates.gatePredicates.map((p) => p.rule)), [predicates]);
  const knownCondFields = useMemo(() => new Set((predicates.conditionFields ?? []).map((f) => f.field)), [predicates]);
  const domainCondFields = (predicates.conditionFields ?? []).filter((f) => f.domains.includes(draft.domain));
  const current = useMemo(() => ({ name, description, steps: steps.map((s, i) => ({ ...s, sortOrder: i + 1 })) }), [name, description, steps]);
  const dirty = JSON.stringify(current) !== savedSnapshot;
  const validation = useMemo(() => validateClient(current.steps, knownGateRules, knownCondFields), [current.steps, knownGateRules, knownCondFields]);
  const sim = useMemo(() => simulateClient(current.steps, sampleFlags), [current.steps, sampleFlags]);
  const diff = useMemo(() => diffSteps(activeSteps, current.steps), [activeSteps, current.steps]);
  // 실데이터 what-if — 활성 인스턴스(도메인 일치)를 실제 게이트로 시뮬
  const activeQ = useQuery({ queryKey: ['protocol-active-instances'], queryFn: () => apiClient.get<{ data: ActiveInst[] }>('/api/v1/protocols/active'), enabled: whatifMode === 'real' });
  const realInstances = ((activeQ.data?.data ?? []) as ActiveInst[]).filter((i) => i.domain === draft.domain);
  const realSimM = useMutation({ mutationFn: (instanceId: string) => apiClient.post<{ data: RealSim }>('/api/v1/protocols/simulate-instance', { steps: current.steps, instanceId }).then((r) => r.data) });
  const dirtyKeys = useMemo(() => {
    const set = new Set<string>(); if (!diff) return set;
    diff.added.forEach((k) => set.add(k)); diff.changed.forEach((c) => set.add(c.key)); return set;
  }, [diff]);

  // 미저장 이탈 가드
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty]);

  const stepKeys = current.steps.map((s) => s.key);
  const gateRulesUsed = [...new Set(current.steps.filter((s) => s.gate && s.gateRule).map((s) => s.gateRule!))];
  const conditionsUsed = [...new Set(current.steps.flatMap((s) => s.transitions.map((t) => t.condition).filter(Boolean) as string[]))];
  const payload = () => ({ name, description: description || null, steps: current.steps });

  const saveM = useMutation({
    mutationFn: () => apiClient.put<{ data: Template }>(`/api/v1/protocols/drafts/${draft.id}`, payload()),
    onSuccess: (r) => {
      const snap = { name: r.data.name, description: r.data.description ?? '', steps: r.data.steps.map((s) => ({ ...s, transitions: [...(s.transitions ?? [])] })) };
      setName(snap.name); setDescription(snap.description); setSteps(snap.steps);
      setSavedSnapshot(JSON.stringify({ name: snap.name, description: snap.description, steps: snap.steps.map((s, i) => ({ ...s, sortOrder: i + 1 })) }));
      setSavedAt(Date.now()); onSaved();
    },
  });
  const publishM = useMutation({
    mutationFn: async () => {
      const saved = await apiClient.put<{ data: Template }>(`/api/v1/protocols/drafts/${draft.id}`, payload());
      if (!saved.data.validation.ok) throw new Error('VALIDATION_FAILED');
      return apiClient.post(`/api/v1/protocols/drafts/${draft.id}/publish`);
    },
    onSuccess: onPublished,
  });

  const update = (idx: number, patch: Partial<Step>) => setSteps((prev) => prev.map((s, i) => (i === idx ? { ...s, ...patch } : s)));
  const move = (idx: number, dir: -1 | 1) => setSteps((prev) => { const n = [...prev]; const j = idx + dir; if (j < 0 || j >= n.length) return prev; [n[idx], n[j]] = [n[j], n[idx]]; return n; });
  const reorder = (from: number, to: number) => setSteps((prev) => { if (from === to || from < 0 || to < 0 || from >= prev.length || to >= prev.length) return prev; const n = [...prev]; const [m] = n.splice(from, 1); n.splice(to, 0, m); return n; });
  const remove = (idx: number) => setSteps((prev) => prev.filter((_, i) => i !== idx));
  const add = () => setSteps((prev) => [...prev, { key: `STEP_${prev.length + 1}`, title: '새 단계', sortOrder: prev.length + 1, phase: null, ownerRoles: ['NURSE'], actionType: 'CHECK', gate: false, gateRule: null, chartView: 'summary', slaMinutes: null, transitions: [] }]);

  const tryClose = () => { if (dirty) setConfirmAction('close'); else onClose(); };
  const errCount = validation.issues.filter((i) => i.severity === 'ERROR').length;

  return (
    <section className="bg-white rounded-2xl border-2 border-amber-300 shadow-md p-5 space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h2 className="text-base font-bold text-amber-800">✎ <T k="편집 중" /> — {draft.code} v{draft.version} <span className="text-xs font-normal text-gray-400">(DRAFT)</span>{dirty && <span className="ml-2 text-xs text-blue-600">● <T k="저장 안 됨" /></span>}{!dirty && savedAt && <span className="ml-2 text-xs text-emerald-600"><T k="✓ 저장됨" /></span>}</h2>
          <p className="text-xs text-gray-500"><T k="저장은 DRAFT에만 반영됩니다." /> <b><T k="발행@프로토콜" /></b><T k="해야 신규 환자에게 적용됩니다." /></p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className={`text-xs font-bold px-2.5 py-1 rounded-full whitespace-nowrap ${validation.ok ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>{validation.ok ? <T k="✓ 발행 가능" /> : <><T k="✕ 오류" /> {errCount}</>}</span>
          <button onClick={() => saveM.mutate()} disabled={saveM.isPending || !dirty} className="text-xs font-bold px-3 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40">{saveM.isPending ? <T k="저장…" /> : <T k="저장" />}</button>
          <button onClick={() => setConfirmAction('publish')} disabled={publishM.isPending || !validation.ok} className="text-xs font-bold px-3 py-1.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-40" title={validation.ok ? '' : tAttr('검증 오류를 먼저 해결하세요')}>{publishM.isPending ? <T k="발행…" /> : <T k="발행@프로토콜" />}</button>
          <button onClick={() => setConfirmAction('discard')} className="text-xs font-bold px-3 py-1.5 rounded-lg bg-red-50 text-red-600 hover:bg-red-100"><T k="폐기@초안" /></button>
          <button onClick={tryClose} className="text-xs px-3 py-1.5 rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200"><T k="닫기" /></button>
        </div>
      </div>

      {/* 확인 다이얼로그(인라인) */}
      {confirmAction && (
        <div className="text-xs bg-gray-50 border border-gray-200 rounded-lg p-3 flex items-center justify-between">
          <span className="text-gray-700">
            {confirmAction === 'publish' && <Tf k="발행하면 v{버전}이(가) 운영 버전이 되고 기존 운영 버전은 은퇴합니다. 진행할까요?" params={{ 버전: draft.version }} />}
            {confirmAction === 'discard' && <T k="이 DRAFT를 폐기합니다. 편집 내용이 사라집니다. 진행할까요?" />}
            {confirmAction === 'close' && <T k="저장하지 않은 변경이 있습니다. 저장 없이 닫을까요?" />}
          </span>
          <span className="flex gap-2 shrink-0">
            <button onClick={() => { const a = confirmAction; setConfirmAction(null); if (a === 'publish') publishM.mutate(); else if (a === 'discard') onDiscard(); else onClose(); }} className="px-3 py-1 rounded-lg bg-gray-800 text-white">{confirmAction === 'publish' ? <T k="발행@프로토콜" /> : confirmAction === 'discard' ? <T k="폐기@초안" /> : <T k="닫기" />}</button>
            <button onClick={() => setConfirmAction(null)} className="px-3 py-1 rounded-lg bg-white border border-gray-200"><T k="취소" /></button>
          </span>
        </div>
      )}

      {publishM.isError && <div className="text-xs bg-red-50 border border-red-200 rounded-lg p-2.5 text-red-700"><T k="발행 실패 — 검증 오류를 해결하세요." /></div>}

      {/* 변경 요약(diff) */}
      {diff && diff.total > 0 && (
        <div className="text-xs bg-blue-50/60 border border-blue-100 rounded-lg p-3 text-blue-800">
          <b><T k="운영본 대비 변경" /></b>{diff.reordered && <> · <T k="순서 변경" /></>}
          {diff.added.length > 0 && <span> · <T k="추가" /> {diff.added.join(', ')}</span>}
          {diff.removed.length > 0 && <span className="text-red-600"> · <T k="삭제" /> {diff.removed.join(', ')}</span>}
          {diff.changed.map((c) => <span key={c.key}> · {c.key}({c.fields.map(tAttr).join('/')})</span>)}
        </div>
      )}

      {/* 라이브 검증 이슈 */}
      {validation.issues.length > 0 && (
        <ul className="text-xs space-y-0.5">
          {validation.issues.map((i, k) => <li key={k} className={i.severity === 'ERROR' ? 'text-red-600' : 'text-amber-600'}>[{i.severity}] <StepRef step={i.step} />: <IssueText message={i.message} /></li>)}
        </ul>
      )}

      {/* 라이브 그래프 미리보기 */}
      <div className="bg-gray-50/50 border border-gray-100 rounded-xl p-3">
        <FlowGraph steps={current.steps} validation={validation} dirtyKeys={dirtyKeys} />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <label className="text-xs text-gray-500"><T k="이름@명칭" /><input value={name} onChange={(e) => setName(e.target.value)} className="mt-1 w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm" /></label>
        <label className="text-xs text-gray-500"><T k="설명" /><input value={description} onChange={(e) => setDescription(e.target.value)} className="mt-1 w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm" /></label>
      </div>

      {/* 단계 편집 */}
      <div className="space-y-3">
        {steps.map((s, idx) => {
          const stepErr = validation.issues.some((i) => i.step === s.key && i.severity === 'ERROR');
          const domainMismatch = s.gate && s.gateRule ? !predicates.gatePredicates.find((p) => p.rule === s.gateRule)?.domains.includes(draft.domain) : false;
          return (
            <div key={idx}
              onDragOver={(e) => { if (dragIdx !== null && dragIdx !== idx) { e.preventDefault(); setOverIdx(idx); } }}
              onDragLeave={() => setOverIdx((o) => (o === idx ? null : o))}
              onDrop={(e) => { e.preventDefault(); if (dragIdx !== null) reorder(dragIdx, idx); setDragIdx(null); setOverIdx(null); }}
              className={`border rounded-xl p-3 transition-colors ${dragIdx === idx ? 'opacity-40' : ''} ${overIdx === idx && dragIdx !== null && dragIdx !== idx ? 'border-blue-400 ring-2 ring-blue-200' : stepErr ? 'border-red-300 bg-red-50/40' : 'border-gray-200 bg-gray-50/50'}`}>
              <div className="flex items-center gap-2 mb-2">
                <span draggable onDragStart={() => setDragIdx(idx)} onDragEnd={() => { setDragIdx(null); setOverIdx(null); }} title={tAttr('드래그하여 순서 변경')} className="cursor-grab active:cursor-grabbing text-gray-300 hover:text-gray-500 select-none px-0.5">⠿</span>
                <span className="text-xs font-mono text-gray-400 w-5">{idx + 1}</span>
                <input value={s.title} onChange={(e) => update(idx, { title: e.target.value })} placeholder={tAttr('단계명')} className="flex-1 border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm font-medium" />
                <input value={s.key} onChange={(e) => update(idx, { key: e.target.value })} placeholder="KEY" className="w-32 border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs font-mono" />
                <button onClick={() => move(idx, -1)} disabled={idx === 0} className="text-gray-400 hover:text-gray-700 disabled:opacity-30 px-1">↑</button>
                <button onClick={() => move(idx, 1)} disabled={idx === steps.length - 1} className="text-gray-400 hover:text-gray-700 disabled:opacity-30 px-1">↓</button>
                <button onClick={() => remove(idx)} className="text-red-400 hover:text-red-600 px-1">✕</button>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mb-2">
                <div className="text-[11px] text-gray-500"><T k="담당 역할" />
                  <div className="flex flex-wrap gap-1 mt-1">
                    {predicates.ownerRoles.map((r) => (
                      <button key={r} onClick={() => update(idx, { ownerRoles: s.ownerRoles.includes(r) ? s.ownerRoles.filter((x) => x !== r) : [...s.ownerRoles, r] })} className={`text-[11px] px-2 py-0.5 rounded-full border whitespace-nowrap ${s.ownerRoles.includes(r) ? 'bg-blue-100 text-blue-700 border-blue-200' : 'bg-white text-gray-400 border-gray-200'}`}><T k={ROLE_KO[r] ?? r} /></button>
                    ))}
                  </div>
                </div>
                <label className="text-[11px] text-gray-500"><T k="액션" />
                  <select value={s.actionType} onChange={(e) => update(idx, { actionType: e.target.value })} className="mt-1 w-full border border-gray-200 rounded-lg px-2 py-1 text-xs">
                    {predicates.actionTypes.map((a) => <option key={a} value={a}>{a}</option>)}
                  </select>
                </label>
                <label className="text-[11px] text-gray-500"><T k="차트뷰" />
                  <select value={s.chartView ?? ''} onChange={(e) => update(idx, { chartView: e.target.value || null })} className="mt-1 w-full border border-gray-200 rounded-lg px-2 py-1 text-xs">
                    <option value="">—</option>
                    {predicates.chartViews.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </label>
                <label className="text-[11px] text-gray-500"><T k="단계상(phase)" />
                  <input value={s.phase ?? ''} onChange={(e) => update(idx, { phase: e.target.value || null })} placeholder="ACT…" className="mt-1 w-full border border-gray-200 rounded-lg px-2 py-1 text-xs" />
                </label>
                <label className="text-[11px] text-gray-500"><T k="SLA(분)" />
                  <input type="number" value={s.slaMinutes ?? ''} onChange={(e) => update(idx, { slaMinutes: e.target.value ? Number(e.target.value) : null })} className="mt-1 w-full border border-gray-200 rounded-lg px-2 py-1 text-xs" />
                </label>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <label className="text-[11px] text-gray-600 flex items-center gap-1">
                  <input type="checkbox" checked={s.gate} onChange={(e) => update(idx, { gate: e.target.checked, gateRule: e.target.checked ? s.gateRule : null })} /> <T k="질관리 게이트" />
                </label>
                {s.gate && (
                  <select value={s.gateRule ?? ''} onChange={(e) => update(idx, { gateRule: e.target.value || null })} className={`border rounded-lg px-2 py-1 text-xs ${s.gateRule ? 'border-gray-200' : 'border-red-300 bg-red-50'}`}>
                    <option value="">{tAttr('게이트 술어 선택…')}</option>
                    {[...predicates.gatePredicates].sort((a, b) => Number(b.domains.includes(draft.domain)) - Number(a.domains.includes(draft.domain))).map((p) => <option key={p.rule} value={p.rule}>{p.domains.includes(draft.domain) ? '◉ ' : '○ '}{p.label} ({p.rule})</option>)}
                  </select>
                )}
                {domainMismatch && <span className="text-[11px] text-amber-600">⚠ <T k={DOMAIN_KO[draft.domain] ?? draft.domain} /> <T k="도메인에 없는 술어 — 게이트가 의도대로 동작하지 않을 수 있음" /></span>}
              </div>
              {/* 전이 */}
              <div className="mt-2 pl-2 border-l-2 border-gray-200">
                <div className="text-[11px] text-gray-500 mb-1"><T k="전이(다음 단계)" />{s.transitions.length === 0 && <span className="text-gray-400"> — <T k="없음(종료 단계 ⏹)" /></span>}</div>
                {s.transitions.map((t, ti) => (
                  <div key={ti} className="flex items-center gap-2 mb-1">
                    <span className="text-gray-300 text-xs">→</span>
                    <select value={t.toKey} onChange={(e) => update(idx, { transitions: s.transitions.map((x, k) => (k === ti ? { ...x, toKey: e.target.value } : x)) })} className={`border rounded-lg px-2 py-1 text-xs ${t.toKey ? 'border-gray-200' : 'border-red-300 bg-red-50'}`}>
                      <option value="">{tAttr('대상…')}</option>
                      {stepKeys.filter((k) => k !== s.key).map((k) => <option key={k} value={k}>{k}</option>)}
                    </select>
                    <input value={t.condition ?? ''} onChange={(e) => update(idx, { transitions: s.transitions.map((x, k) => (k === ti ? { ...x, condition: e.target.value || undefined } : x)) })} placeholder={tAttr('조건(선택)')} className="border border-gray-200 rounded-lg px-2 py-1 text-xs w-32" />
                    <button onClick={() => update(idx, { transitions: s.transitions.filter((_, k) => k !== ti) })} className="text-red-400 hover:text-red-600 text-xs px-1">✕</button>
                  </div>
                ))}
                <button onClick={() => update(idx, { transitions: [...s.transitions, { toKey: '' }] })} className="text-[11px] text-blue-600 hover:underline"><T k="+ 전이 추가" /></button>
                {s.transitions.some((t) => t.condition) && domainCondFields.length > 0 && (
                  <div className="text-[10px] text-gray-400 mt-0.5"><T k="조건식 필드:" /> {domainCondFields.map((f) => f.field).join(', ')} · <T k="예:" /> <code>ktas &lt;= 2</code>, <code>age &gt;= 65 && disposition == ADMISSION</code></div>
                )}
              </div>
            </div>
          );
        })}
        <button onClick={add} className="text-xs font-bold px-3 py-1.5 rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200"><T k="+ 단계 추가" /></button>
      </div>

      {/* what-if 시뮬레이터 */}
      <div className="bg-indigo-50/60 border border-indigo-100 rounded-xl p-3">
        <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
          <h3 className="text-sm font-bold text-indigo-800"><T k="what-if 시뮬레이션" /></h3>
          <div className="flex gap-1 bg-white/70 p-0.5 rounded-lg">
            <button onClick={() => setWhatifMode('sample')} className={`px-2.5 py-1 text-[11px] rounded-md ${whatifMode === 'sample' ? 'bg-indigo-600 text-white' : 'text-gray-500'}`}><T k="샘플(수동)" /></button>
            <button onClick={() => setWhatifMode('real')} className={`px-2.5 py-1 text-[11px] rounded-md ${whatifMode === 'real' ? 'bg-indigo-600 text-white' : 'text-gray-500'}`}><T k="실제 환자" /></button>
          </div>
        </div>

        {whatifMode === 'sample' ? (<>
          <p className="text-[11px] text-gray-500 mb-2"><T k="게이트/조건을 통과했다고 가정할 항목을 체크하면 경로가 즉시 갱신됩니다(DB 미변경). 예상 소요 합계" /> <b className="text-indigo-700">{fmtMin(sim.totalSla)}</b></p>
          {(gateRulesUsed.length > 0 || conditionsUsed.length > 0) && (
            <div className="flex flex-wrap gap-1.5 mb-2">
              {gateRulesUsed.map((r) => (
                <label key={r} className="text-[11px] flex items-center gap-1 bg-white border border-gray-200 rounded-full px-2 py-0.5"><input type="checkbox" checked={!!sampleFlags[r]} onChange={(e) => setSampleFlags((p) => ({ ...p, [r]: e.target.checked }))} /> {r}</label>
              ))}
              {conditionsUsed.map((c) => (
                <label key={c} className="text-[11px] flex items-center gap-1 bg-white border border-indigo-200 rounded-full px-2 py-0.5"><input type="checkbox" checked={!!sampleFlags[c]} onChange={(e) => setSampleFlags((p) => ({ ...p, [c]: e.target.checked }))} /> {c}</label>
              ))}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-1 mb-1">
            {sim.path.map((p, i) => (
              <span key={i} className="inline-flex items-center gap-1">
                <span className={`px-2.5 py-1 rounded-lg text-xs border ${p.blocked ? 'bg-red-100 text-red-700 border-red-300' : 'bg-white text-gray-700 border-gray-200'}`}>{p.title}{p.gate ? (p.gatePassed ? ' ✓' : ' 🔒') : ''}</span>
                {!p.blocked && i < sim.path.length - 1 && <span className="text-gray-300">→</span>}
              </span>
            ))}
          </div>
          <p className="text-[11px] text-gray-600">{sim.blockedAt ? <Tf k="🔒 '{단계}'에서 차단됨" params={{ 단계: sim.blockedAt }} /> : sim.completed ? <T k="✓ 종료 단계까지 완주" /> : <T k="경로 진행(종료 미도달)" />}{sim.handoff.length > 0 ? <> · <Tf k="역할 핸드오프: {경로}" params={{ 경로: sim.handoff.map((rs) => rolesKo(rs, tAttr)).join(' → ') }} /></> : ''}{sim.unreached.length > 0 ? <> · <Tf k="미도달: {단계}" params={{ 단계: sim.unreached.join(', ') }} /></> : ''}</p>
        </>) : (<>
          <p className="text-[11px] text-gray-500 mb-2"><T k="실제 진행 중" /> <T k={DOMAIN_KO[draft.domain] ?? draft.domain} /> <T k="인스턴스의" /> <b><T k="진짜 게이트 데이터" /></b><T k="로 현재 정의를 흘려봅니다(발행 전 실환자 검증·DB 미변경)." /></p>
          <div className="flex gap-2 mb-2">
            <select value={realInstanceId} onChange={(e) => { setRealInstanceId(e.target.value); if (e.target.value) realSimM.mutate(e.target.value); }} className="flex-1 border border-gray-200 rounded-lg px-2 py-1 text-xs bg-white">
              <option value="">{activeQ.isLoading ? tAttr('불러오는 중…') : realInstances.length ? tAttr('인스턴스 선택…') : tAttr('진행 중 인스턴스 없음')}</option>
              {realInstances.map((i) => <option key={i.instanceId} value={i.instanceId}>{i.patientName || i.label} {i.mrn} · {i.currentStepKey ?? '—'}</option>)}
            </select>
            <button onClick={() => realInstanceId && realSimM.mutate(realInstanceId)} disabled={!realInstanceId || realSimM.isPending} className="px-3 py-1 text-xs rounded-lg bg-indigo-600 text-white disabled:opacity-40">{realSimM.isPending ? '…' : <T k="재시뮬" />}</button>
          </div>
          {realSimM.data && (() => { const rs = realSimM.data; return (
            <>
              <div className="flex flex-wrap items-center gap-1 mb-1">
                {rs.path.map((p, i) => (
                  <span key={i} className="inline-flex items-center gap-1">
                    <span className={`px-2.5 py-1 rounded-lg text-xs border ${p.blocked ? 'bg-red-100 text-red-700 border-red-300' : 'bg-white text-gray-700 border-gray-200'}`}>{p.title}{p.gate ? (p.gatePassed ? ' ✓' : ' 🔒') : ''}</span>
                    {!p.blocked && i < rs.path.length - 1 && <span className="text-gray-300">→</span>}
                  </span>
                ))}
              </div>
              <p className="text-[11px] text-gray-600 mb-1.5">{rs.blockedAt ? <Tf k="🔒 '{단계}'에서 차단됨(실데이터)" params={{ 단계: rs.blockedAt }} /> : rs.completed ? <T k="✓ 종료까지 완주" /> : <T k="경로 진행(종료 미도달)" />}{rs.unreached.length > 0 ? <> · <Tf k="미도달: {단계}" params={{ 단계: rs.unreached.join(', ') }} /></> : ''}</p>
              {Object.keys(rs.gateResults).length > 0 && (
                <div className="space-y-0.5">
                  {Object.entries(rs.gateResults).map(([rule, g]) => (
                    <div key={rule} className="text-[11px] flex items-center gap-1.5">
                      <span className={g.passed ? 'text-emerald-600' : 'text-red-600'}>{g.passed ? '✓' : '🔒'}</span>
                      <span className="font-mono text-gray-500">{rule}</span>
                      <span className="text-gray-600">{g.done}/{g.total}{g.detail ? ` · ${g.detail}` : ''}</span>
                    </div>
                  ))}
                </div>
              )}
            </>
          ); })()}
          {realSimM.isError && <p className="text-[11px] text-red-500"><T k="시뮬레이션 실패 — 다시 시도하세요." /></p>}
        </>)}
      </div>
    </section>
  );
}
