import { describe, it, expect, vi } from 'vitest';
import { IntegrationOutboxService } from '../../src/modules/integration/integration-outbox.service';

/**
 * 🔴 리허설 모드가 `CrmChannelService`(문자·메일·포털)만 막고 **웹훅 발송은 그대로 나가고 있었다**
 *    (2026-08-26). 리허설에서 눌러본 이벤트가 협력사·ERP 수신부에 실제로 도착했다는 뜻이다.
 *
 * 🔴 보류는 성공도 실패도 아니다 — 행 상태를 바꾸지 않는다.
 *    `SENT` 로 적으면 거짓말이고, `retry` 로 넘기면 실패하지 않은 것의 attempts 를 태워 결국 FAILED 가 된다.
 */
const rows = [{
  id: 'o1', ref: 'r1', event: 'e', payload: {}, format: 'ERP', targetUrl: 'https://x.example/hook',
  secret: '', attempts: 0, maxAttempts: 5,
}];

const make = (mode: 'DEV' | 'REHEARSAL' | 'REAL') => {
  const prisma = {
    integrationOutbox: {
      findMany: vi.fn().mockResolvedValue(rows),
      count: vi.fn().mockResolvedValue(rows.length),
      update: vi.fn().mockResolvedValue({}),
    },
    hisWebhook: { updateMany: vi.fn().mockResolvedValue({}) },
  } as any;
  const config = { get: vi.fn().mockResolvedValue('') } as any;
  const hisMode = { effective: vi.fn().mockResolvedValue(mode) } as any;
  return { svc: new IntegrationOutboxService(prisma, config, hisMode), prisma };
};

describe('외부 웹훅 발송은 리얼 모드에서만', () => {
  it('🔴 리허설이면 조회조차 하지 않고 보류한다(행을 건드리지 않는다)', async () => {
    const { svc, prisma } = make('REHEARSAL');
    await svc.dispatch();
    expect(prisma.integrationOutbox.findMany, '보류인데 발송 대상을 꺼냈다').not.toHaveBeenCalled();
    expect(prisma.integrationOutbox.update, '보류인데 상태를 바꿨다').not.toHaveBeenCalled();
  });

  it('🔴 개발 모드도 같다', async () => {
    const { svc, prisma } = make('DEV');
    await svc.dispatch();
    expect(prisma.integrationOutbox.update).not.toHaveBeenCalled();
  });

  it('🔴 대조군 — 리얼 모드에서는 실제로 발송을 시도한다(막아버리면 개통이 안 된다)', async () => {
    const { svc, prisma } = make('REAL');
    await svc.dispatch().catch(() => {}); // 네트워크는 실패해도 된다 — 여기서 보는 것은 "시도했는가"
    expect(prisma.integrationOutbox.findMany, '리얼인데 발송 대상을 꺼내지 않았다').toHaveBeenCalled();
  });
});
