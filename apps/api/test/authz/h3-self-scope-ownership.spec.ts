import { describe, it, expect, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { AppKeyService } from '../../src/modules/mobile/app-key/app-key.service';
import { QrService } from '../../src/modules/qr/qr.service';
import { ConciergeController } from '../../src/modules/concierge/concierge.controller';

/**
 * H3(2026-09-16) — "역할 미지정 102" 를 한 건씩 판정하다 나온 **소유 대조 결손**.
 *
 * 🔴 역할을 안 거는 것이 답인 EP 라도(§5 자기 스코프), **서비스가 본인 것으로 좁히지 않으면 그건 결함**이다.
 *    E3 는 이 102 를 "①여는 것이 답 91 · ③다른 축이 막음 11" 로 분해하면서 `qr sessions/:id`·
 *    `app-key :appKeyId` 를 "D2 축" 이라며 넘겼다 — 넘긴 자리가 실제로 뚫려 있었다.
 *
 * 🔴 이 스펙은 **소스 문자열이 아니라 동작**을 본다(E2 교훈: 면제를 이름으로만 두면 그 자리의 대조를 지워도 통과했다).
 *    목은 넘겨받은 조건만 평가한다 — 조건을 빠뜨린 코드는 실제 Prisma 처럼 남의 행을 그대로 받는다.
 */
const ME = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const KEY = '33333333-3333-4333-8333-333333333333';
const SESSION = '44444444-4444-4444-8444-444444444444';

describe('🔴 앱 설치키 — URL 의 appKeyId 만으로 조회·폐기할 수 없다', () => {
  /** 파일 머리말이 "소유 세션 또는 관리자만" 이라 **약속만** 하고, 컨트롤러가 주체를 넘기지 않아 아무나 폐기할 수 있었다 */
  const mk = (ownerId: string | null, patientAccountId: string | null = null) => {
    const row = {
      id: KEY, app: 'STAFF_IOS', status: 'ACTIVE', attestationEnvironment: 'production', attestationLevel: 'ATTESTED',
      boundAt: new Date(), lastAssertedAt: null, revokedAt: null, revokeReason: null,
      staffUserId: ownerId, patientAccountId,
    };
    const prisma: any = {
      appInstallationKey: {
        findUnique: vi.fn(async ({ where }: any) => (where.id === KEY ? { ...row } : null)),
        update: vi.fn(async () => ({ id: KEY, status: 'REVOKED' })),
      },
    };
    return { svc: new AppKeyService(prisma, {} as never, {} as never), prisma };
  };

  it('남의 키 폐기 → 404 · 쓰기가 일어나지 않는다', async () => {
    const { svc, prisma } = mk(OTHER);
    await expect(svc.revoke(KEY, '분실', { userId: ME, role: 'DOCTOR' })).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.appInstallationKey.update).not.toHaveBeenCalled();
  });

  it('🔴 환자 앱 키도 직원이 폐기할 수 없다(설치 무결성 결속이 끊긴다)', async () => {
    const { svc, prisma } = mk(null, '99999999-9999-4999-8999-999999999999');
    await expect(svc.revoke(KEY, 'x', { userId: ME, role: 'NURSE' })).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.appInstallationKey.update).not.toHaveBeenCalled();
  });

  it('남의 키 상태 조회 → 404(있는 것과 없는 것을 같은 답으로)', async () => {
    const { svc } = mk(OTHER);
    await expect(svc.status(KEY, { userId: ME, role: 'DOCTOR' })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('대조군 — 내 키는 그대로 조회·폐기된다', async () => {
    const { svc, prisma } = mk(ME);
    const st = await svc.status(KEY, { userId: ME, role: 'DOCTOR' });
    expect(st.id).toBe(KEY);
    await svc.revoke(KEY, '기기 교체', { userId: ME, role: 'DOCTOR' });
    expect(prisma.appInstallationKey.update).toHaveBeenCalledTimes(1);
  });

  it('대조군 — ADMIN 은 오버사이트로 계속 조회·폐기한다', async () => {
    const { svc, prisma } = mk(OTHER);
    expect((await svc.status(KEY, { userId: ME, role: 'ADMIN' })).id).toBe(KEY);
    await svc.revoke(KEY, '퇴사', { userId: ME, role: 'ADMIN' });
    expect(prisma.appInstallationKey.update).toHaveBeenCalledTimes(1);
  });

  it('상태 응답에 소유 식별자(staffUserId·patientAccountId)를 싣지 않는다', async () => {
    const { svc } = mk(ME, null);
    const st = await svc.status(KEY, { userId: ME, role: 'DOCTOR' }) as Record<string, unknown>;
    expect(st).not.toHaveProperty('staffUserId');
    expect(st).not.toHaveProperty('patientAccountId');
  });
});

describe('🔴 QR 세션 상태 — 남의 세션을 id 로 읽지 않는다', () => {
  /** 응답의 `consumedById` 는 "그 QR 을 누가 스캔했는가"(출퇴근·출석 주체)다 */
  const mk = (createdById: string) => {
    const row = {
      id: SESSION, purpose: 'CLOCK', status: 'CONSUMED', consumedById: OTHER,
      consumedAt: new Date(), expiresAt: new Date(Date.now() + 60_000), createdById,
    };
    const prisma: any = { qrSession: { findUnique: vi.fn(async ({ where }: any) => (where.id === SESSION ? { ...row } : null)) } };
    return new QrService(prisma, {} as never, {} as never);
  };

  it('남이 만든 세션 → 404', async () => {
    await expect(mk(OTHER).getStatus(SESSION, { userId: ME, role: 'NURSE' })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('대조군 — 내가 만든 세션은 그대로 폴링된다(키오스크가 자기 세션을 본다)', async () => {
    const r = await mk(ME).getStatus(SESSION, { userId: ME, role: 'NURSE' });
    expect(r.status).toBe('CONSUMED');
    expect(r.consumedById).toBe(OTHER); // 스캔 주체는 창구가 봐야 하는 값이다
  });

  it('응답에 createdById 를 싣지 않는다', async () => {
    const r = await mk(ME).getStatus(SESSION, { userId: ME, role: 'ADMIN' }) as Record<string, unknown>;
    expect(r).not.toHaveProperty('createdById');
  });
});

describe('🔴 컨시어지 만족도 — 형제와 같은 역할 · 0건 갱신을 "등록되었습니다" 라 하지 않는다', () => {
  const mkCtl = (count: number) => {
    const svc: any = { rateSession: vi.fn(async () => ({ count })) };
    return new ConciergeController(svc);
  };

  it('세션↔환자 짝이 틀려 0건이면 404(P16: 실행하지 않고 성공만 기록 금지)', async () => {
    await expect(mkCtl(0).rateSession(SESSION, { patientId: OTHER, rating: 5 })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('대조군 — 1건 갱신되면 등록으로 답한다', async () => {
    const r = await mkCtl(1).rateSession(SESSION, { patientId: ME, rating: 4, comment: '좋았습니다' });
    expect(r.data.message).toContain('등록');
  });
});
