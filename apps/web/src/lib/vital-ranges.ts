import { formatNum } from '@hospital-run/shared';
import { precisionOverride } from './ui-settings';

/**
 * 🔴 (2026-10-01) `VITAL_RANGES`·`isAbnormal*`·`tempStatus` 를 회수했다 — 이름은 "단일 정책"이었지만
 *    서버 임계 정본(`VITALS_THRESHOLDS` + 환자안전위 개정)과 **다른 숫자**를 가진 또 하나의 정본이었다.
 *    이상 판정은 `@/lib/vital-flags`(`useVitalsThresholds`·`flagsWith`)·체온 라벨은 shared `temperatureStatus`.
 */

/**
 * 체온 표시 정본 — 소수 1자리로 고정한다.
 * 🔴 종전 화면마다 `${temperature}℃` 로 raw 값을 찍어 `38.199999999999996℃`(℉→℃ 변환 잔차·
 *    Decimal 정밀도)가 그대로 노출됐다. 표시는 항상 이 함수를 쓴다.
 */
/** 체온 표시 — 수치 정책 정본(temperature) 경유. config `ui.precision.temperature` 오버라이드 반영. */
export const formatTemp = (temp: number | null | undefined): string =>
  formatNum(temp, 'temperature', { override: precisionOverride('temperature') });

/**
 * 측정 최신성 — 진료 시작 전 확인 화면에서 "지금 상태"인지 판단한다.
 * 오래된 측정을 최신처럼 보여주면 위험하므로, 경과 시간에 따라 경고 톤을 반환한다.
 */
export const vitalsFreshness = (
  measuredAt: string | Date | null | undefined,
  now: Date = new Date(),
): { text: string; stale: boolean; tone: 'fresh' | 'aging' | 'stale' } | null => {
  if (!measuredAt) return null;
  const t = new Date(measuredAt).getTime();
  if (Number.isNaN(t)) return null;
  const mins = Math.max(0, Math.floor((now.getTime() - t) / 60000));
  if (mins < 60) return { text: mins <= 1 ? '방금' : `${mins}분 전`, stale: false, tone: 'fresh' };
  const hours = Math.floor(mins / 60);
  if (hours < 24) return { text: `${hours}시간 전`, stale: hours >= 8, tone: hours >= 8 ? 'aging' : 'fresh' };
  const days = Math.floor(hours / 24);
  return { text: `${days}일 전`, stale: true, tone: 'stale' };
};
