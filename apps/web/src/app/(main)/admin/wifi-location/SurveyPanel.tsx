'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  WIFI_CALIBRATION_FIT_FAILURE_LABEL, WIFI_FINGERPRINT, WIFI_PROTOCOL_LIMITS, normalizeBssid, type WifiCalibrationFitFailure,
} from '@hospital-run/shared';
import { apiClient } from '@/lib/api-client';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { KDate, Num } from '@/components/ui/display';
import { T, Tf, useTAttr } from '@/components/ui/i18n-text';

/**
 * 현장 측정·교정 제안(2026-10-10) — 실제 수집 결정 뒤 사람이 하는 일(현장 교정)을 도구로.
 *  · 표본 = 위치를 아는 지점(층·좌표)에서 잰 AP 세기 · 측정 시각 필수 · 지우지 않고 무효(사유)
 *  · 층마다 유효 표본이 기준 이상이면 그 층 측위가 신호 지도(가장 닮은 표본들)로 바뀐다
 *  · 교정 제안은 표본으로 맞춘 값 — 🔴 적용은 관리자가 버튼으로(자동 적용 없음) · 못 맞추면 이유
 */
interface Sample { id: string; floorKey: string; x: number; y: number; readings: Array<{ bssid: string; rssi: number }>; measuredAt: string; note: string | null; voidedAt: string | null; voidReason: string | null }
interface SurveyMeta { total: number; truncated: boolean; perFloor: Array<{ floorKey: string; samples: number; fingerprintActive: boolean }>; minSamplesPerFloor: number }
interface Suggestion {
  apId: string; bssid: string; label: string; floorKey: string;
  current: { rssiAt1m: number | null; pathLossExponent: number | null; calibratedAt: string | null };
  suggestion: { rssiAt1m: number; pathLossExponent: number; pairs: number; rmseDb: number } | null;
  reason: WifiCalibrationFitFailure | null; pairs: number;
}

/** "bssid,rssi" 한 줄에 하나 — 형식이 틀린 줄을 그대로 돌려준다(조용히 버리지 않는다) */
export function parseSurveyReadings(text: string): { readings: Array<{ bssid: string; rssi: number }>; bad: string[] } {
  const readings: Array<{ bssid: string; rssi: number }> = []; const bad: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const [b, r] = line.split(/[,\s\t]+/);
    const bssid = normalizeBssid(b); const rssi = Number(r);
    if (!bssid || !Number.isFinite(rssi) || rssi < WIFI_PROTOCOL_LIMITS.rssiMin || rssi > WIFI_PROTOCOL_LIMITS.rssiMax) { bad.push(line); continue; }
    readings.push({ bssid, rssi });
  }
  return { readings, bad };
}

