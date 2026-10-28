import { describe, it, expect } from 'vitest';
import { extractIssues, dedupeIssues, CRITICAL_LAB, type IssueInput } from '../../src/modules/record-timeline/record-issues';

/**
 * 이슈 추출 골든 — 2026-07-30.
 * 불변: 위급은 역치 표에 한정 · 모든 이슈에 판정 근거(why) · 없는 정보로 판정하지 않음 · 추세는 직전 값과만.
 */
const lab = (at: string, id: string, results: IssueInput['results']): IssueInput => ({ type: 'LAB', at, id, results });
const vital = (at: string, id: string, vitals: IssueInput['vitals']): IssueInput => ({ type: 'VITALS', at, id, vitals });

describe('검사 — 위급(CRITICAL)', () => {
  it('위급 역치 도달 시 CRITICAL + 이유를 낸다', () => {
    const r = extractIssues([lab('2026-07-10T00:00:00Z', 'l1', [{ name: 'K', value: '6.8', unit: 'mmol/L', flag: 'H', refLow: 3.5, refHigh: 5.1 }])]);
    expect(r[0]).toMatchObject({ level: 'CRITICAL', category: '검사', label: 'K', value: '6.8 mmol/L' });
    expect(r[0].why).toContain('위급 기준');
    expect(r[0].why).toContain('부정맥');
    expect(r[0].source).toEqual({ type: 'LAB', id: 'l1' });
  });

  it('저역치 위급도 방향을 구분해 설명', () => {
    const r = extractIssues([lab('2026-07-10T00:00:00Z', 'l1', [{ name: 'Glucose', value: '44', unit: 'mg/dL', flag: 'L', refLow: 70, refHigh: 100 }])]);
    expect(r[0].level).toBe('CRITICAL');
    expect(r[0].why).toContain('이하');
    expect(r[0].why).toContain('저혈당');
  });

  it('역치 표에 없는 항목은 위급으로 올리지 않는다(과잉 경보 방지)', () => {
    expect(CRITICAL_LAB.HBA1C).toBeUndefined();
    const r = extractIssues([lab('2026-07-10T00:00:00Z', 'l1', [{ name: 'HbA1c', value: '9.9', unit: '%', flag: 'H', refLow: 4, refHigh: 5.7 }])]);
    expect(r[0].level).toBe('WARN');
  });
});

describe('검사 — 참고범위 이탈(WARN)', () => {
  it('flag H 는 상회로 설명하고 참고범위를 인용', () => {
    const r = extractIssues([lab('2026-07-10T00:00:00Z', 'l1', [{ name: 'WBC', value: '13200', unit: '/μL', flag: 'H', refLow: 4000, refHigh: 10000 }])]);
    expect(r[0]).toMatchObject({ level: 'WARN', label: 'WBC' });
    expect(r[0].why).toContain('참고범위 4000~10000');
    expect(r[0].why).toContain('상회');
  });

  it('참고범위가 없으면 "미등록"이라고 밝힌다(있는 척 금지)', () => {
    const r = extractIssues([lab('2026-07-10T00:00:00Z', 'l1', [{ name: 'ALP', value: '300', flag: 'H' }])]);
    expect(r[0].why).toContain('참고범위 미등록');
  });

  it('정상(flag N)은 이슈가 아니다', () => {
    const r = extractIssues([lab('2026-07-10T00:00:00Z', 'l1', [{ name: 'Hb', value: '14', unit: 'g/dL', flag: 'N', refLow: 13, refHigh: 17 }])]);
    expect(r).toHaveLength(0);
  });

  it('수치로 파싱되지 않는 값은 건너뛴다', () => {
    const r = extractIssues([lab('2026-07-10T00:00:00Z', 'l1', [{ name: 'Culture', value: 'No growth', flag: 'H' }])]);
    expect(r).toHaveLength(0);
  });
});

describe('추세 — 직전 대비 악화', () => {
  it('참고 상한을 넘는 방향으로 올라가면 추세 이슈(델타 표기)', () => {
    const r = extractIssues([
      lab('2026-04-01T00:00:00Z', 'l1', [{ name: 'HbA1c', value: '6.9', unit: '%', flag: 'H', refLow: 4, refHigh: 5.7 }]),
      lab('2026-07-01T00:00:00Z', 'l2', [{ name: 'HbA1c', value: '7.4', unit: '%', flag: 'H', refLow: 4, refHigh: 5.7 }]),
    ]);
    const trend = r.find((x) => x.category === '추세')!;
    expect(trend.value).toBe('6.9 → 7.4');
    expect(trend.why).toContain('+0.5');
    expect(trend.why).toContain('상승');
  });

  it('좋아지는 방향은 추세 이슈로 만들지 않는다', () => {
    const r = extractIssues([
      lab('2026-04-01T00:00:00Z', 'l1', [{ name: 'HbA1c', value: '7.4', unit: '%', flag: 'H', refLow: 4, refHigh: 5.7 }]),
      lab('2026-07-01T00:00:00Z', 'l2', [{ name: 'HbA1c', value: '6.6', unit: '%', flag: 'H', refLow: 4, refHigh: 5.7 }]),
    ]);
    expect(r.some((x) => x.category === '추세')).toBe(false);
  });

  it('직전 값이 없으면 추세 판정을 하지 않는다', () => {
    const r = extractIssues([lab('2026-07-01T00:00:00Z', 'l1', [{ name: 'HbA1c', value: '7.4', unit: '%', flag: 'H', refLow: 4, refHigh: 5.7 }])]);
    expect(r.some((x) => x.category === '추세')).toBe(false);
  });
});

