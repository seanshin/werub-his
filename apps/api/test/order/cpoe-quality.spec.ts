/**
 * CPOE 질 지표(2026-10-07).
 *  · 분자·분모는 원장 필드로만 · 분모 0 = 산출 불가(null) · 공백 사유 = 사유 없음
 *  · 문제 건은 정의대로(NUM·REST·관찰 지표 null) · 소요 시간은 중앙값·p90·n(음수 소요 제외)
 *  · 의사는 본인 처방만(서버 강제) · 처방의별 표는 관리자 병원 전체에서만
 *  · 원장 연결 — 등재 지표만 목표 판정(정본 evaluateMeetTarget) · 미등재는 판정 없음
 *  · 월 기록 — 끝난 달만 · 미등재 404 · 값은 서버가 다시 센다(병원 전체)
 * 재주입: 위 규칙 하나를 되돌리면 실패한다.
 */
import { describe, it, expect, vi } from 'vitest';
import { CPOE_QI_DEFS, CPOE_QI_KEYS, pChart, qiSettingOf } from '@hospital-run/shared';
import { computeIndicators, computeTat, computeAckTimes, computeByPrescriber, countIndicator, type QiRx, type QiOrder, type QiCritical } from '../../src/modules/cpoe-quality/cpoe-quality.compute';
import { CpoeQualityService } from '../../src/modules/cpoe-quality/cpoe-quality.service';
import { resolveRegistryDirection } from '../../src/modules/quality/indicator-policy';

const T0 = new Date('2026-09-01T00:00:00+09:00');
const at = (day: number, h = 9) => new Date(T0.getTime() + day * 86_400_000 + h * 3_600_000);
let seq = 0;
const rx = (over: Partial<QiRx>): QiRx => ({
  id: `rx${++seq}`, type: 'MEDICATION', status: 'ACTIVE', priority: 'ROUTINE', orderSource: 'WRITTEN', durChecked: true, durWarnings: [],
  durOverridden: false, durOverrideReason: null, readBackConfirmedAt: null, prescriberCosignedAt: null, diagnosisCodeId: 'dx',
  discontinueReason: null, createdAt: at(1), prescriber: 'd1', patientId: 'p1', name: '아스피린', setting: 'OUTPATIENT', ...over,
});
const ord = (over: Partial<QiOrder>): QiOrder => ({
  id: `o${++seq}`, department: 'LAB', status: 'COMPLETED', priority: 'ROUTINE', createdAt: at(1), completedAt: at(1, 10),
  acknowledgedAt: at(1, 11), specimenCollectedAt: at(1, 9), prescriber: 'd1', patientId: 'p1', name: 'CBC', setting: 'OUTPATIENT', ...over,
});
const period = { from: T0, to: at(14, 0) };
const crit = (over: Partial<QiCritical>): QiCritical => ({
  id: `c${++seq}`, createdAt: at(1, 9), acknowledgedAt: at(1, 9.5), readBackConfirmed: true, prescriber: 'd1', patientId: 'p1', name: 'K', setting: 'UNKNOWN', ...over,
});
const data = (r: QiRx[], o: QiOrder[] = [], c: QiCritical[] = []) => ({ rx: r, orders: o, interventions: [], cdss: [], criticals: c });
const ind = (res: ReturnType<typeof computeIndicators>, k: string) => res.find((x) => x.key === k)!;

