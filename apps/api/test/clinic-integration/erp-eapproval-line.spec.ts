import { describe, it, expect, vi } from 'vitest';
import { ErpEapprovalService } from '../../src/modules/clinic-integration/erp-eapproval.service';

/**
 * 🔴 (2026-09-03 재검증 회수) 결재선 자동 추천 — 정본(CLINIC-HIS-INTEGRATION v1.1.0 §7.3)의
 *    응답 키는 `recommendedLine[].userId` 인데 코드가 `approvers[].clinicUserId` 를 읽어
 *    **ERP 미지정(자동 결재선) 케이스 전건이 빈 결재선으로 상신**되고 있었다(키 부재라 catch 도 안 탄다).
 *    목은 정본 문서의 실제 응답 모양을 쓴다.
 */

const mkPrisma = () => {
  const rows = new Map<string, Record<string, unknown>>();
  return {
    eApprovalRelay: {
      findUnique: vi.fn(async () => null),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: 'relay-1', ...data };
        rows.set('relay-1', row);
        return row;
      }),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row = { ...rows.get('relay-1'), ...data };
        rows.set('relay-1', row);
        return row;
      }),
    },
  };
};
const mkConfig = () => ({ get: vi.fn((k: string) => (k === 'EAPPROVAL_CALLBACK_HOSTS' ? 'erp.example.com' : '')) });

const SUBMIT = {
  doc_type: 'HR_LEAVE', title: '휴가', drafter_clinic_user_id: 'u-1',
  approvers: null, content: {},
  ref: { source_module: 'hr', source_ref: 'r-1' }, callback_url: 'https://erp.example.com/cb',
};

describe('전자결재 결재선 추천 — 정본 키(recommendedLine.userId)', () => {
  it('🔴 정본 응답(recommendedLine)에서 결재선을 뽑아 상신한다 — 종전엔 전건 빈 결재선이었다', async () => {
    const prisma = mkPrisma();
    const clinicApi = {
      getApprovers: vi.fn(async () => ({
        // 정본 §7.3 실제 모양
        recommendedLine: [
          { step: 1, type: 'approve', userId: 'user-uuid-002', username: '이간호' },
          { step: 2, type: 'approve', userId: 'user-uuid-001', username: '김과장' },
        ],
      })),
      requestApproval: vi.fn(async () => ({ docId: 'doc-1' })),
    };
    const svc = new ErpEapprovalService(prisma as never, clinicApi as never, mkConfig() as never);
    await svc.submit(SUBMIT as never);
    const call = clinicApi.requestApproval.mock.calls[0][0] as unknown as { approvers: string[] };
    expect(call.approvers, '빈 결재선으로 상신되면 결재가 누구에게도 가지 않는다').toEqual(['user-uuid-002', 'user-uuid-001']);
  });

  it('옛 키(approvers[].clinicUserId)도 폴백으로 산다(대조군 — 넓히다 기존을 깨지 않는다)', async () => {
    const prisma = mkPrisma();
    const clinicApi = {
      getApprovers: vi.fn(async () => ({ approvers: [{ clinicUserId: 'legacy-1' }] })),
      requestApproval: vi.fn(async () => ({ docId: 'doc-2' })),
    };
    const svc = new ErpEapprovalService(prisma as never, clinicApi as never, mkConfig() as never);
    await svc.submit(SUBMIT as never);
    const call = clinicApi.requestApproval.mock.calls[0][0] as unknown as { approvers: string[] };
    expect(call.approvers).toEqual(['legacy-1']);
  });

  it('🔴 둘 다 없으면 빈 결재선 상신 사실을 드리프트 원장에 남긴다', async () => {
    const prisma = mkPrisma();
    const drift = { record: vi.fn() };
    const clinicApi = {
      getApprovers: vi.fn(async () => ({ line: [{ id: 'x' }] })), // 미지의 모양
      requestApproval: vi.fn(async () => ({ docId: 'doc-3' })),
    };
    const svc = new ErpEapprovalService(prisma as never, clinicApi as never, mkConfig() as never, drift as never);
    await svc.submit(SUBMIT as never);
    expect(drift.record).toHaveBeenCalledTimes(1);
    expect((drift.record.mock.calls[0][0] as { consumer: string }).consumer).toBe('erp-eapproval.recommendLine');
  });

  it('상태 조회 current_step 은 정본 approvalLine[].status 에서 파생한다(currentStep 키는 정본에 없다)', async () => {
    const prisma = mkPrisma();
    prisma.eApprovalRelay.findUnique = vi.fn(async () => ({
      id: 'relay-1', status: 'PENDING', result: null, decidedAt: null, viewUrl: null, refModule: 'hr', refId: 'r-1',
    })) as never;
    const clinicApi = {
      getApprovalStatus: vi.fn(async () => ({
        docId: 'doc-1', status: 'pending',
        approvalLine: [
          { step: 1, status: 'approved' },
          { step: 2, status: 'pending' },
        ],
      })),
    };
    const svc = new ErpEapprovalService(prisma as never, clinicApi as never, mkConfig() as never);
    const res = await svc.status('doc-1');
    expect(res.current_step).toBe(2);
  });
});
