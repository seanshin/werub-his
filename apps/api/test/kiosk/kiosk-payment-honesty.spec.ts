import { describe, it, expect, beforeEach, vi } from 'vitest';
import { KioskService } from '../../src/modules/kiosk/kiosk.service';
import { BadRequestException, UnauthorizedException } from '@nestjs/common';

/**
 * 무인 키오스크 — 수납 정직성과 본인확인 오라클 가드.
 *
 * 🔴 실측 결함(2026-08-19):
 *   ① PG·VAN 연동이 **전혀 없는데** `cardApprovalNo: KIOSK-${Date.now()}` 로
 *      **승인번호를 지어내 수납을 확정**하고 있었다. 돈은 오가지 않았는데 원장에는 '수납 완료'가 남는다.
 *      (실행하지 않고 성공 상태만 기록 — 이 저장소가 P16 이라 부르는 것. 여기서는 금전 기록이다.)
 *   ② 등록번호 부존재(404)와 생년월일 불일치(400)를 갈라서 답해 **MRN 열거 오라클**이었다.
 *      무인증 공개 단말이고 계정 잠금도 없다.
 *
 * 재주입하면 실패한다: 게이트를 지우거나 승인번호를 다시 만들어 넣으면 곧바로 깨진다.
 */
describe('키오스크 — 수납 정직성 · 본인확인', () => {
  let service: KioskService;
  let prisma: any;
  let billing: any;
  let config: any;

  const PATIENT = { id: 'p-1', familyName: '김', givenName: '환자', dateOfBirth: new Date('1985-03-12T00:00:00.000Z') };
  const BILLING = { id: 'b-1', totalAmount: 30000, patientCopay: 9000, paidAmount: 0, status: 'PENDING' };

  beforeEach(() => {
    prisma = {
      patient: { findUnique: vi.fn().mockResolvedValue(PATIENT) },
      billing: { findMany: vi.fn().mockResolvedValue([BILLING]) },
    };
    billing = { pay: vi.fn().mockResolvedValue({}) };
    config = { get: vi.fn().mockResolvedValue(false) };
    service = new KioskService(prisma as any, { } as any, billing as any, config as any);
  });

  describe('수납', () => {
    it('🔴 기본은 OFF — 결제를 확정하지 않고, 창구로 안내한다(전송을 흉내내지 않는다)', async () => {
      await expect(service.pay('P2026-0001', '19850312', 'CARD')).rejects.toThrow(BadRequestException);
      expect(billing.pay).not.toHaveBeenCalled();
    });

    it('OFF 안내에 미납 건수·금액은 사실대로 알려준다(조회는 유용하므로 막지 않는다)', async () => {
      await expect(service.pay('P2026-0001', '19850312', 'CARD')).rejects.toThrow(/미납 1건/);
    });

    it('🔴 게이트를 켜도 승인번호를 만들어 넣지 않는다 — 승인 정보는 결제 단말이 주는 것이다', async () => {
      config.get.mockResolvedValue(true);

      await service.pay('P2026-0001', '19850312', 'CARD');

      expect(billing.pay).toHaveBeenCalledTimes(1);
      const dto = billing.pay.mock.calls[0][1];
      expect(dto.cardApprovalNo).toBeUndefined();
      expect(JSON.stringify(dto)).not.toContain('KIOSK-');
    });

    it('게이트 값이 문자열 "true" 여도 켜진 것으로 오해하지 않는다', async () => {
      config.get.mockResolvedValue('true');
      await expect(service.pay('P2026-0001', '19850312', 'CARD')).rejects.toThrow(BadRequestException);
      expect(billing.pay).not.toHaveBeenCalled();
    });

    it('config 미주입(부분 부트)이면 켜지 않는다 — 모르면 안전측으로 접는다', async () => {
      const bare = new KioskService(prisma as any, { } as any, billing as any, undefined);
      await expect(bare.pay('P2026-0001', '19850312', 'CARD')).rejects.toThrow(BadRequestException);
      expect(billing.pay).not.toHaveBeenCalled();
    });
  });

  describe('본인확인', () => {
    it('🔴 등록번호 부존재와 생년월일 불일치를 구분해 주지 않는다(MRN 열거 오라클 금지)', async () => {
      const wrongDob = await service.pay('P2026-0001', '19700101', 'CARD').catch((e) => e);
      prisma.patient.findUnique.mockResolvedValue(null);
      const noSuchMrn = await service.pay('P2026-9999', '19700101', 'CARD').catch((e) => e);

      expect(wrongDob).toBeInstanceOf(UnauthorizedException);
      expect(noSuchMrn).toBeInstanceOf(UnauthorizedException);
      expect(wrongDob.message).toBe(noSuchMrn.message);
      // 어느 쪽이 틀렸는지 말하지 않는다
      expect(wrongDob.message).not.toMatch(/생년월일이 일치하지 않습니다$/);
      expect(wrongDob.message).not.toMatch(/등록번호를 찾을 수 없습니다/);
    });

    it('본인확인 실패는 결제를 시도조차 하지 않는다', async () => {
      prisma.patient.findUnique.mockResolvedValue(null);
      await service.pay('P2026-9999', '19700101', 'CARD').catch(() => undefined);
      expect(billing.pay).not.toHaveBeenCalled();
    });
  });
});