describe('CPOE 질 지표 — 산출', () => {
  it('정의와 산출 규칙이 1:1 · qiName 은 유일', () => {
    expect(CPOE_QI_DEFS.map((d) => d.key)).toEqual([...CPOE_QI_KEYS]);
    expect(new Set(CPOE_QI_DEFS.map((d) => d.qiName)).size).toBe(CPOE_QI_DEFS.length);
    expect(computeIndicators(data([]), period).map((r) => r.key)).toEqual([...CPOE_QI_KEYS]);
  });

  it('🔴 분모 0 은 산출 불가(null) — 0 이 아니다 · 대조군: 분모 있으면 값', () => {
    const empty = computeIndicators(data([]), period);
    expect(ind(empty, 'DUR_OVERRIDE_NO_REASON')).toMatchObject({ numerator: 0, denominator: 0, value: null });
    const r = computeIndicators(data([rx({ durWarnings: ['x'], durOverridden: true, durOverrideReason: '  ' }), rx({ durWarnings: ['y'], durOverridden: true, durOverrideReason: '신기능 확인' })]), period);
    expect(ind(r, 'DUR_OVERRIDE_NO_REASON')).toMatchObject({ numerator: 1, denominator: 2, value: 0.5 });
    expect(ind(r, 'DUR_OVERRIDE_RATE')).toMatchObject({ numerator: 2, denominator: 2 });
  });

  it('🔴 DUR 점검 수행률은 약 처방만 분모 · 문제 건은 점검 안 한 처방(REST)', () => {
    const missing = rx({ durChecked: false });
    const r = computeIndicators(data([rx({}), missing, rx({ type: 'LAB', durChecked: false })]), period);
    const d = ind(r, 'DUR_CHECK_RATE');
    expect(d).toMatchObject({ numerator: 1, denominator: 2 });
    expect(d.offenders!.items.map((i) => i.id)).toEqual([missing.id]);
  });

  it('🔴 구두 처방 — 복창·서명 미기록 · 취소된 구두 처방은 서명 대기 분모에서 뺀다 · 관찰 지표는 문제 건 없음', () => {
    const r = computeIndicators(data([
      rx({ orderSource: 'VERBAL' }), rx({ orderSource: 'TELEPHONE', readBackConfirmedAt: at(1), prescriberCosignedAt: at(2) }),
      rx({ orderSource: 'VERBAL', status: 'CANCELLED' }), rx({}),
    ]), period);
    expect(ind(r, 'VERBAL_RATE')).toMatchObject({ numerator: 3, denominator: 4, offenders: null });
    expect(ind(r, 'VERBAL_NO_READBACK')).toMatchObject({ numerator: 2, denominator: 3 });
    expect(ind(r, 'VERBAL_UNCOSIGNED')).toMatchObject({ numerator: 1, denominator: 2 });
  });

  it('🔴 상병 미연결은 취소 처방을 빼고 · 중단 사유는 중단 처방만', () => {
    const r = computeIndicators(data([
      rx({ diagnosisCodeId: null }), rx({ diagnosisCodeId: null, status: 'CANCELLED' }),
      rx({ status: 'DISCONTINUED', discontinueReason: '' }), rx({ status: 'DISCONTINUED', discontinueReason: '부작용' }),
    ]), period);
    expect(ind(r, 'NO_DIAGNOSIS')).toMatchObject({ numerator: 1, denominator: 3 });
    expect(ind(r, 'DISCONTINUE_NO_REASON')).toMatchObject({ numerator: 1, denominator: 2 });
    expect(ind(r, 'RX_CANCEL_RATE')).toMatchObject({ numerator: 1, denominator: 4 });
  });

  it('🔴 결과 미확인은 결과 나온 검사·영상만(약국·미완료 제외) · 채취 시각은 검사만', () => {
    const r = computeIndicators(data([], [
      ord({ acknowledgedAt: null }), ord({ department: 'IMAGING', specimenCollectedAt: null }), ord({ department: 'PHARMACY', acknowledgedAt: null }),
      ord({ status: 'IN_PROGRESS', acknowledgedAt: null, completedAt: null }), ord({ specimenCollectedAt: null }),
    ]), period);
    expect(ind(r, 'RESULT_UNACK')).toMatchObject({ numerator: 1, denominator: 3 });
    expect(ind(r, 'SPECIMEN_TIME_RECORDED')).toMatchObject({ numerator: 1, denominator: 2 });
  });

  it('주별 추이 — 7일 칸에 분자·분모', () => {
    const r = computeIndicators(data([rx({ createdAt: at(1), diagnosisCodeId: null }), rx({ createdAt: at(8) })]), period);
    expect(ind(r, 'NO_DIAGNOSIS').trend.map((t) => [t.numerator, t.denominator])).toEqual([[1, 1], [0, 1]]);
  });

  it('🔴 소요 시간 — STAT/일반 분리 · 미완료·음수 소요는 표본 아님 · 표본 0 은 null', () => {
    const cells = computeTat([
      ord({ priority: 'STAT', createdAt: at(1, 9), completedAt: at(1, 10) }),
      ord({ priority: 'STAT', createdAt: at(1, 9), completedAt: at(1, 12) }),
      ord({ priority: 'STAT', createdAt: at(1, 9), completedAt: at(1, 8) }), // 시드 결함 — 완료가 발행보다 이르다
      ord({ priority: 'STAT', status: 'IN_PROGRESS', completedAt: null }),
    ]);
    expect(cells.find((c) => c.department === 'LAB' && c.priority === 'STAT')).toMatchObject({ median: 60, p90: 180, n: 2 });
    expect(cells.find((c) => c.department === 'IMAGING' && c.priority === 'STAT')).toMatchObject({ median: null, n: 0 });
  });

  it('처방의별 — 처방의 없는 행은 세지 않는다 · 결과 미확인은 오더 처방의로', () => {
    const rows = computeByPrescriber(data(
      [rx({ prescriber: 'd1', durOverridden: true }), rx({ prescriber: 'd2', orderSource: 'VERBAL' }), rx({ prescriber: null })],
      [ord({ prescriber: 'd2', acknowledgedAt: null })],
    ));
    expect(rows.map((r) => [r.prescriber, r.prescriptions, r.durOverrideNoReason, r.verbalUncosigned, r.resultUnack])).toEqual([['d1', 1, 1, 0, 0], ['d2', 1, 0, 1, 1]]);
  });

  it('방향 등재 — 분명한 것만(사유 미기록=낮을수록) · 관찰 지표는 코드 등재표에 없다', () => {
    expect(resolveRegistryDirection('CPOE DUR 무시 사유 미기록률')).toEqual({ direction: 'LOWER_IS_BETTER', source: 'REGISTRY' });
    expect(resolveRegistryDirection('CPOE DUR 점검 수행률')).toEqual({ direction: 'HIGHER_IS_BETTER', source: 'REGISTRY' });
    expect(resolveRegistryDirection('CPOE DUR 경고 무시율').source).not.toBe('REGISTRY');
  });
});

