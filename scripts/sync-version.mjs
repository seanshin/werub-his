#!/usr/bin/env node
/**
 * 버전 정본 동기화 — 정본은 `packages/shared/src/constants.ts` 의 `HIS_VERSION` **하나**다.
 *
 * 🔴 왜(2026-09-13 실측): 앱이 말하는 버전(로그인 화면·`/health`)은 `v4.19.0` 인데 워크스페이스 `package.json`
 *    6개는 `1.0.0`·`1.5.0`·`0.1.0` 으로 **제각각**이었고 어느 것도 정본과 연결돼 있지 않았다.
 *    패키지로 배포하면 "이 설치본이 무슨 버전인가"에 답이 셋 이상이 된다(P12 — 같은 사실에 정본이 둘).
 *
 * 🔴 이 스크립트는 **번호를 올리지 않는다.** 올리는 것은 `HIS_VERSION` 을 고치는 사람 행위(릴리즈 결정)이고,
 *    여기서는 그 값을 따라가게만 한다. `v` 접두는 package.json(semver)에서 뗀다.
 *
 * 사용: `node scripts/sync-version.mjs --check`(기본 · 어긋나면 exit 1) · `--write`(동기화)
 */
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync, realpathSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** 동기화 대상 — 루트 + npm workspaces 전부(수기 목록이지만 아래 `workspaceManifests` 와 대조한다) */
export const MANIFESTS = [
  'package.json',
  'apps/api/package.json',
  'apps/web/package.json',
  'apps/homepage/package.json',
  'apps/mobile/package.json',
  'packages/shared/package.json',
];

export function canonicalVersion(root = ROOT) {
  const src = readFileSync(join(root, 'packages/shared/src/constants.ts'), 'utf8');
  const m = /export const HIS_VERSION = 'v(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)';/.exec(src);
  if (!m) throw new Error('HIS_VERSION 을 constants.ts 에서 찾지 못했다 — 정본 형식이 바뀌었으면 이 스크립트도 고친다');
  return m[1];
}

/** 루트 package.json 의 workspaces 글롭이 가리키는 실제 매니페스트 — 수기 목록이 빠뜨린 것을 잡는다 */
export function workspaceManifests(root = ROOT) {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const globs = Array.isArray(pkg.workspaces) ? pkg.workspaces : pkg.workspaces?.packages ?? [];
  const out = [];
  for (const g of globs) {
    // 'apps/*' · 'packages/*' 형태만 지원(이 저장소 실측) — 다른 형태가 오면 조용히 넘기지 않고 실패한다
    const m = /^([\w.-]+)\/\*$/.exec(g);
    if (!m) throw new Error(`지원하지 않는 workspaces 글롭: ${g}`);
    const base = join(root, m[1]);
    for (const name of readdirSync(base)) {
      if (!statSync(join(base, name)).isDirectory()) continue;
      if (existsSync(join(base, name, 'package.json'))) out.push(`${m[1]}/${name}/package.json`);
    }
  }
  return ['package.json', ...out.sort()];
}

/**
 * 🔴 `package-lock.json` 도 워크스페이스 버전을 들고 있다(최상위 `version` · `packages[""]` · `packages["apps/api"]` …).
 *    package.json 만 올리고 lock 을 두면 `npm ci`(배포가 이제 강제한다)가 "not in sync" 로 실패할 수 있다 —
 *    같은 사실의 사본이므로 함께 맞춘다. lock 을 재생성(`npm install`)하지 않고 **해당 필드만** 바꾼다(의존성 해석을 건드리지 않는다).
 */
export const LOCK_KEYS = ['', 'apps/api', 'apps/web', 'apps/homepage', 'apps/mobile', 'packages/shared'];

export function lockReport(root = ROOT) {
  const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'));
  const want = canonicalVersion(root);
  const rows = [{ file: 'package-lock.json#version', version: lock.version ?? null }];
  for (const k of LOCK_KEYS) rows.push({ file: `package-lock.json#packages["${k}"]`, version: lock.packages?.[k]?.version ?? null });
  return rows.map((r) => ({ ...r, ok: r.version === want }));
}

