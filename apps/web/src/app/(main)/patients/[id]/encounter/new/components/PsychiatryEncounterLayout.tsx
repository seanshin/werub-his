'use client';

import type { ReactNode } from 'react';

import { useState, useMemo } from 'react';
import { useMutation } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';
import ScoreTrendChart, { type ScoreSeries } from '@/components/specialty/ScoreTrendChart';
import { kstToday } from '@/lib/kst-today';
import { T, useTAttr } from '@/components/ui/i18n-text';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface PsychiatryEncounterLayoutProps {
  /** 처방 열(페이지가 넘긴다) — 서명 바 위에 그린다. 종전엔 진료과 레이아웃에 처방 입력이 없었다 */
  rxSlot?: ReactNode;
  patientId: string;
  encounterId: string | null;
  onStartEncounter: () => void;
  patient: { familyName?: string; givenName?: string; mrn?: string };
  onSaveDraft: (data?: { subjective?: string; objective?: string; assessment?: string; plan?: string }) => void;
  onSignAndBill: (data?: { subjective?: string; objective?: string; assessment?: string; plan?: string }) => void;
  isSaving: boolean;
  isSigning: boolean;
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const MSE_DOMAINS: { key: string; label: string; options: string[] }[] = [
  { key: 'appearance', label: '외모', options: ['정상', '단정하지 않음', '기이한', '연령에 적절'] },
  { key: 'behavior', label: '행동', options: ['협조적', '초조', '둔화', '적대적', '경계'] },
  { key: 'speech', label: '언어', options: ['정상', '빠름', '느림', '단조로움', '과다'] },
  { key: 'mood', label: '기분', options: ['유쾌', '우울', '불안', '과민', '무감동'] },
  { key: 'affect', label: '정동', options: ['적절', '둔마', '평탄', '불안정', '제한적'] },
  { key: 'thought_process', label: '사고과정', options: ['논리적', '우회적', '이완', '비행', '차단'] },
  { key: 'thought_content', label: '사고내용', options: ['정상', '망상', '강박', '자살사고', '타해사고'] },
  { key: 'perception', label: '지각', options: ['정상', '환청', '환시', '착각', '이인증'] },
  { key: 'cognition', label: '인지', options: ['정상', '지남력장애', '기억력저하', '집중력저하'] },
  { key: 'insight', label: '병식', options: ['양호', '부분적', '불량', '없음'] },
  { key: 'judgment', label: '판단력', options: ['양호', '부분적', '불량'] },
];

const PHQ9_QUESTIONS = [
  '일 또는 여가 활동에 대한 흥미나 즐거움이 거의 없음',
  '기분이 가라앉거나, 우울하거나, 희망이 없다고 느낌',
  '잠들기 어려움, 자주 깸, 또는 너무 많이 잠',
  '피곤하거나 기운이 거의 없음',
  '식욕 감소 또는 과식',
  '자신에 대한 부정적 느낌 — 또는 실패감',
  '집중의 어려움',
  '움직임이나 말이 느려짐, 또는 안절부절못함',
  '자해 또는 자살에 대한 생각',
];

const GAD7_QUESTIONS = [
  '초조하거나 불안하거나 조마조마하게 느낌',
  '걱정을 멈추거나 조절할 수 없음',
  '여러 가지 것들에 대해 지나치게 걱정',
  '편하게 있기 어려움',
  '너무 안절부절못하여 가만히 있기 어려움',
  '쉽게 짜증이 나거나 쉽게 성을 냄',
  '무서운 일이 일어날 것 같은 느낌',
];

const SCORE_OPTIONS = ['0', '1', '2', '3'];
const SCORE_LABELS = ['전혀 아님', '며칠', '절반 이상', '거의 매일'];

function phq9Severity(score: number): { label: string; color: string } {
  if (score <= 4) return { label: '정상', color: 'text-green-600' };
  if (score <= 9) return { label: '경미', color: 'text-yellow-600' };
  if (score <= 14) return { label: '중등도', color: 'text-orange-600' };
  if (score <= 19) return { label: '중등도-심함', color: 'text-red-500' };
  return { label: '심함', color: 'text-red-700' };
}

function gad7Severity(score: number): { label: string; color: string } {
  if (score <= 4) return { label: '정상', color: 'text-green-600' };
  if (score <= 9) return { label: '경미', color: 'text-yellow-600' };
  if (score <= 14) return { label: '중등도', color: 'text-orange-600' };
  return { label: '심함', color: 'text-red-700' };
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function PsychiatryEncounterLayout({
  patientId,
  encounterId,
  onStartEncounter: _onStartEncounter,
  patient: _patient,
  onSaveDraft,
  onSignAndBill,
  isSaving,
  isSigning,
  rxSlot,
}: PsychiatryEncounterLayoutProps) {
  const tAttr = useTAttr();
  const [mse, setMse] = useState<Record<string, string>>(
    Object.fromEntries(MSE_DOMAINS.map((d) => [d.key, d.options[0]])),
  );

  const [phq9, setPhq9] = useState<number[]>(Array(9).fill(0));
  const [gad7, setGad7] = useState<number[]>(Array(7).fill(0));
  const [mmse, setMmse] = useState('');
  const [audit, setAudit] = useState('');
  const [cssrs, setCssrs] = useState('');

  const [suicideRisk, setSuicideRisk] = useState(false);
  const [safetyPlan, setSafetyPlan] = useState(false);
  const [findings, setFindings] = useState('');

  const phq9Total = useMemo(() => phq9.reduce((a, b) => a + b, 0), [phq9]);
  const gad7Total = useMemo(() => gad7.reduce((a, b) => a + b, 0), [gad7]);
  const phq9Sev = phq9Severity(phq9Total);
  const gad7Sev = gad7Severity(gad7Total);

  // Chart data for current session
  const today = kstToday();
  const chartSeries: ScoreSeries[] = useMemo(() => [
    { name: 'PHQ-9', data: [{ date: today, value: phq9Total }], color: '#3B82F6', maxScore: 27 },
    { name: 'GAD-7', data: [{ date: today, value: gad7Total }], color: '#8B5CF6', maxScore: 21 },
  ], [phq9Total, gad7Total, today]);

  const saveMutation = useMutation({
    mutationFn: () =>
      apiClient.post('/api/v1/psychiatry/exams', {
        patientId,
        encounterId,
        // MSE는 개별 DTO 필드로 매핑(과거 `mse` 통짜 전송은 whitelist에서 strip돼 유실됨)
        appearance: mse.appearance,
        behavior: mse.behavior,
        speech: mse.speech,
        mood: mse.mood,
        affect: mse.affect,
        thoughtProcess: mse.thought_process,
        thoughtContent: mse.thought_content,
        perception: mse.perception,
        cognition: mse.cognition,
        insight: mse.insight,
        // 척도 총점은 숫자(과거 {answers,total} 객체는 @IsInt에서 400 유발)
        phq9: phq9Total,
        // PHQ-9 문항9(자살 사고) 개별값 — 양성(≥1)이면 서버가 자살위험 에스컬레이션을 강제(수동 체크 누락 방어)
        phq9Item9: phq9[8],
        gad7: gad7Total,
        mmse: mmse ? parseInt(mmse) : undefined,
        audit: audit ? parseInt(audit) : undefined,
        // cssrs·safetyPlan은 JsonB(구조화)
        cssrs: cssrs ? { note: cssrs } : undefined,
        suicideRisk: suicideRisk ? 'HIGH' : 'LOW',
        safetyPlan: { hasPlan: safetyPlan },
        diagnosis: findings || undefined,
      }),
    onSuccess: () => toast.success('정신건강의학과 검사가 저장되었습니다.'),
    onError: () => toast.error('저장에 실패했습니다.'),
  });

  const inputCls = 'w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-50';
  const labelCls = 'block text-[11px] font-medium text-gray-500 mb-1';

  const buildSoap = (): { subjective?: string; objective?: string; assessment?: string; plan?: string } => ({
    objective: findings || undefined,
  });

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Left: MSE + Scores */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 space-y-4">
          <h3 className="font-semibold text-gray-900 flex items-center gap-2">
            <svg className="w-5 h-5 text-gray-400" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 18v-5.25m0 0a6.01 6.01 0 001.5-.189m-1.5.189a6.01 6.01 0 01-1.5-.189m3.75 7.478a12.06 12.06 0 01-4.5 0m3.75 2.383a14.406 14.406 0 01-3 0" />
            </svg>
            <T k="정신상태검사 (MSE)" />
          </h3>

          <div className="grid grid-cols-2 gap-2">
            {MSE_DOMAINS.map((domain) => (
              <div key={domain.key}>
                <label className={labelCls}>{domain.label}</label>
                <select
                  value={mse[domain.key]}
                  onChange={(e) => setMse((prev) => ({ ...prev, [domain.key]: e.target.value }))}
                  disabled={!encounterId}
                  className={inputCls}
                >
                  {domain.options.map((o) => (
                    <option key={o} value={o}>{o}</option>
                  ))}
                </select>
              </div>
            ))}
          </div>

          {/* Additional scores */}
          <div className="pt-2 border-t border-gray-100">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2"><T k="추가 평가 도구" /></p>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className={labelCls}>MMSE (0-30)</label>
                <input type="number" min="0" max="30" value={mmse} onChange={(e) => setMmse(e.target.value)} disabled={!encounterId} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>AUDIT (0-40)</label>
                <input type="number" min="0" max="40" value={audit} onChange={(e) => setAudit(e.target.value)} disabled={!encounterId} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>C-SSRS</label>
                <input type="text" value={cssrs} onChange={(e) => setCssrs(e.target.value)} disabled={!encounterId} className={inputCls} placeholder={tAttr("결과...")} />
              </div>
            </div>
          </div>

          {/* Suicide Risk */}
          <div className="pt-2 border-t border-gray-100">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={suicideRisk}
                  onChange={(e) => setSuicideRisk(e.target.checked)}
                  disabled={!encounterId}
                  className="w-4 h-4 rounded border-red-300 text-red-600 focus:ring-red-500"
                />
                <span className="text-xs font-medium text-red-700">자살 위험 평가 해당</span>
              </div>
              {suicideRisk && (
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={safetyPlan}
                    onChange={(e) => setSafetyPlan(e.target.checked)}
                    disabled={!encounterId}
                    className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span className="text-xs font-medium text-gray-700">안전 계획 수립 완료</span>
                </div>
              )}
            </div>
          </div>

          {/* Score Trend Chart */}
          <div className="pt-2 border-t border-gray-100">
            <ScoreTrendChart series={chartSeries} />
          </div>
        </div>

        {/* Right: PHQ-9 + GAD-7 */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 space-y-4 max-h-[800px] overflow-y-auto">
          {/* PHQ-9 */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-semibold text-gray-900 text-sm"><T k="PHQ-9 (우울)" /></h3>
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold text-gray-700">{phq9Total}/27</span>
                <span className={`text-xs font-medium px-2 py-0.5 rounded-full bg-gray-100 ${phq9Sev.color} whitespace-nowrap`}>
                  {phq9Sev.label}
                </span>
              </div>
            </div>

            <div className="text-[10px] text-gray-400 flex gap-4 mb-2">
              {SCORE_LABELS.map((l, i) => (
                <span key={i}>{i}={l}</span>
              ))}
            </div>

            <div className="space-y-1.5">
              {PHQ9_QUESTIONS.map((q, i) => (
                <div key={i} className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2">
                  <span className="text-xs text-gray-700 flex-1 mr-2">{i + 1}. {q}</span>
                  <div className="flex gap-1">
                    {SCORE_OPTIONS.map((s) => (
                      <button
                        key={s}
                        onClick={() => setPhq9((prev) => prev.map((v, j) => (j === i ? parseInt(s) : v)))}
                        disabled={!encounterId}
                        className={`w-7 h-7 rounded-lg text-xs font-medium transition-colors disabled:opacity-50 ${
                          phq9[i] === parseInt(s)
                            ? 'bg-blue-600 text-white'
                            : 'bg-white border border-gray-200 text-gray-500 hover:bg-blue-50'
                        }`}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* GAD-7 */}
          <div className="pt-4 border-t border-gray-100">
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-semibold text-gray-900 text-sm"><T k="GAD-7 (불안)" /></h3>
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold text-gray-700">{gad7Total}/21</span>
                <span className={`text-xs font-medium px-2 py-0.5 rounded-full bg-gray-100 ${gad7Sev.color} whitespace-nowrap`}>
                  {gad7Sev.label}
                </span>
              </div>
            </div>

            <div className="space-y-1.5">
              {GAD7_QUESTIONS.map((q, i) => (
                <div key={i} className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2">
                  <span className="text-xs text-gray-700 flex-1 mr-2">{i + 1}. {q}</span>
                  <div className="flex gap-1">
                    {SCORE_OPTIONS.map((s) => (
                      <button
                        key={s}
                        onClick={() => setGad7((prev) => prev.map((v, j) => (j === i ? parseInt(s) : v)))}
                        disabled={!encounterId}
                        className={`w-7 h-7 rounded-lg text-xs font-medium transition-colors disabled:opacity-50 ${
                          gad7[i] === parseInt(s)
                            ? 'bg-purple-600 text-white'
                            : 'bg-white border border-gray-200 text-gray-500 hover:bg-purple-50'
                        }`}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Findings */}
          <div className="pt-4 border-t border-gray-100">
            <label className={labelCls}><T k="소견" /></label>
            <textarea
              rows={3}
              value={findings}
              onChange={(e) => setFindings(e.target.value)}
              placeholder={tAttr("진료 소견을 입력하세요...")}
              disabled={!encounterId}
              className="w-full px-3 py-3 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none disabled:bg-gray-50 placeholder:text-gray-300"
            />
          </div>

          <button
            onClick={() => saveMutation.mutate()}
            disabled={!encounterId || saveMutation.isPending}
            className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-purple-600 text-white text-sm font-medium rounded-xl hover:bg-purple-700 transition-colors disabled:opacity-40"
          >
            {saveMutation.isPending ? '저장중...' : '검사 기록 저장'}
          </button>
        </div>
      </div>

      {rxSlot}

      {/* Bottom Action Bar */}
      <div className="sticky bottom-0 z-20 bg-white/95 backdrop-blur rounded-2xl shadow-[0_-6px_16px_-8px_rgba(15,23,42,0.15)] border border-gray-100 px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />
            </svg>
            PHQ-9: {phq9Total} ({phq9Sev.label}) | GAD-7: {gad7Total} ({gad7Sev.label})
            {suicideRisk && ' | 자살위험'}
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => onSaveDraft(buildSoap())}
              disabled={!encounterId || isSaving}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-gray-100 text-gray-700 text-sm font-medium rounded-xl hover:bg-gray-200 transition-colors disabled:opacity-40"
            >
              <T k="저장 (임시)" />
            </button>
            <button
              onClick={() => onSignAndBill(buildSoap())}
              disabled={!encounterId || isSigning}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-purple-600 text-white text-sm font-medium rounded-xl hover:bg-purple-700 transition-colors disabled:opacity-40"
            >
              {isSigning ? '처리중...' : '서명 완료'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
