import { describe, it, expect } from 'vitest';
import { buildRuleSummary, buildSummaryPrompt, type SummaryItem } from '../../src/modules/record-timeline/record-summary';

/**
 * 시계열 요약(규칙) 골든 — 2026-07-30.
 * 불변: 기록에 있는 값만 집계 · 진단/처방 권고 금지 프롬프트 · AI 없이도 유의미한 요약.
 */
const enc = (at: string, A?: string, dx?: [string, string][], O?: string): SummaryItem => ({
  type: 'ENCOUNTER', at, soap: { A, O }, diagnoses: (dx ?? []).map(([code, name]) => ({ code, name, type: 'PRIMARY' })),
});
const rx = (at: string, title: string, code: string, dosage?: string): SummaryItem => ({
  type: 'PRESCRIPTION', at, title, code, dosage, rxType: 'MEDICATION',
});

describe('buildRuleSummary — 진료 경과(chart)', () => {
  const items = [
    enc('2024-08-09', '본태성 고혈압 의증', [['I10', '고혈압']], 'BP 148/94'),
    enc('2025-01-24', '메트포르민 위장 부작용', [['E11', '제2형 당뇨병']]),
    enc('2026-07-10', '전 항목 목표 유지', [['I10', '고혈압'], ['E11', '제2형 당뇨병']], 'BP 118/72'),
  ];

  it('기간·건수·진료 회차를 집계', () => {
    const r = buildRuleSummary(items, 'chart');
    expect(r.period).toEqual({ from: '2024-08-09', to: '2026-07-10' });
    expect(r.counts.ENCOUNTER).toBe(3);
    expect(r.lines[0]).toContain('기록 3건');
  });

  it('진단이 처음 등장한 시점을 순서대로 남긴다', () => {
    const r = buildRuleSummary(items, 'chart');
    const dx = r.lines.find((l) => l.startsWith('진단 경과'))!;
    expect(dx.indexOf('I10')).toBeLessThan(dx.indexOf('E11')); // 등장 순서 보존
    expect(dx).toContain('2024-08-09');
  });

  it('평가(A) 첫/마지막을 대비시킨다 — 조절 상태 변화의 핵심', () => {
    const r = buildRuleSummary(items, 'chart');
    const a = r.lines.find((l) => l.startsWith('평가 변화'))!;
    expect(a).toContain('본태성 고혈압 의증');
    expect(a).toContain('전 항목 목표 유지');
  });

  it('최근 객관 소견을 인용(추정 없이 원문)', () => {
    const r = buildRuleSummary(items, 'chart');
    expect(r.lines.some((l) => l.includes('BP 118/72'))).toBe(true);
  });

  it('chart 모드는 처방 집계를 넣지 않는다(관점 분리)', () => {
    const r = buildRuleSummary([...items, rx('2026-07-10', '메트포르민', 'M1', '500mg')], 'chart');
    expect(r.lines.some((l) => l.startsWith('처방'))).toBe(false);
  });
});

describe('buildRuleSummary — 약물 이력(rx)', () => {
  const items = [
    rx('2024-09-06', '로사르탄', 'L1', '50mg'),
    rx('2025-08-08', '로사르탄', 'L1', '100mg'),
    rx('2026-07-10', '로사르탄', 'L1', '100mg'),
    rx('2024-11-29', '메트포르민', 'M1', '500mg'),
  ];

  it('약품별로 묶고 용량 변경을 뽑아낸다', () => {
    const r = buildRuleSummary(items, 'rx');
    expect(r.lines.some((l) => l.includes('약품/지시 2종'))).toBe(true);
    const chg = r.lines.find((l) => l.startsWith('용량 변경'))!;
    expect(chg).toContain('로사르탄 50mg→100mg');
    expect(chg).not.toContain('메트포르민'); // 변경 없는 약은 나열하지 않음
  });

  it('컨텍스트에 약별 기간·횟수를 담는다(AI 프롬프트용)', () => {
    const r = buildRuleSummary(items, 'rx');
    expect(r.context).toContain('약 로사르탄: 2024-09-06~2026-07-10 3회');
  });

  it('rx 모드는 진료 평가를 넣지 않는다', () => {
    const r = buildRuleSummary([...items, enc('2026-07-10', '목표 유지')], 'rx');
    expect(r.lines.some((l) => l.startsWith('평가 변화'))).toBe(false);
  });
});

