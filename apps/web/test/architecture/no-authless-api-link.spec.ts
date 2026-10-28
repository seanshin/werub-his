import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { stripComments } from '../../../../scripts/i18n-unwired-scan.mjs';

/**
 * 🔴 **`<a href="/api/v1/…">` 는 인증이 붙지 않는다** (2026-09-12 실측).
 *
 * 직원 축 JWT 는 `ExtractJwt.fromAuthHeaderAsBearerToken()` — **Authorization 헤더로만** 뽑는다
 * (`apps/api/src/modules/auth/strategies/jwt.strategy.ts`). 브라우저가 그냥 여는 `<a href>` 는 그 헤더를 싣지 않으므로
 * JWT 가드가 걸린 EP 를 이렇게 부르면 **개통 이래 401** 이다 — 그런데 화면은 버튼을 계속 보여준다.
 * 검진 결과서 '인쇄 미리보기'·'PDF 다운로드' 두 버튼이 그 상태였다(그 위에 PDF 는 한글 글꼴이 없어 501 이기도 했다).
 *
 * 고치는 방법은 `apiClient.getToken()` 을 실어 `fetch` 하고 blob 으로 여는 것이다(ai-oversight CSV 내보내기 선례).
 * 🔴 이 가드는 **0 을 동결한다** — 늘면 실패. 정당한 예외(무인증 공개 EP)가 생기면 사유와 함께 ALLOW 에 적는다.
 */
const SRC = path.join(__dirname, '../../src');
/** `<a … href="…/api/v1/…">` — 따옴표·중괄호·템플릿 리터럴 세 표기 */
const AUTHLESS_LINK = /<a\b[^>]*href=(?:"[^"]*\/api\/v1\/|'[^']*\/api\/v1\/|\{`[^`]*\/api\/v1\/)/g;

/** 무인증 공개 EP 라서 정당한 자리 — 사유와 함께 적는다(지금은 없다) */
const ALLOW: Record<string, string> = {};

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
}

function hits(): { file: string; n: number }[] {
  const out: { file: string; n: number }[] = [];
  for (const f of walk(SRC)) {
    const code = stripComments(fs.readFileSync(f, 'utf8')) as string;
    const n = (code.match(AUTHLESS_LINK) ?? []).length;
    const rel = path.relative(SRC, f).split(path.sep).join('/');
    if (n && !ALLOW[rel]) out.push({ file: rel, n });
  }
  return out;
}

describe('🔴 인증이 붙지 않는 API 링크', () => {
  it('대조군 — 소스를 실제로 훑었다(0 이면 이 가드는 아무것도 보증하지 않는다)', () => {
    expect(walk(SRC).length).toBeGreaterThan(500);
  });

  it('대조군 — 패턴이 실제 형태를 잡는다(검사기가 무력하지 않다)', () => {
    const sample = `<a href={\`/api/v1/checkup/visits/\${id}/result-pdf?format=pdf\`}>PDF</a>`;
    expect((stripComments(sample) as string).match(AUTHLESS_LINK)?.length).toBe(1);
    // 다른 경로·외부 링크는 대상이 아니다
    expect(`<a href="/patients/1">환자</a>`.match(AUTHLESS_LINK)).toBeNull();
    expect(`<a href="https://example.com/api/v1/x">외부</a>`.match(AUTHLESS_LINK)?.length).toBe(1); // 외부라도 우리 EP 모양이면 본다
  });

  it('🔴 `<a href>` 로 /api/v1 을 부르는 자리가 없다 — JWT 는 헤더로만 실린다', () => {
    expect(hits(), 'apiClient.getToken() 을 실어 fetch → blob 으로 열어라(ai-oversight CSV 선례)').toEqual([]);
  });
});
