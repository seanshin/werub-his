/**
 * 🔴 (2026-09-14 G12 실측) 입력 예시(placeholder)가 시드 실값과 같았다 — 시드 환자 MRN `P2026-0001`(포털 로그인·예약·VOC·키오스크 4화면)과
 *    지어낸 전화번호 모양 `02-1234-56xx`(장비 등록). 예시가 실값이면 공개 화면에 시드 자격 한쪽이 박히고, 사람은 그 값을 "형식"으로 읽는다.
 * 지키는 것:
 *  ① 시드 환자 MRN 은 개발 전용 정본(`lib/test-patients.ts`) 밖 web 소스·포털 카탈로그에 없다(주석 제외)
 *  ② placeholder 속성에 `02-1234-` 모양 번호가 없다
 *  ③ 로컬 상태 배지 표(`const STATUS_BADGE`)를 두지 않고 shared 정본 배지를 쓴다 — 이번에 옮긴 두 화면(대조군: 옮긴 뒤 domain 사용 확인)
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const SRC = join(process.cwd(), 'src');
function walk(d: string, acc: string[] = []): string[] {
  for (const n of readdirSync(d)) {
    const p = join(d, n);
    if (statSync(p).isDirectory()) walk(p, acc);
    else if (/\.(tsx?|jsx?)$/.test(n)) acc.push(p);
  }
  return acc;
}
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
const files = walk(SRC);

describe('입력 예시가 시드 실값이 아니다', () => {
  it('① 시드 환자 MRN 이 개발 전용 정본 밖에 없다', () => {
    const seedMrns = [...readFileSync(join(SRC, 'lib/test-patients.ts'), 'utf8').matchAll(/mrn:\s*'([^']+)'/g)].map((m) => m[1]);
    expect(seedMrns.length).toBeGreaterThan(0);
    const hits = files
      .filter((f) => !f.endsWith('lib/test-patients.ts'))
      .flatMap((f) => { const s = strip(readFileSync(f, 'utf8')); return seedMrns.filter((m) => s.includes(m)).map((m) => `${relative(SRC, f)}: ${m}`); });
    expect(hits).toEqual([]);
  });

  it('② placeholder 에 02-1234- 모양 번호가 없다', () => {
    const hits = files.filter((f) => /placeholder=\{?["'`][^"'`]*02-1234-/.test(readFileSync(f, 'utf8'))).map((f) => relative(SRC, f));
    expect(hits).toEqual([]);
  });

  it.each([
    ['app/(main)/workstation/diagnostic/page.tsx', 'diagnosticTest'],
    ['app/staff/approvals/HrApprovalSection.tsx', 'hrRequest'],
  ])('③ %s — 로컬 STATUS_BADGE 없음·StatusBadge domain="%s"', (file, domain) => {
    const s = strip(readFileSync(join(SRC, file), 'utf8'));
    expect(s).not.toMatch(/const\s+STATUS_BADGE\b/);
    expect(s).toContain(`<StatusBadge domain="${domain}"`);
  });
});
