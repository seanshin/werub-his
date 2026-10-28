import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, render, screen, renderHook } from '@testing-library/react';
import {
  VideoLinkStatus, deriveVideoLinkView, useBrowserOnline, usePopupWindowState,
} from '../../src/components/telehealth/VideoLinkStatus';

/**
 * 원격진료 영상 연결 상태 — 기획 telehealth-enhancement T3-4.
 *
 * 🔴 지키는 것:
 *   ① SDK 실측 등급이 들어오면 그 문자열과 출처를 그대로 보여 준다(임계값을 만들지 않는다).
 *   ② 등급이 없으면 "측정 불가" — 초록·양호를 지어내지 않는다(HIS 는 Jitsi 창·프레임 안 getStats 에 닿지 못한다).
 *   ③ 브라우저 오프라인 이벤트 → 끊김(다른 상태보다 우선).
 *   ④ 직원 창: window.open 이 null(팝업 차단)·창 닫힘을 구분한다 — 부른 사실만으로 '진행 중'이라 하지 않는다.
 *   ⑤ 직원 화면이 초록 "화상 진료 진행 중" 을 다시 그리지 않는다(재주입 대상).
 */
const text = (k: string) => k;

describe('deriveVideoLinkView', () => {
  it('① SDK 등급이 있으면 그대로', () => {
    const v = deriveVideoLinkView({ online: true, window: 'OPEN', sdkQuality: { level: 'LOW', source: 'sdk-event' } });
    expect(v.quality).toEqual({ level: 'LOW', source: 'sdk-event' });
    render(<VideoLinkStatus view={v} text={text} />);
    expect(screen.getByText(/LOW/)).toBeTruthy();
    expect(screen.getByText(/sdk-event/)).toBeTruthy();
    expect(document.querySelector('[data-quality="unmeasured"]')).toBeNull();
  });

  it('② 등급이 없으면 측정 불가 · 초록 클래스 없음', () => {
    const v = deriveVideoLinkView({ online: true, window: 'OPEN' });
    expect(v.quality).toBeNull();
    const { container } = render(<VideoLinkStatus view={v} text={text} />);
    expect(screen.getByText(/연결 품질: 측정 불가/)).toBeTruthy();
    expect(container.innerHTML).not.toMatch(/emerald|green/);
    // 빈 등급 문자열은 등급이 아니다
    expect(deriveVideoLinkView({ online: true, window: 'OPEN', sdkQuality: { level: '', source: 'x' } }).quality).toBeNull();
  });

  it('③ 오프라인은 창 상태보다 우선한다', () => {
    expect(deriveVideoLinkView({ online: false, window: 'OPEN' }).statusKey).toBe('네트워크 끊김 — 브라우저가 오프라인입니다');
    expect(deriveVideoLinkView({ online: false, window: 'OPEN' }).tone).toBe('danger');
    // 모름(null)은 끊김이 아니다
    expect(deriveVideoLinkView({ online: null, window: 'OPEN' }).statusKey).toBe('영상 창 열림');
  });

  it('③-b 훅 — offline/online 이벤트를 따라간다', () => {
    const { result } = renderHook(() => useBrowserOnline());
    act(() => { window.dispatchEvent(new Event('offline')); });
    expect(result.current).toBe(false);
    act(() => { window.dispatchEvent(new Event('online')); });
    expect(result.current).toBe(true);
  });

  it('④ 창 상태 — 시작 전·막힘·열림·닫힘', () => {
    expect(renderHook(() => usePopupWindowState(null, false)).result.current).toBe('NOT_OPENED');
    expect(renderHook(() => usePopupWindowState(null, true)).result.current).toBe('BLOCKED');
    const fake = { closed: false } as unknown as Window;
    expect(renderHook(() => usePopupWindowState(fake, true)).result.current).toBe('OPEN');
    expect(deriveVideoLinkView({ online: true, window: 'BLOCKED' }).tone).toBe('warn');
    expect(deriveVideoLinkView({ online: true, window: 'CLOSED' }).statusKey).toBe('영상 창이 닫혔습니다');
  });

  it('⑤ 직원 영상 화면이 부른 사실만으로 초록 "진행 중"을 그리지 않는다', () => {
    const src = readFileSync(join(__dirname, '../../src/app/(main)/telehealth/[sessionId]/page.tsx'), 'utf8');
    expect(src).not.toContain('화상 진료 진행 중');
    expect(src).toMatch(/setVideoWindow\(window\.open\(/);
    expect(src).toContain('<VideoLinkStatus');
    const portal = readFileSync(join(__dirname, '../../src/app/portal/_care/CareTab.tsx'), 'utf8');
    expect(portal).toContain("window: 'EMBEDDED'");
  });
});
