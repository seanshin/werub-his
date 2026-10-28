import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveFlowTargetsWithSource } from '../../src/modules/journey-console/flow-canon';

/**
 * 🔴 여정 관제는 **관리 화면**이다(2026-08-26 사람 결정).
 *    조치는 현장 화면(`/reception`·`/clinic-queue`)에서 이뤄진다.
 *    그래서 ①권한이 좁게 유지되고 ②화면이 그 사실을 말하고 ③현장 경로를 준다.
 *
 * 🔴 그리고 그 결정 때문에 더 중요해진 것: **같은 "너무 오래 기다렸다"에 기준이 둘**이라
 *    관리자가 보는 수와 현장이 보는 색이 다르다. 통일은 원내 정책이라 시스템이 정하지 않는다.
 */
const CTRL = join(process.cwd(), 'src/modules/journey-console/journey-console.controller.ts');
const PAGE = join(process.cwd(), '../web/src/app/(main)/journey-console/page.tsx');
const SIDEBAR = join(process.cwd(), '../web/src/components/layout/Sidebar.tsx');

describe('관제는 관리 화면이다', () => {
  const ctrl = readFileSync(CTRL, 'utf8');
  const page = readFileSync(PAGE, 'utf8');
  const sidebar = readFileSync(SIDEBAR, 'utf8');

  it('🔴 nav 가 여는 역할과 API 가 허용하는 역할이 같다 — 갈라지면 상시 403 이 된다', () => {
    const navLine = sidebar.split('\n').find((l) => l.includes("href: '/journey-console'"));
    expect(navLine, 'nav 에 여정 관제 항목이 없다').toBeTruthy();
    const navRoles = [...navLine!.matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]).sort();
    const apiRoles = [...ctrl.matchAll(/@Roles\(UserRole\.([A-Z_]+), UserRole\.([A-Z_]+)\)/g)][0];
    expect(apiRoles, '컨트롤러 클래스 @Roles 를 찾지 못했다').toBeTruthy();
    expect([apiRoles[1], apiRoles[2]].sort()).toEqual(navRoles);
  });

  it('🔴 쓰기(확인 기록)는 ADMIN 만 — EXECUTIVE 는 경영 열람 역할이다', () => {
    const ackBlock = ctrl.slice(ctrl.indexOf("@Post('ack')"), ctrl.indexOf("@Get('view/:patientId')"));
    expect(ackBlock).toMatch(/@Roles\(UserRole\.ADMIN\)/);
    expect(ackBlock).not.toMatch(/EXECUTIVE/);
  });

  it('화면이 자기 성격을 밝히고 현장 경로를 준다', () => {
    expect(page).toMatch(/관리 화면/);
    expect(page).toMatch(/현장 조치는/);
    expect(page).toMatch(/href="\/reception"/);
  });
});

describe('임계의 출처', () => {
  const cfg = (map: Record<string, unknown>) => ({ get: async (k: string) => map[k] ?? null });

  it('🔴 설정되지 않은 목표는 FALLBACK 이라고 말한다 — 기본값을 정책인 척하지 않는다', async () => {
    const { targets, sources } = await resolveFlowTargetsWithSource(cfg({}));
    expect(sources.opdWaitMin).toBe('FALLBACK');
    expect(targets.opdWaitMin).toBeGreaterThan(0);
  });

  it('대조군 — 설정된 목표는 CONFIG 라고 말한다(무조건 FALLBACK 이면 가드가 헛돈다)', async () => {
    const { targets, sources } = await resolveFlowTargetsWithSource(cfg({ 'qi.targets.opdWaitMinutes': 45 }));
    expect(sources.opdWaitMin).toBe('CONFIG');
    expect(targets.opdWaitMin).toBe(45);
  });

  it('🔴 잘못 적힌 값은 설정으로 치지 않는다 — 그대로 두면 오타가 정책인 척한다', async () => {
    const { targets, sources } = await resolveFlowTargetsWithSource(cfg({ 'qi.targets.opdWaitMinutes': 'ㄱㄴㄷ' }));
    expect(sources.opdWaitMin).toBe('FALLBACK');
    expect(targets.opdWaitMin).toBeGreaterThan(0);
  });

  it('🔴 화면이 두 기준이 다르다는 것을 말한다 — 통일을 코드가 하지 않는다', () => {
    const page = readFileSync(PAGE, 'utf8');
    expect(page).toMatch(/현장 화면.*다른 기준을 씁니다/s);
    expect(page).toMatch(/원내 미설정 · 기본값/);
  });
});
