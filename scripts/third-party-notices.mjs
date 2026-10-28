#!/usr/bin/env node
/**
 * 서드파티 고지 생성기 — 상용 릴리즈 기획 T7-2 (2026-09-13).
 *
 * 🔴 정본은 `package-lock.json`(lockfileVersion 3)이다 — `node_modules` 가 아니다.
 *    · lockfile 은 커밋되어 있어 **어느 체크아웃에서든 같은 결과**가 나온다(워크트리·CI 포함).
 *    · `node_modules` 는 설치한 기계의 플랫폼(OS·CPU)에 따라 선택 바이너리가 다르게 깔린다 —
 *      그래서 "설치됨" 여부는 **보조 열**로만 표시한다(`--installed-root` 또는 상위 디렉터리 자동 탐색).
 *
 * 🔴 무엇이 배포 산출물에 들어가는지는 **도달성**으로 가른다(npm 의 `dev` 플래그만으로는 워크스페이스를 가를 수 없다):
 *    각 워크스페이스의 `dependencies`·`optionalDependencies`·`peerDependencies` 에서 Node 해석 규칙
 *    (가까운 `node_modules` → 상위로)으로 따라간 전이 집합 = 그 산출물의 런타임 의존.
 *    `devDependencies` 로만 닿는 것 = 개발 전용.
 *    ⚠ 한계: 번들러(Next·Nest 빌드)가 실제로 산출물에 넣는지는 보지 않는다 — **런타임 의존 선언 기준 상한**이다.
 *
 * 사용: node scripts/third-party-notices.mjs [--out THIRD-PARTY-NOTICES.md] [--installed-root <dir>] [--json]
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const args = process.argv.slice(2);
const argOf = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };

const lock = JSON.parse(readFileSync(join(ROOT, 'package-lock.json'), 'utf8'));
if (lock.lockfileVersion !== 3) throw new Error(`lockfileVersion ${lock.lockfileVersion} — 3 을 기대한다(파서가 틀린 모양을 조용히 읽지 않게)`);
const P = lock.packages;

/** 설치 루트 — 인자 없으면 이 저장소부터 위로 올라가며 `node_modules/.package-lock.json` 을 찾는다(워크트리는 부모 저장소 것을 쓴다) */
function findInstalledRoot() {
  const explicit = argOf('--installed-root');
  if (explicit) return resolve(explicit);
  let d = ROOT;
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(d, 'node_modules', '.package-lock.json'))) return d;
    const up = dirname(d);
    if (up === d) break;
    d = up;
  }
  return null;
}
const INSTALLED_ROOT = findInstalledRoot();

/** 산출물 묶음 — 워크스페이스 경로 → 판매·배포 단위 */
const ARTIFACTS = [
  { id: 'his', label: 'HIS 서버(api·web·shared)', workspaces: ['apps/api', 'apps/web', 'packages/shared'] },
  { id: 'homepage', label: '공개 홈페이지(apps/homepage)', workspaces: ['apps/homepage'] },
  { id: 'mobile', label: '환자 모바일 앱(apps/mobile)', workspaces: ['apps/mobile'] },
];

/** Node 해석: from 위치에서 name 을 찾는다 */
function resolveDep(from, name) {
  let base = from;
  for (;;) {
    const cand = base ? `${base}/node_modules/${name}` : `node_modules/${name}`;
    if (P[cand]) return follow(cand);
    if (!base) return null;
    const idx = base.lastIndexOf('/node_modules/');
    base = idx >= 0 ? base.slice(0, idx) : '';
  }
}
function follow(key) {
  const e = P[key];
  if (e && e.link && e.resolved) return e.resolved; // 워크스페이스 링크 → 실제 경로
  return key;
}

function walk(startKeys) {
  const seen = new Set();
  const stack = [...startKeys];
  while (stack.length) {
    const key = stack.pop();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const e = P[key] || {};
    const deps = { ...(e.dependencies || {}), ...(e.optionalDependencies || {}), ...(e.peerDependencies || {}) };
    for (const d of Object.keys(deps)) {
      const r = resolveDep(key, d);
      if (r) stack.push(r);
    }
  }
  return seen;
}
function directKeys(ws, fields) {
  const e = P[ws] || {};
  const out = [];
  for (const f of fields) for (const d of Object.keys(e[f] || {})) { const r = resolveDep(ws, d); if (r) out.push(r); }
  return out;
}

const isPkg = (k) => k.includes('node_modules/');
const nameOf = (k) => k.slice(k.lastIndexOf('node_modules/') + 'node_modules/'.length);
const WS_KEYS = new Set(Object.keys(P).filter((k) => !isPkg(k)));

