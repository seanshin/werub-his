import { describe, it, expect, vi } from 'vitest';
import { ValidationPipe, ArgumentMetadata, BadRequestException } from '@nestjs/common';
import { UpsertPreAnesthesiaDto } from '../../src/modules/surgery/dto/surgery-advanced.dto';
import { SurgeryAdvancedService } from '../../src/modules/surgery/surgery-advanced.service';

/**
 * 마취전평가 **임시 저장** 계약 가드 — 2026-08-18.
 *
 * 마취전평가는 한 번에 다 못 쓰는 문서다(ASA 는 진찰 후, 기도 등급은 대면 평가 후, 계획은 마지막).
 * `asaClass`·`airwayMallampati`·`plan` 은 `@IsIn` 이고 화면 select 의 초기값은 빈 문자열 `''` 이다 —
 * 값 목록에 `''` 이 없으면 **하나만 안 골라도 요청 전체가 400** 이 되어 임시 저장이 원천 불가해진다.
 * (이 저장소에는 같은 모양의 사고 선례가 있다: 수술기록 `ebl` 이 목 테스트만 통과하고
 *  실제 파이프에서 400 이라 개통 이래 저장 0건이었다.)
 *
 * 🔴 그래서 이 가드는 **컨트롤러가 아니라 실제 전역 ValidationPipe** 에 화면 페이로드를 태운다.
 *    동시에 반대 방향도 잠근다 — 빈 값을 '입력된 값'으로 세어 완료 게이트를 통과시키면 안 된다.
 */

// main.ts 와 동일 옵션. 갈라지면 이 가드는 아무것도 보증하지 않는다.
const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: false, transform: true });
const meta = (m: unknown): ArgumentMetadata => ({ type: 'body', metatype: m as never, data: '' });
const through = (payload: Record<string, unknown>) =>
  pipe.transform(payload, meta(UpsertPreAnesthesiaDto)) as Promise<Record<string, unknown>>;

/** 값이 실제로 실린 키만 센다 — 클래스 필드는 undefined 로 선언되므로 Object.keys 는 전 필드를 돌려준다. */
const definedKeys = (o: Record<string, unknown>) =>
  Object.entries(o).filter(([, v]) => v !== undefined).map(([k]) => k).sort();

/** `surgery-prep` PreAnesthesiaSection 의 form state 그대로(초기 상태 = 아무것도 안 고른 상태). */
const EMPTY_FORM = { asaClass: '', airwayMallampati: '', plan: '', npoConfirmed: false, labsReviewed: false, anesthesiaConsent: false };

describe('마취전평가는 나눠 쓸 수 있어야 한다 (실 ValidationPipe)', () => {
  it('🔴 아무것도 안 고른 초기 폼이 400 이 아니다 — 임시 저장이 막히면 안 된다', async () => {
    await expect(through({ ...EMPTY_FORM })).resolves.toBeDefined();
  });

  it('🔴 화면이 보내는 6키가 하나도 버려지지 않는다 — whitelist 는 조용히 지운다', async () => {
    const out = await through({ ...EMPTY_FORM });
    expect(definedKeys(out)).toEqual(Object.keys(EMPTY_FORM).sort());
  });

  it('부분 입력(ASA·금식만)이 통과하고 나머지는 빈 값 그대로 남는다', async () => {
    const out = await through({ ...EMPTY_FORM, asaClass: '2', npoConfirmed: true });
    expect(out.asaClass).toBe('2');
    expect(out.npoConfirmed).toBe(true);
    expect(out.airwayMallampati).toBe('');
    expect(out.plan).toBe('');
  });

  it('빈 값을 허용해도 **틀린 값**은 여전히 거절한다 — 허용치를 넓힌 것이 아니다', async () => {
    await expect(through({ asaClass: '7' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(through({ airwayMallampati: 'V' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(through({ plan: 'GENERAL_ANESTHESIA' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(through({ cardiacRiskRcri: 9 })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('화면 select 의 값 집합이 DTO 허용치에 전부 들어 있다 — 고르면 저장돼야 한다', async () => {
    const asa = ['1', '2', '3', '4', '5', '6', '2E', '3E', '4E'];
    const mallampati = ['I', 'II', 'III', 'IV'];
    const plans = ['GENERAL', 'SPINAL', 'EPIDURAL', 'SEDATION', 'LOCAL'];
    for (const v of asa) expect((await through({ asaClass: v })).asaClass, `ASA ${v}`).toBe(v);
    for (const v of mallampati) expect((await through({ airwayMallampati: v })).airwayMallampati, `MP ${v}`).toBe(v);
    for (const v of plans) expect((await through({ plan: v })).plan, `plan ${v}`).toBe(v);
  });
});

describe('임시 저장을 허용해도 완료 게이트는 느슨해지지 않는다', () => {
  function svc(evaluation: Record<string, unknown>) {
    const prisma = {
      surgery: { findUnique: vi.fn().mockResolvedValue({ id: 's-1', patientId: 'p-1' }) },
      preAnesthesiaEvaluation: {
        findUnique: vi.fn().mockResolvedValue(evaluation),
        upsert: vi.fn().mockResolvedValue({}),
        update: vi.fn().mockResolvedValue({ status: 'COMPLETED' }),
      },
    };
    return { service: new SurgeryAdvancedService(prisma as never, { get: vi.fn().mockResolvedValue(null) } as never), prisma };
  }

  it('🔴 빈 문자열은 "입력됨"이 아니다 — 빈 값으로 완료되면 sign-in 게이트가 조용히 열린다', async () => {
    const { service, prisma } = svc({
      status: 'DRAFT', asaClass: '', airwayMallampati: '', plan: '',
      npoConfirmed: true, labsReviewed: true, anesthesiaConsent: true,
    });
    await expect(service.completePreAnesthesia('s-1', 'dr-1')).rejects.toMatchObject({
      response: { code: 'PRE_ANES_INCOMPLETE', missing: expect.arrayContaining(['ASA 분류', '기도평가(Mallampati)', '마취 계획']) },
    });
    expect(prisma.preAnesthesiaEvaluation.update, '미완인데 COMPLETED 로 넘어갔다').not.toHaveBeenCalled();
  });

  it('전부 채워지면 완료된다 — 게이트가 영구히 닫혀 있는 것도 결함이다', async () => {
    const { service, prisma } = svc({
      status: 'DRAFT', asaClass: '2', airwayMallampati: 'II', plan: 'GENERAL',
      npoConfirmed: true, labsReviewed: true, anesthesiaConsent: true,
    });
    await service.completePreAnesthesia('s-1', 'dr-1');
    expect(prisma.preAnesthesiaEvaluation.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'COMPLETED' }),
    }));
  });
});
