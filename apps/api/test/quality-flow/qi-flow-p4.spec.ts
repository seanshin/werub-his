/**
 * QI 흐름 남은 몫(2026-10-09) — 사람 결정 선택지를 기능으로.
 *  · 기구 삽입·제거 원장(결정 qi.deviceDays.source = DEVICE_LEDGER 의 원천) — 자정 규약 · 전수 기록 시작일 전엔 산출 불가
 *  · 병동 층 — 사고율을 병동별 재원일수로 · 병동 없는 사고는 어느 층에도 넣지 않는다
 * 재주입: 규칙 하나를 되돌리면 실패한다.
 */
import { describe, it, expect, vi } from 'vitest';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { IndicatorSupplierService, ledgerDeviceDays } from '../../src/modules/quality/indicator-supplier.service';
import { DeviceLineService } from '../../src/modules/quality-flow/device-line.service';
import { MonthCloseService } from '../../src/modules/quality-flow/month-close.service';
import { DECISION_REGISTRY } from '../../src/modules/decision-registry/decision.registry';
import { DEFAULTS } from '../../src/modules/config/config-runtime.service';

const cfg = (m: Record<string, unknown>) => ({ get: vi.fn(async (k: string) => (k in m ? m[k] : null)) });
const SEP = { from: new Date(2026, 8, 1), to: new Date(2026, 9, 1) };
const at = (d: number, h = 0, m = 0) => new Date(2026, 8, d, h, m);

describe('원장 기구일수 — 자정 규약', () => {
  it('🔴 그날 자정(다음 날 0시)에 꽂혀 있는 기구만 센다', () => {
    // 1일 10시 삽입 → 2일 0시부터 5일 0시까지 4번 · 4일 23시 제거 → 5일 0시엔 없음
    expect(ledgerDeviceDays([{ insertedAt: at(1, 10), removedAt: at(4, 23) }], SEP)).toBe(3);
    // 같은 날 넣고 뺀 것은 0
    expect(ledgerDeviceDays([{ insertedAt: at(3, 8), removedAt: at(3, 20) }], SEP)).toBe(0);
    // 제거 없음 = 월말까지(1일 10시 삽입 → 2일 0시 ~ 10월 1일 0시 = 30)
    expect(ledgerDeviceDays([{ insertedAt: at(1, 10), removedAt: null }], SEP)).toBe(30);
    // 기간 전 삽입·기간 중 계속 = 30
    expect(ledgerDeviceDays([{ insertedAt: new Date(2026, 7, 20), removedAt: null }], SEP)).toBe(30);
  });
});