const reach = {};
for (const a of ARTIFACTS) {
  const s = new Set();
  for (const ws of a.workspaces) for (const k of walk(directKeys(ws, ['dependencies', 'optionalDependencies', 'peerDependencies']))) s.add(k);
  reach[a.id] = s;
}
const devReach = new Set();
for (const ws of WS_KEYS) for (const k of walk(directKeys(ws, ['devDependencies']))) devReach.add(k);

/** 라이선스 분류 — 상용 고지에서 따로 봐야 하는 것 */
const PERMISSIVE = /^(MIT|ISC|Apache-2\.0|BSD-2-Clause|BSD-3-Clause|0BSD|BlueOak-1\.0\.0|Unlicense|CC0-1\.0|Python-2\.0|CC-BY-4\.0|MIT-0|\(MIT OR CC0-1\.0\)|\(MIT OR Apache-2\.0\)|MIT AND Apache-2\.0|\(MIT AND Zlib\)|WTFPL OR ISC)$/;
function classify(lic) {
  if (!lic) return 'UNKNOWN';
  if (/AGPL|SSPL|BUSL/i.test(lic)) return 'STRONG_COPYLEFT';
  if (/\bGPL/i.test(lic) && /\bOR\b/i.test(lic)) return 'CHOICE_GPL';
  if (/\bGPL/i.test(lic) && !/LGPL/i.test(lic)) return 'STRONG_COPYLEFT';
  if (/LGPL/i.test(lic)) return 'LGPL';
  if (/MPL/i.test(lic) && !/\bOR\b/i.test(lic)) return 'MPL';
  if (/SEE LICENSE/i.test(lic)) return 'CUSTOM';
  if (PERMISSIVE.test(lic)) return 'PERMISSIVE';
  if (/MPL/i.test(lic)) return 'PERMISSIVE_CHOICE';
  return 'OTHER';
}
const BADGE = { STRONG_COPYLEFT: '🔴', UNKNOWN: '🔴', CHOICE_GPL: '🟡', LGPL: '🟡', MPL: '🟡', CUSTOM: '🟡', OTHER: '🟡', PERMISSIVE_CHOICE: '⚪', PERMISSIVE: '⚪' };
const CLASS_LABEL = {
  STRONG_COPYLEFT: '🔴 강한 카피레프트(GPL/AGPL/SSPL/BUSL)',
  CHOICE_GPL: '🟡 선택형(GPL 과 허용 라이선스 중 택일)',
  LGPL: '🟡 LGPL(약한 카피레프트 — 동적 링크·교체 가능성 고지)',
  MPL: '🟡 MPL-2.0(파일 단위 카피레프트 — 수정 시 해당 파일 공개)',
  CUSTOM: '🟡 별도 라이선스 파일 참조(SEE LICENSE IN …)',
  UNKNOWN: '🔴 라이선스 표기를 어디서도 찾지 못함(lockfile·설치본·수동 확인 모두 없음)',
  OTHER: '🟡 분류표에 없는 표기',
  PERMISSIVE_CHOICE: '허용(선택형 — 허용 라이선스 선택 가능)',
  PERMISSIVE: '허용(MIT·Apache·BSD·ISC 등)',
};

/**
 * 표기가 lockfile·package.json 어디에도 없어 **사람이 원문을 읽고 확인한 것만** 적는다(버전 고정 — 버전이 바뀌면 다시 확인).
 * 🔴 여기 없는 무표기 패키지는 UNKNOWN 으로 남긴다 — 추측으로 채우지 않는다.
 */
const MANUAL_EVIDENCE = {
  'pause@0.0.1': { license: 'MIT', evidence: 'node_modules/pause/Readme.md §License "(The MIT License)" · package.json license 필드 없음' },
};

function installedOf(key) {
  if (!INSTALLED_ROOT) return null;
  return existsSync(join(INSTALLED_ROOT, key, 'package.json'));
}
/** lockfile 에 라이선스가 없으면 설치본 package.json 에서 보충한다(출처를 함께 적는다) */
function licenseOf(key) {
  const e = P[key];
  if (e.license) return { license: e.license, source: 'lockfile' };
  if (INSTALLED_ROOT) {
    const pj = join(INSTALLED_ROOT, key, 'package.json');
    if (existsSync(pj)) {
      try {
        const j = JSON.parse(readFileSync(pj, 'utf8'));
        const l = typeof j.license === 'string' ? j.license : j.license?.type ?? (Array.isArray(j.licenses) ? j.licenses.map((x) => x.type ?? x).join(' OR ') : undefined);
        if (l) return { license: l, source: 'installed package.json' };
      } catch { /* 설치본을 못 읽으면 UNKNOWN 으로 남긴다 — 지어내지 않는다 */ }
    }
  }
  const manual = MANUAL_EVIDENCE[`${nameOf(key)}@${e.version}`];
  if (manual) return { license: manual.license, source: `🧑 수동 확인 — ${manual.evidence}` };
  return { license: null, source: '없음' };
}

