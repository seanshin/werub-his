'use client';

/**
 * 레지멘 → 처방 초안 생성 검토 모달 (CPOE 결선 P0 · regimen-cpoe-bridge.plan §3.2)
 * - 자동 확정 금지: 약물코드는 의사가 검색·선택, 생성은 DRAFT 처방(서명 게이트는 기존 흐름).
 * - 안전장치: 산출 용량 프리필·±20% 초과 수정 경고·제외 토글·기관 프로토콜 대조 서약(필수)·건별 DUR 경고 표시.
 */
import { useState, useMemo } from 'react';
import { Unit } from '@/components/ui/display';
import { T, useTAttr } from '@/components/ui/i18n-text';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import type { TreeDef, RegimenDoseLine } from '@/lib/clinical-charts';

type CodeResult = { id: string; code: string; nameKo?: string };
interface DurWarning { severity: string; message: string }

interface LineState {
  include: boolean;
  q: string;
  results: CodeResult[];
  medicationCodeId?: string;
  medicationLabel?: string;
  dose: string;           // mg — 산출값 프리필·수정 가능
  duration: string;       // 일수
}

interface SubmitResult { name: string; ok: boolean; durWarnings: DurWarning[]; error?: string }

interface PriorRegimenResult {
  id: string; chartName: string; performedByName: string; performedAt: string;
  recommendation?: string | null;
}

