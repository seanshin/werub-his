/**
 * 🔴 (2026-09-15 T2) 위험 쓰기 25 핸들러의 인라인 @Body → class DTO 계약.
 * 인라인·Record·Partial·@Body('키') 는 런타임 metatype 이 Object 라 ValidationPipe 가 통째로 스킵됐다.
 * 지키는 것(main.ts 전역 파이프 옵션 그대로):
 *  ① 빈·잘못된 본문은 400  ② 대조군 — 화면이 실제로 보내는 모양은 통과하고 키가 지워지지 않는다(whitelist 조용한 폐기 없음)
 *  ③ 대량 할당 차단 — 서비스가 본문을 Prisma 에 펼치는 자리(사용자 수정·ADR)에서 DTO 밖 컬럼이 지워진다
 *  ④ 핸들러 시그니처가 DTO class 다(소스 대조 — vitest 는 design:paramtypes 를 내지 않는다)
 */
import 'reflect-metadata';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { ArgumentMetadata, BadRequestException, ValidationPipe } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { UpdateUserDto, SaveMySignatureDto } from '../../src/modules/user/dto/update-user.dto';
import { CreateUserDto } from '../../src/modules/user/dto/create-user.dto';
import { CreateInstallmentPlanDto, ReemitAccrualDto } from '../../src/modules/billing/dto/billing-body.dto';
import { PrescribeControlledSubstanceDto } from '../../src/modules/controlled-substance/dto/prescribe.dto';
import { AddClaimAdjustmentsDto, ClaimAppealDto } from '../../src/modules/claim/dto/claim-body.dto';
import { MenuCustomDto, MenuOverridesDto } from '../../src/modules/access-control/dto/menu-config.dto';
import { CreateAdrDto } from '../../src/modules/pharmacy/dto/adr.dto';
import { DurOverrideDto, PrescriberDelegateRequestDto } from '../../src/modules/prescription/dto/prescription-body.dto';
import { SetExpectedDischargeDto } from '../../src/modules/inpatient/dto/inpatient.dto';

const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: false, transform: true });
const meta = (metatype: ArgumentMetadata['metatype']): ArgumentMetadata => ({ type: 'body', metatype, data: undefined });
const bad = (v: unknown, t: ArgumentMetadata['metatype']) => expect(pipe.transform(v, meta(t))).rejects.toBeInstanceOf(BadRequestException);
const ok = (v: unknown, t: ArgumentMetadata['metatype']) => pipe.transform(v, meta(t)) as Promise<Record<string, unknown>>;

const U = '11111111-1111-4111-8111-111111111111';

