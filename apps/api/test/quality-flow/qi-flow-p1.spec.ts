/**
 * 의료질관리 흐름 P1~P3(QI-FLOW-001 · 2026-10-08) — 끊어진 고리를 잇는다.
 *  측정 출처(수기·자동 병기) · 지표 공급원(원장 재집계) · 재원일수 분모 · 월 마감(측정→판정→경보)
 *  · 관리도 p/u · 일반 지표 PDCA · 정의 직접 수정 가드(결정) · 사고 검토 시각 · 보고서 위원회 제출 · 인증 자체 평가 · 기구일수
 * 🔴 사람 결정에 걸린 것은 결정 전엔 "산출 불가 + 이유"·"입력 닫힘"이다(지어내지 않는다).
 */
import { describe, it, expect, vi } from 'vitest';
import { BadRequestException, ConflictException } from '@nestjs/common';
import {
  pickPrimaryMeasurement, qiSourceKeyOf, uChart, qiChartKindFor, harmLevelsOf, allowedAccreditationFrameworks,
  normalizeQiPrecedence, qiSupplierByName,
} from '@hospital-run/shared';
import { IndicatorSupplierService } from '../../src/modules/quality/indicator-supplier.service';
import { QualityService } from '../../src/modules/quality/quality.service';
import { primaryPerPeriod, ACTIVE_MEASUREMENT } from '../../src/modules/quality/measurement-read';
import { MonthCloseService } from '../../src/modules/quality-flow/month-close.service';
import { PatientDaysService } from '../../src/modules/quality-flow/patient-days.service';
import { DeviceDaysService } from '../../src/modules/quality-flow/device-days.service';
import { AccreditationService } from '../../src/modules/quality-flow/accreditation.service';
import { QiReportService } from '../../src/modules/quality-flow/qi-report.service';
import { QiAgendaService } from '../../src/modules/quality-flow/qi-agenda.service';
import { CpoeImprovementService } from '../../src/modules/cpoe-quality/cpoe-improvement.service';
import { PatientSafetyService } from '../../src/modules/patient-safety/patient-safety.service';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { QI_FLOW_SETTING_KEYS } from '@hospital-run/shared';
import { DEFAULTS } from '../../src/modules/config/config-runtime.service';
import { DECISION_REGISTRY } from '../../src/modules/decision-registry/decision.registry';
import { QiFlowSettingsService } from '../../src/modules/quality-flow/qi-flow-settings.service';

const cfg = (m: Record<string, unknown>) => ({ get: vi.fn(async (k: string) => (k in m ? m[k] : null)) });
const SEP = { from: new Date(2026, 8, 1), to: new Date(2026, 9, 1) }; // 2026-09 (KST)

