import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { AdministerControlledSubstanceDto } from '../../src/modules/controlled-substance/dto/waste.dto';

/**
 * 🔴 인라인 @Body('x') 는 ValidationPipe 를 건너뛴다(B축·2026-09-01) — 마약류 투약량·간호점수가
 *    음수·비수치로 원장에 저장되고(NIMS 음수 보고) 문자열이면 500 이던 것을 DTO/서비스 가드로 막는다.
 */
const ROOT = join(__dirname, '../..');
const read = (rel: string) => readFileSync(join(ROOT, 'src', rel), 'utf8');

describe('inline-body-validation-guard 오라클: AdministerControlledSubstanceDto', () => {
  const bad = async (v: unknown) =>
    (await validate(plainToInstance(AdministerControlledSubstanceDto, { administeredQty: v }))).length > 0;

  it('음수·0·문자열·객체는 검증 실패(400 경로)', async () => {
    expect(await bad(-5)).toBe(true);
    expect(await bad(0)).toBe(true);
    expect(await bad('abc')).toBe(true);
    expect(await bad({})).toBe(true);
  });
  it('양수·생략은 통과', async () => {
    expect(await bad(2.5)).toBe(false);
    expect((await validate(plainToInstance(AdministerControlledSubstanceDto, {}))).length).toBe(0);
  });
});

describe('inline-body-validation-guard: 구조 — 인라인 @Body 제거·가드 존재', () => {
  it('administer 는 DTO 로 받는다(인라인 @Body 아님)', () => {
    const src = read('modules/controlled-substance/controlled-substance.controller.ts')
      .replace(/\/\/.*$/gm, ''); // 주석 제거 — 주석 속 관용구 인용을 위반으로 세지 않는다
    expect(src).toContain('dto: AdministerControlledSubstanceDto');
    expect(/@Body\('administeredQty'\)/.test(src)).toBe(false);
  });
  it('서비스가 투약량 하한을 지킨다(방어 심층)', () => {
    const src = read('modules/controlled-substance/controlled-substance.service.ts');
    expect(src).toContain('administeredQty <= 0');
  });
  it('nursing evaluateOutcome 이 currentScore 수치를 지킨다', () => {
    const src = read('modules/nursing/nursing.service.ts');
    const at = src.indexOf('async evaluateOutcome');
    expect(src.slice(at, at + 400)).toContain('Number.isInteger(currentScore)');
  });
  it('hospice updateStatus 가 상태 allowed-set 를 지킨다(오타 침묵 저장 방지)', () => {
    const src = read('modules/hospice/hospice.service.ts');
    const at = src.indexOf('async updateStatus');
    const body = src.slice(at, at + 500);
    expect(body).toContain("'DISCHARGED', 'DECEASED'");
    expect(body).toContain('BadRequestException');
  });
});