function writeLock(root, want) {
  const p = join(root, 'package-lock.json');
  let raw = readFileSync(p, 'utf8');
  // 최상위 version — 파일 머리 `"name": ..., "version": ...`
  raw = raw.replace(/^(\{\s*"name":\s*"[^"]*",\s*"version":\s*)"[^"]*"/, `$1"${want}"`);
  for (const k of LOCK_KEYS) {
    const head = new RegExp(`(\\n    ${JSON.stringify(k).replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}: \\{\\n(?:      [^\\n]*\\n){0,3}?      "version": )"[^"]*"`);
    if (!head.test(raw)) throw new Error(`package-lock.json packages["${k}"] 의 version 을 찾지 못했다`);
    raw = raw.replace(head, `$1"${want}"`);
  }
  writeFileSync(p, raw);
  // 재해석해 검증 — 치환이 JSON 을 깨뜨리지 않았고 전 필드가 맞는지
  const bad = lockReport(root).filter((r) => !r.ok);
  if (bad.length) throw new Error(`lock 동기화 후에도 어긋남: ${bad.map((b) => b.file).join(', ')}`);
}

export function versionReport(root = ROOT) {
  const want = canonicalVersion(root);
  return MANIFESTS.map((rel) => {
    const pkg = JSON.parse(readFileSync(join(root, rel), 'utf8'));
    return { file: rel, version: pkg.version ?? null, ok: pkg.version === want };
  });
}

// 🔴 경로를 realpath 로 비교한다 — macOS `/var` → `/private/var` 같은 심링크 경로에서 문자열 비교가 거짓이 되어
//    **CLI 본문이 아예 안 돌고 exit 0** 이 됐다(재주입 역검증이 잡음: 어긋난 버전인데 --check 가 통과).
if (process.argv[1] && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1])) {
  const write = process.argv.includes('--write');
  const want = canonicalVersion();
  const missing = workspaceManifests().filter((f) => !MANIFESTS.includes(f));
  if (missing.length) {
    console.error(`🔴 동기화 목록에 없는 워크스페이스: ${missing.join(', ')} — MANIFESTS 에 추가한다`);
    process.exit(1);
  }
  let bad = 0;
  for (const r of versionReport()) {
    if (r.ok) { console.log(`  ✓ ${r.file} ${r.version}`); continue; }
    bad++;
    if (write) {
      const p = join(ROOT, r.file);
      const raw = readFileSync(p, 'utf8');
      // 키 순서·들여쓰기를 보존하려고 문자열 치환한다(JSON.stringify 재직렬화는 diff 를 키운다)
      const next = raw.replace(/("version"\s*:\s*)"[^"]*"/, `$1"${want}"`);
      if (next === raw) { console.error(`🔴 ${r.file}: version 필드를 치환하지 못했다`); process.exit(1); }
      writeFileSync(p, next);
      console.log(`  ✎ ${r.file} ${r.version} → ${want}`);
    } else {
      console.log(`  ✗ ${r.file} ${r.version} ≠ 정본 ${want}`);
    }
  }
  const lockBad = lockReport().filter((r) => !r.ok);
  for (const r of lockBad) console.log(`  ${write ? '✎' : '✗'} ${r.file} ${r.version}${write ? ` → ${want}` : ` ≠ 정본 ${want}`}`);
  if (lockBad.length && write) writeLock(ROOT, want);
  bad += lockBad.length;
  if (bad && !write) {
    console.error(`🔴 ${bad}개 매니페스트가 정본(HIS_VERSION v${want})과 다르다 — node scripts/sync-version.mjs --write`);
    process.exit(1);
  }
  console.log(write && bad ? `동기화 ${bad}건 완료 (정본 v${want})` : `일치 (정본 v${want})`);
}
