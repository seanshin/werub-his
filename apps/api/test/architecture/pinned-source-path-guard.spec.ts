/**
 * 🔴 가드가 **조용히 죽는** 것을 막는다 — 2026-08-27 신설.
 *
 * 실측 배경: 알레르기 배지 정본을 `(main)/patients/[id]/components/` 밖으로 옮겼더니,
 * 그 경로를 고정 참조하던 `test/patient-chart/allergy-status-honesty.spec.ts` 가
 * **수집 단계에서 죽어 11개 테스트가 통째로 안 돌았다.**
 *
 * 🔴 이 실패는 "가드 위반"으로 보이지 않는다 — `Tests N passed | 0 failed` 만 보면 놓친다.
 *    (실제로 통과 수가 9,952 → 9,944 로 줄어든 것을 세어보고서야 찾았다.)
 *    그래서 **경로가 실재하는지를 먼저, 싸게** 단언한다.
 *
 * 재주입: 아무 스펙에서 고정 참조 경로를 존재하지 않는 값으로 바꾸면 실패한다.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const TEST_ROOT = path.join(__dirname, '..');
const API_ROOT = path.join(__dirname, '..', '..');

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, e.name);
    if (e.isDirectory()) walk(f, out);
    else if (/\.spec\.ts$/.test(e.name)) out.push(f);
  }
  return out;
}

describe('가드가 가리키는 소스 경로는 실재한다', () => {
  it('🔴 스펙이 고정 참조하는 `../web/src/...` 경로가 전부 존재한다 (옮기면 가드가 조용히 죽는다)', () => {
    const specs = walk(TEST_ROOT);
    expect(specs.length, '스펙 수집 실패').toBeGreaterThan(500);

    const missing: string[] = [];
    const seen = new Set<string>();
    for (const s of specs) {
      const src = fs.readFileSync(s, 'utf8');
      for (const m of src.matchAll(/'(\.\.\/web\/src\/[^']+)'/g)) {
        const rel = m[1];
        const key = `${path.basename(s)}::${rel}`;
        if (seen.has(key)) continue;
        seen.add(key);
        // 스펙은 `process.cwd()`(= apps/api)를 기준으로 잡는다
        if (!fs.existsSync(path.join(API_ROOT, rel))) missing.push(key);
      }
    }
    // 표본이 0이면 이 가드는 아무것도 지키지 않는다 — 하한을 건다(2026-08-27 실측 10)
    expect(seen.size, '고정 참조를 하나도 못 찾았다 — 추출이 깨진 것이다').toBeGreaterThanOrEqual(10);
    expect(missing, `가드가 가리키는 소스가 없다(파일이 옮겨졌다):\n  ${missing.join('\n  ')}`).toEqual([]);
  });
});
