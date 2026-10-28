import { describe, it, expect, vi } from 'vitest';
import { WorkstationService } from '../../src/modules/workstation/workstation.service';

/**
 * 스테이션 검사항목 설정 계약 — 2026-08-12 (화면 점검 W1 · 패턴 P2 변종).
 *
 * 🔴 `workstation_configs.order_codes` 는 `CBC`·`HbA1c` 같은 **별칭**인데 오더의 procedureCode 는
 *    `E6591`(HbA1c)·`E6502`(CRP) 같은 **EDI 수가코드**다. 설정 코드 중 코드 마스터에 실재하는 것이
 *    **0개**여서 `procedureCode.code in codes` 필터가 항상 공집합이었고,
 *    **검사 5탭·영상 6탭·진단 7탭 = 18 스테이션이 구조적으로 영원히 0건**이었다.
 *    에러도 경고도 없이 "대기 중인 검사가 없습니다"라고만 했다.
 *
 * 규약: **설정이 하나도 안 맞으면 필터를 걸지 않는다**(업무를 잃지 않는다) + meta 로 그 사실을 밝힌다.
 * 잘못된 설정 때문에 실제 임상 업무가 조용히 사라지는 쪽이 훨씬 위험하다.
 */

function svc(configCodes: string[], masterCodes: string[]) {
  const prisma = {
    workstationConfig: {
      findUnique: vi.fn().mockResolvedValue(
        configCodes.length ? { stationId: 'lab-hematology', category: 'LAB', orderCodes: configCodes } : null,
      ),
    },
    procedureCode: {
      findMany: vi.fn().mockImplementation(({ where }: { where: { code: { in: string[] } } }) =>
        Promise.resolve(where.code.in.filter((c) => masterCodes.includes(c)).map((code) => ({ code }))),
      ),
    },
    order: { findMany: vi.fn().mockResolvedValue([]) },
  } as never;
  return { s: new WorkstationService(prisma), prisma: prisma as unknown as { order: { findMany: ReturnType<typeof vi.fn> } } };
}

function whereOf(prisma: { order: { findMany: ReturnType<typeof vi.fn> } }) {
  return prisma.order.findMany.mock.calls[0][0].where as {
    prescription: { procedureCode?: { code: { in: string[] } } };
  };
}

describe('워크스테이션 — 검사항목 설정 코드', () => {
  it('🔴 설정 코드가 코드 마스터에 하나도 없으면 필터를 걸지 않는다(업무가 사라지면 안 된다)', async () => {
    const { s, prisma } = svc(['CBC', 'HbA1c', 'CRP'], ['E6591', 'E6502']);
    await s.getQueue('lab-hematology');
    expect(
      whereOf(prisma).prescription.procedureCode,
      '맞는 코드가 없는데 필터를 걸어 목록이 비었다',
    ).toBeUndefined();
  });

  it('일부라도 맞으면 맞는 것만으로 좁힌다(설정을 무시하지 않는다)', async () => {
    const { s, prisma } = svc(['CBC', 'E6591'], ['E6591']);
    await s.getQueue('lab-hematology');
    expect(whereOf(prisma).prescription.procedureCode?.code.in).toEqual(['E6591']);
  });

  it('설정이 없으면 부서 전체(종전 동작 유지)', async () => {
    const { s, prisma } = svc([], []);
    await s.getQueue('lab-hematology');
    expect(whereOf(prisma).prescription.procedureCode).toBeUndefined();
  });

  it('🔴 불일치를 meta 로 밝힌다 — 화면이 "부서 전체를 보는 중"임을 말해야 한다', async () => {
    const { s } = svc(['CBC', 'HbA1c', 'CRP'], ['E6591']);
    expect(await s.getStationConfigHealth('lab-hematology')).toEqual({
      configuredCodes: 3,
      matchedCodes: 0,
      configMismatch: true,
      queueWired: true, // 검사실은 배선돼 있다 — 설정만 안 맞는 상태
    });
  });

  it('맞는 설정은 불일치로 보고하지 않는다', async () => {
    const { s } = svc(['E6591', 'E6502'], ['E6591', 'E6502']);
    const h = await s.getStationConfigHealth('lab-hematology');
    expect(h.configMismatch).toBe(false);
    expect(h.matchedCodes).toBe(2);
  });
});