export function SurveyPanel() {
  const qc = useQueryClient();
  const tAttr = useTAttr();
  const surveyQ = useQuery({ queryKey: ['wifi-survey'], queryFn: () => apiClient.get<{ data: Sample[]; meta: SurveyMeta }>('/api/v1/location/wifi/survey') });
  const sugQ = useQuery({ queryKey: ['wifi-cal-suggest'], queryFn: () => apiClient.get<{ data: { samples: number; items: Suggestion[] } }>('/api/v1/location/wifi/calibration-suggestions').then((r) => r.data) });
  const [form, setForm] = useState({ floorKey: '', x: '', y: '', measuredAt: '', readings: '', note: '' });
  const [voiding, setVoiding] = useState<{ id: string; reason: string } | null>(null);
  const parsed = parseSurveyReadings(form.readings);
  const canSave = !!form.floorKey.trim() && form.x.trim() !== '' && form.y.trim() !== '' && !!form.measuredAt && parsed.readings.length > 0 && parsed.bad.length === 0;
  const refresh = () => { qc.invalidateQueries({ queryKey: ['wifi-survey'] }); qc.invalidateQueries({ queryKey: ['wifi-cal-suggest'] }); };
  const create = useMutation({
    mutationFn: () => apiClient.post('/api/v1/location/wifi/survey', {
      floorKey: form.floorKey.trim(), x: Number(form.x), y: Number(form.y), measuredAt: new Date(form.measuredAt).toISOString(),
      readings: parsed.readings, ...(form.note.trim() ? { note: form.note.trim() } : {}),
    }),
    onSuccess: () => { setForm({ ...form, x: '', y: '', readings: '', note: '' }); refresh(); },
  });
  const voidM = useMutation({
    mutationFn: (v: { id: string; reason: string }) => apiClient.post(`/api/v1/location/wifi/survey/${v.id}/void`, { reason: v.reason }),
    onSuccess: () => { setVoiding(null); refresh(); },
  });
  const apply = useMutation({
    mutationFn: (s: Suggestion) => apiClient.patch(`/api/v1/location/wifi/access-points/${s.apId}`, { rssiAt1m: s.suggestion!.rssiAt1m, pathLossExponent: s.suggestion!.pathLossExponent }),
    onSuccess: () => { refresh(); qc.invalidateQueries({ queryKey: ['wifi-aps'] }); qc.invalidateQueries({ queryKey: ['wifi-status'] }); },
  });

  const meta = surveyQ.data?.meta;
  const items = surveyQ.data?.data ?? [];
  return (
    <section className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm" data-wifi-survey>
      <h2 className="text-sm font-bold text-gray-900"><T k="현장 측정 · 교정 제안" /></h2>
      <p className="mt-1 text-[11px] text-gray-500">
        <Tf k="위치를 아는 지점에서 잰 신호 표본입니다. 층마다 유효 표본이 {n}개 이상이면 그 층 측위가 신호 지도(가장 닮은 표본들)로 바뀝니다." params={{ n: WIFI_FINGERPRINT.minSamplesPerFloor }} />
      </p>

      {surveyQ.isError ? <QueryErrorFallback error={surveyQ.error} onRetry={() => surveyQ.refetch()} size="compact" />
        : !surveyQ.data ? <div className="mt-2 h-16 animate-pulse rounded-xl bg-gray-100" aria-busy="true" />
        : (
          <>
            <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]" data-wifi-survey-floors>
              {meta!.perFloor.length === 0
                ? <span className="text-gray-500" data-wifi-survey-none><T k="아직 측정 표본이 없습니다 — 모든 층이 전파 모델(가중 중심)로 측위합니다." /></span>
                : meta!.perFloor.map((f) => (
                  <span key={f.floorKey} className={`rounded px-2 py-0.5 ${f.fingerprintActive ? 'bg-emerald-50 text-emerald-800' : 'bg-gray-50 text-gray-600'}`} data-wifi-survey-floor={f.floorKey} data-fingerprint={f.fingerprintActive ? 'on' : 'off'}>
                    {f.floorKey} · <Tf k="유효 {n}개" params={{ n: f.samples }} /> · {f.fingerprintActive ? <T k="신호 지도 측위" /> : <T k="전파 모델 측위" />}
                  </span>
                ))}
            </div>
            {items.length > 0 && (
              <div className="mt-2 max-h-56 overflow-auto">
                <table className="w-full text-xs">
                  <thead><tr className="border-b border-gray-100 text-left text-[10px] text-gray-500">
                    <th className="px-2 py-1"><T k="측정 시각" /></th><th className="px-2 py-1"><T k="층" /></th><th className="px-2 py-1"><T k="좌표(m)" /></th>
                    <th className="px-2 py-1"><T k="들린 AP" /></th><th className="px-2 py-1"><T k="상태" /></th><th className="px-2 py-1" />
                  </tr></thead>
                  <tbody>
                    {items.map((s) => (
                      <tr key={s.id} className={`border-b border-gray-50 ${s.voidedAt ? 'text-gray-400 line-through' : ''}`} data-wifi-survey-row={s.id}>
                        <td className="px-2 py-1"><KDate value={s.measuredAt} mode="datetime" /></td>
                        <td className="px-2 py-1">{s.floorKey}</td>
                        <td className="px-2 py-1 tabular-nums"><Num value={s.x} domain="positionMeters" unit={false} />, <Num value={s.y} domain="positionMeters" unit={false} /></td>
                        <td className="px-2 py-1">{s.readings.length}</td>
                        <td className="px-2 py-1 no-underline">{s.voidedAt ? <span title={s.voidReason ?? ''}><T k="무효" /></span> : <T k="유효" />}</td>
                        <td className="px-2 py-1">{!s.voidedAt && <button type="button" className="rounded border border-gray-200 px-2 py-0.5" onClick={() => setVoiding({ id: s.id, reason: '' })}><T k="무효" /></button>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {meta!.truncated && <p className="text-[11px] text-amber-700"><Tf k="최근 {shown}개만 보입니다(전체 {total}개)" params={{ shown: items.length, total: meta!.total }} /></p>}
              </div>
            )}
          </>
        )}

      {voiding && (
        <div className="mt-2 flex flex-wrap items-end gap-2 rounded-xl bg-rose-50 p-3 text-xs" data-wifi-survey-void>
          <label className="flex flex-1 flex-col gap-1"><T k="무효 사유" /><input value={voiding.reason} onChange={(e) => setVoiding({ ...voiding, reason: e.target.value })} className="rounded border px-2 py-1" /></label>
          <button type="button" className="min-h-[44px] rounded bg-rose-600 px-3 text-white disabled:opacity-40" disabled={!voiding.reason.trim() || voidM.isPending} onClick={() => voidM.mutate({ id: voiding.id, reason: voiding.reason.trim() })}><T k="무효 처리" /></button>
          <button type="button" className="min-h-[36px] px-2 text-gray-500" onClick={() => setVoiding(null)}><T k="닫기" /></button>
        </div>
      )}

      <div className="mt-3 grid gap-2 border-t border-gray-100 pt-3 text-xs sm:grid-cols-[auto_auto_auto_auto_1fr]" data-wifi-survey-form>
        <label className="flex flex-col gap-1"><T k="층 키" /><input value={form.floorKey} onChange={(e) => setForm({ ...form, floorKey: e.target.value })} placeholder="1F" className="w-16 rounded border px-2 py-1" /></label>
        <label className="flex flex-col gap-1">x(m)<input value={form.x} onChange={(e) => setForm({ ...form, x: e.target.value })} inputMode="decimal" className="w-20 rounded border px-2 py-1" /></label>
        <label className="flex flex-col gap-1">y(m)<input value={form.y} onChange={(e) => setForm({ ...form, y: e.target.value })} inputMode="decimal" className="w-20 rounded border px-2 py-1" /></label>
        <label className="flex flex-col gap-1"><T k="측정 시각" /><input type="datetime-local" value={form.measuredAt} onChange={(e) => setForm({ ...form, measuredAt: e.target.value })} className="rounded border px-2 py-1" /></label>
        <label className="flex flex-col gap-1"><T k="메모" /><input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} className="rounded border px-2 py-1" /></label>
        <label className="flex flex-col gap-1 sm:col-span-5"><T k="들린 AP — 한 줄에 'BSSID,세기(dBm)'" />
          <textarea value={form.readings} onChange={(e) => setForm({ ...form, readings: e.target.value })} rows={4} placeholder={'aa:bb:cc:dd:ee:01,-52\naa:bb:cc:dd:ee:02,-67'} className="rounded border px-2 py-1 font-mono" />
        </label>
        {parsed.bad.length > 0 && <p className="text-rose-700 sm:col-span-5" data-wifi-survey-bad={parsed.bad.length}><Tf k="형식이 틀린 줄 {n}개 — 고쳐야 저장합니다" params={{ n: parsed.bad.length }} /></p>}
        <div className="sm:col-span-5">
          <button type="button" className="min-h-[44px] rounded bg-gray-900 px-3 text-white disabled:opacity-40" disabled={!canSave || create.isPending} onClick={() => create.mutate()} data-wifi-survey-save><T k="측정 표본 기록" /></button>
          {create.isError && <span className="ml-2 text-rose-700"><T k="기록하지 못했습니다 — 확정 도면에 있는 층인지, 측정 시각이 미래가 아닌지 확인하십시오" /></span>}
        </div>
      </div>

      <div className="mt-4 border-t border-gray-100 pt-3" data-wifi-cal-suggest>
        <h3 className="text-xs font-bold text-gray-800"><T k="AP 교정 제안" /></h3>
        <p className="mt-0.5 text-[11px] text-gray-500"><T k="같은 층 표본의 (AP 까지 거리, 들린 세기)로 맞춘 값입니다. 제안일 뿐 — 적용은 직접 누릅니다." /></p>
        {sugQ.isError ? <QueryErrorFallback error={sugQ.error} onRetry={() => sugQ.refetch()} size="compact" />
          : !sugQ.data ? <div className="mt-2 h-12 animate-pulse rounded-xl bg-gray-100" aria-busy="true" />
          : sugQ.data.samples === 0 ? <p className="mt-1 text-[11px] text-gray-500" data-wifi-cal-none><T k="측정 표본이 없어 제안할 값이 없습니다." /></p>
          : (
            <div className="mt-2 max-h-64 overflow-auto">
              <table className="w-full text-xs">
                <thead><tr className="border-b border-gray-100 text-left text-[10px] text-gray-500">
                  <th className="px-2 py-1"><T k="이름" /></th><th className="px-2 py-1"><T k="층" /></th><th className="px-2 py-1"><T k="지금" /></th>
                  <th className="px-2 py-1"><T k="제안" /></th><th className="px-2 py-1"><T k="쌍" /></th><th className="px-2 py-1" />
                </tr></thead>
                <tbody>
                  {sugQ.data.items.map((s) => (
                    <tr key={s.apId} className="border-b border-gray-50" data-wifi-cal-row={s.bssid}>
                      <td className="px-2 py-1">{s.label}</td>
                      <td className="px-2 py-1">{s.floorKey}</td>
                      <td className="px-2 py-1">{s.current.rssiAt1m != null ? <><Num value={s.current.rssiAt1m} domain="wifiRssi" /> · n={s.current.pathLossExponent}</> : <span className="text-gray-500"><T k="교정 안 됨" /></span>}</td>
                      <td className="px-2 py-1">{s.suggestion
                        ? <span className="text-indigo-700"><Num value={s.suggestion.rssiAt1m} domain="wifiRssi" /> · n=<Num value={s.suggestion.pathLossExponent} domain="positionMeters" unit={false} /> <span className="text-gray-500">(±<Num value={s.suggestion.rmseDb} domain="wifiRssi" />)</span></span>
                        : <span className="text-gray-500" data-wifi-cal-reason={s.reason ?? ''}><T k={s.reason ? WIFI_CALIBRATION_FIT_FAILURE_LABEL[s.reason] : '—'} /></span>}</td>
                      <td className="px-2 py-1">{s.pairs}</td>
                      <td className="px-2 py-1">{s.suggestion && (
                        <button type="button" className="min-h-[44px] rounded bg-indigo-600 px-3 text-white disabled:opacity-40" disabled={apply.isPending} onClick={() => apply.mutate(s)} data-wifi-cal-apply={s.bssid} title={tAttr('이 값을 AP 교정값으로 저장합니다')}><T k="적용" /></button>
                      )}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {apply.isError && <p className="text-rose-700"><T k="적용하지 못했습니다" /></p>}
            </div>
          )}
      </div>
    </section>
  );
}