function mkSvc(opts: { ledger?: unknown[]; rx?: unknown[]; crit?: unknown[] } = {}) {
  const prisma: any = {
    prescription: { findMany: vi.fn(async () => opts.rx ?? []) },
    order: { findMany: vi.fn(async () => []) },
    pharmacistIntervention: { findMany: vi.fn(async () => []) },
    criticalValueAlert: { findMany: vi.fn(async () => opts.crit ?? []) },
    encounter: { findMany: vi.fn(async () => []) },
    cdssLog: { findMany: vi.fn(async () => []) },
    qualityIndicator: { findMany: vi.fn(async () => opts.ledger ?? []) },
    patient: { findMany: vi.fn(async () => []) },
    user: { findMany: vi.fn(async () => []) },
  };
  const quality: any = { addMeasurement: vi.fn(async (d: unknown) => ({ id: 'm1', ...(d as object) })) };
  return { svc: new CpoeQualityService(prisma, quality), prisma, quality };
}
const dbRx = (over: Record<string, unknown> = {}) => ({
  id: 'r1', type: 'MEDICATION', status: 'ACTIVE', priority: 'ROUTINE', orderSource: 'WRITTEN', durChecked: true, durWarnings: [],
  durOverridden: false, durOverrideReason: null, readBackConfirmedAt: null, prescriberCosignedAt: null, diagnosisCodeId: null,
  discontinueReason: null, createdAt: new Date('2026-09-10T01:00:00Z'), prescriberId: null, createdBy: 'd1',
  encounter: { patientId: 'p1', visitType: 'OUTPATIENT', admissionId: null }, medicationCode: { nameKo: '약' }, procedureCode: null, ...over,
});
const NOW = new Date('2026-10-07T03:00:00Z');

