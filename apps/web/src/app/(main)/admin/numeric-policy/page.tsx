'use client';

import { useState, useEffect, useCallback } from 'react';
import { apiClient } from '@/lib/api-client';
import { NUMERIC_POLICIES, formatNum, type NumericPolicy } from '@hospital-run/shared';
import { T, useTAttr } from '@/components/ui/i18n-text';

/**
 * 수치 표시·반올림 정책 관리 (numeric-format-policy.plan.md §3.4).
 * 비잠금 도메인의 표시 자릿수를 config `ui.precision.*` 로 조정 → 전 화면 formatNum 반영.
 * 잠금(법정·안전) 도메인은 읽기전용 — 변경은 위원회 의결로만(서버측 거부).
 */

const GROUPS: { key: string; label: string; domains: string[] }[] = [
  { key: 'vital', label: '활력·생체', domains: ['temperature', 'heartRate', 'systolicBp', 'diastolicBp', 'spo2', 'respiratoryRate', 'weight', 'height', 'bmi', 'bsa'] },
  { key: 'lab', label: '검사', domains: ['labValue', 'percent'] },
  { key: 'money', label: '금액·청구', domains: ['money', 'copay'] },
  { key: 'derived', label: '계산 파생', domains: ['stayDays', 'age'] },
];

const MODE_LABEL: Record<string, string> = { round: '반올림', floor: '버림', ceil: '올림', bankers: '은행가반올림' };

// 미리보기 샘플값 — 부동소수점·절사 효과가 드러나는 값
const SAMPLE: Record<string, number> = {
  temperature: 38.199999999999996, heartRate: 96.4, systolicBp: 132, diastolicBp: 84, spo2: 95.6,
  respiratoryRate: 22, weight: 78.25, height: 170.4, bmi: 24.567, bsa: 1.8934,
  labValue: 1250.7, percent: 33.333, money: 12347, copay: 12347, stayDays: 2.6, age: 49.7,
};

