import { describe, it, expect, vi } from 'vitest';
import { ConsentDeviceService } from '../../src/modules/consent/consent-device.service';

/**
 * 태블릿 등록 EP(`POST /api/v1/consent-device/enroll`, 무인증)가 **자격증명을 내주는 문**이다.
 *
 * 🔴 (2026-09-16 H1 실측) 종전엔 이미 등록된 기기에 대해 `deviceUid` 만 제시하면
 *    **기존 `deviceSecret` 을 그대로 반환**했다(멱등 반환). 그런데
 *    ① `deviceUid` 는 비밀이 아니다 — `GET /consent-device/:uid`·heartbeat·stream 의 **URL 경로**에 실려
 *       서버·프록시 로그와 브라우저 기록에 남는다.
 *    ② `deviceSecret` 은 그 태블릿의 **유일한 문턱**이다(`consent-device-secret-gate.spec` 선언).
 *       secret → SSE 구독 + `currentToken` 열람 → `/consent-sign/:token` 에서 **환자 성명·MRN·생년월일**
 *       열람과 **서명 제출**까지 열린다.
 *    기존 가드는 secret 을 **쓰는 문**만 지켰고 secret 을 **내주는 문**은 아무도 보지 않았다.
 *
 * 규약: 재요청에 secret 을 주려면 ① 소지 증명(현재 secret) 또는 ② 직원이 발급한 페어링 코드가 있어야 한다.
 */

const EXISTING = {
  id: 'dev-row-1', deviceUid: 'uid-공개식별자', deviceSecret: 'S3CRET-48',
  name: '외래 태블릿', approvalStatus: 'APPROVED', status: 'IDLE', isActive: true,
};

function makeSvc(existing: unknown, codeConsumed = 1) {
  // 🔴 (2026-09-17 L1) 코드 소비↔기기 등록이 `$transaction` 으로 묶였다 — 목에 `$transaction` 이
  //    없으면 콜백이 아예 실행되지 않아 이 게이트 테스트가 공허하게 통과한다.
  const prisma: Record<string, unknown> = {
    consentSigningDevice: {
      findUnique: vi.fn().mockResolvedValue(existing),
      create: vi.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => ({ id: 'new-row', ...data })),
      update: vi.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => ({ ...EXISTING, ...data })),
    },
    devicePairingCode: { updateMany: vi.fn().mockResolvedValue({ count: codeConsumed }) },
  };
  prisma.$transaction = vi.fn(async (cb: unknown) =>
    typeof cb === 'function' ? (cb as (c: unknown) => unknown)(prisma) : Promise.all(cb as unknown[]),
  );
  const svc = new ConsentDeviceService(prisma as never, { emitWorkstation: vi.fn() } as never);
  return { svc, prisma };
}

describe('enroll — 등록된 기기의 deviceSecret 재발급 게이트', () => {
  it('🔴 uid 만으로는 기존 secret 을 주지 않는다(자격증명↔식별자 맞바꾸기 금지)', async () => {
    const { svc } = makeSvc(EXISTING);
    const r = await svc.enroll({ deviceUid: EXISTING.deviceUid, name: '아무 이름' });
    expect(r.deviceSecret).toBeNull();
    expect((r as { pairingRequired?: boolean }).pairingRequired).toBe(true);
    expect(r.approvalStatus).toBe('APPROVED'); // 상태 확인은 계속 된다
  });

  it('🔴 틀린 secret 으로도 주지 않는다', async () => {
    const { svc } = makeSvc(EXISTING);
    const r = await svc.enroll({ deviceUid: EXISTING.deviceUid, name: '태블릿', secret: 'WRONG-SECRET-48-chars-padding' });
    expect(r.deviceSecret).toBeNull();
  });

  it('대조군 — 소지 증명(현재 secret)이면 그대로 돌려준다(이중 제출 멱등)', async () => {
    const { svc } = makeSvc(EXISTING);
    const r = await svc.enroll({ deviceUid: EXISTING.deviceUid, name: '외래 태블릿', secret: 'S3CRET-48' });
    expect(r.deviceSecret).toBe('S3CRET-48');
  });

  it('대조군 — 직원 발급 페어링 코드면 재페어링하되 secret 을 **교체**한다(유출 secret 무효화)', async () => {
    const { svc, prisma } = makeSvc(EXISTING);
    const r = await svc.enroll({ deviceUid: EXISTING.deviceUid, name: '외래 태블릿', code: '123456' });
    expect(r.deviceSecret).toBeTruthy();
    expect(r.deviceSecret).not.toBe('S3CRET-48');
    // 코드를 실제로 소비했는가(ACTIVE·미만료 조건으로 원자적 소비)
    const consume = prisma.devicePairingCode.updateMany.mock.calls[0][0];
    expect(consume.where.status).toBe('ACTIVE');
    expect(consume.where.expiresAt).toBeTruthy();
    expect(consume.data.status).toBe('USED');
  });

  it('🔴 만료·소진 코드로는 재페어링되지 않는다', async () => {
    const { svc } = makeSvc(EXISTING, 0);
    await expect(svc.enroll({ deviceUid: EXISTING.deviceUid, name: '태블릿', code: '999999' })).rejects.toThrow();
  });

  it('대조군 — 신규 기기는 종전대로 secret 을 발급받는다', async () => {
    const { svc } = makeSvc(null);
    const r = await svc.enroll({ deviceUid: 'uid-new', name: '신규 태블릿' });
    expect(r.deviceSecret).toBeTruthy();
    expect(r.approvalStatus).toBe('PENDING');
  });

  it('🔴 코드 주입(객체) — 문자열로 고정해 임의 ACTIVE 코드 소비를 막는다', async () => {
    const { svc, prisma } = makeSvc(EXISTING);
    await expect(
      svc.enroll({ deviceUid: EXISTING.deviceUid, name: '태블릿', code: { not: '__x__' } as unknown as string }),
    ).resolves.toBeTruthy();
    const consume = prisma.devicePairingCode.updateMany.mock.calls[0][0];
    expect(typeof consume.where.code).toBe('string');
  });
});
