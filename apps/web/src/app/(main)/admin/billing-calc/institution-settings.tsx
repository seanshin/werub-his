'use client';

/**
 * 요양기관 종별 · 건강보험 외래 본인부담률(종별) — 화면에서 정한다(2026-10-20 · 사용자 지시 "UI 화면으로 기능 구현").
 *
 * ① 종별 — 결정 `billing.institutionType`(허가권자 층 · 개설 허가가 정하는 사실)을 **결정 기록 경로 그대로** 남긴다
 *    (`POST admin/decisions/billing.institutionType/record` — 근거 필수 · 집행 엔진이 설정 `billing.institution.grade` 를 반영).
 *    🔴 설정을 직접 바꾸는 옆길을 두지 않는다(같은 화면의 설정 목록에서 종별 줄을 뺐다). 선택지는 미선택으로 시작한다.
 * ② 건보 외래 본인부담률 — 단일 율(현행) 또는 종별 차등(`billing.copay.nhi.outpatient.byGrade`). 🔴 율을 미리 채우지 않는다(법정 값을 지어내지 않는다).
 * 둘 다 새로 만드는 청구부터 적용된다(이미 만든 청구는 소급하지 않는다).
 */
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { extractErrorMessage } from '@/lib/error-utils';
import { T, useTAttr } from '@/components/ui/i18n-text';

type Grade = 'CLINIC' | 'HOSPITAL' | 'GENERAL' | 'TERTIARY';
const GRADES: Grade[] = ['CLINIC', 'HOSPITAL', 'GENERAL', 'TERTIARY'];
const GRADE_LABEL: Record<Grade, string> = { CLINIC: '의원', HOSPITAL: '병원', GENERAL: '종합병원', TERTIARY: '상급종합병원' };
const DECISION_KEY = 'billing.institutionType';
const BY_GRADE_KEY = 'billing.copay.nhi.outpatient.byGrade';

interface DecisionOption { value: string; label: string; effect: string; enact: { key: string; newValue: unknown } | null }
interface DecisionItem {
  key: string; title: string; options: DecisionOption[]; decided: boolean; seeded: boolean; currentConfigValue: unknown;
  record: { choice: string; legalReviewRef: string; authorityClaim: string; decidedAt: string; applied?: boolean; appliedDetail?: string } | null;
}
interface ConfigItem { key: string; value: unknown }

