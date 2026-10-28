import { describe, it, expect } from 'vitest';
import { boardView, criticalActions, ktasChips, fmtMoney } from './command-center-view';

/**
 * 통합 상황판 표시 골든 — 2026-07-31.
 * 서버가 섹션당 5~9개 지표를 주는데 화면이 2~3개만 쓰던 것을 규칙으로 고정한다.
 */
describe('카드 표시(boardView)', () => {
  const bed = { totalBeds: 37, occupied: 5, available: 32, occupancyRate: 14, admitToday: 0, dischargeToday: 0, admittedTotal: 5, longStay: 5, avgLos: 47.4 };

  it('대표 지표는 정의된 서식으로 크게 낸다(가동률=%)', () => {
    expect(boardView('bed', bed).primary).toEqual({ key: 'occupancyRate', label: '병상 가동률', value: '14%' });
  });

  it('🔴 서버가 준 값을 버리지 않는다 — 정의에 없는 키도 뒤에 붙는다', () => {
    const keys = boardView('bed', bed).fields.map((f) => f.key);
    expect(keys).toContain('avgLos');       // 정의됨
    expect(keys).toContain('admittedTotal'); // 정의에 없지만 살아남음
  });

  it('0 인 지표는 흐리게 표시(muted) — 숨기지는 않는다', () => {
    const f = boardView('bed', bed).fields.find((x) => x.key === 'admitToday')!;
    expect(f.muted).toBe(true);
    expect(f.value).toBe('0');
  });

  it('🔴 값 없음(null)은 0 과 구분한다 — 측정 안 됨을 0으로 보이면 오독', () => {
    const f = boardView('safetyQuality', { handHygieneRate: null }).fields.find((x) => x.key === 'handHygieneRate')!;
    expect(f.value).toBe('—');
  });

  it('임계 이상이면 색조가 올라간다(주의→위험)', () => {
    const d = boardView('diagnostics', { tatOverdue: 30, criticalPending: 2, criticalOverdue: 2 });
    expect(d.fields.find((f) => f.key === 'tatOverdue')!.tone).toBe('danger'); // 10 이상
    const d2 = boardView('diagnostics', { tatOverdue: 3 });
    expect(d2.fields.find((f) => f.key === 'tatOverdue')!.tone).toBe('warn');
  });

  it('경보는 0 이면 만들지 않는다(빈 배지 금지)', () => {
    expect(boardView('nursing', { total: 5, highRisk: 0 }).alert).toBeUndefined();
    expect(boardView('nursing', { total: 5, highRisk: 2 }).alert).toEqual({ label: '고위험(EWS)', value: 2 });
  });

  it('금액은 만원 단위로 접는다(상황판은 자릿수보다 규모)', () => {
    expect(fmtMoney(10156935)).toBe('1,016만원');
  });
});

describe('KTAS 분포', () => {
  it('중증도 순서를 고정하고 1·2 는 위험으로 표시', () => {
    const c = ktasChips({ ktas: { LEVEL_1: 1, LEVEL_2: 0, LEVEL_3: 4, LEVEL_4: 2, LEVEL_5: 0 } });
    expect(c.map((x) => x.level)).toEqual(['L1', 'L2', 'L3', 'L4', 'L5']);
    expect(c[0]).toMatchObject({ count: 1, danger: true });
    expect(c[2].danger).toBe(false);
  });

  it('분포가 없으면 아무것도 만들지 않는다', () => {
    expect(ktasChips({})).toEqual([]);
  });
});

describe('🔴 지금 조치 필요(criticalActions) — 상황판의 존재 이유', () => {
  const sections = {
    diagnostics: { ok: true, summary: { criticalPending: 2, criticalOverdue: 2, tatOverdue: 30, labPending: 1 } },
    nursing: { ok: true, summary: { highRisk: 1, medsOverdue: 0, unsignedNotes: 0 } },
    safetyQuality: { ok: true, summary: { infectionsActive: 3 } },
    emergency: { ok: true, summary: { pendingTriage: 0, reassessOverdue: 0 } },
  };

  it('0 건은 목록에 넣지 않는다(할 일 없는 줄을 만들지 않는다)', () => {
    const keys = criticalActions(sections).map((a) => a.key);
    expect(keys).not.toContain('medsOverdue');
    expect(keys).not.toContain('pendingTriage');
  });

  it('위험이 주의보다 먼저, 같은 등급은 건수 순', () => {
    const a = criticalActions(sections);
    expect(a[0].tone).toBe('danger');
    const dangers = a.filter((x) => x.tone === 'danger').map((x) => x.key);
    expect(dangers).toEqual(['criticalOverdue', 'criticalPending', 'highRisk']);
    const warns = a.filter((x) => x.tone === 'warn').map((x) => x.key);
    expect(warns[0]).toBe('tatOverdue'); // 30 > 3
  });

  it('각 항목은 왜 조치인지와 갈 곳을 갖는다', () => {
    for (const a of criticalActions(sections)) {
      expect(a.why.length).toBeGreaterThan(5);
      expect(a.href.startsWith('/')).toBe(true);
    }
  });

  it('응답 실패 섹션은 건너뛴다(부분 실패 허용)', () => {
    expect(criticalActions({ diagnostics: { ok: false } })).toEqual([]);
  });

  it('할 일이 없으면 빈 목록', () => {
    expect(criticalActions({ nursing: { ok: true, summary: { highRisk: 0 } } })).toEqual([]);
  });
});
