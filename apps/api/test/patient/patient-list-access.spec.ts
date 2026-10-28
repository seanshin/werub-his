/**
 * 🔴 환자 목록 능력표(2026-10-20 환자 목록 P0 · `patients-list-refinement-2026-10.plan.md` A1·A3·A4).
 *
 * 종전 결함:
 *  - 화면이 역할 권한을 세 곳(화면 로컬 표·설정·RBAC)에서 따로 정해, 의사 배너는 "연락처 마스킹"이라 말했지만 서버는 원문을 보냈다.
 *  - 연락처 권한 없는 역할도 검색어로 전화번호를 찾았다(가려진 응답이어도 "이 번호의 환자가 있다"가 드러난다).
 *  - 스마트 목록(응급 목록은 모든 역할)이 전화번호를 가리지 않았다.
 */
import { describe, it, expect, vi } from 'vitest';
import { UserRole } from '@prisma/client';
import type { ConfigService } from '@nestjs/config';
import { PatientController } from '../../src/modules/patient/patient.controller';
import { PatientService } from '../../src/modules/patient/patient.service';
import { PermissionService } from '../../src/modules/auth/rbac/permission.service';
import { Permission } from '../../src/modules/auth/rbac/permission.types';
import { AccessControlService } from '../../src/modules/access-control/access-control.service';
import { resolveListAccess, looksLikePhoneQuery } from '../../src/modules/patient/patient-list-access';

const perms = new PermissionService();
const rbacOf = (role: UserRole) => {
  const has = (p: Permission) => perms.hasPermission({ userId: 'u', userRole: role }, p);
  return {
    contact: has(Permission.PATIENT_VIEW_CONTACT), identity: has(Permission.PATIENT_VIEW_IDENTITY),
    create: has(Permission.PATIENT_CREATE), import: has(Permission.PATIENT_IMPORT),
    merge: has(Permission.PATIENT_MERGE), export: has(Permission.PATIENT_EXPORT),
  };
};

describe('resolveListAccess — RBAC 정본 · 설정은 좁히기만', () => {
  it('역할 14 전수: 좁히기 없으면 능력표 = RBAC', () => {
    for (const role of Object.values(UserRole)) {
      const r = rbacOf(role);
      const a = resolveListAccess(r, role, null);
      expect(a.scope).toBe('ALL');
      expect(a.contact).toBe(r.contact ? 'FULL' : 'MASKED');
      expect(a.phoneSearch).toBe(r.contact);
      expect(a.canRegister).toBe(r.create);
      expect(a.canImport).toBe(r.import);
      expect(a.canMerge).toBe(r.merge);
      expect(a.canExport).toBe(r.export);
      expect(a.canReviewDuplicates).toBe(role === 'ADMIN');
      expect(a.narrowing).toBeNull();
    }
  });

  it('🔴 의사: RBAC 는 연락처·등록 허용 — 설정 기본값(showPhone·canRegister false)이 좁히면 목록에서 가리고 이유=SETTING', () => {
    const r = rbacOf(UserRole.DOCTOR);
    expect(r.contact).toBe(true);
    expect(r.create).toBe(true);
    const a = resolveListAccess(r, 'DOCTOR', { values: { showPhone: false, canRegister: false }, source: 'default:DOCTOR' });
    expect(a.contact).toBe('MASKED');
    expect(a.contactReason).toBe('SETTING');
    expect(a.phoneSearch).toBe(false);
    expect(a.canRegister).toBe(false);
    expect(a.narrowing).toEqual({ source: 'default:DOCTOR', fields: ['showPhone', 'canRegister'], scope: 'LIST' });
  });

  it('🔴 설정은 넓히지 못한다 — 약사(연락처 권한 없음)에 showPhone=true 여도 MASKED · 이유=RBAC', () => {
    const r = rbacOf(UserRole.PHARMACIST);
    expect(r.contact).toBe(false);
    const a = resolveListAccess(r, 'PHARMACIST', { values: { showPhone: true, canRegister: true }, source: 'access.role.PHARMACIST' });
    expect(a.contact).toBe('MASKED');
    expect(a.contactReason).toBe('RBAC');
    expect(a.canRegister).toBe(r.create);
    expect(a.narrowing).toBeNull();
  });

  it('대조군: 원무는 연락처 원문·전화 검색 가능', () => {
    const a = resolveListAccess(rbacOf(UserRole.RECEPTIONIST), 'RECEPTIONIST', null);
    expect(a.contact).toBe('FULL');
    expect(a.phoneSearch).toBe(true);
  });

  it('전화번호처럼 보이는 검색어', () => {
    expect(looksLikePhoneQuery('010-1234')).toBe(true);
    expect(looksLikePhoneQuery('5678')).toBe(true);
    expect(looksLikePhoneQuery('12')).toBe(false);
    expect(looksLikePhoneQuery('김영수')).toBe(false);
    expect(looksLikePhoneQuery('P2026-0001')).toBe(false);
  });
});

