/**
 * 위젯 ↔ 서버 계약 가드 (W8 · R8)
 *
 * 🔴 `ApiStatsWidget` 은 `data[key] ?? '-'` 로 그린다. 그래서 **서버에 없는 키를 읽으면
 *    화면이 조용히 영구 '-'** 가 되고 200 OK 라 아무 데도 안 남는다(실측 9개 위젯·23칸).
 *    새 위젯이 같은 방식으로 갈라지지 않도록, 소스를 스캔해 다음을 강제한다.
 *
 *  ① 아래 SERVER_KEYS 에 등재된 EP 를 쓰는 위젯은 **등재된 키만** 읽거나, 응답 shape 을
 *     바꾸는 `transform` 을 선언해야 한다.
 *  ② 위젯 래퍼 4종은 조회 실패를 '데이터 없음'/'0건'으로 접지 않아야 한다(`error` 분기 필수).
 *  ③ `catch` 로 빈 배열을 만들어 실패를 0건으로 둔갑시키지 않아야 한다.
 *
 * SERVER_KEYS 는 apps/api 실제 반환문에서 옮긴 것이다(각 항목에 출처를 적었다).
 * 서버가 바뀌면 이 표도 같이 바꾼다 — 표와 화면이 갈라지는 것이 바로 이 결함의 원인이었다.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { resolve, join } from 'path';

const WIDGETS_DIR = resolve(__dirname, '../../src/app/(main)/dashboard/components/widgets');

/** endpoint(쿼리스트링 제외) → 응답 최상위 키(점 경로는 중첩 허용) */
const SERVER_KEYS: Record<string, string[]> = {
  // bed.service.ts getBedStatusSummary
  '/api/v1/beds/status': ['total', 'byStatus'],
  // billing.service.ts _getCashierStats
  '/api/v1/billing/cashier-stats': ['pendingCount', 'completedCount', 'deferredCount', 'totalRevenue'],
  // operational-stats.service.ts getPatientFlow
  // 🔴 W9: `dischargedToday` 가 이름과 달리 창(기본 30일) 값이던 것을 서버가 정정하고
  //    창 값을 `dischargedInWindow` 로 분리했다. 표가 서버와 갈라지지 않게 함께 등재한다.
  '/api/v1/operational-stats/patient-flow': [
    'newAdmissions', 'dischargedToday', 'dischargedInWindow', 'admittedToday', 'netFlowToday',
    'activePatients', 'netFlow', 'window',
  ],
  // billing.service.ts getDailySummary
  '/api/v1/billing/daily-summary': [
    'date', 'totalCount', 'totalRevenue', 'byPaymentMethod', 'byInsurance', 'byInsuranceType',
    'refundCount', 'refundAmount', 'cancelCount', 'deferredCount', 'deferredAmount',
  ],
  // icu.service.ts getDashboard
  '/api/v1/icu/dashboard': ['totalBeds', 'occupied', 'available', 'occupancyRate', 'ventilatorCount', 'isolationCount', 'severityCounts'],
  // dashboard.service.ts getLabStats
  '/api/v1/dashboard/lab/stats': ['department', 'total', 'pending', 'inProgress', 'completed', 'cancelled', 'completionRate'],
  // infection-control.service.ts getInfectionDashboard(overview=getStats)
  '/api/v1/infection-control/dashboard': [
    'overview.total', 'overview.active', 'overview.resolved', 'overview.newToday', 'overview.byType',
    'overview.isolated', 'overview.isolatedBy', 'overview.isolatedBasis', 'overview.surveillanceScope',
    'konis', 'resistance', 'isolation', 'alerts', 'staffSafety', 'generatedAt',
  ],
  // patient-safety.service.ts getIpsgSummary
  '/api/v1/safety/ipsg-summary': [
    'windowDays',
    'ipsg2_criticalValue.pending', 'ipsg2_criticalValue.today',
    'ipsg5_infectionControl.activeInfections', 'ipsg5_infectionControl.isolation',
    'ipsg5_infectionControl.handHygieneObservations', 'ipsg5_infectionControl.handHygieneCompliancePct',
    // 🔴 2026-08-20 — 준수율만 오던 것에 분자·분모를 붙였다(위젯이 <Ratio> 로 n/N 을 그린다)
    'ipsg5_infectionControl.handHygieneNumerator', 'ipsg5_infectionControl.handHygieneDenominator',
    'ipsg6_fallPrevention.highRiskPatients',
  ],
  // patient-safety.service.ts getIncidentStats
  '/api/v1/safety/incidents/stats': [
    'period', 'total', 'rcaCompleted', 'rcaPending', 'escalating', 'majorOrAbove', 'unspecified',
    'falls', 'medication', 'thisMonth', 'thisMonthSince', 'byType', 'bySeverity', 'byStatus', 'byTypeLast180d',
  ],
  // emergency.service.ts getStats
  '/api/v1/emergency/stats': ['current', 'total', 'byLevel'],
  // health.controller.ts
  '/health': ['status', 'version'],
};