/* ── ① 요양기관 종별 ─────────────────────────────────────────── */
export function InstitutionGradePanel() {
  const tAttr = useTAttr();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['admin-decisions'],
    queryFn: () => apiClient.get<{ data: DecisionItem[] }>('/api/v1/admin/decisions'),
  });
  const d = q.data?.data?.find((x) => x.key === DECISION_KEY) ?? null;
  const [choice, setChoice] = useState<string | null>(null);
  const [legal, setLegal] = useState('');
  const [authority, setAuthority] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  const options = (d?.options ?? []).filter((o) => o.value !== 'OTHER'); // 치과·한방 등은 이 시스템 종별 어휘 밖 — 고를 수 없다(아래 안내)
  const selected = options.find((o) => o.value === choice) ?? null;
  const canSave = !!selected && legal.trim().length >= 4 && authority.trim().length >= 2 && !busy;
  const current = typeof d?.currentConfigValue === 'string' && (GRADES as string[]).includes(d.currentConfigValue) ? (d.currentConfigValue as Grade) : null;

  const save = async () => {
    if (!selected) return;
    setBusy(true); setResult(null);
    try {
      const res = await apiClient.post<{ data: { applied?: boolean; appliedDetail?: string } }>(`/api/v1/admin/decisions/${DECISION_KEY}/record`, {
        choice: selected.value, legalReviewRef: legal.trim(), authorityClaim: authority.trim(),
      });
      const r = res.data ?? {};
      setResult({ ok: true, text: r.applied ? tAttr('기록했고 설정에 반영했습니다 — 새로 만드는 청구부터 적용됩니다.') : `${tAttr('기록했습니다')} — ${r.appliedDetail ?? tAttr('설정은 바뀌지 않았습니다')}` });
      setChoice(null); setLegal(''); setAuthority('');
      await qc.invalidateQueries({ queryKey: ['admin-decisions'] });
    } catch (e) {
      setResult({ ok: false, text: extractErrorMessage(e) });
    } finally { setBusy(false); }
  };

  return (
    <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5 mb-4" data-institution-grade-panel>
      <h3 className="text-base font-bold text-gray-900"><T k="요양기관 종별" /></h3>
      <p className="text-xs text-gray-500 mt-0.5"><T k="개설 허가가 정하는 사실입니다 — 허가증·요양기관 현황 신고서와 같아야 합니다. 정하면 진찰료 코드·청구 단가(고시 종별 단가)·의료급여 정액·ERP 종별가산이 이 종별을 따릅니다." /></p>

      {q.isLoading && <p className="text-xs text-gray-400 mt-2"><T k="불러오는 중…" /></p>}
      {q.isError && <p className="text-xs text-rose-600 mt-2"><T k="결정 기록을 불러오지 못했습니다." /></p>}
      {d && (
        <>
          <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
            <div className="rounded-lg bg-gray-50 px-3 py-2">
              <span className="text-gray-500"><T k="지금 설정" />: </span>
              <b data-grade-current>{current ? <T k={GRADE_LABEL[current]} /> : <span className="text-amber-700"><T k="미설정(의원 코드·수가 마스터 단가로 청구)" /></span>}</b>
            </div>
            <div className="rounded-lg bg-gray-50 px-3 py-2" data-grade-decision>
              <span className="text-gray-500"><T k="결정 기록" />: </span>
              {d.record
                ? <>{d.seeded ? <span className="text-amber-700"><T k="개발 시드(실결정 아님)" /></span> : <b>{options.find((o) => o.value === d.record!.choice)?.label ?? d.record.choice}</b>}
                    <span className="text-gray-400"> · {d.record.decidedAt?.slice(0, 10)} · {d.record.legalReviewRef}</span></>
                : <span className="text-amber-700"><T k="기록 없음" /></span>}
            </div>
          </div>

          <fieldset className="mt-3">
            <legend className="text-xs font-semibold text-gray-700 mb-1"><T k="종별 선택" /></legend>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {options.map((o) => (
                <label key={o.value} className={`flex gap-2 items-start rounded-lg border px-3 py-2 text-xs cursor-pointer ${choice === o.value ? 'border-indigo-500 bg-indigo-50' : 'border-gray-200'}`}>
                  <input type="radio" name="institution-grade" value={o.value} checked={choice === o.value} onChange={() => setChoice(o.value)} className="mt-0.5" />
                  <span><b>{o.label}</b><span className="block text-gray-500 mt-0.5">{o.effect}</span></span>
                </label>
              ))}
            </div>
            <p className="text-[11px] text-gray-400 mt-1"><T k="치과·한방·보건기관·조산원 등 그 밖의 종별은 이 시스템의 종별 어휘가 표현하지 못해 고를 수 없습니다." /></p>
          </fieldset>

          <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-2">
            <label className="text-xs text-gray-600 flex flex-col gap-1">
              <T k="근거 문서(필수)" />
              <input value={legal} onChange={(e) => setLegal(e.target.value)} placeholder={tAttr('예: 개설 허가증 번호·요양기관 현황 신고 접수번호')}
                className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm" data-grade-legal />
            </label>
            <label className="text-xs text-gray-600 flex flex-col gap-1">
              <T k="기록하는 사람의 권한(필수)" />
              <input value={authority} onChange={(e) => setAuthority(e.target.value)} placeholder={tAttr('예: 원장 · 원무(보험)팀장')}
                className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm" data-grade-authority />
            </label>
          </div>
          <p className="text-[11px] text-gray-400 mt-1"><T k="시스템은 문서의 진위와 직책을 검증하지 못합니다 — 적은 그대로 결정 이력에 남습니다." /></p>

          <button type="button" onClick={() => void save()} disabled={!canSave}
            className="mt-3 px-4 py-2 rounded-xl text-sm font-medium bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40" data-grade-save>
            {busy ? <T k="기록 중…" /> : <T k="종별 결정 기록" />}
          </button>
          {result && <p className={`text-xs mt-2 ${result.ok ? 'text-emerald-700' : 'text-rose-600'}`} data-grade-result>{result.text}</p>}
        </>
      )}
    </div>
  );
}

