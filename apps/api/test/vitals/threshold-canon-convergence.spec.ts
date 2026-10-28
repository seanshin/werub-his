/**
 * 활력 임계 정본 수렴(2026-10-01) — 서버 측 행동.
 *  · 담당 환자 상태(의사 센서스)가 자기 숫자(HR>140 위급·SBP>160 불안정)가 아니라 정본(+개정)으로 판정한다
 *  · 화면용 `GET /api/v1/vitals-thresholds` 는 병합본·출처를 준다(로그인한 모든 직원 — 클래스 @Roles 없음)
 */
import { describe, it, expect, vi } from 'vitest';
import { DoctorsService } from '../../src/modules/doctors/doctors.service';
import { VitalsThresholdsController } from '../../src/modules/vitals/vitals-thresholds.controller';
import { VITALS_THRESHOLDS, mergeVitalsThresholds } from '@hospital-run/shared';

const classify = (v: Record<string, unknown> | null, T = VITALS_THRESHOLDS) =>
  (new DoctorsService({} as never) as unknown as { classifyStatus: (...a: unknown[]) => string }).classifyStatus(v, T, '7병동', 0, 5, false);

describe('담당 환자 상태 — 임계 정본', () => {
  it('🔴 HR 135 는 위급(정본 130) — 종전 자기 기준(>140)으로는 불안정이었다', () => {
    expect(classify({ heartRate: 135 })).toBe('CRITICAL');
  });
  it('주의 역치(HR 100)는 불안정 · 정상은 안정', () => {
    expect(classify({ heartRate: 100 })).toBe('UNSTABLE');
    expect(classify({ heartRate: 80, systolicBp: 120, spo2: 98, temperature: 36.8 })).toBe('STABLE');
  });
  it('🔴 측정된 0 은 위급(종전 `v.spo2 &&` 는 SpO2 0 을 건너뛰었다) · 미측정은 판정하지 않는다', () => {
    expect(classify({ spo2: 0 })).toBe('CRITICAL');
    expect(classify({ spo2: null })).toBe('STABLE');
  });
  it('환자안전위 개정을 따른다', () => {
    const T = mergeVitalsThresholds({ heartRate: { high: 150 } });
    expect(classify({ heartRate: 135 }, T)).toBe('UNSTABLE');
  });
  it('통증은 상태 판정에 넣지 않는다(종전과 같음)', () => {
    expect(classify({ painScore: 9, heartRate: 80 })).toBe('STABLE');
  });
});

describe('적용 임계 EP', () => {
  it('서비스의 병합본·출처를 그대로 준다', async () => {
    const eff = { thresholds: VITALS_THRESHOLDS, source: 'DEFAULT', droppedKeys: [], invertedKeys: [] };
    const c = new VitalsThresholdsController({ effectiveThresholds: vi.fn(async () => eff) } as never);
    expect(await c.get()).toEqual({ data: eff });
  });
  it('🔴 클래스에 @Roles 가 없다(차트를 보는 모든 역할이 같은 기준을 받는다)', () => {
    expect(Reflect.getMetadata('roles', VitalsThresholdsController)).toBeUndefined();
  });
});
