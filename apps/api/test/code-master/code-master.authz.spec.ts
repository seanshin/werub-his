/**
 * 코드마스터/표준매핑 컨트롤러 인가 가드 + Stage 게이트 스펙 (🔴 W7 2026-08)
 *
 * 배경 1(인가): clinical-review 계열 4개(GET 2·POST 2)에 `@UseGuards(RolesGuard)`·`@Roles` 가 모두
 *   없었다. 같은 파일의 pending-mappings 계열은 전부 @Roles(ADMIN) 이라 누락이 명백했다.
 *   서버는 `user.role` 을 그대로 `clinicalReviewerRole` 에 저장하므로, 아무 역할이나 "의사 검토"로 기록됐다.
 *
 * 배경 2(Stage 강제): Stage 4 확정(confirmPending)이 `clinicalStatus` 를 읽지도 않아, 임상 검토를
 *   건너뛴 매핑이 `mapSource='AI_REVIEWED'`(= 검토됨)로 봉인됐다 — 하지 않은 것을 했다고 적는 P16.
 */
import 'reflect-metadata';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ConflictException } from '@nestjs/common';
import { PATH_METADATA, GUARDS_METADATA } from '@nestjs/common/constants';
import { UserRole } from '@prisma/client';
import { ROLES_KEY } from '../../src/common/decorators/roles.decorator';
import { CodeMasterController } from '../../src/modules/code-master/code-master.controller';
import { AutoMapperService } from '../../src/modules/code-master/auto-mapper.service';

type AnyProto = Record<string, (...args: unknown[]) => unknown>;

/**
 * 역할 제한 없이 인증 사용자 전체에 여는 코드 **사전(dictionary) 조회** — 임상 화면 전반이 읽는다.
 * PHI 가 없고 원내 표준코드 자체가 공용 참조자료라 의도적으로 연다(비어 있는 것이 아니라 결정).
 * 이 목록에 새 항목을 넣으려면 "왜 사전인가"를 여기 적어야 한다.
 */
const CODE_DICTIONARY_READS = new Set([
  'searchDiagnosis', 'diagnosisGroups', 'getDiagnosis',
  'searchProcedure', 'getProcedure',
  'searchMedication', 'getMedication',
  'searchLabTests', 'listRoutes', 'listDepartments', 'listSurgeryAnesthesia', 'searchNursingCodes',
  'getMappings', 'getMappingsForCode', // 소스코드 → 표준코드(SNOMED/LOINC) 조회 = 사전 성격
]);

/** 임상 검토(Stage 3) 주체 — 소스가 진단/수가/약품/검사라 임상 4직군 */
const CLINICAL_REVIEWERS: UserRole[] = [UserRole.DOCTOR, UserRole.NURSE, UserRole.PHARMACIST, UserRole.LAB_TECH];

function routeHandlers(): string[] {
  const proto = CodeMasterController.prototype as unknown as AnyProto;
  return Object.getOwnPropertyNames(proto).filter(
    (k) => k !== 'constructor' && typeof proto[k] === 'function' && Reflect.hasMetadata(PATH_METADATA, proto[k]),
  );
}

function rolesOf(handler: string): UserRole[] | undefined {
  const proto = CodeMasterController.prototype as unknown as AnyProto;
  return Reflect.getMetadata(ROLES_KEY, proto[handler]) as UserRole[] | undefined;
}

function methodGuards(handler: string): string[] {
  const proto = CodeMasterController.prototype as unknown as AnyProto;
  return ((Reflect.getMetadata(GUARDS_METADATA, proto[handler]) as Array<{ name?: string }>) ?? []).map(
    (g) => g?.name ?? String(g),
  );
}

describe('CodeMasterController 인가 가드', () => {
  it('코드 사전 조회를 제외한 모든 핸들러가 @Roles 를 갖는다', () => {
    const unguarded = routeHandlers()
      .filter((h) => !CODE_DICTIONARY_READS.has(h))
      .filter((h) => (rolesOf(h) ?? []).length === 0);
    expect(unguarded).toEqual([]);
  });

  it('@Roles 를 붙인 핸들러에는 RolesGuard 가 함께 걸려 있다 (가드 없는 @Roles 는 무의미)', () => {
    // 이 컨트롤러는 클래스에 JwtAuthGuard 만 있고 RolesGuard 는 메서드별로 붙인다.
    const missing = routeHandlers()
      .filter((h) => (rolesOf(h) ?? []).length > 0)
      .filter((h) => !methodGuards(h).includes('RolesGuard'));
    expect(missing).toEqual([]);
  });

  it('임상 검토 승인/반려는 임상직만 — 지원부서 역할은 검토자가 될 수 없다', () => {
    for (const h of ['clinicalApprove', 'clinicalReject']) {
      expect(rolesOf(h)).toEqual(CLINICAL_REVIEWERS);
    }
  });

  it('임상 검토 목록·통계는 임상직 + 관리자', () => {
    for (const h of ['getClinicalReviewList', 'getClinicalReviewStats']) {
      expect(rolesOf(h)).toEqual([...CLINICAL_REVIEWERS, UserRole.ADMIN]);
    }
  });

  it('Stage 4(관리자 확정)·배정은 ADMIN', () => {
    for (const h of ['confirmPending', 'rejectPending', 'assignDepartment', 'getPendingMappings']) {
      expect(rolesOf(h)).toEqual([UserRole.ADMIN]);
    }
  });
});

