import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 오류 봉투는 4xx/5xx 로 나간다 — 2xx + `{ error }` 금지. 2026-09-21.
 *
 * 🔴 실측: sign→HIS 웹훅이 HMAC 불일치에
 *    `return { error: { code: 'INVALID_SIGNATURE' } }` 를 했고, NestJS 는 POST 기본값
 *    **201** 로 내보냈다. 보내는 쪽은 2xx 를 받아 `SENT` 로 처리했고, 시크릿이 어긋나도
 *    DEAD 로 드러나지 않아 재시도·경보가 한 번도 돌지 않았다.
 *
 * 🔴 화면도 같은 피해를 본다 — `apps/web/src/lib/api-client.ts` 는 `res.ok` 면 성공으로 읽고
 *    `parseError` 는 아예 호출되지 않는다. 그래서 환자 포털의 **동의 서명 쓰기**가
 *    "환자 계정이 아닙니다"를 201 로 돌려주면 화면은 서명이 된 것처럼 진행한다.
 *
 * 남은 자리는 아래 허용목록에 적는다(줄이는 것은 자유, 늘리는 것은 이 목록을 고쳐야 한다).
 */

const ROOT = join(__dirname, '../../src');
const ALLOWED = new Set<string>([
  // 동의 미획득은 "거부"가 아니라 화면이 동의 절차를 띄우는 분기다(AI 전송 동의·신분증 OCR 동의).
  // 🔴 다만 이 셋도 화면이 error 를 읽는지 확인된 바 없다 — 별도 축으로 남긴다.
  'modules/medical-ai/medical-ai.controller.ts',
]);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name.endsWith('.controller.ts')) out.push(p);
  }
  return out;
}

describe('오류 봉투를 2xx 로 내보내지 않는다', () => {
  const files = walk(ROOT);

  it('컨트롤러 수를 먼저 센다(스캐너가 0개를 돌고 통과하지 않게)', () => {
    expect(files.length).toBeGreaterThan(250);
  });

  it('🔴 `return { error:` 를 쓰는 컨트롤러는 허용목록 안에만 있다', () => {
    const offenders = files
      .filter((f) => /return\s*\{\s*error\s*:/.test(readFileSync(f, 'utf-8')))
      .map((f) => f.slice(ROOT.length + 1))
      .filter((rel) => !ALLOWED.has(rel));
    expect(offenders, `2xx 로 오류 봉투를 내보내는 자리: ${offenders.join(', ')}`).toEqual([]);
  });

  it('sign 웹훅은 서명 불일치를 401 로 말한다(회귀 방지)', () => {
    const src = readFileSync(join(ROOT, 'modules/sign-integration/sign-integration.controller.ts'), 'utf-8');
    expect(src).toContain("throw new UnauthorizedException({ error: 'INVALID_SIGNATURE'");
    expect(src).not.toContain("return { error: { code: 'INVALID_SIGNATURE'");
  });
});
