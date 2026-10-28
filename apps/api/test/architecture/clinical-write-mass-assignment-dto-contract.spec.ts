/**
 * 🔴 (2026-09-15 E2) 대량 할당·임상 쓰기 24 핸들러의 인라인 @Body → class DTO 계약.
 * 서비스가 본문을 `{ ...data }` 로 Prisma create/update 에 펼치던 자리(기관·이식 기증자/대기자/기록/거부반응·호스피스·환자식별·표준매핑)에서
 * 절차·출처 컬럼을 본문으로 지정할 수 있었다.
 * 지키는 것(main.ts 전역 파이프 옵션 그대로):
 *  ① 빈·잘못된 본문 400  ② 대조군 — 화면이 실제로 보내는 모양은 통과·키 보존  ③ DTO 밖 절차·출처 컬럼은 지워진다
 *  ④ 핸들러 시그니처가 DTO class 다(소스 대조)
 */
import 'reflect-metadata';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { ArgumentMetadata, BadRequestException, ValidationPipe } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { CreateOrganizationDto } from '../../src/modules/organization/dto/organization.dto';
import { CreateTransplantRecordDto, RegisterTransplantDonorDto } from '../../src/modules/transplant/dto/transplant.dto';
import { CreateAdvanceDirectiveDto, CreateHospiceAssessmentDto, RegisterHospiceDto } from '../../src/modules/hospice/dto/hospice.dto';
import { AssessMorseFallDto } from '../../src/modules/patient-safety/dto/id-check-morse.dto';
import { CreateTerminologyMappingDto } from '../../src/modules/code-master/dto/terminology-mapping.dto';
import { SetAuthPolicyDto } from '../../src/modules/auth/lifecycle/dto/auth-policy.dto';
import { AssignIsolationDto } from '../../src/modules/infection-control/dto/resistance-isolation.dto';
import { AddNursingInterventionDto } from '../../src/modules/nursing/dto/care-plan.dto';

const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: false, transform: true });
const meta = (metatype: ArgumentMetadata['metatype']): ArgumentMetadata => ({ type: 'body', metatype, data: undefined });
const bad = (v: unknown, t: ArgumentMetadata['metatype']) => expect(pipe.transform(v, meta(t))).rejects.toBeInstanceOf(BadRequestException);
const ok = (v: unknown, t: ArgumentMetadata['metatype']) => pipe.transform(v, meta(t)) as Promise<Record<string, unknown>>;
const U = '11111111-1111-4111-8111-111111111111';

