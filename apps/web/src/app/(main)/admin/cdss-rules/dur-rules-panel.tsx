'use client';

/**
 * 판정 규칙(DUR 룰) 관리 · 코드 규칙 목록(2026-10-21 임상 규칙·템플릿 P1 · `clinical-rules-templates-review-2026-10.plan.md` A1).
 *
 * 🔴 종전 3105 화면은 판정이 읽지 않는 표(CdssRule)를 편집했고, 판정이 읽는 DUR 룰(`/api/v1/dur/rules`)은 부르는 화면이 0이었다.
 *  · 적중 = 처방 원장에 남은 경고 중 이 룰이 낸 것 — 룰 id 를 싣기 시작한 뒤부터만 센다(그 전은 "계측 전" · 0 아님)
 *  · 🔴 한 유형의 활성 룰이 0 이면 판정은 **코드 기본값**으로 대체된다 — 마지막 룰을 꺼도 그 유형은 꺼지지 않는다(그 사실을 말한다)
 *  · 쓰기는 관리자만(서버 @Roles ADMIN) · 삭제는 두지 않는다(끄기만 — 이력 보존)
 *  · 쓰기 폼은 비어서 시작한다(유형·심각도 미선택)
 */
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CLINICAL_CODE_RULES, DUR_RULE_TYPES, DUR_RULE_TYPE_LABEL, DUR_RULESET_KEY, type DurRuleType } from '@hospital-run/shared';
import { apiClient } from '@/lib/api-client';
import { useAuthStore } from '@/stores/auth-store';
import { toast } from '@/stores/toast-store';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { KDate } from '@/components/ui/display';
import { T, Tf, useTAttr } from '@/components/ui/i18n-text';

export interface DurRuleRow {
  id: string; ruleType: DurRuleType; severity: 'ERROR' | 'WARNING';
  drugA: string | null; drugB: string | null; keywords: string[] | null;
  minAge: number | null; maxAge: number | null; maxDailyDose: number | null; maxPerKgDay: number | null; maxAbsolute: number | null;
  unit: string | null; message: string; isActive: boolean; source: string | null; updatedAt: string;
  /** null = 계측 전(룰 id 기록 시작 전) */
  hits: number | null;
}
export interface DurOverview {
  rules: DurRuleRow[];
  window: { days: number; from: string; effectiveFrom: string | null };
  metering: { since: string | null };
  sourceByType: Record<'interaction' | 'age' | 'maxDose' | 'beers' | 'pediatric', 'TABLE' | 'FALLBACK'> | null;
  codeRules: unknown[];
}

const unwrap = <X,>(r: unknown): X | undefined => ((r as { data?: { data?: X } })?.data?.data ?? (r as { data?: X })?.data);

/** 룰 대상 한 줄 — 유형마다 쓰는 칸이 다르다 */
export function durTarget(r: Pick<DurRuleRow, 'ruleType' | 'drugA' | 'drugB' | 'keywords' | 'minAge' | 'maxAge' | 'maxDailyDose' | 'maxPerKgDay' | 'maxAbsolute' | 'unit'>): string {
  switch (r.ruleType) {
    case 'INTERACTION': return `${r.drugA ?? '?'} + ${r.drugB ?? '?'}`;
    case 'AGE': return `${r.drugA ?? '?'} · ${r.minAge != null ? `≥${r.minAge}` : ''}${r.minAge != null && r.maxAge != null ? ' ' : ''}${r.maxAge != null ? `≤${r.maxAge}` : ''}`;
    case 'MAX_DOSE': return `${r.drugA ?? '?'} · ${r.maxDailyDose ?? '?'}${r.unit ?? 'mg'}/day`;
    case 'BEERS': return (r.keywords ?? []).join(', ');
    case 'PEDIATRIC_DOSE': return `${r.drugA ?? '?'} · ${r.maxPerKgDay ?? '?'}${r.unit ?? 'mg'}/kg/day${r.maxAbsolute != null ? ` (≤${r.maxAbsolute})` : ''}`;
  }
}

