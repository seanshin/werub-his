'use client';

import { T, Tf } from '@/components/ui/i18n-text';

export interface PacuAlertSettings {
  alertThresholds?: { spo2Low: number; hrLow: number; hrHigh: number; rrLow: number; rrHigh: number; sbpLow: number; sbpHigh: number; tempLow: number; tempHigh: number };
  alertSource?: 'CONFIG' | 'DEFAULT' | 'UNAVAILABLE';
  alertDroppedKeys?: string[];
}

/**
 * 회복실 활력 경보 기준 — 숫자는 서버 설정 응답(`alertThresholds`)에서만 온다(화면에 적지 않는다).
 * 출처: 원내 설정 / 미설정(기본값) / 조회 실패(기본값으로 감시) · 적용되지 않은 설정 키를 숨기지 않는다.
 */
export function PacuAlertRule({ s }: { s: PacuAlertSettings }) {
  const t = s.alertThresholds!;
  return (
    <p className="mt-1 text-[11px] text-gray-500" data-pacu-alert-rule>
      <T k="활력 경보 기준" />: SpO2 &lt;{t.spo2Low} · HR &lt;{t.hrLow}/&gt;{t.hrHigh} · RR &lt;{t.rrLow}/&gt;{t.rrHigh} · SBP &lt;{t.sbpLow}/&gt;{t.sbpHigh} · BT &lt;{t.tempLow}/≥{t.tempHigh}
      {' — '}
      {s.alertSource === 'CONFIG' ? <T k="원내 설정" /> : s.alertSource === 'UNAVAILABLE' ? <T k="설정 조회 실패 — 기본값으로 감시 중" /> : <T k="원내 기준 미설정 — 기본값 적용(병동 활력 기준보다 엄격)" />}
      {!!s.alertDroppedKeys?.length && <span className="ml-1 text-rose-700"><Tf k="· 적용되지 않은 설정 키: {키}" params={{ 키: s.alertDroppedKeys.join(', ') }} /></span>}
    </p>
  );
}