describe('공급원 — 기구 원장 분기', () => {
  const prisma = (rows: unknown[] = []) => ({ haiCase: { count: vi.fn(async () => 1) }, deviceLine: { findMany: vi.fn(async () => rows) } });
  it('🔴 전수 기록 시작일 미설정이면 산출 불가(일부만 기록된 원장을 분모로 쓰지 않는다)', async () => {
    const svc = new IndicatorSupplierService(prisma() as never, cfg({ 'qi.deviceDays.source': 'DEVICE_LEDGER' }) as never);
    expect(await svc.supply('CLABSI_RATE', SEP)).toMatchObject({ available: false, reason: 'DEVICE_LEDGER_COVERAGE_UNSET', numerator: 1 });
  });
  it('🔴 시작일 이전 기간도 산출 불가', async () => {
    const svc = new IndicatorSupplierService(prisma() as never, cfg({ 'qi.deviceDays.source': 'DEVICE_LEDGER', 'qi.deviceLedger.coverageFrom': '2026-09-15' }) as never);
    expect(await svc.supply('CLABSI_RATE', SEP)).toMatchObject({ available: false, reason: 'DEVICE_LEDGER_BEFORE_COVERAGE' });
  });
  it('대조군 — 시작일 이후면 원장에서 센다 · 무효 행은 쿼리에서 뺀다', async () => {
    const p = prisma([{ insertedAt: at(1, 10), removedAt: null }]);
    const svc = new IndicatorSupplierService(p as never, cfg({ 'qi.deviceDays.source': 'DEVICE_LEDGER', 'qi.deviceLedger.coverageFrom': '2026-09-01' }) as never);
    expect(await svc.supply('CLABSI_RATE', SEP)).toMatchObject({ available: true, numerator: 1, denominator: 30 });
    expect((p.deviceLine.findMany.mock.calls as unknown as Array<[{ where: Record<string, unknown> }]>)[0][0].where).toMatchObject({ deviceType: 'CENTRAL_LINE', voidedAt: null });
  });
  it('🔴 결정 선택지가 이 값을 집행 대상으로 든다 · 시작일 설정은 DEFAULTS 에 있다(미설정 기본)', () => {
    const d = DECISION_REGISTRY.find((x) => x.key === 'qi.deviceDays.source')!;
    const opt = d.options!.find((o) => o.value === 'DEVICE_LEDGER') as { enact?: { target?: { key?: string; newValue?: unknown } } };
    expect(opt.enact?.target).toEqual({ key: 'qi.deviceDays.source', newValue: 'DEVICE_LEDGER' });
    expect(DEFAULTS['qi.deviceLedger.coverageFrom'].value).toBeNull();
  });
});

describe('기구 원장 쓰기 규칙', () => {
  const mk = () => {
    const prisma = {
      patient: { findUnique: vi.fn(async () => ({ id: 'p1' })) },
      admission: { findUnique: vi.fn(async () => ({ patientId: 'p2' })) },
      deviceLine: {
        create: vi.fn(async (a: { data: unknown }) => a.data),
        findUnique: vi.fn(async () => ({ id: 'l1', insertedAt: at(5, 10), removedAt: null, voidedAt: null })),
        updateMany: vi.fn(async () => ({ count: 1 })),
      },
    };
    return { svc: new DeviceLineService(prisma as never), prisma };
  };
  it('🔴 미래 삽입 시각·다른 환자의 입원은 거부', async () => {
    const { svc } = mk();
    await expect(svc.record({ patientId: 'p1', deviceType: 'CENTRAL_LINE', insertedAt: new Date(Date.now() + 3_600_000).toISOString() }, 'u1')).rejects.toThrow(BadRequestException);
    await expect(svc.record({ patientId: 'p1', admissionId: 'a1', deviceType: 'CENTRAL_LINE', insertedAt: at(5).toISOString() }, 'u1')).rejects.toMatchObject({ response: { code: 'DEVICE_LINE_ADMISSION' } });
    await expect(svc.record({ patientId: 'p1', deviceType: 'PICC', insertedAt: at(5).toISOString() }, 'u1')).rejects.toMatchObject({ response: { code: 'DEVICE_LINE_TYPE' } });
  });
  it('🔴 제거는 삽입 이후 · 한 번(조건부) — 동시 두 번이면 409', async () => {
    const { svc, prisma } = mk();
    await expect(svc.remove('l1', { removedAt: at(4).toISOString() }, 'u1')).rejects.toMatchObject({ response: { code: 'DEVICE_LINE_ORDER' } });
    await svc.remove('l1', { removedAt: at(6).toISOString() }, 'u1');
    expect((prisma.deviceLine.updateMany.mock.calls as unknown as Array<[{ where: unknown }]>)[0][0].where).toEqual({ id: 'l1', removedAt: null, voidedAt: null });
    prisma.deviceLine.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(svc.remove('l1', { removedAt: at(6).toISOString() }, 'u1')).rejects.toThrow(ConflictException);
  });
  it('🔴 무효는 사유 5자 이상 · 지우지 않는다', async () => {
    const { svc, prisma } = mk();
    await expect(svc.void('l1', '짧음', 'u1')).rejects.toThrow(BadRequestException);
    await svc.void('l1', '다른 환자에 잘못 기록', 'u1');
    expect((prisma.deviceLine as Record<string, unknown>).delete).toBeUndefined();
  });
});

