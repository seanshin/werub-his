/**
 * 코드 호출 역할 정본(2026-10-07) — 서버 `POST staff-calls/code` @Roles 와 shared CODE_CALL_ROLES 가 같다.
 * 🔴 종전 직원 화면은 Code 를 의사·관리자에게만 보여 간호사가 코드블루를 호출할 길이 없었다(서버는 간호사 허용).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CODE_CALL_ROLES, canCallCode } from '@hospital-run/shared';

describe('코드 호출 역할', () => {
  it('🔴 서버 @Roles(staff-calls/code) = shared CODE_CALL_ROLES', () => {
    const src = readFileSync(resolve(__dirname, '../../src/modules/staff-call/staff-call.controller.ts'), 'utf8');
    const m = src.match(/@Post\('code'\)\s*\n\s*@Roles\(([^)]*)\)/);
    expect(m).toBeTruthy();
    const server = [...m![1].matchAll(/UserRole\.([A-Z_]+)/g)].map((x) => x[1]).sort();
    expect(server).toEqual([...CODE_CALL_ROLES].sort());
  });
  it('간호사 가능 · 원무·약사 불가', () => {
    expect(canCallCode('NURSE')).toBe(true);
    expect(canCallCode('RECEPTIONIST')).toBe(false);
    expect(canCallCode(null)).toBe(false);
  });
});