export function RegimenOrderModal({ def, lines, bsa, encounterId, patientId, onClose }: {
  def: TreeDef;
  lines: RegimenDoseLine[];
  bsa?: number;
  encounterId: string;
  patientId?: string;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const tAttr = useTAttr();
  const [states, setStates] = useState<LineState[]>(
    lines.map((l) => ({ include: true, q: l.drug.medicationCodeQuery ?? l.drug.name, results: [], dose: l.dose != null ? String(l.dose) : '', duration: '1' })),
  );

  // P2 — 이 환자의 동일 레지멘 이전 기록(누적용량·주기 추적 보조)
  const { data: priorData } = useQuery({
    queryKey: ['regimen-prior', patientId, def.chartId],
    queryFn: () => apiClient.get<{ data: PriorRegimenResult[] }>('/api/v1/clinical-chart-results', { patientId: patientId!, chartId: def.chartId }),
    enabled: !!patientId,
  });
  const priorCount = useMemo(() => {
    const raw = priorData?.data;
    const list = Array.isArray(raw) ? raw : (raw as { data?: PriorRegimenResult[] } | undefined)?.data ?? [];
    return list.length;
  }, [priorData]);
  const hasCumulativeLimit = lines.some((l) => l.drug.cumulativeLimit);
  const [confirmed, setConfirmed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [results, setResults] = useState<SubmitResult[] | null>(null);

  const upd = (i: number, patch: Partial<LineState>) => setStates((p) => p.map((s, j) => (j === i ? { ...s, ...patch } : s)));

  const search = async (i: number, q: string) => {
    upd(i, { q, medicationCodeId: undefined, medicationLabel: undefined });
    if (q.trim().length < 2) { upd(i, { results: [] }); return; }
    try {
      const res = await apiClient.get<{ data: CodeResult[] }>('/api/v1/code-search', { q: q.trim(), type: 'MEDICATION' });
      const raw = res.data;
      upd(i, { results: (Array.isArray(raw) ? raw : (raw as { data?: CodeResult[] })?.data ?? []).slice(0, 6) });
    } catch { upd(i, { results: [] }); }
  };

  const included = states.filter((s) => s.include);
  const readyAll = included.length > 0 && included.every((s) => s.medicationCodeId && Number(s.dose) > 0 && Number(s.duration) >= 1);
  const overLimit = (i: number) => {
    const computed = lines[i].dose;
    const d = Number(states[i].dose);
    return computed != null && d > 0 && Math.abs(d - computed) / computed > 0.2;
  };

  const submit = async () => {
    if (!readyAll || !confirmed || submitting) return;
    setSubmitting(true);
    const out: SubmitResult[] = [];
    for (let i = 0; i < lines.length; i++) {
      const s = states[i];
      if (!s.include) continue;
      const drug = lines[i].drug;
      try {
        const res = await apiClient.post<{ data: unknown; durWarnings?: DurWarning[] }>(`/api/v1/encounters/${encounterId}/prescriptions`, {
          type: 'MEDICATION',
          medicationCodeId: s.medicationCodeId,
          dosage: `${s.dose}mg (레지멘 ${def.chartId} · 기준 ${drug.doseValue}${drug.doseUnit}${bsa != null ? ` · BSA ${bsa.toFixed(2)}` : ''})`,
          frequency: `${drug.days.join(',')}${drug.infusion ? ` · ${drug.infusion}` : ''}`,
          duration: Number(s.duration),
          route: drug.route,
        });
        const raw = res as { durWarnings?: DurWarning[]; data?: { durWarnings?: DurWarning[] } };
        const warns = raw.durWarnings ?? raw.data?.durWarnings ?? [];
        out.push({ name: `${drug.name} → ${s.medicationLabel}`, ok: true, durWarnings: warns });
      } catch (e) {
        out.push({ name: drug.name, ok: false, durWarnings: [], error: e instanceof Error ? e.message : tAttr('생성 실패') });
      }
    }
    setResults(out);
    setSubmitting(false);
    qc.invalidateQueries({ queryKey: ['encounter', encounterId] });
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[88vh] overflow-hidden flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div>
            <h3 className="font-bold text-gray-900"><T k="처방 초안 생성" /> — {def.name}</h3>
            <p className="text-[11px] text-gray-400"><T k="DRAFT로 생성됩니다 · 서명 전 처방 목록에서 재확인 필수 · 자동 확정 없음" /></p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg">✕</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {results ? (
            /* 결과 요약 */
            <div className="space-y-2">
              {results.map((r, i) => (
                <div key={i} className={`rounded-xl border p-3 ${r.ok ? 'border-emerald-200 bg-emerald-50' : 'border-red-200 bg-red-50'}`}>
                  <p className="text-sm font-medium text-gray-900">{r.ok ? '✓' : '✕'} {r.name}{!r.ok && r.error ? ` — ${r.error}` : ''}</p>
                  {r.durWarnings.map((w, j) => (
                    <p key={j} className="text-[11px] text-orange-700 mt-0.5">⚠️ DUR[{w.severity}] {w.message}</p>
                  ))}
                </div>
              ))}
              <p className="text-[11px] text-gray-400"><T k="생성된 초안은 처방 목록에서 확인·수정 후 서명하세요." /></p>
            </div>
          ) : (
            <>
              {(priorCount > 0 || hasCumulativeLimit) && (
                <div className="rounded-xl bg-blue-50 border border-blue-100 p-3 text-[11px] text-blue-800 space-y-0.5">
                  {priorCount > 0 && <p>ℹ️ <T k="이 환자의" /> <b>{def.name}</b> <T k="이전 기록" /> <b>{priorCount}<Unit>{tAttr('건')}</Unit></b><T k="이 있습니다(임상도구 결과 탭에서 주기·누적 확인)." /></p>}
                  {/* 🔴 누적용량 경고는 오역이 곧 과용량이라 카탈로그에 등재하지 않았다(원문+미번역 티) */}
                  {hasCumulativeLimit && <p><T k="⚠️ 누적용량 한계 약물 포함 — 이전 주기 누적을 반드시 확인하세요(자동 합산 미적용)." /></p>}
                </div>
              )}
              {lines.map((l, i) => {
                const s = states[i];
                return (
                  <div key={i} className={`rounded-xl border p-3 space-y-2 ${s.include ? 'border-gray-200' : 'border-gray-100 opacity-50'}`}>
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-bold text-gray-900">{l.drug.sequence}. {l.drug.name}
                        <span className="ml-2 text-[11px] font-normal text-gray-400">{l.drug.doseValue}{l.drug.doseUnit} · {l.drug.route} · {l.drug.days.join(',')}{l.drug.infusion ? ` · ${l.drug.infusion}` : ''}</span>
                      </p>
                      <label className="flex items-center gap-1.5 text-xs text-gray-500 shrink-0">
                        <input type="checkbox" checked={s.include} onChange={(e) => upd(i, { include: e.target.checked })} className="rounded" /> <T k="포함" />
                      </label>
                    </div>
                    {s.include && (
                      <>
                        <div className="relative">
                          <input value={s.q} onChange={(e) => search(i, e.target.value)}
                            placeholder={tAttr('약물코드 검색(필수 — 자동 매핑 없음)')}
                            className={`w-full px-3 py-2 border rounded-lg text-sm focus:outline-none ${s.medicationCodeId ? 'border-emerald-300 bg-emerald-50/50' : 'border-gray-200 focus:border-blue-400'}`} />
                          {!s.medicationCodeId && s.results.length > 0 && (
                            <div className="absolute z-20 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg max-h-40 overflow-y-auto">
                              {s.results.map((r) => (
                                <button key={r.id} onClick={() => upd(i, { medicationCodeId: r.id, medicationLabel: r.nameKo ?? r.code, q: r.nameKo ?? r.code, results: [] })}
                                  className="w-full text-left px-3 py-1.5 text-xs hover:bg-blue-50">
                                  {r.nameKo ?? '-'} <span className="text-gray-400">({r.code})</span>
                                </button>
                              ))}
                            </div>
                          )}
                          {s.medicationCodeId && <span className="absolute right-2 top-2 text-[11px] text-emerald-600 font-medium"><T k="선택됨" /></span>}
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="text-[11px] text-gray-500 block mb-0.5"><T k="용량 (mg) — 산출" /> {l.dose ?? '-'}mg{l.capped ? ' (cap)' : ''}</label>
                            <input type="number" value={s.dose} onChange={(e) => upd(i, { dose: e.target.value })}
                              className={`w-full px-3 py-1.5 border rounded-lg text-sm ${overLimit(i) ? 'border-orange-400 bg-orange-50' : 'border-gray-200'}`} />
                            {/* 🔴 용량 초과 경고 — 미등재(원문+티). 오역이 곧 과용량 승인이 되는 자리다 */}
                            {overLimit(i) && <p className="text-[10px] text-orange-600 mt-0.5"><T k="⚠️ 산출값 대비 ±20% 초과 — 근거를 재확인하세요." /></p>}
                          </div>
                          <div>
                            <label className="text-[11px] text-gray-500 block mb-0.5"><T k="일수" /></label>
                            <input type="number" min={1} value={s.duration} onChange={(e) => upd(i, { duration: e.target.value })}
                              className="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-sm" />
                          </div>
                        </div>
                        {l.drug.cumulativeLimit && <p className="text-[10px] text-orange-600"><T k="누적한계" /> {l.drug.cumulativeLimit} <T k="— 누적용량 확인 필수." /></p>}
                      </>
                    )}
                  </div>
                );
              })}

              <div className="rounded-xl bg-gray-50 border border-gray-100 p-3 text-[11px] text-gray-600">
                <p className="font-semibold text-gray-500 mb-1"><T k="전처치(참고 — 별도 처방 필요)" /></p>
                {def.regimen.premedication.join(' · ')}
              </div>

              <label className="flex items-start gap-2 text-xs text-gray-700 rounded-xl border border-amber-200 bg-amber-50 p-3">
                <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className="rounded mt-0.5" />
                {/* 🔴 프로토콜 대조 서약 — 미등재(원문+티). 사람이 무엇에 서약하는지가 법적·임상적 정본이다 */}
                <span><T k="기관 항암 프로토콜·허가사항 원문과 대조했으며, 골수억제/장기기능에 따른 감량·연기 규칙을 확인했습니다. (필수)" /></span>
              </label>
            </>
          )}
        </div>

        <div className="px-5 py-3 border-t border-gray-100 flex items-center justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 rounded-lg bg-gray-100 text-sm text-gray-700 hover:bg-gray-200"><T k={results ? '닫기' : '취소'} /></button>
          {!results && (
            <button onClick={submit} disabled={!readyAll || !confirmed || submitting}
              className="px-5 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-40">
              {submitting ? <T k="생성 중…" /> : <><T k="처방 초안" /> {included.length}<T k="건 생성" /></>}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
