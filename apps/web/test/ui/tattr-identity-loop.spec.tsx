import React, { useCallback, useEffect, useState } from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, act, cleanup } from '@testing-library/react';
import { renderHook } from '@testing-library/react';
import { useTAttr, useTfAttr } from '../../src/components/ui/i18n-text';
import { useUiLocaleStore } from '../../src/stores/ui-locale-store';
import { usePortalTAttr } from '../../src/app/portal/_shared/PT';

/**
 * 🔴 **번역 함수의 정체성이 렌더마다 바뀌면 조회가 끝없이 돈다** (2026-09-11 §12-B 라운드에서 발견).
 *
 * `useTAttr()`/`useTfAttr()` 가 렌더마다 새 함수를 돌려줬다. i18n 배선 라운드들이 그 함수를
 * `useCallback(load, [tAttr])` 의 의존성에 넣었고(22곳), `useEffect(() => load(), [load])` 가 붙은 화면은
 *   조회 → setState → 재렌더 → 새 tAttr → 새 load → effect 재실행 → 조회 …
 * 로 **API 를 무한히 두드린다**(`admin/voucher/list`·`SpeakerEnrollment` — 녹음 중엔 레벨 미터가 렌더를 더 일으킨다).
 * 번역을 붙였을 뿐인데 화면이 서버를 공격하는 모양이라, 22곳을 하나씩 고치지 않고 **정본 훅**을 locale 로 메모이즈한다.
 *
 * 대조군: locale 이 바뀌면 함수도 바뀌어야 한다(그래야 의존한 콜백이 새 언어로 다시 번역한다).
 */
beforeEach(() => useUiLocaleStore.setState({ locale: 'en' }));
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('useTAttr / useTfAttr — 정체성은 locale 에만 묶인다', () => {
  it('같은 locale 에서 재렌더해도 같은 함수다', () => {
    const { result, rerender } = renderHook(() => ({ t: useTAttr(), tf: useTfAttr() }));
    const first = result.current;
    rerender();
    rerender();
    expect(result.current.t).toBe(first.t);
    expect(result.current.tf).toBe(first.tf);
  });

  it('대조군 — locale 이 바뀌면 새 함수가 되고 새 언어로 번역한다', () => {
    const { result } = renderHook(() => ({ t: useTAttr(), tf: useTfAttr() }));
    const before = result.current;
    act(() => useUiLocaleStore.setState({ locale: 'ja' }));
    expect(result.current.t).not.toBe(before.t);
    expect(result.current.tf).not.toBe(before.tf);
    expect(result.current.t('취소')).not.toBe(before.t('취소')); // en ≠ ja
  });

  it('🔴 useCallback([tAttr]) + useEffect([load]) + setState 모양이 조회를 한 번만 한다 — 종전엔 무한 반복', async () => {
    const fetcher = vi.fn(async () => ['a']);
    function Screen() {
      const tAttr = useTAttr();
      const [, setRows] = useState<string[]>([]);
      const load = useCallback(async () => {
        try { setRows(await fetcher()); } catch { /* */ }
        void tAttr('조회 실패');
      }, [tAttr]);
      useEffect(() => { void load(); }, [load]);
      return null;
    }
    render(<Screen />);
    // 루프라면 마이크로태스크마다 다시 부른다 — 여러 틱을 흘려도 1회여야 한다
    for (let i = 0; i < 20; i++) await act(async () => { await Promise.resolve(); });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

describe('usePortalTAttr — 환자 축도 같은 규칙', () => {
  it('같은 locale 에서 재렌더해도 같은 함수다(포털 화면의 의존한 effect 가 무한 재실행되지 않는다)', () => {
    const { result, rerender } = renderHook(() => usePortalTAttr());
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });
});
