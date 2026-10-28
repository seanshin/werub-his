import { describe, it, expect } from 'vitest';
import { buildInsights, type RawItem, type IssueLike } from '../../src/modules/record-timeline/record-insights';

/**
 * 의미찾기 골든 — 2026-07-31.
 * 핵심 계약: **근거 없는 묶음은 만들지 않는다**(빈 카드 금지)·추정 금지·반복은 변화가 아니다.
 */
const NOW = new Date('2026-07-31T00:00:00Z');
const enc = (id: string, at: string, dx: { code: string; name: string }[]): RawItem =>
  ({ type: 'ENCOUNTER', id, at, diagnoses: dx });
const rx = (id: string, at: string, title: string, dosage?: string, duration?: number, code = 'D1'): RawItem =>
  ({ type: 'PRESCRIPTION', id, at, title, dosage, duration, code, rxType: 'MEDICATION' });
const lab = (id: string, at: string, results: { name: string; value: string; unit?: string }[], verifiedAt: string | null = at): RawItem =>
  ({ type: 'LAB', id, at, title: '검사', results, verifiedAt });

describe('빈 근거면 묶음을 만들지 않는다', () => {
  it('기록이 없으면 묶음 0개', () => {
    expect(buildInsights([], [], NOW)).toEqual([]);
  });

  it('이슈가 없으면 "확인 필요"는 아예 없다(빈 카드 금지)', () => {
    const g = buildInsights([enc('e1', '2026-01-01', [{ code: 'I10', name: '고혈압' }])], [], NOW);
    expect(g.map((x) => x.key)).not.toContain('ATTENTION');
  });
});

describe('① 확인 필요', () => {
  const issues: IssueLike[] = [
    { level: 'CRITICAL', at: '2026-07-10', category: '검사', label: 'K', value: '6.8 mmol/L', why: '위급', source: { type: 'LAB', id: 'l1' } },
    { level: 'WARN', at: '2026-07-09', category: '검사', label: 'HbA1c', value: '6.6 %', why: '참고범위 상회', source: { type: 'LAB', id: 'l2' } },
    { level: 'INFO', at: '2026-07-08', category: '검사', label: 'X', why: '참고' },
  ];

  it('위급·주의만 모으고 참고(INFO)는 제외한다', () => {
    const g = buildInsights([], issues, NOW).find((x) => x.key === 'ATTENTION')!;
    expect(g.items).toHaveLength(2);
    expect(g.level).toBe('ALERT');
    expect(g.note).toContain('위급 1건');
  });

  it('원본 기록을 가리켜 바로 열 수 있어야 한다', () => {
    const g = buildInsights([], issues, NOW).find((x) => x.key === 'ATTENTION')!;
    expect(g.items[0]).toMatchObject({ type: 'LAB', id: 'l1', level: 'ALERT' });
    expect(g.items[0].detail).toBe('위급'); // 왜 이슈인지 문장을 그대로 옮긴다
  });
});

describe('② 진단 경과', () => {
  const items = [
    enc('e1', '2026-05-15', [{ code: 'I10', name: '고혈압' }, { code: 'E11', name: '당뇨' }]),
    enc('e2', '2026-07-24', [{ code: 'I10', name: '고혈압' }]),
  ];

  it('최초 등장 순으로 나오고 반복 횟수를 센다', () => {
    const g = buildInsights(items, [], NOW).find((x) => x.key === 'DIAGNOSIS')!;
    expect(g.items.map((i) => i.label)).toEqual(['고혈압(I10)', '당뇨(E11)']);
    expect(g.items[0].detail).toContain('2회 기재');
    expect(g.items[1].detail).toContain('1회 기재');
  });
});