describe('shared 정본 — 출처·정본 행·관리도', () => {
  it('출처 칸 — AUTO·CPOE 는 자동 칸, 나머지(SEED·EXTERNAL 포함)는 수기 칸', () => {
    expect(qiSourceKeyOf('AUTO')).toBe('AUTO');
    expect(qiSourceKeyOf('CPOE')).toBe('AUTO');
    expect(qiSourceKeyOf('SEED')).toBe('MANUAL');
    expect(qiSourceKeyOf(null)).toBe('MANUAL');
  });
  it('🔴 BOTH = 수기 정본·자동 병기 · AUTO = 자동 정본 · 한쪽만 있으면 그 값', () => {
    const m = { sourceKey: 'MANUAL', v: 1 }; const a = { sourceKey: 'AUTO', v: 2 };
    expect(pickPrimaryMeasurement([a, m], 'BOTH')).toEqual({ primary: m, alternate: a });
    expect(pickPrimaryMeasurement([a, m], 'AUTO')).toEqual({ primary: a, alternate: m });
    expect(pickPrimaryMeasurement([a], 'BOTH')).toEqual({ primary: a, alternate: null });
    expect(pickPrimaryMeasurement([], 'BOTH')).toEqual({ primary: null, alternate: null });
    expect(normalizeQiPrecedence('엉뚱')).toBe('BOTH');
  });
  it('primaryPerPeriod — 기간별 하나 · 최신 기간 먼저', () => {
    const rows = [
      { period: '2026-08', sourceKey: 'MANUAL', value: 1 },
      { period: '2026-09', sourceKey: 'AUTO', value: 2 },
      { period: '2026-09', sourceKey: 'MANUAL', value: 3 },
    ];
    const out = primaryPerPeriod(rows, 'BOTH');
    expect(out.map((x) => [x.period, x.primary.value, x.alternate?.value ?? null])).toEqual([['2026-09', 3, 2], ['2026-08', 1, null]]);
  });
  it('🔴 u 관리도는 분자가 분모를 넘어도 한계를 [0,1]로 자르지 않는다 · 진행 중 달은 중심선에서 뺀다', () => {
    const pts = Array.from({ length: 6 }, (_, i) => ({ period: `2026-0${i + 1}`, numerator: 3, denominator: 1000 }));
    pts.push({ period: '2026-07', numerator: 30, denominator: 1000, partial: true } as never);
    const c = uChart(pts);
    expect(c.center).toBeCloseTo(0.003, 6);
    expect(c.basis.months).toBe(6);
    const big = uChart([{ period: 'a', numerator: 5, denominator: 2 }, { period: 'b', numerator: 6, denominator: 2 }]);
    expect(big.center).toBeGreaterThan(1);
    expect(big.points[0].ucl!).toBeGreaterThan(1);
  });
  it('관리도 종류 — 손위생은 p · 사고·감염은 u · 공급원 없으면 비율이고 배율 100 일 때만 p', () => {
    expect(qiChartKindFor('HAND_HYGIENE', [], 100)).toBe('P');
    expect(qiChartKindFor('FALL_RATE', [], 1000)).toBe('U');
    expect(qiChartKindFor(null, [{ period: 'a', numerator: 1, denominator: 2 }], 100)).toBe('P');
    expect(qiChartKindFor(null, [{ period: 'a', numerator: 3, denominator: 2 }], 100)).toBe('U');
  });
  it('위해 척도·인증 체계 — 미설정이면 없음(지어내지 않는다)', () => {
    expect(harmLevelsOf(null)).toBeNull();
    expect(harmLevelsOf('KOPS')).toContain('NEAR_MISS');
    expect(allowedAccreditationFrameworks(null)).toEqual([]);
    expect(allowedAccreditationFrameworks('BOTH')).toEqual(['KOIHA', 'JCI']);
    expect(qiSupplierByName('낙상발생률')).toBe('FALL_RATE');
    expect(qiSupplierByName('없는지표')).toBeNull();
  });
});

