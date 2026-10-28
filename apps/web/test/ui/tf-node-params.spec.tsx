import React from 'react';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { T, Tf } from '../../src/components/ui/i18n-text';
import { useUiLocaleStore } from '../../src/stores/ui-locale-store';

/**
 * 🔴 **노드 자리표시자** (2026-09-11 · 기획 `ui-locale-i18n.plan.md` §12-H-2).
 *
 * `<Tf>` 의 params 가 문자열·숫자만 받아서, 문장 한가운데 `<b>` 가 걸린 문장은 옮길 수 없었다
 * (한 키로 옮기면 강조가 사라지고, 쪼개면 어순이 깨진다). 그래서 정직성 문구 둘이 모든 언어에서 한국어로 남았다:
 *   analytics `조회 실패 — 데이터 없음이 아니라 <b>확인 불가</b>입니다.`
 *   formulary `⚠ 서버 집행점 없음 — 이 영역의 모드는 <b>표시 전용</b>입니다(…)`
 * 이 스펙이 지키는 사실:
 *   ① ko 화면의 글자가 **하나도 바뀌지 않고** 강조도 남는다
 *   ② 다른 언어에서 **번역문의 어순대로** 노드가 끼워지고, 노드 안의 한국어도 번역된다
 *   ③ 값이 안 온 자리표시자는 `{이름}` 으로 **보인다**(조용히 지우지 않는다 — 문자열 보간과 같은 규약)
 */
const K = '조회 실패 — 데이터 없음이 아니라 {강조}입니다.';
const el = () => <Tf k={K} params={{ 강조: <b><T k="확인 불가" /></b> }} />;

beforeEach(() => useUiLocaleStore.setState({ locale: 'ko' }));
afterEach(() => cleanup());

describe('<Tf> 노드 자리표시자', () => {
  it('① ko — 원문과 글자 단위로 같고 강조가 남는다', () => {
    const { container } = render(<p>{el()}</p>);
    expect(container.textContent).toBe('조회 실패 — 데이터 없음이 아니라 확인 불가입니다.');
    expect(container.querySelector('b')?.textContent).toBe('확인 불가');
  });

  it('② en — 번역문의 어순대로 끼우고, 강조어도 번역한다', () => {
    useUiLocaleStore.setState({ locale: 'en' });
    const { container } = render(<p>{el()}</p>);
    expect(container.textContent).toBe('Query failed — Cannot be verified, not "no data".');
    expect(container.querySelector('b')?.textContent).toBe('Cannot be verified');
    expect(container.textContent, '한국어 조각이 남았다').not.toMatch(/[가-힣]/);
  });

  it('② ja — 강조가 문장 가운데로 간다(어순은 번역문이 정한다)', () => {
    useUiLocaleStore.setState({ locale: 'ja' });
    const { container } = render(<p>{el()}</p>);
    expect(container.textContent).toBe('照会失敗 — 「データなし」ではなく確認不可です。');
    expect(container.querySelector('b')?.textContent).toBe('確認不可');
  });

  it('③ 값이 안 온 노드 자리표시자는 {이름} 으로 보이고 data-i18n-unfilled 로 남는다', () => {
    const { container } = render(<Tf k="{강조} 와 {빠짐}" params={{ 강조: <b>x</b> }} />);
    expect(container.textContent).toBe('x 와 {빠짐}');
    expect(container.querySelector('[data-i18n-unfilled]')?.getAttribute('data-i18n-unfilled')).toBe('빠짐');
  });

  it('대조군 — 문자열·숫자 params 는 종전 경로 그대로(문자열 보간)', () => {
    useUiLocaleStore.setState({ locale: 'en' });
    const { container } = render(<Tf k="{전체}건 중 {표시}건 표시" params={{ 전체: 12, 표시: 3 }} />);
    expect(container.textContent).toBe('Showing 3 of 12');
  });
});
