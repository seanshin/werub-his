/**
 * 역할 × 화면 × EP 교차 스캐너 — `role-endpoint-baseline.spec.ts` 의 정본.
 *
 * 🔴 발굴 20회차(2026-08-29)에서 이 스캐너의 전신이 **다섯 번 틀렸다**:
 *   ① 핸들러 데코레이터 절단(종료 정규식이 `@Roles(` 자체에 걸림)
 *   ② `@Roles(...SPREAD_CONST)` 미전개 ③ 호출부 HTTP 메서드 무시
 *   ④ `@RequirePermission(A,B)` 를 AND 로 판정(서버는 `hasAnyPermission` = OR)
 *   ⑤ **주석 안의 데코레이터 문자열**을 코드로 읽음
 * 전부 교정한 뒤 **운영 실측 7/7 대조**를 통과한 규칙이 이 파일이다 — 고칠 때는
 * 스펙의 오라클(운영 실측 케이스)이 같이 지켜준다.
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import * as SHARED from '@hospital-run/shared';
import { EVERY_STAFF_ROLE } from '@hospital-run/shared';

const API_SRC = join(process.cwd(), 'src');
const WEB_SRC = join(process.cwd(), '..', 'web', 'src');

/**
 * 주석을 걷는다 — 주석 안 `@Roles(...)` 가 판정을 뒤집은 적이 있다(⑤).
 *
 * 🔴 (2026-09-16 D4) 정규식판은 **문자열 안의 `/*` 도 주석 시작으로 읽었다** — `fhir.controller.ts` 의
 *    설명 문자열 `(system/*)` 때문에 다음 JSDoc 종료까지 9,057자가 지워져 `/fhir/R4/Patient` 4개 라우트가
 *    이 스캔의 분모에서 통째로 빠져 있었다(가드가 못 본 구간 = 아무도 대조하지 않은 구간).
 *    문자열을 인식하는 정본 하나로 수렴한다(`handler-authz-scan.ts`).
 */
export { stripComments } from './handler-authz-scan';
import { stripComments, classDecoratorHead } from './handler-authz-scan';
// 호출 자리 게이트 판정 정본 — 실프로브(`scripts/probe-least-privilege.mjs`)와 같은 규칙을 쓴다
import { gateSignals, callContext, allGateIdentifiers, triggerGated } from '../../../../scripts/screen-call-gate.mjs';

// ── 1) nav: 역할 → 화면 ──────────────────────────────────────────────
export interface NavItem { href: string; roles: string[] }

/**
 * 🔴 (2026-09-14) 항목 배열의 전개식(`roles: [...CLINICAL,'RECEPTIONIST']`·`[...CHART_ACCESS_ROLES] as R`)을 풀지 않아
 *    `'...CLINICAL'` 이라는 **글자 그대로의 역할**로 담겼다 — 19화면에서 ADMIN·DOCTOR·NURSE 등이 대조에서 조용히 빠졌다
 *    (`/patients`·`/transfer`·`/patient-messages`·검진 7화면 …). 이제 Sidebar 지역 상수와 shared 정본 export 를 실제로 전개한다.
 *    풀지 못한 이름은 **측정 불가**로 `scanNavUnresolved()` 에 남는다 — 빠진 채 통과하지 않게 스펙이 목록을 동결한다.
 */
const unresolvedSpreads = new Set<string>();

function resolveSpread(name: string, C: Record<string, string[]>, where: string): string[] {
  if (C[name]) return C[name];
  const shared = (SHARED as Record<string, unknown>)[name];
  if (Array.isArray(shared) && shared.every((x) => typeof x === 'string')) return shared as string[];
  unresolvedSpreads.add(`${where}: ...${name}`);
  return [];
}