describe('대량 할당·임상 쓰기 본문 DTO 계약', () => {
  it('③ 이식 기증자 — 본문의 status·crossmatchResult(승인·교차시험 절차)가 지워진다', async () => {
    const good = { donorType: 'LIVING', bloodType: 'A', organType: 'KIDNEY' };
    const r = await ok({ ...good, status: 'APPROVED', crossmatchResult: 'NEGATIVE', id: U }, RegisterTransplantDonorDto);
    expect(r).toMatchObject(good);
    expect(r).not.toHaveProperty('status');
    expect(r).not.toHaveProperty('crossmatchResult');
    expect(r).not.toHaveProperty('id');
    await bad({}, RegisterTransplantDonorDto);
    await bad({ ...good, bloodType: 'ABCDEFG' }, RegisterTransplantDonorDto); // VarChar(5) 초과는 종전 500
  });

  it('③ 이식 기록 — outcome·graftFunction 이 지워지고 날짜·UUID 는 400', async () => {
    const good = { recipientId: U, donorId: U, organType: 'KIDNEY', transplantDate: '2026-09-15T09:00:00+09:00', surgeonId: U };
    const r = await ok({ ...good, outcome: 'SUCCESS', graftFunction: 'IMMEDIATE' }, CreateTransplantRecordDto);
    expect(r).not.toHaveProperty('outcome');
    expect(r).not.toHaveProperty('graftFunction');
    await bad({ ...good, transplantDate: 'yesterday' }, CreateTransplantRecordDto);
    await bad({ ...good, surgeonId: 'x' }, CreateTransplantRecordDto);
  });

  it('① 호스피스 ESAS — 문자열·범위 밖 점수는 400(종전 totalScore 가 문자열 이어붙이기), 화면 모양은 숫자로 통과', async () => {
    const web = { registrationId: U, pain: 7, tiredness: 3, nausea: 0, depression: 2, anxiety: 1, drowsiness: 4, appetite: 5, wellbeing: 6, shortnessOfBreath: 0, whoStep: 2, notes: 'x' };
    const r = await ok(web, CreateHospiceAssessmentDto); // hospice/page.tsx onSubmit 모양
    expect(r).toMatchObject(web);
    expect(typeof r.pain).toBe('number');
    await bad({ ...web, pain: 11 }, CreateHospiceAssessmentDto);
    await bad({ ...web, nausea: 'a' }, CreateHospiceAssessmentDto);
    await bad({ ...web, whoStep: 4 }, CreateHospiceAssessmentDto);
  });

  it('③ 사전의료의향서·호스피스 등록 — status·revokedAt 등 절차 컬럼이 지워진다 · 등록 화면 모양 통과', async () => {
    const d = await ok({ patientId: U, documentType: 'POLST', cprDecision: 'DNR', status: 'REVOKED', revokedAt: '2026-01-01' }, CreateAdvanceDirectiveDto);
    expect(d).not.toHaveProperty('status');
    expect(d).not.toHaveProperty('revokedAt');
    const web = { patientId: U, ppsScore: 50, primaryDiagnosis: '폐암 4기', prognosis: 'WEEKS', hospiceType: 'INPATIENT', goals: '', dnrStatus: false };
    const r = await ok({ ...web, status: 'DECEASED' }, RegisterHospiceDto); // hospice/page.tsx form 모양
    expect(r).toMatchObject(web);
    expect(r).not.toHaveProperty('status');
    await bad({ ...web, ppsScore: 150 }, RegisterHospiceDto);
  });

  it('① Morse — 문자열 "false" 는 400(종전 참으로 읽혀 +20점)', async () => {
    const f = { historyOfFalling: false, secondaryDiagnosis: true, ambulatoryAid: 'NONE', ivTherapy: false, gait: 'NORMAL', mentalStatus: 'ORIENTED' };
    expect(await ok({ patientId: U, factors: f }, AssessMorseFallDto)).toMatchObject({ factors: f });
    await bad({ patientId: U, factors: { ...f, ivTherapy: 'false' } }, AssessMorseFallDto);
    await bad({ patientId: U, factors: { ...f, gait: 'SLOW' } }, AssessMorseFallDto);
  });

  it('③ 표준 매핑 — mapSource·createdBy·isActive 가 지워진다(출처 위장 차단)', async () => {
    const good = { sourceTable: 'diagnosis_codes', sourceId: U, sourceCode: 'I10', targetSystem: 'SNOMED_CT', targetCode: '38341003', targetDisplay: 'Hypertension' };
    const r = await ok({ ...good, mapSource: 'AUTO', createdBy: U, isActive: false }, CreateTerminologyMappingDto);
    expect(r).toMatchObject(good);
    for (const k of ['mapSource', 'createdBy', 'isActive']) expect(r).not.toHaveProperty(k);
  });

  it('② 기관 등록 — 관리 화면 모양(type 별칭) 통과 · smartSecret·isSelf 가 지워진다', async () => {
    const web = { code: 'H001', name: '협력병원', type: 'HOSPITAL', grade: '', phone: '', fhirEndpoint: '' }; // admin/organizations form
    const r = await ok({ ...web, smartSecret: 's', isSelf: true }, CreateOrganizationDto);
    expect(r).toMatchObject(web);
    expect(r).not.toHaveProperty('smartSecret');
    expect(r).not.toHaveProperty('isSelf');
    await bad({ name: 'x' }, CreateOrganizationDto);
  });

  it('② 격리 오더·NIC — 화면 모양 통과 · 인증 정책 모르는 키 제거·문자 수치 400', async () => {
    const iso = { patientId: U, isolationType: 'CONTACT', reason: 'MRSA' }; // encounter/new 모양
    expect(await ok(iso, AssignIsolationDto)).toMatchObject(iso);
    expect(await ok({ nicCode: '6490', name: '낙상 예방' }, AddNursingInterventionDto)).toMatchObject({ nicCode: '6490', name: '낙상 예방' }); // care-plan 모양
    await bad({ nicCode: '6490' }, AddNursingInterventionDto);
    const p = await ok({ maxDevices: 2, evil: 1 }, SetAuthPolicyDto);
    expect(p).toEqual({ maxDevices: 2 });
    await bad({ maxDevices: 'abc' }, SetAuthPolicyDto);
  });

  it('④ 핸들러 시그니처가 DTO class 다', () => {
    const src = (p: string) => fs.readFileSync(path.resolve(__dirname, '../../src/modules', p), 'utf8');
    expect(src('organization/organization.controller.ts')).toMatch(/@Body\(\) dto: CreateOrganizationDto/);
    expect(src('transplant/transplant.controller.ts')).toMatch(/@Body\(\) body: RegisterTransplantDonorDto/);
    expect(src('hospice/hospice.controller.ts')).toMatch(/@Body\(\) body: CreateHospiceAssessmentDto/);
    expect(src('hospice/hospice.controller.ts')).toMatch(/@Body\(\) body: CreateAdvanceDirectiveDto/);
    expect(src('patient-safety/patient-safety.controller.ts')).toMatch(/@Body\(\) body: AssessMorseFallDto/);
    expect(src('code-master/code-master.controller.ts')).toMatch(/@Body\(\) body: CreateTerminologyMappingDto/);
    expect(src('auth/lifecycle/lifecycle.controller.ts')).toMatch(/@Body\(\) body: SetAuthPolicyDto/);
  });
});
