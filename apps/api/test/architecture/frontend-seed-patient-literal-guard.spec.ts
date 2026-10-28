import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * 🔴 **시드 환자 본인확인 자격(MRN+생년월일)이 모드 게이트 밖 화면 소스에 남아 있었다** (2026-09-15 실측).
 *
 * web 은 2026-08-25 에 시드 환자 목록을 `lib/test-patients.ts` 하나로 모으고 운영 빌드에서 stub 으로 치환했다.
 * 그런데 **공개 사이트 격리 앱 `apps/homepage` 의 예약 화면**은 그 길을 안 지나갔다 — "테스트 계정" 4명
 * (MRN+생년월일)을 조건 없이 그렸다(이 앱에는 개발/리허설 빌드 상한이 없다). MRN+생년월일은 비밀번호가 아니어도
 * 이 시스템의 환자 본인확인 자격 그 자체다.
 * 같은 이유로 입력 placeholder 가 시드 MRN(`P2026-0001`·`P2026-0045`)을 예시로 보였다(모바일·포털 보호자 신청).
 * 시드 MRN 은 순번이라 형식만 맞는 "예시"도 실재 환자를 가리킨다 → 예시 번호 대신 "진료카드에 적힌 번호".
 *
 * 바늘은 수기 목록이 아니라 정본 `apps/web/src/lib/test-patients.ts` 에서 파생한다.
 */
const ROOT = join(__dirname, '../../../..');
const CANON = 'apps/web/src/lib/test-patients.ts';
const SCAN_ROOTS = ['apps/web/src', 'apps/homepage/src', 'apps/mobile/app', 'apps/mobile/src', 'apps/mobile/components'];

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.next' || name === 'dist') continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(tsx?|jsx?)$/.test(name)) out.push(p);
  }
  return out;
}

const canonSrc = readFileSync(join(ROOT, CANON), 'utf8');
const dobs = [...canonSrc.matchAll(/dob:\s*'(\d{4}-\d{2}-\d{2})'/g)].map((m) => m[1]);
const files = SCAN_ROOTS.flatMap((r) => walk(join(ROOT, r))).filter((f) => relative(ROOT, f) !== CANON);

describe('🔴 시드 환자 본인확인 자격은 모드 게이트 정본 밖에 없다', () => {
  it('정본에서 생년월일 바늘을 만든다(하한 — 바늘·대상 0 이면 가드가 헛돈다)', () => {
    expect(dobs.length).toBeGreaterThanOrEqual(4);
    expect(files.some((f) => f.endsWith('apps/homepage/src/app/booking/page.tsx'))).toBe(true);
    expect(files.some((f) => f.includes('apps/mobile/app'))).toBe(true);
  });

  it('시드 환자 생년월일 리터럴 0 (정본 파일 제외 · web·공개 사이트 앱·모바일)', () => {
    const hits: string[] = [];
    for (const f of files) {
      const s = readFileSync(f, 'utf8');
      for (const d of dobs) if (s.includes(d)) hits.push(`${relative(ROOT, f)} · ${d}`);
    }
    expect(hits).toEqual([]);
  });

  it('입력 placeholder 가 MRN 형식 번호(P2026-0001 등)를 예시로 보이지 않는다', () => {
    const hits: string[] = [];
    for (const f of files) {
      readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
        if (/placeholder/.test(line) && /P\d{4}-\d{3,}/.test(line)) hits.push(`${relative(ROOT, f)}:${i + 1}`);
      });
    }
    expect(hits).toEqual([]);
  });
});
