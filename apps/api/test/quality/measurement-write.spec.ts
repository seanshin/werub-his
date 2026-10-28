import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { QualityService } from '../../src/modules/quality/quality.service';
import { MEASUREMENT_VALUE_MAX } from '../../src/modules/quality/indicator-policy';

/**
 * 가드 — 측정값 **쓰기·읽기 계약** (측정값 입력 화면 신설, 2026-08-18)
 *
 * 화면(`web/(main)/quality/MeasurementPanel.tsx`)이 사실을 말할 수 있으려면 서버가 다음을 지켜야 한다.
 * 각 항목은 **결함을 재주입하면 실패한다**.
 *
 *   1. 저장 응답이 **적용 배율·단위**를 함께 낸다 — 화면이 배율을 지어내지 않게(같은 분자/분모라도
 *      배율이 다르면 값이 달라진다).
 *   2. 분모 0 은 **거절**한다 — 표본 부재를 '값 0' 으로 적지 않는다.
 *   3. `Decimal(5,2)` 한도를 넘는 산출값은 **BadRequest 로 거절**한다 —
 *      종전엔 Prisma `numeric field overflow` 로 500 이 나가 화면이 원인을 말할 수 없었고,
 *      값을 잘라 넣으면 잘린 줄 모르는 수치가 원장에 남는다.
 *   4. 방향 미등재는 **막지 않고** 저장하되 `meetTarget=null` + 사유를 낸다.
 *   5. 읽기(`getMeasurements`)는 저장값이 아니라 **정본으로 재판정**하고, 저장값과 갈리면
 *      `storedDiverges` 로 드러낸다(어느 한쪽을 조용히 지우지 않는다).
 */
