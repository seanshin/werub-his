/**
 * 🔴 (2026-09-15 B4) 인라인 @Body 4차 배치 30 핸들러 → class DTO 계약.
 * CRM 11(수정 4종 = `Record<string, unknown>` 이 그대로 Prisma data) · 검진 8 · 급양 9 · 인사 2.
 * 지키는 것(main.ts 전역 파이프 옵션 그대로):
 *  ① 잘못된 본문 400(종전 Prisma 500)  ② 대조군 — 화면이 실제로 보내는 모양은 통과·키 보존
 *  ③ DTO 밖 키는 지워진다 + 서비스도 읽는 키만 Prisma 로 보낸다  ④ 핸들러 시그니처가 DTO class 다(소스 대조)
 */
import 'reflect-metadata';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { ArgumentMetadata, BadRequestException, ValidationPipe } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import {
  CreateCrmCampaignDto,
  CreateCrmSegmentDto,
  CreateCrmTemplateDto,
  CreatePortalBannerDto,
  LogCrmCommunicationDto,
  UpdateCrmCampaignDto,
  UpdateForeignCaseDto,
  UpdatePortalBannerDto,
} from '../../src/modules/crm/dto/crm-write.dto';
import { CrmService } from '../../src/modules/crm/crm.service';
import {
  AddCheckupPanelResultsDto,
  AddCheckupResultDto,
  CancelCheckupVisitDto,
  CompleteCheckupInterpretationDto,
  CreateCheckupFollowUpDto,
  CreateCheckupReferralDto,
  SkipCheckupItemDto,
} from '../../src/modules/checkup/dto/checkup-result-write.dto';
import {
  BulkStaffMenuDto,
  ConfirmStaffMealsDto,
  DeliverMealCheckDto,
  InspectProductionBatchDto,
  RecordHaccpDto,
  RequestStaffMealDto,
  UpdateProductionStatusDto,
  UpsertStaffMenuDto,
} from '../../src/modules/nutrition/dto/nutrition-production.dto';
import { ChangeStaffStatusDto, SetStaffManagerDto } from '../../src/modules/hr/dto/hr.dto';

const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: false, transform: true });
const meta = (metatype: ArgumentMetadata['metatype']): ArgumentMetadata => ({ type: 'body', metatype, data: undefined });
const bad = (v: unknown, t: ArgumentMetadata['metatype']) => expect(pipe.transform(v, meta(t))).rejects.toBeInstanceOf(BadRequestException);
const ok = (v: unknown, t: ArgumentMetadata['metatype']) => pipe.transform(v, meta(t)) as Promise<Record<string, unknown>>;
const U = '11111111-1111-4111-8111-111111111111';

