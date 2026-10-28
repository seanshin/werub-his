import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';

/**
 * 🔴 **코드가 읽는 설정 키는 관리 화면에 떠야 한다** — `DEFAULTS` 미등재 키는 아무 데도 보이지 않는다.
 *
 * 이 저장소가 **세 번** 겪은 유형이다(`config-runtime.service.ts` 주석에 앞의 두 번이 적혀 있다).
 * 2026-09-09 세 번째: `i18n.reviewers` 를 서버는 읽는데 `DEFAULTS` 에 없어 **관리 목록에 뜨지 않았고**,
 * 그래서 언어별 검수자를 지정할 방법이 아무 데도 없어 **쓰기 주체가 ADMIN 하나로 고착**돼 있었다.
 *
 * 🔴 `DEFAULTS` 등재는 **DB 행을 만들지 않는다**(값의 출처는 여전히 DB 행 > 코드 기본값).
 *    여기서 지키는 것은 "그 키가 존재한다는 사실이 보이는가" 하나다.
 *
 * 🔴 예외는 **사유와 함께** 동결한다. 사유 없이 목록에 넣으면 이 가드는 죽는다.
 */

const API_SRC = path.join(__dirname, '..', '..', 'src');

/** `getAll` 이 의도적으로 제외하는 카테고리이거나, 전용 EP·화면으로 읽고 쓰는 키 */
const ALLOWED_UNREGISTERED: Record<string, string> = {
  // category 'access' — `getAll()` 이 명시적으로 제외한다(`notIn: ['access','role-data-access']`).
  // 전용 EP 가 있다: GET/PUT /api/v1/access-control/menu-overrides · /menu-custom
  'access.menu.overrides': "category 'access' — getAll 제외 대상이고 전용 EP(GET/PUT menu-overrides)가 있다",
  'access.menu.custom': "category 'access' — getAll 제외 대상이고 전용 EP(GET/PUT menu-custom)가 있다",
  // governance.service 가 'access 동류'로 분류한다(정책 오버라이드 — 접근 권한 관리 화면 소관)
  'rbac.roleOverrides': "access 동류 정책 오버라이드(governance.service 가 그렇게 분류한다)",

  /* 🔴 아래 둘은 **예외가 아니라 잔여**다 — 사유를 적어 동결하되 "정상"이라고 말하지 않는다.
   *    (정본 `docs/01-plan/features/ui-locale-i18n.plan.md` §12 와 같은 성격의 목록) */
  'ai.oversight.quickAcceptSec':
    '🔴 잔여 — 코드가 읽지만 쓰기 경로가 어디에도 없다(설정할 방법이 없다). 서비스는 미설정을 정직하게 말하고 있다',
  'automapper.config':
    '🔴 잔여 — 화면 소비처(admin/codes/auto-mapping-dashboard.tsx)는 있으나 DEFAULTS 미등재라 설정 목록에 뜨지 않는다',
};

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...tsFiles(p));
    else if (e.name.endsWith('.ts') && !e.name.endsWith('.spec.ts')) out.push(p);
  }
  return out;
}

function registeredKeys(): Set<string> {
  const src = fs.readFileSync(path.join(API_SRC, 'modules/config/config-runtime.service.ts'), 'utf8');
  const start = src.indexOf('export const DEFAULTS');
  const block = src.slice(start, src.indexOf('\n};', start));
  return new Set([...block.matchAll(/^\s*'([^']+)':\s*\{\s*key:/gm)].map((m) => m[1]));
}

function usedKeys(): Map<string, Set<string>> {
  const used = new Map<string, Set<string>>();
  for (const f of tsFiles(API_SRC)) {
    if (f.includes(`${path.sep}modules${path.sep}config${path.sep}`)) continue;
    const s = fs.readFileSync(f, 'utf8');
    const rel = path.relative(API_SRC, f);
    const add = (k: string) => {
      if (!used.has(k)) used.set(k, new Set());
      used.get(k)!.add(rel);
    };
    // configRuntime.get('x.y') / config.getBool('x.y') 등
    for (const m of s.matchAll(/config(?:Runtime|Service)?\s*\.\s*get\w*\(\s*'([a-zA-Z][\w.]*\.[\w.]+)'/g)) add(m[1]);
    // prisma.systemConfig.findUnique({ where: { key: 'x.y' } })
    for (const m of s.matchAll(/systemConfig\.find\w+\(\s*\{\s*where:\s*\{\s*key:\s*'([a-zA-Z][\w.]*\.[\w.]+)'/g)) add(m[1]);
    // const CONFIG_KEY = 'x.y' / static readonly X_CONFIG_KEY = 'x.y'
    for (const m of s.matchAll(/[A-Z_]*CONFIG_KEY\s*=\s*'([a-zA-Z][\w.]*\.[\w.]+)'/g)) add(m[1]);
  }
  return used;
}

describe('🔴 설정 키 — 코드가 읽는 것은 관리 화면에 뜬다', () => {
  const registered = registeredKeys();
  const used = usedKeys();

  it('대조군 — 스캔이 실제로 읽었다(0 이면 이 가드는 아무것도 보증하지 않는다)', () => {
    expect(registered.size, 'DEFAULTS 를 파싱하지 못했다').toBeGreaterThan(300);
    expect(used.size, '코드에서 설정 키를 하나도 찾지 못했다 — 정규식이 죽었다').toBeGreaterThan(50);
    // 방금 회수한 키가 실제로 스캔에 잡히는지(오라클)
    expect([...used.keys()], 'i18n.reviewers 를 스캔이 놓친다 — 이 가드가 그 사고를 다시 못 잡는다')
      .toContain('i18n.reviewers');
  });

  it('코드가 읽는 설정 키가 DEFAULTS 에 등재돼 있다(예외는 사유와 함께 동결)', () => {
    const missing = [...used.entries()]
      .filter(([k]) => !registered.has(k) && !(k in ALLOWED_UNREGISTERED))
      .map(([k, files]) => `${k}  ← ${[...files].slice(0, 2).join(' , ')}`)
      .sort();
    expect(
      missing,
      `DEFAULTS 미등재 설정 키 — 관리 화면에 뜨지 않아 아무도 설정할 수 없다.\n등재하거나, 전용 EP·화면이 있다면 ALLOWED_UNREGISTERED 에 **사유와 함께** 넣어라:\n${missing.join('\n')}`,
    ).toEqual([]);
  });

  it('🔴 예외 목록이 낡지 않았다 — 등재된 키가 예외로 남아 있지 않다', () => {
    const stale = Object.keys(ALLOWED_UNREGISTERED).filter((k) => registered.has(k));
    expect(stale, `이미 DEFAULTS 에 등재됐는데 예외로 남아 있다(목록을 줄여라): ${stale.join(', ')}`).toEqual([]);
    const unused = Object.keys(ALLOWED_UNREGISTERED).filter((k) => !used.has(k));
    expect(unused, `코드가 더는 읽지 않는데 예외로 남아 있다: ${unused.join(', ')}`).toEqual([]);
  });

  it('🔴 i18n.reviewers 는 등재돼 있다 — 검수자를 지정할 수 있어야 검수 축이 동작한다', () => {
    expect(registered.has('i18n.reviewers')).toBe(true);
  });
});
