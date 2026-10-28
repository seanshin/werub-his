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

interface UrologyEncounterLayoutProps {
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

const IPSS_QUESTIONS = [
  '최근 한 달간 소변을 다 보지 못한 느낌이 얼마나 자주 있었습니까?',
  '최근 한 달간 소변을 본 후 2시간 이내에 다시 소변을 본 적이 얼마나 있었습니까?',
  '최근 한 달간 소변을 보는 도중 소변줄기가 끊어진 적이 얼마나 있었습니까?',
  '최근 한 달간 소변을 참기 어려웠던 적이 얼마나 있었습니까?',
  '최근 한 달간 소변줄기가 약해진 적이 얼마나 있었습니까?',
  '최근 한 달간 소변을 보기 위해 힘을 주어야 했던 적이 얼마나 있었습니까?',
  '최근 한 달간 잠자는 동안 소변을 보기 위해 몇 번이나 일어났습니까?',
];

const IPSS_OPTIONS = [
  { value: 0, label: '전혀 없음' },
  { value: 1, label: '5회 중 1회' },
  { value: 2, label: '5회 중 2회' },
  { value: 3, label: '약 절반' },
  { value: 4, label: '5회 중 4회' },
  { value: 5, label: '거의 항상' },
];

const QOL_OPTIONS = [
  { value: 0, label: '매우 좋음' },
  { value: 1, label: '좋음' },
  { value: 2, label: '대체로 만족' },
  { value: 3, label: '반반' },
  { value: 4, label: '대체로 불만' },
  { value: 5, label: '나쁨' },
  { value: 6, label: '매우 나쁨' },
];

function ipssSeverity(score: number): { label: string; color: string } {
  if (score <= 7) return { label: '경미', color: 'text-green-600' };
  if (score <= 19) return { label: '중등도', color: 'text-yellow-600' };
  return { label: '심함', color: 'text-red-600' };
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function UrologyEncounterLayout({
  patientId,
  encounterId,
  onStartEncounter: _onStartEncounter,
  patient: _patient,
  onSaveDraft,
  onSignAndBill,
  isSaving,
  isSigning,
  rxSlot,
}: UrologyEncounterLayoutProps) {
  const tAttr = useTAttr();
  // 🔴 (2026-10-07) 7문항·QoL 이 0 으로 시작하고 늘 전송돼 **IPSS 를 묻지 않은 진료도 IPSS 0/QoL 0(경증)으로 저장**됐다.
  //    미응답(null)으로 시작 · 7문항 모두 답해야 총점 · 답하지 않으면 보내지 않는다(측정 안 함 ≠ 0점)
  const [ipss, setIpss] = useState<(number | null)[]>(Array(7).fill(null));
  const [qol, setQol] = useState<number | null>(null);
  const [psa, setPsa] = useState('');
  const [prostateVolume, setProstateVolume] = useState('');

  // Urodynamics
  const [maxFlow, setMaxFlow] = useState('');
  const [avgFlow, setAvgFlow] = useState('');
  const [voidedVolume, setVoidedVolume] = useState('');
  const [residualVolume, setResidualVolume] = useState('');

  const [findings, setFindings] = useState('');

  const ipssAnswered = ipss.filter((v) => v != null).length;
  const ipssComplete = ipssAnswered === 7;
  const ipssTotal = useMemo(() => (ipss.every((v) => v != null) ? (ipss as number[]).reduce((a, b) => a + b, 0) : null), [ipss]);
  const ipssSev = ipssTotal != null ? ipssSeverity(ipssTotal) : { label: `미완료 ${ipssAnswered}/7`, color: 'text-gray-500' };

  const today = kstToday();
  const chartSeries: ScoreSeries[] = useMemo(() => {
    const series: ScoreSeries[] = ipssTotal != null ? [
      { name: 'IPSS', data: [{ date: today, value: ipssTotal }], color: '#3B82F6', maxScore: 35 },
    ] : [];
    const psaVal = parseFloat(psa);
    if (psaVal) {
      series.push({
        name: 'PSA',
        data: [{ date: today, value: psaVal }],
        color: '#EF4444',
        maxScore: Math.max(10, psaVal * 1.5),
        referenceValue: 4.0,
        referenceLabel: 'PSA 4.0',
      });
    }
    return series;
  }, [ipssTotal, psa, today]);

  const saveMutation = useMutation({
    mutationFn: () =>
      // 🔴 키 이름이 서버 DTO 와 달라 IPSS 총점·QoL·PSA·최대/평균 요속이 전역 ValidationPipe
      //    (whitelist:true)에서 **조용히 버려지고** 있었다. 화면은 "저장되었습니다"라고 말했다.
      //    정본은 DB 컬럼명(ipssScore·ipssQol·psaValue·urodynamics.maxFlowRate/avgFlowRate).
      //    소견(findings)은 SOAP objective 로 저장된다(buildSoap) — 여기서는 보내지 않는다.
      //    IPSS 문항별 답(ipss.answers)은 저장할 컬럼이 없어 보내지 않는다(합계·QoL 만 보관).
      apiClient.post('/api/v1/urology/exams', {
        patientId,
        encounterId,
        ...(ipssComplete && ipssTotal != null ? { ipssScore: ipssTotal } : {}),
        ...(qol != null ? { ipssQol: qol } : {}),
        psaValue: psa ? parseFloat(psa) : undefined,
        prostateVolume: prostateVolume ? parseFloat(prostateVolume) : undefined,
        urodynamics: {
          maxFlowRate: maxFlow ? parseFloat(maxFlow) : undefined,
          avgFlowRate: avgFlow ? parseFloat(avgFlow) : undefined,
          voidedVolume: voidedVolume ? parseFloat(voidedVolume) : undefined,
          residualVolume: residualVolume ? parseFloat(residualVolume) : undefined,
        },
      }),
    onSuccess: () => toast.success('비뇨의학과 검사가 저장되었습니다.'),
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
        {/* Left: IPSS Questionnaire */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 space-y-4 max-h-[800px] overflow-y-auto">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-gray-900 flex items-center gap-2">
              <svg className="w-5 h-5 text-gray-400" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08" />
              </svg>
              <T k="IPSS (국제전립선증상점수)" />
            </h3>
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold text-gray-700" data-ipss-total={ipssTotal ?? 'incomplete'}>{ipssTotal != null ? `${ipssTotal}/35` : '—'}</span>
              <span className={`text-xs font-medium px-2 py-0.5 rounded-full bg-gray-100 ${ipssSev.color} whitespace-nowrap`}>
                {ipssSev.label}
              </span>
            </div>
          </div>

          <div className="space-y-2">
            {IPSS_QUESTIONS.map((q, i) => (
              <div key={i} className="bg-gray-50 rounded-lg p-3">
                <p className="text-xs text-gray-700 mb-2">{i + 1}. {q}</p>
                <div className="flex gap-1">
                  {IPSS_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => setIpss((prev) => prev.map((v, j) => (j === i ? opt.value : v)))}
                      disabled={!encounterId}
                      className={`flex-1 py-1.5 text-[10px] rounded-lg font-medium transition-colors disabled:opacity-50 ${
                        ipss[i] === opt.value
                          ? 'bg-blue-600 text-white'
                          : 'bg-white border border-gray-200 text-gray-500 hover:bg-blue-50'
                      }`}
                    >
                      {opt.value}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* QoL */}
          <div className="pt-2 border-t border-gray-100">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
              <T k="삶의 질 (QoL) 점수" />
            </p>
            <p className="text-xs text-gray-600 mb-2">
              현재의 배뇨 상태로 나머지 일생을 보낸다면 어떻게 느끼겠습니까?
            </p>
            <div className="flex gap-1">
              {QOL_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setQol(opt.value)}
                  disabled={!encounterId}
                  className={`flex-1 py-2 text-[10px] rounded-lg font-medium transition-colors disabled:opacity-50 ${
                    qol === opt.value
                      ? 'bg-purple-600 text-white'
                      : 'bg-white border border-gray-200 text-gray-500 hover:bg-purple-50'
                  }`}
                >
                  {opt.value}
                </button>
              ))}
            </div>
            <div className="flex justify-between mt-1 px-1">
              <span className="text-[9px] text-gray-400">매우 좋음</span>
              <span className="text-[9px] text-gray-400">매우 나쁨</span>
            </div>
          </div>
        </div>

        {/* Right: Lab + Urodynamics + Chart */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 space-y-4">
          <h3 className="font-semibold text-gray-900 flex items-center gap-2">
            <svg className="w-5 h-5 text-gray-400" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15.3M14.25 3.104c.251.023.501.05.75.082M19.8 15.3l-1.57.393A9.065 9.065 0 0112 15a9.065 9.065 0 00-6.23.693L5 14.5m14.8.8l1.402 1.402c1.232 1.232.65 3.318-1.067 3.611A48.309 48.309 0 0112 21c-2.773 0-5.491-.235-8.135-.687-1.718-.293-2.3-2.379-1.067-3.61L5 14.5" />
            </svg>
            <T k="검사 결과" />
          </h3>

          {/* PSA + Prostate Volume */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>PSA (ng/mL)</label>
              <input
                type="number"
                step="0.01"
                value={psa}
                onChange={(e) => setPsa(e.target.value)}
                disabled={!encounterId}
                className={inputCls}
                placeholder={tAttr("예: 2.5")}
              />
              {psa && parseFloat(psa) > 4.0 && (
                <p className="text-[10px] text-red-500 mt-1 font-medium"><T k="PSA 상승 (정상: 0-4.0)" /></p>
              )}
            </div>
            <div>
              <label className={labelCls}><T k="전립선 용적 (cc)" /></label>
              <input
                type="number"
                step="0.1"
                value={prostateVolume}
                onChange={(e) => setProstateVolume(e.target.value)}
                disabled={!encounterId}
                className={inputCls}
                placeholder={tAttr("예: 30")}
              />
              {prostateVolume && parseFloat(prostateVolume) > 30 && (
                <p className="text-[10px] text-amber-500 mt-1 font-medium"><T k="전립선 비대 (정상: ~30cc)" /></p>
              )}
            </div>
          </div>

          {/* Urodynamics */}
          <div className="pt-2 border-t border-gray-100">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2"><T k="요역학 검사 (Urodynamics)" /></p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}><T k="최대 요속 (mL/s)" /></label>
                <input
                  type="number"
                  step="0.1"
                  value={maxFlow}
                  onChange={(e) => setMaxFlow(e.target.value)}
                  disabled={!encounterId}
                  className={inputCls}
                  placeholder="Qmax"
                />
                {maxFlow && parseFloat(maxFlow) < 10 && (
                  <p className="text-[10px] text-red-500 mt-1 font-medium"><T k="저하 (정상: 15+ mL/s)" /></p>
                )}
              </div>
              <div>
                <label className={labelCls}><T k="평균 요속 (mL/s)" /></label>
                <input
                  type="number"
                  step="0.1"
                  value={avgFlow}
                  onChange={(e) => setAvgFlow(e.target.value)}
                  disabled={!encounterId}
                  className={inputCls}
                  placeholder="Qavg"
                />
              </div>
              <div>
                <label className={labelCls}><T k="배뇨량 (mL)" /></label>
                <input
                  type="number"
                  value={voidedVolume}
                  onChange={(e) => setVoidedVolume(e.target.value)}
                  disabled={!encounterId}
                  className={inputCls}
                  placeholder="Voided Vol"
                />
              </div>
              <div>
                <label className={labelCls}><T k="잔뇨량 (mL)" /></label>
                <input
                  type="number"
                  value={residualVolume}
                  onChange={(e) => setResidualVolume(e.target.value)}
                  disabled={!encounterId}
                  className={inputCls}
                  placeholder="PVR"
                />
                {residualVolume && parseFloat(residualVolume) > 100 && (
                  <p className="text-[10px] text-amber-500 mt-1 font-medium">증가 (정상: &lt;50mL)</p>
                )}
              </div>
            </div>
          </div>

          {/* Score Trend Chart */}
          <div className="pt-2 border-t border-gray-100">
            <ScoreTrendChart series={chartSeries} />
          </div>

          {/* Findings */}
          <div className="pt-2 border-t border-gray-100">
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
            className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-teal-600 text-white text-sm font-medium rounded-xl hover:bg-teal-700 transition-colors disabled:opacity-40"
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
            IPSS: {ipssTotal != null ? `${ipssTotal}/35` : '—'} ({ipssSev.label}) | QoL: {qol != null ? `${qol}/6` : '—'}
            {psa && ` | PSA: ${psa}`}
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
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-teal-600 text-white text-sm font-medium rounded-xl hover:bg-teal-700 transition-colors disabled:opacity-40"
            >
              {isSigning ? '처리중...' : '서명 완료'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
