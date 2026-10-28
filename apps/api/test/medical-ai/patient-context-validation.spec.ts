/**
 * 🔴 AI 약물추천의 환자 컨텍스트 — **검증이 실제로 돈다** (2026-08-20).
 *
 * 종전 `patientContext` 는 **인라인 객체 타입**이었다. 런타임 metatype 이 `Object` 라
 * ValidationPipe 가 통째로 스킵된다(이 저장소의 알려진 결함) — `eGFR` 이 음수든 문자열이든
 * 그대로 **용량 프롬프트**로 들어갔고, 모델의 용량 판단이 그 위에서 이뤄졌다.
 *
 * 재주입: `@ValidateNested()`/`@Type()` 을 지우면 아래 단언이 통과해버려 실패한다.
 */
import { describe, it, expect } from 'vitest';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AiRecommendDrugsDto } from '../../src/modules/medical-ai/dto/medical-ai.dto';

const base = { patientId: 'p1', diagnosis: '고혈압' };
const check = async (ctx: unknown) => {
  const dto = plainToInstance(AiRecommendDrugsDto, { ...base, patientContext: ctx });
  return validate(dto, { whitelist: true, forbidNonWhitelisted: false });
};

describe('patientContext — 중첩 검증이 실제로 실행된다', () => {
  it('정상 값은 통과', async () => {
    expect(await check({ age: 62, eGFR: 48.5, allergies: ['페니실린'] })).toHaveLength(0);
  });

  it('🔴 음수 eGFR 은 거부 — 용량 판단의 입력이다', async () => {
    const errs = await check({ eGFR: -10 });
    expect(errs.length, '중첩 검증이 돌지 않는다(인라인 타입이면 통째로 스킵된다)').toBeGreaterThan(0);
  });

  it('🔴 문자열 eGFR 은 거부', async () => {
    expect((await check({ eGFR: '48' as unknown as number })).length).toBeGreaterThan(0);
  });

  it('말이 되지 않는 나이는 거부', async () => {
    expect((await check({ age: 999 })).length).toBeGreaterThan(0);
    expect((await check({ age: -1 })).length).toBeGreaterThan(0);
  });

  it('알레르기·복용약은 문자열 배열만', async () => {
    expect((await check({ allergies: [1, 2] as unknown as string[] })).length).toBeGreaterThan(0);
  });

  it('🔴 임상값 범위를 좁게 강제하지 않는다 — 막으면 사람이 아무 값이나 넣어 통과시킨다', async () => {
    // 투석 환자의 매우 낮은 eGFR·고령은 **정상적으로 존재하는 값**이다
    expect(await check({ eGFR: 4, age: 101 })).toHaveLength(0);
  });

  it('컨텍스트가 없어도 된다(선택 항목)', async () => {
    const dto = plainToInstance(AiRecommendDrugsDto, base);
    expect(await validate(dto)).toHaveLength(0);
  });
});