type Form = { ruleType: DurRuleType | ''; severity: 'ERROR' | 'WARNING' | ''; drugA: string; drugB: string; keywords: string; minAge: string; maxAge: string; maxDailyDose: string; maxPerKgDay: string; maxAbsolute: string; unit: string; message: string; source: string };
const EMPTY: Form = { ruleType: '', severity: '', drugA: '', drugB: '', keywords: '', minAge: '', maxAge: '', maxDailyDose: '', maxPerKgDay: '', maxAbsolute: '', unit: '', message: '', source: '' };
const num = (v: string) => (v.trim() === '' ? undefined : Number(v));

/** 폼 → 서버 본문 · 유형별 필수 칸이 비면 이유(문자열) */
export function durFormBody(f: Form): { body?: Record<string, unknown>; missing?: string } {
  if (!f.ruleType) return { missing: '유형을 고르세요' };
  if (!f.severity) return { missing: '심각도를 고르세요' };
  if (!f.message.trim()) return { missing: '경고 문구를 입력하세요' };
  const kw = f.keywords.split(',').map((k) => k.trim()).filter(Boolean);
  const need: Record<DurRuleType, () => string | null> = {
    INTERACTION: () => (!f.drugA.trim() || !f.drugB.trim() ? '두 성분을 모두 입력하세요' : null),
    AGE: () => (!f.drugA.trim() ? '성분을 입력하세요' : num(f.minAge) == null && num(f.maxAge) == null ? '최소·최대 나이 중 하나는 필요합니다' : null),
    MAX_DOSE: () => (!f.drugA.trim() || num(f.maxDailyDose) == null ? '성분과 일일 상한이 필요합니다' : null),
    BEERS: () => (!kw.length ? '키워드를 하나 이상 입력하세요' : null),
    PEDIATRIC_DOSE: () => (!f.drugA.trim() || num(f.maxPerKgDay) == null ? '성분과 kg당 일일 상한이 필요합니다' : null),
  };
  const miss = need[f.ruleType]();
  if (miss) return { missing: miss };
  return {
    body: {
      ruleType: f.ruleType, severity: f.severity, message: f.message.trim(),
      ...(f.drugA.trim() ? { drugA: f.drugA.trim() } : {}), ...(f.drugB.trim() ? { drugB: f.drugB.trim() } : {}),
      ...(kw.length ? { keywords: kw } : {}),
      ...(num(f.minAge) != null ? { minAge: num(f.minAge) } : {}), ...(num(f.maxAge) != null ? { maxAge: num(f.maxAge) } : {}),
      ...(num(f.maxDailyDose) != null ? { maxDailyDose: num(f.maxDailyDose) } : {}), ...(num(f.maxPerKgDay) != null ? { maxPerKgDay: num(f.maxPerKgDay) } : {}),
      ...(num(f.maxAbsolute) != null ? { maxAbsolute: num(f.maxAbsolute) } : {}),
      ...(f.unit.trim() ? { unit: f.unit.trim() } : {}), ...(f.source.trim() ? { source: f.source.trim() } : {}),
    },
  };
}

/** 저장된 룰 → 서버 본문(끄기·켜기 — DTO 가 유형·심각도·문구를 요구한다) */
const rowBody = (r: DurRuleRow, isActive: boolean) => ({
  ruleType: r.ruleType, severity: r.severity, message: r.message, isActive,
  ...(r.drugA ? { drugA: r.drugA } : {}), ...(r.drugB ? { drugB: r.drugB } : {}), ...(r.keywords?.length ? { keywords: r.keywords } : {}),
  ...(r.minAge != null ? { minAge: r.minAge } : {}), ...(r.maxAge != null ? { maxAge: r.maxAge } : {}),
  ...(r.maxDailyDose != null ? { maxDailyDose: r.maxDailyDose } : {}), ...(r.maxPerKgDay != null ? { maxPerKgDay: r.maxPerKgDay } : {}),
  ...(r.maxAbsolute != null ? { maxAbsolute: r.maxAbsolute } : {}), ...(r.unit ? { unit: r.unit } : {}), ...(r.source ? { source: r.source } : {}),
});