describe('지표 공급원 — 원장에서 다시 센다 · 결정 전엔 이유', () => {
  const basePrisma = () => ({
    // 2026-10-10 분자 = 재원 중 사고(병동 기록) — 4건 모두 병동 사고
    safetyIncident: { count: vi.fn(async () => 4), findMany: vi.fn(async () => Array.from({ length: 4 }, () => ({ patientId: 'p1', wardId: 'w1', occurredAt: new Date(2026, 8, 10) }))) },
    admission: { count: vi.fn(async () => 50), findMany: vi.fn(async () => []) },
    patientDaySnapshot: { findMany: vi.fn(async () => [] as Array<{ date: Date; patientDays: number }>) },
    handHygieneObservation: { count: vi.fn(async () => 0) },
    haiCase: { count: vi.fn(async () => 2) },
    deviceDayEntry: { findMany: vi.fn(async () => [] as Array<{ period: string; days: number }>) },
    vocTicket: { count: vi.fn(async () => 7) },
  });

  it('🔴 사고율 — 분모 결정 전엔 available:false · 분자는 대조 근거로 준다', async () => {
    const svc = new IndicatorSupplierService(basePrisma() as never, cfg({}) as never);
    const r = await svc.supply('FALL_RATE', SEP);
    expect(r).toMatchObject({ available: false, reason: 'DENOMINATOR_UNSET', numerator: 4 });
  });
  it('🔴 재원일수 분모 — 스냅샷이 기간을 다 덮지 못하면 산출하지 않는다(부분 분모 = 부풀린 비율)', async () => {
    const p = basePrisma();
    p.patientDaySnapshot.findMany.mockResolvedValue([{ date: new Date('2026-09-01T00:00:00Z'), patientDays: 20 }]);
    const svc = new IndicatorSupplierService(p as never, cfg({ 'qi.autoMeasure.incidentDenominator': 'PATIENT_DAYS' }) as never);
    const r = await svc.supply('FALL_RATE', SEP);
    expect(r).toMatchObject({ available: false, reason: 'PATIENT_DAYS_INCOMPLETE', detail: { coveredDays: 1, days: 30 } });
  });
  it('재원일수 분모 — 30일 다 덮으면 합이 분모', async () => {
    const p = basePrisma();
    p.patientDaySnapshot.findMany.mockResolvedValue(Array.from({ length: 30 }, (_, i) => ({ date: new Date(Date.UTC(2026, 8, i + 1)), patientDays: 10 })));
    const svc = new IndicatorSupplierService(p as never, cfg({ 'qi.autoMeasure.incidentDenominator': 'PATIENT_DAYS' }) as never);
    const r = await svc.supply('FALL_RATE', SEP);
    expect(r).toMatchObject({ available: true, numerator: 4, denominator: 300 });
  });
  it('입원 건수 분모 — 취소 입원 제외', async () => {
    const p = basePrisma();
    const svc = new IndicatorSupplierService(p as never, cfg({ 'qi.autoMeasure.incidentDenominator': 'ADMISSIONS' }) as never);
    const r = await svc.supply('MED_ERROR_RATE', SEP);
    expect(r).toMatchObject({ available: true, denominator: 50 });
    expect((p.admission.count.mock.calls as unknown as Array<[{ where: { status: unknown } }]>)[0][0].where.status).toEqual({ not: 'CANCELLED' });
  });
  it('🔴 손위생 — 관찰 0 이면 NO_SAMPLE(100% 도 0% 도 아니다)', async () => {
    const svc = new IndicatorSupplierService(basePrisma() as never, cfg({}) as never);
    expect(await svc.supply('HAND_HYGIENE', SEP)).toMatchObject({ available: false, reason: 'NO_SAMPLE' });
  });
  it('🔴 기구 관련 감염 — 원천 미설정·NONE·입력 없는 달을 각각 다른 이유로', async () => {
    const p = basePrisma();
    expect(await new IndicatorSupplierService(p as never, cfg({}) as never).supply('CLABSI_RATE', SEP)).toMatchObject({ available: false, reason: 'DEVICE_DAYS_SOURCE_UNSET', numerator: 2 });
    expect(await new IndicatorSupplierService(p as never, cfg({ 'qi.deviceDays.source': 'NONE' }) as never).supply('CLABSI_RATE', SEP)).toMatchObject({ reason: 'DEVICE_DAYS_NONE' });
    expect(await new IndicatorSupplierService(p as never, cfg({ 'qi.deviceDays.source': 'MANUAL' }) as never).supply('CLABSI_RATE', SEP)).toMatchObject({ reason: 'DEVICE_DAYS_MISSING', detail: { missing: ['2026-09'] } });
    p.deviceDayEntry.findMany.mockResolvedValue([{ period: '2026-09', days: 400 }]);
    expect(await new IndicatorSupplierService(p as never, cfg({ 'qi.deviceDays.source': 'MANUAL' }) as never).supply('CLABSI_RATE', SEP)).toMatchObject({ available: true, numerator: 2, denominator: 400 });
  });
  it('공급원 없는 지표 — NO_SUPPLIER', async () => {
    const svc = new IndicatorSupplierService(basePrisma() as never, cfg({}) as never);
    expect(await svc.supplyForIndicator({ name: '수술 전 항생제 투여율' }, SEP)).toMatchObject({ available: false, reason: 'NO_SUPPLIER', numerator: null });
  });
});

describe('재원일수 스냅샷', () => {
  const mk = (admissions: unknown[]) => {
    const upsert = vi.fn(async () => ({}));
    const deleteMany = vi.fn(async () => ({}));
    const prisma = {
      admission: { findMany: vi.fn(async () => admissions) },
      $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn({ patientDaySnapshot: { upsert, deleteMany } })),
    };
    return { svc: new PatientDaysService(prisma as never), upsert, deleteMany, prisma };
  };
  it('병동 = 그 시점 유효한 배정 · 이력은 있는데 유효 배정이 없으면 병동 미상(지어내지 않음)', async () => {
    const t = new Date(2026, 8, 10);
    const { svc } = mk([
      { id: 'a1', bed: { wardId: 'W-NOW' }, bedAssignments: [{ assignedAt: new Date(2026, 8, 1), releasedAt: null, bed: { wardId: 'W1' } }] },
      { id: 'a2', bed: { wardId: 'W2' }, bedAssignments: [] },
      { id: 'a3', bed: { wardId: 'W3' }, bedAssignments: [{ assignedAt: new Date(2026, 8, 1), releasedAt: new Date(2026, 8, 5), bed: { wardId: 'W3' } }] },
    ]);
    void t;
    const r = await svc.snapshotDay('2026-09-10');
    expect(r.byWard).toEqual({ W1: 1, W2: 1, '': 1 });
    expect(r.total).toBe(3);
  });
  it('🔴 재원 0명인 날도 행을 남긴다 — 없으면 그 달 분모가 영원히 "스냅샷 미완"', async () => {
    const { svc, upsert } = mk([]);
    const r = await svc.snapshotDay('2026-09-10');
    expect(r.total).toBe(0);
    expect(upsert).toHaveBeenCalledTimes(1);
    expect((upsert.mock.calls as unknown as Array<[{ create: { wardKey: string; patientDays: number } }]>)[0][0].create).toMatchObject({ wardKey: '', patientDays: 0 });
  });
  it('취소 입원 제외 · 끝나지 않은 날은 재계산 거부', async () => {
    const { svc, prisma } = mk([]);
    await svc.snapshotDay('2026-09-10');
    expect((prisma.admission.findMany.mock.calls as unknown as Array<[{ where: { status: unknown } }]>)[0][0].where.status).toEqual({ not: 'CANCELLED' });
    const today = new Date();
    const k = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    await expect(svc.rebuild('2026-09-01', k)).rejects.toThrow(BadRequestException);
  });
});