/** 🔴 주석은 제거하고 스캔한다 — 원 결함을 설명하는 🔴 주석 자체가 금지 패턴을 담고 있다 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

function widgetFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.tsx')) out.push(p);
    }
  };
  walk(WIDGETS_DIR);
  return out;
}

interface Usage { file: string; endpoint: string; keys: string[]; hasTransform: boolean }

function parseStatsUsages(): Usage[] {
  const usages: Usage[] = [];
  for (const file of widgetFiles()) {
    const src = stripComments(readFileSync(file, 'utf8'));
    if (!src.includes('ApiStatsWidget')) continue;
    const ep = src.match(/endpoint="([^"]+)"/)?.[1];
    if (!ep) continue;
    const keys = [...src.matchAll(/key:\s*'([^']+)'|key:\s*"([^"]+)"/g)].map((m) => m[1] ?? m[2]);
    usages.push({ file, endpoint: ep.split('?')[0], keys, hasTransform: /transform=\{/.test(src) });
  }
  return usages;
}

describe('위젯이 서버에 없는 키를 읽지 않는다 (P11)', () => {
  const usages = parseStatsUsages();

  it('스캔 대상 위젯이 있다 (스캐너가 조용히 0건이 되지 않도록)', () => {
    expect(usages.length).toBeGreaterThan(8);
  });

  for (const u of usages) {
    const known = SERVER_KEYS[u.endpoint];
    if (!known) continue; // 등재되지 않은 EP 는 이 가드의 대상이 아니다
    it(`${u.endpoint} — ${u.file.split('/').pop()}`, () => {
      if (u.hasTransform) return; // transform 이 shape 을 바꾸면 키는 파서 스펙이 지킨다
      const unknown = u.keys.filter((k) => !known.includes(k));
      expect(unknown, `서버 응답에 없는 키 → 영구 '-' 가 된다. transform 을 붙이거나 SERVER_KEYS 를 갱신하라`).toEqual([]);
    });
  }
});

describe('위젯 래퍼가 조회 실패를 0건/없음 으로 접지 않는다 (P17)', () => {
  const wrappers = [
    'ApiStatsWidget.tsx',
    'ApiWidget.tsx',
    'ApiTableWidget.tsx',
    'ext/RowListWidget.tsx',
  ];

  for (const w of wrappers) {
    it(`${w} 는 error 분기를 갖는다`, () => {
      const src = stripComments(readFileSync(join(WIDGETS_DIR, w), 'utf8'));
      expect(src, '조회 실패와 "데이터 없음"은 다른 사실이다').toMatch(/if\s*\(\s*error\s*\)|catch\s*\(\s*e\s*\)/);
    });
  }

  it('🔴 어느 위젯도 catch 로 빈 배열/0 을 만들어 실패를 \'없음\' 으로 바꾸지 않는다', () => {
    // `.catch(() => ({ data: [] }))` · `.catch(() => [])` · `.catch(() => null)` 전부 같은 거짓말이다:
    // 조회가 실패했는데 화면은 "새 검사결과 없음"·"담당 입원환자 0명"·"오늘 수술 없음" 이라고 단정했다.
    const offenders: string[] = [];
    for (const file of widgetFiles()) {
      const src = stripComments(readFileSync(file, 'utf8'));
      if (/catch\s*(\([^)]*\))?\s*\{\s*(rows\s*=\s*\[\]|return\s*\[\])\s*;?\s*\}/.test(src)) offenders.push(`${file} (catch-block)`);
      if (/\.catch\(\s*\(\s*\)\s*=>/.test(src)) offenders.push(`${file} (.catch fallback)`);
    }
    expect(offenders, '실패는 0건이 아니다 — isError 로 드러내라').toEqual([]);
  });
});
