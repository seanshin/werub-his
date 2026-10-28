import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 🔴 통합 검색바에서 **화면명으로 찾아 이동**한다 — 단, **권한이 없으면 이동 불가**
 * (사람 요구 2026-08-26).
 *
 * 🔴 핵심은 "막는다"가 아니라 **목록에 넣지 않는다**는 것이다.
 *    넣고 눌렀을 때 막으면 그 화면의 **존재를 알려주는 셈**이고(민감 진료과 화면은 존재 자체가 정보다),
 *    사용자는 자기 오타로 읽는다. 그리고 판정은 `ScreenJump` 와 **같은 정본**을 써야 한다 —
 *    갈리면 두 곳이 다르게 막는다.
 */
const BAR = join(process.cwd(), '../web/src/components/layout/SmartSearchBar.tsx');
const JUMP = join(process.cwd(), '../web/src/components/layout/ScreenJump.tsx');

describe('화면명 검색', () => {
  const bar = readFileSync(BAR, 'utf8');
  const jump = readFileSync(JUMP, 'utf8');

  it('레지스트리 정본 하나를 쓴다 — 화면 목록을 다시 적지 않는다', () => {
    expect(bar).toMatch(/SCREEN_REGISTRY/);
    expect(jump).toMatch(/SCREEN_REGISTRY/);
  });

  it('🔴 권한 판정이 두 곳에서 같다', () => {
    const gate = /role === 'ADMIN' \|\| \w+\.roles\.includes\(role\)/;
    expect(bar, '검색바의 권한 게이트를 찾지 못했다').toMatch(gate);
    expect(jump, '화면점프의 권한 게이트를 찾지 못했다').toMatch(gate);
  });

  it('🔴 권한 없는 화면은 결과에 넣지 않는다(넣고 막으면 존재를 알려주는 셈)', () => {
    // 필터가 `.map(` 보다 앞에 있어야 한다 — 뒤에 있으면 이미 목록에 들어간 것이다
    const fn = bar.slice(bar.indexOf('const screenResults'), bar.indexOf('const search ='));
    const filterAt = fn.indexOf('roles.includes(role)');
    const mapAt = fn.indexOf('.map(');
    expect(filterAt).toBeGreaterThan(0);
    expect(filterAt, '권한 필터가 결과 생성보다 뒤에 있다').toBeLessThan(mapAt);
  });

  it('이름·번호 둘 다로 찾는다', () => {
    const fn = bar.slice(bar.indexOf('const screenResults'), bar.indexOf('const search ='));
    expect(fn, '번호 매칭이 없다').toMatch(/code\.startsWith/);
    expect(fn, '이름 매칭이 없다').toMatch(/label\.toLowerCase\(\)\.includes/);
  });

  it('대조군 — 빈 질의에는 화면을 내지 않는다(전 화면 목록이 새지 않는다)', () => {
    const fn = bar.slice(bar.indexOf('const screenResults'), bar.indexOf('const search ='));
    expect(fn).toMatch(/if \(!t\) return \[\];/);
  });
});
