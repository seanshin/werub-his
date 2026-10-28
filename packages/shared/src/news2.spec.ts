import { describe, it, expect } from 'vitest';
import { scoreNews2, canScoreNews2, normalizeAcvpu, NEWS2_RISK_LABEL, news2MonitoringReference } from './news2';

/**
 * NEWS2 정본 가드 — RCP 2017.
 *
 * 🔴 수렴 전 이 병원에는 채점판이 네 벌 있었고, 같은 활력에 **다른 점수와 다른 등급**이 나왔다.
 *    ① BE 정본(RCP 정합) ② ICU(밴드 다름·부분 합산) ③ FE 간호WS(보충산소 항목 없음) ④ 차트 표.
 *    이 파일이 그 하나의 진실이다.
 */
const NORMAL = {
  respiratoryRate: 16, spO2: 98, supplementalO2: false,
  systolicBp: 120, heartRate: 72, temperature: 36.8, consciousness: 'ALERT',
} as const;

describe('NEWS2 정본 (RCP 2017)', () => {
  it('정상 활력 → 0점 LOW', () => {
    const r = scoreNews2(NORMAL)!;
    expect(r.totalScore).toBe(0);
    expect(r.riskLevel).toBe('LOW');
    expect(r.escalationRequired).toBe(false);
  });

  it('🔴 총점 1~4 는 LOW 다 — ICU 판은 이것을 LOW_MEDIUM 으로 한 단계 올려 불렀다', () => {
    const r = scoreNews2({ ...NORMAL, heartRate: 100 })!; // HR 91–110 = 1점
    expect(r.totalScore).toBe(1);
    expect(r.riskLevel).toBe('LOW');
  });

  it('🔴 단일 3점은 LOW_MEDIUM 이다 — ICU 판은 MEDIUM 이라 같은 환자가 화면마다 달랐다', () => {
    const r = scoreNews2({ ...NORMAL, systolicBp: 88 })!; // SBP ≤90 = 3점
    expect(r.totalScore).toBe(3);
    expect(r.hasIndividual3).toBe(true);
    expect(r.riskLevel).toBe('LOW_MEDIUM');
    // red score 는 총점과 무관하게 긴급 검토 대상이다
    expect(r.escalationRequired).toBe(true);
  });

  it('총점 5~6 = MEDIUM · 7 이상 = HIGH', () => {
    // RR 22(2) + HR 115(2) + Temp 38.5(1) = 5
    expect(scoreNews2({ ...NORMAL, respiratoryRate: 22, heartRate: 115, temperature: 38.5 })!.riskLevel).toBe('MEDIUM');
    // 위에 SpO2 93(2) 추가 = 7
    expect(scoreNews2({ ...NORMAL, respiratoryRate: 22, heartRate: 115, temperature: 38.5, spO2: 93 })!.riskLevel).toBe('HIGH');
  });

  it('🔴 총점이 5 이상이면 단일 3점이 있어도 MEDIUM 이상이다(등급을 낮추지 않는다)', () => {
    // SBP 88(3) + RR 22(2) = 5 → 단일 3점이 있지만 MEDIUM
    const r = scoreNews2({ ...NORMAL, systolicBp: 88, respiratoryRate: 22 })!;
    expect(r.totalScore).toBe(5);
    expect(r.hasIndividual3).toBe(true);
    expect(r.riskLevel).toBe('MEDIUM');
  });

  it('🔴 보충산소는 2점이며 red score 가 아니다', () => {
    const r = scoreNews2({ ...NORMAL, supplementalO2: true })!;
    expect(r.scoreBreakdown.o2).toBe(2);
    expect(r.totalScore).toBe(2);
    expect(r.hasIndividual3).toBe(false);
    expect(r.riskLevel).toBe('LOW');
  });

  describe('SpO₂ Scale 2 (COPD 등·목표 88–92%)', () => {
    it('실내공기에서 SpO₂ ≥88 은 정상(0점) — 상단 밴드를 무조건 적용하면 허위 고위험이 된다', () => {
      const r = scoreNews2({ ...NORMAL, spO2Scale: 2, spO2: 90, supplementalO2: false })!;
      expect(r.scoreBreakdown.spo2).toBe(0);
    });
    it('보충산소 중 SpO₂ 97 이상은 3점(과산소)', () => {
      const r = scoreNews2({ ...NORMAL, spO2Scale: 2, spO2: 98, supplementalO2: true })!;
      expect(r.scoreBreakdown.spo2).toBe(3);
    });
  });

  describe('산출 가능 여부 — 미관측은 0점이 아니다', () => {
    it('보충산소 미관측이면 산출하지 않는다(2점이 조용히 사라진다)', () => {
      const { supplementalO2, ...rest } = NORMAL;
      expect(canScoreNews2(rest)).toBe(false);
      expect(scoreNews2(rest)).toBeNull();
    });
    it('의식 미관측이면 산출하지 않는다(3점이 조용히 사라진다)', () => {
      const { consciousness, ...rest } = NORMAL;
      expect(scoreNews2(rest)).toBeNull();
    });
    it('수치가 하나라도 없으면 산출하지 않는다', () => {
      const { respiratoryRate, ...rest } = NORMAL;
      expect(scoreNews2(rest)).toBeNull();
    });
    it('NaN·문자열 수치는 관측으로 인정하지 않는다', () => {
      expect(scoreNews2({ ...NORMAL, heartRate: NaN })).toBeNull();
      expect(scoreNews2({ ...NORMAL, spO2: '98' as unknown as number })).toBeNull();
    });
  });

  describe('의식 어휘 — 두 벌을 여기서 한 번만 접는다', () => {
    it('구 AVPU "VERBAL"(ICU·플로우시트 운영 실측 4건)은 VOICE 로 접힌다', () => {
      expect(normalizeAcvpu('VERBAL')).toBe('VOICE');
      expect(scoreNews2({ ...NORMAL, consciousness: 'VERBAL' })!.scoreBreakdown.consciousness).toBe(3);
    });
    it('대소문자·공백 혼재(시드 "Alert")를 접는다', () => {
      expect(normalizeAcvpu(' alert ')).toBe('ALERT');
    });
    it('🔴 한글 5단계는 한 칸도 접지 않는다 — "명료"만 접으면 깨어 있는 환자만 채점된다', () => {
      // '명료'만 ALERT 로 접으면 기면·혼미 환자는 채점에서 빠지고, 보드는 정상 환자만 보고 조용해진다.
      // ACVPU 와 다른 척도는 통째로 산출 불가다(임의 대응은 임상 내용 날조이기도 하다).
      for (const v of ['명료', '기면', '혼미', '반혼수', '혼수']) {
        expect(normalizeAcvpu(v)).toBeNull();
        expect(scoreNews2({ ...NORMAL, consciousness: v })).toBeNull(); // 0점도 3점도 아니다
      }
    });
  });

  it('결정적 — 같은 입력은 같은 결과', () => {
    const a = scoreNews2({ ...NORMAL, respiratoryRate: 22, spO2: 93 });
    const b = scoreNews2({ ...NORMAL, respiratoryRate: 22, spO2: 93 });
    expect(a).toEqual(b);
  });

  it('표시 라벨 정본이 4등급 전부를 덮는다', () => {
    expect(Object.keys(NEWS2_RISK_LABEL).sort()).toEqual(['HIGH', 'LOW', 'LOW_MEDIUM', 'MEDIUM']);
  });
});

describe('재측정 빈도 참고(RCP · 원내 규정 아님)', () => {
  it('점수대별 — 7 이상 연속 · 5~6 1시간 · 단일 3점 1시간 · 1~4 4~6시간 · 0 12시간', () => {
    expect(news2MonitoringReference({ totalScore: 7 })).toMatchObject({ band: 'HIGH', minIntervalHours: null });
    expect(news2MonitoringReference({ totalScore: 5 })).toMatchObject({ band: 'MEDIUM', minIntervalHours: 1 });
    expect(news2MonitoringReference({ totalScore: 3, hasIndividual3: true })).toMatchObject({ band: 'SINGLE_3', minIntervalHours: 1 });
    expect(news2MonitoringReference({ totalScore: 2 })).toMatchObject({ band: 'LOW', minIntervalHours: 4 });
    expect(news2MonitoringReference({ totalScore: 0 })).toMatchObject({ band: 'ZERO', minIntervalHours: 12 });
  });
  it('🔴 점수를 모르면 참고도 없다(null)', () => {
    expect(news2MonitoringReference(null)).toBeNull();
    expect(news2MonitoringReference({ totalScore: Number.NaN })).toBeNull();
  });
});
