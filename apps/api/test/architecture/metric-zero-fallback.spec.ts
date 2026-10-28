import path from 'node:path';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

import { scanMetricZeroFallbacks, countByFile, stripForScan } from './metric-zero-fallback-scan';
import { METRIC_ZERO_BASELINE, METRIC_ZERO_TOTAL_BASELINE } from './metric-zero-fallback.baseline';

/**
 * 🔴 지표(비율·평균·점수)가 **표본 0 에서 `0` 으로 떨어지는 자리**는 조용히 늘지 않는다 — I4(2026-09-16).
 *
 * 이 저장소 이력: QI 손위생 98.48% 달성(원내 관찰 0건) · Go-Live 준비율이 시드 결재를 실결재로 세어 65%(실제 45%) ·
 * 게이지 70% 하드코딩. 판정 규칙: **분모 0 이면 완결률은 100%(또는 0%)가 된다 · 표본 0 = 산출 불가(0 이 아니다)**.
 */
const MODULES = path.resolve(__dirname, '../../src/modules');

describe('🔴 표본 0 에서 지표가 0 으로 떨어지는 자리 — 정확값 동결', () => {
  const rows = scanMetricZeroFallbacks(MODULES);

  it('대조군 — 스캐너가 실제로 무언가를 센다(0 건이면 가드가 죽은 것이다)', () => {
    expect(rows.length).toBeGreaterThan(20);
  });

  it('총계가 기준선과 같다(늘면 새 폴백 · 줄면 이 수를 내려라)', () => {
    expect(rows.length).toBe(METRIC_ZERO_TOTAL_BASELINE);
  });

  it('파일별 수가 기준선과 정확히 같다', () => {
    expect(countByFile(rows)).toEqual(METRIC_ZERO_BASELINE);
  });

  /**
   * 🔴 (2026-09-16 J3) 종전 이 대조군은 **파일 단위**라, 정규식을 넓혀 같은 파일의 *다른* 지표가
   *    새로 보이자(education `avgLevel` · operational-stats `avgBillingAmount`) I4 의 봉합이
   *    되돌아온 것처럼 실패했다 — 실패 이유가 사실과 달랐다. 봉합한 **지표 이름**으로 좁힌다
   *    (좁히는 것이 완화가 아니도록, 대상이 0 이 되지 않게 아래에서 개수를 확인한다).
   */
  it('🔴 I4·J3 가 봉합한 지표는 목록에 없다(되돌아오면 실패한다)', () => {
    const sealed: [string, string][] = [
      // I4
      ['emergency/emergency.service.ts', 'avgWaitingTime'],
      ['emergency/emergency.service.ts', 'avgTreatmentTime'],
      ['emergency/emergency.service.ts', 'dischargeRate'],
      ['emergency/emergency.service.ts', 'admissionRate'],
      ['operational-stats/operational-stats.service.ts', 'dischargeRate'],
      ['concierge/concierge.service.ts', 'avgRating'],
      ['radiation/radiation.service.ts', 'completionRate'],
      ['education/education.service.ts', 'achievementRate'],
      // J3
      ['obgyn/obgyn.service.ts', 'cesareanRate'],
      ['nutrition/nutrition-advanced.service.ts', 'calorieRate'],
      ['satisfaction/satisfaction.service.ts', 'avgScore'],
      ['schedule/schedule.service.ts', 'noShowRate'],
      ['orchestrator/enterprise-tools.ts', 'rate'],
      ['qi/qi.service.ts', 'avgStay'],
      ['qi/qi.service.ts', 'avgLos'],
      ['qi/qi.service.ts', 'avgOp'],
      // L4
      ['bed/bed-board.service.ts', 'avgLos'],
      ['checkup/checkup-station.service.ts', 'avgMinutes'],
      ['checkup/checkup-contract.service.ts', 'progressPct'],
      ['education/education.service.ts', 'avgLevel'],
      ['consult/consult.service.ts', 'closeRate'],
      ['order-set/order-set.service.ts', 'modificationRate'],
      ['operational-stats/operational-stats.service.ts', 'avgBillingAmount'],
      ['journey-console/journey-console.service.ts', 'avgStayDays'],
      ['journey-console/journey-console.service.ts', 'avgWaitMin'],
      ['journey-console/journey-analytics.service.ts', 'avgConsultMin'],
      ['journey-console/journey-analytics.service.ts', 'avgLosDays'],
      ['workgroup/workgroup.service.ts', 'avgWait'],
      ['workgroup/workgroup.service.ts', 'avgWaitMinutes'],
      ['floor/floor.service.ts', 'avgWait'],
      ['medical-ai/medical-ai.service.ts', 'badRate'],
      ['medical-ai/medical-ai.service.ts', 'satisfactionRate'],
      // H(2026-09-21)
      ['lab/qc.service.ts', 'zScore'],
      ['admission/admission.service.ts', 'fallRiskScore'],
      ['nutrition/nutrition-advanced.service.ts', 'percent'],
      ['questionnaire/questionnaire.service.ts', 'maxScore'],
      ['billing/billing.service.ts', 'nonCoveredRatio'],
      ['billing/billing.service.ts', '_avg'],
      ['crm/crm.service.ts', '_avg'],
      ['partner-request/partner-request.service.ts', '_avg'],
    ];
    expect(sealed.length, '대조군이 비면 이 검사는 아무것도 지키지 않는다').toBeGreaterThan(10);
    const seen = new Set(rows.map((r) => `${r.file}|${r.field}`));
    expect(sealed.filter(([f, k]) => seen.has(`${f}|${k}`))).toEqual([]);
  });

  /**
   * 🔴 (2026-09-17 L4) **이 대조군이 없으면 사각이 되돌아가도 아무도 실패하지 않는다.**
   *    L4 재주입에서 실측: 스캐너를 '한 줄의 첫 지표만' 보던 옛 동작으로 되돌려도 저장소 총계는 46 그대로였다
   *    (지금 한 줄에 지표가 둘인 자리가 남아 있지 않기 때문). 기준선은 **미래의 회귀를 못 잡는다** —
   *    스캐너 자신을 픽스처로 검사한다.
   */
  it('🔴 대조군 — 한 줄에 지표가 둘이면 둘 다 센다(첫 지표만 보던 사각)', () => {
    const line = 'return { avgFooRate: n ? 1 : 0, barScore: list.length ? 2 : 0 };';
    const fields = [...line.matchAll(/([A-Za-z_]*(?:Rate|Score)[A-Za-z_]*)\s*:/g)].map((m) => m[1]);
    expect(fields).toHaveLength(2); // 픽스처 자체 점검
    const dir = mkdtempSync(join(tmpdir(), 'mzf-'));
    try {
      writeFileSync(join(dir, 'x.ts'), `export function f(n: number, list: number[]) { ${line} }\n`);
      const found = scanMetricZeroFallbacks(dir);
      expect(found.map((r) => r.field).sort()).toEqual(['avgFooRate', 'barScore']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('🔴 대조군 — Prisma `_avg.x ?? 0` 도 센다(이름이 지표 계열이 아니어도)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mzf-'));
    try {
      writeFileSync(join(dir, 'y.ts'), 'export const v = (agg: { _avg: { dur: number | null } }) => Math.round(agg._avg.dur ?? 0);\n');
      const found = scanMetricZeroFallbacks(dir);
      expect(found).toHaveLength(1);
      expect(found[0].field).toBe('_avg');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  /**
   * 🔴 (2026-09-21 H) 사각 ⓓ 의 대조군. **기준선만으로는 이 사각의 회귀를 못 잡는다** —
   *    지금 저장소에서 이 부류를 다 봉합했다면 패스를 통째로 지워도 총계가 그대로다(L4 가 ⓐ에서 겪었다).
   *    스캐너 자신을 픽스처로 검사한다.
   */
  it('🔴 대조군 — 지표 이름에 걸린 `?? 0` / `|| 0` 을 센다(`_avg` 가 아니어도)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mzf-'));
    try {
      writeFileSync(join(dir, 'a.ts'), [
        'export const f = (na: { s?: number }) => ({',
        '  fallRiskScore: na.s ?? 0,',        // ← 세야 한다
        '  openRate: na.s || 0,',             // ← 세야 한다
        '});',
      ].join('\n'));
      const found = scanMetricZeroFallbacks(dir);
      expect(found.map((r) => r.field).sort()).toEqual(['fallRiskScore', 'openRate']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  /**
   * 🔴 같은 패스의 **반대쪽 대조군** — "성공하면 실패로 말하지 않는다".
   *    `?? 0.3` 같은 기본 비율은 표본 폴백이 아니다. 경계만(`0\b`) 쓰면 `0.3` 의 `0` 이 걸려
   *    오탐이 쏟아진다(이 축 첫 판이 실제로 그랬다 — eligibility·ess·nutrition·inpatient 가 걸렸다).
   */
  it('🔴 대조군 — `?? 0.3` 같은 기본 상수는 세지 않는다(오탐 방지)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mzf-'));
    try {
      writeFileSync(join(dir, 'b.ts'), 'export const rate = (x?: number) => x ?? 0.3;\nexport const ratio2 = (y?: number) => y ?? 0.33;\n');
      expect(scanMetricZeroFallbacks(dir)).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  /**
   * 🔴 (2026-09-21 H) 사각 ⓔ 의 대조군 — prettier 가 접은 삼항.
   *    lab QC 의 z-score 가 이 모양이라, 목표 SD 미설정 건에 `PASS` 가 찍히는데도 기준선 밖이었다.
   */
  it('🔴 대조군 — 여러 줄로 접힌 삼항의 `: 0` 도 센다(줄 단위 사각)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mzf-'));
    try {
      writeFileSync(join(dir, 'c.ts'), [
        'export function g(sd: number, v: number, m: number) {',
        '  const zScore = sd !== 0',
        '    ? (v - m) / sd',
        '    : 0;',
        '  return zScore;',
        '}',
      ].join('\n'));
      const found = scanMetricZeroFallbacks(dir);
      expect(found).toHaveLength(1);
      expect(found[0].field).toBe('zScore');
      expect(found[0].line, '위반 줄이 아니라 **지표가 선언된 줄**을 가리킨다').toBe(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('대조군 — 스캐너가 주석·문자열·정규식을 코드로 읽지 않는다', () => {
    const src = [
      '// completionRate: total > 0 ? x : 0',
      'const msg = "avgScore: 0";',
      'const re = /rate: 0/;',
      'const real = { avgScore: list.length ? 1 : 0 };',
    ].join('\n');
    const stripped = stripForScan(src);
    expect(stripped).not.toContain('completionRate');
    expect(stripped).not.toContain('avgScore: 0');
    // 진짜 코드 한 줄은 남는다
    expect(stripped).toContain('avgScore');
  });
});