function parseRoleList(body: string, C: Record<string, string[]>, where: string): string[] {
  return body.split(',').map((x) => x.trim()).filter(Boolean).flatMap((x) =>
    x.startsWith('...') ? resolveSpread(x.slice(3).trim(), C, where) : [x.replace(/['"]/g, '')],
  ).filter(Boolean);
}

export function scanNav(): NavItem[] {
  const src = readFileSync(join(WEB_SRC, 'components/layout/Sidebar.tsx'), 'utf8');
  unresolvedSpreads.clear();
  const C: Record<string, string[]> = {};
  for (const m of src.matchAll(/^const (\w+): R = \[([^\]]*)\];/gm)) {
    C[m[1]] = parseRoleList(m[2], C, `const ${m[1]}`);
  }
  const items: NavItem[] = [];
  for (const m of src.matchAll(/\{\s*href:\s*'([^']+)'[^{}]*?roles:\s*([A-Z_]+|\[[^\]]*\])/g)) {
    const roles = m[2].startsWith('[')
      ? parseRoleList(m[2].slice(1, -1), C, m[1])
      : (C[m[2]] ?? resolveSpread(m[2], C, m[1]));
    items.push({ href: m[1], roles: [...new Set(roles)] });
  }
  return items;
}

/** 전개식·상수 이름을 풀지 못한 자리 — 이 화면들의 해당 역할은 대조되지 않는다(측정 불가) */
export function scanNavUnresolved(): string[] {
  scanNav();
  return [...unresolvedSpreads].sort();
}

// ── 2) 화면 → 호출 EP (메서드 포함 ③) ───────────────────────────────
function pageDir(href: string): string | null {
  for (const g of ['(main)', '']) {
    const d = join(WEB_SRC, 'app', g, href.replace(/^\//, ''));
    if (existsSync(join(d, 'page.tsx'))) return d;
  }
  return null;
}

export interface ScreenCall { ep: string; gated: boolean; signals: string[]; file: string }

/**
 * 🔴 (2026-09-16 K3) 종전 `readdirSync(dir)` 는 **그 폴더의 .tsx 만** 읽어 하위 폴더
 *    (`components/`·`_components/`)의 호출을 통째로 놓쳤다 — 실측 15화면에서 EP 238개가 보이지 않았고,
 *    `/reception`·`/ess`·`/imaging`·`/admin/chart-editor` 는 **EP 0개**로 잡혀 스캔 대상 자체가 아니었다
 *    (I3 이 실로그인으로 찾은 접수 워크인 트리아지 dead-button 이 바로 그 화면이다).
 *    하위 라우트(자체 `page.tsx` 보유)는 그 자체가 별도 nav 화면이라 제외한다 — 그 화면의 역할로 따로 대조된다.
 */
export function screenCalls(href: string): ScreenCall[] {
  const dir = pageDir(href);
  if (!dir) return [];
  const out = new Map<string, ScreenCall>();
  const walk = (d: string) => {
    for (const e of readdirSync(d)) {
      const f = join(d, e);
      if (statSync(f).isDirectory()) {
        if (!existsSync(join(f, 'page.tsx'))) walk(f);
        continue;
      }
      if (!e.endsWith('.tsx') && !e.endsWith('.ts')) continue;
      const s = readFileSync(f, 'utf8');
      // 이 파일에서 인증 훅으로 선언된 게이트 식별자(`const canDischarge = useHasRole('DOCTOR')`)
      const gateIds = allGateIdentifiers(s);
      for (const m of s.matchAll(/apiClient\.(get|post|patch|put|del|fetch)\s*<?[^(]*\(\s*[`'"]([^`'"]+)/g)) {
        let meth = m[1].toUpperCase();
        if (meth === 'DEL') meth = 'DELETE';
        const p = m[2].split('?')[0].replace(/\$\{[^}]*\}/g, ':x');
        if (!p.startsWith('/api/v1/')) continue;
        if (meth === 'FETCH') {
          const tail = s.slice(m.index!, m.index! + 400);
          meth = tail.match(/method:\s*'(\w+)'/)?.[1] ?? 'GET';
        }
        const ep = `${meth} ${p}`;
        const signals = gateSignals(callContext(s, m.index!), gateIds);
        // 호출 자리에 게이트가 없으면 **트리거(JSX 버튼)** 까지 따라간다
        const trig = signals.length === 0 ? triggerGated(s, m.index!, gateIds) : null;
        if (trig) signals.push(trig);
        const prev = out.get(ep);
        // 같은 EP 를 여러 자리에서 부르면 **게이트 없는 자리 하나라도 있으면** 대조 대상이다
        if (!prev || (prev.gated && signals.length === 0)) {
          out.set(ep, { ep, gated: signals.length > 0, signals, file: f });
        }
      }
    }
  };
  walk(dir);
  return [...out.values()].sort((a, b) => a.ep.localeCompare(b.ep));
}

export function screenEndpoints(href: string): string[] {
  return screenCalls(href).map((c) => c.ep);
}

/** 화면이 스스로 역할 분기하면(탭 접기 등) 이 스캔의 대상이 아니다 — 그 화면은 자기가 판단한다 */
export function screenSelfGates(href: string): boolean {
  const dir = pageDir(href);
  if (!dir) return false;
  /**
   * 🔴 대소문자를 놓쳐 `currentUser?.role` 을 자기게이팅으로 못 봤다(2026-08-30 · 스캐너 6번째 오류).
   *    동의서 워크스테이션은 `isDoctor ? 서명버튼 : '담당 의사 로그인 후 서명'` 으로 이미 막고
   *    있었는데 기준선에 결함으로 올라와 있었다. 역할 리터럴 비교도 함께 본다.
   */
  /**
   * 🔴 **로그인 사용자의 역할**만 자기게이팅으로 본다.
   *    · 처음엔 `user?.role` 만 봐서 `currentUser?.role` 을 놓쳤다(대소문자).
   *    · 넓히다가 `c.role === 'patient'`(동의서 **폼 컴포넌트 역할**)까지 삼켜
   *      /consent/templates 의 실결함 7건을 오탐으로 지울 뻔했다.
   *    그래서 "로그인 주체를 담는 식별자"에만 붙은 `.role` 로 조준을 좁힌다.
   */
  const SELF_GATE = /\b(?:\w*[Uu]ser|me|auth|account|profile|session)\?\.role\b|useAuthStore\([^)]*role|\buse(?:AdminWrite|HasRole)\(/;
  return readdirSync(dir).some((e) =>
    e.endsWith('.tsx') && SELF_GATE.test(readFileSync(join(dir, e), 'utf8')),
  );
}

// ── 3) 컨트롤러 인덱스 ───────────────────────────────────────────────
interface Handler { m: string; p: string; roles: string[]; perm: string | null; pub: boolean }
interface Ctrl { file: string; prefix: string; classRoles: string[]; hs: Handler[] }

/**
 * 🔴 shared 역할 정본에서 파생한 상수도 푼다(2026-09-02 · 스캐너 7번째 교정).
 *    `const X = EVERY_STAFF_ROLE.filter((r) => r !== 'READ').map((r) => r as UserRole)` 를
 *    못 풀어 `__UNRESOLVED_X` 로 남기면, **실제로는 더 열린** EP 가 전 역할 미스매치로 둔갑한다
 *    (정본으로 수렴시키자 교육 화면 3EP × 10역할이 거짓 미스매치로 올라왔다).
 *    허용 꼴은 `.filter((r) => r !== '<ROLE>')` 반복 + 끝의 `.map(...)` 뿐 —
 *    그 밖(포함 필터·concat 등)은 **지어내지 않고** UNRESOLVED 로 남긴다.
 */
function fromRoleCanon(name: string, src: string): string[] | null {
  const m = src.match(new RegExp(`(?:const|let)\\s+${name}[^=]*=\\s*EVERY_STAFF_ROLE([\\s\\S]*?);`));
  if (!m) return null;
  let tail = m[1].replace(/\s+/g, '');
  let roles = [...EVERY_STAFF_ROLE] as string[];
  tail = tail.replace(/\.map\(\(r\)=>ras\w+\)$/, '');
  while (tail.length) {
    const ex = tail.match(/^\.filter\(\(r\)=>r!=='(\w+)'\)/);
    if (!ex) return null; // 모르는 꼴 — 지어내지 않는다
    roles = roles.filter((r) => r !== ex[1]);
    tail = tail.slice(ex[0].length);
  }
  return roles;
}

/**
 * 🔴 (2026-09-14) 별칭 사슬도 푼다 — `const READ_ROLES = PATIENT_MESSAGE_READ_ROLES as unknown as UserRole[]` 가
 *    같은 모듈 정책 파일의 `export const PATIENT_MESSAGE_READ_ROLES = CHART_CLINICAL_ROLES`(shared 정본)를 가리키면
 *    그 배열을 쓴다. 꼴은 **순수 별칭**(`= 이름` + 선택적 `as …`)만 — 가공(filter·concat)은 지어내지 않고 UNRESOLVED.
 *    상대 import 를 최대 3단계 따라간다(nav 전개식을 풀자 이 EP 3개가 거짓 미스매치로 올라왔다).
 */
function fromAliasChain(name: string, src: string, file: string | undefined, depth = 0): string[] | null {
  if (depth > 3) return null;
  const shared = (SHARED as Record<string, unknown>)[name];
  if (Array.isArray(shared) && shared.every((x) => typeof x === 'string')) return shared as string[];
  const alias = src.match(new RegExp(`(?:export\\s+)?(?:const|let)\\s+${name}\\s*(?::[^=]+)?=\\s*(\\w+)\\s*(?:as\\s+[^;\\n]+)?;`));
  if (alias) return fromAliasChain(alias[1], src, file, depth + 1);
  if (!file) return null;
  const imp = src.match(new RegExp(`import\\s*\\{[^}]*\\b${name}\\b[^}]*\\}\\s*from\\s*'(\\.[^']+)'`));
  if (!imp) return null;
  const base = join(file, '..', imp[1]);
  const target = [`${base}.ts`, join(base, 'index.ts')].find((p) => existsSync(p));
  if (!target) return null;
  return fromAliasChain(name, stripComments(readFileSync(target, 'utf8')), target, depth + 1);
}

function expandRoles(txt: string, src: string, file?: string): string[] {
  const out = [...txt.matchAll(/UserRole\.(\w+)/g)].map((m) => m[1]);
  for (const sp of txt.matchAll(/\.\.\.(\w+)/g)) {
    const d = src.match(new RegExp(`(?:const|let)\\s+${sp[1]}[^=]*=\\s*\\[([^\\]]*)\\]`));
    if (d) { out.push(...[...d[1].matchAll(/UserRole\.(\w+)/g)].map((m) => m[1])); continue; }
    const canon = fromRoleCanon(sp[1], src);
    if (canon) { out.push(...canon); continue; }
    const aliased = fromAliasChain(sp[1], src, file);
    if (aliased) { out.push(...aliased); continue; }
    out.push(`__UNRESOLVED_${sp[1]}`); // ② 못 풀면 지어내지 않고 표식으로 남긴다
  }
  return [...new Set(out)];
}

export function scanControllers(): Ctrl[] {
  const ctrls: Ctrl[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(d)) {
      const f = join(d, e);
      if (statSync(f).isDirectory()) { walk(f); continue; }
      if (!e.endsWith('.controller.ts')) continue;
      const s = stripComments(readFileSync(f, 'utf8'));
      const marks = [...s.matchAll(/@Controller\('([^']*)'\)/g)];
      for (let i = 0; i < marks.length; i++) {
        // 클래스 데코레이터 블록(=@Controller 직전 400자)에서 클래스 @Roles 를 읽고,
        // 핸들러는 이 컨트롤러 구간(다음 @Controller 전)에서만 읽는다 — 한 파일 다중 컨트롤러 대응
        const at = marks[i].index!;
        const seg = s.slice(at, i + 1 < marks.length ? marks[i + 1].index! : s.length);
        /**
         * 🔴 (2026-09-16 I1) 종전 `at - 400` 고정 창은 **앞 클래스의 본문까지** 끌어와
         *    앞 클래스의 `@Roles` 를 뒤 클래스 것으로 붙였다(실측 8자리 — `api/v1/patients`·
         *    `api/v1/booking`·`api/v1/questionnaires` 등은 클래스 `@Roles` 가 **없다**).
         *    없는 역할 제한을 있다고 읽으면 이 스캐너의 "화면은 열렸는데 EP 는 닫혔다" 판정이 통째로 흔들린다.
         *    클래스 구간 분해는 정본 하나(`classDecoratorHead`)로 모은다.
         */
        const head = classDecoratorHead(s, at, i > 0 ? marks[i - 1].index! : 0);
        const classRoles = expandRoles(
          [...head.matchAll(/@Roles\(([^)]*)\)/g)].map((m) => m[1]).join(','), s, f);
        const hs: Handler[] = [];
        const re = /@(Get|Post|Put|Patch|Delete|Sse)\(\s*'?([^')]*)'?\s*\)([\s\S]{0,600}?)(?:\n\s*(?:async\s+)?\w+\s*\()/g; // ①
        let m: RegExpExecArray | null;
        while ((m = re.exec(seg))) {
          const blk = m[3];
          hs.push({
            m: m[1], p: m[2] || '',
            roles: [...blk.matchAll(/@Roles\(([^)]*)\)/g)].flatMap((x) => expandRoles(x[1], s, f)),
            perm: blk.match(/@RequirePermission\(([^)]*)\)/)?.[1] ?? null,
            pub: /@Public\(\)/.test(blk),
          });
        }
        ctrls.push({ file: f, prefix: '/' + marks[i][1].replace(/^\//, ''), classRoles, hs });
      }
    }
  };
  walk(join(API_SRC, 'modules'));
  return ctrls;
}

export interface Verdict { roles: string[]; perm: string | null; pub: boolean; file: string; h: string }

export function makeLookup(ctrls: Ctrl[]) {
  const norm = (p: string) => ('/' + p).replace(/\/+/g, '/').replace(/\/$/, '');
  return (spec: string): Verdict | null => {
    const [meth, path] = spec.includes(' ') ? spec.split(' ') : ['GET', spec];
    const clean = path.split('?')[0];
    let best: (Verdict & { plen: number }) | null = null;
    for (const c of ctrls) {
      if (!clean.startsWith(norm(c.prefix))) continue;
      const rest = clean.slice(norm(c.prefix).length).replace(/^\//, '');
      for (const h of c.hs) {
        if (h.m.toUpperCase() !== meth) continue; // ③
        const rx = new RegExp('^' + h.p.replace(/^\//, '').replace(/:[^/]+/g, '[^/]+') + '$');
        if (!rx.test(rest)) continue;
        const roles = h.roles.length ? h.roles : c.classRoles;
        if (!best || norm(c.prefix).length > best.plen) {
          best = { plen: norm(c.prefix).length, roles, perm: h.perm, pub: h.pub, file: c.file, h: `${h.m} ${h.p}` };
        }
      }
    }
    return best;
  };
}

// ── 4) 역할 → 권한 집합 ─────────────────────────────────────────────
export function rolePerms(role: string): Set<string> | '*' | null {
  const s = readFileSync(join(API_SRC, 'modules/auth/rbac/permission.types.ts'), 'utf8');
  const i = s.indexOf(`[UserRole.${role}]`);
  if (i < 0) return null;
  const blk = s.slice(i, s.indexOf(']),', i));
  if (/ALL_PERMISSIONS|Object\.values/.test(blk)) return '*';
  return new Set([...blk.matchAll(/Permission\.(\w+)/g)].map((m) => m[1]));
}

// ── 5) 전체 교차 → 미스매치 목록 ────────────────────────────────────
export const SCAN_ROLES = [
  'DOCTOR', 'NURSE', 'PHARMACIST', 'LAB_TECH', 'NUTRITION', 'RECEPTIONIST',
  'ADMIN_STAFF', 'MEDICAL_RECORDS', 'CHECKUP', 'CRM_MANAGER', 'CRM_STAFF', 'EXECUTIVE', 'READ',
] as const;

/** `"<화면>|<METHOD /path>|<역할,…(정렬)>"` — 집합 대조용 안정 표현 */
/**
 * 🔴 **이 스캔의 한계를 여기 적는다** — 자기게이팅 판정은 **화면 단위**다.
 *    화면의 한 버튼이라도 역할로 감싸면 그 화면의 **모든 EP** 가 스캔에서 빠진다.
 *    그래서 기준선이 0이 되어도 "미스매치가 없다"가 아니라
 *    "**스캔 대상 밖이거나** 미스매치가 없다"이다.
 *    (실증: `/staff-meal` 을 ADMIN 전용으로 되돌려도 기준선 가드가 못 잡았다 —
 *     그 화면이 이미 자기게이팅으로 분류돼 있었기 때문. 오라클 테스트가 대신 잡았다.)
 *    → 빠진 화면 수를 함께 동결해 **조용히 늘어나는 것**을 막는다(`selfGatedScreens`).
 */
export function selfGatedScreens(): string[] {
  const seen = new Set<string>();
  for (const item of scanNav()) {
    if (seen.has(item.href)) continue;
    seen.add(item.href);
  }
  return [...seen].filter((h) => screenEndpoints(h).length > 0 && screenSelfGates(h)).sort();
}

/**
 * 🔴 (2026-09-16 K3) 게이트를 달아 대조에서 빠지는 **호출** 목록 — 종전의 `selfGatedScreens`(화면 단위)를 대신한다.
 *    화면 단위 제외는 버튼 하나로 화면 전체를 가렸다(실측: `/billing` 7EP). 이제 빠지는 단위가 호출이라
 *    **무엇이 빠졌는지**가 이 목록으로 보인다 — 조용히 늘면 실패한다.
 */
export function gatedCalls(): string[] {
  const out = new Set<string>();
  for (const href of new Set(scanNav().map((i) => i.href))) {
    for (const c of screenCalls(href)) if (c.gated) out.add(`${href}|${c.ep}|${c.signals.join(',')}`);
  }
  return [...out].sort();
}

export function scanMismatches(): string[] {
  const nav = scanNav();
  const ctrls = scanControllers();
  const lookup = makeLookup(ctrls);
  const perms = new Map<string, Set<string> | '*' | null>();
  const epCache = new Map<string, ScreenCall[]>();
  const pairs = new Map<string, Set<string>>();

  for (const role of SCAN_ROLES) {
    if (!perms.has(role)) perms.set(role, rolePerms(role));
    const rp = perms.get(role)!;
    for (const item of nav) {
      if (!item.roles.includes(role)) continue;
      if (!epCache.has(item.href)) epCache.set(item.href, screenCalls(item.href));
      for (const call of epCache.get(item.href)!) {
        // 🔴 (K3) 종전엔 **화면 단위**로 건너뛰었다 — 버튼 하나만 역할로 감싸도 그 화면 EP 가 전부 빠졌다.
        //    이제 게이트를 단 **그 호출만** 뺀다(정본 `screen-call-gate.mjs`).
        if (call.gated) continue;
        const ep = call.ep;
        const r = lookup(ep);
        if (!r || r.pub) continue;
        const roleOk = r.roles.length === 0 || r.roles.includes(role);
        const permOk = !r.perm || rp === '*' ||
          (rp instanceof Set && [...r.perm.matchAll(/Permission\.(\w+)/g)].some((x) => rp.has(x[1]))); // ④ OR
        if (roleOk && permOk) continue;
        const key = `${item.href}|${ep}`;
        if (!pairs.has(key)) pairs.set(key, new Set());
        pairs.get(key)!.add(role);
      }
    }
  }
  return [...pairs.entries()].map(([k, rs]) => `${k}|${[...rs].sort().join(',')}`).sort();
}
