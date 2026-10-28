/**
 * 🔴 (2026-09-15 B9) 인라인 @Body 9차 배치 31 핸들러(임상경로 6·MDT 6·워크스테이션 6·암등록 5·치료일정 템플릿 4·재활 2·자격조회 2) → class DTO 계약.
 * 지키는 것(main.ts 전역 파이프 옵션 그대로):
 *  ① 대조군 — 화면이 **실제로 보내는 키**는 DTO 가 모두 안다(소스에서 키를 뽑아 기계 대조 — whitelist 조용한 삭제 방지)
 *  ② 🔴 문자열 "false" 가 참으로 읽혀 안전장치를 켜고 끄던 자리 — 재활 안전게이트 `overrideGate`·영상 안전게이트
 *     `overrideSafety`·치료일정 항목 `cancel`/`shiftFollowing`(미결 사전처방 동반 취소·일괄 이동)·반복 오더·참석·필수 마일스톤·재발 여부
 *  ③ 🔴 행위자 — 임상경로 마일스톤 결과의 시행자(`performedBy`)는 본문이 아니라 로그인 사용자다(컨트롤러→서비스 실경로)
 *  ④ 형식 — 날짜·uuid·길이 오류는 Prisma 500 이 아니라 400
 */
import 'reflect-metadata';
import { ArgumentMetadata, BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { bodyMeta, dtoKeys, literalKeys, literalKeysFrom, anchorPositions, pipe, read } from './dto-contract-helpers';
import {
  AddCancerFollowUpDto, AddCancerTreatmentDto, CreateCancerRegistryDto,
} from '../../src/modules/cancer-registry/dto/cancer-registry-write.dto';
import {
  AddMdtAttendeeDto, AddMdtCaseDto, CreateMdtConferenceDto, UpdateMdtAttendeeDto, UpdateMdtCaseDto, UpdateMdtConferenceDto,
} from '../../src/modules/mdt/dto/mdt-write.dto';
import {
  AssignPathwayDto, CreateMilestoneDto, CreatePathwayDto, RecordMilestoneOutcomeDto, UpdateMilestoneDto,
} from '../../src/modules/clinical-pathway/dto/clinical-pathway-write.dto';
import { StartRehabSessionDto, GenerateRehabSessionsDto } from '../../src/modules/rehab/dto/rehab.dto';
import {
  AcquireImagingDto, CreateLabTemplateDto, CreateTherapyOrderDto, ReportImagingDto, UpdateLabTemplateDto,
} from '../../src/modules/workstation/dto/workstation-write.dto';
import { CheckEligibilityDto, VerifyIdentityDto } from '../../src/modules/eligibility/dto/eligibility-write.dto';
import {
  ApplyTreatmentTemplateDto, CreateTreatmentTemplateDto, TemplateItemInputDto, UpdateScheduleItemDto,
} from '../../src/modules/treatment-template/dto/treatment-template-write.dto';
import { ClinicalPathwayController } from '../../src/modules/clinical-pathway/clinical-pathway.controller';
import { ClinicalPathwayService } from '../../src/modules/clinical-pathway/clinical-pathway.service';

const bad = (v: unknown, t: ArgumentMetadata['metatype']) => expect(pipe.transform(v, bodyMeta(t))).rejects.toBeInstanceOf(BadRequestException);
const ok = (v: unknown, t: ArgumentMetadata['metatype']) => pipe.transform(v, bodyMeta(t)) as Promise<Record<string, unknown>>;
const U = '11111111-1111-4111-8111-111111111111';
const U2 = '22222222-2222-4222-8222-222222222222';

describe('B9 요청 본문 DTO 계약', () => {
  describe('① 화면이 보내는 키를 DTO 가 모두 안다(whitelist 조용한 삭제 방지)', () => {
    const CR = 'apps/web/src/app/(main)/cancer-registry/page.tsx';
    const MDT = 'apps/web/src/app/(main)/mdt/page.tsx';
    const CP = 'apps/web/src/app/(main)/clinical-pathway/page.tsx';
    const cases: Array<[string, string, string[], new () => object]> = [
      [CR, 'const EMPTY_REGISTRY_FORM: NewRegistryForm = ', ['patientId', 'diagnosisDate', 'primarySite', 'morphology', 'behavior', 'grade', 'laterality', 'diagnosisBasis', 'icdCode', 'tnmClinical', 'tnmPathological'], CreateCancerRegistryDto],
      [CR, '/treatments`, ', ['treatmentType', 'startDate', 'endDate', 'regimen', 'response'], AddCancerTreatmentDto],
      [CR, '/follow-ups`, ', ['followUpDate', 'status', 'recurrence', 'metastasisSite', 'performanceStatus', 'note'], AddCancerFollowUpDto],
      [MDT, 'const [form, setForm] = useState<ConferenceFormData>(', ['title', 'conferenceType', 'department', 'scheduledAt', 'location'], CreateMdtConferenceDto],
      [MDT, 'const [editConfForm, setEditConfForm] = useState<ConferenceFormData>(', ['title', 'conferenceType', 'department', 'scheduledAt', 'location'], UpdateMdtConferenceDto],
      [MDT, 'useState<CaseFormData>(', ['patientId', 'primaryDiag', 'tnmStage', 'proposedPlan'], AddMdtCaseDto],
      [MDT, 'useState<AttendeeFormData>(', ['userId', 'department', 'role'], AddMdtAttendeeDto],
      [MDT, 'useState<DecisionFormData>(', ['decision', 'decisionCategory'], UpdateMdtCaseDto],
      [MDT, '/api/v1/mdt/attendees/${id}`, ', ['attended'], UpdateMdtAttendeeDto],
      [CP, 'createPathway.mutate(', ['code', 'name', 'department', 'targetDrg', 'totalDays', 'description'], CreatePathwayDto],
      [CP, 'createMilestone.mutate(', ['day', 'category', 'title', 'isRequired'], CreateMilestoneDto],
      [CP, 'assignPathway.mutate(', ['patientId', 'encounterId', 'startDate'], AssignPathwayDto],
      [CP, 'assignmentId: outcomeModal.assignmentId,', ['milestoneId', 'outcome', 'note'], RecordMilestoneOutcomeDto],
      ['apps/web/src/app/(main)/workstation/imaging/page.tsx', 'acquire.mutate({ orderId: acquireTarget.orderId, body: ', ['quality', 'modality', 'bodyPart', 'dlp', 'ctdiVol', 'doseAreaProduct', 'effectiveDoseMsv'], AcquireImagingDto],
      ['apps/web/src/app/tablet/workstation/page.tsx', '/acquired`, { method: \'PATCH\', body: JSON.stringify(', ['notes'], AcquireImagingDto],
      ['apps/web/src/app/(main)/workstation/reading/page.tsx', 'const [form, setForm] = useState(', ['finding', 'conclusion', 'recommendation'], ReportImagingDto],
      ['apps/web/src/app/(main)/workstation/templates/page.tsx', 'const [form, setForm] = useState(', ['procedureCode', 'testName', 'stationId', 'items'], CreateLabTemplateDto],
      ['apps/web/src/app/(main)/workstation/templates/page.tsx', 'const [form, setForm] = useState(', ['procedureCode', 'testName', 'stationId', 'items'], UpdateLabTemplateDto],
      ['apps/web/src/app/(main)/workstation/lab/page.tsx', "apiClient.post('/api/v1/workstation/templates', ", ['procedureCode', 'testName', 'stationId', 'items'], CreateLabTemplateDto],
      ['apps/web/src/components/workstation/PatientAddModal.tsx', "'/api/v1/workstation/therapy/orders', ", ['encounterId', 'therapyType', 'stationId', 'scheduledDate', 'scheduledTime', 'instructions'], CreateTherapyOrderDto],
      ['apps/web/src/app/(main)/reception/components/EligibilityVerifyModal.tsx', "'/api/v1/eligibility/check', ", ['patientId', 'visitType', 'queueId'], CheckEligibilityDto],
      ['apps/web/src/app/(main)/patients/[id]/components/TreatmentScheduleTab.tsx', 'itemMut.mutate({ itemId, body: ', ['plannedAt', 'reason', 'shiftFollowing'], UpdateScheduleItemDto],
      ['apps/web/src/app/(main)/admin/treatment-templates/page.tsx', 'const body = ', ['name', 'department', 'description', 'totalDays', 'items'], CreateTreatmentTemplateDto],
      ['apps/web/src/app/(main)/admin/treatment-templates/page.tsx', 'setItems(prev => [...prev, ', ['dayOffset', 'itemType', 'title', 'isDefault'], TemplateItemInputDto],
    ];
    for (const [file, anchor, expected, dto] of cases) {
      it(`${file.split('/').slice(-2).join('/')} ${anchor.slice(0, 40)} → ${dto.name}`, () => {
        const sent = literalKeys(read(file), anchor);
        // 추출기 자체 대조군 — 알려진 키를 실제로 뽑았는가(추출이 비면 아래 검사는 증거가 아니다)
        expect([...sent].sort()).toEqual([...expected].sort());
        const known = dtoKeys(dto);
        expect(sent.filter((k) => !known.has(k))).toEqual([]);
      });
    }

    it('본인확인 두 경로(일치·불일치)의 키를 모두 안다', () => {
      const src = read('apps/web/src/app/(main)/reception/components/EligibilityVerifyModal.tsx');
      const anchor = "'/api/v1/eligibility/verify-identity', ";
      const pos = anchorPositions(src, anchor);
      expect(pos.length).toBe(2);
      const known = dtoKeys(VerifyIdentityDto);
      const all = pos.flatMap((p) => literalKeysFrom(src, p + anchor.length));
      expect(new Set(all)).toEqual(new Set(['patientId', 'method', 'queueId', 'exceptionReason', 'verifiedItems', 'result', 'failureReason']));
      expect(all.filter((k) => !known.has(k))).toEqual([]);
    });

    it('대조군 — 화면이 보내는 실제 모양이 통과한다', async () => {
      await expect(ok({ patientId: U, diagnosisDate: '2026-09-01', primarySite: '', morphology: '', behavior: '', grade: '', laterality: '', diagnosisBasis: '', icdCode: '', tnmClinical: '', tnmPathological: '' }, CreateCancerRegistryDto)).resolves.toBeTruthy();
      await expect(ok({ followUpDate: '2026-09-10', status: 'NED', recurrence: false, note: undefined }, AddCancerFollowUpDto)).resolves.toBeTruthy();
      await expect(ok({ title: 'T', conferenceType: 'TUMOR_BOARD', department: '외과', scheduledAt: '2026-09-16T10:00', location: '' }, CreateMdtConferenceDto)).resolves.toBeTruthy();
      await expect(ok({ title: '', conferenceType: 'TUMOR_BOARD', department: '', scheduledAt: '', location: '' }, UpdateMdtConferenceDto)).resolves.toBeTruthy();
      await expect(ok({ decision: '', decisionCategory: '' }, UpdateMdtCaseDto)).resolves.toBeTruthy();
      await expect(ok({ milestoneId: U, outcome: 'DONE', note: '' }, RecordMilestoneOutcomeDto)).resolves.toBeTruthy();
      await expect(ok({ encounterId: U, therapyType: '운동치료', stationId: 'rehab-pt', scheduledDate: '2026-09-15', scheduledTime: '14:05', instructions: '워크인 치료' }, CreateTherapyOrderDto)).resolves.toBeTruthy();
      await expect(ok({ procedureCode: 'CBC_X', testName: 'CBC', stationId: 'lab-hematology', items: [{ name: 'WBC', unit: '', refRange: '', decimalPlaces: 0 }] }, CreateLabTemplateDto)).resolves.toBeTruthy();
      // 수정 폼은 서버가 준 항목을 그대로 되돌려 보낸다(id·templateId 등 — whitelist 가 지우고 null 칸은 통과)
      const echoed = await ok({ name: 'X', totalDays: 28, items: [{ id: U, templateId: U2, dayOffset: 0, timeOfDay: null, itemType: 'VISIT', title: '외래', refCodeId: null, repeatEvery: null, repeatCount: null, isDefault: true, notes: null, sortOrder: 0 }] }, CreateTreatmentTemplateDto);
      expect((echoed.items as Array<Record<string, unknown>>)[0]).not.toHaveProperty('templateId');
      await expect(ok({ patientId: U, method: 'TWO_IDENTIFIER', verifiedItems: { name: true, dob: false }, result: 'FAIL', failureReason: '생년월일 불일치' }, VerifyIdentityDto)).resolves.toBeTruthy();
      await expect(ok({}, StartRehabSessionDto)).resolves.toBeTruthy(); // 화면은 본문 없이 시작한다
    });
  });

  describe('② 🔴 문자열 "false" 는 참이 아니다 — 안전게이트·취소를 켜던 자리는 400', () => {
    it('재활 세션 시작 overrideGate "false" → 400 · 진짜 불리언은 통과', async () => {
      await bad({ overrideGate: 'false' }, StartRehabSessionDto);
      await expect(ok({ overrideGate: true, overrideReason: '보호자 동의' }, StartRehabSessionDto)).resolves.toMatchObject({ overrideGate: true });
    });
    it('영상 촬영 overrideSafety "false" → 400 · 선량 문자열 → 400', async () => {
      await bad({ overrideSafety: 'false' }, AcquireImagingDto);
      await bad({ dlp: '120' }, AcquireImagingDto);
      await expect(ok({ overrideSafety: false, dlp: 120 }, AcquireImagingDto)).resolves.toBeTruthy();
    });
    it('치료일정 항목 cancel "false"·shiftFollowing "false" → 400', async () => {
      await bad({ cancel: 'false', reason: 'x' }, UpdateScheduleItemDto);
      await bad({ plannedAt: '2026-09-20T09:00:00+09:00', shiftFollowing: 'false' }, UpdateScheduleItemDto);
      await expect(ok({ cancel: true, reason: '환자 요청' }, UpdateScheduleItemDto)).resolves.toBeTruthy();
    });
    it('반복 치료 오더·참석·필수 마일스톤·재발 여부의 "false" → 400', async () => {
      await bad({ encounterId: U, therapyType: 'PT', stationId: 's', scheduledDate: '2026-09-15', isRecurring: 'false' }, CreateTherapyOrderDto);
      await bad({ userId: U, department: '외과', role: 'PANELIST', attended: 'false' }, AddMdtAttendeeDto);
      await bad({ attended: 'false' }, UpdateMdtAttendeeDto);
      await bad({ day: 1, category: 'LAB', title: 't', isRequired: 'false' }, CreateMilestoneDto);
      await bad({ isRequired: 'false' }, UpdateMilestoneDto);
      await bad({ followUpDate: '2026-09-10', status: 'NED', recurrence: 'false' }, AddCancerFollowUpDto);
    });
  });

  describe('③ 🔴 임상경로 결과 시행자는 로그인 사용자다(본문 performedBy 무효)', () => {
    it('DTO 가 performedBy 를 지운다', async () => {
      const out = await ok({ milestoneId: U, status: 'DONE', performedBy: U2 }, RecordMilestoneOutcomeDto);
      expect(out).not.toHaveProperty('performedBy');
    });

    it('컨트롤러→서비스 실경로: 저장되는 performedBy 는 로그인 사용자 id', async () => {
      const upsert = vi.fn().mockResolvedValue({ id: 'o1', status: 'DONE' });
      const prisma = {
        pathwayAssignment: { findUnique: vi.fn().mockResolvedValue({ id: 'a1', pathwayId: 'pw', status: 'ACTIVE', startDate: new Date('2026-09-01') }), update: vi.fn() },
        pathwayMilestone: { findUnique: vi.fn().mockResolvedValue({ pathwayId: 'pw' }), findMany: vi.fn().mockResolvedValue([]) },
        milestoneOutcome: { findUnique: vi.fn().mockResolvedValue(null), upsert, count: vi.fn().mockResolvedValue(0) },
        // 🔴 (I2) 정본이 결과·이탈 카운트·완료 판정을 한 트랜잭션에서 쓴다 — 목도 같은 호출 모양을 준다
        $transaction: vi.fn(async (arg: any) => (typeof arg === 'function' ? arg(prisma) : Promise.all(arg))),
      };
      const ctrl = new ClinicalPathwayController(new ClinicalPathwayService(prisma as never));
      const body = await ok({ milestoneId: U, status: 'DONE', performedBy: U2 }, RecordMilestoneOutcomeDto);
      await ctrl.recordOutcome('a1', body as unknown as RecordMilestoneOutcomeDto, 'me-user');
      const arg = upsert.mock.calls[0][0] as { create: { performedBy: unknown }; update: { performedBy: unknown } };
      expect(arg.create.performedBy).toBe('me-user');
      expect(arg.update.performedBy).toBe('me-user');
    });
  });

  describe('④ 형식 오류는 400(Prisma 500 아님)', () => {
    it('날짜·uuid·길이', async () => {
      await bad({ patientId: 'not-uuid', diagnosisDate: '2026-09-01' }, CreateCancerRegistryDto);
      await bad({ patientId: U, diagnosisDate: '어제' }, CreateCancerRegistryDto);
      await bad({ patientId: U, diagnosisDate: '2026-09-01', primarySite: 'C18.0-TOO-LONG' }, CreateCancerRegistryDto);
      await bad({ treatmentType: 'CHEMO', startDate: '' }, AddCancerTreatmentDto);
      await bad({ title: 'T', conferenceType: 'TB', department: 'd', scheduledAt: 'soon' }, CreateMdtConferenceDto);
      await bad({ patientId: U, encounterId: U, startDate: '' }, AssignPathwayDto);
      await bad({ code: 'C', name: 'n', department: 'd', totalDays: '7' }, CreatePathwayDto);
      await bad({ planId: U, startDate: '2026-09-15', weeks: 0 }, GenerateRehabSessionsDto);
      await bad({ patientId: U, visitType: 'ER' }, CheckEligibilityDto);
      await bad({ patientId: U, method: 'X'.repeat(21) }, VerifyIdentityDto);
      await bad({ patientId: U, anchorDate: '2026-09-15T00:00:00Z' }, ApplyTreatmentTemplateDto);
      await bad({ procedureCode: 'C', testName: 't', stationId: 's', items: [{ unit: 'g' }] }, CreateLabTemplateDto);
    });
  });
});
