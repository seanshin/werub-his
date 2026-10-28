import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as jwt from 'jsonwebtoken';
import { PortalService } from '../../src/modules/portal/portal.service';
import { signingSecret } from '../../src/common/util/signing-secret';

// 보호자 대리 접근 인가 (F: spec 밀도 — 외부 노출·권한 우회 리스크)
describe('PortalService 보호자 위임 인가', () => {
  let service: PortalService;
  let mockPrisma: any;
  // 서비스가 signingSecret('portal') = AUTH_SECRET + ':portal' 로 검증하므로 동일 파생값으로 서명
  // (AUTH_SECRET 은 test/setup-env.ts 가 전역 주입)
  const SECRET = signingSecret('portal');

  beforeEach(() => {
    mockPrisma = {
      patientGuardian: { findUnique: vi.fn(), delete: vi.fn().mockResolvedValue({}) },
      patientAccount: { findUnique: vi.fn() },
      portalSession: { findFirst: vi.fn(), update: vi.fn().mockResolvedValue({}) },
    };
    service = new PortalService(
      mockPrisma,
      { get: vi.fn().mockReturnValue(SECRET) } as any,
      { get: vi.fn() } as any,
      {} as any, {} as any, {} as any, {} as any,
    );
  });

  const guardianToken = (over: any = {}) => jwt.sign(
    { type: 'guardian', sub: 'acc-g', pid: 'p-guardian', targetPid: 'p-child', guardianshipId: 'gs-1', scope: { appointments: true }, ...over },
    SECRET,
  );

  describe('resolveAuth — 보호자 토큰', () => {
    it('승인·미만료 위임이면 대상 환자 + scope 반환', async () => {
      mockPrisma.patientGuardian.findUnique.mockResolvedValue({ id: 'gs-1', isApproved: true, expiresAt: null });
      const r = await service.resolveAuth(guardianToken());
      expect(r.patientId).toBe('p-child'); // 대상(피부양자) 환자
      expect(r.guardian?.scope).toEqual({ appointments: true });
      expect(r.guardian?.guardianshipId).toBe('gs-1');
    });

    it('🔴 미승인 위임 — 401(승인 전 대리 접근 차단)', async () => {
      mockPrisma.patientGuardian.findUnique.mockResolvedValue({ id: 'gs-1', isApproved: false, expiresAt: null });
      await expect(service.resolveAuth(guardianToken())).rejects.toThrow(/유효하지 않은 보호자/);
    });

    it('🔴 위임 관계 삭제됨 — 401(토큰만으로 접근 불가)', async () => {
      mockPrisma.patientGuardian.findUnique.mockResolvedValue(null);
      await expect(service.resolveAuth(guardianToken())).rejects.toThrow(/유효하지 않은 보호자/);
    });

    it('🔴 위임 기간 만료 — 401', async () => {
      mockPrisma.patientGuardian.findUnique.mockResolvedValue({ id: 'gs-1', isApproved: true, expiresAt: new Date(Date.now() - 1000) });
      await expect(service.resolveAuth(guardianToken())).rejects.toThrow(/만료/);
    });

    it('위조/만료 JWT — 401', async () => {
      await expect(service.resolveAuth('garbage.token')).rejects.toThrow(/포털 인증/);
      await expect(service.resolveAuth(jwt.sign({ type: 'guardian' }, 'wrong-secret'))).rejects.toThrow(/포털 인증/);
    });

    it('일반 포털 토큰 — 세션 검증 경로(guardian 아님)', async () => {
      mockPrisma.portalSession.findFirst.mockResolvedValue({ id: 's-1', isActive: true, expiresAt: new Date(Date.now() + 3600_000) });
      const r = await service.resolveAuth(jwt.sign({ type: 'portal', sub: 'p-self' }, SECRET));
      expect(r.patientId).toBe('p-self');
      expect(r.guardian).toBeUndefined();
    });
  });

  describe('removeGuardian — 당사자만 해제', () => {
    it('보호자 계정이면 해제 허용', async () => {
      mockPrisma.patientAccount.findUnique.mockResolvedValue({ id: 'acc-g' });
      mockPrisma.patientGuardian.findUnique.mockResolvedValue({ id: 'gs-1', guardianAccountId: 'acc-g', dependentAccountId: 'acc-c' });
      const r = await service.removeGuardian('p-guardian', 'gs-1');
      expect(r.removed).toBe(true);
      expect(mockPrisma.patientGuardian.delete).toHaveBeenCalled();
    });

    it('🔴 제3자(관계 없는 계정) 해제 시도 — Forbidden', async () => {
      mockPrisma.patientAccount.findUnique.mockResolvedValue({ id: 'acc-stranger' });
      mockPrisma.patientGuardian.findUnique.mockResolvedValue({ id: 'gs-1', guardianAccountId: 'acc-g', dependentAccountId: 'acc-c' });
      await expect(service.removeGuardian('p-stranger', 'gs-1')).rejects.toThrow(/본인의 보호자 관계만/);
      expect(mockPrisma.patientGuardian.delete).not.toHaveBeenCalled();
    });

    it('없는 관계 — NotFound', async () => {
      mockPrisma.patientAccount.findUnique.mockResolvedValue({ id: 'acc-g' });
      mockPrisma.patientGuardian.findUnique.mockResolvedValue(null);
      await expect(service.removeGuardian('p-guardian', 'gs-x')).rejects.toThrow(/찾을 수 없습니다/);
    });
  });
});
