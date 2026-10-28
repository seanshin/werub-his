/**
 * 대시보드 기본 배치 ↔ 역할 권한 정본(2026-10-03).
 *  🔴 운영 실탐침(역할 12종 · 139 호출): 행정(ADMIN_STAFF) 대시보드의 '병상 가동률'만 403 — 기본 배치가 READ 를 그대로 썼는데
 *     위젯 등록부는 그 위젯에 `patient:view` 를 요구하고 ROLE_PERMISSIONS 의 행정에는 없다. 등록부 판정은 편집 목록에만 쓰였다.
 *  · 모든 역할의 기본 배치 위젯이 그 역할의 등록부 역할·권한을 통과한다(정본 ROLE_PERMISSIONS 와 기계 대조)
 *  · 기본 배치는 모든 역할을 덮는다(빠지면 READ 로 떨어진다 — 의도면 명시)
 *  · 렌더도 등록부 판정을 쓴다 · 전자 인증서 배너 조회 역할 = 서버 @Roles
 * 재주입: 행정 배치에 병상 위젯을 되돌리거나 렌더 판정·인증서 게이트를 빼면 실패한다.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { UserRole } from '@prisma/client';
import { ROLE_PERMISSIONS } from '../../src/modules/auth/rbac/permission.types';

const WEB = join(__dirname, '../../../web/src/app/(main)/dashboard');
const read = (p: string) => readFileSync(join(WEB, p), 'utf8');

function parse() {
  const dl = read('components/default-layouts.ts');
  const consts = new Map<string, string[]>();
  for (const m of dl.matchAll(/const (\w+_DEFAULT): DashboardConfig = \{([\s\S]*?)\n\};/g)) {
    const lg = /lg: \[([\s\S]*?)\n    \]/.exec(m[2]);
    consts.set(m[1], lg ? [...lg[1].matchAll(/\{ i: '([\w-]+)'/g)].map((x) => x[1]) : []);
  }
  const map = dl.slice(dl.indexOf('const DEFAULT_CONFIGS'));
  const cfg = new Map([...map.matchAll(/^\s+(\w+):\s+(\w+_DEFAULT),/gm)].map((m) => [m[1], m[2]]));
  const reg = read('components/widget-registry.ts');
  const W = new Map<string, { roles: string[]; perms: string[] }>();
  for (const m of reg.matchAll(/\{ id: '([\w-]+)'.*?roles: \[([^\]]*)\].*?requiredPermissions: \[([^\]]*)\]/g)) {
    W.set(m[1], { roles: [...m[2].matchAll(/'(\w+)'/g)].map((x) => x[1]), perms: [...m[3].matchAll(/'([\w:]+)'/g)].map((x) => x[1]) });
  }
  return { consts, cfg, W };
}

describe('대시보드 기본 배치 ↔ ROLE_PERMISSIONS', () => {
  const { consts, cfg, W } = parse();

  it('대조군 — 파서가 살아 있다(역할·배치·위젯을 실제로 읽는다)', () => {
    expect(cfg.size).toBeGreaterThanOrEqual(13);
    expect(W.size).toBeGreaterThan(40);
    expect(consts.get('DOCTOR_DEFAULT')!.length).toBeGreaterThan(5);
  });

  it('🔴 모든 역할의 기본 배치 위젯이 그 역할의 등록부 역할·권한을 통과한다', () => {
    const bad: string[] = [];
    for (const [role, c] of cfg) {
      const perms = new Set<string>([...(ROLE_PERMISSIONS[role as UserRole] ?? [])]);
      for (const w of consts.get(c) ?? []) {
        const def = W.get(w);
        if (!def) { bad.push(`${role}:${w} 등록부에 없음`); continue; }
        if (def.roles.length && !def.roles.includes(role)) bad.push(`${role}:${w} 역할 밖`);
        const miss = def.perms.filter((p) => !perms.has(p));
        if (miss.length) bad.push(`${role}:${w} 권한 없음 ${miss.join(',')}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('기본 배치가 모든 역할을 덮는다', () => {
    expect(Object.values(UserRole).filter((r) => !cfg.has(r))).toEqual([]);
  });

  it('🔴 렌더가 등록부 판정을 쓰고 걸러진 수를 말한다', () => {
    const shell = read('components/DashboardShell.tsx');
    expect(shell).toMatch(/canAccessWidget\(def\.roles, def\.requiredPermissions, user\.role, user\.permissions \?\? \[\]\)/);
    expect(shell).toMatch(/\(item\) => !hiddenWidgets\.includes\(item\.i\) && allowed\(item\.i\)/);
    expect(shell).toMatch(/data-dashboard-blocked=/);
  });

  it('🔴 전자 인증서 배너 조회 역할 = 서버 GET blockchain-cert/my @Roles', () => {
    const ctl = readFileSync(join(__dirname, '../../src/modules/blockchain-cert/blockchain-cert.controller.ts'), 'utf8');
    const m = /@Get\('my'\)\s*@Roles\(([^)]*)\)/.exec(ctl)!;
    const server = [...m[1].matchAll(/UserRole\.(\w+)/g)].map((x) => x[1]).sort();
    const page = read('page.tsx');
    const web = [.../const CERT_ROLES = \[([^\]]*)\]/.exec(page)![1].matchAll(/'(\w+)'/g)].map((x) => x[1]).sort();
    expect(web).toEqual(server);
    expect(page).toMatch(/enabled: canCert,/);
  });
});
