import { describe, it, expect } from 'vitest';
import { scoreNews2, type News2Input } from '@hospital-run/shared';
import { SCORING_DEFS } from '@/lib/clinical-charts/definitions/scoring';

/**
 * NEWS2 선언 채점표 ↔ 정본 기계 대조.
 *
 * 🔴 `clinical-charts/definitions/scoring.ts` 의 NEWS2 표는 **수기로 적은 네 번째 판**이다.
 *    표는 사람이 클릭하는 UI 라 코드로 대체할 수 없지만, 숫자가 정본과 어긋나면
 *    같은 환자가 차트에서 다른 점수를 받는다(P12). 그래서 표를 정본으로 **채점해 본다**.
 *
 * 재주입 시 실패: 표의 옵션 점수나 밴드를 하나라도 바꾸면 이 가드가 잡는다.
 */
const chart = SCORING_DEFS.find((c) => c.chartId === 'NEWS2')!;
const cat = (key: string) => chart.categories.find((c) => c.key === key)!;
/** 표의 옵션 점수 = 정본이 같은 값에 주는 점수여야 한다 */
const optionScore = (key: string, label: string) =>
  cat(key).options.find((o) => o.label === label)!.score;

const BASE: News2Input = {
  respiratoryRate: 16, spO2: 98, supplementalO2: false,
  systolicBp: 120, heartRate: 72, temperature: 36.8, consciousness: 'ALERT',
};
const canon = (over: Partial<News2Input>) => scoreNews2({ ...BASE, ...over })!.scoreBreakdown;

describe('NEWS2 채점표 ↔ 정본 대조', () => {
  it('표가 존재하고 7요소를 전부 갖는다(보충산소 포함)', () => {
    expect(chart).toBeDefined();
    expect(chart.categories.map((c) => c.key).sort()).toEqual(['acvpu', 'hr', 'o2', 'rr', 'sbp', 'spo2', 'temp']);
  });

  it('호흡수 밴드가 정본과 같다', () => {
    expect(optionScore('rr', '≤8')).toBe(canon({ respiratoryRate: 8 }).rr);
    expect(optionScore('rr', '9–11')).toBe(canon({ respiratoryRate: 10 }).rr);
    expect(optionScore('rr', '12–20')).toBe(canon({ respiratoryRate: 16 }).rr);
    expect(optionScore('rr', '21–24')).toBe(canon({ respiratoryRate: 22 }).rr);
    expect(optionScore('rr', '≥25')).toBe(canon({ respiratoryRate: 26 }).rr);
  });

  it('SpO₂(Scale 1) 밴드가 정본과 같다', () => {
    expect(optionScore('spo2', '≤91')).toBe(canon({ spO2: 90 }).spo2);
    expect(optionScore('spo2', '92–93')).toBe(canon({ spO2: 93 }).spo2);
    expect(optionScore('spo2', '94–95')).toBe(canon({ spO2: 95 }).spo2);
    expect(optionScore('spo2', '≥96')).toBe(canon({ spO2: 98 }).spo2);
  });

  it('보충산소가 2점이다 — FE 간호 워크스테이션 판에는 이 항목이 통째로 없었다', () => {
    expect(optionScore('o2', '예')).toBe(canon({ supplementalO2: true }).o2);
    expect(optionScore('o2', '아니오')).toBe(canon({ supplementalO2: false }).o2);
  });

  it('수축기혈압 밴드가 정본과 같다', () => {
    expect(optionScore('sbp', '≤90')).toBe(canon({ systolicBp: 88 }).bp);
    expect(optionScore('sbp', '91–100')).toBe(canon({ systolicBp: 95 }).bp);
    expect(optionScore('sbp', '101–110')).toBe(canon({ systolicBp: 105 }).bp);
    expect(optionScore('sbp', '111–219')).toBe(canon({ systolicBp: 120 }).bp);
    expect(optionScore('sbp', '≥220')).toBe(canon({ systolicBp: 230 }).bp);
  });

  it('맥박 밴드가 정본과 같다', () => {
    expect(optionScore('hr', '≤40')).toBe(canon({ heartRate: 38 }).hr);
    expect(optionScore('hr', '41–50')).toBe(canon({ heartRate: 45 }).hr);
    expect(optionScore('hr', '51–90')).toBe(canon({ heartRate: 72 }).hr);
    expect(optionScore('hr', '91–110')).toBe(canon({ heartRate: 100 }).hr);
    expect(optionScore('hr', '111–130')).toBe(canon({ heartRate: 120 }).hr);
    expect(optionScore('hr', '≥131')).toBe(canon({ heartRate: 140 }).hr);
  });

  it('체온 밴드가 정본과 같다', () => {
    expect(optionScore('temp', '≤35.0')).toBe(canon({ temperature: 34.5 }).temp);
    expect(optionScore('temp', '35.1–36.0')).toBe(canon({ temperature: 35.6 }).temp);
    expect(optionScore('temp', '36.1–38.0')).toBe(canon({ temperature: 36.8 }).temp);
    expect(optionScore('temp', '38.1–39.0')).toBe(canon({ temperature: 38.5 }).temp);
    expect(optionScore('temp', '≥39.1')).toBe(canon({ temperature: 39.5 }).temp);
  });

  it('의식(ACVPU) — A=0, 그 외 3', () => {
    expect(optionScore('acvpu', 'A (명료)')).toBe(canon({ consciousness: 'ALERT' }).consciousness);
    expect(optionScore('acvpu', 'C/V/P/U')).toBe(canon({ consciousness: 'VOICE' }).consciousness);
  });

  it('위험 밴드 경계가 정본 등급과 일치한다(5=중위험·7=고위험)', () => {
    const bandOf = (score: number) => chart.bands!.find((b) => score >= b.min && score <= b.max)!;
    expect(bandOf(0).label).toBe('저위험');
    expect(bandOf(4).label).toBe('저위험');
    expect(bandOf(5).label).toBe('중위험');
    expect(bandOf(7).label).toBe('고위험');
    // 정본 등급과 대조 — 총점만으로 정해지는 구간
    expect(scoreNews2({ ...BASE, respiratoryRate: 22, heartRate: 115, temperature: 38.5 })!.riskLevel).toBe('MEDIUM');
  });

  it('🔴 단일 3점 규칙은 밴드로 표현할 수 없다 — 표는 그 사실을 note 로 말해야 한다', () => {
    // 총점 3(단일 3점)은 표에서 '저위험' 밴드지만 정본은 LOW_MEDIUM(긴급 검토)이다.
    expect(scoreNews2({ ...BASE, systolicBp: 88 })!.riskLevel).toBe('LOW_MEDIUM');
    expect(chart.note ?? '').toContain('단일 항목 3점');
  });
});