describe('병동 층', () => {
  const mk = (incidents: Array<{ wardId: string | null; _count: { _all: number } }>, basis: string | null = 'PATIENT_DAYS') => {
    const prisma = {
      patientDaySnapshot: {
        findMany: vi.fn(async () => Array.from({ length: 30 }, (_, i) => ({ date: new Date(Date.UTC(2026, 8, i + 1)), patientDays: 10 }))),
        groupBy: vi.fn(async () => [{ wardKey: 'w1', _sum: { patientDays: 200 } }, { wardKey: 'w2', _sum: { patientDays: 100 } }]),
      },
      safetyIncident: { groupBy: vi.fn(async () => incidents) },
    };
    return new IndicatorSupplierService(prisma as never, cfg({ 'qi.autoMeasure.incidentDenominator': basis }) as never);
  };
  it('🔴 병동 없는 사고는 어느 층에도 넣지 않고 수만 센다', async () => {
    const r = await mk([{ wardId: 'w1', _count: { _all: 2 } }, { wardId: null, _count: { _all: 5 } }]).supplyWardStrata('FALL_RATE', SEP);
    expect(r.strata).toEqual([{ wardKey: 'w1', numerator: 2, denominator: 200 }, { wardKey: 'w2', numerator: 0, denominator: 100 }]);
    expect(r.unassignedIncidents).toBe(5);
  });
  it('🔴 분모 기준이 재원일수가 아니면 층을 내지 않는다', async () => {
    expect((await mk([], 'ADMISSIONS').supplyWardStrata('FALL_RATE', SEP)).reason).toBe('DENOMINATOR_UNSET');
    expect((await mk([]).supplyWardStrata('HAND_HYGIENE', SEP)).reason).toBe('NOT_STRATIFIABLE');
  });
  it('월 마감이 층을 stratumKey 로 따로 기록하고, 층 실패가 병원 전체 칸을 산출 불가로 바꾸지 않는다', async () => {
    const quality = {
      addMeasurement: vi.fn(async (d: { stratumKey?: string }) => { if (d.stratumKey === 'w2') throw Object.assign(new Error('x'), { response: { code: 'BOOM' } }); return {}; }),
      precedence: vi.fn(async () => 'BOTH'),
    };
    const svc = new MonthCloseService(
      { qualityIndicator: { findMany: vi.fn(async () => [{ id: 'i1', name: '낙상발생률', targetValue: 1, direction: 'LOWER_IS_BETTER', unit: '‰', valueScale: 1000, isActive: true, ownerId: null }]) }, qiMeasurement: { findMany: vi.fn(async () => []) } } as never,
      quality as never,
      {
        monthRange: () => SEP, supplierOf: () => 'FALL_RATE',
        supply: vi.fn(async () => ({ available: true, supplierKey: 'FALL_RATE', numerator: 3, denominator: 300, evidence: {} })),
        supplyWardStrata: vi.fn(async () => ({ strata: [{ wardKey: 'w1', numerator: 2, denominator: 200 }, { wardKey: 'w2', numerator: 1, denominator: 100 }], unassignedIncidents: 0, reason: null })),
      } as never,
      { recordMonth: vi.fn(async () => ({})) } as never,
      cfg({}) as never, { emit: vi.fn() } as never,
    );
    const r = await svc.closeMonth('2026-09', { trigger: 'MANUAL' });
    expect(quality.addMeasurement).toHaveBeenCalledWith(expect.objectContaining({ stratumKey: 'w1', source: 'AUTO' }));
    expect(r.recorded).toHaveLength(1);
    expect(r.unavailable).toEqual([]);
    expect(r.strata[0]).toMatchObject({ recorded: 1, reason: 'BOOM' });
  });
});