describe('인라인 @Body 4차 배치 DTO 계약', () => {
  it('③ CRM 캠페인 수정 — 본문의 status·발송 집계·작성자가 지워진다 · 비움(null)은 통과 · 형식 위반 400', async () => {
    const r = await ok({ name: '가을 리콜', content: '안내', status: 'COMPLETED', sentCount: 999, createdBy: U, abParentId: U }, UpdateCrmCampaignDto);
    expect(r).toEqual({ name: '가을 리콜', content: '안내' });
    expect(await ok({ segmentId: null, scheduledAt: null }, UpdateCrmCampaignDto)).toEqual({ segmentId: null, scheduledAt: null });
    await bad({ segmentId: 'seg-1' }, UpdateCrmCampaignDto); // @db.Uuid — 종전 Prisma 500
    await bad({ name: 'x'.repeat(201) }, UpdateCrmCampaignDto); // VarChar(200)
    await bad({ name: null }, UpdateCrmCampaignDto); // NOT NULL
    // 배너 — 노출·클릭 집계 위조 차단
    const b = await ok({ title: '공지', clickCount: 10_000, impressionCount: 1, isActive: false }, UpdatePortalBannerDto);
    expect(b).toEqual({ title: '공지', isActive: false });
    // 케이스 — 환자 바꿔치기 차단
    const c = await ok({ status: 'CONFIRMED', patientId: U, source: 'AGENCY', satisfactionScore: 5 }, UpdateForeignCaseDto);
    expect(c).toEqual({ status: 'CONFIRMED', satisfactionScore: 5 });
    await bad({ arrivalDate: '9월 20일' }, UpdateForeignCaseDto);
    await bad({ estimatedCost: 1e13 }, UpdateForeignCaseDto); // Decimal(12,0)
  });

  it('③ CRM 서비스 — DTO 를 거치지 않은 호출도 읽는 키만 Prisma data 로 간다(종전 본문 전체)', async () => {
    const campaignUpdate = vi.fn().mockResolvedValue({ id: U });
    const bannerUpdate = vi.fn().mockResolvedValue({ id: U });
    const caseUpdate = vi.fn().mockResolvedValue({ id: U });
    const templateUpdate = vi.fn().mockResolvedValue({ id: U });
    const prisma = {
      crmCampaign: { findUnique: vi.fn().mockResolvedValue({ id: U, status: 'DRAFT' }), update: campaignUpdate },
      crmPortalBanner: { update: bannerUpdate },
      crmForeignPatientCase: { update: caseUpdate },
      crmTemplate: { update: templateUpdate },
    };
    const svc = new CrmService(prisma as never, {} as never, {} as never);

    await svc.updateCampaign(U, { name: 'n', segmentId: '', status: 'COMPLETED', sentCount: 5, createdBy: U } as never);
    const cd = campaignUpdate.mock.calls[0][0].data as Record<string, unknown>;
    expect(cd).toMatchObject({ name: 'n', segmentId: null });
    for (const k of ['status', 'sentCount', 'createdBy']) expect(cd).not.toHaveProperty(k);

    await svc.updateBanner(U, { title: 't', clickCount: 1, publishFrom: '2026-09-15T00:00:00Z' } as never);
    const bd = bannerUpdate.mock.calls[0][0].data as Record<string, unknown>;
    expect(bd.title).toBe('t');
    expect(bd.publishFrom).toBeInstanceOf(Date);
    expect(bd).not.toHaveProperty('clickCount');

    await svc.updateForeignCase(U, { note: 'm', arrivalDate: '2026-09-20', departureDate: null, patientId: U } as never);
    const fd = caseUpdate.mock.calls[0][0].data as Record<string, unknown>;
    expect(fd.arrivalDate).toEqual(new Date('2026-09-20T00:00:00.000Z')); // @db.Date 정본 비교값(종전 문자열 → Prisma 500)
    expect(fd.departureDate).toBeNull();
    expect(fd).not.toHaveProperty('patientId');
    await expect(svc.updateForeignCase(U, { arrivalDate: 'abc' } as never)).rejects.toBeInstanceOf(BadRequestException);

    await svc.updateTemplate(U, { content: 'c', isActive: false, id: 'evil' } as never);
    const td = templateUpdate.mock.calls[0][0].data as Record<string, unknown>;
    expect(td.content).toBe('c');
    expect(td).not.toHaveProperty('isActive');
    expect(td).not.toHaveProperty('id');
  });

  it('② CRM 생성 — 화면 4종(campaigns·templates·segments·consultation) 모양 통과·키 보존 · 필수 누락 400', async () => {
    const campaign = { name: '리콜', type: 'REMINDER', channel: 'SMS', content: '{{patientName}}님' };
    expect(await ok(campaign, CreateCrmCampaignDto)).toEqual(campaign);
    const template = { name: 't', type: 'REMINDER', channel: 'SMS', locale: 'ko', content: 'c' };
    expect(await ok(template, CreateCrmTemplateDto)).toEqual(template);
    const segment = { name: '이탈', type: 'AUTO', rules: { churnRisk: 'HIGH' } };
    expect(await ok(segment, CreateCrmSegmentDto)).toEqual(segment);
    const log = { patientId: U, channel: 'CALL', direction: 'INBOUND', type: 'MANUAL', subject: '전화 상담', content: '문의', status: 'DELIVERED' };
    expect(await ok(log, LogCrmCommunicationDto)).toEqual(log);
    await bad({ ...segment, rules: '{"churnRisk":"HIGH"}' }, CreateCrmSegmentDto); // Json 맵을 문자열로
    await bad({ ...log, patientId: 'P-0001' }, LogCrmCommunicationDto);
    await bad({ ...template, locale: 'ko-KR-x' }, CreateCrmTemplateDto); // VarChar(5)
    await bad({ type: 'POPUP', title: '공지' }, CreatePortalBannerDto); // publishFrom NOT NULL — 종전 Invalid Date → 500
  });

  it('② 검진 — 화면(his-checkup/visit/[id]) 6모양 통과(빈 unit·referenceRange 포함) · ① 길이·날짜·uuid 위반 400', async () => {
    const result = { category: 'LAB', testName: '공복혈당', testCode: 'GLU', value: '98', unit: '', referenceRange: '', finding: 'NORMAL', note: '' };
    expect(await ok(result, AddCheckupResultDto)).toEqual(result);
    const panel = { category: 'LAB', parentTestName: '혈액검사 (종합)', values: { TC: '210', HDL: '45' } };
    expect(await ok(panel, AddCheckupPanelResultsDto)).toEqual(panel);
    const followUp = { followUpType: 'RECHECK', description: '6개월 후 위내시경', dueDate: '2027-03-15' };
    expect(await ok(followUp, CreateCheckupFollowUpDto)).toEqual(followUp);
    const referral = { toDepartment: '소화기내과', reason: '용종', urgency: 'ROUTINE' };
    expect(await ok(referral, CreateCheckupReferralDto)).toEqual(referral);
    expect(await ok({ reason: '관리자 취소' }, CancelCheckupVisitDto)).toEqual({ reason: '관리자 취소' });
    expect(await ok({ testName: '위내시경', reason: '수검자 거부' }, SkipCheckupItemDto)).toEqual({ testName: '위내시경', reason: '수검자 거부' });
    // 판정 어휘는 막지 않는다(도메인 판정) — 길이만
    expect(await ok({ finding: '위염 소견', grade: 'R' }, CompleteCheckupInterpretationDto)).toEqual({ finding: '위염 소견', grade: 'R' });
    await bad({ finding: 'f', grade: 'C2-high' }, CompleteCheckupInterpretationDto); // VarChar(5)
    await bad({ ...followUp, dueDate: '다음 달' }, CreateCheckupFollowUpDto);
    await bad({ ...followUp, description: 'x'.repeat(501) }, CreateCheckupFollowUpDto); // VarChar(500) — 자르지 않고 400
    await bad({ ...result, value: 'x'.repeat(201) }, AddCheckupResultDto);
    await bad({ ...referral, resultItemId: 'item-1' }, CreateCheckupReferralDto);
    await bad({ ...panel, values: '210' }, AddCheckupPanelResultsDto);
  });

  it('② 급양 — 화면(nutrition·tablet/nutrition·staff-meal) 7모양 통과 · ① 숫자·NOT NULL 위반 400', async () => {
    expect(await ok({ status: 'COOKING' }, UpdateProductionStatusDto)).toEqual({ status: 'COOKING' });
    expect(await ok({ pass: false }, InspectProductionBatchDto)).toEqual({ pass: false });
    const haccp = { ccpType: 'HEATING', value: 72.5, correctiveAction: '재가열' };
    expect(await ok(haccp, RecordHaccpDto)).toEqual(haccp);
    const checks = { patientVerified: true, dietVerified: true, allergyVerified: true, tempOk: false };
    expect(await ok(checks, DeliverMealCheckDto)).toEqual(checks);
    const menu = { date: '2026-09-15', mealType: 'LUNCH', courseType: 'A', menuName: '비빔밥', description: '', price: 6000 };
    expect(await ok(menu, UpsertStaffMenuDto)).toEqual(menu);
    expect(await ok({ date: '2026-09-15', mealType: 'LUNCH', courseType: 'A' }, RequestStaffMealDto)).toEqual({ date: '2026-09-15', mealType: 'LUNCH', courseType: 'A' });
    expect(await ok({ date: '2026-09-15' }, ConfirmStaffMealsDto)).toEqual({ date: '2026-09-15' });
    await bad({ producedQty: '많이' }, UpdateProductionStatusDto);
    await bad({ ccpType: 'HEATING', value: '뜨거움' }, RecordHaccpDto); // Float — 종전 500
    await bad({ taste: '맛있음' }, InspectProductionBatchDto);
    await bad({ ...menu, price: null }, UpsertStaffMenuDto); // NOT NULL Int
    await bad({ menus: [menu, { ...menu, date: 'abc' }] }, BulkStaffMenuDto); // 원소도 검사
    await bad({ date: '15/09/2026', mealType: 'LUNCH' }, RequestStaffMealDto);
  });

  it('② 인사 — 보고라인 해제(null·\'\') 통과 · 비 uuid 400 · 재직상태 어휘는 서비스 정본이 말한다', async () => {
    expect(await ok({ managerStaffId: null }, SetStaffManagerDto)).toEqual({ managerStaffId: null });
    expect(await ok({ managerStaffId: '' }, SetStaffManagerDto)).toEqual({ managerStaffId: '' });
    await bad({ managerStaffId: 'EMP-001' }, SetStaffManagerDto);
    expect(await ok({ status: 'ON_LEAVE', effectiveDate: '' }, ChangeStaffStatusDto)).toEqual({ status: 'ON_LEAVE', effectiveDate: '' });
    await bad({ status: 'ON_LEAVE', effectiveDate: '다음 주' }, ChangeStaffStatusDto);
    await bad({}, ChangeStaffStatusDto);
  });

  it('④ 핸들러 시그니처가 DTO class 다', () => {
    const src = (p: string) => fs.readFileSync(path.resolve(__dirname, '../../src/modules', p), 'utf8');
    const crm = src('crm/crm.controller.ts');
    for (const t of ['CreateCrmCampaignDto', 'UpdateCrmCampaignDto', 'CreateCrmSegmentDto', 'CreateCrmTemplateDto', 'UpdateCrmTemplateDto', 'UpdateCrmPatientConsentDto', 'CreateForeignCaseDto', 'UpdateForeignCaseDto', 'LogCrmCommunicationDto', 'CreatePortalBannerDto', 'UpdatePortalBannerDto']) {
      expect(crm).toMatch(new RegExp(`@Body\\(\\) body: ${t}\\b`));
    }
    expect(crm).not.toMatch(/@Body\(\) body: Record</);
    const ck = src('checkup/checkup.controller.ts');
    for (const t of ['CancelCheckupVisitDto', 'RescheduleCheckupVisitDto', 'SkipCheckupItemDto', 'AddCheckupResultDto', 'AddCheckupPanelResultsDto', 'CompleteCheckupInterpretationDto', 'CreateCheckupFollowUpDto', 'CreateCheckupReferralDto']) {
      expect(ck).toMatch(new RegExp(`@Body\\(\\) body: ${t}\\b`));
    }
    const nu = src('nutrition/nutrition.controller.ts');
    expect(nu).not.toMatch(/@Body\(\) body: \{/);
    const hr = src('hr/hr.controller.ts');
    expect(hr).toMatch(/@Body\(\) body: SetStaffManagerDto/);
    expect(hr).toMatch(/@Body\(\) body: ChangeStaffStatusDto/);
  });
});
