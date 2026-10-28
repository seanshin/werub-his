'use client';

import { useState } from 'react';
import { Unit } from '@/components/ui/display';
import { useQuery, useMutation } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { toast } from '@/stores/toast-store';
import type { ChartPanelProps } from './types';
import { vitalsIngestNotice, ingestOf } from '@/lib/vitals-ingest-notice';
import { T, Tf, useTAttr } from '@/components/ui/i18n-text';
import { kdate } from '@/lib/ui-settings';
import { VitalHeaderCells, VitalRowCells } from '@/components/vitals/VitalSigns';
import type { VitalSignKey } from '@hospital-run/shared';

const TREND_VITALS: readonly VitalSignKey[] = ['spo2', 'systolicBp', 'heartRate', 'temperature'];

export default function NurseChart({ session, summary, patientId, sessionId, notes, setNotes, isActive }: ChartPanelProps) {
  const tAttr = useTAttr();
  // 바이탈 입력
  const [vitals, setVitals] = useState({ systolicBp: '', diastolicBp: '', heartRate: '', temperature: '', spo2: '', respiratoryRate: '', weight: '' });
  /**
   * NEWS2 관측 2요소 — '' = 미관측(보내지 않는다).
   * 🔴 서버가 `supplementalO2:false`·`consciousness:'ALERT'` 를 하드코딩해 관측하지 않은 값을
   *    EWS 법정기록에 남기던 것 봉합(2026-08-18). 미관측이면 NEWS2 를 **산출하지 않는다**.
   */
  const [o2, setO2] = useState('');
  const [acvpu, setAcvpu] = useState('');
  const vitalMut = useMutation({
    mutationFn: () => apiClient.post(`/api/v1/vitals`, {
      patientId,
      ...Object.fromEntries(Object.entries(vitals).filter(([, v]) => v !== '').map(([k, v]) => [k, parseFloat(v)])),
      ...(o2 !== '' ? { supplementalO2: o2 === 'true' } : {}),
      ...(acvpu !== '' ? { consciousness: acvpu } : {}),
    }),
    onSuccess: (res) => {
      // 🔴 중복·보류면 저장되지 않았다 — 입력값을 지우면 다시 넣을 수 없다.
      const n = vitalsIngestNotice(ingestOf(res));
      if (n && !n.stored) { toast.error(n.text); return; }
      toast.success(n ? n.text : '바이탈 저장 완료');
      setVitals({ systolicBp: '', diastolicBp: '', heartRate: '', temperature: '', spo2: '', respiratoryRate: '', weight: '' }); setO2(''); setAcvpu('');
    },
    onError: () => toast.error('바이탈 저장 실패'),
  });

  // 바이탈 트렌드 (최근 5회)
  const { data: trendData, isError: trendIsError, error: trendError, refetch: refetchTrend } = useQuery({
    queryKey: ['vital-trend', patientId],
    queryFn: () => apiClient.get<{ data: Array<Record<string, unknown>> }>(`/api/v1/vitals?patientId=${patientId}&limit=5`),
    enabled: !!patientId,
  });
  const trendRaw = trendData?.data;
  const trends: Array<Record<string, unknown>> = Array.isArray(trendRaw) ? trendRaw : (trendRaw as { data?: Array<Record<string, unknown>> } | undefined)?.data ?? [];

  // 🔴 Morse 낙상 위험은 평가 기록이 배선되기 전까지 '--'(산출 불가)로 말한다.
  //    종전 placeholder 는 Math.random() 난수를 정식 점수처럼 표시했다 — 환자 안전 지표 위조.
  const morseScore: number | null = null;

  return (
    <>
      {/* 중앙: 바이탈 입력 + 트렌드 */}
      <div className="w-72 shrink-0 border-r p-3 overflow-y-auto space-y-3">
        {/* 바이탈 입력 폼 */}
        <div>
          <p className="text-[10px] font-bold text-gray-400 uppercase mb-2"><T k="바이탈 사인 입력" /></p>
          <div className="grid grid-cols-2 gap-1.5">
            {[
              { key: 'systolicBp', label: 'SBP', unit: 'mmHg' },
              { key: 'diastolicBp', label: 'DBP', unit: 'mmHg' },
              { key: 'heartRate', label: 'HR', unit: 'bpm' },
              { key: 'temperature', label: 'BT', unit: '°C' },
              { key: 'spo2', label: 'SpO2', unit: '%' },
              { key: 'respiratoryRate', label: 'RR', unit: '/min' },
            ].map(({ key, label, unit }) => (
              <div key={key}>
                <label className="text-[9px] text-gray-400">{label}</label>
                <div className="flex items-center gap-0.5">
                  <input
                    type="number"
                    value={vitals[key as keyof typeof vitals]}
                    onChange={e => setVitals(prev => ({ ...prev, [key]: e.target.value }))}
                    className="w-full px-2 py-1 border rounded text-xs"
                    placeholder="--"
                  />
                  <span className="text-[8px] text-gray-300 shrink-0">{unit}</span>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-1.5">
            <label className="text-[9px] text-gray-400"><T k="체중 (kg)" /></label>
            <input type="number" value={vitals.weight} onChange={e => setVitals(prev => ({ ...prev, weight: e.target.value }))}
              className="w-full px-2 py-1 border rounded text-xs" placeholder="--" />
          </div>
          <div className="grid grid-cols-2 gap-1.5 mt-1.5">
            <div>
              <label className="text-[9px] text-gray-400"><T k="보충산소" /></label>
              <select value={o2} onChange={e => setO2(e.target.value)} className="w-full px-2 py-1 border rounded text-xs">
                <option value=""><T k="미관측" /></option>
                <option value="false"><T k="실내공기" /></option>
                <option value="true"><T k="투여 중" /></option>
              </select>
            </div>
            <div>
              <label className="text-[9px] text-gray-400"><T k="의식(ACVPU)" /></label>
              <select value={acvpu} onChange={e => setAcvpu(e.target.value)} className="w-full px-2 py-1 border rounded text-xs">
                <option value=""><T k="미관측" /></option>
                <option value="ALERT"><T k="명료(A)" /></option>
                <option value="CONFUSION"><T k="혼돈(C)" /></option>
                <option value="VOICE"><T k="음성반응(V)" /></option>
                <option value="PAIN"><T k="통증반응(P)" /></option>
                <option value="UNRESPONSIVE"><T k="무반응(U)" /></option>
              </select>
            </div>
          </div>
          <p className="text-[9px] text-gray-400 mt-1"><T k="보충산소·의식까지 관측해야 NEWS2 가 산출된다(미관측은 기록하지 않음)." /></p>
          <button onClick={() => vitalMut.mutate()} disabled={vitalMut.isPending}
            className="w-full mt-2 py-1.5 bg-emerald-600 text-white text-xs font-bold rounded-lg hover:bg-emerald-700 disabled:opacity-50">
            <T k={vitalMut.isPending ? '저장 중...' : '바이탈 저장'} />
          </button>
        </div>

        {/* 바이탈 트렌드 미니 차트 */}
        {/* 🔴 활력 트렌드 조회 실패로 패널이 사라지면 "측정 기록 없음"으로 읽힌다 */}
        {trendIsError && <QueryErrorFallback error={trendError} onRetry={refetchTrend} size="compact" />}
        {!trendIsError && trends.length > 0 && (
          <div>
            <p className="text-[10px] font-bold text-gray-400 uppercase mb-1"><Tf k="바이탈 트렌드 (최근 {횟수}회)" params={{ 횟수: trends.length }} /></p>
            <div className="bg-gray-50 rounded-lg p-2">
              <table className="w-full text-[8px]">
                <thead>
                  <tr className="text-gray-400">
                    <th className="text-left py-0.5"><T k="날짜" /></th>
                    <VitalHeaderCells keys={TREND_VITALS} className="text-center font-normal" />
                  </tr>
                </thead>
                <tbody>
                  {trends.slice(0, 5).map((t, i) => (
                    <tr key={i} className="border-t border-gray-100">
                      <td className="py-0.5 text-gray-500">{t.measuredAt ? kdate(t.measuredAt as string, 'monthDay') : ''}</td>
                      {/* 🔴 (2026-10-07) truthy 검사가 측정된 0 을 '-' 로·`°` 단위 → 표시 부품 정본(미측정 '—'·임계 정본 색) */}
                      <VitalRowCells vitals={t as Record<string, unknown>} keys={TREND_VITALS} className="text-center tabular-nums" />
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* 간호평가 도구 */}
        <div>
          <p className="text-[10px] font-bold text-gray-400 uppercase mb-1"><T k="간호 평가" /></p>
          <div className="space-y-1">
            <div className="flex justify-between items-center bg-gray-50 rounded p-1.5">
              <span className="text-[10px] text-gray-600"><T k="Morse 낙상 위험" /></span>
              <span className="text-[10px] font-bold text-amber-600">{morseScore ?? '--'}<Unit><T k="점" /></Unit></span>
            </div>
            <div className="flex justify-between items-center bg-gray-50 rounded p-1.5">
              <span className="text-[10px] text-gray-600"><T k="NEWS2 점수" /></span>
              <span className="text-[10px] font-bold text-gray-600">--</span>
            </div>
          </div>
        </div>
      </div>

      {/* 우측: 간호 기록 + 투약 확인 */}
      <div className="flex-1 p-3 overflow-y-auto space-y-3">
        {/* 간호 기록 */}
        <div>
          <p className="text-[10px] font-bold text-gray-400 uppercase mb-1"><T k="간호 기록" /></p>
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            rows={5}
            placeholder={tAttr('간호 관찰 내용, 환자 상태 변화, 교육 내용 등을 기록하세요...')}
            className="w-full px-3 py-2 border rounded-lg text-sm resize-none"
          />
        </div>

        {/* 투약 확인 */}
        <div>
          <p className="text-[10px] font-bold text-gray-400 uppercase mb-1"><T k="투약 확인" /></p>
          {summary?.activeMedications && summary.activeMedications.length > 0 ? (
            <div className="space-y-1">
              {summary.activeMedications.map((m, i) => (
                <label key={i} className="flex items-center gap-2 bg-gray-50 rounded-lg p-2 cursor-pointer hover:bg-blue-50">
                  <input type="checkbox" className="rounded border-gray-300 text-emerald-600" />
                  <div className="flex-1 min-w-0">
                    <p className="text-[10px] font-medium text-gray-700 truncate">{m.nameKo}</p>
                    <p className="text-[9px] text-gray-400">{m.dosage} · {m.frequency}</p>
                  </div>
                </label>
              ))}
            </div>
          ) : (
            <p className="text-[10px] text-gray-400"><T k="투약 내역 없음" /></p>
          )}
        </div>

        {/* 환자 교육 */}
        <div>
          <p className="text-[10px] font-bold text-gray-400 uppercase mb-1"><T k="환자 교육" /></p>
          <div className="grid grid-cols-2 gap-1">
            {['복약 지도', '식이 요법', '운동 안내', '상처 관리', '자가 측정', '응급 상황'].map(t => (
              <label key={t} className="flex items-center gap-1.5 bg-gray-50 rounded p-1.5 cursor-pointer hover:bg-blue-50 text-[10px]">
                <input type="checkbox" className="rounded border-gray-300 text-blue-600 w-3 h-3" />
                {t}
              </label>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
