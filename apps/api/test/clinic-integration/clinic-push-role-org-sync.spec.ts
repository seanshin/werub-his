import { describe, it, expect, vi } from 'vitest';
import { ClinicIntegrationController } from '../../src/modules/clinic-integration/clinic-integration.controller';

/**
 * 외부 점검.
 *
 * B1 🔴 push-staff 가 직원 **분류**를 역할 어휘로 옮겼다 — MEDICAL(의사+간호사)→'Doctor', ADMIN(행정직)→'Admin'.
 *    Clinic 이 돌려주면 SSO 신규 생성에서 간호사→DOCTOR·행정직→ADMIN 이 될 수 있었다.
 *    → HIS 정본 역할(User.role)을 보내고, 연결된 활성 계정이 없으면 READ.
 * B5 🔴 sync-organization 이 `take:1000` 에 정렬·절단 표시가 없었고, 매핑 저장 실패를 삼킨 뒤에도 mapped++ 로 셌다.
 */

function make(prismaOver: Record<string, unknown>) {
  const prisma = {
    staff: { findMany: vi.fn(), count: vi.fn(), update: vi.fn().mockResolvedValue({}) },
    user: { findMany: vi.fn().mockResolvedValue([]) },
    clinicSyncLog: { create: vi.fn().mockResolvedValue({}) },
    ...prismaOver,
  };
  const config = { get: vi.fn((k: string, d?: string) => (k === 'CLINIC_INITIAL_PASSWORD' ? '기관값' : d ?? '')) };
  const clinicApi = { pushStaffToClinic: vi.fn().mockResolvedValue({ registered: 0, skipped: 0, errors: [] }), pushOrganizationToClinic: vi.fn() };
  const ctrl = new ClinicIntegrationController(prisma as never, config as never, clinicApi as never);
  return { ctrl, prisma, clinicApi };
}

describe('B1 — push-staff 는 HIS 정본 역할을 보낸다', () => {
  const staff = [
    { id: 's-nurse', userId: 'u-nurse', email: 'n@his.example', familyName: '이', givenName: '간호', department: '간호부', category: 'MEDICAL', employeeNumber: 'E1', position: '간호사' },
    { id: 's-clerk', userId: null, email: 'c@his.example', familyName: '김', givenName: '행정', department: '원무과', category: 'ADMIN', employeeNumber: 'E2', position: '주임' },
    { id: 's-doc', userId: 'u-doc', email: 'd@his.example', familyName: '박', givenName: '의사', department: '내과', category: 'MEDICAL', employeeNumber: 'E3', position: '전문의' },
    { id: 's-off', userId: 'u-off', email: 'o@his.example', familyName: '최', givenName: '비활성', department: '원무과', category: 'ADMIN', employeeNumber: 'E4', position: '과장' },
  ];
  const users = [
    { id: 'u-nurse', role: 'NURSE', isActive: true },
    { id: 'u-doc', role: 'DOCTOR', isActive: true },
    { id: 'u-off', role: 'ADMIN', isActive: false },
  ];

  it('🔴 간호사는 NURSE · 계정 없는 행정직은 READ · 비활성 계정은 READ — Doctor/Admin 이 아니다', async () => {
    const { ctrl, prisma, clinicApi } = make({});
    prisma.staff.findMany.mockResolvedValue(staff);
    prisma.user.findMany.mockResolvedValue(users);
    await ctrl.pushStaff('admin-1');
    const sent = clinicApi.pushStaffToClinic.mock.calls[0][0] as { email: string; hisRole: string }[];
    const byEmail = Object.fromEntries(sent.map((p) => [p.email, p.hisRole]));
    expect(byEmail).toEqual({ 'n@his.example': 'NURSE', 'c@his.example': 'READ', 'd@his.example': 'DOCTOR', 'o@his.example': 'READ' });
    expect(sent.map((p) => p.hisRole)).not.toContain('Admin');
    expect(sent.map((p) => p.hisRole)).not.toContain('Doctor');
  });

  it('보내는 값은 언제나 HIS 역할 어휘 안에 있다', async () => {
    const { EVERY_STAFF_ROLE } = await import('@hospital-run/shared');
    const { ctrl, prisma, clinicApi } = make({});
    prisma.staff.findMany.mockResolvedValue(staff);
    prisma.user.findMany.mockResolvedValue(users);
    await ctrl.pushStaff('admin-1');
    for (const p of clinicApi.pushStaffToClinic.mock.calls[0][0] as { hisRole: string }[]) {
      expect(EVERY_STAFF_ROLE).toContain(p.hisRole);
    }
  });
});