describe('측정 기록·정의 직접 수정(결정 qi.indicator.directEdit)', () => {
  it('🔴 AGENDA_ONLY — 정의·목표 직접 수정 409 · 정의 밖 항목은 통과', async () => {
    const svc = new QualityService({} as never, cfg({ 'qi.indicator.directEdit': 'AGENDA_ONLY' }) as never);
    await expect(svc.guardDirectEdit({ fields: ['targetValue'], changeReason: '충분히 긴 사유' })).rejects.toThrow(ConflictException);
    await expect(svc.guardDirectEdit({ create: true, fields: [], changeReason: '충분히 긴 사유' })).rejects.toThrow(ConflictException);
    await expect(svc.guardDirectEdit({ fields: ['formula'] })).resolves.toMatchObject({ definitionChange: false });
  });
  it('🔴 기본(ALLOW_WITH_REASON) — 정의 변경은 사유 5자 이상', async () => {
    const svc = new QualityService({} as never, cfg({}) as never);
    await expect(svc.guardDirectEdit({ fields: ['direction'] })).rejects.toThrow(BadRequestException);
    await expect(svc.guardDirectEdit({ fields: ['direction'], changeReason: '짧음' })).rejects.toThrow(BadRequestException);
    await expect(svc.guardDirectEdit({ fields: ['direction'], changeReason: '위원회 권고 반영' })).resolves.toMatchObject({ policy: 'ALLOW_WITH_REASON', definitionChange: true });
  });
  it('🔴 자동 행은 수기 행을 덮지 않는다 — 같은 달 자동 칸으로 따로 쌓인다', async () => {
    const findUnique = vi.fn(async () => null);
    const create = vi.fn(async (a: { data: unknown }) => ({ id: 'm', ...(a.data as object) }));
    const prisma = {
      qualityIndicator: { findUnique: vi.fn(async () => ({ id: 'i1', name: '낙상발생률', targetValue: 1, direction: 'LOWER_IS_BETTER', unit: '‰', valueScale: 1000 })) },
      qiMeasurement: { findUnique, create },
    };
    const svc = new QualityService(prisma as never, cfg({}) as never);
    await svc.addMeasurement({ indicatorId: 'i1', period: '2026-09', numerator: 2, denominator: 1000, source: 'AUTO', computedBy: 'supplier:FALL_RATE' });
    const where = (findUnique.mock.calls as unknown as Array<[{ where: { indicatorId_period_stratumKey_sourceKey: { sourceKey: string } } }]>)[0][0].where;
    expect(where.indicatorId_period_stratumKey_sourceKey.sourceKey).toBe('AUTO');
    expect((create.mock.calls[0][0] as { data: Record<string, unknown> }).data).toMatchObject({ source: 'AUTO', sourceKey: 'AUTO', stratumKey: '', computedBy: 'supplier:FALL_RATE' });
  });
  it('읽기는 병원 전체 층·무효 제외', () => {
    expect(ACTIVE_MEASUREMENT).toEqual({ voidedAt: null, stratumKey: '' });
  });
});

