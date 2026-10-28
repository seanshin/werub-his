/**
 * 재원일수 정본 수렴(2026-10-01 · 여정 P1 잔여 · `patient-journey-model.plan.md` §5.10 지표 정의서).
 *
 * 🔴 같은 "평균 재원일수"를 다섯 곳(여정 지표·의료질·운영 통계·흐름 분석·경영 KPI)이 **각자 소수 일**로 계산했다 —
 *    환자 화면의 재원일수는 정본 `stayDays`(max(1,ceil))라 당일 퇴원 1건이 상세 1일·평균 0.3일로 갈렸다(P12).
 *    운영 통계는 분자(퇴원일 있는 행)와 분모(DISCHARGED 수)가 다른 집합이었고 표본 0 이면 `0` 이었다(P1).
 *    여정 지표는 모집단이 기간 안 **입원**이라 정의서(기간 안 **퇴원**)와 달랐다.
 *
 * 지키는 것: 개별 값은 stayDays · 퇴원<입원·날짜 없음은 빼고 센다 · 표본 0 = null · 손으로 짠 소수 일 재원 계산이 되살아나지 않는다.
 * 재주입: summarizeStayDays 를 쓰던 자리에 소수 일 계산을 되돌리면 구조 가드가 실패한다.
 */
import 'reflect-metadata';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { summarizeStayDays, stayDays } from '@hospital-run/shared';
import { JourneyService } from '../../src/modules/journey/journey.service';
import { OperationalStatsService } from '../../src/modules/operational-stats/operational-stats.service';

const d = (s: string) => new Date(s);

describe('summarizeStayDays — 개별 값은 정본 stayDays', () => {
  it('🔴 당일 퇴원은 1일(소수 일 0.3 이 아니다) · 평균은 개별 값의 평균', () => {
    const r = summarizeStayDays([
      { admitDate: d('2026-09-01T09:00:00Z'), dischargeDate: d('2026-09-01T16:00:00Z') }, // 7시간
      { admitDate: d('2026-09-01T09:00:00Z'), dischargeDate: d('2026-09-03T10:00:00Z') }, // 2일 1시간 → 3
    ]);
    expect(r.values).toEqual([1, 3]);
    expect(r.values[0]).toBe(stayDays(d('2026-09-01T09:00:00Z'), d('2026-09-01T16:00:00Z')));
    expect(r.meanDays).toBe(2);
    expect(r.n).toBe(2);
  });

  it('🔴 퇴원<입원·날짜 없음은 1일로 감싸 섞지 않고 빼고 센다', () => {
    const r = summarizeStayDays([
      { admitDate: d('2026-09-05T00:00:00Z'), dischargeDate: d('2026-09-01T00:00:00Z') },
      { admitDate: d('2026-09-01T00:00:00Z'), dischargeDate: null },
      { admitDate: d('2026-09-01T00:00:00Z'), dischargeDate: d('2026-09-11T00:00:00Z') },
    ]);
    expect(r.values).toEqual([10]);
    expect(r.excluded).toEqual({ missingDates: 1, dischargeBeforeAdmit: 1 });
  });

  it('표본 0 이면 평균 null(0 일이 아니다) · 평균 자릿수는 정책 stayDaysMean(소수 1)', () => {
    expect(summarizeStayDays([]).meanDays).toBeNull();
    const r = summarizeStayDays([
      { admitDate: d('2026-09-01T00:00:00Z'), dischargeDate: d('2026-09-02T00:00:00Z') }, // 1
      { admitDate: d('2026-09-01T00:00:00Z'), dischargeDate: d('2026-09-03T00:00:00Z') }, // 2
      { admitDate: d('2026-09-01T00:00:00Z'), dischargeDate: d('2026-09-03T00:00:00Z') }, // 2
    ]);
    expect(r.meanDays).toBe(1.7);
  });
});

