import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * 병상 상태 커버리지 — 2026-08-12 (화면 점검 W2 · 패턴 P3).
 *
 * 🔴 병상 현황이 상태 6종 중 **4종만 세어 합이 총계와 맞지 않았다**
 *    (사용가능 49 + 사용중 5 + 예약 0 + 점검 1 = 55 · 전체 57 — **청소중 2가 어디에도 없었다**).
 *    같은 병을 오전에 ER 베드 보드에서 한 번 고쳤는데, 병동 병상 현황에 그대로 남아 있었다.
 *    병상은 "어디에 있는지"가 곧 가용성이라 한 칸이 사라지면 배정 판단이 어긋난다.
 *
 * **상태를 추가하면 이 테스트가 실패한다** — 그때 KPI 타일도 함께 늘려야 한다.
 */

const BEDS_PAGE = path.join(__dirname, '..', '..', 'src', 'app', '(main)', 'beds', 'page.tsx');

describe('병상 현황 — 상태 커버리지', () => {
  const src = fs.readFileSync(BEDS_PAGE, 'utf-8');

  /** 화면이 스스로 정의한 상태 라벨표가 기준이다 */
  const labeled = [...src.matchAll(/^\s{2}([A-Z_]+):\s*'([^']+)',$/gm)]
    .map((m) => m[1])
    .filter((k, i, a) => a.indexOf(k) === i);

  it('상태 라벨표를 찾을 수 있다(구조 변경 감지)', () => {
    expect(labeled).toContain('AVAILABLE');
    expect(labeled).toContain('CLEANING');
    expect(labeled.length).toBeGreaterThanOrEqual(6);
  });

  it('🔴 라벨이 있는 모든 상태를 KPI 로 센다 — 합이 총계와 맞아야 한다', () => {
    const counted = [...src.matchAll(/byStatus\('([A-Z_]+)'\)/g)].map((m) => m[1]);
    const missing = labeled.filter((s) => !counted.includes(s));
    expect(missing, `KPI 에서 빠진 상태: ${missing.join(', ')} — 합이 총계와 어긋난다`).toEqual([]);
  });

  it('🔴 청소중·격리가 특히 빠지기 쉽다(오전 ER 보드에서도 이 둘이었다)', () => {
    expect(src).toMatch(/byStatus\('CLEANING'\)/);
    expect(src).toMatch(/byStatus\('ISOLATION'\)/);
  });
});