describe('월 마감 — 측정 → 판정 → 경보', () => {
  const mk = (over: { supply?: unknown; rows?: unknown[]; indicators?: unknown[]; strata?: unknown } = {}) => {
    const indicators = over.indicators ?? [
      { id: 'i-fall', name: '낙상발생률', targetValue: 1, direction: 'LOWER_IS_BETTER', unit: '‰', valueScale: 1000, isActive: true, ownerId: 'u-owner' },
      { id: 'i-man', name: '수술 전 항생제 투여율', targetValue: 95, direction: 'HIGHER_IS_BETTER', unit: '%', valueScale: 100, isActive: true, ownerId: null },
    ];
    const prisma = {
      qualityIndicator: { findMany: vi.fn(async () => indicators) },
      qiMeasurement: { findMany: vi.fn(async () => over.rows ?? [{ id: 'm1', indicatorId: 'i-fall', period: '2026-09', value: 3, sourceKey: 'AUTO' }]) },
    };
    const quality = { addMeasurement: vi.fn(async () => ({})), precedence: vi.fn(async () => 'BOTH') };
    const suppliers = {
      monthRange: () => SEP,
      supplierOf: (i: { name: string }) => (i.name === '낙상발생률' ? 'FALL_RATE' : null),
      supply: vi.fn(async () => over.supply ?? { available: true, supplierKey: 'FALL_RATE', numerator: 3, denominator: 1000, evidence: { x: 1 } }),
      supplyWardStrata: vi.fn(async () => over.strata ?? { strata: [], unassignedIncidents: 0, reason: 'NOT_STRATIFIABLE' }),
    };
    const cpoe = { recordMonth: vi.fn(async () => ({})) };
    const events = { emit: vi.fn() };
    const svc = new MonthCloseService(prisma as never, quality as never, suppliers as never, cpoe as never, cfg({}) as never, events as never);
    return { svc, quality, events, cpoe };
  };
  it('🔴 끝나지 않은 달은 마감하지 않는다', async () => {
    const { svc } = mk();
    const now = new Date();
    const p = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    await expect(svc.closeMonth(p, { trigger: 'MANUAL' })).rejects.toThrow(BadRequestException);
  });
  it('공급원 지표는 AUTO 로 기록 · 미달은 담당에게 · 수기 지표 측정 없음은 "미입력"(채우지 않는다)', async () => {
    const { svc, quality, events } = mk();
    const r = await svc.closeMonth('2026-09', { trigger: 'MANUAL', actorId: 'u-admin' });
    expect(quality.addMeasurement).toHaveBeenCalledWith(expect.objectContaining({ indicatorId: 'i-fall', source: 'AUTO', computedBy: 'supplier:FALL_RATE', createdBy: 'u-admin' }));
    expect(r.targetMissed).toEqual([{ indicatorId: 'i-fall', name: '낙상발생률', value: 3, target: 1 }]);
    expect(r.manualMissing).toEqual([{ indicatorId: 'i-man', name: '수술 전 항생제 투여율' }]);
    expect(events.emit).toHaveBeenCalledWith('qi.target.missed', expect.objectContaining({ indicatorId: 'i-fall', ownerId: 'u-owner', period: '2026-09' }));
    expect(events.emit).toHaveBeenCalledWith('qi.measurement.missing', expect.objectContaining({ indicatorId: 'i-man' }));
  });
  it('🔴 산출 불가는 기록도 경보도 없이 이유만 — 0 으로 접지 않는다', async () => {
    const { svc, quality, events } = mk({ supply: { available: false, supplierKey: 'FALL_RATE', reason: 'DENOMINATOR_UNSET', numerator: 3 }, rows: [] });
    const r = await svc.closeMonth('2026-09', { trigger: 'MANUAL' });
    expect(quality.addMeasurement).not.toHaveBeenCalled();
    expect(r.unavailable).toEqual([{ indicatorId: 'i-fall', name: '낙상발생률', reason: 'DENOMINATOR_UNSET' }]);
    expect(r.targetMissed).toEqual([]);
    expect(events.emit).not.toHaveBeenCalledWith('qi.target.missed', expect.anything());
  });
  it('대조군 — 목표 충족이면 경보 없음', async () => {
    const { svc, events } = mk({ rows: [{ id: 'm1', indicatorId: 'i-fall', period: '2026-09', value: 0.5, sourceKey: 'AUTO' }] });
    const r = await svc.closeMonth('2026-09', { trigger: 'MANUAL' });
    expect(r.targetMissed).toEqual([]);
    expect(events.emit).not.toHaveBeenCalledWith('qi.target.missed', expect.anything());
  });
  it('🔴 자동 크론은 설정이 켜졌을 때만(결정 qi.autoMeasure.enable)', async () => {
    const { svc, cpoe } = mk();
    await svc.monthly();
    expect(cpoe.recordMonth).not.toHaveBeenCalled();
  });
});

