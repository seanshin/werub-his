import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * J2 — 실로그인 프로브(12역할 × 화면 EP 2,409쌍)에서 확정된 "화면은 열렸는데 403" 봉합 가드.
 *
 * 🔴 수납(`/billing`)은 **같은 드리프트가 세 번** 났다:
 *    ① 의사 누락(상시 403·빈 탭) → 목록 EP 에 DOCTOR 추가
 *    ② 2026-08-29 접수원을 넣으며 **검진(CHECKUP)을 빠뜨림** → 목록 EP 만 교정
 *    ③ 2026-09-16 J2: 목록은 고쳤는데 **상세·결제옵션은 그대로**였고, ERP 진료비는 수납을 실제로 하는
 *       두 역할(원무·검진)을 빼고 의사를 넣고 있었다.
 *    그래서 이 가드는 개별 역할을 하드코딩하지 않고 **nav 가 그 화면에 여는 역할**과 기계 대조한다.
 */
const ROOT = resolve(__dirname, '../../../..');
const sidebar = readFileSync(join(ROOT, 'apps/web/src/components/layout/Sidebar.tsx'), 'utf8');
const billingCtl = readFileSync(join(ROOT, 'apps/api/src/modules/billing/billing.controller.ts'), 'utf8');

/** Sidebar 의 `/billing` 항목이 여는 역할(정본) */
function navRolesFor(href: string): string[] {
  const m = sidebar.match(new RegExp(`\\{\\s*href:\\s*'${href}'[^}]*?roles:\\s*\\[([^\\]]*)\\]`));
  if (!m) return [];
  return [...m[1].matchAll(/'([A-Z_]+)'/g)].map((x) => x[1]);
}

/** 컨트롤러에서 해당 핸들러의 @Roles 목록 */
function rolesOf(src: string, decorator: string): string[] {
  const i = src.indexOf(decorator);
  expect(i, `핸들러를 찾지 못했다: ${decorator}`).toBeGreaterThan(-1);
  const after = src.slice(i, i + 1200);
  const m = after.match(/@Roles\(([^)]*)\)/);
  if (!m) return [];
  return [...m[1].matchAll(/UserRole\.([A-Z_]+)/g)].map((x) => x[1]);
}

describe('J2 — 수납 화면: nav 가 여는 역할을 EP 가 막지 않는다', () => {
  const navRoles = navRolesFor('/billing');

  it('대조군 — nav 에서 /billing 역할을 실제로 뽑았다(ADMIN·NURSE·RECEPTIONIST·CHECKUP)', () => {
    expect(navRoles).toEqual(expect.arrayContaining(['ADMIN', 'NURSE', 'RECEPTIONIST', 'CHECKUP']));
  });

  /**
   * 수납 화면이 실제로 부르는 핵심 GET 들 — 하나라도 빠지면 그 역할은 그 자리에서 막힌다.
   * 🔴 `billing/erp-invoice` 는 **일부러 뺐다** — `nav-role-endpoint.spec` 이 "검진 데스크까지 열지 않았다"를
   *    대조군으로 갖고 있어 nav 전체 대조를 적용하면 그 판단과 충돌한다(아래에서 따로 본다).
   */
  const HANDLERS: Array<[string, string]> = [
    ["@Get('billings')", '수납 목록'],
    ["@Get('billings/:id')", '수납 상세'],
    ["@Get('billings/:id/payment-options')", '결제 옵션(보유 검진권)'],
  ];

  it.each(HANDLERS)('%s (%s) 는 nav 가 여는 역할을 전부 받는다', (dec) => {
    const roles = rolesOf(billingCtl, dec);
    const missing = navRoles.filter((r) => !roles.includes(r));
    expect(missing, `nav 는 이 역할에 수납 화면을 여는데 EP 가 막는다: ${missing.join(',')}`).toEqual([]);
  });

  it('🔴 닫힌 채로 남아야 하는 역할은 그대로 — 급양·CRM 은 수납 EP 에 없다(넓히기가 아니다)', () => {
    for (const [dec] of HANDLERS) {
      const roles = rolesOf(billingCtl, dec);
      expect(roles).not.toContain('NUTRITION');
      expect(roles).not.toContain('CRM_STAFF');
    }
  });

  /**
   * ERP 진료비는 nav 전체 대조에서 뺀 예외다 — **원무는 열고 검진은 기존 판단을 따른다.**
   * 검진 데스크도 같은 실패 배너를 보지만, 그 판단을 뒤집는 것은 이 갈래의 몫이 아니다(판정 문서에 후보로 기록).
   */
  it('ERP 진료비 — 원무는 열리고, 검진은 기존 대조군대로 닫힌 채다', () => {
    const roles = rolesOf(billingCtl, "@Get('billing/erp-invoice')");
    expect(roles, '수납의 주 사용자인 원무가 막혀 있다').toContain('RECEPTIONIST');
    expect(roles, 'nav-role-endpoint.spec 의 대조군을 뒤집었다').not.toContain('CHECKUP');
  });
});

