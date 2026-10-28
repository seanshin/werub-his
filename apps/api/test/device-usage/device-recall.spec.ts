import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DeviceUsageService } from '../../src/modules/device-usage/device-usage.service';

/**
 * 🔴 의료기기 **리콜 역추적**(2026-08-26 사람 요구: GTIN-13/14 반영).
 *
 * 실측: 삽입물이 `surgeries.implants`(자유 텍스트)·`SurgeryOpNote.implants`(JSON)에만 남아
 * **리콜이 나면 그 로트가 어느 환자에게 들어갔는지 찾을 수 없었다.**
 * 그리고 `medication_codes.barcode` 22,306건이 저장돼 있는데 **파싱하는 코드가 0**이었다.
 */
const SVC = join(process.cwd(), 'src/modules/device-usage/device-usage.service.ts');

const mk = (rows: unknown[] = [], total?: number) => {
  const create = vi.fn().mockImplementation((a: { data: Record<string, unknown> }) => ({ id: 'u1', ...a.data }));
  return {
    prisma: {
      deviceUsage: {
        create,
        findMany: vi.fn().mockResolvedValue(rows),
        count: vi.fn().mockResolvedValue(total ?? rows.length),
      },
      inventoryItem: { findMany: vi.fn().mockResolvedValue([]) },
      equipment: { findMany: vi.fn().mockResolvedValue([]) },
    } as never,
    create,
  };
};

describe('기기 사용 기록', () => {
  it('바코드를 파싱해 GTIN·로트·일련번호를 채운다', async () => {
    const { prisma, create } = mk();
    const svc = new DeviceUsageService(prisma);
    await svc.record(
      { patientId: 'p1', deviceName: '인공관절', barcode: '(01)08806806000013(10)LOT7(21)SN2(17)261231' },
      'u9',
    );
    const d = create.mock.calls[0][0].data as Record<string, unknown>;
    expect(d.gtin).toBe('08806806000013');
    expect(d.lotNumber).toBe('LOT7');
    expect(d.serialNumber).toBe('SN2');
  });

  it('🔴 스캔 원문을 보존한다 — 파서를 고쳐도 다시 읽을 수 있어야 한다', async () => {
    const { prisma, create } = mk();
    const raw = '(01)08806806000013(10)LOT7';
    await new DeviceUsageService(prisma).record({ patientId: 'p1', deviceName: 'X', barcode: raw }, 'u9');
    expect((create.mock.calls[0][0].data as Record<string, unknown>).rawBarcode).toBe(raw);
  });

  it('🔴 체크디지트가 틀려도 기록은 막지 않되, 틀렸다고 말한다', async () => {
    const { prisma, create } = mk();
    const r = await new DeviceUsageService(prisma).record(
      { patientId: 'p1', deviceName: 'X', barcode: '(01)08806806000014' },
      'u9',
    );
    expect((create.mock.calls[0][0].data as Record<string, unknown>).gtinValid).toBe(false);
    expect(r.warning).toMatch(/체크디지트/);
  });

  it('대조군 — 올바른 GTIN 에는 경고를 붙이지 않는다', async () => {
    const { prisma } = mk();
    const r = await new DeviceUsageService(prisma).record(
      { patientId: 'p1', deviceName: 'X', barcode: '(01)08806806000013' },
      'u9',
    );
    expect(r.warning).toBeNull();
  });

  it('🔴 유효기간 DD=00(월말)은 일자를 지어내지 않는다', async () => {
    const { prisma, create } = mk();
    await new DeviceUsageService(prisma).record(
      { patientId: 'p1', deviceName: 'X', barcode: '(01)08806806000013(17)260800' },
      'u9',
    );
    const d = create.mock.calls[0][0].data as Record<string, unknown>;
    expect(d.expiryDayUnknown).toBe(true);
  });

  it('🔴 해석하지 못한 조각을 버리지 않는다', async () => {
    const { prisma, create } = mk();
    await new DeviceUsageService(prisma).record(
      { patientId: 'p1', deviceName: 'X', barcode: '(01)0880680600001399WEIRD' },
      'u9',
    );
    expect((create.mock.calls[0][0].data as Record<string, unknown>).unparsed).toBeTruthy();
  });

  it('기기명이 없으면 기록하지 않는다', async () => {
    const { prisma } = mk();
    await expect(
      new DeviceUsageService(prisma).record({ patientId: 'p1', deviceName: '  ' }, 'u9'),
    ).rejects.toThrow(/기기명/);
  });
});

describe('리콜 역추적', () => {
  const row = {
    id: 'u1', patientId: 'p1', deviceName: '인공관절', lotNumber: 'LOT7',
    serialNumber: null, usedAt: new Date(), usageType: 'IMPLANT',
    patient: { id: 'p1', mrn: 'M1', familyName: '김', givenName: '환자' },
  };

  it('GTIN·로트로 환자를 찾는다', async () => {
    const { prisma } = mk([row]);
    const r = await new DeviceUsageService(prisma).recallLookup({ gtin: '08806806000013', lotNumber: 'LOT7' });
    expect(r.total).toBe(1);
    expect(r.patients[0].mrn).toBe('M1');
  });

  it('🔴 조건이 하나도 없으면 전건을 돌려주지 않는다', async () => {
    const { prisma } = mk([row]);
    await expect(new DeviceUsageService(prisma).recallLookup({})).rejects.toThrow(/하나는 있어야/);
  });

  it('🔴 0건을 "해당 없음"이라 말하지 않는다 — 원장에 기록된 것만 센다', async () => {
    const { prisma } = mk([], 0);
    const r = await new DeviceUsageService(prisma).recallLookup({ lotNumber: 'NOPE' });
    expect(r.total).toBe(0);
    expect(r.caveat).toMatch(/0건이 "해당 없음"을 뜻하지 않습니다/);
  });

  it('🔴 자르면 잘랐다고 말한다', async () => {
    const { prisma } = mk([row], 900);
    const r = await new DeviceUsageService(prisma).recallLookup({ gtin: '08806806000013' });
    expect(r.truncated).toBe(true);
    expect(r.total).toBe(900);
  });

  it('🔴 GTIN 대조 실패를 "등록 없음"으로 번역하지 않는다', () => {
    const src = readFileSync(SVC, 'utf8');
    expect(src).toMatch(/GTIN 대조 실패/);
    // 대조군: 실패를 조용히 빈 배열로 바꾸고 끝내지 않는다(로그가 남는다)
    expect(src).toMatch(/this\.logger\.error/);
  });
});