describe('AutoMapperService.confirmPending — Stage 3 → Stage 4 fail-closed', () => {
  let service: AutoMapperService;
  let prisma: { pendingMapping: Record<string, ReturnType<typeof vi.fn>>; terminologyMapping: Record<string, ReturnType<typeof vi.fn>>; mappingAuditLog: Record<string, ReturnType<typeof vi.fn>>; systemConfig: Record<string, ReturnType<typeof vi.fn>> };

  const pendingRow = (clinicalStatus: string) => ({
    id: 'p-1',
    status: 'PENDING',
    clinicalStatus,
    sourceTable: 'diagnosis_codes',
    sourceId: 'src-1',
    sourceCode: 'I10',
    targetSystem: 'SNOMED_CT',
    candidates: [{ targetCode: '59621000', targetDisplay: 'Essential hypertension', confidence: 0.88, method: 'AI_LLM', reason: '' }],
  });

  beforeEach(() => {
    prisma = {
      // 🔴 (D1) 확정은 상태 선점(PENDING 조건부 updateMany) 이 이긴 쪽만 매핑을 만든다 — 목도 그 모양
      pendingMapping: { findUnique: vi.fn(), update: vi.fn().mockResolvedValue({}), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      terminologyMapping: { create: vi.fn().mockResolvedValue({ id: 'map-1' }) },
      mappingAuditLog: { create: vi.fn().mockResolvedValue({}) },
      systemConfig: { findUnique: vi.fn().mockResolvedValue(null), upsert: vi.fn() },
      $transaction: vi.fn().mockImplementation((arg: never) => (typeof arg === 'function' ? (arg as (tx: unknown) => unknown)(prisma) : Promise.all(arg as never))),
    };
    service = new AutoMapperService(prisma as never, { reference: vi.fn() } as never);
  });

  // 🔴 W7: 임상 검토를 건너뛴 확정이 'AI_REVIEWED'(검토됨)로 봉인되던 것
  it('임상 검토 대기(AWAITING) 상태에서는 확정을 거부한다', async () => {
    prisma.pendingMapping.findUnique.mockResolvedValue(pendingRow('AWAITING'));

    await expect(service.confirmPending('p-1', '59621000', 'admin-1')).rejects.toThrow(ConflictException);
    expect(prisma.terminologyMapping.create).not.toHaveBeenCalled();
    expect(prisma.pendingMapping.updateMany).not.toHaveBeenCalled();
  });

  it('임상 반려(REJECTED)된 매핑도 확정할 수 없다', async () => {
    prisma.pendingMapping.findUnique.mockResolvedValue(pendingRow('REJECTED'));

    await expect(service.confirmPending('p-1', '59621000', 'admin-1')).rejects.toThrow(ConflictException);
    expect(prisma.terminologyMapping.create).not.toHaveBeenCalled();
  });

  it('임상 승인(APPROVED) 후에만 확정되고, 그때 mapSource=AI_REVIEWED 가 사실이 된다', async () => {
    prisma.pendingMapping.findUnique.mockResolvedValue(pendingRow('APPROVED'));

    const result = await service.confirmPending('p-1', '59621000', 'admin-1', '확정');

    expect(result).toEqual({ id: 'map-1' });
    const created = prisma.terminologyMapping.create.mock.calls[0][0].data;
    expect(created.mapSource).toBe('AI_REVIEWED');
    expect(created.targetCode).toBe('59621000');
    expect(prisma.pendingMapping.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'p-1', status: 'PENDING' }, data: expect.objectContaining({ status: 'CONFIRMED', reviewedBy: 'admin-1' }) }),
    );
  });

  /**
   * 🔴 (2026-09-15 D1) 종전 이 테스트는 **`resolves.toBeNull()`** 을 기대했다 — 즉 결함(조용한 무동작)을
   *    계약으로 못박고 있었다. 화면은 200 + null 을 받아 "확정됨"으로 그렸다. 이제 이미 처리된 건은 409 다.
   */
  it('PENDING 이 아닌 건은 409 — 조용히 무시하지 않는다', async () => {
    prisma.pendingMapping.findUnique.mockResolvedValue({ ...pendingRow('APPROVED'), status: 'CONFIRMED' });

    await expect(service.confirmPending('p-1', '59621000', 'admin-1')).rejects.toMatchObject({
      response: { code: 'PENDING_MAPPING_NOT_PENDING' },
    });
    expect(prisma.terminologyMapping.create).not.toHaveBeenCalled();
  });

  it('없는 검토 항목은 404 (없는 것과 이미 처리된 것은 다른 사실)', async () => {
    prisma.pendingMapping.findUnique.mockResolvedValue(null);
    await expect(service.confirmPending('p-1', '59621000', 'admin-1')).rejects.toMatchObject({
      response: { code: 'PENDING_MAPPING_NOT_FOUND' },
    });
  });
});
