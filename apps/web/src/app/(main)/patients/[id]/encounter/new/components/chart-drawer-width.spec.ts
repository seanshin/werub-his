import { describe, it, expect } from 'vitest';
import { drawerWidthFromPointer, drawerMaxWidth, DRAWER_MIN_PX, DRAWER_KEEP_PX } from './chart-drawer-width';

/**
 * 참조 패널 폭 조절(스플리터) 순수 로직 골든 — 2026-07-30.
 * 불변: 진료 입력 영역에 최소 DRAFT 폭을 남긴다(패널이 화면을 다 먹지 않음) · 하한 미만으로 접히지 않는다.
 */
describe('drawerMaxWidth — 진료 입력 영역 보호', () => {
  it('상한은 화면폭에서 입력 최소폭을 뺀 값', () => {
    expect(drawerMaxWidth(1920)).toBe(1920 - DRAWER_KEEP_PX);
    expect(drawerMaxWidth(1440)).toBe(1440 - DRAWER_KEEP_PX);
  });

  it('작은 화면에서도 하한은 보장(음수·과소 방지)', () => {
    expect(drawerMaxWidth(600)).toBe(DRAWER_MIN_PX);
    expect(drawerMaxWidth(300)).toBe(DRAWER_MIN_PX);
  });
});

describe('drawerWidthFromPointer — 커서 X → 폭', () => {
  it('패널은 오른쪽에 붙어 있으므로 폭 = 화면폭 - 커서X', () => {
    expect(drawerWidthFromPointer(1120, 1920)).toBe(800);
  });

  it('왼쪽으로 과하게 끌어도 상한을 넘지 않음(진료 입력 영역 확보)', () => {
    expect(drawerWidthFromPointer(0, 1920)).toBe(1920 - DRAWER_KEEP_PX);
    expect(drawerWidthFromPointer(-500, 1920)).toBe(1920 - DRAWER_KEEP_PX);
  });

  it('오른쪽으로 과하게 끌어도 하한 미만으로 접히지 않음', () => {
    expect(drawerWidthFromPointer(1900, 1920)).toBe(DRAWER_MIN_PX);
    expect(drawerWidthFromPointer(3000, 1920)).toBe(DRAWER_MIN_PX);
  });

  it('경계값 — 정확히 하한/상한 지점', () => {
    expect(drawerWidthFromPointer(1920 - DRAWER_MIN_PX, 1920)).toBe(DRAWER_MIN_PX);
    expect(drawerWidthFromPointer(DRAWER_KEEP_PX, 1920)).toBe(1920 - DRAWER_KEEP_PX);
  });

  it('좁은 화면에서는 하한과 상한이 같아 항상 하한', () => {
    expect(drawerWidthFromPointer(100, 600)).toBe(DRAWER_MIN_PX);
    expect(drawerWidthFromPointer(500, 600)).toBe(DRAWER_MIN_PX);
  });
});
