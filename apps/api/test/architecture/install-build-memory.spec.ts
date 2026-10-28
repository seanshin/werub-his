import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

/**
 * 🔴 빌드 메모리 판정(2026-09-14) — 리허설에서 빌드가 원인을 말하지 않고 죽었다(nest build 기본 힙 OOM · 웹 next build 137).
 *
 * 지키는 것:
 *  ① 가용 메모리 = min(cgroup 한도 − 사용, MemAvailable) · cgroup v1/v2 · "max"/거대한 v1 무제한은 한도 없음
 *  ② 🔴 잴 수 없으면 **빈 값**(0 이 아니다 — 0 은 "없다"는 사실이라 설치를 막는다)
 *  ③ 힙 = 가용의 75%, 상한 · 가용 모름이면 상한 그대로(막지 않는다)
 *  ④ install.sh 배선 — 설치자가 NODE_OPTIONS 를 정했으면 존중 · 모자라면 빌드 **전에** 숫자와 함께 멈춘다 · 우회는 명시 env
 */

const ROOT = join(__dirname, '../../../..');
const LIB = join(ROOT, 'infra/install/build-memory.sh');
const INSTALL = join(ROOT, 'infra/install/install.sh');

const sh = (script: string, env: Record<string, string> = {}) => {
  const r = spawnSync('bash', ['-c', `set -euo pipefail\n. '${LIB}'\n${script}`], {
    encoding: 'utf8', timeout: 20_000, env: { PATH: process.env.PATH ?? '', ...env },
  });
  expect(r.status, r.stderr).toBe(0);
  return r.stdout.trim();
};

describe('① ② 가용 메모리 측정', () => {
  let tmp: string;
  beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), 'his-mem-')); });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  const meminfo = (availKb: number) => {
    const p = join(tmp, 'meminfo');
    writeFileSync(p, `MemTotal:       16000000 kB\nMemFree:          100000 kB\nMemAvailable:   ${availKb} kB\n`);
    return p;
  };
  const cg2 = (max: string, current: number) => {
    const d = join(tmp, 'cg2'); mkdirSync(d, { recursive: true });
    writeFileSync(join(d, 'memory.max'), `${max}\n`); writeFileSync(join(d, 'memory.current'), `${current}\n`);
    return d;
  };
  const MB = 1048576;

  it('cgroup v2 한도가 MemAvailable 보다 작으면 한도 − 사용(컨테이너 안의 진실)', () => {
    const env = { HIS_MEM_CGROUP_DIR: cg2(String(8192 * MB), 1024 * MB), HIS_MEM_MEMINFO: meminfo(14_000_000) };
    expect(sh('his_mem_available_mb', env)).toBe('7168');
  });

  it('cgroup "max"(한도 없음)면 MemAvailable', () => {
    const env = { HIS_MEM_CGROUP_DIR: cg2('max', 5 * MB), HIS_MEM_MEMINFO: meminfo(10_240_000) };
    expect(sh('his_mem_available_mb', env)).toBe('10000');
  });

  it('cgroup v1 무제한(거대한 수)은 한도로 보지 않는다 · 실제 v1 한도는 쓴다', () => {
    const d = join(tmp, 'cg1/memory'); mkdirSync(d, { recursive: true });
    writeFileSync(join(d, 'memory.limit_in_bytes'), '9223372036854771712\n');
    writeFileSync(join(d, 'memory.usage_in_bytes'), `${MB}\n`);
    const base = { HIS_MEM_CGROUP_DIR: join(tmp, 'cg1'), HIS_MEM_MEMINFO: meminfo(4_096_000) };
    expect(sh('his_mem_available_mb', base)).toBe('4000');
    writeFileSync(join(d, 'memory.limit_in_bytes'), `${3072 * MB}\n`);
    expect(sh('his_mem_available_mb', base)).toBe('3071');
  });

  it('🔴 잴 수 없으면 빈 값 — 0 을 지어내지 않는다', () => {
    const env = { HIS_MEM_CGROUP_DIR: join(tmp, 'none'), HIS_MEM_MEMINFO: join(tmp, 'none-meminfo') };
    expect(sh('echo "[$(his_mem_available_mb)]"', env)).toBe('[]');
  });
});

describe('③ 힙 크기', () => {
  it('가용의 75% · 상한을 넘지 않는다 · 가용 모름이면 상한', () => {
    expect(sh('his_build_heap_mb 4000 0 6144')).toBe('3000');
    expect(sh('his_build_heap_mb 16000 0 6144')).toBe('6144');
    expect(sh('his_build_heap_mb "" 0 6144')).toBe('6144');
  });
});

