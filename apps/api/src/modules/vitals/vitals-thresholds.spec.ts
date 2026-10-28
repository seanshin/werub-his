import { describe, it, expect } from 'vitest';
import { VITALS_THRESHOLDS, mergeVitalsThresholds, mergeVitalsThresholdsDetailed, evaluateVitals } from './vitals-evaluate';

/** P0-a③ 3중 정본 통합 — 수치 선언은 vitals-evaluate 하나. 병합은 fail-safe. */
describe('활력 임계 정본·병합', () => {
  it('warn 층이 정본에 편입되어 있다(record-issues 종전 값)', () => {
    expect(VITALS_THRESHOLDS.systolicBp).toMatchObject({ low: 80, high: 180, warnLow: 90, warnHigh: 140 });
    expect(VITALS_THRESHOLDS.heartRate).toMatchObject({ warnLow: 60, warnHigh: 100 });
    expect(VITALS_THRESHOLDS.spo2).toMatchObject({ low: 90, warnLow: 95 });
    expect(VITALS_THRESHOLDS.respiratoryRate).toMatchObject({ warnHigh: 22 });
    expect(VITALS_THRESHOLDS.temperature).toMatchObject({ warnHigh: 37.5 });
  });

  it('부분 오버라이드 병합 — 지정 필드만 바뀐다', () => {
    const t = mergeVitalsThresholds({ systolicBp: { high: 170 } });
    expect(t.systolicBp.high).toBe(170);
    expect(t.systolicBp.low).toBe(80);
    expect(t.heartRate).toEqual(VITALS_THRESHOLDS.heartRate);
  });

  it('역전값(low≥high)은 해당 항목 무시 — 판정이 죽지 않는다(fail-safe)', () => {
    const t = mergeVitalsThresholds({ systolicBp: { low: 200 } });
    expect(t.systolicBp).toEqual(VITALS_THRESHOLDS.systolicBp);
  });

  it('비객체·잡값 오버라이드는 기본값 그대로', () => {
    expect(mergeVitalsThresholds('broken')).toEqual(VITALS_THRESHOLDS);
    expect(mergeVitalsThresholds({ systolicBp: { high: 'x' } }).systolicBp.high).toBe(180);
  });

  it('오버라이드가 판정에 실제 반영된다', () => {
    const t = mergeVitalsThresholds({ systolicBp: { high: 170 } });
    expect(evaluateVitals({ systolicBp: 175 }, t).isAbnormal).toBe(true);
    expect(evaluateVitals({ systolicBp: 175 }).isAbnormal).toBe(false); // 기본 180 미만
  });

  /**
   * 🔴 (2026-09-03) "무시"가 조용하면 환자안전위가 개정한 임계가 반영되지 않은 채
   *    화면은 "적용됨"이라 말한다 — 무엇을 버렸는지 돌려줘야 관측·고지가 가능하다.
   */
  it('🔴 미상 키(오타·개명)를 조용히 버리지 않는다 — droppedKeys 로 말한다', () => {
    const r = mergeVitalsThresholdsDetailed({ sbp: { high: 170 }, systolicBp: { high: 175 } });
    expect(r.droppedKeys).toEqual(['sbp']);
    expect(r.thresholds.systolicBp.high).toBe(175); // 정상 키는 반영(대조군)
  });

  it('🔴 역전으로 무시된 항목을 invertedKeys 로 말한다', () => {
    const r = mergeVitalsThresholdsDetailed({ systolicBp: { low: 200 } });
    expect(r.invertedKeys).toEqual(['systolicBp']);
    expect(r.thresholds.systolicBp).toEqual(VITALS_THRESHOLDS.systolicBp);
  });

  it('전부 정상이면 dropped/inverted 는 빈 배열(거짓 경보 금지 — 대조군)', () => {
    const r = mergeVitalsThresholdsDetailed({ systolicBp: { high: 170 } });
    expect(r.droppedKeys).toEqual([]);
    expect(r.invertedKeys).toEqual([]);
  });

  it('record-issues 룰이 정본에서 유도된다(이중 선언 부재)', async () => {
    const src = await import('node:fs').then((fs) => fs.readFileSync(require.resolve('../record-timeline/record-issues.ts'), 'utf8'));
    // 위급 수치 리터럴이 record-issues 에 남아 있으면 이중 선언 재발
    expect(src).not.toMatch(/critHigh:\s*180/);
    expect(src).not.toMatch(/critLow:\s*80/);
    expect(src).toContain('buildVitalRules');
  });
});
