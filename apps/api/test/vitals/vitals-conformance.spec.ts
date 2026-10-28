/**
 * 활력 기록 표준 적합성 점검(2026-10-07).
 *  · 원장 4종을 세고 표본 id 를 준다 · 고치지 않는다(쓰기 호출 0)
 *  · 잘랐으면 truncated(전체 수 병기) · 조기경보 spO2 는 스키마 별칭이라 기록 결함으로 세지 않는다
 *  · 조기경보의 이완기 없음은 원장 정의라 세지 않는다 · 정상 기록은 0(대조군)
 * 재주입: 위 규칙 하나를 되돌리면 실패한다.
 */
import { describe, it, expect, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { VitalsConformanceService } from '../../src/modules/vitals/vitals-conformance.service';
import { VitalsConformanceController } from '../../src/modules/vitals/vitals-conformance.controller';

const at = new Date(Date.now() - 3600_000);
function prisma(o: { pv?: any[]; pvTotal?: number; fs?: any[]; icu?: any[]; ews?: any[] } = {}) {
  const writes = vi.fn();
  const model = (rows: any[], total?: number) => ({ findMany: vi.fn(async () => rows), count: vi.fn(async () => total ?? rows.length), update: writes, updateMany: writes, create: writes });
  return {
    writes,
    p: {
      preVisitVitals: model(o.pv ?? [], o.pvTotal),
      flowSheetEntry: model(o.fs ?? []),
      icuRecord: model(o.icu ?? []),
      earlyWarningScore: model(o.ews ?? []),
    } as any,
  };
}

describe('활력 원장 적합성', () => {
  it('🔴 범위 밖·역전·미래 시각을 센다 · 표본 id · 고치지 않는다', async () => {
    const { p, writes } = prisma({
      pv: [{ id: 'a', measuredAt: at, temperature: 365, systolicBp: 120, diastolicBp: 80 }],
      fs: [{ id: 'b', recordedAt: new Date(Date.now() + 86400_000), systolicBp: 80, diastolicBp: 90, consciousness: '명료' }],
    });
    const r = await new VitalsConformanceService(p).report(30);
    const pv = r.ledgers.find((l) => l.source === 'PRE_VISIT')!;
    expect(pv.byCode.IMPLAUSIBLE).toBe(1);
    expect(pv.samples[0]).toMatchObject({ id: 'a', code: 'IMPLAUSIBLE', key: 'temperature', value: 365 });
    const fs = r.ledgers.find((l) => l.source === 'FLOWSHEET')!;
    expect(fs.byCode.BP_INVERTED).toBe(1);
    expect(fs.byCode.FUTURE_MEASURED_AT).toBe(1);
    expect(fs.byCode.CONSCIOUSNESS_SCALE).toBe(1);
    expect(fs.recordsWithErrors).toBe(1);
    expect(writes).not.toHaveBeenCalled();
  });
  it('🔴 잘랐으면 truncated · 조기경보 spO2 별칭·이완기 없음은 세지 않는다', async () => {
    const { p } = prisma({
      pv: [{ id: 'a', measuredAt: at, heartRate: 70 }], pvTotal: 9000,
      ews: [{ id: 'e', recordedAt: at, systolicBp: 120, heartRate: 70, temperature: 36.5, spO2: 97, respiratoryRate: 16, consciousness: 'ALERT' }],
    });
    const r = await new VitalsConformanceService(p).report(7);
    expect(r.ledgers.find((l) => l.source === 'PRE_VISIT')).toMatchObject({ total: 9000, scanned: 1, truncated: true });
    const ews = r.ledgers.find((l) => l.source === 'EWS')!;
    expect(ews.byCode).toEqual({});
    expect(r.schemaAliases).toEqual([{ model: 'EarlyWarningScore', field: 'spO2', canonical: 'spo2' }]);
  });
  it('days 검증 400', async () => {
    const c = new VitalsConformanceController(new VitalsConformanceService(prisma().p));
    await expect(c.conformance('0')).rejects.toBeInstanceOf(BadRequestException);
    await expect(c.conformance('abc')).rejects.toBeInstanceOf(BadRequestException);
    await expect(c.conformance(undefined)).resolves.toMatchObject({ data: { days: 30 } });
  });
});