describe('J2 — 상담 데스크: 등록 여부를 묻는 것은 등록을 요구하지 않는다(catch-22)', () => {
  it('@ConsultSelfProbe 가 붙은 agents/me — 미등록자도 통과하고 등록 상태를 받는다', async () => {
    const { ConsultAgentGuard } = await import('../../src/modules/consult/consult-agent.guard');
    const { CONSULT_SELF_PROBE_KEY } = await import('../../src/modules/consult/consult-role.decorator');

    const reflector = { get: vi.fn((key: string) => (key === CONSULT_SELF_PROBE_KEY ? true : undefined)) };
    const prisma = { consultAgent: { findUnique: vi.fn().mockResolvedValue(null) } }; // 미등록
    const featureAccess = { isDenied: vi.fn().mockResolvedValue(false), isExplicitlyAllowed: vi.fn().mockResolvedValue(false) };
    const req: Record<string, unknown> = { user: { id: 'u1', role: 'DOCTOR' } };
    const ctx = { switchToHttp: () => ({ getRequest: () => req }), getHandler: () => ({}), getClass: () => ({}) };

    const guard = new ConsultAgentGuard(reflector as never, prisma as never, featureAccess as never);
    await expect(guard.canActivate(ctx as never)).resolves.toBe(true);
    expect(req.consultAgent).toBeNull(); // 미등록 사실이 그대로 실린다
  });

  it('대조군 — 표식이 없는 핸들러는 미등록자를 계속 막는다(데스크를 열어준 것이 아니다)', async () => {
    const { ConsultAgentGuard } = await import('../../src/modules/consult/consult-agent.guard');
    const reflector = { get: vi.fn().mockReturnValue(undefined) };
    const prisma = { consultAgent: { findUnique: vi.fn().mockResolvedValue(null) } };
    const featureAccess = { isDenied: vi.fn().mockResolvedValue(false), isExplicitlyAllowed: vi.fn().mockResolvedValue(false) };
    const ctx = {
      switchToHttp: () => ({ getRequest: () => ({ user: { id: 'u1', role: 'DOCTOR' } }) }),
      getHandler: () => ({}), getClass: () => ({}),
    };
    const guard = new ConsultAgentGuard(reflector as never, prisma as never, featureAccess as never);
    await expect(guard.canActivate(ctx as never)).rejects.toThrow();
  });

  it('🔴 차단 목록은 self-probe 에도 그대로 우선한다(회수를 뚫지 않는다)', async () => {
    const { ConsultAgentGuard } = await import('../../src/modules/consult/consult-agent.guard');
    const { CONSULT_SELF_PROBE_KEY } = await import('../../src/modules/consult/consult-role.decorator');
    const reflector = { get: vi.fn((key: string) => (key === CONSULT_SELF_PROBE_KEY ? true : undefined)) };
    const prisma = { consultAgent: { findUnique: vi.fn().mockResolvedValue(null) } };
    const featureAccess = { isDenied: vi.fn().mockResolvedValue(true), isExplicitlyAllowed: vi.fn().mockResolvedValue(false) };
    const ctx = {
      switchToHttp: () => ({ getRequest: () => ({ user: { id: 'u1', role: 'DOCTOR' } }) }),
      getHandler: () => ({}), getClass: () => ({}),
    };
    const guard = new ConsultAgentGuard(reflector as never, prisma as never, featureAccess as never);
    await expect(guard.canActivate(ctx as never)).rejects.toThrow();
  });

  it('agents/me 핸들러에 표식이 실제로 붙어 있다', () => {
    const src = readFileSync(join(ROOT, 'apps/api/src/modules/consult/consult-admin.controller.ts'), 'utf8');
    const i = src.indexOf("@Get('agents/me')");
    expect(i).toBeGreaterThan(-1);
    expect(src.slice(i, i + 200)).toContain('@ConsultSelfProbe()');
  });
});
