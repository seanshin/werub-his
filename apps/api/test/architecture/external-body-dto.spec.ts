import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * 구조 가드 — **외부에서 호출되는 컨트롤러는 인라인 @Body 타입을 쓸 수 없다.**
 *
 * 전역 ValidationPipe 는 런타임 metatype 이 클래스일 때만 동작한다. 인라인 타입
 * (`@Body() body: { a: string }`)은 metatype 이 Object 라 **검증이 통째로 스킵**되고,
 * 문자열 자리에 객체가 들어오면 Prisma where 절에서 필터 연산자로 해석돼 조건이 무력화된다.
 * (2026-07 전수검토: 기기 페어링 코드 우회·약품 마스터 일괄 덮어쓰기·판독 소견 오귀속)
 *
 * 신규 외부 수신 엔드포인트가 같은 실수를 반복하면 이 테스트가 실패한다.
 * 정본 판정·예외 근거: docs/03-analysis/input-validation-audit-2026-07.md
 */

const MODULES = path.join(__dirname, '..', '..', 'src', 'modules');

/**
 * 인라인 @Body 허용 예외 — 각 항목은 근거를 남긴다.
 * FHIR 수신부는 임의 FHIR 리소스를 그대로 받아야 하며(DTO 를 붙이면 whitelist 가 리소스 본문을 제거),
 * 서비스 계층에서 resourceType·구조를 검증한 뒤 STAGED 로 적재한다.
 */
const ALLOWED_INLINE = [
  'fhir-lab/fhir-lab.controller.ts',
  'twin/fhir-writeback.controller.ts',
  'fhir/fhir.controller.ts',
];

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.controller.ts')) out.push(p);
  }
  return out;
}

/** `@Body() x: {` 또는 `@Body() x: any/Record/...` 처럼 검증되지 않는 타입 */
function unvalidatedBodies(src: string): string[] {
  const hits: string[] = [];
  const re = /@Body\([^)]*\)\s*\w+\s*:\s*([^,)\n]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const t = m[1].trim();
    if (t.startsWith('{') || /^(any|unknown|object|Object)\b/.test(t)) hits.push(t.slice(0, 40));
  }
  return hits;
}

describe('외부 수신 컨트롤러 입력 검증 규약', () => {
  const files = walk(MODULES);

  it('컨트롤러를 실제로 수집한다(스캔 자체가 비지 않도록)', () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it('외부 노출 컨트롤러는 인라인/any @Body 를 쓰지 않는다', () => {
    const violations: string[] = [];

    for (const f of files) {
      const rel = path.relative(MODULES, f);
      if (ALLOWED_INLINE.some((a) => rel.endsWith(a))) continue;

      const src = fs.readFileSync(f, 'utf8');
      // 외부 = 직원 JWT 로 보호되지 않는 컨트롤러(무가드 웹훅·연동키·공개 토큰·SMART)
      if (/JwtAuthGuard/.test(src)) continue;

      for (const t of unvalidatedBodies(src)) violations.push(`${rel} → @Body ${t}`);
    }

    expect(violations).toEqual([]);
  });
});