describe('위험 쓰기 본문 DTO 계약', () => {
  it('① 수납 분납 — 0회차는 400(종전엔 amount/0 = Infinity 회차 금액)', async () => {
    await bad({ totalInstallments: 0 }, CreateInstallmentPlanDto);
    await bad({}, CreateInstallmentPlanDto);
    expect(await ok({ totalInstallments: 3 }, CreateInstallmentPlanDto)).toMatchObject({ totalInstallments: 3 }); // 화면(billing/page) 모양
    await bad({ treatedOn: '2026-09-14T10:00:00Z' }, ReemitAccrualDto); // 서비스가 T12:00+09:00 을 붙인다 — 날짜만
  });

  it('① 마약류 처방 — 음수·문자 수량·필수 누락은 400, 정상 본문은 통과', async () => {
    const good = { patientId: U, drugName: '펜타닐', deaSchedule: 'II', quantity: 2, unit: 'mL', prescribedBy: U };
    expect(await ok(good, PrescribeControlledSubstanceDto)).toMatchObject(good);
    await bad({ ...good, quantity: -1 }, PrescribeControlledSubstanceDto);
    await bad({ ...good, quantity: 'abc' }, PrescribeControlledSubstanceDto);
    await bad({ ...good, patientId: 'not-uuid' }, PrescribeControlledSubstanceDto);
  });

  it('② 청구 조정 — 화면(ClaimAdjustmentSection) 모양 통과·중첩 라인 검증', async () => {
    const web = { lines: [{ adjustCode: 'A01', itemName: 'CT', adjustReason: '기준초과', amount: 12000 }] };
    const r = await ok(web, AddClaimAdjustmentsDto);
    expect(r.lines).toEqual([expect.objectContaining(web.lines[0])]);
    await bad({ lines: [{ adjustCode: 'A01', amount: '12000원' }] }, AddClaimAdjustmentsDto);
    await bad({ reason: '' }, ClaimAppealDto);
  });

  it('② 메뉴 권한 — 화면(menu-config) 모양 통과·역할이 문자열이면 400(사이드바는 전 직원에게 렌더)', async () => {
    const web = { overrides: { '/billing': { hidden: true, roles: ['ADMIN'], label: '수납', order: 2 } } };
    expect(await ok(web, MenuOverridesDto)).toMatchObject(web);
    await bad({ overrides: { '/billing': { roles: 'ADMIN' } } }, MenuOverridesDto);
    await bad({ overrides: { '/billing': { order: '2' } } }, MenuOverridesDto);
    const items = { items: [{ id: 'c1', section: '기타', href: '/custom/a', label: 'A', roles: ['ADMIN'] }] };
    expect(await ok(items, MenuCustomDto)).toMatchObject(items);
  });

  it('②·③ 사용자 — 등록 화면이 보내는 진료과·세부전문과가 지워지지 않고, 수정은 DTO 밖 컬럼을 지운다(대량 할당 차단)', async () => {
    const create = await ok({ email: 'a@b.example', familyName: '박', givenName: '의사', role: 'DOCTOR', department: '내과', specialty: '순환기' }, CreateUserDto);
    expect(create).toMatchObject({ department: '내과', specialty: '순환기' });
    const upd = await ok({ givenName: '새이름', passwordHash: 'x', email: 'evil@x.example', mfaSecret: 'y', isActive: false }, UpdateUserDto);
    expect(upd).toEqual(expect.objectContaining({ givenName: '새이름', isActive: false }));
    expect(upd).not.toHaveProperty('passwordHash');
    expect(upd).not.toHaveProperty('email');
    expect(upd).not.toHaveProperty('mfaSecret');
    await bad({ role: 'SUPERUSER' }, UpdateUserDto);
    expect(await ok({ signatureImage: null }, SaveMySignatureDto)).toMatchObject({ signatureImage: null });
  });

  it('②·③ ADR — 화면(pharmacy/admin) 폼 모양 통과·빈 발현일 400(종전 500)·원장 컬럼 주입 제거', async () => {
    const form = { patientId: U, suspectedDrugName: '아목시실린', suspectedDrugCode: '', reactionDescription: '발진', onsetDate: '2026-09-10', severity: 'MODERATE', outcome: 'RECOVERING', actionTaken: 'UNCHANGED' };
    const r = await ok({ ...form, isSerious: true, reportType: 'FOLLOWUP' }, CreateAdrDto);
    expect(r).toMatchObject(form);
    expect(r).not.toHaveProperty('isSerious');
    expect(r).not.toHaveProperty('reportType');
    await bad({ ...form, onsetDate: '' }, CreateAdrDto);
  });

  it('② 처방 — 위임 요청(PrescriberDelegate)·DUR 무시(orders) 모양이 키 그대로 통과', async () => {
    const d = { prescriberId: U, type: 'MEDICATION', medicationCodeId: U, dosage: '500mg', frequency: 'TID', duration: 5, quantity: 15, route: 'PO' };
    expect(await ok(d, PrescriberDelegateRequestDto)).toMatchObject(d);
    await bad({ ...d, quantity: 0 }, PrescriberDelegateRequestDto);
    expect(await ok({ reason: 'ALLERGY_CHECKED', note: '' }, DurOverrideDto)).toMatchObject({ reason: 'ALLERGY_CHECKED', note: '' });
    expect(await ok({ date: null }, SetExpectedDischargeDto)).toMatchObject({ date: null });
    await bad({ date: '다음주' }, SetExpectedDischargeDto);
  });

  it('④ 핸들러 시그니처가 DTO class 다', () => {
    const src = (p: string) => fs.readFileSync(path.resolve(__dirname, '../../src/modules', p), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    const cases: Array<[string, RegExp]> = [
      ['user/user.controller.ts', /async update\([^{]*@Body\(\)\s*dto:\s*UpdateUserDto\)/],
      ['user/user.controller.ts', /async create\(@Body\(\)\s*dto:\s*CreateUserDto\)/],
      ['billing/billing.controller.ts', /@Body\(\)\s*dto:\s*CreateInstallmentPlanDto/],
      ['controlled-substance/controlled-substance.controller.ts', /async prescribe\(@Body\(\)\s*data:\s*PrescribeControlledSubstanceDto\)/],
      ['claim/claim.controller.ts', /@Body\(\)\s*body:\s*AddClaimAdjustmentsDto/],
      ['access-control/access-control.controller.ts', /@Body\(\)\s*body:\s*MenuOverridesDto/],
      ['pharmacy/pharmacy.controller.ts', /async createAdr\(@Body\(\)\s*body:\s*CreateAdrDto/],
    ];
    for (const [f, re] of cases) expect(src(f), f).toMatch(re);
  });
});
