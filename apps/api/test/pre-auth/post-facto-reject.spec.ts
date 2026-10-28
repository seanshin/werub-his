import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PreAuthService } from '../../src/modules/pre-auth/pre-auth.service';
import { PreAuthGateService } from '../../src/modules/pre-auth/pre-auth-gate.service';

/** 반려 자동취소 정책(2026-07-22) — 사후승인(POST_FACTO) 결재 편입·반려 시 발행분 자동취소·승인=추인 */
describe('POST_FACTO 사후승인 반려 자동취소', () => {
  describe('PreAuthGateService — 결재 편입·발행분 링크', () => {
    let gate: PreAuthGateService;
    let prisma: any;
    let configMap: Record<string, unknown>;

    beforeEach(() => {
      configMap = { 'preauth.enforce': { NARCOTIC_RX: 'BLOCK' } };
      prisma = {
        // 트랜잭션 도입(2026-07 tx 경계 전수) — 콜백에 같은 목을 넘겨 기존 검증을 유지
        $transaction: vi.fn(async (cb: (tx: unknown) => unknown) => cb(prisma)),
        preAuthRequest: {
          create: vi.fn().mockResolvedValue({ id: 'pa-1' }),
          update: vi.fn().mockResolvedValue({}),
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
          findFirst: vi.fn().mockResolvedValue(null),
        },
        eApprovalRelay: { create: vi.fn().mockResolvedValue({ id: 'relay-1', refId: 'pa-1' }) },
        notification: { create: vi.fn().mockResolvedValue({}) },
        staff: { findUnique: vi.fn().mockResolvedValue({ manager: { id: 'mgr-staff', userId: 'u-mgr' } }) },
        medicationCode: { findUnique: vi.fn().mockResolvedValue({ controlSchedule: 'II' }) },
      };
      const configRuntime = { get: vi.fn(async (k: string) => configMap[k] ?? null) };
      gate = new PreAuthGateService(prisma, configRuntime as any);
    });

    it('응급 우회 발행 → 사후승인 큐 + EApprovalRelay(PRE_AUTH) 생성·승인권자 알림·postFactoId 반환', async () => {
      const r = await gate.assertGate('NARCOTIC_RX', { patientId: 'p-1', emergency: true, bypassReason: '응급', requestedByUserId: 'u-doc' });
      expect(r).toEqual({ ok: true, bypassed: true, postFactoId: 'pa-1' });
      expect(prisma.eApprovalRelay.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ docType: 'PRE_AUTH', refModule: 'preauth.pre_auth_requests', refId: 'pa-1' }) }),
      );
      expect(prisma.notification.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ userId: 'u-mgr', type: 'PRE_AUTH' }) }),
      );
    });

    it('승인권자 미해소(관리자 없음) — relay 없이 큐만(비차단·현행 유지)', async () => {
      prisma.staff.findUnique.mockResolvedValue({ manager: null });
      const r = await gate.assertGate('NARCOTIC_RX', { patientId: 'p-1', emergency: true, bypassReason: '응급', requestedByUserId: 'u-doc' });
      expect(r.postFactoId).toBe('pa-1');
      expect(prisma.eApprovalRelay.create).not.toHaveBeenCalled();
    });

    it('linkPostFacto — POST_FACTO_PENDING·미링크 건에만 fulfilledRef 연결', async () => {
      await gate.linkPostFacto('pa-1', 'rx-9');
      expect(prisma.preAuthRequest.updateMany).toHaveBeenCalledWith({
        where: { id: 'pa-1', status: 'POST_FACTO_PENDING', fulfilledRef: null },
        data: { fulfilledRef: 'rx-9', fulfilledType: 'prescription' },
      });
    });

    it('linkPostFacto — postFactoId 없으면 no-op', async () => {
      await gate.linkPostFacto(undefined, 'rx-9');
      expect(prisma.preAuthRequest.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('PreAuthService.confirmPreAuth — POST_FACTO 분기', () => {
    let svc: PreAuthService;
    let prisma: any;
    let rxCancel: any;
    let configMap: Record<string, unknown>;

    const postFactoPa = {
      id: 'pa-1', status: 'POST_FACTO_PENDING', type: 'NARCOTIC_RX', category: 'ORDER',
      fulfilledRef: 'rx-1', fulfilledType: 'prescription', requestedByUserId: 'u-doc',
      encounterId: 'enc-1', payload: { dto: { type: 'MEDICATION' } }, bypassReason: '응급', decision: null,
    };

    beforeEach(() => {
      configMap = {};
      prisma = {
        // 트랜잭션 도입(2026-07 tx 경계 전수) — 콜백에 같은 목을 넘겨 기존 검증을 유지
        $transaction: vi.fn(async (cb: (tx: unknown) => unknown) => cb(prisma)),
        preAuthRequest: { findUnique: vi.fn().mockResolvedValue({ ...postFactoPa }), update: vi.fn().mockResolvedValue({}), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
        notification: { create: vi.fn().mockResolvedValue({}) },
        auditLog: { create: vi.fn().mockResolvedValue({}) },
      };
      rxCancel = { cancel: vi.fn().mockResolvedValue({}), create: vi.fn() };
      const configRuntime = { get: vi.fn(async (k: string) => configMap[k] ?? null) };
      svc = new PreAuthService(prisma, { get: vi.fn() } as any, configRuntime as any, { get: vi.fn(() => rxCancel) } as any);
      // lazy require 게터 우회 — 테스트 환경 CJS/ESM interop 비의존
      Object.defineProperty(svc, 'prescription', { get: () => rxCancel });
    });

    it('반려 → 발행 처방 자동취소(기본 ON) + REJECTED', async () => {
      const r: any = await svc.confirmPreAuth('pa-1', 'REJECTED', 'u-mgr', '남용 우려');
      expect(r).toEqual({ status: 'REJECTED', autoCancelled: true });
      expect(rxCancel.cancel).toHaveBeenCalledWith('rx-1', 'u-mgr');
      expect(prisma.preAuthRequest.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'REJECTED' }) }),
      );
    });

    // 2026-07 멱등/동시성 전수 — 동시 콜백 재수신 시 낙관적 락(updateMany count 0)으로 이중 취소 방지
    it('동시 콜백 재수신(선점됨) → prescription.cancel 을 중복 호출하지 않는다', async () => {
      prisma.preAuthRequest.updateMany.mockResolvedValueOnce({ count: 0 }); // 다른 콜백이 선점
      const r: any = await svc.confirmPreAuth('pa-1', 'REJECTED', 'u-mgr', '남용 우려');
      expect(r).toEqual({ idempotent: true, status: 'REJECTED' });
      expect(rxCancel.cancel).not.toHaveBeenCalled(); // 이중 취소 없음
    });

    it('반려 + config OFF → 취소 없이 REJECTED만', async () => {
      configMap['preauth.postFacto.autoCancelOnReject'] = 'false';
      const r: any = await svc.confirmPreAuth('pa-1', 'REJECTED', 'u-mgr');
      expect(r.autoCancelled).toBe(false);
      expect(rxCancel.cancel).not.toHaveBeenCalled();
    });

    it('반려 + 취소 실패 → 비차단(REJECTED 유지·autoCancelled=false)', async () => {
      rxCancel.cancel.mockRejectedValue(new Error('이미 취소됨'));
      const r: any = await svc.confirmPreAuth('pa-1', 'REJECTED', 'u-mgr');
      expect(r.status).toBe('REJECTED');
      expect(r.autoCancelled).toBe(false);
    });

    it('승인 → 추인(ratified) — 재발행 없이 APPROVED 종결', async () => {
      const r: any = await svc.confirmPreAuth('pa-1', 'APPROVED', 'u-mgr');
      expect(r).toEqual({ status: 'APPROVED', ratified: true });
      expect(rxCancel.create).not.toHaveBeenCalled(); // 중복 재발행 금지
    });

    it('이미 종결(REJECTED)이면 멱등', async () => {
      prisma.preAuthRequest.findUnique.mockResolvedValue({ ...postFactoPa, status: 'REJECTED' });
      const r: any = await svc.confirmPreAuth('pa-1', 'REJECTED');
      expect(r.idempotent).toBe(true);
      expect(rxCancel.cancel).not.toHaveBeenCalled();
    });
  });
});