describe('buildRuleSummary — 전체(all)', () => {
  it('검사 이상치·영상 판독·수술·입퇴원을 함께 집계', () => {
    const r = buildRuleSummary([
      { type: 'LAB', at: '2026-07-09', abnormalCount: 2, results: [{ name: 'WBC', value: '13200', unit: '/μL', flag: 'H' }, { name: 'Hb', value: '13.8', flag: 'N' }] },
      { type: 'IMAGING', at: '2026-07-09', impression: '우하엽 폐렴 소견' },
      { type: 'SURGERY', at: '2026-06-01', title: '복강경 담낭절제술' },
      { type: 'ADMISSION', at: '2026-05-31' },
    ], 'all');
    expect(r.lines.some((l) => l.includes('이상 포함 1건'))).toBe(true);
    expect(r.lines.some((l) => l.includes('WBC 13200/μL'))).toBe(true);
    expect(r.lines.some((l) => l.includes('우하엽 폐렴 소견'))).toBe(true);
    expect(r.lines.some((l) => l.includes('복강경 담낭절제술'))).toBe(true);
    expect(r.lines.some((l) => l.startsWith('입퇴원'))).toBe(true);
  });

  it('빈 입력이면 없다고만 말한다(추정 금지)', () => {
    const r = buildRuleSummary([], 'all');
    expect(r.lines).toEqual(['해당 기간 기록이 없습니다.']);
    expect(r.context).toBe('');
  });

  it('시각이 깨진 항목은 조용히 제외', () => {
    const r = buildRuleSummary([{ type: 'LAB', at: 'not-a-date' }, { type: 'LAB', at: '2026-07-01' }], 'all');
    expect(r.counts.LAB).toBe(1);
  });
});

describe('buildSummaryPrompt — 안전 규칙 강제', () => {
  it('추정·권고 금지와 인용 규칙을 프롬프트에 명시', () => {
    const p = buildSummaryPrompt('chart', buildRuleSummary([enc('2026-07-10', 'A')], 'chart'));
    expect(p).toContain('추정하지 마세요');
    expect(p).toContain('권고하지 마세요');
    expect(p).toContain('그대로 인용');
  });

  it('모드별 관점이 프롬프트에 반영', () => {
    expect(buildSummaryPrompt('rx', buildRuleSummary([], 'rx'))).toContain('약물 치료 이력');
    expect(buildSummaryPrompt('chart', buildRuleSummary([], 'chart'))).toContain('외래 진료 경과');
    expect(buildSummaryPrompt('all', buildRuleSummary([], 'all'))).toContain('임상 경과 전반');
  });
});

/**
 * D3 — 요약이 출처를 말한다 (2026-09-27 · 2026-10-01 계측 반영)
 *
 * 🔴 수정량은 서명 시점에 `Encounter.aiEditDistance` 로 잰다. 요약은 **몇 회를 쟀는가**만 분모와 함께 말하고
 *    개별 거리 숫자("편집거리 N")는 적지 않는다(검토 강도로 잘못 읽힌다 · 분포는 AI 감독 `scribe-edits`).
 * 🔴 재지 못한 회(null)를 계측 수에 넣지 않는다 — 0(무수정)은 잰 것이고 null 은 못 잰 것이다.
 * 🔴 종전 문구 "미측정(재는 코드 없음)"은 서명 경로 계측이 이미 있던 때의 거짓이었다 — 되살아나면 실패한다.
 */
describe('대화 유래 초안 출처 줄', () => {
  const enc = (id: string, aiScribed: boolean, aiEditDistance: number | null = null) => ({
    type: 'ENCOUNTER', at: `2026-03-0${id}T00:00:00Z`, status: 'SIGNED', aiScribed, aiEditDistance,
    soap: { S: 's', O: null, A: 'a', P: 'p' }, diagnoses: [],
  });

  it('대화 유래 진료가 있으면 분모와 함께 말하고, 계측 회수도 분모와 함께 말한다', () => {
    const r = buildRuleSummary([enc('1', true, 0), enc('2', false), enc('3', true, null)] as never[], 'all');
    const line = r.lines.find((l) => l.includes('대화 유래'));
    expect(line, '출처 줄이 없다').toBeTruthy();
    expect(line).toContain('2/3회');
    // 🔴 0(무수정)도 "잰 것"이다 · null 은 못 잰 것 — 둘을 섞지 않는다
    expect(line).toContain('계측 1/2회');
    expect(line, '편집거리 숫자를 지어냈다').not.toMatch(/편집거리\s*\d/);
    expect(line, '계측 코드가 있는데 없다고 말했다').not.toContain('재는 코드 없음');
  });

  it('대조군 — 전부 잰 경우 계측 수가 분모와 같다', () => {
    const r = buildRuleSummary([enc('1', true, 3), enc('2', true, 0)] as never[], 'all');
    const line = r.lines.find((l) => l.includes('대화 유래'))!;
    expect(line).toContain('계측 2/2회');
  });

  it('대조군 — 대화 유래가 하나도 없으면 그 줄을 만들지 않는다(0 건을 알리지 않는다)', () => {
    const r = buildRuleSummary([enc('1', false), enc('2', false)] as never[], 'all');
    expect(r.lines.some((l) => l.includes('대화 유래'))).toBe(false);
  });
});
