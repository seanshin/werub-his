import { describe, it, expect } from 'vitest';
import { render as rtlRender } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { AI_ORIGIN_TEXT } from '@hospital-run/shared';
import { SkillModeBadge, SkillNotice } from '../../src/app/(main)/patients/[id]/encounter/new/components/AiAssistantPanel';
import { PreSignQaChecklist } from '../../src/app/(main)/patients/[id]/encounter/new/components/PreSignQaChecklist';
import { computeSkillSuggestions, AI_SKILL_MODES, type AiTab } from '../../src/app/(main)/patients/[id]/encounter/new/components/ai-skill-modes';

// KDate 가 ui-settings(useQuery) 를 타므로 QueryClient 를 깔아 준다(조회는 실패해도 폴백 포맷으로 그린다)
const render = (ui: ReactElement) => rtlRender(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);

/**
 * P1 렌더 가드 — 관계 모드 배지(§7.2)·스킬 라우터(§4.3)·서명 전 체크리스트(§4.2 기록품질).
 * 재주입: 배지가 모드를 안 그리거나, 라우터가 결과 없이 제안을 만들거나, 체크리스트가 "막지 않습니다"를 지우면 실패한다.
 */
describe('SkillModeBadge — 탭 10개가 각자 모드를 그린다', () => {
  it.each(Object.keys(AI_SKILL_MODES) as AiTab[])('%s', (tab) => {
    const { container } = render(<SkillModeBadge tab={tab} />);
    const el = container.querySelector('[data-skill-mode]') as HTMLElement;
    expect(el).toBeTruthy();
    for (const m of AI_SKILL_MODES[tab].modes) expect(el.textContent).toContain(m);
    expect(el.textContent).not.toContain('자동실행');
    expect(el.querySelector('[aria-label="관계 모드 범례"]')).toBeTruthy();
  });
  it('감별진단은 감시→보조 전이를 화살표로 그린다', () => {
    const { container } = render(<SkillModeBadge tab="ddx" />);
    expect(container.querySelector('[data-skill-mode="감시→보조"]')).toBeTruthy();
  });
});

describe('computeSkillSuggestions — 결정론 · 있는 것만', () => {
  const soap0 = { subjective: '', objective: '', assessment: '', plan: '' };
  it('브리핑 없음·폼 비어 있음 → 제안 0(모르는 것을 0 으로 접지 않고, 없는 근거로 제안하지 않는다)', () => {
    expect(computeSkillSuggestions({ brief: null, soap: soap0, hasDdxResult: false, hasDrugResult: false, hasLabResult: false })).toEqual([]);
  });
  it('검사 이상 n · 알레르기 미문진 · 감별진단 대기(S≥20자) · 약물추천 가능(A 있음) — 이미 결과가 있으면 빠진다', () => {
    const brief = { abnormalLabCount: 3, allergy: { status: 'NOT_ASSESSED' } };
    const soap = { ...soap0, subjective: '3일 전부터 두통과 발열이 있고 기침이 심해졌다', assessment: 'J06.9 급성 상기도감염' };
    const s = computeSkillSuggestions({ brief, soap, hasDdxResult: false, hasDrugResult: false, hasLabResult: false });
    expect(s.map((x) => x.label)).toEqual(['검사 이상 3', '알레르기 미문진', '감별진단 대기', '약물추천 가능']);
    expect(s.find((x) => x.label === '감별진단 대기')?.runOnOpen).toBe(true);
    const s2 = computeSkillSuggestions({ brief, soap, hasDdxResult: true, hasDrugResult: true, hasLabResult: true });
    expect(s2.map((x) => x.label)).toEqual(['알레르기 미문진']);
  });
  it('S 가 20자 미만이면 감별진단을 제안하지 않는다 · abnormalLabCount 0 은 제안 없음', () => {
    const s = computeSkillSuggestions({ brief: { abnormalLabCount: 0, allergy: { status: 'NO_KNOWN_ALLERGIES' } }, soap: { ...soap0, subjective: '두통' }, hasDdxResult: false, hasDrugResult: false, hasLabResult: false });
    expect(s).toEqual([]);
  });
});

describe('SkillNotice — 캐시 표기', () => {
  it('cached=true 면 "캐시" 를 말한다', () => {
    const { container } = render(<SkillNotice env={{ source: 'AI', latencyMs: 1200, cached: true, cachedAt: '2026-08-19T10:00:00+09:00' }} />);
    expect(container.querySelector('[data-skill-cached]')?.textContent).toContain('캐시');
  });
  it('cached 없으면 캐시를 말하지 않는다', () => {
    const { container } = render(<SkillNotice env={{ source: 'AI', latencyMs: 1200 }} />);
    expect(container.querySelector('[data-skill-cached]')).toBeNull();
  });
});

describe('PreSignQaChecklist — 감시 · 비차단', () => {
  it('idle 이면 아무것도 그리지 않는다', () => {
    const { container } = render(<PreSignQaChecklist state={{ status: 'idle' }} />);
    expect(container.innerHTML).toBe('');
  });
  it('실패는 실패라고 말하고 서명은 계속할 수 있다고 말한다', () => {
    const { container } = render(<PreSignQaChecklist state={{ status: 'failed', error: '시간 초과(15초)', at: '2026-08-19T10:00:00+09:00' }} />);
    expect(container.textContent).toContain('기록품질 확인 실패 — 서명은 계속할 수 있습니다');
    expect(container.textContent).toContain('막지 않습니다');
    expect(container.textContent).toContain(AI_ORIGIN_TEXT);
  });
  it('이슈를 level/category/message/suggestion 으로 그리고, 0건은 "찾지 못했다" 로 말한다(없다고 안심시키지 않는다)', () => {
    const done = { status: 'done' as const, at: '2026-08-19T10:00:00+09:00', inputKey: 'k', result: { source: 'AI', grade: 'B', totalIssues: 1, issues: [{ category: '진단', level: 'WARNING', message: '주상병 코드가 없습니다', suggestion: 'KCD 코드를 붙이세요' }] } };
    const { container } = render(<PreSignQaChecklist state={done} />);
    const t = container.textContent ?? '';
    expect(t).toContain('WARNING');
    expect(t).toContain('진단');
    expect(t).toContain('주상병 코드가 없습니다');
    expect(t).toContain('제안: KCD 코드를 붙이세요');
    const { container: c0 } = render(<PreSignQaChecklist state={{ ...done, result: { source: 'AI', issues: [] } }} />);
    expect(c0.textContent).toContain('찾지 못했다는 뜻');
  });
});
