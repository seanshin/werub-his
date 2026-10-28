#!/usr/bin/env node
/**
 * 최소 권한 실로그인 프로브 — 🔴 **로컬 전용**(운영 대상 금지).
 *
 * 왜: 판정 규칙 §5 는 "최소 권한 계정으로 **실제 로그인해** 전역 EP 를 훑는다 — 정적 분석은 호출 형태를
 * 놓친다"이다. D4·E3·H3 가 연달아 "워크트리에 의존성이 없어 API 를 못 띄웠다"며 정적 대조로만 판정했고,
 * 그 사이 E3 가 "다른 축 소관"이라 넘긴 3건이 H3 에서 실제 결함으로 드러났다. 이 스크립트는 그 훑기를
 * **재현 가능**하게 만든다.
 *
 * 하는 일: nav(Sidebar) 가 각 역할에게 보여주는 화면 → 그 화면 소스가 부르는 `/api/v1/...` GET EP 를
 * 뽑아, 역할별 토큰으로 실제 호출하고 상태코드를 표로 남긴다. 쓰기(POST/PATCH/PUT/DELETE)는 **부르지 않는다**.
 *
 * 🔴 운영(his.example.org)에 겨누지 말 것 — 반복 로그인은 15분 계정 잠금을 부른다. BASE 기본값은 localhost 이고
 *    localhost 가 아니면 즉시 중단한다.
 *
 * 사용: node scripts/probe-least-privilege.mjs [--base http://localhost:4100] [--out /tmp/probe.json]
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gateSignals, callContext, gateIdentifiers } from './screen-call-gate.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k, d) => {
  const i = process.argv.indexOf(k);
  return i > -1 ? process.argv[i + 1] : d;
};
const BASE = arg('--base', 'http://localhost:4100');
const OUT = arg('--out', '/tmp/i3/probe.json');
const PASSWORD = 'staff1234!';

if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(BASE)) {
  console.error(`🔴 로컬 전용 스크립트다 — BASE=${BASE} 는 허용하지 않는다(운영 반복 로그인은 계정 잠금).`);
  process.exit(2);
}

/** 프로브 계정 — 최소 권한 축 + 대조군(의사·간호사·관리자) */
const ACCOUNTS = [
  ['RECEPTIONIST', 'lee.wonmu@hospital.example.org'],
  ['NUTRITION', 'kim.geupyang@hospital.example.org'],
  ['MEDICAL_RECORDS', 'choi.uimu@hospital.example.org'],
  ['CHECKUP', 'ck.admin@hospital.example.org'],
  ['ADMIN_STAFF', 'park.haengjeong@hospital.example.org'],
  ['EXECUTIVE', 'hong.director@hospital.example.org'],
  ['CRM_STAFF', 'crm.checkup@hospital.example.org'],
  ['CRM_MANAGER', 'crm.manager@hospital.example.org'],
  ['READ', 'twin-svc@hospitalrun.example'],
  ['DOCTOR', 'choi.oegwa@hospital.example.org'],
  ['NURSE', 'cho.ganho@hospital.example.org'],
  ['ADMIN', 'admin@hospital.example.org'],
];

// ── nav 파싱 — Sidebar 의 역할 상수를 풀어 화면별 허용 역할을 만든다 ────────────────
function navByRole() {
  const src = readFileSync(join(ROOT, 'apps/web/src/components/layout/Sidebar.tsx'), 'utf8');
  const consts = {};
  const line = (name) => {
    const m = src.match(new RegExp(`const ${name}: R = ([^;]+);`));
    return m ? m[1] : null;
  };
  const parse = (expr) => {
    const out = [];
    for (const m of expr.matchAll(/'([A-Z_]+)'/g)) out.push(m[1]);
    for (const m of expr.matchAll(/\.\.\.([A-Z_]+)/g)) out.push(...(consts[m[1]] ?? []));
    return [...new Set(out)];
  };
  for (const name of ['ALL', 'ALL_WITH_READ', 'EVERY_ROLE', 'CLINICAL', 'SAFETY_REPORTERS', 'ADMIN_ONLY', 'DOCTOR_ADMIN']) {
    const e = line(name);
    if (e) consts[name] = parse(e);
  }
  const items = [];
  for (const m of src.matchAll(/\{\s*href:\s*'([^']+)'[^}]*?roles:\s*([A-Za-z_]+|\[[^\]]*\])/g)) {
    const [, href, rolesExpr] = m;
    const roles = rolesExpr.startsWith('[') ? parse(rolesExpr) : (consts[rolesExpr] ?? []);
    if (roles.length) items.push({ href, roles });
  }
  return items;
}