describe('일반 지표 PDCA — 기준선과 효과 확인을 같은 길로', () => {
  const mk = (supply: unknown) => {
    const created: unknown[] = [];
    const prisma = {
      qualityIndicator: { findUnique: vi.fn(async () => ({ id: 'i1', name: '수술 전 항생제 투여율', targetValue: 95 })) },
      user: { findUnique: vi.fn(async () => ({ id: 'u1' })) },
      $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn({
        qiImprovementAction: { create: vi.fn(async (a: { data: unknown }) => { created.push(a.data); return { id: 'a1', ...(a.data as object) }; }) },
        qiImprovementEvent: { create: vi.fn(async () => ({})) },
      })),
    };
    const suppliers = { supplyForIndicator: vi.fn(async () => supply) };
    return { svc: new CpoeImprovementService(prisma as never, {} as never, suppliers as never), created };
  };
  const base = { indicatorId: 'i1', title: 't', problem: 'p', plan: 'pl', baselineFrom: '2026-07-01', baselineTo: '2026-07-31' };
  it('🔴 공급원 없는 지표는 사람이 센 분자·분모를 받고 출처를 MANUAL 로 남긴다', async () => {
    const { svc, created } = mk({ available: false, supplierKey: null, reason: 'NO_SUPPLIER', numerator: null });
    await expect(svc.create(base, 'u1')).rejects.toMatchObject({ response: { code: 'QI_MANUAL_COUNT_REQUIRED' } });
    await svc.create({ ...base, baselineNumerator: 80, baselineDenominator: 100 }, 'u1');
    expect(created[0]).toMatchObject({ indicatorId: 'i1', indicatorKey: null, baselineSource: 'MANUAL', baselineNumerator: 80, baselineDenominator: 100 });
  });
  it('🔴 공급원이 있는데 결정 전이면 사람 수로 대신하지 않는다(이유 그대로)', async () => {
    const { svc } = mk({ available: false, supplierKey: 'FALL_RATE', reason: 'DENOMINATOR_UNSET', numerator: 3 });
    await expect(svc.create({ ...base, baselineNumerator: 1, baselineDenominator: 2 }, 'u1')).rejects.toMatchObject({ response: { code: 'QI_SUPPLY_UNAVAILABLE', reason: 'DENOMINATOR_UNSET' } });
  });
  it('CPOE 지표와 질 지표를 둘 다·둘 다 아니게 고르면 거부', async () => {
    const { svc } = mk(null);
    await expect(svc.create({ ...base, indicatorKey: 'NO_DIAGNOSIS' as never }, 'u1')).rejects.toMatchObject({ response: { code: 'QI_ACTION_INDICATOR' } });
    await expect(svc.create({ ...base, indicatorId: undefined }, 'u1')).rejects.toMatchObject({ response: { code: 'QI_ACTION_INDICATOR' } });
  });
});

describe('사고 — 검토 시각·종결 · 익명·위해 정도(결정)', () => {
  const mk = (config: Record<string, unknown>) => {
    const create = vi.fn(async (a: { data: unknown }) => ({ id: 'n1', ...(a.data as object) }));
    const prisma = {
      safetyIncident: { create, findUnique: vi.fn(async () => ({ id: 'n1' })) },
      ward: { findUnique: vi.fn(async () => ({ id: 'w1' })) },
      patient: { findUnique: vi.fn(async () => ({ id: 'p1' })) },
    };
    const svc = new PatientSafetyService(prisma as never, { emit: vi.fn() } as never, cfg(config) as never);
    return { svc, create };
  };
  const dto = { type: 'FALL', severity: 'MINOR', description: '복도에서 미끄러짐', occurredAt: '2026-09-10T10:00:00+09:00', location: '7병동' };
  it('🔴 위해 정도 척도 미설정이면 harmLevel 거부(어휘를 지어내 강제하지 않는다)', async () => {
    const { svc } = mk({});
    await expect(svc.reportIncident({ ...dto, reporterId: 'u1', harmLevel: 'MILD' })).rejects.toThrow(BadRequestException);
  });
  it('🔴 익명 보고는 설정이 켜졌을 때만 · 켜지면 보고자를 남기지 않는다', async () => {
    await expect(mk({}).svc.reportIncident({ ...dto, reporterId: 'u1', anonymous: true })).rejects.toThrow();
    const { svc, create } = mk({ 'safety.incident.anonymous': true });
    await svc.reportIncident({ ...dto, reporterId: 'u1', anonymous: true });
    expect((create.mock.calls[0][0] as { data: Record<string, unknown> }).data).toMatchObject({ anonymous: true, reporterId: null });
  });
});