describe('③ 약물 변화 — 반복 처방은 변화가 아니다', () => {
  it('같은 용량 반복은 "시작" 1건만 남는다', () => {
    const g = buildInsights([rx('p1', '2026-01-01', '암로디핀', '5mg', 90), rx('p2', '2026-04-01', '암로디핀', '5mg', 90)], [], NOW)
      .find((x) => x.key === 'MEDICATION')!;
    expect(g.items.filter((i) => i.label.includes('시작'))).toHaveLength(1);
    expect(g.items.some((i) => i.label.includes('용량 변경'))).toBe(false);
  });

  it('용량이 바뀌면 변경 전후를 함께 남긴다', () => {
    const g = buildInsights([rx('p1', '2026-01-01', '암로디핀', '5mg'), rx('p2', '2026-04-01', '암로디핀', '10mg')], [], NOW)
      .find((x) => x.key === 'MEDICATION')!;
    const chg = g.items.find((i) => i.label.includes('용량 변경'))!;
    expect(chg.detail).toContain('5mg → 10mg');
    expect(chg.level).toBe('WARN');
  });

  it('투약기간이 끝났고 재처방이 없으면 종료로 표시한다', () => {
    const g = buildInsights([rx('p1', '2026-01-01', '암로디핀', '5mg', 30)], [], NOW).find((x) => x.key === 'MEDICATION')!;
    expect(g.items.some((i) => i.label.includes('투약기간 종료'))).toBe(true);
  });

  it('🔴 기간 미기재는 종료를 판정하지 않는다(없는 정보를 만들지 않는다)', () => {
    const g = buildInsights([rx('p1', '2026-01-01', '암로디핀', '5mg')], [], NOW).find((x) => x.key === 'MEDICATION')!;
    expect(g.items.some((i) => i.label.includes('종료'))).toBe(false);
  });

  it('취소된 처방은 종료로 보지 않는다', () => {
    const item = { ...rx('p1', '2026-01-01', '암로디핀', '5mg', 30), status: 'CANCELLED' };
    const g = buildInsights([item], [], NOW).find((x) => x.key === 'MEDICATION')!;
    expect(g.items.some((i) => i.label.includes('종료'))).toBe(false);
  });
});

describe('④ 수치 추세 — 2점은 추세가 아니다', () => {
  it('3회 미만이면 항목을 만들지 않는다', () => {
    const g = buildInsights([lab('l1', '2026-01-01', [{ name: 'HbA1c', value: '6.0' }]), lab('l2', '2026-04-01', [{ name: 'HbA1c', value: '7.0' }])], [], NOW);
    expect(g.find((x) => x.key === 'TREND')).toBeUndefined();
  });

  it('3회 이상이면 처음→마지막 방향을 말한다', () => {
    const g = buildInsights([
      lab('l1', '2026-01-01', [{ name: 'HbA1c', value: '6.0', unit: '%' }]),
      lab('l2', '2026-04-01', [{ name: 'HbA1c', value: '6.8', unit: '%' }]),
      lab('l3', '2026-07-01', [{ name: 'HbA1c', value: '7.4', unit: '%' }]),
    ], [], NOW).find((x) => x.key === 'TREND')!;
    expect(g.items[0].label).toBe('HBA1C 상승');
    expect(g.items[0].detail).toContain('6 (2026-01-01) → 7.4 (2026-07-01)');
  });

  it('변화가 10% 미만이면 "유지"로 본다(잡음을 추세라 하지 않는다)', () => {
    const g = buildInsights([
      lab('l1', '2026-01-01', [{ name: 'Cr', value: '1.00' }]),
      lab('l2', '2026-04-01', [{ name: 'Cr', value: '1.02' }]),
      lab('l3', '2026-07-01', [{ name: 'Cr', value: '1.01' }]),
    ], [], NOW).find((x) => x.key === 'TREND')!;
    expect(g.items[0].label).toBe('CR 유지');
  });

  it('🔴 작은 분석물의 미세 변동도 유지 — Creatinine 0.9→1.0(11%)은 프로드 실측 사례', () => {
    const g = buildInsights([
      lab('l1', '2026-01-01', [{ name: 'Creatinine', value: '0.9', unit: 'mg/dL' }]),
      lab('l2', '2026-04-01', [{ name: 'Creatinine', value: '0.95', unit: 'mg/dL' }]),
      lab('l3', '2026-07-01', [{ name: 'Creatinine', value: '1.0', unit: 'mg/dL' }]),
    ], [], NOW).find((x) => x.key === 'TREND')!;
    expect(g.items[0].label).toBe('CREATININE 상승'); // 11.1% — 경계 바로 위는 방향을 말한다
  });

  it('숫자가 아닌 결과("No growth")는 추세에 넣지 않는다', () => {
    const g = buildInsights([
      lab('l1', '2026-01-01', [{ name: 'Culture', value: 'No growth' }]),
      lab('l2', '2026-04-01', [{ name: 'Culture', value: 'No growth' }]),
      lab('l3', '2026-07-01', [{ name: 'Culture', value: 'No growth' }]),
    ], [], NOW);
    expect(g.find((x) => x.key === 'TREND')).toBeUndefined();
  });
});

