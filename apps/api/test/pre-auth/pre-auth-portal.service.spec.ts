import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PreAuthService } from '../../src/modules/pre-auth/pre-auth.service';

// 환자 포털 사전승인 신청(P2) — 환자→행정→주치의 다단계 결재선
describe('PreAuthService 환자 포털 신청', () => {
  let service: PreAuthService;
  let configMap: Record<string, unknown>;
  let prisma: any;

  beforeEach(() => {
    configMap = { 'preauth.portal.enabled': true, 'preauth.portalIntakeStaffId': 'intake-user' };
    const configRuntime = { get: vi.fn(async (k: string) => configMap[k] ?? null) };
    prisma = {
      patient: { findUnique: vi.fn(async () => ({ id: 'pat-1' })) },
      admission: { findFirst: vi.fn(async () => ({ attendingDoctorId: 'doc-att', admittingDoctorId: 'doc-adm' })) },
      encounter: { findFirst: vi.fn(async () => ({ doctorId: 'doc-enc' })) },
      staff: { findUnique: vi.fn(async ({ where }: any) => ({ id: `staff-${where.userId}` })) },
      preAuthRequest: { findFirst: vi.fn(async () => null), findUnique: vi.fn(async () => ({ requestedByPatientId: 'pat-1', status: 'PENDING', category: 'PORTAL' })), create: vi.fn(async () => ({ id: 'pa-1' })), update: vi.fn(async () => ({})), findMany: vi.fn(async () => []) },
      eApprovalRelay: { create: vi.fn(async () => ({ id: 'relay-1', refId: 'pa-1' })), updateMany: vi.fn(async () => ({ count: 1 })) },
      notification: { create: vi.fn(async () => ({})) },
      auditLog: { create: vi.fn(async () => ({})) },
    };
    const config = { get: vi.fn(() => 'https://his.example.org') };
    const moduleRef = { get: vi.fn() };
    service = new PreAuthService(prisma, config as any, configRuntime as any, moduleRef as any);
  });

  const submit = (dto: any) => service.submitPortalPreAuth('pat-1', dto);
  const OK = { type: 'PORTAL_REFILL', note: '만성질환약 재처방' };

  it('게이트 OFF면 신청 차단', async () => {
    configMap = { 'preauth.portal.enabled': false };
    await expect(submit(OK)).rejects.toThrow(/비활성화/);
  });

  it('지원하지 않는 유형 차단', async () => {
    await expect(submit({ type: 'PORTAL_XXX' })).rejects.toThrow(/지원하지 않는/);
  });

  it('접수(원무) 담당 미지정이면 차단', async () => {
    configMap = { 'preauth.portal.enabled': true }; // portalIntakeStaffId 없음
    await expect(submit(OK)).rejects.toThrow(/원무 접수 담당/);
  });

  it('주치의 해소 실패(입원·진료 없음)면 차단', async () => {
    prisma.admission.findFirst = vi.fn(async () => null);
    prisma.encounter.findFirst = vi.fn(async () => null);
    await expect(submit(OK)).rejects.toThrow(/주치.*의/);
  });

  it('신청 — 행정→주치의 2단계 결재선 PENDING 생성', async () => {
    const res = await submit(OK);
    expect(res.status).toBe('PENDING');
    const relayCall = prisma.eApprovalRelay.create.mock.calls[0][0];
    const line = relayCall.data.approvalLine;
    expect(line).toHaveLength(2);
    expect(line[0]).toMatchObject({ order: 1, userId: 'intake-user' }); // 행정 1차
    expect(line[1]).toMatchObject({ order: 2, userId: 'doc-att' });      // 주치의 2차(활성 입원 attending)
    // 첫 결재자(행정)만 알림
    expect(prisma.notification.create).toHaveBeenCalledTimes(1);
    expect(prisma.notification.create.mock.calls[0][0].data.userId).toBe('intake-user');
  });

  it('입원 없으면 주치의는 최근 SIGNED 진료의로 해소', async () => {
    prisma.admission.findFirst = vi.fn(async () => null);
    const res = await submit(OK);
    expect(res.status).toBe('PENDING');
    const line = prisma.eApprovalRelay.create.mock.calls[0][0].data.approvalLine;
    expect(line[1]).toMatchObject({ order: 2, userId: 'doc-enc' });
  });

  it('동일 유형 진행 중이면 중복 차단', async () => {
    prisma.preAuthRequest.findFirst = vi.fn(async () => ({ id: 'pa-0' }));
    await expect(submit(OK)).rejects.toThrow(/진행 중/);
  });

  // M3 — 포털 신청 취소
  it('M3 취소 — 본인 PENDING 건 취소 + relay 회수', async () => {
    const r = await service.cancelPortal('pat-1', 'pa-1');
    expect(r.cancelled).toBe(true);
    expect(prisma.preAuthRequest.update).toHaveBeenCalledWith(expect.objectContaining({ data: { status: 'CANCELLED' } }));
    expect(prisma.eApprovalRelay.updateMany).toHaveBeenCalled();
  });

  it('M3 타인 신청은 취소 불가', async () => {
    prisma.preAuthRequest.findUnique = vi.fn(async () => ({ requestedByPatientId: 'pat-2', status: 'PENDING', category: 'PORTAL' }));
    await expect(service.cancelPortal('pat-1', 'pa-1')).rejects.toThrow(/찾을 수 없습니다/);
  });

  it('M3 이미 처리된(APPROVED) 건은 취소 불가', async () => {
    prisma.preAuthRequest.findUnique = vi.fn(async () => ({ requestedByPatientId: 'pat-1', status: 'APPROVED', category: 'PORTAL' }));
    await expect(service.cancelPortal('pat-1', 'pa-1')).rejects.toThrow(/진행 중/);
  });
});
