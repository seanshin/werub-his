/**
 * 대시보드 위젯 편집 목록 ↔ 서버 역할·권한(2026-10-03 역할 12종 실탐침 3차).
 *  🔴 기본 배치는 `dashboard-default-permissions` 가 지킨다 — 그런데 **편집 모드에서 넣을 수 있는 위젯**은 아무도 대조하지 않았다.
 *     실탐침(역할당 계정 하나 · 312호출)에서 간호사가 넣을 수 있는 '영상 대기열'·'오늘 수술 일정'이 늘 403("조회 실패")이었다.
 *  · 역할 r 이 위젯을 넣을 수 있으면(등록부 roles·requiredPermissions = 화면 `canAccessWidget`) 그 위젯이 부르는 EP 를
 *    서버가 r 에게 열어야 한다(클래스·핸들러 @Roles · @RequirePermission — 정본 스캐너 `role-endpoint-scan`)
 *  · 위젯 안에서 역할로 갈라 부르지 않는 호출만 예외(아래 IN_COMPONENT — 갈림 조건을 소스로 확인한다)
 *  · 핸들러 본문의 역할 검사는 데코레이터 스캔이 못 본다 → 수술 일정 간호사 규칙은 따로 대조
 * 재주입: 등록부에 NURSE 를 되돌리거나, 위젯 안 역할 갈림을 지우면 실패한다.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join, normalize } from 'node:path';
import { scanControllers, makeLookup, rolePerms, SCAN_ROLES, stripComments } from './role-endpoint-scan';

const DIR = join(process.cwd(), '..', 'web/src/app/(main)/dashboard/components');
const reg = stripComments(readFileSync(join(DIR, 'widget-registry.ts'), 'utf8'));

interface W { id: string; roles: string[]; perms: string[]; src: string; eps: string[] }
const widgets: W[] = [...reg.matchAll(/\{\s*id: '([^']+)'[\s\S]*?roles: \[([^\]]*)\][\s\S]*?requiredPermissions: \[([^\]]*)\][\s\S]*?import\('([^']+)'\)/g)].map((m) => {
  const [, id, r, p, imp] = m;
  let f = join(DIR, normalize(imp) + '.tsx');
  if (!existsSync(f)) f = join(DIR, normalize(imp), 'index.tsx');
  const src = stripComments(readFileSync(f, 'utf8'));
  // GET 만 — 위젯 안 쓰기 호출(호출·진료 시작)은 사용자가 누르는 행위이고 그 화면의 역할 판정은 my-queue 등록부 roles 가 겸한다
  const eps = [...new Set([...src.matchAll(/apiClient\.get[^(]*\(\s*['`"](\/api\/[^'`"\s?]+)|endpoint="(\/api\/[^"?]+)/g)]
    .map((x) => (x[1] ?? x[2]).replace(/\$\{[^}]+\}/g, 'X')))];
  return { id, roles: [...r.matchAll(/'([^']+)'/g)].map((x) => x[1]), perms: [...p.matchAll(/'([^']+)'/g)].map((x) => x[1]), src, eps };
});

/** 위젯 안에서 역할로 갈라 그 역할에게는 부르지 않는 호출 — 갈림 조건이 소스에 그대로 있어야 예외다 */
const IN_COMPONENT: Record<string, { ep: string; allowed: string[]; cond: RegExp }> = {
  'my-today': { ep: '/api/v1/appointments', allowed: ['DOCTOR'], cond: /seesOwnAppointments = user\?\.role === 'DOCTOR'/ },
  'lab-results': { ep: '/api/v1/doctors/results-inbox', allowed: ['DOCTOR', 'ADMIN'], cond: /isInbox = role === 'DOCTOR' \|\| role === 'ADMIN'/ },
};

const look = makeLookup(scanControllers());
const enumOf = (p: string) => p.replace(':', '_').toUpperCase();
const canAdd = (w: W, role: string) => {
  if (w.roles.length && !w.roles.includes(role)) return false;
  const rp = rolePerms(role);
  return rp === '*' || w.perms.every((p) => rp?.has(enumOf(p)));
};

describe('편집 목록 위젯 ↔ 서버', () => {
  it('스캔 하한 — 위젯 60개 이상 · GET 을 읽은 위젯 40개 이상(정규식이 빈 목록을 내며 통과하지 않게)', () => {
    expect(widgets.length).toBeGreaterThanOrEqual(60);
    expect(widgets.filter((w) => w.eps.length).length).toBeGreaterThanOrEqual(40);
  });

  it('🔴 역할이 넣을 수 있는 위젯의 조회 EP 를 서버가 그 역할에게 연다', () => {
    const bad: string[] = [];
    const unresolved: string[] = [];
    for (const w of widgets) {
      for (const role of SCAN_ROLES) {
        if (!canAdd(w, role)) continue;
        for (const ep of w.eps) {
          const ex = IN_COMPONENT[w.id];
          if (ex && ex.ep === ep && !ex.allowed.includes(role)) continue;
          const v = look(ep);
          if (!v) { unresolved.push(`${w.id} ${ep}`); continue; }
          if (v.pub) continue;
          const pn = v.perm?.match(/Permission\.(\w+)/g)?.map((x) => x.slice(11)) ?? [];
          const rp = rolePerms(role);
          const roleOk = !v.roles.length || v.roles.includes(role);
          const permOk = !pn.length || rp === '*' || pn.some((x) => rp?.has(x));
          if (!roleOk || !permOk) bad.push(`${w.id}|${role}|${ep}`);
        }
      }
    }
    expect(bad).toEqual([]);
    // 스캐너가 경로를 못 푼 것 — 측정 불가로 동결(조용히 늘지 않게)
    expect([...new Set(unresolved)].sort()).toEqual(['schedule /api/v1/clinic-schedule/today']);
  });

  it('위젯 안 역할 갈림 — 예외로 둔 조건이 소스에 있다(지우면 그 역할에게 늘 403)', () => {
    for (const [id, ex] of Object.entries(IN_COMPONENT)) {
      const w = widgets.find((x) => x.id === id)!;
      expect(w.eps, id).toContain(ex.ep);
      expect(w.src, id).toMatch(ex.cond);
    }
  });

  it('🔴 수술 일정 — 서버가 간호사의 병원 전체 조회를 핸들러 안에서 막는 동안 간호사는 위젯을 넣을 수 없다(데코레이터 스캔 밖)', () => {
    const ctrl = readFileSync(join(process.cwd(), 'src/modules/surgery/surgery.controller.ts'), 'utf8');
    expect(ctrl).toMatch(/if \(role === UserRole\.NURSE && !patientId\) throw new ForbiddenException/);
    const w = widgets.find((x) => x.id === 'surgery')!;
    expect(w.eps).toContain('/api/v1/surgery/schedule');
    expect(canAdd(w, 'NURSE')).toBe(false);
    expect(canAdd(w, 'DOCTOR')).toBe(true); // 대조군
  });
});
