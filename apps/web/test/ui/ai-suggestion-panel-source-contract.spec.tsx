import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AI_ORIGIN_TEXT } from '@hospital-run/shared';
import { AiSuggestionPanel, AiInlineBadge } from '../../src/components/ai/AiSuggestionPanel';

/**
 * AI 제안 패널 — 출처 **3상태** 계약(서버 정본 `medical-ai/ai-grounding.ts`).
 *
 * 🔴 2026-08-19 실측: 서버는 17곳에서 `AI`/`FALLBACK`/`UNAVAILABLE` 을 배출하는데
 *    공용 부품은 `UNAVAILABLE` 을 몰라 **원시 JSON 을 덤프**했고, `FALLBACK` 을 "데이터 부족"이라 불러
 *    "호출했으나 실패"와 "원자료가 없어 부르지 않음"을 하나로 뭉갰다. `error` 는 `null` 을 그려 침묵했다.
 *
 * 재주입하면 실패한다: UNAVAILABLE 분기를 지우면 JSON 덤프가 다시 나타나 첫 단언이 깨진다.
 */
describe('AiSuggestionPanel — 출처 3상태를 다르게 그린다', () => {
  it('UNAVAILABLE: 사유를 사람 문장으로 보여주고 JSON 을 덤프하지 않는다 · AI 소견처럼 보이지 않는다', () => {
    const data = { source: 'UNAVAILABLE', available: false, reasonCode: 'NO_SOURCE_DATA', reason: '확정된 검사 결과가 없어 추이를 해석할 대상이 없습니다.' };
    const { container } = render(<AiSuggestionPanel title="검사 추이 분석" data={data} source="UNAVAILABLE" />);
    expect(screen.getByText('산출 불가')).toBeTruthy();
    expect(screen.getByText(data.reason)).toBeTruthy();
    expect(container.textContent).not.toContain('reasonCode');   // 원시 덤프 금지
    expect(container.textContent).not.toContain('NO_SOURCE_DATA');
    expect(container.textContent).toContain(`${AI_ORIGIN_TEXT}를 호출하지 않았습니다`);
    expect(screen.queryByText('적용')).toBeNull();               // 산출 불가에 "적용" 버튼은 없다
  });

  it('source 를 생략해도 data.source 로 UNAVAILABLE 을 알아본다', () => {
    render(<AiSuggestionPanel title="복약지도 초안" data={{ source: 'UNAVAILABLE', reason: '처방이 없습니다.' }} />);
    expect(screen.getByText('산출 불가')).toBeTruthy();
  });

  it('FALLBACK: "데이터 부족"이 아니라 AI 미응답·규칙 대체라고 말하고, AI 배지를 달지 않는다', () => {
    const { container } = render(<AiSuggestionPanel title="처방 자동 검토" data={{ source: 'FALLBACK', review: '규칙 기반 점검: 상호작용 없음' }} source="FALLBACK" />);
    expect(container.textContent).not.toContain('데이터 부족');
    expect(container.textContent).toContain(`${AI_ORIGIN_TEXT} 미응답`);
    expect(container.textContent).toContain('규칙 기반 대체 결과');
    expect(container.querySelector('[title*="AI(WeRU.B)가 생성한"]')).toBeNull(); // AI 배지 없음
  });

  it('AI: 정본 배지(AI 병기)와 면책이 붙고, 서버 disclaimer 가 있으면 그것을 우선한다', () => {
    const { container } = render(
      <AiSuggestionPanel title="중증도 재분류 제안" data={{ source: 'AI', answer: 'KTAS 3 → 2 상향 검토', disclaimer: '서버 면책 문구 X' }} source="AI" />,
    );
    expect(container.textContent).toContain(AI_ORIGIN_TEXT);
    expect(container.textContent).toContain('서버 면책 문구 X');
    expect(container.textContent).not.toContain('자동분석'); // AI 를 가리는 옛 라벨
  });

  it('🔴 error 는 침묵하지 않는다 — 실패를 실패라고 말한다', () => {
    const { container } = render(<AiSuggestionPanel title="검사 추이 분석" data={null} error="AI 서버 503" />);
    expect(container.textContent).toContain('호출 실패');
    expect(container.textContent).toContain('AI 서버 503');
  });

  it('AiInlineBadge: FALLBACK·UNAVAILABLE 은 AI 제안이 아니므로 그리지 않는다', () => {
    const { container: a } = render(<AiInlineBadge label="KTAS" value="2" source="UNAVAILABLE" />);
    const { container: b } = render(<AiInlineBadge label="KTAS" value="2" source="FALLBACK" />);
    const { container: c } = render(<AiInlineBadge label="KTAS" value="2" source="AI" />);
    expect(a.textContent).toBe('');
    expect(b.textContent).toBe('');
    expect(c.textContent).toContain('KTAS: 2');
  });
});
