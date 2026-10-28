import { describe, it, expect } from 'vitest';
import { toFocusLink, FOCUS_LINK_ENABLED } from '../../src/lib/focus-link';

/**
 * 🔴 기록 상세 창(초점 창)에서 '원본 화면에서 보기'를 눌렀더니 **사이드바 달린 전체 앱**이 열렸다
 *    (2026-08-25 사람 신고). 초점 창의 목적이 깨진다 — `(main)` 의 `?focus=1` 표면으로 보낸다.
 */
describe('원본 화면 링크는 초점 모드로 연다', () => {
  // 🔴 지금은 꺼져 있다 — 로그인 상태에서 스피너만 도는 것을 확인하지 못한 채 사용자를 보내지 않는다.
  //    변환 로직 자체는 계속 검증하되(되살릴 때 쓴다), **켜져 있다고 말하지 않는다.**
  const on = FOCUS_LINK_ENABLED;
  it('🔴 게이트가 꺼져 있으면 링크를 바꾸지 않는다(사용자를 미확인 경로로 보내지 않는다)', () => {
    if (on) return; // 켜면 아래 본 테스트들이 판정한다
    expect(toFocusLink('/patients/abc?tab=labresults')).toBe('/patients/abc?tab=labresults');
  });

  it.skipIf(!on)('쿼리가 있는 링크에 focus=1 을 더한다(기존 파라미터를 지우지 않는다)', () => {
    const r = toFocusLink('/patients/abc?tab=labresults');
    expect(r).toContain('tab=labresults');
    expect(r).toContain('focus=1');
    // 🔴 그 기록이 있는 영역만 그린다 — 차트 전체 장치(헤더·탭·되돌아가기)는 방해가 된다
    expect(r).toContain('only=1');
  });

  it.skipIf(!on)('쿼리가 없는 링크에도 붙는다', () => {
    expect(toFocusLink('/surgery/s1')).toBe('/surgery/s1?focus=1&only=1');
  });

  it.skipIf(!on)('이미 초점 모드면 그대로 둔다(멱등)', () => {
    expect(toFocusLink('/patients/abc?focus=1&only=1')).toBe('/patients/abc?focus=1&only=1');
    // 🔴 focus 만 있고 only 가 없으면 아직 멱등이 아니다 — 채워 넣는다
    expect(toFocusLink('/patients/abc?focus=1')).toContain('only=1');
  });

  it.skipIf(!on)('해시를 잃지 않는다', () => {
    expect(toFocusLink('/patients/abc?tab=vitals#top')).toMatch(/#top$/);
  });

  it('🔴 외부 링크에는 우리 파라미터를 붙이지 않는다', () => {
    expect(toFocusLink('https://example.com/x')).toBe('https://example.com/x');
    expect(toFocusLink('')).toBe('');
  });

  it.skipIf(!on)('대조군 — 내부 링크를 그대로 돌려주지 않는다(무조건 통과 방지)', () => {
    expect(toFocusLink('/patients/abc?tab=labresults')).not.toBe('/patients/abc?tab=labresults');
  });
});