const rows = Object.keys(P).filter((k) => isPkg(k) && !P[k].link).map((k) => {
  const e = P[k];
  const { license, source } = licenseOf(k);
  const groups = ARTIFACTS.filter((a) => reach[a.id].has(k)).map((a) => a.id);
  return {
    key: k, name: nameOf(k), version: e.version ?? '', license, licenseSource: source, cls: classify(license),
    groups, devOnly: groups.length === 0 && devReach.has(k), unreached: groups.length === 0 && !devReach.has(k),
    npmDevFlag: !!e.dev, optional: !!e.optional, installed: installedOf(k),
  };
});

/** 누가 끌어오는가 — 특이 라이선스를 판단할 때 "빌드 도구 경유인지 런타임 경유인지"를 사람이 보게 한다 */
const dependents = new Map();
for (const [k, e] of Object.entries(P)) {
  const deps = { ...(e.dependencies || {}), ...(e.optionalDependencies || {}), ...(e.peerDependencies || {}) };
  for (const d of Object.keys(deps)) {
    const r = resolveDep(k, d);
    if (!r) continue;
    if (!dependents.has(r)) dependents.set(r, new Set());
    dependents.get(r).add(isPkg(k) ? nameOf(k) : `(워크스페이스 ${k || 'root'})`);
  }
}
const viaOf = (key) => [...(dependents.get(key) ?? [])].slice(0, 3).join(', ') || '—';

if (args.includes('--json')) {
  console.log(JSON.stringify({ installedRoot: INSTALLED_ROOT, rows }, null, 1));
  process.exit(0);
}

// ── 마크다운 ────────────────────────────────────────────────────────────────
const count = (xs, f) => xs.reduce((m, r) => { const k = f(r); m[k] = (m[k] || 0) + 1; return m; }, {});
const table = (obj, h1, h2) => [`| ${h1} | ${h2} |`, '|---|---:|', ...Object.entries(obj).sort((a, b) => b[1] - a[1]).map(([k, v]) => `| ${k} | ${v} |`)].join('\n');
const esc = (s) => String(s ?? '').replace(/\|/g, '\\|');