describe('⑤ 마무리 안 된 것', () => {
  it('미서명·미확정 검사·미판독 영상을 모은다', () => {
    const g = buildInsights([
      { type: 'ENCOUNTER', id: 'e1', at: '2026-07-01', title: '진료', status: 'DRAFT' },
      lab('l1', '2026-07-02', [{ name: 'K', value: '4.0' }], null),
      { type: 'IMAGING', id: 'i1', at: '2026-07-03', title: 'CXR', reportedAt: null },
    ], [], NOW).find((x) => x.key === 'PENDING')!;
    expect(g.items).toHaveLength(3);
    expect(g.level).toBe('ALERT');
  });

  it('확정·판독이 끝난 것은 넣지 않는다', () => {
    const g = buildInsights([lab('l1', '2026-07-02', [{ name: 'K', value: '4.0' }], '2026-07-02')], [], NOW);
    expect(g.find((x) => x.key === 'PENDING')).toBeUndefined();
  });
});

describe('⑥ 에피소드', () => {
  it('입원/퇴원 2점을 한 줄로 묶고 기간 내 기록 수를 센다', () => {
    const g = buildInsights([
      { type: 'ADMISSION', id: 'a1:in', at: '2026-07-10', admissionId: 'a1', subType: 'ADMIT' },
      { type: 'ADMISSION', id: 'a1:out', at: '2026-07-20', admissionId: 'a1', subType: 'DISCHARGE' },
      { type: 'PROGRESS_NOTE', id: 'pn1', at: '2026-07-12', admissionId: 'a1' },
    ], [], NOW).find((x) => x.key === 'EPISODE')!;
    expect(g.items).toHaveLength(1);
    expect(g.items[0].detail).toContain('2026-07-10 ~ 2026-07-20');
    expect(g.items[0].detail).toContain('기록 1건');
  });

  it('퇴원이 없으면 재원 중으로 표시한다', () => {
    const g = buildInsights([{ type: 'ADMISSION', id: 'a2:in', at: '2026-07-25', admissionId: 'a2', subType: 'ADMIT' }], [], NOW)
      .find((x) => x.key === 'EPISODE')!;
    expect(g.items[0].label).toBe('재원 중');
    expect(g.items[0].detail).toContain('(재원)');
  });
});

describe('묶음 순서 — 임상 우선순위', () => {
  it('확인 필요 → 마무리 안 된 것 → 진단 → 약물 → 추세 → 에피소드', () => {
    const items: RawItem[] = [
      enc('e1', '2026-05-15', [{ code: 'I10', name: '고혈압' }]),
      { type: 'ENCOUNTER', id: 'e2', at: '2026-07-01', title: '진료', status: 'DRAFT' },
      rx('p1', '2026-01-01', '암로디핀', '5mg'),
      lab('l1', '2026-01-01', [{ name: 'HbA1c', value: '6.0' }]),
      lab('l2', '2026-04-01', [{ name: 'HbA1c', value: '6.8' }]),
      lab('l3', '2026-07-01', [{ name: 'HbA1c', value: '7.4' }]),
      { type: 'ADMISSION', id: 'a1:in', at: '2026-07-10', admissionId: 'a1', subType: 'ADMIT' },
    ];
    const issues: IssueLike[] = [{ level: 'WARN', at: '2026-07-01', category: '검사', label: 'HbA1c', why: 'x' }];
    expect(buildInsights(items, issues, NOW).map((g) => g.key))
      .toEqual(['ATTENTION', 'PENDING', 'DIAGNOSIS', 'MEDICATION', 'TREND', 'EPISODE']);
  });
});