/* ── ② 건강보험 외래 본인부담률(종별) ───────────────────────────── */
export function NhiOutpatientRatePanel({ configs, onSaved }: { configs: ConfigItem[]; onSaved: () => void }) {
  const tAttr = useTAttr();
  const single = configs.find((c) => c.key === 'billing.copay.nhi.outpatient')?.value;
  const stored = configs.find((c) => c.key === BY_GRADE_KEY)?.value as Partial<Record<Grade, number>> | null | undefined;
  const storedSet = stored != null && typeof stored === 'object';
  const [mode, setMode] = useState<'SINGLE' | 'BY_GRADE' | null>(null);
  const [rates, setRates] = useState<Record<Grade, string>>({ CLINIC: '', HOSPITAL: '', GENERAL: '', TERTIARY: '' });
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  const effectiveMode = mode ?? (storedSet ? 'BY_GRADE' : 'SINGLE');
  const valid = (v: string) => /^\d{1,3}$/.test(v.trim()) && Number(v) >= 0 && Number(v) <= 100;
  const allValid = GRADES.every((g) => valid(rates[g]));
  const canSave = !busy && mode != null && (mode === 'SINGLE' ? storedSet : allValid);

  const startByGrade = () => {
    setMode('BY_GRADE');
    // 저장된 율이 있으면 그것을 고친다 · 없으면 빈 칸으로 시작(율을 지어내지 않는다)
    setRates(storedSet ? Object.fromEntries(GRADES.map((g) => [g, stored![g] != null ? String(stored![g]) : ''])) as Record<Grade, string> : { CLINIC: '', HOSPITAL: '', GENERAL: '', TERTIARY: '' });
  };
  const save = async () => {
    setBusy(true); setResult(null);
    try {
      const value = mode === 'SINGLE' ? null : Object.fromEntries(GRADES.map((g) => [g, Number(rates[g])]));
      await apiClient.put(`/api/v1/config/${encodeURIComponent(BY_GRADE_KEY)}`, { value });
      setResult({ ok: true, text: tAttr('저장했습니다 — 새로 만드는 청구부터 적용됩니다.') });
      setMode(null);
      onSaved();
    } catch (e) {
      setResult({ ok: false, text: extractErrorMessage(e) });
    } finally { setBusy(false); }
  };

  return (
    <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5 mb-6" data-nhi-rate-panel>
      <h3 className="text-base font-bold text-gray-900"><T k="건강보험 외래 본인부담률" /></h3>
      <p className="text-xs text-gray-500 mt-0.5"><T k="종별 구분 없이 한 율을 쓰거나, 종별마다 다른 율을 쓸 수 있습니다. 시스템은 율을 제안하지 않습니다 — 법령(국민건강보험법 시행령)을 확인해 입력하세요." /></p>

      <p className="text-xs mt-2" data-nhi-rate-current>
        <span className="text-gray-500"><T k="지금" />: </span>
        {storedSet
          ? <b>{GRADES.map((g) => `${tAttr(GRADE_LABEL[g])} ${stored![g]}%`).join(' · ')}</b>
          : <b><T k="단일 율" /> {String(single ?? '-')}%</b>}
      </p>

      <div className="mt-3 flex flex-wrap gap-2 text-xs">
        <label className={`flex items-center gap-1 rounded-lg border px-3 py-1.5 cursor-pointer ${effectiveMode === 'SINGLE' && mode ? 'border-indigo-500 bg-indigo-50' : 'border-gray-200'}`}>
          <input type="radio" name="nhi-rate-mode" checked={mode === 'SINGLE'} onChange={() => setMode('SINGLE')} data-nhi-mode-single />
          <T k="단일 율(모든 종별 같음)" />
        </label>
        <label className={`flex items-center gap-1 rounded-lg border px-3 py-1.5 cursor-pointer ${mode === 'BY_GRADE' ? 'border-indigo-500 bg-indigo-50' : 'border-gray-200'}`}>
          <input type="radio" name="nhi-rate-mode" checked={mode === 'BY_GRADE'} onChange={startByGrade} data-nhi-mode-grade />
          <T k="종별 차등" />
        </label>
      </div>

      {mode === 'SINGLE' && (
        <p className="text-[11px] text-gray-500 mt-2"><T k="단일 율은 위 설정 목록의 「건강보험 외래 본인부담률」 값입니다. 종별 차등을 지우고 그 값으로 돌아갑니다." /></p>
      )}
      {mode === 'BY_GRADE' && (
        <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-2" data-nhi-rate-inputs>
          {GRADES.map((g) => (
            <label key={g} className="text-xs text-gray-600 flex flex-col gap-1">
              <T k={GRADE_LABEL[g]} />
              <span className="flex items-center gap-1">
                <input inputMode="numeric" value={rates[g]} onChange={(e) => setRates((r) => ({ ...r, [g]: e.target.value }))}
                  className={`w-20 border rounded-lg px-2 py-1 text-sm text-right ${rates[g] && !valid(rates[g]) ? 'border-rose-400' : 'border-gray-200'}`} data-nhi-rate={g} />
                %
              </span>
            </label>
          ))}
        </div>
      )}
      <ul className="mt-2 text-[11px] text-gray-500 list-disc pl-4 space-y-0.5">
        <li><T k="우리 기관 종별이 미설정이면 종별 차등 율이 있어도 단일 율을 씁니다(어느 종별인지 짐작하지 않습니다)." /></li>
        <li><T k="상급종합병원 진찰료 전액 본인부담·읍면 지역 구분 같은 세부 규칙은 이 설정이 표현하지 못합니다." /></li>
        <li><T k="자격조회가 없는 건강보험 외래 환자에게도 같은 율이 쓰입니다." /></li>
      </ul>

      <button type="button" onClick={() => void save()} disabled={!canSave}
        className="mt-3 px-4 py-2 rounded-xl text-sm font-medium bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40" data-nhi-rate-save>
        {busy ? <T k="저장 중…" /> : <T k="본인부담률 저장" />}
      </button>
      {result && <p className={`text-xs mt-2 ${result.ok ? 'text-emerald-700' : 'text-rose-600'}`} data-nhi-rate-result>{result.text}</p>}
    </div>
  );
}
