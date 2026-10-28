'use client';

import { useEffect } from 'react';
import { useUiSettings, applyA11yRoot } from '@/lib/ui-settings';

/**
 * 접근성 표면 배선(임상 UX 규약 §4.6) — SystemConfig `ui.a11y.*` 를 문서 root 에 반영한다.
 *
 * 🔴 **기본값(배율 1.0 · 대비 NORMAL)에서는 아무 속성도 붙이지 않는다** — 그러면 globals.css 의
 *    `[data-text-scale]` / `[data-contrast="HIGH"]` 규칙이 하나도 매칭되지 않아 화면이 현행과 동일하다.
 *    "지금은 변화 없음, 위원회가 값을 넣으면 그때 바뀜"이 이 부품의 계약이다.
 *
 * 정본은 `lib/ui-settings`(parseUiSettings·a11yRootAttrs·applyA11yRoot) 하나 — 여기서 값을 다시 해석하지 않는다.
 * 색 외 기호(statusShape)는 CSS 가 아니라 부품이 읽는다(components/ui/display `StatusShapeMark`).
 */
export function A11yRoot() {
  const s = useUiSettings();
  const { textScale, contrast } = s;

  useEffect(() => {
    if (typeof document === 'undefined') return;
    applyA11yRoot(document.documentElement, s);
    // 언마운트 시 되돌린다 — 로그아웃·비(main) 경로에 설정이 남아 있지 않게.
    return () => applyA11yRoot(document.documentElement, { ...s, textScale: 1, contrast: 'NORMAL' });
    // s 는 매 렌더 새 객체라 값 자체를 의존성으로 쓴다(불필요한 DOM 쓰기 방지).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [textScale, contrast]);

  return null;
}