describe('AccessControlService.listNarrowing — 화면이 쓰던 순서(부서 → 역할)', () => {
  const svc = (rows: { key: string; value: unknown }[]) =>
    new AccessControlService({ systemConfig: { findMany: vi.fn(async () => rows) } } as never);

  it('부서 저장값이 역할보다 먼저', async () => {
    const r = await svc([
      { key: 'access.role.dept.원무과', value: { showPhone: true } },
      { key: 'access.role.DOCTOR', value: { showPhone: false } },
    ]).listNarrowing('DOCTOR', '원무과');
    expect(r?.source).toBe('access.role.dept.원무과');
  });

  it('저장값 없으면 역할 기본값', async () => {
    const r = await svc([]).listNarrowing('DOCTOR', null);
    expect(r?.source).toBe('default:DOCTOR');
    expect(r?.values.showPhone).toBe(false);
  });

  it('🔴 등재 안 된 역할은 null — ADMIN 기본값으로 떨어뜨리지 않는다', async () => {
    expect(await svc([]).listNarrowing('RECEPTIONIST', null)).toBeNull();
  });
});

function patientService(findMany = vi.fn(async () => [] as unknown[])) {
  const prisma = {
    patient: { findMany, count: vi.fn(async () => 0) },
    appointment: { findMany: vi.fn(async () => []) },
    encounter: { findMany: vi.fn(async () => []), groupBy: vi.fn(async () => []) },
    allergy: { groupBy: vi.fn(async () => []) }, allergyAssessment: { findMany: vi.fn(async () => []) },
    admission: { findMany: vi.fn(async () => []) },
    emergencyVisit: { findMany: vi.fn(async () => []) },
  };
  const config = { getOrThrow: vi.fn(() => '0'.repeat(64)) } as unknown as ConfigService;
  return { svc: new PatientService(prisma as never, config), prisma };
}

describe('검색어 전화번호 조건 — 권한 없으면 아예 넣지 않는다', () => {
  it('🔴 phoneSearch=false → where 에 phone·phoneNormalized 없음', async () => {
    const { svc, prisma } = patientService();
    await svc.findAll({ q: '010-1234-5678' } as never, { phoneSearch: false });
    const where = JSON.stringify((prisma.patient.findMany.mock.calls[0] as unknown as [{ where: unknown }])[0].where);
    expect(where).not.toContain('"phone"');
    expect(where).not.toContain('phoneNormalized');
  });

  it('대조군 phoneSearch=true → 원문 + 정규화 칸(하이픈 섞인 저장값도 찾는다)', async () => {
    const { svc, prisma } = patientService();
    await svc.findAll({ q: '010-1234-5678' } as never, { phoneSearch: true });
    const where = JSON.stringify((prisma.patient.findMany.mock.calls[0] as unknown as [{ where: unknown }])[0].where);
    expect(where).toContain('"phone"');
    expect(where).toContain('"phoneNormalized":{"contains":"1012345678"}');
  });

  it('기본값(내부 호출)은 종전처럼 전화번호를 찾는다', async () => {
    const { svc, prisma } = patientService();
    await svc.findAll({ q: '5678' } as never);
    expect(JSON.stringify((prisma.patient.findMany.mock.calls[0] as unknown as [{ where: unknown }])[0].where)).toContain('"phone"');
  });

  it('스마트 목록 검색도 같은 규칙 + 병합된 옛 기록 제외', async () => {
    const { svc, prisma } = patientService();
    await svc.getSmartList('u', 'PHARMACIST', undefined, '5678', undefined, { phoneSearch: false });
    const where = (prisma.patient.findMany.mock.calls[0] as unknown as [{ where: Record<string, unknown> }])[0].where;
    expect(where.validTo).toBeNull();
    expect(JSON.stringify(where)).not.toContain('"phone"');
  });
});

