/**
 * 🔴 (2026-09-15 B10) 인라인 @Body 10차 배치 32 핸들러 → class DTO 계약.
 * 지키는 것(main.ts 전역 파이프 옵션 그대로):
 *  ① 대조군 — 화면이 **실제로 보내는 키**는 DTO 가 모두 안다(소스에서 키를 뽑아 기계 대조 — whitelist 조용한 삭제 방지)
 *  ② 🔴 문자열 "false" 가 참으로 읽히던 자리 — 트레이 회수 `trayCollected`·허위 CODE 플래그 `falseAlarm`·
 *     AI 생성 표기 `aiGenerated`·주 담당 `isPrimary`·스테이션/웹훅 활성·초안 삭제 `confirm`
 *  ③ 범위·어휘 — 섭취율 0~100·공급단가 정수 0 이상(해시 원장)·주입 속도 음수·정규화 id 100개/uuid·
 *     웹훅 이벤트 카탈로그·의뢰서 유형·특수영양 상태·안내 유형(조용한 recall 폴백)
 *  ④ 서비스 실경로 — 매핑 확정의 후보 밖 선택(첫 후보로 조용히 확정)·확정본 거부 뒤집기·
 *     컷오버 승인 원장 체크리스트 정본 키만·빈 퇴원요약 수정(서명본 AMENDED)·특수영양 시작일 KST 날짜
 */
import 'reflect-metadata';
import { ArgumentMetadata, BadRequestException, ConflictException } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { anchorPositions, bodyMeta, dtoKeys, literalKeys, literalKeysFrom, pipe, read } from './dto-contract-helpers';
import { CancelStaffCallDto } from '../../src/modules/staff-call/dto/staff-call.dto';
import { AssignNursePatientDto, TakeOverAssignmentDto } from '../../src/modules/nurse-station/dto/nurse-station.dto';
import { SetStationActiveDto } from '../../src/modules/patient-flow/dto/patient-flow.dto';
import { UpdateHospiceStatusDto } from '../../src/modules/hospice/dto/hospice.dto';
import { PurgeEmptyDraftsDto } from '../../src/modules/encounter/dto/purge-empty-drafts.dto';
import { QuickRoundDto } from '../../src/modules/doctors/dto/quick-round.dto';
import { ReplyConsultationDto } from '../../src/modules/consultation/dto/create-consultation.dto';
import {
  GenerateReferralLetterDto, ReferralLetterReasonDto, UpdateReferralLetterDto,
} from '../../src/modules/referral-letter/dto/referral-letter-write.dto';
import { ConfirmReceiptDto, SendBatchToDealerDto } from '../../src/modules/voucher/dto/distributor.dto';
import { ApproveCutoverDto } from '../../src/modules/phase0-cutover/dto/phase0-cutover.dto';
import {
  CreateFormularyListDto, SeedFormularyFromUsageDto, StartFormularyAiDraftDto,
} from '../../src/modules/formulary/dto/formulary.dto';
import {
  AssignMappingDepartmentDto, ConfirmPendingMappingDto, MappingReviewNotesDto,
} from '../../src/modules/code-master/dto/pending-mapping-review.dto';
import { QueueCheckInDto } from '../../src/modules/waiting-queue/dto/check-in.dto';
import { RegisterWaitlistDto } from '../../src/modules/schedule/dto/waitlist.dto';
import { NormalizeApplyDto, OutreachDraftDto } from '../../src/modules/data-quality/dto/data-quality-write.dto';
import {
  CreateSpecialNutritionDto, RecordMealIntakeDto, UpdateSpecialNutritionDto,
} from '../../src/modules/nutrition/dto/nutrition-advanced.dto';
import { UpdateDischargeSummaryDto } from '../../src/modules/discharge-summary/dto/create-discharge-summary.dto';
import { CreateHisWebhookDto, UpdateHisWebhookDto } from '../../src/modules/integration/dto/his-webhook.dto';
import { AutoMapperService } from '../../src/modules/code-master/auto-mapper.service';
import { Phase0CutoverService, CUTOVER_CHECKLIST } from '../../src/modules/phase0-cutover/phase0-cutover.service';
import { DischargeSummaryService } from '../../src/modules/discharge-summary/discharge-summary.service';
import { NutritionAdvancedService } from '../../src/modules/nutrition/nutrition-advanced.service';
import { todayDateOnly } from '../../src/common/day-range';