describe('보고서 — 스냅샷 위원회 제출', () => {
  it('🔴 동시 두 번 제출해도 안건은 하나 — DRAFT 선점(조건부)', async () => {
    const updateMany = vi.fn().mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
    const prisma = {
      qiReportSnapshot: {
        findUnique: vi.fn(async () => ({ id: 'r1', period: '2026-09', title: 'QI 보고서 2026-09', status: 'DRAFT', sha256: 'a'.repeat(64), body: { summary: { keyFindings: [] } }, agendaId: null })),
        updateMany, update: vi.fn(async () => ({})),
      },
    };
    const agendas = { submit: vi.fn(async () => ({ agenda: { id: 'ag1' } })) };
    const svc = new QiReportService(prisma as never, {} as never, {} as never, agendas as never);
    await expect(svc.submit('r1', 'u1')).resolves.toEqual({ reportId: 'r1', agendaId: 'ag1' });
    await expect(svc.submit('r1', 'u1')).rejects.toThrow(ConflictException);
    expect(agendas.submit).toHaveBeenCalledTimes(1);
    expect(updateMany.mock.calls[0][0]).toMatchObject({ where: { id: 'r1', status: 'DRAFT' } });
  });
  it('🔴 안건 생성이 실패하면 선점을 되돌린다(올라가지 않은 보고서를 "올림"으로 남기지 않는다)', async () => {
    const updateMany = vi.fn(async () => ({ count: 1 }));
    const prisma = { qiReportSnapshot: { findUnique: vi.fn(async () => ({ id: 'r1', period: '2026-09', title: 't', status: 'DRAFT', sha256: null, body: {}, agendaId: null })), updateMany, update: vi.fn() } };
    const agendas = { submit: vi.fn(async () => { throw new Error('surface 없음'); }) };
    const svc = new QiReportService(prisma as never, {} as never, {} as never, agendas as never);
    await expect(svc.submit('r1', 'u1')).rejects.toThrow('surface 없음');
    expect((updateMany.mock.calls as unknown as Array<[{ data: { status: string } }]>).at(-1)![0].data.status).toBe('DRAFT');
    expect(prisma.qiReportSnapshot.update).not.toHaveBeenCalled();
  });
});

describe('위원회 안건 — 목표·사고 검토', () => {
  it('🔴 목표 안건은 후보마다 MASTER_DATA 집행 + "정하지 않음" · 원장은 화면이 바꾸지 않는다', async () => {
    const prisma = { qualityIndicator: { findUnique: vi.fn(async () => ({ id: 'i1', name: '낙상발생률', formula: 'x', targetValue: 1, direction: 'LOWER_IS_BETTER', unit: '‰', valueScale: 1000 })), update: vi.fn() } };
    const agendas = { submit: vi.fn(async (x: unknown) => x) };
    const svc = new QiAgendaService(prisma as never, agendas as never);
    const out = (await svc.proposeTarget('i1', { targets: [0.8, 1.2] }, 'u1')) as { options: Array<{ value: string; enact: unknown }>; surfaceKey: string };
    expect(out.surfaceKey).toBe('master:quality-indicator');
    expect(out.options.map((o) => o.value)).toEqual(['T1', 'T2', 'NONE']);
    expect(out.options[0].enact).toEqual({ kind: 'MASTER_DATA', target: { master: 'quality-indicator', op: 'update', id: 'i1', payload: { targetValue: 0.8 } } });
    expect(out.options[2].enact).toBeNull();
    expect(prisma.qualityIndicator.update).not.toHaveBeenCalled();
  });
  it('🔴 사고 검토 안건에 환자 식별정보·서술 본문이 실리지 않는다', async () => {
    const prisma = {
      safetyIncident: { findUnique: vi.fn(async () => ({ id: 'n1', type: 'FALL', severity: 'MINOR', status: 'INVESTIGATING', occurredAt: new Date(2026, 8, 10), wardId: null, harmLevel: null, rcaCompleted: false, description: '홍길동 환자가 넘어짐', patientId: 'p1' })) },
      ward: { findUnique: vi.fn(async () => null) },
    };
    const agendas = { submit: vi.fn(async (x: unknown) => x) };
    const svc = new QiAgendaService(prisma as never, agendas as never);
    const out = JSON.stringify(await svc.proposeIncidentReview('n1', undefined, 'u1'));
    expect(out).not.toContain('홍길동');
    expect(out).not.toContain('p1');
    const sel = (prisma.safetyIncident.findUnique.mock.calls as unknown as Array<[{ select: Record<string, boolean> }]>)[0][0].select;
    expect(sel.description).toBeUndefined();
    expect(sel.patientId).toBeUndefined();
  });
});

