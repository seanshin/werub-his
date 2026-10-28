#!/usr/bin/env node
/**
 * 릴리즈 태그 매핑 — `docs/04-report/RELEASE-v*.md` 각 릴리즈를 **실측으로** 커밋에 대응시킨다.
 *
 * 🔴 왜 필요한가(2026-09-13 실측): git 태그가 `v3.46.0` 에서 멈춰 v4.0.0~v4.19.0(릴리즈 문서 21개)에
 *    대응하는 커밋 고정점이 **0개**였다. `release(vX)` 커밋 메시지도 2개뿐이라 메시지로는 못 찾는다.
 *
 * 판정 규칙(지어내지 않는다):
 *   ① 릴리즈 문서가 **처음 추가된** 커밋 D
 *   ② `HIS_VERSION = 'vX'` 가 **처음 들어간** 커밋 V
 *   → 릴리즈 = "문서도 있고 표시 버전도 그 값인 첫 커밋" = D·V 중 **뒤에 오는 것**(하나가 다른 하나의 조상이어야 한다).
 *   · 둘 중 하나라도 못 찾거나, 조상 관계가 없으면(병합 갈래) → **미특정**. 기본으로 태그를 붙이지 않는다.
 *   · 🔴 실측: v4.0.0~v4.7.1 동안 표시 버전이 `v3.98.0` 에 **멈춰 있었고**(버전 가드 도입 전) v4.12.0 은 버전을 건너뛰었다
 *     (4.11 → 4.13). 그 릴리즈들은 ②가 **원천적으로 없다.** 문서 추가 커밋은 사실이지만 "그 커밋의 코드가 릴리즈"라는
 *     보장은 없다 → `문서기준` 으로 따로 표시하고 `--include-doc-only` 를 명시할 때만 태그한다(태그 메시지에 약한 근거임을 적는다).
 *   · 이미 같은 이름의 태그가 있으면 건드리지 않는다(다른 커밋이면 충돌로 보고).
 *
 * 사용: `node scripts/tag-releases.mjs --dry-run`(기본) · `--apply`(로컬 태그 생성 — push 는 사람이 한다)
 *       `--include-doc-only`(문서기준 릴리즈도 태그 — 약한 근거임을 태그 메시지에 남긴다)
 *       `--from 4`(주 버전 필터 · 기본 4) · `--json`
 */
import { execFileSync } from 'node:child_process';
import { readdirSync, realpathSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const REPORT = join(ROOT, 'docs/04-report');
const CONSTANTS = 'packages/shared/src/constants.ts';

const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
const gitOk = (...args) => { try { execFileSync('git', args, { cwd: ROOT, stdio: 'ignore' }); return true; } catch { return false; } };

/** 가장 이른 커밋(목록의 마지막 줄) — 없으면 null */
const earliest = (out) => { const lines = out.split('\n').filter(Boolean); return lines.length ? lines[lines.length - 1] : null; };

export function semverKey(v) { return v.replace(/^v/, '').split('.').map((n) => n.padStart(4, '0')).join('.'); }

export function releaseVersions(major = 4) {
  return readdirSync(REPORT)
    .map((f) => /^RELEASE-(v\d+\.\d+\.\d+)\.md$/.exec(f)?.[1])
    .filter((v) => v && Number(v.slice(1).split('.')[0]) === major)
    .sort((a, b) => semverKey(a).localeCompare(semverKey(b)));
}

export function mapRelease(version) {
  const doc = earliest(git('log', '--diff-filter=A', '--format=%H', '--', `docs/04-report/RELEASE-${version}.md`));
  const ver = earliest(git('log', `-S`, `HIS_VERSION = '${version}'`, '--format=%H', '--', CONSTANTS));
  let commit = null; let reason = '';
  if (!doc && !ver) reason = '문서·버전 커밋 둘 다 못 찾음';
  else if (!doc) reason = '릴리즈 문서 추가 커밋을 못 찾음';
  else if (!ver) reason = `HIS_VERSION='${version}' 커밋을 못 찾음`;
  else if (doc === ver) commit = doc;
  else if (gitOk('merge-base', '--is-ancestor', doc, ver)) commit = ver;
  else if (gitOk('merge-base', '--is-ancestor', ver, doc)) commit = doc;
  else reason = '문서 커밋과 버전 커밋 사이에 조상 관계가 없음(병합 갈래)';
  const existing = gitOk('rev-parse', '-q', '--verify', `refs/tags/${version}`) ? git('rev-list', '-n', '1', version) : null;
  return { version, doc, ver, commit, reason, existing };
}

if (process.argv[1] && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1])) {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const includeDocOnly = args.includes('--include-doc-only');
  const fromIdx = args.indexOf('--from');
  const major = fromIdx >= 0 ? Number(args[fromIdx + 1]) : 4;
  const rows = releaseVersions(major).map(mapRelease);
  if (args.includes('--json')) { console.log(JSON.stringify(rows, null, 1)); process.exit(0); }
  let made = 0; let conflict = 0;
  console.log(`${apply ? '적용' : '예행(dry-run)'} — v${major}.* 릴리즈 ${rows.length}건`);
  console.log('버전      | 판정     | 커밋      | 근거(문서 추가 · 버전 설정)');
  for (const r of rows) {
    const short = (h) => (h ? h.slice(0, 8) : '-'.padEnd(8));
    let state;
    if (r.existing) state = r.commit && r.existing === r.commit ? '이미 태그' : `🔴 충돌(기존 ${short(r.existing)})`;
    else if (r.commit) state = '특정';
    else if (r.doc && !r.ver) state = '문서기준';
    else state = '미특정';
    if (state.startsWith('🔴')) conflict++;
    console.log(`${r.version.padEnd(9)} | ${state.padEnd(8)} | ${short(r.commit)} | ${short(r.doc)} · ${short(r.ver)}${r.reason ? ` — ${r.reason}` : ''}`);
    if (apply && state === '특정') {
      execFileSync('git', ['tag', '-a', r.version, r.commit, '-m', `release ${r.version} (사후 태그 · 문서 ${short(r.doc)} · 버전 ${short(r.ver)})`], { cwd: ROOT });
      made++;
    } else if (apply && includeDocOnly && state === '문서기준') {
      execFileSync('git', ['tag', '-a', r.version, r.doc, '-m', `release ${r.version} (사후 태그 · 약한 근거: 릴리즈 문서 추가 커밋 ${short(r.doc)} — 당시 표시 버전(HIS_VERSION)이 이 값이 아니었다)`], { cwd: ROOT });
      made++;
    }
  }
  if (apply) console.log(`로컬 태그 ${made}개 생성 — push 는 사람이: git push origin --tags`);
  if (conflict) process.exit(2);
}