describe('컨트롤러 — 응답을 능력표대로 가린다(화면 열 숨김에 기대지 않는다)', () => {
  const row = { id: 'p1', mrn: 'M1', familyName: '김', givenName: '가', phone: '010-1234-5678', insuranceType: 'NHI', insuranceNumber: 'X' };
  const make = (narrow: unknown) => {
    const service = {
      findAll: vi.fn(async () => ({ data: [row], pagination: { total: 1 } })),
      getSmartList: vi.fn(async () => ({ myPatients: [], recentPatients: [], admittedPatients: [], emergencyPatients: [row], searchResults: [] })),
    };
    const accessControl = { listNarrowing: vi.fn(async () => narrow) };
    const c = new PatientController(service as never, { log: vi.fn() } as never, new PermissionService(), accessControl as never);
    return { c, service, accessControl };
  };

  it('🔴 의사(설정 기본값이 좁힘): 목록 전화번호 가림 · 전화 검색 안 함 · 그 사실을 searchNote 로', async () => {
    const { c, service } = make({ values: { showPhone: false, canRegister: false }, source: 'default:DOCTOR' });
    const res = await c.findAll({ q: '010-1234' } as never, { id: 'd', role: UserRole.DOCTOR });
    expect(service.findAll).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ phoneSearch: false }));
    expect((res.data[0] as { phone: string }).phone).toBe('010-****-5678');
    expect(res.searchNote).toBe('PHONE_SEARCH_NOT_ALLOWED');
    // 보험 '유형'은 남는다 · 보험 '번호'는 신원 권한
    expect((res.data[0] as { insuranceType?: string }).insuranceType).toBe('NHI');
    expect('insuranceNumber' in res.data[0]).toBe(false);
  });

  it('🔴 스마트 목록(응급 — 모든 역할) 도 가린다', async () => {
    const { c } = make(null);
    const res = await c.getSmartList({ id: 'p', role: 'PHARMACIST' });
    expect((res.data.emergencyPatients[0] as { phone: string }).phone).toBe('010-****-5678');
  });

  it('🔴 설정 조회 실패 → 넓게 열지 않는다(연락처 가림·등록 닫힘)', async () => {
    const { c, accessControl } = make(null);
    accessControl.listNarrowing.mockRejectedValueOnce(new Error('db'));
    const a = (await c.listCapabilities({ id: 'r', role: UserRole.RECEPTIONIST })).data;
    expect(a.contact).toBe('MASKED');
    expect(a.canRegister).toBe(false);
  });

  it('대조군: 원무 — 원문·전화 검색·searchNote 없음', async () => {
    const { c, service } = make(null);
    const res = await c.findAll({ q: '010-1234' } as never, { id: 'r', role: UserRole.RECEPTIONIST });
    expect(service.findAll).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ phoneSearch: true }));
    expect((res.data[0] as { phone: string }).phone).toBe('010-1234-5678');
    expect(res.searchNote).toBeNull();
  });
});
