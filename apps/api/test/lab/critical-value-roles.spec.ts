/**
 * 🔴 위급검사값 배너의 역할 정합 — FE 가 부르는 역할과 API 가 허용하는 역할이 같아야 한다.
 *
 * 2026-08-21 사람 신고: **급양(NUTRITION) 계정으로 로그인하니 모든 화면에
 * "위급검사값 통보 현황을 불러오지 못했습니다 · Forbidden resource"** 가 떴다.
 * 원인 — 배너가 `(main)` 레이아웃에 있어 **모든 직군의 모든 화면**에 렌더되는데
 * EP `/api/v1/lab/critical-values/pending` 은 `LAB_TECH·ADMIN·DOCTOR·NURSE` 전용이었다.
 * 14역할 중 **9역할**(급양·원무·의무기록·검진·CRM×2·행정·경영·조회)이 상시 빨간 오류를 봤다.
 *
 * 🔴 EP 를 여는 것은 답이 아니다 — 위급검사값은 임상 정보이고 read-back 은 임상 행위다.
 *    화면이 부르지 않아야 하며, 그 역할 목록은 **shared 정본 하나**다.
 *
 * 재주입: 컨트롤러 `@Roles` 에서 역할을 하나 빼거나 shared 정본을 바꾸면 이 파일이 실패한다.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { CRITICAL_VALUE_ACK_ROLES, canAckCriticalValue } from '@hospital-run/shared';

const CONTROLLER = join(__dirname, '../../src/modules/lab/lab.controller.ts');
const BANNER = join(__dirname, '../../../web/src/components/CriticalValueAlertBanner.tsx');

describe('위급검사값 역할 정본 ↔ API', () => {
  it('🔴 shared 정본과 `LabController` 의 클래스 @Roles 가 같은 집합이다', () => {
    const src = readFileSync(CONTROLLER, 'utf8');
    const m = src.match(/@Roles\(([^)]*)\)\s*\n@Controller\('api\/v1\/lab'\)/);
    expect(m, 'LabController 의 클래스 @Roles 를 찾지 못했다').toBeTruthy();
    const apiRoles = [...m![1].matchAll(/UserRole\.(\w+)/g)].map((x) => x[1]).sort();
    expect(apiRoles).toEqual([...CRITICAL_VALUE_ACK_ROLES].sort());
  });

  it('🔴 배너가 정본으로 조회를 막는다 — 역할 목록을 화면에 다시 적지 않는다', () => {
    const src = readFileSync(BANNER, 'utf8');
    expect(src, '배너가 shared 정본을 쓰지 않는다').toContain('canAckCriticalValue');
    expect(src, '조회가 역할로 막히지 않는다').toMatch(/enabled:\s*eligible/);
    // 역할 문자열을 화면이 직접 나열하면 갈라진다
    expect(src).not.toMatch(/'(LAB_TECH|DOCTOR|NURSE)'/);
  });

  it('통보 대상 역할은 true, 그 밖은 false', () => {
    for (const r of CRITICAL_VALUE_ACK_ROLES) expect(canAckCriticalValue(r), r).toBe(true);
    for (const r of ['NUTRITION', 'RECEPTIONIST', 'MEDICAL_RECORDS', 'CHECKUP', 'CRM_MANAGER', 'CRM_STAFF', 'ADMIN_STAFF', 'EXECUTIVE', 'READ']) {
      expect(canAckCriticalValue(r), `${r} 은 위급검사값 통보 대상이 아니다`).toBe(false);
    }
    expect(canAckCriticalValue(null)).toBe(false);
    expect(canAckCriticalValue(undefined)).toBe(false);
  });

  it('🔴 대상이 0이 되지 않는다 — 아무도 못 받으면 위급값 통보가 죽는다', () => {
    expect(CRITICAL_VALUE_ACK_ROLES.length).toBeGreaterThanOrEqual(3);
    expect(CRITICAL_VALUE_ACK_ROLES).toContain('DOCTOR');
    expect(CRITICAL_VALUE_ACK_ROLES).toContain('NURSE');
  });
});