const bad = (v: unknown, t: ArgumentMetadata['metatype']) => expect(pipe.transform(v, bodyMeta(t))).rejects.toBeInstanceOf(BadRequestException);
const ok = (v: unknown, t: ArgumentMetadata['metatype']) => pipe.transform(v, bodyMeta(t)) as Promise<Record<string, unknown>>;
const U = '11111111-1111-4111-8111-111111111111';
const U2 = '22222222-2222-4222-8222-222222222222';
const SEED_UUID = '00000000-0000-4000-a000-000000d00001'; // 운영 시드 환자 id 모양 — 정규화 대상 id 로 통과해야 한다

describe('B10 요청 본문 DTO 계약', () => {
  describe('① 화면이 보내는 키를 DTO 가 모두 안다(whitelist 조용한 삭제 방지)', () => {
    const cases: Array<[string, string, string[], new () => object]> = [
      ['apps/web/src/app/(main)/nurse-station/page.tsx', "apiClient.post('/api/v1/nurse-station/assignments', ", ['nurseId', 'admissionId', 'shiftType'], AssignNursePatientDto],
      ['apps/web/src/app/(main)/nurse-station/page.tsx', "apiClient.post('/api/v1/nurse-station/assignments/take-over', ", ['admissionId', 'shiftType'], TakeOverAssignmentDto],
      ['apps/web/src/app/(main)/admin/location-stations/page.tsx', 'apiClient.patch(`/api/v1/admin/location-stations/${s.id}`, ', ['isActive'], SetStationActiveDto],
      ['apps/web/src/app/(main)/hospice/page.tsx', 'apiClient.patch(`/api/v1/hospice/registrations/${id}/status`, ', ['status'], UpdateHospiceStatusDto],
      ['apps/web/src/app/(main)/admin/phase0-cutover/page.tsx', "act('approve', ", ['reason', 'checklist'], ApproveCutoverDto],
      ['apps/web/src/app/(main)/rounds/page.tsx', "apiClient.post('/api/v1/doctors/rounds/quick', ", ['admissionId', 'assessment', 'plan', 'roundType'], QuickRoundDto],
      ['apps/web/src/app/(main)/consultations/page.tsx', 'apiClient.patch(`/api/v1/consultations/${id}/reply`, ', ['replyContent', 'recommendations'], ReplyConsultationDto],
      ['apps/web/src/app/(main)/patients/[id]/components/ReferralTab.tsx', "'/api/v1/referral-letters/generate', ", ['type', 'patientId', 'encounterId', 'toDepartment', 'urgency'], GenerateReferralLetterDto],
      ['apps/web/src/app/(main)/admin/voucher/issue/page.tsx', '/send-to-dealer`, ', ['distributorId', 'supplyPrice', 'recipientEmail', 'idempotencyKey'], SendBatchToDealerDto],
      ['apps/web/src/app/distributor/page.tsx', "'/api/v1/distributor/vouchers/confirm-receipt', { method: 'POST', token, body: JSON.stringify(", ['activationCodes'], ConfirmReceiptDto],
      ['apps/web/src/app/(main)/admin/formulary/page.tsx', "apiClient.post('/api/v1/formulary/seed-from-usage', ", ['months'], SeedFormularyFromUsageDto],
      ['apps/web/src/app/(main)/admin/formulary/page.tsx', "'/api/v1/formulary/lists/ai-draft', ", ['domain', 'topic'], StartFormularyAiDraftDto],
      ['apps/web/src/app/(main)/admin/formulary/page.tsx', "apiClient.post('/api/v1/formulary/lists', ", ['domain', 'name', 'items', 'aiGenerated'], CreateFormularyListDto],
      ['apps/web/src/app/(main)/admin/codes/auto-mapping-dashboard.tsx', 'apiClient.post(`/api/v1/codes/pending-mappings/${id}/confirm`, ', ['selectedCode', 'notes'], ConfirmPendingMappingDto],
      ['apps/web/src/app/(main)/admin/codes/auto-mapping-dashboard.tsx', 'apiClient.post(`/api/v1/codes/pending-mappings/${id}/reject`, ', ['notes'], MappingReviewNotesDto],
      ['apps/web/src/app/(main)/admin/codes/auto-mapping-dashboard.tsx', 'apiClient.post(`/api/v1/codes/clinical-review/${id}/approve`, ', ['notes'], MappingReviewNotesDto],
      ['apps/web/src/app/(main)/mapping-review/page.tsx', 'apiClient.post(`/api/v1/codes/clinical-review/${id}/reject`, ', ['notes'], MappingReviewNotesDto],
      ['apps/web/src/app/(main)/reception/components/WalkInTab.tsx', "apiClient.post('/api/v1/queue/check-in', ", ['patientId', 'doctorId', 'departmentName', 'visitType', 'reason', 'type'], QueueCheckInDto],
      ['apps/web/src/app/(main)/workstation/front-desk/page.tsx', "'/api/v1/queue/check-in', ", ['patientId', 'departmentName', 'visitType', 'reason', 'type'], QueueCheckInDto],
      ['apps/web/src/app/(main)/admin/data-quality/page.tsx', "'/api/v1/data-quality/outreach/draft', ", ['type', 'language'], OutreachDraftDto],
      ['apps/web/src/app/(main)/admin/data-quality/page.tsx', "apiClient.post('/api/v1/data-quality/normalize/apply', ", ['ids'], NormalizeApplyDto],
      ['apps/web/src/app/(main)/nutrition/components/NutritionAdvanced.tsx', "apiClient.post('/api/v1/nutrition/special-nutrition', ", ['admissionId', 'patientId', 'kind', 'route', 'formula', 'targetCalories', 'volumeMl', 'rateMlHr', 'notes'], CreateSpecialNutritionDto],
      ['apps/web/src/app/tablet/nutrition/page.tsx', "apiClient.post('/api/v1/nutrition/meal-intake', ", ['admissionId', 'patientId', 'mealOrderId', 'mealType', 'date', 'intakePercent', 'leftoverPercent', 'trayCollected', 'refusalReason'], RecordMealIntakeDto],
    ];
    for (const [file, anchor, expected, dto] of cases) {
      it(`${file.split('/').slice(-2).join('/')} ${anchor.slice(0, 48)} → ${dto.name}`, () => {
        const sent = literalKeys(read(file), anchor);
        // 추출기 자체 대조군 — 알려진 키를 실제로 뽑았는가(추출이 비면 아래 검사는 증거가 아니다)
        expect([...sent].sort()).toEqual([...expected].sort());
        const known = dtoKeys(dto);
        expect(sent.filter((k) => !known.has(k))).toEqual([]);
      });
    }

    it('임상 검토 승인·반려 두 화면(자동매핑 대시보드·매핑 검토)의 notes 를 모두 안다', () => {
      const known = dtoKeys(MappingReviewNotesDto);
      for (const file of ['apps/web/src/app/(main)/admin/codes/auto-mapping-dashboard.tsx', 'apps/web/src/app/(main)/mapping-review/page.tsx']) {
        const src = read(file);
        for (const verb of ['approve', 'reject']) {
          const anchor = `apiClient.post(\`/api/v1/codes/clinical-review/\${id}/${verb}\`, `;
          const keys = anchorPositions(src, anchor).flatMap((p) => literalKeysFrom(src, p + anchor.length));
          expect(keys).toEqual(['notes']);
          expect(keys.filter((k) => !known.has(k))).toEqual([]);
        }
      }
    });

    it('대조군 — 화면이 보내는 실제 모양이 통과한다', async () => {
      await expect(ok({ nurseId: U, admissionId: U2 }, AssignNursePatientDto)).resolves.toBeTruthy();
      await expect(ok({ isActive: false }, SetStationActiveDto)).resolves.toMatchObject({ isActive: false });
      await expect(ok({ reason: '법무 검토 완료', checklist: { mappingVerified: true } }, ApproveCutoverDto)).resolves.toBeTruthy();
      await expect(ok({ admissionId: U, assessment: '안정', plan: '', roundType: 'MORNING' }, QuickRoundDto)).resolves.toBeTruthy();
      await expect(ok({ type: 'CONSULTATION_REQUEST', patientId: U, encounterId: undefined, toDepartment: '내과', urgency: 'ROUTINE' }, GenerateReferralLetterDto)).resolves.toBeTruthy();
      await expect(ok({ distributorId: U, supplyPrice: undefined, recipientEmail: undefined, idempotencyKey: `send-${U}-${U2}` }, SendBatchToDealerDto)).resolves.toBeTruthy();
      await expect(ok({ activationCodes: ['ABCD-EFGH-1234'] }, ConfirmReceiptDto)).resolves.toBeTruthy();
      await expect(ok({ months: 6 }, SeedFormularyFromUsageDto)).resolves.toBeTruthy();
      await expect(ok({ domain: 'LAB', name: '당뇨 검사', items: [{ category: 'A', items: [{ codeId: U, code: 'C1', label: 'HbA1c' }] }], aiGenerated: true }, CreateFormularyListDto)).resolves.toBeTruthy();
      await expect(ok({ selectedCode: '59621000', notes: undefined }, ConfirmPendingMappingDto)).resolves.toBeTruthy();
      await expect(ok({ patientId: U, doctorId: undefined, departmentName: '내과', visitType: 'INITIAL', reason: undefined, type: 'WALK_IN' }, QueueCheckInDto)).resolves.toBeTruthy();
      await expect(ok({ type: 'recall', language: 'en' }, OutreachDraftDto)).resolves.toBeTruthy();
      await expect(ok({ ids: [SEED_UUID, U] }, NormalizeApplyDto)).resolves.toBeTruthy();
      await expect(ok({ admissionId: U, patientId: U2, kind: 'ENTERAL', route: undefined, targetCalories: 1500, volumeMl: 1000, rateMlHr: 60 }, CreateSpecialNutritionDto)).resolves.toBeTruthy();
      await expect(ok({ admissionId: U, patientId: U2, mealOrderId: U, mealType: 'LUNCH', date: '2026-09-15', intakePercent: 75, leftoverPercent: 25, trayCollected: true, refusalReason: undefined }, RecordMealIntakeDto)).resolves.toBeTruthy();
      await expect(ok({ name: 'W', targetUrl: 'https://erp.example/hook', events: ['*'], format: 'SLACK' }, CreateHisWebhookDto)).resolves.toBeTruthy();
      await expect(ok({ hospitalCourse: '호전' }, UpdateDischargeSummaryDto)).resolves.toBeTruthy();
      await expect(ok({}, PurgeEmptyDraftsDto)).resolves.toBeTruthy(); // 본문 없으면 dry-run
      await expect(ok({}, ReferralLetterReasonDto)).resolves.toBeTruthy(); // 사유는 강제하지 않는다
    });
  });

  describe('② 🔴 문자열 "false" 는 참이 아니다', () => {
    it('식사 섭취 trayCollected "false" → 400(회수하지 않은 트레이에 회수 시각)', async () => {
      await bad({ admissionId: U, patientId: U2, mealType: 'LUNCH', date: '2026-09-15', intakePercent: 50, trayCollected: 'false' }, RecordMealIntakeDto);
    });
    it('호출 취소 falseAlarm "false" → 400(실제 CODE 에 허위 발신 플래그)', async () => {
      await bad({ falseAlarm: 'false' }, CancelStaffCallDto);
      await expect(ok({ falseAlarm: false }, CancelStaffCallDto)).resolves.toMatchObject({ falseAlarm: false });
    });
    it('체크리스트 aiGenerated "false" → 400(사람이 만든 목록에 AI 생성 표기)', async () => {
      await bad({ domain: 'LAB', name: 'X', items: [], aiGenerated: 'false' }, CreateFormularyListDto);
    });
    it('담당 배정 isPrimary·스테이션 isActive·웹훅 isActive·초안 정리 confirm 의 "false" → 400', async () => {
      await bad({ nurseId: U, admissionId: U2, isPrimary: 'false' }, AssignNursePatientDto);
      await bad({ isActive: 'false' }, SetStationActiveDto);
      await bad({ isActive: 'false' }, UpdateHisWebhookDto);
      await bad({ confirm: 'true' }, PurgeEmptyDraftsDto);
    });
    it('스테이션 활성 본문 없음 → 400(종전: 아무것도 안 바꾸고 성공)', async () => {
      await bad({}, SetStationActiveDto);
    });
  });

  describe('③ 범위·어휘·형식', () => {
    it('섭취율·잔반율은 0~100 정수(150% → 급식 COMPLETED·잔반 -50% 저장이었다)', async () => {
      const base = { admissionId: U, patientId: U2, mealType: 'LUNCH', date: '2026-09-15' };
      await bad({ ...base, intakePercent: 150 }, RecordMealIntakeDto);
      await bad({ ...base, intakePercent: -1 }, RecordMealIntakeDto);
      await bad({ ...base, intakePercent: 50, leftoverPercent: 120 }, RecordMealIntakeDto);
      await bad({ ...base, intakePercent: 50, calories: -100 }, RecordMealIntakeDto);
    });
    it('🔴 딜러 발송 공급단가는 정수·0 이상(음수·소수가 append-only 해시 원장에 박혔다) · 이메일 형식', async () => {
      const base = { distributorId: U, idempotencyKey: 'k1' };
      await bad({ ...base, supplyPrice: -5000 }, SendBatchToDealerDto);
      await bad({ ...base, supplyPrice: 1500.5 }, SendBatchToDealerDto);
      await bad({ ...base, recipientEmail: 'not-an-email' }, SendBatchToDealerDto);
      await bad({ supplyPrice: 0, idempotencyKey: 'k1' }, SendBatchToDealerDto);
    });
    it('수령확인 코드는 문자열 배열(문자열 한 줄이면 글자 단위로 조회를 돌았다)', async () => {
      await bad({ activationCodes: 'ABCD-EFGH' }, ConfirmReceiptDto);
      await bad({ activationCodes: Array.from({ length: 1001 }, (_, i) => `C${i}`) }, ConfirmReceiptDto);
    });
    it('특수영양 주입 속도·용량 음수 → 400 · 종류/상태 어휘(스키마 주석)', async () => {
      await bad({ admissionId: U, patientId: U2, kind: 'ENTERAL', rateMlHr: -10 }, CreateSpecialNutritionDto);
      await bad({ admissionId: U, patientId: U2, kind: 'enteral' }, CreateSpecialNutritionDto);
      await bad({ status: 'STOPPED' }, UpdateSpecialNutritionDto);
      await bad({ volumeMl: 250.5 }, UpdateSpecialNutritionDto);
      await expect(ok({ status: 'DISCONTINUED', endDate: '2026-09-20' }, UpdateSpecialNutritionDto)).resolves.toBeTruthy();
    });
    it('🔴 정규화 적용 id 는 최대 100·uuid(101번째부터 말없이 버렸고 중간 500 은 부분 적용을 남겼다)', async () => {
      await bad({ ids: Array.from({ length: 101 }, () => U) }, NormalizeApplyDto);
      await bad({ ids: [U, 'not-a-uuid'] }, NormalizeApplyDto);
      await bad({ ids: U }, NormalizeApplyDto);
    });
    it('안내 초안 유형 오타 → 400(종전: 조용히 recall 문안)', async () => {
      await bad({ type: 'recal' }, OutreachDraftDto);
    });
    it('웹훅 이벤트는 카탈로그·format 은 RAW|SLACK(오타는 조용히 걸러지거나 RAW 가 됐다)', async () => {
      await bad({ name: 'W', targetUrl: 'https://x.example', events: ['staff.attendance_recorded', 'staff.typo'] }, CreateHisWebhookDto);
      await bad({ name: 'W', targetUrl: 'https://x.example', events: ['*'], format: 'slack' }, CreateHisWebhookDto);
      await bad({ targetUrl: 'https://x.example', events: ['*'] }, CreateHisWebhookDto);
    });
    it('의뢰서 유형 어휘·수정 본문 누락(→ editedByDoctor 만 true)·협진 빈 회신(→ 내용 없는 REPLIED)', async () => {
      await bad({ type: 'REFERRAL', patientId: U, toDepartment: '내과' }, GenerateReferralLetterDto);
      await bad({ type: 'CONSULTATION_REQUEST', patientId: 'P2026-0001', toDepartment: '내과' }, GenerateReferralLetterDto);
      await bad({}, UpdateReferralLetterDto);
      await bad({}, ReplyConsultationDto);
      await bad({ replyContent: '' }, ReplyConsultationDto);
    });
    it('초안 정리 cutoffHours 0·음수·문자열 → 400(방금 연 초안까지 삭제 대상 · NaN 500)', async () => {
      await bad({ confirm: true, cutoffHours: 0 }, PurgeEmptyDraftsDto);
      await bad({ confirm: true, cutoffHours: -24 }, PurgeEmptyDraftsDto);
      await bad({ cutoffHours: 'abc' }, PurgeEmptyDraftsDto);
    });
    it('접수 과 누락 → 400(중복 검사 where 가 전 과가 됐다) · 대기자 희망일·호스피스 상태·매핑 우선순위·처방집 months', async () => {
      await bad({ patientId: U }, QueueCheckInDto);
      await bad({ patientId: U, departmentName: '내과', preferredFrom: '다음주' }, RegisterWaitlistDto);
      await bad({ status: 'DEAD' }, UpdateHospiceStatusDto);
      await bad({ department: '내과', priority: 'URGENT' }, AssignMappingDepartmentDto);
      await bad({ months: 'abc' }, SeedFormularyFromUsageDto);
      await bad({ months: -1 }, SeedFormularyFromUsageDto);
      await bad({ nurseId: U, admissionId: U2, shiftType: 'SWING' }, AssignNursePatientDto);
    });
    it('퇴원요약 수정은 원 클래스 검증을 물려받는다(`Partial<>` 는 통째로 스킵됐다)', async () => {
      await bad({ admitDate: 'garbage' }, UpdateDischargeSummaryDto);
      await bad({ diagnosisCodes: 'I10' }, UpdateDischargeSummaryDto);
    });
    it('매핑 확정 selectedCode 필수(종전: 없으면 첫 후보로 확정)', async () => {
      await bad({ notes: 'x' }, ConfirmPendingMappingDto);
    });
  });

  describe('④ 서비스 실경로', () => {
    const pendingRow = (over: Record<string, unknown> = {}) => ({
      id: 'p-1', status: 'PENDING', clinicalStatus: 'APPROVED', sourceTable: 'diagnosis_codes', sourceId: 's-1', sourceCode: 'I10', targetSystem: 'SNOMED_CT',
      candidates: [
        { targetCode: '59621000', targetDisplay: 'Essential hypertension', confidence: 0.88 },
        { targetCode: '38341003', targetDisplay: 'Hypertensive disorder', confidence: 0.61 },
      ],
      ...over,
    });
    const mapper = () => {
      const prisma = {
        pendingMapping: { findUnique: vi.fn(), update: vi.fn().mockResolvedValue({}), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
        terminologyMapping: { create: vi.fn().mockResolvedValue({ id: 'map-1' }) },
        mappingAuditLog: { create: vi.fn().mockResolvedValue({}) },
        systemConfig: { findUnique: vi.fn().mockResolvedValue(null), upsert: vi.fn() },
        // 🔴 (D1) 확정은 상태 선점(PENDING 조건부) 이 이긴 쪽만 매핑을 만든다 — 트랜잭션 목이 있어야 실경로를 지난다
        $transaction: vi.fn(),
      };
      prisma.$transaction.mockImplementation((fn: (tx: unknown) => unknown) => fn(prisma));
      return { prisma, svc: new AutoMapperService(prisma as never, { reference: vi.fn() } as never) };
    };

    it('🔴 매핑 확정 — 후보에 없는 코드는 첫 후보로 확정하지 않고 400 · 매핑을 만들지 않는다', async () => {
      const { prisma, svc } = mapper();
      prisma.pendingMapping.findUnique.mockResolvedValue(pendingRow());
      await expect(svc.confirmPending('p-1', '99999999', 'admin-1')).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.terminologyMapping.create).not.toHaveBeenCalled();
      expect(prisma.pendingMapping.update).not.toHaveBeenCalled();
    });

    it('대조군 — 두 번째 후보를 고르면 그 코드로 확정된다(첫 후보가 아니다)', async () => {
      const { prisma, svc } = mapper();
      prisma.pendingMapping.findUnique.mockResolvedValue(pendingRow());
      await svc.confirmPending('p-1', '38341003', 'admin-1');
      expect(prisma.terminologyMapping.create.mock.calls[0][0].data.targetCode).toBe('38341003');
    });

    it('🔴 매핑 거부 — 이미 확정(CONFIRMED)된 항목은 409 · 대기(PENDING)만 조건부로 거부된다', async () => {
      const { prisma, svc } = mapper();
      prisma.pendingMapping.updateMany.mockResolvedValue({ count: 0 });
      prisma.pendingMapping.findUnique.mockResolvedValue({ status: 'CONFIRMED' });
      await expect(svc.rejectPending('p-1', 'admin-1', 'x')).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.pendingMapping.updateMany.mock.calls[0][0].where).toEqual({ id: 'p-1', status: 'PENDING' });
      expect(prisma.pendingMapping.update).not.toHaveBeenCalled();

      const b = mapper();
      b.prisma.pendingMapping.updateMany.mockResolvedValue({ count: 1 });
      b.prisma.pendingMapping.findUnique.mockResolvedValue(pendingRow({ status: 'REJECTED' }));
      await expect(b.svc.rejectPending('p-1', 'admin-1', 'x')).resolves.toMatchObject({ status: 'REJECTED' });
    });

    it('🔴 컷오버 승인 원장에는 정본 체크리스트 키의 확인 여부만 남는다(본문 객체 통째 저장 금지)', async () => {
      const config = { set: vi.fn().mockResolvedValue(undefined), get: vi.fn() };
      const prisma = { auditLog: { create: vi.fn().mockResolvedValue({}) } };
      const svc = new Phase0CutoverService(prisma as never, config as never);
      const checklist: Record<string, unknown> = Object.fromEntries(CUTOVER_CHECKLIST.map((c) => [c.key, true]));
      checklist.injected = '<임의 값>';
      await svc.approve(U, '관리자', { reason: '법무 검토', checklist: checklist as Record<string, boolean> });
      const saved = config.set.mock.calls.find((c) => c[0] === 'integration.cutoverApproval')![1] as { checklist: Record<string, unknown> };
      expect(Object.keys(saved.checklist).sort()).toEqual(CUTOVER_CHECKLIST.map((c) => c.key).sort());
      expect(Object.values(saved.checklist).every((v) => v === true)).toBe(true);
    });

    it('대조군 — 체크리스트 한 항목이라도 true 가 아니면 승인 거부(기존 규칙 유지)', async () => {
      const config = { set: vi.fn(), get: vi.fn() };
      const svc = new Phase0CutoverService({ auditLog: { create: vi.fn() } } as never, config as never);
      const checklist = Object.fromEntries(CUTOVER_CHECKLIST.map((c, i) => [c.key, i === 0 ? 'true' : true]));
      await expect(svc.approve(U, '관리자', { reason: 'r', checklist: checklist as never })).rejects.toBeInstanceOf(BadRequestException);
      expect(config.set).not.toHaveBeenCalled();
    });

    it('🔴 퇴원요약 — 바꿀 항목 없는 수정은 서명본을 AMENDED 로 뒤집지 않는다 · 항목이 있으면 AMENDED(대조군)', async () => {
      // 2026-10-03: 서명본 정정은 직전 서명본 보존과 한 트랜잭션 — 목이 그 모양을 갖는다
      const prisma: any = {
        dischargeSummary: { findUnique: vi.fn().mockResolvedValue({ id: 'ds', admissionId: U, status: 'SIGNED', hospitalCourse: '입원 중', admission: { patientId: 'p' } }), update: vi.fn().mockResolvedValue({}) },
        signedRecordVersion: { create: vi.fn().mockResolvedValue({}) },
      };
      prisma.$transaction = vi.fn().mockImplementation((fn: (tx: unknown) => unknown) => fn(prisma));
      const svc = new DischargeSummaryService(prisma as never, {} as never);
      await expect(svc.update(U, {})).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.dischargeSummary.update).not.toHaveBeenCalled();
      await svc.update(U, { hospitalCourse: '호전' });
      expect(prisma.dischargeSummary.update.mock.calls[0][0].data).toMatchObject({ hospitalCourse: '호전', status: 'AMENDED' });
    });

    describe('🔴 특수영양 시작일 — @db.Date 는 KST 달력 날짜의 UTC 자정(종전 new Date() 는 KST 00~09시에 전날)', () => {
      afterEach(() => vi.useRealTimers());
      const svc = () => {
        // 🔴 (2026-09-16 K2) 정본이 **이전 활성 처방을 닫고** 트랜잭션 안에서 만든다 —
        //    목이 그 모양을 갖지 않으면 이 테스트는 계약이 아니라 목을 검사한다.
        const prisma: Record<string, unknown> = {
          specialNutritionOrder: {
            create: vi.fn().mockImplementation((a: { data: unknown }) => a.data),
            update: vi.fn().mockImplementation((a: { data: unknown }) => a.data),
            updateMany: vi.fn().mockResolvedValue({ count: 0 }),
          },
        };
        prisma.$transaction = vi.fn().mockImplementation((fn: (tx: unknown) => unknown) => fn(prisma));
        return { prisma: prisma as { specialNutritionOrder: { create: { mock: { calls: { 0: { 0: { data: unknown } } } } } } } & Record<string, unknown>, s: new NutritionAdvancedService(prisma as never, {} as never) };
      };

      it('시작일 미지정 → 오늘(병원 달력) 날짜의 자정 값 · 시각이 붙지 않는다', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-09-15T17:30:00.000Z')); // KST 09-16 02:30
        const { prisma, s } = svc();
        await s.createSpecialNutrition({ admissionId: U, patientId: U2, kind: 'ENTERAL' }, U);
        const saved = prisma.specialNutritionOrder.create.mock.calls[0][0].data as { startDate: Date; endDate: Date | null };
        expect(saved.startDate.toISOString()).toBe(todayDateOnly().toISOString());
        expect(saved.startDate.toISOString().endsWith('T00:00:00.000Z')).toBe(true);
        expect(saved.endDate).toBeNull();
      });

      it('날짜 문자열은 그 날짜 그대로 · 형식 오류는 400(종전 Prisma 500)', async () => {
        const { prisma, s } = svc();
        await s.createSpecialNutrition({ admissionId: U, patientId: U2, kind: 'PARENTERAL', startDate: '2026-09-15', endDate: '2026-09-22' }, U);
        const saved = prisma.specialNutritionOrder.create.mock.calls[0][0].data as { startDate: Date; endDate: Date };
        expect(saved.startDate.toISOString()).toBe('2026-09-15T00:00:00.000Z');
        expect(saved.endDate.toISOString()).toBe('2026-09-22T00:00:00.000Z');
        await expect(s.createSpecialNutrition({ admissionId: U, patientId: U2, kind: 'ENTERAL', startDate: '다음주' }, U)).rejects.toBeInstanceOf(BadRequestException);
        await expect(s.updateSpecialNutrition(U, { endDate: '2026-02-30' })).rejects.toBeInstanceOf(BadRequestException);
      });
    });
  });
});
