/**
 * 🔴 기구 세트 — **사용 시점 유효기간 검사**(2026-08-27).
 *
 * 원 결함: 패키지 경로(`CssdPackageService.usePackage`)에는 사용 시점 만료 검사가 있는데
 *   **기구 세트 경로(`CssdService.updateStatus` STERILE→IN_USE)에는 없었다.**
 *   전이표(SET_TRANSITIONS)만 보고 `expiresAt` 을 아예 읽지 않았기 때문에,
 *   자동 만료 크론이 한 번이라도 못 돌면(그 크론은 조회 실패를 조용히 삼켰다)
 *   유효기간이 지난 세트가 STERILE 인 채로 출고됐다
 *   (v4.3.0 "만료 혈소판이 출고가능"과 같은 유형 — 크론을 안전장치로 쓴 것).
 *
 * 재주입 검증(실제로 되돌려 확인함):
 *   · `updateStatus` 의 만료 분기를 지우면 → '만료 세트 출고 차단' 케이스가 실패한다
 *     (BadRequestException 이 안 나고 IN_USE 로 업데이트된다).
 * 대조군: 유효기간이 남은 세트·유효기간이 없는 세트는 그대로 출고된다(전부 막지 않는다).
 */
import { describe, it, expect, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { CssdService } from '../../src/modules/cssd/cssd.service';

const DAY = 86_400_000;

function mk(set: { status: string; expiresAt: Date | null }) {
  const prisma = {
    instrumentSet: { findUnique: vi.fn().mockResolvedValue({ id: 's1', ...set }), update: vi.fn().mockResolvedValue({ id: 's1' }) },
    sterilizationLog: { create: vi.fn().mockResolvedValue({}) },
    // 이력 기록과 상태 갱신은 한 트랜잭션(F3) — 정본의 실제 호출 모양
    $transaction: vi.fn((arg: any) => (typeof arg === 'function' ? arg(prisma) : Promise.all(arg))),
  };
  return { svc: new CssdService(prisma as never), prisma };
}

describe('기구 세트 출고 — 유효기간이 지났으면 막는다', () => {
  it('🔴 유효기간 경과 STERILE 세트를 IN_USE 로 바꾸려 하면 거부되고, 상태가 EXPIRED 로 교정된다', async () => {
    const { svc, prisma } = mk({ status: 'STERILE', expiresAt: new Date(Date.now() - DAY) });

    await expect(svc.updateStatus('s1', 'IN_USE' as never, 'u1')).rejects.toBeInstanceOf(BadRequestException);

    // 크론이 못 돌았어도 이 자리에서 바로잡는다
    expect(prisma.instrumentSet.update).toHaveBeenCalledWith({ where: { id: 's1' }, data: { status: 'EXPIRED' } });
    // 차단 사실이 그 세트의 재처리 이력에 남는다(조용히 거부하지 않는다)
    expect(prisma.sterilizationLog.create).toHaveBeenCalledTimes(1);
    expect(prisma.sterilizationLog.create.mock.calls[0][0].data.action).toBe('만료(사용 차단)');
  });

  it('대조군 — 유효기간이 남은 세트는 그대로 출고된다(전부 막으면 현장이 멈춘다)', async () => {
    const { svc, prisma } = mk({ status: 'STERILE', expiresAt: new Date(Date.now() + DAY) });

    await svc.updateStatus('s1', 'IN_USE' as never, 'u1');

    expect(prisma.instrumentSet.update).toHaveBeenCalledWith({ where: { id: 's1' }, data: { status: 'IN_USE' } });
  });

  it('대조군 — 유효기간이 기록되지 않은 세트는 만료로 단정하지 않는다(모르는 것을 만료라 말하지 않는다)', async () => {
    const { svc, prisma } = mk({ status: 'STERILE', expiresAt: null });

    await svc.updateStatus('s1', 'IN_USE' as never, 'u1');

    expect(prisma.instrumentSet.update).toHaveBeenCalledWith({ where: { id: 's1' }, data: { status: 'IN_USE' } });
  });

  it('대조군 — 만료 세트라도 재처리 방향(EXPIRED→DIRTY)은 막지 않는다', async () => {
    const { svc, prisma } = mk({ status: 'EXPIRED', expiresAt: new Date(Date.now() - DAY) });

    await svc.updateStatus('s1', 'DIRTY' as never, 'u1');

    expect(prisma.instrumentSet.update).toHaveBeenCalledWith({ where: { id: 's1' }, data: { status: 'DIRTY' } });
  });
});
