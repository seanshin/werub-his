import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EssService } from '../../src/modules/ess/ess.service';

// 결재 관리 대시보드 — 카테고리(HR·CLINICAL_RECORD·PRE_AUTH)별 집계
describe('EssService 결재 대시보드', () => {
  let service: EssService;
  let prisma: any;

  beforeEach(() => {
    prisma = {
      eApprovalRelay: {
        groupBy: vi.fn(async () => [
          { docType: 'HR_LEAVE', status: 'APPROVED', _count: { _all: 5 } },
          { docType: 'HR_LEAVE', status: 'PENDING', _count: { _all: 2 } },
          { docType: 'CLINICAL_CERTIFICATE', status: 'PENDING', _count: { _all: 3 } },
          { docType: 'CONSENT_DOCTOR_SIGN', status: 'REJECTED', _count: { _all: 1 } },
          { docType: 'PRE_AUTH', status: 'PROCESSING', _count: { _all: 2 } },
        ]),
      },
      preAuthRequest: {
        groupBy: vi.fn(async () => [
          { type: 'NARCOTIC_RX', status: 'FULFILLED', _count: { _all: 4 } },
          { type: 'TRANSFUSION', status: 'APPROVED', _count: { _all: 1 } },
        ]),
        count: vi.fn(async () => 6),
      },
    };
    const cfg = { get: vi.fn(async () => null) };
    service = new EssService(prisma, { enqueue: vi.fn() } as any, { get: vi.fn() } as any, cfg as any, {} as any, {} as any, {} as any);
  });

  it('카테고리별 롤업 — HR/CLINICAL_RECORD/PRE_AUTH 분류·상태 집계', async () => {
    const r = await service.approvalDashboard();
    const byCat = Object.fromEntries(r.categories.map((c: any) => [c.category, c]));

    expect(byCat.HR.total).toBe(7);
    expect(byCat.HR.approved).toBe(5);
    expect(byCat.HR.pending).toBe(2);

    expect(byCat.CLINICAL_RECORD.total).toBe(4); // 증명서3 + 동의서1
    expect(byCat.CLINICAL_RECORD.pending).toBe(3);
    expect(byCat.CLINICAL_RECORD.rejected).toBe(1);
    expect(byCat.CLINICAL_RECORD.byDocType.CLINICAL_CERTIFICATE).toBe(3);

    // PROCESSING(원자 claim 중간상태)은 pending으로 집계
    expect(byCat.PRE_AUTH.total).toBe(2);
    expect(byCat.PRE_AUTH.pending).toBe(2);
  });

  it('사전승인 세부 — 유형별 상태 + 사후승인(POST_FACTO_PENDING) 미결 수', async () => {
    const r = await service.approvalDashboard();
    expect(r.preAuth.byType.NARCOTIC_RX.FULFILLED).toBe(4);
    expect(r.preAuth.byType.TRANSFUSION.APPROVED).toBe(1);
    expect(r.preAuth.postFactoPending).toBe(6);
    // 사후승인 미결은 status=POST_FACTO_PENDING만 카운트
    expect(prisma.preAuthRequest.count).toHaveBeenCalledWith({ where: { status: 'POST_FACTO_PENDING' } });
  });

  it('기간 필터 — createdAt 범위가 groupBy where에 전달', async () => {
    await service.approvalDashboard({ from: '2026-07-01', to: '2026-07-31' });
    const call = prisma.eApprovalRelay.groupBy.mock.calls[0][0];
    expect(call.where.createdAt).toBeDefined();
  });

  /**
   * 🔴 W8 — date-only 경계. `new Date('2026-08-13')` 은 TZ 와 무관하게 **항상 UTC 자정**이라
   * 같은 날짜를 gte/lte 로 넣으면 폭 0 인 구간이 됐고, 상한이 `lte: 자정`이라 끝나는 날이 통째로 빠졌다.
   * W7 에서 감사 대시보드는 고쳤는데 결재 대시보드에 같은 결함이 남아 있었다 → 정본 `dayRange` 사용.
   */
  describe('🔴 date-only 구간은 로컬(KST) 자정 기준', () => {
    it('같은 날짜를 주면 그 하루 전체를 센다 — 폭 0 이 아니다', async () => {
      await service.approvalDashboard({ from: '2026-08-13', to: '2026-08-13' });
      const { createdAt } = prisma.eApprovalRelay.groupBy.mock.calls[0][0].where as {
        createdAt: { gte: Date; lt: Date };
      };
      expect(createdAt.lt.getTime() - createdAt.gte.getTime()).toBe(86_400_000);
      expect(createdAt.gte.getHours()).toBe(0); // UTC 자정이면 KST 09시가 된다
      expect(createdAt).not.toHaveProperty('lte'); // 끝나는 날을 잘라내던 상한
    });

    it('사전승인 세부도 같은 구간을 쓴다 — 카드와 표의 분모가 갈라지지 않게', async () => {
      await service.approvalDashboard({ from: '2026-08-01', to: '2026-08-13' });
      const relayRange = prisma.eApprovalRelay.groupBy.mock.calls[0][0].where.createdAt;
      const preAuthRange = prisma.preAuthRequest.groupBy.mock.calls[0][0].where.createdAt;
      expect(preAuthRange).toEqual(relayRange);
    });
  });
});