export function DurRulesPanel() {
  const tA = useTAttr();
  const qc = useQueryClient();
  const canWrite = useAuthStore((s) => s.user?.role) === 'ADMIN';
  const [type, setType] = useState<DurRuleType | ''>('');
  const [showInactive, setShowInactive] = useState(false);
  const [form, setForm] = useState<Form | null>(null);
  const [editId, setEditId] = useState<string | null>(null);

  const q = useQuery({ queryKey: ['dur-overview'], queryFn: () => apiClient.get('/api/v1/dur/rules/overview', { days: 90 }) });
  const ov = unwrap<DurOverview>(q.data);
  const rules = useMemo(() => (ov?.rules ?? []).filter((r) => (!type || r.ruleType === type) && (showInactive || r.isActive)), [ov, type, showInactive]);
  const activeOfType = (t: DurRuleType) => (ov?.rules ?? []).filter((r) => r.ruleType === t && r.isActive).length;

  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) => (editId ? apiClient.patch(`/api/v1/dur/rules/${editId}`, body) : apiClient.post('/api/v1/dur/rules', body)),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['dur-overview'] }); setForm(null); setEditId(null); toast.success(tA('저장했습니다 — 판정에 1분 안에 반영됩니다.')); },
    onError: (e) => toast.error((e as { message?: string })?.message ?? tA('저장하지 못했습니다.')),
  });
  // 영향 미리보기(P4 B2) — 지난 30일 처방에 걸렸을 건수 · 수정이면 지금 룰과 비교 · 저장 없음
  type PreviewOne = { supported: boolean; reason?: string; matchedRx: number; matchedPatients: number; doseExceeded?: number; doseUnreadable?: number };
  const [preview, setPreview] = useState<{ windowDays: number; scanned: number; truncated: boolean; draft: PreviewOne; current: PreviewOne | null } | null>(null);
  const runPreview = useMutation({
    mutationFn: (body: Record<string, unknown>) => apiClient.post('/api/v1/dur/rules/preview', { ...body, ...(editId ? { id: editId } : {}) }),
    onSuccess: (r) => setPreview(unwrap(r) as never),
    onError: (e) => { setPreview(null); toast.error((e as { message?: string })?.message ?? tA('미리보기를 하지 못했습니다.')); },
  });
  const toggle = useMutation({
    mutationFn: (r: DurRuleRow) => apiClient.patch(`/api/v1/dur/rules/${r.id}`, rowBody(r, !r.isActive)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['dur-overview'] }),
    onError: (e) => toast.error((e as { message?: string })?.message ?? tA('바꾸지 못했습니다.')),
  });

  if (q.isError) return <QueryErrorFallback error={q.error} onRetry={q.refetch} />;
  if (!ov) return <p className="text-sm text-gray-400"><T k="불러오는 중…" /></p>;
  const fallbackTypes = ov.sourceByType ? DUR_RULE_TYPES.filter((t) => ov.sourceByType![DUR_RULESET_KEY[t]] === 'FALLBACK') : null;
  const draft = form ? durFormBody(form) : null;

  return (
    <section className="space-y-4" data-dur-panel>
      <div className="rounded-xl border border-gray-200 bg-white px-4 py-3 text-[13px] text-gray-700 space-y-1">
        <p><Tf k="처방을 저장할 때 이 표의 활성 룰 {수}건으로 경고·차단을 판정합니다(1분 캐시)." params={{ 수: (ov.rules ?? []).filter((r) => r.isActive).length }} /></p>
        <p data-dur-metering={ov.metering.since ? 'ON' : 'NONE'}>
          {ov.metering.since
            ? <Tf k="적중 = {날짜} 이후 처방 원장에 남은 경고 중 이 룰이 낸 것(최근 {일}일)." params={{ 날짜: <KDate value={ov.window.effectiveFrom ?? ov.metering.since} mode="date" />, 일: ov.window.days }} />
            : <T k="적중 계측 전 — 룰 id 를 경고에 싣기 시작한 뒤 처방이 저장되면 셉니다(지금 0 이 아니라 모름)." />}
        </p>
        <p className="text-gray-500" data-dur-burden-link>
          <T k="적중은 경고가 남은 채 저장된 처방만 셉니다 — 경고를 보고 처방을 바꾼 경우는 남지 않습니다. 경고 부담(무시) 지표는" />{' '}
          <a href="/orders" className="text-blue-700 underline"><T k="오더 화면 → 질 지표 탭" /></a>
        </p>
        {fallbackTypes === null && <p className="text-amber-800" data-dur-source-unknown><T k="유형별 출처(표·코드 기본값)를 확인하지 못했습니다." /></p>}
      </div>
      {fallbackTypes && fallbackTypes.length > 0 && (
        <div className="rounded-xl border-2 border-amber-300 bg-amber-50 px-4 py-3 text-[13px] text-amber-900" data-dur-fallback={fallbackTypes.join(',')}>
          <p className="font-semibold"><T k="활성 룰이 없어 코드 기본값으로 판정하는 유형" />: {fallbackTypes.map((t) => tA(DUR_RULE_TYPE_LABEL[t])).join(' · ')}</p>
          <p><T k="이 유형은 표에서 모두 꺼도 꺼지지 않습니다 — 판정 공백을 막으려고 코드에 박힌 기본 룰이 대신 쓰입니다." /></p>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => setType('')} className={`rounded-full px-3 py-1 text-xs ${!type ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600'}`}><T k="전체" /></button>
        {DUR_RULE_TYPES.map((t) => (
          <button key={t} onClick={() => setType(t)} data-dur-type={t} className={`rounded-full px-3 py-1 text-xs ${type === t ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600'}`}>
            <T k={DUR_RULE_TYPE_LABEL[t]} /> <span className="tabular-nums opacity-70">{activeOfType(t)}</span>
          </button>
        ))}
        <label className="ml-2 flex items-center gap-1 text-xs text-gray-600"><input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} /><T k="꺼진 룰도 보기" /></label>
        {canWrite && <button onClick={() => { setForm({ ...EMPTY }); setEditId(null); }} className="ml-auto min-h-[40px] rounded-lg bg-indigo-600 px-4 text-sm font-semibold text-white" data-dur-add><T k="룰 추가" /></button>}
      </div>

      {form && (
        <div className="rounded-xl border-2 border-indigo-200 bg-indigo-50/40 p-4 space-y-2 text-sm" data-dur-form>
          <div className="flex flex-wrap gap-2">
            <select value={form.ruleType} onChange={(e) => setForm({ ...form, ruleType: e.target.value as DurRuleType })} disabled={!!editId} aria-label={tA('유형')} data-dur-form-type className="min-h-[40px] rounded-lg border px-2">
              <option value="">{tA('— 유형 —')}</option>
              {DUR_RULE_TYPES.map((t) => <option key={t} value={t}>{tA(DUR_RULE_TYPE_LABEL[t])}</option>)}
            </select>
            <select value={form.severity} onChange={(e) => setForm({ ...form, severity: e.target.value as 'ERROR' | 'WARNING' })} aria-label={tA('심각도')} data-dur-form-severity className="min-h-[40px] rounded-lg border px-2">
              <option value="">{tA('— 심각도 —')}</option>
              <option value="ERROR">{tA('차단(ERROR)')}</option>
              <option value="WARNING">{tA('경고(WARNING)')}</option>
            </select>
          </div>
          {form.ruleType && form.ruleType !== 'BEERS' && (
            <div className="flex flex-wrap gap-2">
              <input value={form.drugA} onChange={(e) => setForm({ ...form, drugA: e.target.value })} placeholder={tA(form.ruleType === 'INTERACTION' ? '성분 A' : '성분')} className="min-h-[40px] rounded-lg border px-2" />
              {form.ruleType === 'INTERACTION' && <input value={form.drugB} onChange={(e) => setForm({ ...form, drugB: e.target.value })} placeholder={tA('성분 B')} className="min-h-[40px] rounded-lg border px-2" />}
              {form.ruleType === 'AGE' && <>
                <input value={form.minAge} onChange={(e) => setForm({ ...form, minAge: e.target.value })} inputMode="numeric" placeholder={tA('이 나이 이상')} className="w-32 min-h-[40px] rounded-lg border px-2" />
                <input value={form.maxAge} onChange={(e) => setForm({ ...form, maxAge: e.target.value })} inputMode="numeric" placeholder={tA('이 나이 이하')} className="w-32 min-h-[40px] rounded-lg border px-2" />
              </>}
              {form.ruleType === 'MAX_DOSE' && <input value={form.maxDailyDose} onChange={(e) => setForm({ ...form, maxDailyDose: e.target.value })} inputMode="decimal" placeholder={tA('일일 상한')} className="w-32 min-h-[40px] rounded-lg border px-2" />}
              {form.ruleType === 'PEDIATRIC_DOSE' && <>
                <input value={form.maxPerKgDay} onChange={(e) => setForm({ ...form, maxPerKgDay: e.target.value })} inputMode="decimal" placeholder={tA('kg당 일일 상한')} className="w-36 min-h-[40px] rounded-lg border px-2" />
                <input value={form.maxAbsolute} onChange={(e) => setForm({ ...form, maxAbsolute: e.target.value })} inputMode="decimal" placeholder={tA('절대 상한(선택)')} className="w-36 min-h-[40px] rounded-lg border px-2" />
              </>}
              {(form.ruleType === 'MAX_DOSE' || form.ruleType === 'PEDIATRIC_DOSE') && <input value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} placeholder="mg" className="w-20 min-h-[40px] rounded-lg border px-2" />}
            </div>
          )}
          {form.ruleType === 'BEERS' && <input value={form.keywords} onChange={(e) => setForm({ ...form, keywords: e.target.value })} placeholder={tA('키워드(쉼표로 · 영문·한글)')} className="w-full min-h-[40px] rounded-lg border px-2" />}
          <input value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} placeholder={tA('경고 문구(처방 화면에 그대로 보입니다)')} className="w-full min-h-[40px] rounded-lg border px-2" />
          <input value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })} placeholder={tA('근거(위원회 의결 번호 등 · 선택)')} className="w-full min-h-[40px] rounded-lg border px-2" />
          <div className="flex items-center gap-2">
            <button disabled={!draft?.body || save.isPending} onClick={() => draft?.body && save.mutate(draft.body)} data-dur-save className="min-h-[44px] rounded-lg bg-indigo-700 px-4 text-sm font-semibold text-white disabled:opacity-40"><T k="저장" /></button>
            <button disabled={!draft?.body || runPreview.isPending} onClick={() => draft?.body && runPreview.mutate(draft.body)} data-dur-preview
              className="min-h-[44px] rounded-lg border border-indigo-300 bg-white px-3 text-sm text-indigo-800 disabled:opacity-40"><T k="영향 미리보기" /></button>
            <button onClick={() => { setForm(null); setEditId(null); setPreview(null); }} className="min-h-[44px] px-3 text-sm text-gray-600"><T k="취소" /></button>
            {draft?.missing && <span className="text-xs text-amber-800" data-dur-missing><T k={draft.missing} /></span>}
          </div>
          {preview && (
            <div className="rounded-lg border border-indigo-200 bg-white px-3 py-2 text-[12px] text-gray-700 space-y-0.5" data-dur-preview-result>
              <p><Tf k="지난 {일}일 처방 {수}건을 대조했습니다(저장하지 않음)." params={{ 일: preview.windowDays, 수: preview.scanned }} />{preview.truncated && <span className="text-amber-800"> · <T k="상한에서 잘랐습니다" /></span>}</p>
              {preview.draft.supported
                ? <p className="font-semibold" data-dur-preview-draft={preview.draft.matchedRx}><Tf k="이 룰이면 처방 {처방}건(환자 {환자}명)에 경고가 붙었을 것입니다." params={{ 처방: preview.draft.matchedRx, 환자: preview.draft.matchedPatients }} />
                    {preview.draft.doseExceeded != null && <> · <Tf k="상한 초과 {a} · 용법 못 읽음 {b}" params={{ a: preview.draft.doseExceeded, b: preview.draft.doseUnreadable ?? 0 }} /></>}</p>
                : <p className="text-amber-800" data-dur-preview-unsupported={preview.draft.reason}><T k={preview.draft.reason === 'WEIGHT_NOT_IN_HISTORY' ? '소아 체중 기반 룰은 처방 당시 체중을 다시 잡지 않아 미리보기를 할 수 없습니다.' : '룰 내용이 부족해 미리보기를 할 수 없습니다.'} /></p>}
              {preview.current && preview.current.supported && <p data-dur-preview-current={preview.current.matchedRx}><Tf k="지금 저장된 룰: 처방 {처방}건(환자 {환자}명)" params={{ 처방: preview.current.matchedRx, 환자: preview.current.matchedPatients }} /></p>}
            </div>
          )}
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs text-gray-500">
            <tr>
              <th className="px-3 py-2 text-left"><T k="유형" /></th>
              <th className="px-3 py-2 text-left"><T k="대상" /></th>
              <th className="px-3 py-2 text-left"><T k="심각도" /></th>
              <th className="px-3 py-2 text-left"><T k="경고 문구" /></th>
              <th className="px-3 py-2 text-left"><T k="근거" /></th>
              <th className="px-3 py-2 text-right"><T k="적중" /></th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {rules.length === 0 && <tr><td colSpan={7} className="px-3 py-6 text-center text-gray-400"><T k="조건에 맞는 룰이 없습니다" /></td></tr>}
            {rules.map((r) => {
              const lastActive = r.isActive && activeOfType(r.ruleType) === 1;
              return (
                <tr key={r.id} className={`border-t ${r.isActive ? '' : 'opacity-50'}`} data-dur-row={r.id}>
                  <td className="px-3 py-2 whitespace-nowrap text-xs"><T k={DUR_RULE_TYPE_LABEL[r.ruleType] ?? r.ruleType} /></td>
                  <td className="px-3 py-2 text-xs">{durTarget(r)}</td>
                  <td className="px-3 py-2 text-xs"><span className={`rounded px-1.5 py-0.5 ${r.severity === 'ERROR' ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-700'}`}>{r.severity === 'ERROR' ? tA('차단') : tA('경고')}</span></td>
                  <td className="px-3 py-2 text-xs text-gray-700">{r.message}</td>
                  <td className="px-3 py-2 text-xs text-gray-500">{r.source === 'SEED' ? tA('개발 시드') : r.source ?? <span className="text-gray-300">-</span>}</td>
                  <td className="px-3 py-2 text-right text-xs tabular-nums" data-dur-hits={r.hits ?? 'unmeasured'}>{r.hits == null ? <span className="text-gray-400"><T k="계측 전" /></span> : r.hits}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    {canWrite && <>
                      <button onClick={() => { setEditId(r.id); setForm({ ...EMPTY, ruleType: r.ruleType, severity: r.severity, drugA: r.drugA ?? '', drugB: r.drugB ?? '', keywords: (r.keywords ?? []).join(', '), minAge: r.minAge?.toString() ?? '', maxAge: r.maxAge?.toString() ?? '', maxDailyDose: r.maxDailyDose?.toString() ?? '', maxPerKgDay: r.maxPerKgDay?.toString() ?? '', maxAbsolute: r.maxAbsolute?.toString() ?? '', unit: r.unit ?? '', message: r.message, source: r.source ?? '' }); }} className="text-xs text-indigo-600"><T k="편집" /></button>
                      <button
                        onClick={() => toggle.mutate(r)}
                        title={lastActive ? tA('이 유형의 마지막 활성 룰 — 끄면 코드 기본값으로 판정합니다(유형이 꺼지지 않습니다)') : undefined}
                        data-dur-toggle={r.id} data-dur-last-active={lastActive || undefined}
                        className="ml-2 text-xs text-gray-600">{r.isActive ? <T k="끄기" /> : <T k="켜기" />}</button>
                    </>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {!canWrite && <p className="text-xs text-gray-500"><T k="룰 편집은 관리자만 할 수 있습니다." /></p>}
      <p className="text-[11px] text-gray-400"><T k="룰 삭제는 두지 않습니다 — 끄면 이력이 남습니다." /></p>
    </section>
  );
}

/** 코드 규칙 — 판정 코드에 박힌 검사(편집 불가) · 정본 shared `clinical-code-rules` */
export function CodeRulesPanel() {
  return (
    <section className="space-y-3" data-code-rules>
      <p className="text-[13px] text-gray-700"><T k="아래 검사는 판정 코드에 들어 있어 화면에서 바꿀 수 없습니다 — 바꾸려면 개발 변경이 필요합니다." /></p>
      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs text-gray-500">
            <tr><th className="px-3 py-2 text-left"><T k="판정 단계" /></th><th className="px-3 py-2 text-left"><T k="검사" /></th><th className="px-3 py-2 text-left"><T k="무엇을 보는가" /></th></tr>
          </thead>
          <tbody>
            {CLINICAL_CODE_RULES.map((r) => (
              <tr key={r.key} className="border-t" data-code-rule={r.key}>
                <td className="px-3 py-2 text-xs"><T k={r.engine === 'DUR' ? '처방 저장(DUR)' : '보완 점검(CDSS)'} /></td>
                <td className="px-3 py-2 text-xs font-medium"><T k={r.label} /></td>
                <td className="px-3 py-2 text-xs text-gray-600"><T k={r.source} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