describe('CPOE 질 지표 — 범위·원장 연결·월 기록', () => {
  it('🔴 의사는 본인 처방만 — 쿼리로 다른 처방의를 넘겨도 본인 · 처방의별 표 없음', async () => {
    const { svc, prisma } = mkSvc();
    const r = await svc.getQuality({ prescriberId: '00000000-0000-4000-8000-000000000099' }, { id: 'me', role: 'DOCTOR' }, NOW);
    expect(prisma.prescription.findMany.mock.calls[0][0].where.OR).toEqual([{ prescriberId: 'me' }, { prescriberId: null, createdBy: 'me' }]);
    expect(prisma.cdssLog.findMany.mock.calls[0][0].where.doctorId).toBe('me');
    expect(r.scope).toEqual({ prescriberId: 'me', hospitalWide: false });
    expect(r.byPrescriber).toBeNull();
  });

  it('대조군 — 관리자 병원 전체는 처방의 조건 없음 · 처방의별 표 있음', async () => {
    const { svc, prisma } = mkSvc({ rx: [dbRx()] });
    const r = await svc.getQuality({}, { id: 'a', role: 'ADMIN' }, NOW);
    expect(prisma.prescription.findMany.mock.calls[0][0].where.OR).toBeUndefined();
    expect(r.byPrescriber!.map((p) => p.prescriber)).toEqual(['d1']);
  });

  it('🔴 원장 등재 지표만 목표 판정 — 정본 방향·배율 · 미등재는 판정 없음', async () => {
    const { svc } = mkSvc({
      rx: [dbRx(), dbRx({ id: 'r2', diagnosisCodeId: 'dx' })],
      ledger: [{ id: 'qi1', name: 'CPOE 처방 상병 미연결률', category: 'CPOE', formula: '…×100', targetValue: 10, direction: null, unit: '%', valueScale: 100, measurements: [{ period: '2026-08', value: 12.5, meetTarget: false }] }],
    });
    const r = await svc.getQuality({}, { id: 'a', role: 'ADMIN' }, NOW);
    const nd = r.indicators.find((i) => i.key === 'NO_DIAGNOSIS')!;
    expect(nd.qi).toMatchObject({ registered: true, indicatorId: 'qi1', target: 10, direction: 'LOWER_IS_BETTER', current: { value: 50, meetTarget: false }, latest: { period: '2026-08' } });
    const other = r.indicators.find((i) => i.key === 'DUR_OVERRIDE_RATE')!;
    expect(other.qi.registered).toBe(false);
    expect((other.qi as { current?: unknown }).current).toBeUndefined();
  });

  it('기간 — 기본 30일 · 시작>종료 400 · 366일 초과 400 · 형식 오류 400', async () => {
    const { svc } = mkSvc();
    const p = svc.resolvePeriod(undefined, undefined, NOW);
    expect((p.to.getTime() - p.from.getTime()) / 86_400_000).toBe(30);
    expect(() => svc.resolvePeriod('2026-10-05', '2026-10-01')).toThrow(/늦습니다/);
    expect(() => svc.resolvePeriod('2025-01-01', '2026-10-01')).toThrow(/366/);
    expect(() => svc.resolvePeriod('2026-13-01', '2026-10-01')).toThrow();
  });

  it('🔴 월 기록 — 끝나지 않은 달 거절 · 미등재 404 · 값은 서버가 병원 전체로 다시 센다', async () => {
    const ledger = [{ id: 'qi1', name: 'CPOE 처방 상병 미연결률', category: 'CPOE', formula: '', targetValue: 10, direction: null, unit: null, valueScale: 100, measurements: [] }];
    await expect(mkSvc({ ledger }).svc.recordMonth('NO_DIAGNOSIS', '2026-10', NOW)).rejects.toThrow(/끝나지 않은 달/);
    await expect(mkSvc().svc.recordMonth('NO_DIAGNOSIS', '2026-09', NOW)).rejects.toMatchObject({ response: { code: 'CPOE_QI_NOT_REGISTERED' } });
    const { svc, quality, prisma } = mkSvc({ ledger, rx: [dbRx(), dbRx({ id: 'r2', diagnosisCodeId: 'dx' }), dbRx({ id: 'r3' })] });
    const r = await svc.recordMonth('NO_DIAGNOSIS', '2026-09', NOW);
    expect(quality.addMeasurement).toHaveBeenCalledWith(expect.objectContaining({ indicatorId: 'qi1', period: '2026-09', numerator: 2, denominator: 3, source: 'CPOE', computedBy: 'cpoe-quality:NO_DIAGNOSIS' }));
    // 근거 — 다시 센 창과 원장을 함께 남긴다
    expect(quality.addMeasurement.mock.calls.at(-1)[0].evidence).toMatchObject({ key: 'NO_DIAGNOSIS', window: expect.any(Object) });
    expect(r).toMatchObject({ numerator: 2, denominator: 3 });
    expect(prisma.prescription.findMany.mock.calls[0][0].where.OR).toBeUndefined();
    const range = prisma.prescription.findMany.mock.calls[0][0].where.createdAt;
    expect(range.gte.getMonth()).toBe(8);
    expect(range.lt.getMonth()).toBe(9);
  });

  it('countIndicator 와 화면 산출이 같은 수', () => {
    const d = data([rx({ diagnosisCodeId: null }), rx({})]);
    expect(countIndicator('NO_DIAGNOSIS', d)).toEqual({ numerator: 1, denominator: 2 });
    expect(ind(computeIndicators(d, period), 'NO_DIAGNOSIS')).toMatchObject({ numerator: 1, denominator: 2 });
  });
});

