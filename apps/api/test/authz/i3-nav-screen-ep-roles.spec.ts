import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * nav 가 여는 화면 ↔ 그 화면이 **무조건 부르는** EP 의 역할이 갈라지지 않는다 (2026-09-16 I3).
 *
 * 🔴 왜 소스 대조인가: D4·E3·H3 는 정적 대조만 했고, 이 갈래는 로컬에 API 를 띄워 **실제로 로그인해** 훑었다
 *    (`scripts/probe-least-privilege.mjs`). 거기서 나온 확정 결함 2건이 이 가드의 대상이다 —
 *    프로브는 재현 도구이고(로컬 전용), 회귀를 막는 것은 이 가드다.
 *
 * 🔴 여기 담는 것은 **화면이 조건 없이 부르는** 자리만이다. 조건부 호출(권한 탭·역할 위젯·실패를 설계대로
 *    숨기는 질의)은 담지 않는다 — 프로브의 403 목록에는 그런 자리가 섞여 있고, 그것을 결함이라 부르면
 *    "정당 판정에 억지 가드를 만드는" 것이 된다(판정 규칙 §3).
 */
const ROOT = resolve(__dirname, '../../../..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

/**
 * 그 핸들러의 `@Roles(...)` 역할 이름 — 데코레이터는 라우트 데코레이터 **뒤**에 온다.
 * 🔴 첫 판은 앵커 **앞**을 뒤져 이전 핸들러의 `@Roles` 를 읽었다(대조군 2건이 엉뚱한 값으로 실패해 드러났다).
 *    핸들러 본문(`async`)을 만나기 전까지만 본다 — 다음 핸들러로 넘어가지 않게.
 */
function rolesOf(src: string, anchor: string): string[] {
  const i = src.indexOf(anchor);
  expect(i, `앵커를 찾지 못했다: ${anchor}`).toBeGreaterThan(-1);
  const after = src.slice(i + anchor.length);
  const stop = after.search(/\n\s*async\s/);
  const block = stop > -1 ? after.slice(0, stop) : after.slice(0, 400);
  const m = block.match(/@Roles\(([^)]*)\)/);
  expect(m, `@Roles 를 찾지 못했다: ${anchor}`).toBeTruthy();
  return [...m![1].matchAll(/UserRole\.([A-Z_]+)/g)].map((x) => x[1]);
}

/** Sidebar 의 `{ href, roles }` 에서 그 화면이 열리는 역할 집합 */
function navRolesOf(href: string): string[] {
  const src = read('apps/web/src/components/layout/Sidebar.tsx');
  const consts: Record<string, string[]> = {};
  const parse = (expr: string): string[] => {
    const out: string[] = [];
    for (const m of expr.matchAll(/'([A-Z_]+)'/g)) out.push(m[1]);
    for (const m of expr.matchAll(/\.\.\.([A-Z_]+)/g)) out.push(...(consts[m[1]] ?? []));
    return [...new Set(out)];
  };
  for (const name of ['ALL', 'ALL_WITH_READ', 'EVERY_ROLE', 'CLINICAL', 'SAFETY_REPORTERS', 'ADMIN_ONLY', 'DOCTOR_ADMIN']) {
    const m = src.match(new RegExp(`const ${name}: R = ([^;]+);`));
    if (m) consts[name] = parse(m[1]);
  }
  const m = src.match(new RegExp(`\\{\\s*href: '${href.replace('/', '\\/')}'[^}]*?roles: ([A-Za-z_]+|\\[[^\\]]*\\])`));
  expect(m, `nav 항목을 찾지 못했다: ${href}`).toBeTruthy();
  const expr = m![1];
  return expr.startsWith('[') ? parse(expr) : (consts[expr] ?? []);
}

describe('🔴 화면은 열렸는데 403 — nav 역할 ⊆ EP 역할', () => {
  it('접수(/reception) 워크인 트리아지 3EP 는 접수 화면이 열리는 역할을 모두 받는다', () => {
    const nav = navRolesOf('/reception'); // ADMIN·NURSE·RECEPTIONIST
    const src = read('apps/api/src/modules/medical-ai/medical-ai.controller.ts');
    for (const anchor of ["@Post('triage')", "@Post('triage/follow-up')", "@Get('triage/common-symptoms')"]) {
      const ep = rolesOf(src, anchor);
      const missing = nav.filter((r) => !ep.includes(r));
      expect(missing, `${anchor} 가 ${missing.join(',')} 를 403 으로 막는다 — 화면은 그 역할에 열려 있다`).toEqual([]);
    }
  });

  it('급식(/nutrition) 식이처방 탭이 붙이는 재원 환자 목록은 급양을 받는다', () => {
    const nav = navRolesOf('/nutrition'); // ADMIN·NURSE·NUTRITION
    const src = read('apps/api/src/modules/inpatient/inpatient.controller.ts');
    const ep = rolesOf(src, "@Get('inpatient')");
    expect(nav.filter((r) => !ep.includes(r))).toEqual([]);
  });

  /** 대조군 — 넓히기만 하는 가드가 아니다: 임상 전용 쓰기는 계속 좁아야 한다 */
  it('대조군 — 입원 처리(admit)는 여전히 의사·관리자만이다(목록을 열었다고 쓰기까지 열지 않았다)', () => {
    const src = read('apps/api/src/modules/inpatient/inpatient.controller.ts');
    const ep = rolesOf(src, "@Post('inpatient/admit')");
    expect(ep.sort()).toEqual(['ADMIN', 'DOCTOR']);
    expect(ep).not.toContain('NUTRITION');
  });

  /** 대조군 — 간호과정(care-plan)은 간호사·관리자 전용 그대로(의사 403 은 설계다) */
  it('대조군 — AI 간호과정 제안은 간호사·관리자 전용을 유지한다', () => {
    const src = read('apps/api/src/modules/nursing/nursing.controller.ts');
    const ep = rolesOf(src, "@Get('admissions/:admissionId/ai-care-plan')");
    expect(ep.sort()).toEqual(['ADMIN', 'NURSE']);
  });
});
