import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { SEED_CANON, seedNeedlesOf, scanArtifactForSeeds } from '../../../../scripts/release-gate.mjs';

/**
 * 🔴 G12 — REAL 산출물 시드 문자열 (2026-09-14).
 *
 * 종전 G12 는 수기 바늘 3개(`cho.ganho@hospital.example.org`·`1958-03-15`·`dealer1234`)였고 `--artifact` 를 준 적이 없어 한 번도 돌지 않았다.
 * 처음 실제 REAL 빌드에 돌리자 **CRM 대시보드가 시드 CRM 계정 4개를 조건 없이 그리고 있었다** — 수기 바늘에는 그 이메일이 없어
 * 종전 G12 였다면 PASS 였다. 그래서 바늘을 시드 로그인 정본(REAL 빌드가 stub 으로 치환하는 모듈)에서 파생한다.
 *
 * 재주입: 바늘을 수기 목록으로 되돌리거나 · 스캐너가 적중을 버리거나 · BUILD_ID 검사를 지우거나 · 캐시를 훑게 하면 실패한다.
 */
const ROOT = join(__dirname, '../../../..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const canon = () => seedNeedlesOf({ accounts: read(SEED_CANON.accounts), patients: read(SEED_CANON.patients), devEnv: read(SEED_CANON.devEnv) });

describe('G12 바늘 — 시드 로그인 정본에서 파생한다', () => {
  it('정본의 계정 이메일·생년월일·딜러 계정을 전부 바늘로 쓴다(수기 목록이 아니다)', () => {
    const { needles, errors } = canon();
    expect(errors).toEqual([]);
    const values = new Set(needles.map((n) => n.value));
    const emails = [...read(SEED_CANON.accounts).matchAll(/email:\s*'([^']+@[^']+)'/g)].map((m) => m[1]);
    const dobs = [...read(SEED_CANON.patients).matchAll(/dob:\s*'(\d{4}-\d{2}-\d{2})'/g)].map((m) => m[1]);
    expect(emails.length).toBeGreaterThan(10);
    expect(dobs.length).toBeGreaterThan(0);
    for (const v of [...emails, ...dobs]) expect(values.has(v), `${v} 가 바늘에 없다`).toBe(true);
    // 종전 수기 목록이 놓친 바로 그 값(CRM 대시보드 누수) — 파생이면 반드시 들어 있다
    expect(values.has('crm.manager@hospital.example.org')).toBe(true);
    expect(needles.some((n) => n.source === 'dealer-env')).toBe(true);
  });

  it('🔴 (2026-09-14) 직원 공용 비밀번호도 바늘이다 — 관리자 화면 기본값을 없애 제외 사유가 사라졌다', () => {
    const { needles, excluded } = canon();
    const pw = read(SEED_CANON.accounts).match(/TEST_PASSWORD\s*=\s*'([^']+)'/)![1];
    expect(needles.some((n) => n.value === pw && n.source === 'test-accounts-password')).toBe(true);
    expect(excluded.join(' ')).not.toMatch(/TEST_PASSWORD/);
  });

  it('🔴 TEST_PASSWORD 를 못 찾으면 조용히 빼지 않고 오류', () => {
    const r = seedNeedlesOf({ accounts: "email: 'a@b.example'", patients: "dob: '2000-01-01'", devEnv: 'NEXT_PUBLIC_DEALER_TEST_ACCOUNTS=[{"email":"d@x","password":"p"}]' });
    expect(r.errors.join(' ')).toMatch(/TEST_PASSWORD/);
  });

  it('🔴 정본을 못 읽으면 바늘 0 으로 통과하지 않고 오류를 낸다', () => {
    const r = seedNeedlesOf({ accounts: null, patients: '', devEnv: 'X=1' });
    expect(r.errors.length).toBeGreaterThanOrEqual(3);
  });
});

describe('G12 산출물 스캔', () => {
  let tmp: string;
  const { needles } = canon();
  const email = needles.find((n) => n.source === 'test-accounts')!.value;
  const mk = (rel: string, body: string) => {
    const p = join(tmp, rel);
    mkdirSync(join(p, '..'), { recursive: true });
    writeFileSync(p, body);
  };
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'g12-'));
    mk('.next/BUILD_ID', 'abc');
    mk('.next/static/chunks/app/page-1.js', 'export default function P(){return null}');
    mk('.next/server/app/page.js', 'module.exports={}');
  });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  it('대조군 — 깨끗한 운영 산출물은 적중 0 · 파일을 실제로 읽었다', () => {
    const r = scanArtifactForSeeds(join(tmp, '.next'), needles);
    expect(r.error).toBeNull();
    expect(r.hits).toEqual([]);
    expect(r.scanned).toBeGreaterThanOrEqual(2);
  });

  it('🔴 청크에 시드 계정 이메일이 있으면 적중한다', () => {
    mk('.next/static/chunks/app/crm/page-2.js', `["${email}"]`);
    const r = scanArtifactForSeeds(join(tmp, '.next'), needles);
    expect(r.hits.map((h) => h.file)).toEqual(['static/chunks/app/crm/page-2.js']);
  });

  it('🔴 BUILD_ID 없는 .next 는 개발 실행 산출물 — 판정하지 않고 오류', () => {
    rmSync(join(tmp, '.next/BUILD_ID'));
    const r = scanArtifactForSeeds(join(tmp, '.next'), needles);
    expect(r.error).toMatch(/BUILD_ID/);
  });

  it('빌드 캐시·소스맵은 세지 않되 제외 수를 남긴다', () => {
    mk('.next/cache/webpack/x.json', `"${email}"`);
    mk('.next/static/chunks/app/page-1.js.map', `"${email}"`);
    const r = scanArtifactForSeeds(join(tmp, '.next'), needles);
    expect(r.hits).toEqual([]);
    expect(r.skipped).toEqual({ cache: 1, sourcemap: 1 });
  });

  it('없는 경로는 오류(0 건으로 통과하지 않는다)', () => {
    expect(scanArtifactForSeeds(join(tmp, 'nope'), needles).error).toMatch(/없음/);
  });

  it('CLI — `--artifact` 로 G12 가 실제로 FAIL/PASS 를 낸다', () => {
    const run = () => {
      const r = spawnSync('node', [join(ROOT, 'scripts/release-gate.mjs'), '--quick', '--json', '--artifact', join(tmp, '.next')], { cwd: ROOT, encoding: 'utf8', timeout: 120_000 });
      const j = JSON.parse(r.stdout);
      return j.results.find((x: { id: string }) => x.id === 'G12-seedStrings');
    };
    expect(run().status).toBe('PASS');
    mk('.next/server/app/crm/page.js', `"${email}"`);
    const g = run();
    expect(g.status).toBe('FAIL');
    expect(g.detail).toContain(email);
  }, 180_000);
});