describe('B5 — 조직 동기화 절단·매핑 실패', () => {
  const row = (n: number) => ({ id: `s-${n}`, employeeNumber: `E${n}`, email: `e${n}@his.example`, familyName: '김', givenName: `${n}`, department: 'D', position: 'P', status: 'ACTIVE', hireDate: null, manager: null });

  it('🔴 대상이 상한보다 많으면 사번순으로 자르고 truncated·전체 수를 응답과 이력에 밝힌다', async () => {
    const { ctrl, prisma, clinicApi } = make({});
    prisma.staff.count.mockResolvedValue(1234);
    prisma.staff.findMany.mockResolvedValue([row(1), row(2)]);
    clinicApi.pushOrganizationToClinic.mockResolvedValue({ mappings: [] });
    const out = await ctrl.syncOrganization('admin-1');
    expect(prisma.staff.findMany).toHaveBeenCalledWith(expect.objectContaining({ orderBy: { employeeNumber: 'asc' }, take: 1000 }));
    expect(out.data).toMatchObject({ sent: 2, eligibleTotal: 1234, truncated: true, limit: 1000 });
    expect(prisma.clinicSyncLog.create.mock.calls[0][0].data.details.hisSelection).toEqual({ eligibleTotal: 1234, sent: 2, truncated: true, limit: 1000 });
  });

  it('대조군 — 전원이 들어가면 truncated=false', async () => {
    const { ctrl, prisma, clinicApi } = make({});
    prisma.staff.count.mockResolvedValue(2);
    prisma.staff.findMany.mockResolvedValue([row(1), row(2)]);
    clinicApi.pushOrganizationToClinic.mockResolvedValue({ mappings: [] });
    const out = await ctrl.syncOrganization('admin-1');
    expect(out.data).toMatchObject({ sent: 2, eligibleTotal: 2, truncated: false });
  });

  it('🔴 매핑 저장 실패는 mapped 가 아니라 mappingFailed 로 센다', async () => {
    const { ctrl, prisma, clinicApi } = make({});
    prisma.staff.count.mockResolvedValue(2);
    prisma.staff.findMany.mockResolvedValue([row(1), row(2)]);
    prisma.staff.update.mockResolvedValueOnce({}).mockRejectedValueOnce(new Error('unique violation'));
    clinicApi.pushOrganizationToClinic.mockResolvedValue({ mappings: [{ employeeNumber: 'E1', clinicUserId: 'c1' }, { employeeNumber: 'E2', clinicUserId: 'c2' }] });
    const out = await ctrl.syncOrganization('admin-1');
    expect(out.data).toMatchObject({ mappedClinicUserIds: 1, mappingFailed: 1 });
  });

  it('대조군 — 저장이 모두 성공하면 실패 0', async () => {
    const { ctrl, prisma, clinicApi } = make({});
    prisma.staff.count.mockResolvedValue(2);
    prisma.staff.findMany.mockResolvedValue([row(1), row(2)]);
    clinicApi.pushOrganizationToClinic.mockResolvedValue({ mappings: [{ employeeNumber: 'E1', clinicUserId: 'c1' }, { employeeNumber: 'E2', clinicUserId: 'c2' }] });
    const out = await ctrl.syncOrganization('admin-1');
    expect(out.data).toMatchObject({ mappedClinicUserIds: 2, mappingFailed: 0 });
  });
});
