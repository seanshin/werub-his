import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { VACCINATION_RECORDING_SUPPORTED } from '@hospital-run/shared';

/**
 * "환자 화면이 말하는 없음"이 사실인지 코드와 기계 대조한다.
 *
 * 🔴 2026-09-02 실측: `vaccinations` 운영 0행의 이유는 환자가 접종을 안 받아서가 아니라
 *    **쓰는 코드가 어디에도 없어서**였다. 읽는 곳 3(포털 건강탭·모바일 건강탭·FHIR Immunization),
 *    쓰는 곳 0(컨트롤러·서비스·시드 전부). 그런데 포털은 "예방접종 기록이 없습니다"라고 단정했다.
 *    환자는 그것을 자기 이력으로 읽는다 — 자료 부재와 진짜 0 은 다른 사실이다.
 *
 * 이 가드는 **상수와 코드가 갈라지지 않게** 한다. 쓰기 경로가 생기면 상수를 true 로 바꿔야 통과한다.
 */
const SRC = join(process.cwd(), 'src');

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const f = join(dir, e);
    if (statSync(f).isDirectory()) walk(f, out);
    else if (f.endsWith('.ts') && !f.endsWith('.spec.ts')) out.push(f);
  }
  return out;
}
const FILES = walk(SRC);
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/** `prisma.vaccination.create|update|upsert|delete...` — 실제 쓰기 호출만 센다(주석 제외) */
const WRITE = /\bvaccination\s*\.\s*(create|createMany|update|updateMany|upsert|delete|deleteMany)\b/;

describe('예방접종 — 화면이 말하는 "없음"이 사실인가', () => {
  const writers = FILES.filter((f) => WRITE.test(stripComments(readFileSync(f, 'utf8'))));
  const readers = FILES.filter((f) => /\bvaccination\s*\.\s*(findMany|findUnique|findFirst|count)\b/.test(stripComments(readFileSync(f, 'utf8'))));

  it('대조군: 읽는 곳은 실제로 있다 — 스캔이 헛돌지 않는지 먼저 본다', () => {
    expect(readers.length, 'Vaccination 을 읽는 코드를 하나도 못 찾았다면 이 가드는 무의미하다').toBeGreaterThan(0);
  });

  it('🔴 상수가 코드의 사실과 일치한다(쓰기 경로 유무)', () => {
    const hasWrite = writers.length > 0;
    expect(
      VACCINATION_RECORDING_SUPPORTED,
      hasWrite
        ? `쓰기 경로가 생겼다(${writers.length}곳) — VACCINATION_RECORDING_SUPPORTED 를 true 로 바꾸고 환자 화면 문구도 되돌려라`
        : '쓰기 경로가 없는데 상수가 true 다 — 화면이 "기록 없음"이라 단정하게 된다',
    ).toBe(hasWrite);
  });

  it('환자 화면이 그 상수를 실제로 쓴다 — import 만 있는 것은 통과가 아니다', () => {
    const tab = readFileSync(
      join(process.cwd(), '..', 'web', 'src', 'app', 'portal', '_health', 'HealthTab.tsx'), 'utf8',
    );
    const body = tab.replace(/^import[\s\S]*?from\s+['"][^'"]+['"];?$/gm, '');
    expect(body).toContain('VACCINATION_RECORDING_SUPPORTED');
    expect(body).toContain('VACCINATION_UNSUPPORTED_NOTE');
  });
});