export default function NumericPolicyPage() {
  const tAttr = useTAttr();
  const [group, setGroup] = useState('vital');
  const [overrides, setOverrides] = useState<Record<string, number>>({});
  const [edit, setEdit] = useState<Record<string, number>>({});
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [saved, setSaved] = useState<Record<string, boolean>>({});
  const [err, setErr] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    const res = await apiClient.get<{ data: { key: string; value: unknown }[] }>('/api/v1/config?category=ui');
    const rows = Array.isArray(res.data) ? res.data : ((res.data as unknown as { data?: { key: string; value: unknown }[] })?.data ?? []);
    const ov: Record<string, number> = {};
    for (const r of rows) {
      const m = /^ui\.precision\.(.+)$/.exec(r.key);
      if (m) { const n = Number(r.value); if (Number.isInteger(n)) ov[m[1]] = n; }
    }
    setOverrides(ov);
    setEdit(ov);
  }, []);
  useEffect(() => { load(); }, [load]);

  const currentDecimals = (p: NumericPolicy): number | undefined =>
    edit[p.key] ?? overrides[p.key] ?? p.decimals;

  const save = async (key: string) => {
    setSaving(s => ({ ...s, [key]: true }));
    setErr(e => ({ ...e, [key]: '' }));
    try {
      await apiClient.put(`/api/v1/config/ui.precision.${key}`, { value: edit[key] });
      setOverrides(o => ({ ...o, [key]: edit[key] }));
      setSaved(s => ({ ...s, [key]: true }));
      setTimeout(() => setSaved(s => ({ ...s, [key]: false })), 2000);
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message;
      setErr(er => ({ ...er, [key]: msg ?? tAttr('저장 실패') }));
    }
    setSaving(s => ({ ...s, [key]: false }));
  };

  const domains = GROUPS.find(g => g.key === group)!.domains.map(d => NUMERIC_POLICIES[d]).filter(Boolean);

  return (
    <div className="max-w-[1100px] mx-auto">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-900"><T k="수치 표시·반올림 정책" /></h2>
          <p className="text-sm text-gray-500 mt-1"><T k="여기서 바꾼 규칙은 전 화면·저장의 수치 표시에 즉시 반영됩니다. 법정·안전 정책은 위원회 의결로만 변경됩니다." /></p>
        </div>
        <span className="shrink-0 text-[11px] font-semibold px-2.5 py-1 rounded-full bg-teal-50 text-teal-700"><T k="표준 정합 · FHIR/UCUM·CLSI" /></span>
      </div>

      <div className="flex gap-1 mb-5 bg-gray-100/80 p-1 rounded-xl w-fit flex-wrap">
        {GROUPS.map(g => (
          <button key={g.key} onClick={() => setGroup(g.key)}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition-all ${group === g.key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
            <T k={g.label} />
          </button>
        ))}
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50 text-left">
                <th className="px-4 py-2.5 text-xs font-medium text-gray-500"><T k="도메인" /></th>
                <th className="px-4 py-2.5 text-xs font-medium text-gray-500"><T k="자릿수" /></th>
                <th className="px-4 py-2.5 text-xs font-medium text-gray-500"><T k="반올림" /></th>
                <th className="px-4 py-2.5 text-xs font-medium text-gray-500"><T k="단위 · UCUM" /></th>
                <th className="px-4 py-2.5 text-xs font-medium text-gray-500"><T k="표준" /></th>
                <th className="px-4 py-2.5 text-xs font-medium text-gray-500"><T k="미리보기" /></th>
                <th className="px-4 py-2.5 text-xs font-medium text-gray-500"></th>
              </tr>
            </thead>
            <tbody>
              {domains.map(p => {
                const dec = currentDecimals(p);
                const preview = formatNum(SAMPLE[p.key], p.key, { override: dec != null ? { decimals: dec } : undefined });
                const dirty = edit[p.key] !== overrides[p.key] && edit[p.key] !== undefined;
                const isSig = p.sigFigs != null;
                return (
                  <tr key={p.key} className="border-b border-gray-50 hover:bg-blue-50/20">
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-900">{p.label}</div>
                      {p.note && <div className="text-[11px] text-gray-400 mt-0.5">{p.note}</div>}
                    </td>
                    <td className="px-4 py-3">
                      {p.locked || isSig ? (
                        <span className="font-mono text-xs text-gray-500">{isSig ? <><T k="유효" /> {p.sigFigs}</> : `${p.decimals}`} <span className="text-amber-500">🔒</span></span>
                      ) : (
                        <select value={edit[p.key] ?? p.decimals ?? 0} onChange={e => setEdit(s => ({ ...s, [p.key]: Number(e.target.value) }))}
                          className="border border-gray-200 rounded-lg px-2 py-1 text-xs font-mono bg-white">
                          {[0, 1, 2, 3, 4].map(n => <option key={n} value={n}>{n}</option>)}
                        </select>
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-gray-600"><T k={MODE_LABEL[p.mode]} />{p.step ? ` ·${p.step}` : ''}</td>
                    <td className="px-4 py-3 font-mono text-xs text-gray-600">{p.displayUnit ?? '—'}{p.ucumUnit ? ` · ${p.ucumUnit}` : ''}</td>
                    <td className="px-4 py-3">
                      {p.standard && <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${p.locked ? 'bg-amber-50 text-amber-700' : 'bg-teal-50 text-teal-700'}`}>{p.locked ? '🔒 ' : ''}{p.standard}</span>}
                      {p.loincCode && <span className="ml-1 text-[10px] font-mono text-gray-400">{p.loincCode}</span>}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-gray-900">{preview}</td>
                    <td className="px-4 py-3 text-right">
                      {p.locked ? (
                        <span className="text-[11px] text-gray-400"><T k="위원회 의결" /></span>
                      ) : dirty ? (
                        <button onClick={() => save(p.key)} disabled={saving[p.key]}
                          className="text-xs font-medium px-3 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50">
                          {saving[p.key] ? <T k="저장 중…" /> : <T k="저장" />}
                        </button>
                      ) : saved[p.key] ? (
                        <span className="text-xs text-emerald-600 font-medium"><T k="✓ 저장됨" /></span>
                      ) : null}
                      {err[p.key] && <div className="text-[10px] text-red-600 mt-1">{err[p.key]}</div>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-[11px] text-gray-400 mt-3">
        <T k="🔒 = 법정·안전 정책(청구·검사·용량·재원일·만나이) — 관리 화면 변경 불가. 변경은 거버넌스 위원회 안건→의결→집행+서명 봉인으로만." />{' '}
        <T k="미리보기는 샘플값 기준이며 저장 시 전 화면에 적용됩니다." />
      </p>
    </div>
  );
}