describe('활력 — 위급/주의', () => {
  it('수축기 180 이상은 CRITICAL(고혈압 위기)', () => {
    const r = extractIssues([vital('2026-07-10T00:00:00Z', 'v1', { bp: '186/104', hr: 80, temp: 36.6, spo2: 98, rr: 16 })]);
    const sbp = r.find((x) => x.label === '수축기혈압')!;
    expect(sbp.level).toBe('CRITICAL');
    expect(sbp.why).toContain('고혈압 위기');
  });

  it('SpO2 90 이하는 CRITICAL, 95 이하는 WARN', () => {
    const crit = extractIssues([vital('2026-07-10T00:00:00Z', 'v1', { spo2: 88 })])[0];
    expect(crit.level).toBe('CRITICAL');
    const warn = extractIssues([vital('2026-07-10T00:00:00Z', 'v2', { spo2: 94 })])[0];
    expect(warn.level).toBe('WARN');
    expect(warn.why).toContain('저산소증');
  });

  it('정상 활력은 이슈 없음', () => {
    const r = extractIssues([vital('2026-07-10T00:00:00Z', 'v1', { bp: '118/72', hr: 70, temp: 36.5, spo2: 98, rr: 16 })]);
    expect(r).toHaveLength(0);
  });

  it('혈압 문자열이 없거나 깨져도 다른 항목은 판정한다', () => {
    const r = extractIssues([vital('2026-07-10T00:00:00Z', 'v1', { bp: null, temp: 39.0 })]);
    expect(r).toHaveLength(1);
    expect(r[0].label).toBe('체온');
  });
});

describe('정렬·중복 제거', () => {
  it('위급이 먼저, 같은 레벨은 최신순', () => {
    const r = extractIssues([
      lab('2026-01-01T00:00:00Z', 'l1', [{ name: 'WBC', value: '11000', unit: '/μL', flag: 'H', refLow: 4000, refHigh: 10000 }]),
      lab('2026-07-01T00:00:00Z', 'l2', [{ name: 'K', value: '6.9', unit: 'mmol/L', flag: 'H' }]),
      lab('2026-06-01T00:00:00Z', 'l3', [{ name: 'CRP', value: '3', unit: 'mg/dL', flag: 'H', refHigh: 0.5 }]),
    ]);
    expect(r[0].level).toBe('CRITICAL');
    const warns = r.filter((x) => x.level === 'WARN');
    expect(new Date(warns[0].at).getTime()).toBeGreaterThan(new Date(warns[1].at).getTime());
  });

  it('같은 항목 반복은 최신 1건만 남기고 위급은 전부 유지', () => {
    const many = extractIssues([
      lab('2026-01-01T00:00:00Z', 'a', [{ name: 'WBC', value: '11000', flag: 'H', refHigh: 10000 }]),
      lab('2026-02-01T00:00:00Z', 'b', [{ name: 'WBC', value: '12000', flag: 'H', refHigh: 10000 }]),
      lab('2026-03-01T00:00:00Z', 'c', [{ name: 'K', value: '6.7', flag: 'H' }]),
      lab('2026-04-01T00:00:00Z', 'd', [{ name: 'K', value: '6.8', flag: 'H' }]),
    ]);
    const kept = dedupeIssues(many);
    expect(kept.filter((x) => x.level === 'CRITICAL')).toHaveLength(2);   // 위급은 유지
    expect(kept.filter((x) => x.category === '검사' && x.label === 'WBC')).toHaveLength(1);
  });

  it('모든 이슈에 판정 근거가 있다', () => {
    const r = extractIssues([
      lab('2026-07-01T00:00:00Z', 'l1', [{ name: 'K', value: '6.9', flag: 'H' }]),
      vital('2026-07-02T00:00:00Z', 'v1', { spo2: 88 }),
    ]);
    expect(r.every((x) => x.why.length > 5)).toBe(true);
  });
});