describe('인증 자체 평가·기구일수 — 결정 전엔 닫혀 있다', () => {
  it('🔴 체계 미설정이면 기준 등록 409', async () => {
    const svc = new AccreditationService({} as never, cfg({}) as never);
    await expect(svc.createStandard({ framework: 'KOIHA', chapter: '1', code: '1.1', title: 't' }, 'u1')).rejects.toMatchObject({ response: { code: 'ACCREDITATION_FRAMEWORK_UNSET' } });
  });
  it('🔴 부분 충족·미충족은 근거 필수 · 평가자는 스스로 확인하지 못한다', async () => {
    const prisma = {
      accreditationStandard: { findUnique: vi.fn(async () => ({ id: 's1' })) },
      accreditationAssessment: { create: vi.fn(async () => ({})), findUnique: vi.fn(async () => ({ id: 'a1', assessedBy: 'u1' })), updateMany: vi.fn() },
    };
    const svc = new AccreditationService(prisma as never, cfg({ 'accreditation.framework': 'KOIHA' }) as never);
    await expect(svc.assess('s1', { cycle: '2026', judgment: 'PARTIAL' }, 'u1')).rejects.toMatchObject({ response: { code: 'ACCREDITATION_EVIDENCE_REQUIRED' } });
    await expect(svc.assess('s1', { cycle: '2026', judgment: 'MET' }, 'u1')).resolves.toBeDefined();
    await expect(svc.verify('a1', 'u1')).rejects.toMatchObject({ response: { code: 'ACCREDITATION_SELF_VERIFY' } });
    expect(prisma.accreditationAssessment.updateMany).not.toHaveBeenCalled();
  });
  it('🔴 기구일수 — 원천이 MANUAL 이 아니면 입력 409', async () => {
    const svc = new DeviceDaysService({} as never, cfg({ 'qi.deviceDays.source': 'NONE' }) as never);
    await expect(svc.upsert({ period: '2026-09', deviceType: 'CENTRAL_LINE', days: 10 }, 'u1')).rejects.toMatchObject({ response: { code: 'QI_DEVICE_DAYS_NOT_ACCEPTING' } });
  });
  it('대조군 — MANUAL 이면 받는다(병원 전체 = 병동 키 "")', async () => {
    const upsert = vi.fn(async () => ({}));
    const svc = new DeviceDaysService({ deviceDayEntry: { upsert } } as never, cfg({ 'qi.deviceDays.source': 'MANUAL' }) as never);
    await svc.upsert({ period: '2026-09', deviceType: 'CENTRAL_LINE', days: 10 }, 'u1');
    expect((upsert.mock.calls as unknown as Array<[{ where: { period_wardKey_deviceType: { wardKey: string } } }]>)[0][0].where.period_wardKey_deviceType.wardKey).toBe('');
  });
});

describe('사람 결정 ↔ 설정 — 화면이 읽는 현황', () => {
  it('🔴 읽기 실패를 기본값으로 접지 않는다(source error)', async () => {
    const svc = new QiFlowSettingsService({ getWithSource: vi.fn(async (k: string) => { if (k === 'safety.harmLevelScale') throw new Error('db'); return { value: 'KOPS', source: 'db', registered: true }; }) } as never);
    const r = await svc.read();
    expect(r.rows.find((x) => x.key === 'safety.harmLevelScale')).toMatchObject({ source: 'error', value: null });
    expect(r.harmLevels).toBeNull(); // 실패한 척도로 어휘를 만들지 않는다
  });
  it('🔴 설정 키는 전부 DEFAULTS 에 있고, 결정 키는 전부 등록부에 있다 · 등록부 선택지가 그 키를 집행 대상으로 든다', () => {
    for (const s of QI_FLOW_SETTING_KEYS) {
      expect(s.key in DEFAULTS, `DEFAULTS 에 없는 설정 ${s.key}`).toBe(true);
      const d = DECISION_REGISTRY.find((x) => x.key === s.decisionKey);
      expect(d, `등록부에 없는 결정 ${s.decisionKey}`).toBeDefined();
      const targets = (d!.options ?? []).map((o) => (o as { enact?: { target?: { key?: string } } | null }).enact?.target?.key).filter(Boolean);
      expect(targets, `${s.decisionKey} 선택지가 ${s.key} 를 집행하지 않는다`).toContain(s.key);
    }
  });
  it('🔴 설정 키는 위원회 표면에 매핑돼 있다(안건 → 의결 → 집행 경로)', () => {
    const gov = readFileSync(join(__dirname, '../../src/modules/gld/governance.service.ts'), 'utf8');
    for (const s of QI_FLOW_SETTING_KEYS) expect(gov, `config:${s.key} 표면 없음`).toContain(`'config:${s.key}'`);
    expect(gov).toContain("'review:safety-incident'");
    expect(gov).toContain("'review:qi-report'");
  });
});