// ── 화면 소스 → 그 화면이 부르는 EP ───────────────────────────────────────────
/**
 * 🔴 하위 라우트가 **그 자체로 nav 화면**이면 부모의 EP 로 세지 않는다.
 *    첫 판은 `/his-checkup` 아래를 통째로 걸어 `/his-checkup/programs`(nav: ADMIN 전용)의 EP 를
 *    CHECKUP 역할의 403 으로 셌다 — 화면이 열리지도 않는 자리를 "화면은 열렸는데 403"이라 부를 뻔했다.
 */
function pageFilesFor(href, allHrefs) {
  const rel = href.replace(/^\//, '');
  const roots = ['apps/web/src/app/(main)', 'apps/web/src/app'];
  const nested = allHrefs
    .filter((h) => h !== href && h.startsWith(`${href}/`))
    .map((h) => h.replace(/^\//, ''));
  const found = [];
  for (const r of roots) {
    const dir = join(ROOT, r, rel);
    try {
      if (statSync(dir).isDirectory()) {
        for (const f of walk(dir)) {
          if (!/\.tsx?$/.test(f)) continue;
          const relPath = f.slice(join(ROOT, r).length + 1);
          if (nested.some((n) => relPath.startsWith(`${n}/`))) continue; // 별도 nav 화면의 파일
          found.push(f);
        }
      }
    } catch {
      /* 그 라우트 그룹에 없다 — 다음 후보 */
    }
    if (found.length) break;
  }
  return found;
}
function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const DUMMY_UUID = '00000000-0000-4000-8000-000000000001';
/** `${x}` 보간은 더미 uuid 로 — 403(역할 차단)과 404(권한 통과·대상 없음)를 가르는 것이 목적이다 */
function normalizeEp(raw) {
  let p = raw.split('?')[0].trim();
  if (!p.startsWith('/api/')) return null;
  p = p.replace(/\$\{[^}]*\}/g, DUMMY_UUID);
  if (p.includes('${') || p.endsWith('/')) p = p.replace(/\/$/, `/${DUMMY_UUID}`);
  return p;
}
/**
 * 🔴 (2026-09-16 J2) 이 스캐너는 **호출 조건을 모른다** — 화면이 `enabled:`·역할 게이트로 막아 둔 호출까지
 *    그대로 부른다. J2 에서 403 58 쌍 중 다수가 그 오탐이었다(대시보드 역할별 위젯 25·`journey-access`·
 *    `safety-access`·`enabled: canAct` 등). 그래서 **부르되, 그 자리가 게이트를 달고 있는지 함께 싣는다**
 *    — 숨기지 않고 드러낸다. `gated: true` 면 "화면은 열렸는데 403" 후보에서 먼저 뺀다.
 *
 * 🔴 (2026-09-16 K3) 판정은 `screen-call-gate.mjs` 정본 하나로 모았다 — 정적 스캐너
 *    (`role-endpoint-scan.ts`)가 같은 규칙을 쓴다. 둘이 따로 판정하면 갈라진다.
 */
function epsOf(file) {
  const src = readFileSync(file, 'utf8');
  // 이 파일의 인증 훅 파생 게이트 식별자(`const canX = useHasRole(...)`) — 정본과 같은 규칙을 쓴다
  const gateIds = gateIdentifiers(src);
  const eps = [];
  for (const m of src.matchAll(/apiClient\.(get|post|patch|put|delete)\s*(?:<[\s\S]*?>)?\s*\(\s*[`'"]([^`'"]+)/g)) {
    const [, method, raw] = m;
    const p = normalizeEp(raw);
    if (!p) continue;
    const signals = gateSignals(callContext(src, m.index), gateIds);
    eps.push({ method: method.toUpperCase(), path: p, gated: signals.length > 0, signals });
  }
  return eps;
}

// ── 프로브 ────────────────────────────────────────────────────────────────
async function login(email) {
  const r = await fetch(`${BASE}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  if (!r.ok) return null;
  const j = await r.json();
  return j?.data?.accessToken ?? null;
}
async function probe(token, path) {
  try {
    const r = await fetch(`${BASE}${path}`, { headers: { Authorization: `Bearer ${token}` } });
    return r.status;
  } catch (e) {
    return `ERR:${String(e.message).slice(0, 40)}`;
  }
}

/** 역할이 **보면 안 되는** 임상 표본 — 권한 역전(200 이면 결함) */
const INVERSE_SAMPLES = [
  '/api/v1/orders',
  '/api/v1/prescriptions',
  '/api/v1/lab/results',
  '/api/v1/nursing/records',
  '/api/v1/icu/dashboard',
  '/api/v1/vitals/news2/alerts',
];

async function main() {
  const nav = navByRole();
  const allHrefs = nav.map((n) => n.href);
  const screensFor = (role) => nav.filter((n) => n.roles.includes(role)).map((n) => n.href);
  const rows = [];
  const tokens = {};

  for (const [role, email] of ACCOUNTS) {
    const token = await login(email);
    tokens[role] = token;
    if (!token) {
      rows.push({ role, screen: '-', ep: 'LOGIN', status: 'LOGIN_FAIL', verdict: '🔴 로그인 실패' });
      continue;
    }
    const seen = new Set();
    for (const href of screensFor(role)) {
      for (const file of pageFilesFor(href, allHrefs)) {
        for (const { method, path, gated, signals } of epsOf(file)) {
          if (method !== 'GET') continue; // 🔴 쓰기는 부르지 않는다
          const key = `${href}|${path}`;
          if (seen.has(key)) continue;
          seen.add(key);
          const status = await probe(token, path);
          const verdict =
            status === 403
              ? gated
                ? '403(호출부에 게이트 있음 — 오탐 후보)'
                : '🔴 화면은 열렸는데 403'
              : status === 401 ? '🔴 401' : status < 500 ? 'ok' : `🔴 ${status}`;
          rows.push({ role, screen: href, ep: path, status, gated, signals, verdict });
        }
      }
    }
  }

  // 권한 역전 — 비임상 역할이 임상 EP 를 200 으로 받는가
  const inverse = [];
  for (const role of ['RECEPTIONIST', 'NUTRITION', 'MEDICAL_RECORDS', 'CRM_STAFF', 'READ', 'EXECUTIVE']) {
    if (!tokens[role]) continue;
    for (const ep of INVERSE_SAMPLES) {
      const status = await probe(tokens[role], ep);
      inverse.push({ role, ep, status, verdict: status === 200 ? '🔴 보면 안 되는데 200' : 'ok' });
    }
  }

  writeFileSync(OUT, JSON.stringify({ base: BASE, at: new Date().toISOString(), rows, inverse }, null, 2));
  const bad = rows.filter((r) => r.verdict.startsWith('🔴'));
  const badInv = inverse.filter((r) => r.verdict.startsWith('🔴'));
  console.log(`probed ${rows.length} (screen×EP) · 🔴 ${bad.length}`);
  for (const r of bad) console.log(`  ${r.role}\t${r.screen}\t${r.ep}\t${r.status}`);
  console.log(`inverse ${inverse.length} · 🔴 ${badInv.length}`);
  for (const r of badInv) console.log(`  ${r.role}\t${r.ep}\t${r.status}`);
  console.log(`out: ${OUT}`);
}

main();