describe('QualityService — 측정값 입력 화면 계약', () => {
  let service: QualityService;
  let mockPrisma: any;

  /** ×1000 지표(낙상) — 배율을 ×100 으로 접으면 3.0 이 0.3 으로 기록된다 */
  const fall = {
    id: 'i1',
    name: '낙상 발생률',
    category: '환자안전',
    formula: '(낙상 발생 건수 / 재원일수) × 1000',
    targetValue: 1.5,
  };
  /** 방향·단위·배율이 어디에도 없는 신규 지표 */
  const unknownIndicator = {
    id: 'i3',
    name: '신규 지표 XYZ',
    category: '기타',
    formula: '분자 대비 분모',
    targetValue: 50,
  };

  beforeEach(() => {
    mockPrisma = {
      qualityIndicator: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
      qiMeasurement: { findMany: vi.fn(), create: vi.fn(), findUnique: vi.fn().mockResolvedValue(null), update: vi.fn() },
    };
    mockPrisma.qiMeasurement.create.mockImplementation(({ data }: any) => Promise.resolve({ id: 'm1', ...data }));
    service = new QualityService(mockPrisma);
  });

  it('🔴 저장 응답이 적용 배율·단위를 함께 낸다 (화면이 배율을 지어내지 않게)', async () => {
    mockPrisma.qualityIndicator.findUnique.mockResolvedValue(fall);
    const r = await service.addMeasurement({ indicatorId: 'i1', period: '2026-06', numerator: 3, denominator: 1000 });
    expect(r.value).toBe(3); // ×1000 — ×100 이면 0.3 이다
    expect(r.valueScale).toBe(1000);
    expect(r.valueScaleKnown).toBe(true);
    expect(r.valueScaleSource).toBe('FORMULA');
    expect(r.unit).toBe('건/1000 재원일수');
    expect(r.target).toBe(1.5);
  });

  it('🔴 배율이 어디에도 없으면 가정임을 밝힌다 (등재된 것처럼 말하지 않는다)', async () => {
    mockPrisma.qualityIndicator.findUnique.mockResolvedValue(unknownIndicator);
    const r = await service.addMeasurement({ indicatorId: 'i3', period: '2026-06', numerator: 4, denominator: 8 });
    expect(r.valueScale).toBe(100);
    expect(r.valueScaleKnown).toBe(false);
    expect(r.valueScaleSource).toBe('ASSUMED');
  });

  it('🔴 분모 0 은 거절한다 — 표본 부재를 값 0 으로 적지 않는다', async () => {
    mockPrisma.qualityIndicator.findUnique.mockResolvedValue(fall);
    await expect(
      service.addMeasurement({ indicatorId: 'i1', period: '2026-06', numerator: 3, denominator: 0 }),
    ).rejects.toThrow(BadRequestException);
    expect(mockPrisma.qiMeasurement.create).not.toHaveBeenCalled();
  });

  it('🔴 Decimal(5,2) 한도를 넘는 산출값은 저장하지 않고 이유와 함께 거절한다 (500 도, 자른 값도 아니다)', async () => {
    mockPrisma.qualityIndicator.findUnique.mockResolvedValue(fall);
    // 50/1 × 1000 = 50,000 — 한도 999.99 초과
    await expect(
      service.addMeasurement({ indicatorId: 'i1', period: '2026-06', numerator: 50, denominator: 1 }),
    ).rejects.toThrow(new RegExp(String(MEASUREMENT_VALUE_MAX).replace('.', '\\.')));
    expect(mockPrisma.qiMeasurement.create).not.toHaveBeenCalled();
  });

  it('한도 안(999.99)은 그대로 저장한다 — 과잉 차단이 아니다', async () => {
    mockPrisma.qualityIndicator.findUnique.mockResolvedValue(fall);
    const r = await service.addMeasurement({ indicatorId: 'i1', period: '2026-06', numerator: 999, denominator: 1000 });
    expect(r.value).toBe(999);
    expect(mockPrisma.qiMeasurement.create).toHaveBeenCalled();
  });

  it('🔴 방향 미등재는 막지 않고 저장하되 판정 불가 + 사유를 낸다', async () => {
    mockPrisma.qualityIndicator.findUnique.mockResolvedValue(unknownIndicator);
    const r = await service.addMeasurement({ indicatorId: 'i3', period: '2026-06', numerator: 4, denominator: 8 });
    expect(mockPrisma.qiMeasurement.create).toHaveBeenCalled();
    expect(r.meetTarget).toBeNull();
    expect(r.undetermined).toBe(true);
    expect(r.undeterminedReason).toBe('DIRECTION_NOT_REGISTERED');
  });

  describe('getMeasurements — 읽는 시점 재판정이 정본', () => {
    it('🔴 저장값과 재판정이 갈리면 storedDiverges 로 드러낸다 (저장값을 그대로 내려주면 실패)', async () => {
      mockPrisma.qualityIndicator.findUnique.mockResolvedValue(fall);
      mockPrisma.qiMeasurement.findMany.mockResolvedValue([
        // 옛 규칙("전 지표 높을수록 좋음")으로 true 가 박힌 행 — 낙상 3.0 은 목표 1.5 초과라 미달이다
        { id: 'm1', period: '2026-06', numerator: 3, denominator: 1000, value: 3, meetTarget: true, measuredAt: new Date() },
        // 저장값과 재판정이 일치하는 행
        { id: 'm2', period: '2026-05', numerator: 1, denominator: 1000, value: 1, meetTarget: true, measuredAt: new Date() },
      ]);
      const rows = await service.getMeasurements('i1');
      expect(rows[0].meetTarget).toBe(false);
      expect(rows[0].storedMeetTarget).toBe(true);
      expect(rows[0].storedDiverges).toBe(true);
      expect(rows[1].meetTarget).toBe(true);
      expect(rows[1].storedDiverges).toBe(false);
    });

    it('🔴 이력에도 적용 배율을 함께 내려 화면이 배율을 밝힐 수 있게 한다', async () => {
      mockPrisma.qualityIndicator.findUnique.mockResolvedValue(fall);
      mockPrisma.qiMeasurement.findMany.mockResolvedValue([
        { id: 'm1', period: '2026-06', numerator: 3, denominator: 1000, value: 3, meetTarget: false, measuredAt: new Date() },
      ]);
      const rows = await service.getMeasurements('i1');
      expect(rows[0].valueScale).toBe(1000);
      expect(rows[0].valueScaleSource).toBe('FORMULA');
      expect(rows[0].unit).toBe('건/1000 재원일수');
      expect(rows[0].target).toBe(1.5);
    });

    it('저장값이 null(판정 불가)인데 재판정도 null 이면 갈린 것이 아니다 — 거짓 경보를 내지 않는다', async () => {
      mockPrisma.qualityIndicator.findUnique.mockResolvedValue(unknownIndicator);
      mockPrisma.qiMeasurement.findMany.mockResolvedValue([
        { id: 'm1', period: '2026-06', numerator: 4, denominator: 8, value: 50, meetTarget: null, measuredAt: new Date() },
      ]);
      const rows = await service.getMeasurements('i3');
      expect(rows[0].meetTarget).toBeNull();
      expect(rows[0].storedDiverges).toBe(false);
      expect(rows[0].undeterminedReason).toBe('DIRECTION_NOT_REGISTERED');
    });
  });
});
