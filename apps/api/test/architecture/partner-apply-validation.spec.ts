import { describe, it, expect } from 'vitest';
import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { ApplyPartnerRequestDto } from '../../src/modules/partner-request/dto/partner-request.dto';

/**
 * 공개 파트너 신청 — 빈/불완전 바디는 **400 이지 500 이 아니다.**
 *
 * 🔴 2026-09-02 운영 실호출: `POST /api/v1/partner/apply` 가 `@Body() dto: any` 라 검증을 통째로
 *    스킵했고, 빈 바디가 그대로 Prisma 까지 내려가 **500** 이 났다. 같은 날 공개 홈페이지의 신청 폼을
 *    이 EP 에 실제로 배선했으므로(종전엔 `alert` 만 띄우고 아무 데도 보내지 않았다),
 *    신청자가 받아야 할 것은 "무엇이 빠졌는지"이지 서버 오류가 아니다.
 */
const validate = (obj: unknown) => validateSync(plainToInstance(ApplyPartnerRequestDto, obj), { whitelist: true });

describe('파트너 신청 DTO', () => {
  it('🔴 빈 바디는 필수 항목을 짚어 거절한다(500 이 아니라 400 의 근거)', () => {
    const errs = validate({});
    const props = errs.map((e) => e.property).sort();
    expect(props).toEqual(['contactEmail', 'contactName', 'country', 'orgName', 'orgType']);
  });

  it('정상 신청은 통과한다(대조군 — 전부 막으면 폼이 죽는다)', () => {
    expect(validate({
      orgName: '가상대병원', orgType: 'HOSPITAL', country: 'KOR',
      contactName: '홍길동', contactEmail: 'a@b.example',
      purpose: ['환자 전원 (Transfer)'], requestedScopes: ['Patient (환자)'],
    })).toHaveLength(0);
  });

  it('기관 유형은 화면 선택지 어휘로만 받는다', () => {
    expect(validate({ orgName: 'x', orgType: 'BANK', country: 'KOR', contactName: 'a', contactEmail: 'a@b.example' })
      .map((e) => e.property)).toEqual(['orgType']);
  });

  it('이메일 형식을 본다 — 회신이 가야 하는 자리다', () => {
    expect(validate({ orgName: 'x', orgType: 'CLINIC', country: 'KOR', contactName: 'a', contactEmail: 'not-an-email' })
      .map((e) => e.property)).toEqual(['contactEmail']);
  });

  it('길이 상한이 스키마(VarChar)와 맞다 — 넘치면 저장 시점에 터진다', () => {
    expect(validate({ orgName: 'x'.repeat(201), orgType: 'CLINIC', country: 'KOR', contactName: 'a', contactEmail: 'a@b.example' })
      .map((e) => e.property)).toEqual(['orgName']);
  });
});

describe('컨트롤러가 그 DTO 를 실제로 쓴다', () => {
  /**
   * 🔴 DTO 만 검사하면 **컨트롤러가 그것을 안 쓰는 회귀**를 못 잡는다(`@Body() dto: any` 로 되돌려도 통과했다).
   *    ValidationPipe 는 런타임 metatype 을 보므로 `any` 면 검증이 통째로 스킵된다.
   */
  it('@Body 가 any 가 아니라 ApplyPartnerRequestDto 다', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const src = readFileSync(join(process.cwd(), 'src', 'modules', 'partner-request', 'partner-request.controller.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(src).toMatch(/async apply\(@Body\(\)\s*dto:\s*ApplyPartnerRequestDto\)/);
    expect(src, '@Body() dto: any 는 ValidationPipe 를 스킵한다').not.toMatch(/async apply\(@Body\(\)\s*dto:\s*any\)/);
  });
});

describe('공개 신청 폼이 그 EP 를 실제로 부른다', () => {
  it.each([
    ['web (homepage) 그룹', ['..', 'web', 'src', 'app', '(homepage)', 'international', 'interoperability', 'page.tsx']],
    ['실 공개 사이트 apps/homepage', ['..', 'homepage', 'src', 'app', 'international', 'interoperability', 'page.tsx']],
  ])('%s — alert 만 띄우지 않는다', async (_label, parts) => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const src = readFileSync(join(process.cwd(), ...parts), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
    expect(src).toContain('/api/v1/partner/apply');
    // 🔴 보내지 않고 "접수되었습니다"라고 말하던 자리 — 제출 핸들러가 있어야 한다
    expect(src).toContain('submitApplication');
  });
});