describe('④ install.sh 배선', () => {
  const code = readFileSync(INSTALL, 'utf8').split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');

  it('판정 라이브러리를 읽고, 모자라면 nest build 전에 숫자와 함께 멈춘다 · 우회는 명시 env', () => {
    expect(code).toMatch(/\. "\$HERE\/build-memory\.sh"/);
    const check = code.indexOf('his_mem_available_mb');
    const nest = code.indexOf('npx nest build');
    expect(check, '가용 메모리를 재지 않는다').toBeGreaterThan(0);
    expect(check, '판정은 빌드 전').toBeLessThan(nest);
    expect(code, '모자라면 숫자를 말하고 멈춘다').toMatch(/HIS_API_BUILD_MIN_MB[\s\S]*fail "[^"]*가용 메모리/);
    expect(code, '우회는 명시 env 로만').toMatch(/HIS_SKIP_MEMORY_CHECK/);
  });

  it('설치자가 정한 NODE_OPTIONS 는 덮지 않는다 — 없을 때만 가용 기반 힙', () => {
    expect(code).toMatch(/if \[ -z "\$\{NODE_OPTIONS:-\}" \]/);
    expect(code).toMatch(/--max-old-space-size=\$\{?HEAP_MB\}?/);
  });
});

describe('⑤ install.sh 실행 — 모자라면 빌드 전에 멈추고, 넉넉하거나 알고 진행하면 1단계로 간다', () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'his-mem-run-'));
    mkdirSync(join(tmp, 'infra/install'), { recursive: true });
    mkdirSync(join(tmp, 'node_modules'), { recursive: true });
    mkdirSync(join(tmp, 'apps/api'), { recursive: true });
    mkdirSync(join(tmp, 'bin'), { recursive: true });
    for (const f of ['install.sh', 'masters.manifest.tsv', 'build-info.sh', 'build-memory.sh']) {
      writeFileSync(join(tmp, 'infra/install', f), readFileSync(join(ROOT, 'infra/install', f)));
    }
    writeFileSync(join(tmp, '.nvmrc'), `${process.versions.node.split('.')[0]}\n`);
    // 가짜 psql — 1단계에서 테이블 565 로 멈추게(그 뒤로 가지 않는다)
    writeFileSync(join(tmp, 'bin/psql'), '#!/usr/bin/env bash\necho 565\n', { mode: 0o755 });
  });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  const run = (availKb: number | null, extra: Record<string, string> = {}) => {
    const mi = join(tmp, 'meminfo');
    if (availKb !== null) writeFileSync(mi, `MemAvailable:   ${availKb} kB\n`);
    const r = spawnSync('bash', [join(tmp, 'infra/install/install.sh')], {
      cwd: tmp, encoding: 'utf8', timeout: 30_000,
      env: {
        PATH: `${join(tmp, 'bin')}:${process.env.PATH ?? ''}`, HOME: tmp,
        HIS_MEM_CGROUP_DIR: join(tmp, 'no-cgroup'), HIS_MEM_MEMINFO: availKb === null ? join(tmp, 'no-meminfo') : mi,
        HIS_MODE: 'REAL', DATABASE_URL: 'postgresql://u:p@127.0.0.1:5432/his', REDIS_URL: 'redis://127.0.0.1:6379',
        AUTH_SECRET: 'a'.repeat(40), AUTH_REFRESH_SECRET: 'b'.repeat(40), ENCRYPTION_KEY: 'c'.repeat(64),
        ...extra,
      },
    });
    return { code: r.status, out: `${r.stdout}${r.stderr}` };
  };

  it('🔴 가용 2GB → 0단계에서 숫자와 함께 멈춘다(1단계에 닿지 않는다)', () => {
    const r = run(2_048_000);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/가용 메모리 2000MB 가 API 빌드 최소 4096MB 보다 작습니다/);
    expect(r.out).not.toMatch(/1\/7 빈 DB 확인/);
  });

  it('대조군 — 가용 12GB 면 판정을 지나 1단계로 간다 · 힙은 가용 기반(상한 6144)', () => {
    const r = run(12_288_000);
    expect(r.out).toMatch(/1\/7 빈 DB 확인/);
    expect(r.out).toMatch(/NODE_OPTIONS=--max-old-space-size=6144/);
    expect(r.out).not.toMatch(/웹 next build 는 가용/);
  });

  it('알고 진행(HIS_SKIP_MEMORY_CHECK=1)은 경고를 남기고 간다 · 5GB 는 웹 경고만', () => {
    const skip = run(2_048_000, { HIS_SKIP_MEMORY_CHECK: '1' });
    expect(skip.out).toMatch(/HIS_SKIP_MEMORY_CHECK=1 로 알고 진행한다/);
    expect(skip.out).toMatch(/1\/7 빈 DB 확인/);
    const five = run(5_120_000);
    expect(five.out).toMatch(/1\/7 빈 DB 확인/);
    expect(five.out).toMatch(/웹 next build 는 가용 6144MB 이상/);
    expect(five.out).toMatch(/--max-old-space-size=3750/);
  });

  it('잴 수 없으면 막지 않고 알린다 — 힙 상한 그대로', () => {
    const r = run(null);
    expect(r.out).toMatch(/가용 메모리: 잴 수 없음/);
    expect(r.out).toMatch(/1\/7 빈 DB 확인/);
    expect(r.out).toMatch(/--max-old-space-size=6144/);
  });

  it('설치자가 NODE_OPTIONS 를 정했으면 덮지 않는다', () => {
    const r = run(12_288_000, { NODE_OPTIONS: '--max-old-space-size=5000' });
    expect(r.out).toMatch(/NODE_OPTIONS=--max-old-space-size=5000/);
  });
});
