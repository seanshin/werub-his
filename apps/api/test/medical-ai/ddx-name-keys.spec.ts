import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * 감별진단 이름 키 유연성 가드 (2026-08-25 · 운영 실측 봉합)
 *
 * 🔴 운영 계측: `RealtimeDdx` 폐기 10/16 중 **9건이 `EMPTY_RESULT`** 였고,
 *    서버 로그는 `extracted=true keys=__array diffs=n/a` — **추출은 성공했는데 항목이 0**이었다.
 *    원인: 모델이 진단명을 `name` 이 아닌 다른 키(`diagnosis`·`condition` 등)로 낸다.
 *    `String(d.name ?? '')` 는 그때 빈 문자열이 되어 이름 표시도, 검사 어휘 판정도 못 한다.
 *
 * 🔴 모델의 출력 어휘를 우리가 강제할 수 없다 — **읽는 쪽이 유연해야 한다.**
 *    단 지어내지 않는다: 후보가 전부 비면 빈 이름 그대로 두고, 검증층이 그것을 잡는다.
 */
const SRC = fs.readFileSync(
  path.join(__dirname, '..', '..', 'src', 'modules', 'medical-ai', 'medical-ai.service.ts'),
  'utf8',
);

describe('감별진단 이름 키 — 모델이 다른 키를 써도 항목이 사라지지 않는다', () => {
  it('🔴 이름 후보를 넓게 읽는다(name 하나만 보면 EMPTY_RESULT 가 재발한다)', () => {
    const block = SRC.match(/const nameOf = [\s\S]{0,400}?;/)?.[0] ?? '';
    expect(block, 'nameOf 헬퍼가 없다').toBeTruthy();
    for (const key of ['name', 'diagnosis', 'condition', 'disease', "'진단명'"]) {
      expect(block, `이름 후보 누락: ${key}`).toContain(key);
    }
  });

  it('🔴 이름을 지어내지 않는다 — 후보가 전부 비면 빈 문자열로 둔다(검증층이 잡게)', () => {
    const block = SRC.match(/const nameOf = [\s\S]{0,400}?;/)?.[0] ?? '';
    // 폴백 문구를 만들어 채우면 안 된다(예: '진단명 미상' 같은 것)
    expect(block).toMatch(/\?\?\s*''\)/);
    // 🔴 타입 이름(Record<string, unknown>)이 아니라 **문자열 리터럴**에 폴백 문구가 있는지 본다
    //    — 첫 판은 /unknown/i 로 잡아 `Record<string, unknown>` 을 오탐했다(내 가드가 내 타입을 잡았다)
    const literals = [...block.matchAll(/'([^']*)'/g)].map((m) => m[1]);
    for (const lit of literals) {
      expect(lit, `이름 폴백 문구를 만들면 안 된다: ${lit}`).not.toMatch(/미상|알 수 없|unknown/i);
    }
  });

  it('검사 어휘 판정이 정규화된 이름을 쓴다(원본 d.name 만 보면 다시 놓친다)', () => {
    expect(SRC).toMatch(/const named[\s\S]{0,120}nameOf\(d\)/);
    expect(SRC).toMatch(/tests = named\.filter/);
  });

  it('대조군 — 빈 결과는 여전히 EMPTY_RESULT 로 정직하게 나간다(억지로 채우지 않는다)', () => {
    expect(SRC).toMatch(/checkNonEmpty\('differentials'/);
  });

  it('진단 로그가 __array 길이를 남긴다 — 다음에 같은 증상이 나면 원인을 바로 가른다', () => {
    expect(SRC).toMatch(/arr:\$\{/);
  });
});
