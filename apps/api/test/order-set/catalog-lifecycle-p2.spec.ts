/**
 * 임상 규칙·템플릿 P2 — 카탈로그 생애주기 정본(2026-10-21 · `clinical-rules-templates-review-2026-10.plan.md` A3).
 *  · 🔴 사용 중(ACTIVE) 내용 수정 = 새 판 초안(사용 중 판은 그대로) · 같은 계보 열린 초안이 있으면 409 · 진단 연결·연령군·금기까지 옮긴다
 *  · 승인 대기·승인됨 수정 = 초안으로 되돌리고 승인 기록을 지운다 · 초안·사용 여부만은 제자리
 *  · 🔴 사용 중으로 바꾼 사람이 승인 기록이 된다(이미 있으면 그대로) · 같은 계보 사용 중은 하나(이전 판 폐기) · 초안으로 가면 승인 지움
 *  · 승인 기록 남기기 — 사용 중·승인 없음만 · 데이터를 승인된 것으로 바꾸지 않는다(기록하는 사람이 승인자)
 *  · 약속처방·치료일정 템플릿이 같은 정본(shared catalog-lifecycle)을 쓴다(구조 가드)
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, vi } from 'vitest';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { catalogEditMode, catalogTransitionAllowed } from '@hospital-run/shared';
import { OrderSetService } from '../../src/modules/order-set/order-set.service';
import { TreatmentTemplateService } from '../../src/modules/treatment-template/treatment-template.service';
import { ApprovalRecordDto } from '../../src/modules/order-set/dto/order-set.dto';

const SET = (o: Record<string, unknown> = {}) => ({
  id: 'os-1', name: 'CP 폐렴', version: 1, parentId: null, status: 'ACTIVE', approvedBy: null, code: 'CP-1', department: '내과', category: 'DISEASE',
  diagnosisCode: 'J18', description: null, applicableTo: null, ageGroup: 'ADULT', contraindications: [{ note: '임부' }], evidenceLevel: null, guidelineRef: null,
  items: [{ type: 'MEDICATION', name: 'AMX', medicationCodeId: 'm1' }], isShared: true, ...o,
});

function cp(row: Record<string, unknown>, lineage: Array<{ id: string; version: number; status: string }> = [{ id: 'os-1', version: 1, status: 'ACTIVE' }]) {
  const prisma: any = {
    orderSet: {
      findUnique: vi.fn(async () => row),
      findMany: vi.fn(async (a: { select?: { status?: boolean } }) => lineage.filter((l) => !(a as any).where?.id?.not || l.id !== (a as any).where.id.not).filter((l) => !(a as any).where?.status || l.status === (a as any).where.status)),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'os-new', ...data })),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ ...row, ...data })),
      updateMany: vi.fn(async () => ({ count: 1 })),
      findUniqueOrThrow: vi.fn(async () => row),
    },
    orderSetDiagnosis: { findMany: vi.fn(async () => [{ id: 'd1', orderSetId: 'os-1', diagnosisCode: 'J18', matchType: 'EXACT', role: 'ANY', weight: 100 }]), createMany: vi.fn(async () => ({})) },
    pathwayMilestone: { count: vi.fn(async () => 2) },
  };
  prisma.$transaction = vi.fn(async (fn: (t: unknown) => unknown) => fn(prisma));
  return { svc: new OrderSetService(prisma), prisma };
}

describe('정본 표', () => {
  it('수정 방식 — 사용 중 새 판 · 승인 대기·승인됨 초기화 · 초안·폐기 제자리', () => {
    expect(catalogEditMode('ACTIVE')).toBe('NEW_VERSION');
    expect(catalogEditMode('APPROVED')).toBe('RESET_APPROVAL');
    expect(catalogEditMode('PENDING_APPROVAL')).toBe('RESET_APPROVAL');
    expect(catalogEditMode('DRAFT')).toBe('IN_PLACE');
    expect(catalogTransitionAllowed('DRAFT', 'ACTIVE')).toBe(true);
    expect(catalogTransitionAllowed('DEPRECATED', 'ACTIVE')).toBe(false);
  });
  it('🔴 구조 가드 — 두 서비스가 자기 전이 표를 두지 않는다', () => {
    for (const f of ['order-set/order-set.service.ts', 'treatment-template/treatment-template.service.ts']) {
      const src = readFileSync(join(__dirname, '../../src/modules', f), 'utf8');
      expect(src, f).not.toMatch(/const STATUS_TRANSITIONS/);
      expect(src, f).toMatch(/catalogTransitionAllowed\(/);
      expect(src, f).toMatch(/catalogEditMode\(/);
    }
  });
});

describe('🔴 약속처방 수정', () => {
  it('사용 중 → 새 판 초안(사용 중 판은 그대로) · 다음 번호 · 진단 연결·연령군·금기 옮김 · 바꾼 항목 반영', async () => {
    const { svc, prisma } = cp(SET(), [{ id: 'os-1', version: 1, status: 'ACTIVE' }, { id: 'os-old', version: 3, status: 'DEPRECATED' }]);
    const r = await svc.update('os-1', { items: [{ type: 'MEDICATION', name: 'AMX2', medicationCodeId: 'm2' }] }, 'doc-1') as any;
    expect(prisma.orderSet.update).not.toHaveBeenCalled();
    const data = prisma.orderSet.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ status: 'DRAFT', version: 4, parentId: 'os-1', name: 'CP 폐렴 (v4)', ageGroup: 'ADULT', contraindications: [{ note: '임부' }], createdBy: 'doc-1' });
    expect(data.items).toEqual([{ type: 'MEDICATION', name: 'AMX2', medicationCodeId: 'm2' }]);
    expect(prisma.orderSetDiagnosis.createMany.mock.calls[0][0].data).toEqual([{ diagnosisCode: 'J18', matchType: 'EXACT', role: 'ANY', weight: 100, orderSetId: 'os-new' }]);
    expect(r).toMatchObject({ editMode: 'NEW_VERSION', newVersionOf: 'os-1' });
  });
  it('같은 계보에 열린 초안이 있으면 409(그 초안을 고친다)', async () => {
    const { svc } = cp(SET(), [{ id: 'os-1', version: 1, status: 'ACTIVE' }, { id: 'os-d', version: 2, status: 'DRAFT' }]);
    await expect(svc.update('os-1', { name: 'x' }, 'u')).rejects.toMatchObject({ response: { code: 'ORDER_SET_DRAFT_EXISTS', details: { draftId: 'os-d' } } });
  });
  it('승인됨 수정 → 초안 · 승인 기록 지움 · 초안은 제자리 · 사용 여부만은 제자리', async () => {
    const a = cp(SET({ status: 'APPROVED', approvedBy: 'adm' }));
    await a.svc.update('os-1', { name: 'n' }, 'u');
    // 🔴 상태는 DB 가 대조한다(where 에 현재 상태)
    expect(a.prisma.orderSet.updateMany.mock.calls[0][0]).toMatchObject({ where: { id: 'os-1', status: 'APPROVED' }, data: { status: 'DRAFT', approvedBy: null, approvedAt: null, name: 'n' } });
    const d = cp(SET({ status: 'DRAFT' }));
    expect(await d.svc.update('os-1', { name: 'n' }, 'u')).toMatchObject({ editMode: 'IN_PLACE' });
    const act = cp(SET());
    await act.svc.update('os-1', { isActive: false }, 'u');
    expect(act.prisma.orderSet.create).not.toHaveBeenCalled();
    expect(act.prisma.orderSet.updateMany.mock.calls[0][0].data).toEqual({ isActive: false });
  });
  it('이름 고유값 충돌은 409(500 아님)', async () => {
    const { svc, prisma } = cp(SET());
    prisma.orderSet.create.mockRejectedValue(Object.assign(new Error('u'), { code: 'P2002' }));
    await expect(svc.update('os-1', { name: '다른 세트' }, 'u')).rejects.toMatchObject({ response: { code: 'ORDER_SET_NAME_TAKEN' } });
  });
});

describe('🔴 약속처방 상태', () => {
  it('초안 → 사용 중: 바꾼 사람이 승인 기록 · 같은 계보 이전 사용 중 판 폐기(한 트랜잭션) · 이전 판을 가리키는 경로 수', async () => {
    const { svc, prisma } = cp(SET({ id: 'os-2', status: 'DRAFT', parentId: 'os-1', version: 2 }), [{ id: 'os-1', version: 1, status: 'ACTIVE' }, { id: 'os-2', version: 2, status: 'DRAFT' }]);
    const r = await svc.changeStatus('os-2', 'ACTIVE', 'adm-1') as any;
    expect(prisma.orderSet.updateMany.mock.calls[0][0]).toMatchObject({ where: { id: 'os-2', status: 'DRAFT' }, data: { status: 'ACTIVE', approvedBy: 'adm-1' } });
    expect(prisma.orderSet.updateMany).toHaveBeenCalledWith({ where: { id: { in: ['os-1'] }, status: 'ACTIVE' }, data: { status: 'DEPRECATED' } });
    expect(prisma.$transaction).toHaveBeenCalled();
    expect(r).toMatchObject({ supersededIds: ['os-1'], pathwayLinksToSuperseded: 2 });
  });
  it('이미 승인됐으면 승인자 그대로 · 초안으로 가면 승인 지움', async () => {
    const a = cp(SET({ status: 'APPROVED', approvedBy: 'committee' }), []);
    await a.svc.changeStatus('os-1', 'ACTIVE', 'adm-2');
    expect(a.prisma.orderSet.updateMany.mock.calls[0][0].data.approvedBy).toBeUndefined();
    const b = cp(SET({ approvedBy: 'x' }));
    await b.svc.changeStatus('os-1', 'DRAFT', 'adm');
    expect(b.prisma.orderSet.updateMany.mock.calls[0][0].data).toMatchObject({ status: 'DRAFT', approvedBy: null, approvedAt: null });
  });
  it('🔴 그 사이 다른 사람이 상태를 바꿨으면(조건부 쓰기 0건) 409 — 두 판을 동시에 사용 중으로 만들지 못한다', async () => {
    const { svc, prisma } = cp(SET({ status: 'DRAFT' }), []);
    prisma.orderSet.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(svc.changeStatus('os-1', 'ACTIVE', 'adm')).rejects.toMatchObject({ response: { code: 'CATALOG_STATUS_RACE' } });
  });
  it('승인 기록 남기기 — 사용 중·승인 없음만 · 기록하는 사람이 승인자', async () => {
    const ok = cp(SET());
    await ok.svc.recordApproval('os-1', 'adm');
    expect(ok.prisma.orderSet.update.mock.calls[0][0].data).toMatchObject({ approvedBy: 'adm' });
    await expect(cp(SET({ status: 'DRAFT' })).svc.recordApproval('os-1', 'adm')).rejects.toMatchObject({ response: { code: 'ORDER_SET_NOT_ACTIVE' } });
    await expect(cp(SET({ approvedBy: 'x' })).svc.recordApproval('os-1', 'adm')).rejects.toMatchObject({ response: { code: 'ORDER_SET_ALREADY_APPROVED' } });
  });
  it('승인 근거는 필수(4자 이상)', () => {
    expect(validateSync(plainToInstance(ApprovalRecordDto, { basis: 'DTC 2026-3' }))).toHaveLength(0);
    expect(validateSync(plainToInstance(ApprovalRecordDto, { basis: 'x' })).length).toBeGreaterThan(0);
  });
});

describe('🔴 치료일정 템플릿 — 같은 정본', () => {
  const TPL = (o: Record<string, unknown> = {}) => ({
    id: 't1', name: '당뇨 12주', version: 1, parentId: null, status: 'ACTIVE', approvedBy: null, department: '내과', description: null, totalDays: 84,
    items: [{ id: 'i1', templateId: 't1', dayOffset: 0, itemType: 'VISIT', title: '초진', refCodeId: null, timeOfDay: null, repeatEvery: null, repeatCount: null, isDefault: true, sortOrder: 0, notes: null }],
    diagnoses: [{ id: 'd1', templateId: 't1', diagnosisCode: 'E11', matchType: 'EXACT', role: 'ANY', weight: 100 }], ...o,
  });
  function tt(row: Record<string, unknown>, lineage = [{ id: 't1', version: 1, status: 'ACTIVE' }]) {
    const prisma: any = {
      treatmentScheduleTemplate: {
        findUnique: vi.fn(async ({ where }: { where: { id: string } }) => (where.id === 't-new' ? { ...row, id: 't-new', status: 'DRAFT' } : row)),
        findMany: vi.fn(async (a: any) => lineage.filter((l) => !a.where?.status || l.status === a.where.status).filter((l) => !a.where?.id?.not || l.id !== a.where.id.not)),
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 't-new', ...data })),
        update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ ...row, ...data })),
        updateMany: vi.fn(async () => ({ count: 1 })),
        findUniqueOrThrow: vi.fn(async () => row),
      },
      treatmentTemplateItem: { createMany: vi.fn(async () => ({})), deleteMany: vi.fn() },
      treatmentTemplateDiagnosis: { createMany: vi.fn(async () => ({})) },
    };
    prisma.$transaction = vi.fn(async (fn: any) => (typeof fn === 'function' ? fn(prisma) : Promise.all(fn)));
    return { svc: new TreatmentTemplateService(prisma), prisma };
  }
  it('사용 중 수정 → 새 판(항목·진단 옮김) · 사용 중 판 그대로', async () => {
    const { svc, prisma } = tt(TPL());
    const r = await svc.update('t1', { description: '개정' }, 'doc') as any;
    expect(prisma.treatmentScheduleTemplate.update).not.toHaveBeenCalled();
    expect(prisma.treatmentScheduleTemplate.updateMany).not.toHaveBeenCalled();
    expect(prisma.$transaction).toHaveBeenCalled(); // 새 판·항목·진단 한 트랜잭션
    expect(prisma.treatmentScheduleTemplate.create.mock.calls[0][0].data).toMatchObject({ version: 2, parentId: 't1', status: 'DRAFT', description: '개정', createdBy: 'doc' });
    expect(prisma.treatmentTemplateItem.createMany.mock.calls[0][0].data[0]).toMatchObject({ templateId: 't-new', title: '초진' });
    expect(prisma.treatmentTemplateItem.createMany.mock.calls[0][0].data[0].id).toBeUndefined();
    expect(prisma.treatmentTemplateDiagnosis.createMany.mock.calls[0][0].data[0]).toMatchObject({ templateId: 't-new', diagnosisCode: 'E11' });
    expect(r).toMatchObject({ editMode: 'NEW_VERSION', newVersionOf: 't1' });
  });
  it('같은 계보 열린 초안이 있으면 409', async () => {
    const { svc } = tt(TPL(), [{ id: 't1', version: 1, status: 'ACTIVE' }, { id: 't-d', version: 2, status: 'DRAFT' }]);
    await expect(svc.update('t1', { name: 'x' }, 'u')).rejects.toMatchObject({ response: { code: 'TEMPLATE_DRAFT_EXISTS', details: { draftId: 't-d' } } });
  });
  it('사용 중으로 — 승인자 기록 · 이전 판 폐기', async () => {
    const { svc, prisma } = tt(TPL({ id: 't2', status: 'DRAFT', parentId: 't1', version: 2 }), [{ id: 't1', version: 1, status: 'ACTIVE' }]);
    await svc.changeStatus('t2', 'ACTIVE', 'adm');
    expect(prisma.treatmentScheduleTemplate.updateMany.mock.calls[0][0]).toMatchObject({ where: { id: 't2', status: 'DRAFT' }, data: { status: 'ACTIVE', approvedBy: 'adm' } });
    expect(prisma.treatmentScheduleTemplate.updateMany).toHaveBeenCalledWith({ where: { id: { in: ['t1'] }, status: 'ACTIVE' }, data: { status: 'DEPRECATED' } });
  });
});
