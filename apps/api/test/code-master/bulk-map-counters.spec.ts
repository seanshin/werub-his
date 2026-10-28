import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 🔴 일괄 매핑 집계가 상태를 뭉치고 있었다(2026-08-26).
 *    `else failed++` 하나라 **"이 코드에 이 표준은 해당 사항이 아님"** 과
 *    **"AI 가 죽어서 수행 못 함"** 이 같은 숫자에 들어갔다.
 *    → 결과가 실제보다 나쁘게 보이고, **무엇을 다시 돌려야 하는지** 알 수 없었다.
 */
const SVC = join(process.cwd(), 'src/modules/code-master/auto-mapper.service.ts');
const SCHEMA = join(process.cwd(), 'prisma/schema.prisma');
const src = readFileSync(SVC, 'utf8');
const schema = readFileSync(SCHEMA, 'utf8');

describe('일괄 매핑 집계는 상태를 뭉치지 않는다', () => {
  it('배치 모델에 상태별 칸이 있다', () => {
    for (const c of ['not_applicable_count', 'no_candidate_count', 'error_count']) {
      expect(schema, `${c} 컬럼이 없다`).toContain(c);
    }
  });

  it('🔴 NOT_APPLICABLE 을 실패로 세지 않는다', () => {
    const block = src.slice(src.indexOf('for (const r of results)'), src.indexOf('for (const r of results)') + 500);
    expect(block).toContain("r.status === 'NOT_APPLICABLE'");
    expect(block).toContain('notApplicable++');
  });

  it('🔴 ERROR(재시도 대상)를 따로 센다', () => {
    const block = src.slice(src.indexOf('for (const r of results)'), src.indexOf('for (const r of results)') + 500);
    expect(block).toContain("r.status === 'ERROR'");
    expect(block).toContain('errored++');
  });

  it('집계가 배치 레코드에 실제로 저장된다', () => {
    expect(src).toMatch(/notApplicableCount: notApplicable/);
    expect(src).toMatch(/errorCount: errored/);
  });

  it('대조군 — 확정·대기는 그대로 센다(고치면서 지우지 않았다)', () => {
    const block = src.slice(src.indexOf('for (const r of results)'), src.indexOf('for (const r of results)') + 500);
    expect(block).toContain('confirmed++');
    expect(block).toContain('pending++');
  });
});
