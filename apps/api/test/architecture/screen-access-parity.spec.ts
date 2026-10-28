/**
 * 🔴 화면을 여는 역할과 API 가 허용하는 역할은 **같은 목록 하나**여야 한다 — 2026-08-27 신설.
 *
 * 실측 배경(nav↔EP 전수 프로브 7,584회): `nav 숨김 ≠ 권한 회수` 의 **반대 방향**이 34건 있었다 —
 * nav 는 여는데 API 가 막아 사용자가 **자기 계정을 고장난 것으로 읽는** 상태다.
 *   · `/transfer`·`/transfer/incoming`·`/transfer/history` — nav 는 NURSE 를 열고 API 는 `@Roles(DOCTOR, ADMIN)`
 *     → 간호사에게는 **전 패널 403**(화면이 통째로 사문)
 *   · `/patients` — nav 는 원무·검진까지 열고 차트 EP 는 대부분 403
 *
 * 사람 결정(2026-08-27): **환자 차트는 의무기록·의료차트다 — 관련 권한을 가진 역할만.**
 * 전원도 같다. 그래서 목록을 `packages/shared/src/screen-access.ts` 하나로 모았다.
 *
 * 재주입: nav 나 컨트롤러 어느 쪽이든 역할을 **리터럴로 다시 적으면** 실패한다.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { CHART_ACCESS_ROLES, TRANSFER_ACCESS_ROLES, canReadChartClinical } from '@hospital-run/shared';

const API_ROOT = path.join(__dirname, '..', '..');
const SIDEBAR = path.join(API_ROOT, '..', 'web', 'src', 'components', 'layout', 'Sidebar.tsx');
const TRANSFER_CTRL = path.join(API_ROOT, 'src', 'modules', 'transfer', 'transfer.controller.ts');

/** Sidebar 에서 한 경로의 `roles:` 표현식을 그대로 꺼낸다(해석하지 않는다 — 문자열로 대조한다) */
function navRolesExpr(src: string, href: string): string | null {
  const re = new RegExp(`href: '${href.replace(/\//g, '\\/')}',[^}]*?roles: ([^}]+?)(?:,|\\s*})`);
  return re.exec(src)?.[1]?.trim() ?? null;
}

describe('화면 접근 역할 — nav 와 API 가 같은 정본을 쓴다', () => {
  const sidebar = fs.readFileSync(SIDEBAR, 'utf8');
  const transferCtrl = fs.readFileSync(TRANSFER_CTRL, 'utf8');

  it('🔴 `/patients` nav 가 shared 정본을 쓴다 (리터럴 역할 나열 금지)', () => {
    const expr = navRolesExpr(sidebar, '/patients');
    expect(expr, '`/patients` nav 항목을 못 찾았다 — 추출이 깨진 것이다').toBeTruthy();
    expect(expr).toContain('CHART_ACCESS_ROLES');
    // 종전처럼 지원 직군을 손으로 덧붙이면 다시 갈라진다
    expect(expr).not.toMatch(/'RECEPTIONIST'|'CHECKUP'/);
  });

  it('🔴 `/transfer` 3화면 nav 가 API 와 같은 정본을 쓴다', () => {
    for (const href of ['/transfer', '/transfer/incoming', '/transfer/history']) {
      const expr = navRolesExpr(sidebar, href);
      expect(expr, `${href} nav 항목을 못 찾았다`).toBeTruthy();
      expect(expr, href).toContain('TRANSFER_ACCESS_ROLES');
    }
    expect(transferCtrl).toContain('TRANSFER_ACCESS_ROLES');
    expect(transferCtrl, '컨트롤러가 역할을 리터럴로 다시 적으면 갈라진다').not.toMatch(/@Roles\(UserRole\./);
  });

  it('정본 값 — 2026-08-27 사람 결정 (바꾸려면 여기도 함께 바꾼다)', () => {
    expect([...CHART_ACCESS_ROLES].sort()).toEqual(['ADMIN', 'DOCTOR', 'MEDICAL_RECORDS', 'NURSE']);
    expect([...TRANSFER_ACCESS_ROLES].sort()).toEqual(['ADMIN', 'DOCTOR']);
  });

  it('🔴 대조군 — 임상 내용 판정이 무조건 참이 아니다', () => {
    for (const r of ['DOCTOR', 'NURSE', 'PHARMACIST', 'ADMIN', 'MEDICAL_RECORDS']) {
      expect(canReadChartClinical(r), r).toBe(true);
    }
    // 원무·검진·검사·급양은 요약의 임상 필드를 받지 못한다(빈 배열이 아니라 **키가 빠지고** restricted 로 알린다)
    for (const r of ['RECEPTIONIST', 'CHECKUP', 'LAB_TECH', 'NUTRITION', 'READ', '', null]) {
      expect(canReadChartClinical(r), String(r)).toBe(false);
    }
  });
});
