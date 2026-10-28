import { describe, it, expect } from 'vitest';
import { documentWindowBox } from '../../src/lib/document-window';

/**
 * 문서 창 크기 골든 — 2026-07-31.
 * 문서는 A4 세로 비율로 읽히므로 화면 높이에 맞추되 가로가 화면을 넘지 않아야 한다.
 */
describe('documentWindowBox', () => {
  it('일반 노트북(1440×900): 화면을 넘지 않고 가운데 정렬', () => {
    const b = documentWindowBox(1440, 900);
    expect(b.height).toBe(828);              // 900 * 0.92
    expect(b.width).toBe(586);               // 828 / 1.414
    expect(b.left).toBe(Math.round((1440 - b.width) / 2));
    expect(b.top).toBe(Math.round((900 - b.height) / 2));
  });

  it('큰 화면(2560×1440): 상한(900px)을 넘지 않는다 — 문서가 과도하게 넓어지지 않게', () => {
    const b = documentWindowBox(2560, 1440);
    expect(b.width).toBeLessThanOrEqual(900);
  });

  it('좁은 화면(800×600): 화면 90% 를 넘지 않는다', () => {
    const b = documentWindowBox(800, 600);
    expect(b.width).toBeLessThanOrEqual(720);
    expect(b.left).toBeGreaterThanOrEqual(0);
  });

  it('아주 작은 화면에서도 최소 크기를 보장한다(빈 창 방지)', () => {
    const b = documentWindowBox(320, 240);
    expect(b.width).toBeGreaterThanOrEqual(360 - 1); // 최소 360 보장(화면보다 커도 열리게)
    expect(b.height).toBeGreaterThanOrEqual(360);
    expect(b.top).toBeGreaterThanOrEqual(0);
  });

  it('가로 상한을 조정할 수 있다', () => {
    expect(documentWindowBox(2560, 1440, { maxWidth: 1200 }).width).toBeGreaterThan(900);
  });
});
