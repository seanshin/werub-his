import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { EVERY_STAFF_ROLE, USER_ROLE_LABEL } from '@hospital-run/shared';

/**
 * 🔴 전역 컴포넌트는 **최소 권한 직군 기준**으로 검증한다.
 *
 * 2026-08-26 실측: 상단 바의 워크스테이션 배지는 로그인한 **모든 직원** 화면에 렌더되는데
 * `resolve`·`pick-list` 가 임상 5역할 전용이라 **14역할 중 9역할이 모든 화면에서 403** 을 받았다.
 * (2026-08-21 위급검사값 배너와 같은 결함 — 같은 실수가 두 번째다.)
 */
const CTRL = join(process.cwd(), 'src/modules/workstation-setup/workstation-setup.controller.ts');

describe('워크스테이션 자리 해석은 전 직군이 쓴다', () => {
  const src = readFileSync(CTRL, 'utf8');

  it('🔴 전 직군 역할 정본은 역할 라벨 정본과 집합이 같다', () => {
    expect([...EVERY_STAFF_ROLE].sort()).toEqual(Object.keys(USER_ROLE_LABEL).sort());
  });

  it('resolve 가 전 직군에 열려 있다', () => {
    const block = src.slice(src.indexOf("@Get('resolve')"), src.indexOf("@Get('resolve')") + 160);
    expect(block, 'resolve 가 특정 역할만 열려 있다').toContain('...WS_READ_ROLES');
  });

  it('pick-list 도 전 직군에 열려 있다', () => {
    const block = src.slice(src.indexOf("@Get('pick-list')"), src.indexOf("@Get('pick-list')") + 160);
    expect(block).toContain('...WS_READ_ROLES');
  });

  it('🔴 대조군 — 관리 EP(logical-stations)는 여전히 ADMIN 전용이다(전부 열어버리지 않았다)', () => {
    const i = src.indexOf("@Get('logical-stations')");
    expect(src.slice(i, i + 160)).toContain('UserRole.ADMIN');
  });

  it('🔴 대조군 — 인쇄 EP 는 넓히지 않았다(필요가 확인되지 않았다)', () => {
    const i = src.indexOf("@Post('print/order-label')");
    expect(src.slice(i, i + 200)).not.toContain('WS_READ_ROLES');
  });
});
