import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = join(process.cwd(), 'src');
const read = (p: string) => readFileSync(join(SRC, p), 'utf-8');
const strip = (c: string) => c.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/**
 * 청구 라인 정합 — 2026-09-03 실측(정합성 32번 판정).
 *
 * 🔴 두 부류의 실결함이 있었다:
 *   (a) telehealth.service 가 `billing.create` 에 items 없이 **라인 0개 청구**를 만들고 그대로 수납됐다.
 *   (b) billing.service 의 진찰료 라인이 `if (consultProc)` 만 있어, 수가 마스터에 코드가 없으면
 *       **경고 없이 통째로 빠졌다**(AA157 부재·AA257 0원 → 진찰료 0원 청구 7건이 물밑에 있었다).
 */
describe('청구 라인 — 라인 없는 청구·조용한 진찰료 누락을 막는다', () => {
  it('🔴 진찰료 코드가 마스터에 없으면 조용히 넘기지 않는다', () => {
    const s = strip(read('modules/billing/billing.service.ts'));
    // if(consultProc) 에 else 가 붙어 누락을 소리낸다
    expect(s, '진찰료 코드 미등재를 로그·방송으로 남겨야 한다').toMatch(/consult_code_missing/);
    expect(s, '단가 0원도 흔적을 남긴다').toMatch(/진찰료 단가 0원/);
  });

  it('🔴 telehealth 청구가 라인을 붙인다(라인 0개 청구를 만들지 않는다)', () => {
    const s = strip(read('modules/telehealth/telehealth.service.ts'));
    // 🔴 들여쓰기 칸수를 고정하지 않는다 — G3 이 이 쓰기를 트랜잭션으로 묶자 6칸이 8칸이 되며
    //    블록을 못 찾았다(자기 점검 문구가 잡았다). 닫는 줄은 `});` 하나면 족하다.
    const block = /billing\.create\(\{[\s\S]{0,900}?\n\s+\}\);/.exec(s)?.[0] ?? '';
    expect(block, 'telehealth billing.create 를 찾지 못했습니다 — 검사가 헛돕니다').not.toBe('');
    expect(block, 'items 를 붙여야 EDI/ERP 로 나갈 수 있다').toMatch(/items:\s*\{\s*create:/);
    // 마스터에 코드가 없으면 소리낸다
    expect(s, '코드 미등재를 방송으로 남긴다').toMatch(/consult_code_missing/);
  });

  it('🔴 스캔이 0원 진찰료를 센다(라인 있어 32번엔 안 걸리는 물밑 결손)', () => {
    const sql = readFileSync(join(process.cwd(), '..', '..', 'infra/scripts/data-integrity-scan.sql'), 'utf-8');
    expect(sql, '0원 진찰료 불변식이 없으면 마스터 결손이 안 보인다').toContain('32b 진찰료 라인이 0원');
  });

  it('billing.consult_code_missing 이 방송 등록부에 사유와 함께 있다(대조군 — 죽은 방송 금지)', () => {
    const reg = read('sentinel/pipe-registry.ts');
    expect(reg).toContain("'billing.consult_code_missing':");
    const m = /'billing\.consult_code_missing':\s*'([^']+)'/.exec(reg);
    expect(m?.[1]?.length ?? 0, '어디에 남는지가 비어 있다').toBeGreaterThan(15);
  });
});