describe('CPOE 질 지표 — 심화(위급값·층화·확인 소요·관리도)', () => {
  it('🔴 위급값 — 미확인(통보 중 확인 없음) · 복창 미기록은 확인된 것만 분모', () => {
    const r = computeIndicators(data([], [], [crit({}), crit({ acknowledgedAt: null }), crit({ readBackConfirmed: false })]), period);
    expect(ind(r, 'CRITICAL_UNACK')).toMatchObject({ numerator: 1, denominator: 3 });
    expect(ind(r, 'CRITICAL_NO_READBACK')).toMatchObject({ numerator: 1, denominator: 2 });
    expect(ind(r, 'CRITICAL_UNACK').offenders!.items[0].kind).toBe('CRITICAL');
  });

  it('🔴 진료 유형 — 그 진료 기록 기준 · 미기록은 UNKNOWN(외래로 짐작하지 않는다)', () => {
    expect(qiSettingOf({ visitType: 'ER_CONSULT' })).toBe('ER');
    expect(qiSettingOf({ visitType: 'OUTPATIENT', admissionId: 'a1' })).toBe('INPATIENT');
    expect(qiSettingOf({ visitType: 'INPATIENT_CONSULT' })).toBe('INPATIENT');
    expect(qiSettingOf({ visitType: 'OUTPATIENT' })).toBe('OUTPATIENT');
    expect(qiSettingOf({ visitType: null, admissionId: null })).toBe('UNKNOWN');
    expect(qiSettingOf(null)).toBe('UNKNOWN');
  });

  it('🔴 층화 — 진료 유형별·진료과별 분자·분모 합이 전체와 같다 · 진료과 미상은 null', () => {
    const r = computeIndicators(data([
      rx({ diagnosisCodeId: null, setting: 'INPATIENT', prescriber: 'd1' }), rx({ setting: 'INPATIENT', prescriber: 'd2' }),
      rx({ diagnosisCodeId: null, setting: 'UNKNOWN', prescriber: 'dx' }),
    ]), period, (id) => ({ d1: '내과', d2: '외과' } as Record<string, string>)[id ?? ''] ?? null);
    const nd = ind(r, 'NO_DIAGNOSIS');
    expect(nd.strata.setting.INPATIENT).toEqual({ numerator: 1, denominator: 2 });
    expect(nd.strata.setting.UNKNOWN).toEqual({ numerator: 1, denominator: 1 });
    expect(nd.strata.setting.OUTPATIENT).toEqual({ numerator: 0, denominator: 0 });
    expect(nd.strata.department).toEqual(expect.arrayContaining([{ department: '내과', numerator: 1, denominator: 1 }, { department: null, numerator: 1, denominator: 1 }]));
    const sum = Object.values(nd.strata.setting).reduce((a, c) => a + c.denominator, 0);
    expect(sum).toBe(nd.denominator);
  });

  it('🔴 확인 소요 — 확인된 것만 표본 · 음수 제외 · 표본 0 은 null', () => {
    const t = computeAckTimes(data([], [ord({ completedAt: at(1, 10), acknowledgedAt: at(1, 12) }), ord({ acknowledgedAt: null }), ord({ completedAt: at(1, 10), acknowledgedAt: at(1, 9) })], []));
    expect(t.find((x) => x.kind === 'RESULT')).toMatchObject({ median: 120, n: 1 });
    expect(t.find((x) => x.kind === 'CRITICAL')).toMatchObject({ median: null, n: 0 });
  });

  it('🔴 p 관리도 — 진행 중인 달은 중심선에서 제외 · 분모 0 달은 점 없음 · 한계 밖 신호', () => {
    const pts = [...Array(6)].map((_, i) => ({ period: `2026-0${i + 1}`, numerator: 10, denominator: 100 }));
    pts.push({ period: '2026-07', numerator: 40, denominator: 100 });
    pts.push({ period: '2026-08', numerator: 0, denominator: 0 });
    pts.push({ period: '2026-09', numerator: 90, denominator: 100, partial: true } as never);
    const c = pChart(pts);
    expect(c.basis).toEqual({ months: 7, numerator: 100, denominator: 700 });
    expect(c.center).toBeCloseTo(100 / 700);
    expect(c.points[6].signal).toBe('OUTSIDE');
    expect(c.points[0].signal).toBeNull();
    expect(c.points[7]).toMatchObject({ p: null, ucl: null, signal: null });
    expect(c.points[8].signal).toBeNull(); // 진행 중인 달은 신호를 내지 않는다
  });

  it('🔴 p 관리도 — 한쪽 8점 연속은 RUN · 7점은 아니다 · p̄ 0 이면 한계 없음(degenerate)', () => {
    const mk = (above: number) => [
      ...[...Array(above)].map((_, i) => ({ period: `a${i}`, numerator: 12, denominator: 100 })),
      ...[...Array(8)].map((_, i) => ({ period: `b${i}`, numerator: 8, denominator: 100 })),
    ];
    expect(pChart(mk(8)).points.filter((p) => p.signal === 'RUN').length).toBe(16);
    expect(pChart(mk(7)).points.slice(0, 7).some((p) => p.signal === 'RUN')).toBe(false);
    const z = pChart([{ period: 'x', numerator: 0, denominator: 50 }]);
    expect(z).toMatchObject({ center: 0, degenerate: true });
    expect(z.points[0].ucl).toBeNull();
  });

  it('🔴 관리도 EP — 의사는 본인 · 이번 달은 partial · 원장 목표는 p 단위(배율로 나눔)', async () => {
    const ledger = [{ id: 'qi1', name: 'CPOE 처방 상병 미연결률', category: 'CPOE', formula: '', targetValue: 10, direction: null, unit: '%', valueScale: 100, measurements: [] }];
    const { svc, prisma } = mkSvc({ ledger, rx: [dbRx({ createdAt: new Date('2026-09-10T01:00:00Z') }), dbRx({ id: 'r2', diagnosisCodeId: 'dx', createdAt: new Date('2026-10-02T01:00:00Z') })] });
    const r = await svc.getSpc({ key: 'NO_DIAGNOSIS', months: 3, prescriberId: 'other' }, { id: 'me', role: 'DOCTOR' }, NOW);
    expect(prisma.prescription.findMany.mock.calls[0][0].where.OR[0]).toEqual({ prescriberId: 'me' });
    expect(r.chart.points.map((p) => [p.period, p.numerator, p.denominator, !!p.partial])).toEqual([['2026-08', 0, 0, false], ['2026-09', 1, 1, false], ['2026-10', 0, 1, true]]);
    expect(r.target).toEqual({ value: 0.1, direction: 'LOWER_IS_BETTER' });
  });

  it('처방의별 — 위급값 미확인은 담당의로', () => {
    const rows = computeByPrescriber(data([rx({ prescriber: 'd1' })], [], [crit({ prescriber: 'd1', acknowledgedAt: null })]));
    expect(rows[0].criticalUnack).toBe(1);
  });
});
