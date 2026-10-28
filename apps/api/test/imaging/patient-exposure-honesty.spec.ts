import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ImagingSafetyService } from '../../src/modules/imaging/imaging-safety.service';

/**
 * 누적 진단 피폭선량 조회(`getPatientExposure`) 정직성 — 2026-08-27.
 *
 * 🔴 이 가드가 생긴 이유: 같은 개념을 재는 두 경로가 **다르게 답하고 있었다.**
 *   · `checkCumulativeDose()`(이송 전 확인) — 기록 0건이면 `null` + "산출 불가"  ← 정직
 *   · `getPatientExposure()`(환자별 조회)   — 기록 0건이면 `Number(null ?? 0)` = **`0 mSv`** ← 거짓
 *  소비처가 0이라 아무도 못 봤을 뿐이다. "몰라서 없는 것"과 "재서 0인 것"은 다른 사실이다(P1·P12).
 *
 * 재주입: `?? 0` 폴백을 되돌리거나 분모(`ionizingStudies`)를 빼면 아래가 실패한다.
 */
describe('getPatientExposure — 모르는 것을 0 으로 말하지 않는다', () => {
  let service: ImagingSafetyService;
  let mockPrisma: any;

  /** 🔴 목은 정본의 실제 반환 모양을 쓴다 — Prisma `aggregate` 는 행이 없으면 `_sum: {x: null}` 이다. */
  const setup = (o: {
    rows?: number; dosed?: number; sumMsv?: number | null; sumDlp?: number | null;
    yearRows?: number; yearDosed?: number; yearSum?: number | null;
    estimated?: number; studies?: number; studiesWithDose?: number; items?: unknown[];
  }) => {
    const counts = [
      o.rows ?? 0, o.dosed ?? 0, o.yearRows ?? 0, o.yearDosed ?? 0,
      o.estimated ?? 0, o.studies ?? 0, o.studiesWithDose ?? 0,
    ];
    let ri = 0;
    mockPrisma = {
      radiationExposure: {
        findMany: vi.fn().mockResolvedValue(o.items ?? []),
        // 호출 순서: total, dosed, year, yearDosed, estimated
        count: vi.fn().mockImplementation(async () => counts[ri++]),
        aggregate: vi.fn()
          .mockResolvedValueOnce({ _sum: { effectiveDoseMsv: o.sumMsv ?? null, dlp: o.sumDlp ?? null } })
          .mockResolvedValueOnce({ _sum: { effectiveDoseMsv: o.yearSum ?? null } }),
      },
      imagingResult: { count: vi.fn().mockImplementation(async () => counts[ri++]) },
    };
    service = new ImagingSafetyService(mockPrisma);
    return service;
  };

  beforeEach(() => vi.clearAllMocks());

  it('🔴 기록이 0건이면 누적은 null 이다 — 0 mSv 가 아니다', async () => {
    const r = await setup({ rows: 0, studies: 4 }).getPatientExposure('p1');
    expect(r.summary.totalEffectiveMsv).toBeNull();
    expect(r.summary.totalEffectiveUnavailableReason).toBe('NO_RECORD');
    expect(r.summary.last12moEffectiveMsv).toBeNull();
    // 🔴 0 을 답하면 "피폭이 없었다"는 다른 사실이 된다
    expect(r.summary.totalEffectiveMsv).not.toBe(0);
  });

  it('🔴 기록은 있는데 선량값이 전부 비어 있으면 합계 0 이 아니라 null 이다', async () => {
    const r = await setup({ rows: 3, dosed: 0, yearRows: 3, yearDosed: 0, studies: 3, studiesWithDose: 3 })
      .getPatientExposure('p1');
    expect(r.summary.totalCount).toBe(3);
    expect(r.summary.totalEffectiveMsv).toBeNull();
    expect(r.summary.totalEffectiveUnavailableReason).toBe('NO_DOSE_VALUE');
  });

  it('선량값이 있으면 숫자로 답한다', async () => {
    const r = await setup({
      rows: 2, dosed: 2, sumMsv: 12.5, sumDlp: 800,
      yearRows: 2, yearDosed: 2, yearSum: 12.5, studies: 2, studiesWithDose: 2,
    }).getPatientExposure('p1');
    expect(r.summary.totalEffectiveMsv).toBe(12.5);
    expect(r.summary.totalEffectiveUnavailableReason).toBeNull();
    expect(r.summary.totalDlp).toBe(800);
  });

  it('🔴 분모를 함께 낸다 — 누적 mSv 만 보면 "적게 쬐었다"로 오독된다', async () => {
    const r = await setup({
      rows: 1, dosed: 1, sumMsv: 2, yearRows: 1, yearDosed: 1, yearSum: 2,
      studies: 10, studiesWithDose: 1,
    }).getPatientExposure('p1');
    // 전리방사선 촬영 10건 중 선량이 기록된 것은 1건 → 누적 2 mSv 는 하한이다
    expect(r.summary.ionizingStudies).toBe(10);
    expect(r.summary.studiesWithDose).toBe(1);
  });

  it('🔴 추정치가 섞였으면 그 사실을 낸다(장비 실측값과 구분)', async () => {
    const r = await setup({
      rows: 2, dosed: 2, sumMsv: 9, yearRows: 2, yearDosed: 2, yearSum: 9,
      estimated: 1, studies: 2, studiesWithDose: 2,
    }).getPatientExposure('p1');
    expect(r.summary.estimatedCount).toBe(1);
  });

  it('자르면 잘랐다고 말한다', async () => {
    const r = await setup({ rows: 250, dosed: 250, sumMsv: 30, yearRows: 10, yearDosed: 10, yearSum: 5, studies: 250, studiesWithDose: 250 })
      .getPatientExposure('p1');
    expect(r.itemsTruncated).toBe(true);
    expect(r.itemLimit).toBe(100);
  });
});