const shipped = rows.filter((r) => r.groups.length);
const special = rows.filter((r) => !['PERMISSIVE', 'PERMISSIVE_CHOICE'].includes(r.cls) || r.licenseSource !== 'lockfile');
const lines = [];
lines.push('# 서드파티 고지 (Third-Party Notices)');
lines.push('');
lines.push('> 🔴 **자동 생성 파일 — 손으로 고치지 않는다.** 재생성: `node scripts/third-party-notices.mjs`');
lines.push(`> 정본: \`package-lock.json\`(lockfileVersion 3 · 항목 ${rows.length}) · 생성 시점의 설치 루트: ${INSTALLED_ROOT ? (INSTALLED_ROOT === ROOT ? '이 체크아웃의 `node_modules`' : '상위 체크아웃의 `node_modules`(워크트리에서 생성)') + ' — 설치 여부 열의 근거 · ⚠ 기계·플랫폼마다 달라진다' : '없음(설치 여부 미확인)'}`);
lines.push('>');
lines.push('> ⚠ **이 문서가 보증하지 않는 것**: ① 번들러가 산출물에 실제로 포함했는지(런타임 의존 **선언** 기준 상한이다)');
lines.push('> ② 각 패키지 라이선스 **원문**(표기만 모았다 — 배포 시 원문 동봉 여부는 🧑 법무 판단) ③ 이 제품 자체의 라이선스·저작권(🧑 — `LICENSE` 없음).');
lines.push('');
lines.push('## 1. 요약');
lines.push('');
lines.push('| 구분 | 패키지 수 |');
lines.push('|---|---:|');
for (const a of ARTIFACTS) lines.push(`| ${a.label} 런타임 의존 | ${rows.filter((r) => r.groups.includes(a.id)).length} |`);
lines.push(`| 개발 전용(devDependencies 로만 도달) | ${rows.filter((r) => r.devOnly).length} |`);
lines.push(`| 어느 워크스페이스에서도 도달 안 됨(⚠ 해석 한계·다른 플랫폼 선택 바이너리 등) | ${rows.filter((r) => r.unreached).length} |`);
lines.push(`| lockfile 전체 | ${rows.length} |`);
if (INSTALLED_ROOT) lines.push(`| 그중 이 기계에 설치됨 | ${rows.filter((r) => r.installed).length} |`);
lines.push('');
lines.push('### 라이선스 분류 — 배포 산출물(3종 합집합) 기준');
lines.push('');
lines.push(table(count(shipped, (r) => CLASS_LABEL[r.cls]), '분류', '패키지'));
lines.push('');
lines.push('### 라이선스 표기 — 배포 산출물 기준');
lines.push('');
lines.push(table(count(shipped, (r) => r.license ?? '(표기 없음)'), '라이선스', '패키지'));
lines.push('');
lines.push('## 2. 🔴 따로 봐야 하는 라이선스(허용 라이선스 외 전부 + lockfile 에 표기가 없어 다른 출처로 채운 것)');
lines.push('');
lines.push('판단(고지 문구·원문 동봉·소스 공개 의무 해당 여부)은 🧑 법무 몫이다. 여기서는 **어디에 들어가는지**만 사실로 적는다.');
lines.push('');
lines.push('⚠ "들어가는 산출물"은 **런타임 의존 선언으로 도달하는가**다. 예: `node-forge` 는 `@expo/cli`(빌드 도구)가 끌어와 모바일 워크스페이스의 런타임 도달 집합에 들지만,');
lines.push('앱 바이너리에 번들되는지는 이 표가 판정하지 않는다. `@img/sharp-*` 는 `next` 가 끌어오는 **플랫폼별 선택 바이너리**라 한 설치에는 그 플랫폼 것 하나만 깔린다(운영 서버 linux-x64 기준 `@img/sharp-libvips-linux-x64` — ⚠ 운영 서버 설치본은 이 표에서 확인하지 않았다).');
lines.push('');
lines.push('| 분류 | 패키지 | 버전 | 라이선스 | 들어가는 산출물(선언 기준) | 끌어오는 패키지 | 설치됨 | 라이선스 출처 |');
lines.push('|---|---|---|---|---|---|---|---|');
const order = ['STRONG_COPYLEFT', 'UNKNOWN', 'CHOICE_GPL', 'LGPL', 'MPL', 'CUSTOM', 'OTHER', 'PERMISSIVE_CHOICE', 'PERMISSIVE'];
for (const r of special.sort((a, b) => order.indexOf(a.cls) - order.indexOf(b.cls) || a.name.localeCompare(b.name))) {
  const where = r.groups.length ? r.groups.map((g) => ARTIFACTS.find((a) => a.id === g).label).join(' · ') : r.devOnly ? '개발 전용' : '도달 안 됨';
  lines.push(`| ${BADGE[r.cls]} ${r.cls} | \`${esc(r.name)}\` | ${esc(r.version)} | ${esc(r.license ?? '—')} | ${where} | ${esc(viaOf(r.key))} | ${r.installed == null ? '?' : r.installed ? '예' : '아니오'} | ${r.licenseSource} |`);
}
lines.push('');
for (const a of ARTIFACTS) {
  const list = rows.filter((r) => r.groups.includes(a.id)).sort((x, y) => x.name.localeCompare(y.name) || x.version.localeCompare(y.version));
  lines.push(`## 3-${a.id}. ${a.label} — 런타임 의존 ${list.length}`);
  lines.push('');
  lines.push('| 패키지 | 버전 | 라이선스 |');
  lines.push('|---|---|---|');
  for (const r of list) lines.push(`| \`${esc(r.name)}\` | ${esc(r.version)} | ${esc(r.license ?? '— (표기 없음)')} |`);
  lines.push('');
}
lines.push('## 4. 개발 전용 — 라이선스 집계만');
lines.push('');
lines.push('배포 산출물에 선언상 포함되지 않는다(빌드 도구·테스트·타입). 목록은 `--json` 으로 뽑는다.');
lines.push('');
lines.push(table(count(rows.filter((r) => r.devOnly), (r) => r.license ?? '(표기 없음)'), '라이선스', '패키지'));
lines.push('');

const out = argOf('--out') ?? 'THIRD-PARTY-NOTICES.md';
writeFileSync(join(ROOT, out), lines.join('\n'));
console.log(`생성: ${out} · lockfile ${rows.length} · 배포 산출물 ${shipped.length} · 특이 ${special.length} · 설치 루트 ${INSTALLED_ROOT ? 'O' : '없음'}`);