describe('여정 지표 — 지표 정의서 §5.10: 기간 안 퇴원한 입원', () => {
  function prisma(rows: { admitDate: Date; dischargeDate: Date | null }[]) {
    const findMany = vi.fn(async ({ where }: { where: Record<string, any> }) => {
      if (where.dischargeDate && where.status === 'DISCHARGED' && !where.patientId) return rows.map((r) => ({ ...r, patientId: 'p1' }));
      return [];
    });
    return {
      findMany,
      p: { waitingQueue: { findMany: vi.fn(async () => []) }, emergencyVisit: { count: vi.fn(async () => 0), findMany: vi.fn(async () => []) }, billing: { findMany: vi.fn(async () => []) }, admission: { findMany } },
    };
  }

  it('🔴 모집단은 퇴원일이 기간 안 · 개별 stayDays 평균 · 제외 수를 낸다', async () => {
    const { p, findMany } = prisma([
      { admitDate: d('2026-08-20T00:00:00Z'), dischargeDate: d('2026-09-02T12:00:00Z') }, // 13.5 → 14
      { admitDate: d('2026-09-10T08:00:00Z'), dischargeDate: d('2026-09-10T15:00:00Z') }, // 당일 → 1
      { admitDate: d('2026-09-12T00:00:00Z'), dischargeDate: d('2026-09-11T00:00:00Z') }, // 역전 → 제외
    ]);
    const r = await new JourneyService(p as never, {} as never).getMetrics({ from: '2026-09-01', to: '2026-09-30' });
    const losCall = findMany.mock.calls.find((c) => c[0].select?.admitDate && !c[0].where.patientId)![0];
    expect(losCall.where.dischargeDate, '모집단 = 기간 안 퇴원').toBeTruthy();
    expect(losCall.where.admitDate, '기간 안 입원으로 거르면 장기 재원 퇴원이 빠진다').toBeUndefined();
    expect(r.avgLengthOfStayDays).toBe(7.5);
    expect(r.admissionSampleN).toBe(2);
    expect(r.lengthOfStayExcluded).toEqual({ missingDates: 0, dischargeBeforeAdmit: 1 });
  });
});

describe('운영 통계 — 평균 재원일수', () => {
  it('🔴 퇴원 0건이면 null(종전 0) · 분자·분모가 같은 집합(DISCHARGED 만)', async () => {
    const mk = (rows: unknown[]) => new OperationalStatsService({ admission: { findMany: vi.fn(async () => rows) } } as never);
    const none = await mk([{ admitDate: d('2026-09-01T00:00:00Z'), dischargeDate: null, status: 'ADMITTED' }]).getAdmissionTrends('2026-09-01', '2026-09-30');
    expect(none.avgStayDays).toBeNull();
    const r = await mk([
      { admitDate: d('2026-09-01T00:00:00Z'), dischargeDate: d('2026-09-05T00:00:00Z'), status: 'DISCHARGED' }, // 4
      // 취소인데 퇴원일이 남은 행 — 종전엔 분자에 들어가고 분모엔 안 들어갔다
      { admitDate: d('2026-09-01T00:00:00Z'), dischargeDate: d('2026-09-21T00:00:00Z'), status: 'CANCELLED' },
    ]).getAdmissionTrends('2026-09-01', '2026-09-30');
    expect(r.avgStayDays).toBe(4);
    expect(r.avgStayDaysSampleN).toBe(1);
  });
});

describe('구조 가드 — 손으로 짠 소수 일 재원 계산이 되살아나지 않는다', () => {
  const MODULES = join(__dirname, '../../src/modules');
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const n of readdirSync(dir)) {
      const p = join(dir, n);
      if (statSync(p).isDirectory()) walk(p);
      else if (p.endsWith('.ts') && !p.endsWith('.spec.ts')) files.push(p);
    }
  };
  walk(MODULES);
  // 퇴원 시각 − 입원 시각을 밀리초로 빼는 모양(한 줄 안) — 재원일수는 summarizeStayDays/stayDays 로만
  const RAW = /dischargeDate[^;\n]{0,40}getTime\(\)\s*-\s*[^;\n]{0,20}admitDate[^;\n]{0,20}getTime\(\)/;

  it('대조군 — 스캐너가 실제로 모듈 파일을 읽는다', () => {
    expect(files.length).toBeGreaterThan(500);
    expect(RAW.test('(a.dischargeDate!.getTime() - a.admitDate.getTime()) / 86400000')).toBe(true);
  });

  it('🔴 api 모듈 어디에도 없다', () => {
    const hits = files.filter((f) => RAW.test(readFileSync(f, 'utf8'))).map((f) => f.slice(MODULES.length + 1));
    expect(hits).toEqual([]);
  });

  it('평균 재원일수를 내는 다섯 곳이 정본을 부른다', () => {
    for (const f of ['journey/journey.service.ts', 'qi/qi.service.ts', 'operational-stats/operational-stats.service.ts', 'journey-console/journey-analytics.service.ts', 'executive/executive.service.ts']) {
      expect(readFileSync(join(MODULES, f), 'utf8'), f).toMatch(/summarizeStayDays\(/);
    }
  });
});
