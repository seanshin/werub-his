import { describe, it, expect, beforeEach, vi } from 'vitest';
import { QualityService } from '../../src/modules/quality/quality.service';

/**
 * 🔴 이 스펙은 종전에 **틀린 판정을 계약으로 굳혀** 두고 있었다.
 *   - `targetValue 80` 에 `value 90` → `meetTarget true`, `value 70` → false
 *     = "모든 지표는 높을수록 좋다"는 단정. 낙상·감염률이 좋아질수록 '미달'이 되던 원인.
 *   - 분모 0 → `value 0 · meetTarget false` = 표본 부재를 '값 0, 미달'로 기록.
 *   정본(`indicator-policy`) 기준으로 갱신한다.
 */
describe('QualityService', () => {
  let service: QualityService;
  let mockPrisma: any;

  const lowerIndicator = { id: 'i1', name: '낙상 발생률', category: '환자안전', formula: '(낙상 발생 건수 / 재원일수) × 1000', targetValue: 1.5 };
  const higherIndicator = { id: 'i2', name: '손위생 수행률', category: '감염관리', formula: '(손위생 수행 횟수 / 손위생 기회 횟수) × 100', targetValue: 95 };
  const unknownIndicator = { id: 'i3', name: '신규 지표 XYZ', category: '기타', formula: '(a / b) × 100', targetValue: 50 };

  beforeEach(() => {
    mockPrisma = {
      qualityIndicator: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
      qiMeasurement: { findMany: vi.fn(), create: vi.fn(), findUnique: vi.fn().mockResolvedValue(null), update: vi.fn() },
    };
    service = new QualityService(mockPrisma);
  });

  it('getIndicators returns active only, with direction/unit resolved', async () => {
    mockPrisma.qualityIndicator.findMany.mockResolvedValue([lowerIndicator]);
    const rows = await service.getIndicators();
    expect(rows).toHaveLength(1);
    expect(mockPrisma.qualityIndicator.findMany).toHaveBeenCalledWith({ where: { isActive: true } });
    expect(rows[0].direction).toBe('LOWER_IS_BETTER');
    expect(rows[0].unit).toBe('건/1000 재원일수'); // 🔴 종전엔 화면이 '%'로 단정했다
  });

  it('createIndicator creates an indicator', async () => {
    const dto = { name: '낙상 발생률', category: '환자안전', formula: '(낙상 발생 건수 / 재원일수) × 1000', targetValue: 1.5 };
    mockPrisma.qualityIndicator.create.mockResolvedValue({ id: 'i1', ...dto });
    expect((await service.createIndicator(dto)).name).toBe('낙상 발생률');
  });

  describe('addMeasurement — 방향은 정본 하나에서만 나온다', () => {
    beforeEach(() => {
      mockPrisma.qiMeasurement.create.mockImplementation(({ data }: any) => Promise.resolve(data));
    });

    it('낮을수록 좋은 지표: 목표 이하면 달성 (🔴 종전 규칙 value>=target 이면 뒤집혔다)', async () => {
      mockPrisma.qualityIndicator.findUnique.mockResolvedValue(lowerIndicator);
      const r = await service.addMeasurement({ indicatorId: 'i1', period: '2026-05', numerator: 1, denominator: 1000 });
      expect(r.value).toBe(1); // × 1000 배율(종전엔 지표 무관 ×100 이라 0.1 로 기록)
      expect(r.meetTarget).toBe(true);
    });

    it('낮을수록 좋은 지표: 목표를 넘으면 미달', async () => {
      mockPrisma.qualityIndicator.findUnique.mockResolvedValue(lowerIndicator);
      const r = await service.addMeasurement({ indicatorId: 'i1', period: '2026-05', numerator: 3, denominator: 1000 });
      expect(r.value).toBe(3);
      expect(r.meetTarget).toBe(false);
    });

    it('높을수록 좋은 지표: 목표 이상이면 달성', async () => {
      mockPrisma.qualityIndicator.findUnique.mockResolvedValue(higherIndicator);
      const r = await service.addMeasurement({ indicatorId: 'i2', period: '2026-05', numerator: 96, denominator: 100 });
      expect(r.value).toBe(96);
      expect(r.meetTarget).toBe(true);
    });

    it('🔴 분모 0 은 값 0 이 아니라 산출 불가 — 거절한다', async () => {
      mockPrisma.qualityIndicator.findUnique.mockResolvedValue(lowerIndicator);
      await expect(
        service.addMeasurement({ indicatorId: 'i1', period: '2026-05', numerator: 0, denominator: 0 }),
      ).rejects.toThrow(/분모/);
      expect(mockPrisma.qiMeasurement.create).not.toHaveBeenCalled();
    });

    /**
     * 🔴 2026-08-18 계약 변경 — 방향 미등재는 **거절하지 않는다**.
     *    종전 422 는 측정값(사실)을 통째로 버렸다. 이제 저장하되 판정만 비운다.
     */
    it('🔴 방향을 모르면 거절이 아니라 meet_target = null 로 저장한다(측정값을 버리지 않는다)', async () => {
      mockPrisma.qualityIndicator.findUnique.mockResolvedValue(unknownIndicator);
      const r = await service.addMeasurement({ indicatorId: 'i3', period: '2026-05', numerator: 60, denominator: 100 });
      expect(mockPrisma.qiMeasurement.create).toHaveBeenCalled();
      expect(mockPrisma.qiMeasurement.create.mock.calls[0][0].data.meetTarget).toBeNull();
      expect(r.meetTarget).toBeNull();          // 🔴 모르는 것을 '달성'으로 접지 않는다
      expect(r.undetermined).toBe(true);
      expect(r.undeterminedReason).toBe('DIRECTION_NOT_REGISTERED');
    });

    it('방향을 명시하면 지표에 등재되고 그 자리에서 판정된다', async () => {
      mockPrisma.qualityIndicator.findUnique.mockResolvedValue(unknownIndicator);
      mockPrisma.qualityIndicator.update.mockImplementation(({ data }: any) =>
        Promise.resolve({ ...unknownIndicator, ...data }),
      );
      const r = await service.addMeasurement({
        indicatorId: 'i3', period: '2026-05', numerator: 60, denominator: 100, direction: 'HIGHER_IS_BETTER',
      });
      expect(r.meetTarget).toBe(true);
      // 🔴 한 건만 판정하고 버리면 읽는 시점 재판정과 갈라진다(P12) → 컬럼에 등재한다
      expect(mockPrisma.qualityIndicator.update).toHaveBeenCalledWith({
        where: { id: 'i3' }, data: { direction: 'HIGHER_IS_BETTER' },
      });
      expect(r.directionRegistered).toBe(true);
      expect(r.directionSource).toBe('COLUMN');
    });

    it('없는 지표는 404', async () => {
      mockPrisma.qualityIndicator.findUnique.mockResolvedValue(null);
      await expect(
        service.addMeasurement({ indicatorId: 'nope', period: '2026-05', numerator: 1, denominator: 10 }),
      ).rejects.toThrow();
    });
  });

  it('getMeasurements — 저장된 meet_target 을 믿지 않고 정본으로 재판정한다', async () => {
    mockPrisma.qualityIndicator.findUnique.mockResolvedValue(lowerIndicator);
    mockPrisma.qiMeasurement.findMany.mockResolvedValue([
      { id: 'm1', period: '2026-05', value: 1.2, meetTarget: false }, // 옛 규칙(value>=target)으로 잘못 기록된 행
    ]);
    const rows = await service.getMeasurements('i1');
    expect(rows).toHaveLength(1);
    expect(rows[0].meetTarget).toBe(true);
    expect(rows[0].storedMeetTarget).toBe(false);
  });

  describe('getDashboard', () => {
    it('최신 측정 + 정본 판정 + 단위를 함께 내려준다', async () => {
      mockPrisma.qualityIndicator.findMany.mockResolvedValue([
        { ...lowerIndicator, measurements: [{ value: 0.8, period: '2026-05', meetTarget: false, measuredAt: new Date('2026-05-31') }] },
        { ...higherIndicator, measurements: [] },
      ]);
      const result = await service.getDashboard();
      expect(result[0].latestValue).toBe(0.8);
      expect(result[0].meetTarget).toBe(true);      // 낮을수록 좋음 · 0.8 ≤ 1.5
      expect(result[0].latestPeriod).toBe('2026-05');
      expect(result[0].achievementPercent).toBe(100);
      expect(result[1].latestValue).toBeNull();
      expect(result[1].meetTarget).toBeNull();       // 🔴 미측정은 '미달'(false)이 아니다
    });

    it('🔴 인공호흡기 관련 폐렴 발생률 1.51(목표 2.0)은 달성이다 — seed 키워드에 폐렴이 없어 미달로 표시되던 지표', async () => {
      mockPrisma.qualityIndicator.findMany.mockResolvedValue([
        {
          id: 'vap', name: '인공호흡기 관련 폐렴 발생률', category: '감염관리',
          formula: '(VAP 건수 / 인공호흡기 유치일수) × 1000', targetValue: 2.0,
          measurements: [{ value: 1.51, period: '2026-05', meetTarget: false, measuredAt: new Date('2026-05-31') }],
        },
      ]);
      const [row] = await service.getDashboard();
      expect(row.direction).toBe('LOWER_IS_BETTER');
      expect(row.meetTarget).toBe(true);
    });

    it('응답은 배열을 유지한다(대시보드 위젯 계약)', async () => {
      mockPrisma.qualityIndicator.findMany.mockResolvedValue([]);
      expect(Array.isArray(await service.getDashboard())).toBe(true);
    });
  });
});
