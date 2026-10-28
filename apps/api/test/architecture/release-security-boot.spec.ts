import { describe, it, expect, vi, afterEach } from 'vitest';
import { validateEnv } from '../../src/common/env.validation';

/**
 * 🔴 부팅 경로 실행 검증 — `validateEnv()` 를 **실제로 불러** REAL 거부·REHEARSAL 통과를 확인한다(2026-09-13 · T4).
 * 구조 검사(`release-security-defaults.spec.ts` (e))는 호출이 "적혀 있는가"만 본다 — 여기는 "그렇게 동작하는가"를 본다.
 * `process.exit` 는 가로채서 종료 코드만 기록한다.
 */
const BASE = {
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  AUTH_SECRET: 'a'.repeat(40),
  AUTH_REFRESH_SECRET: 'b'.repeat(40),
  ENCRYPTION_KEY: 'c'.repeat(64),
  AI_EGRESS_ALLOWED_HOSTS: 'example.org',
};
const saved = { ...process.env };

function boot(env: Record<string, string>) {
  process.env = { ...env } as NodeJS.ProcessEnv;
  const exit = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => { throw new Error(`exit:${code}`); }) as never);
  const err = vi.spyOn(console, 'error').mockImplementation(() => {});
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  let exited: string | null = null;
  try { validateEnv(); } catch (e) { exited = (e as Error).message; }
  const errors = err.mock.calls.map((c) => String(c[0])).join('\n');
  const warns = warn.mock.calls.map((c) => String(c[0])).join('\n');
  exit.mockRestore(); err.mockRestore(); warn.mockRestore();
  return { exited, errors, warns };
}

afterEach(() => { process.env = { ...saved }; });

describe('🔴 부팅 경로 — REAL 보안 기본값', () => {
  it('REAL + 개발 비밀 폴백 → 부팅 거부(exit 1)', () => {
    const r = boot({ ...BASE, HIS_MODE: 'REAL' });
    expect(r.exited).toBe('exit:1');
    expect(r.errors).toMatch(/PDF_SERVICE_TOKEN/);
  });

  it('🔴 HIS_MODE 미설정 → REAL 로 보고 거부한다(모르면 가장 제한적)', () => {
    expect(boot({ ...BASE }).exited).toBe('exit:1');
  });

  it('대조군 — REHEARSAL(운영)은 같은 env 로 부팅하고 경고만 남긴다', () => {
    const r = boot({ ...BASE, HIS_MODE: 'REHEARSAL' });
    expect(r.exited).toBeNull();
    expect(r.warns).toMatch(/보안 기본값 · REHEARSAL/);
  });

  it('대조군 — REAL 이라도 판매본 필수 비밀이 있으면 부팅한다', () => {
    const r = boot({ ...BASE, HIS_MODE: 'REAL', PDF_SERVICE_TOKEN: 't'.repeat(40), PDF_RENDER_SECRET: 's'.repeat(40), DOC_DOWNLOAD_SECRET: 'd'.repeat(40), AI_PROVENANCE_SECRET: 'p'.repeat(40) });
    expect(r.exited).toBeNull();
  });
});
