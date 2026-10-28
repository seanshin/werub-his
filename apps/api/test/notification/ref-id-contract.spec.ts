import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NotificationService } from '../../src/modules/notification/notification.service';

/**
 * 알림 refId 계약 — 2026-08-03.
 *
 * `Notification.refId` 는 `@db.Uuid` 다. 코드·일련번호를 넘기면 Prisma 가 P2023 으로 죽어
 * **알림 자체가 생성되지 않는다**. 호출부가 예외를 삼키면(`.catch(() => …)`) 로그에는
 * 성공으로 남아 유실이 보이지 않는다.
 *
 * 🔴 실제로 그렇게 유실됐다(운영 실측): 응급 코드 방송 `CODE_ALERT` **0건**,
 *    검진권 체인 위반 상신 `VOUCHER_CHAIN_BROKEN` **0건**. 같은 경로의 `SECURITY`(기기 등록)는
 *    refId 가 UUID 라 8건 정상 발신 — 형식이 갈랐다.
 */
function svc() {
  const prisma = { notification: { create: vi.fn(async ({ data }: any) => ({ ...data, id: 'n1' })) } };
  return { s: new NotificationService(prisma as never), prisma };
}

const UUID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';

describe('알림 refId 방어', () => {
  it('UUID 는 그대로 저장한다', async () => {
    const { s, prisma } = svc();
    await s.create(UUID, { type: 'X', title: 't', message: 'm', refId: UUID });
    expect(prisma.notification.create.mock.calls[0][0].data.refId).toBe(UUID);
  });

  it('UUID 가 아닌 refId 는 링크만 버리고 알림은 발신한다', async () => {
    const { s, prisma } = svc();
    // 종전 결함 값들 — 이 값이 그대로 내려가면 Prisma 가 죽어 통보가 통째로 사라진다
    for (const bad of ['CODE BLUE', 'WGC-AM26-0001-000001-F44D', '']) {
      await s.create(UUID, { type: 'CODE_ALERT', title: 't', message: 'm', refId: bad });
    }
    expect(prisma.notification.create).toHaveBeenCalledTimes(3);
    for (const call of prisma.notification.create.mock.calls) {
      expect(call[0].data.refId).toBeUndefined();
    }
  });
});

describe('상신 호출부 계약', () => {
  const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf-8');

  it('응급 코드 방송은 도달한 인원만 센다', () => {
    const src = read('src/modules/emergency/emergency.service.ts');
    // refId 에 코드 문자열을 다시 넣지 않는다
    expect(src).not.toMatch(/refId:\s*code/);
    // 발송 시도 수를 통보 수로 보고하지 않는다(실패가 성공으로 보이던 형태)
    expect(src).not.toMatch(/notified\s*=\s*staff\.length/);
    expect(src).toMatch(/notified\s*=\s*results\.filter\(Boolean\)\.length/);
  });

  it('검진권 체인 상신은 await 하고 전멸 시 로그를 남긴다', () => {
    const src = read('src/modules/voucher/voucher-cron.service.ts');
    // 🔴 요지는 **refId 가 엔티티 id(UUID)** 라는 것이다 — 배열 이름은 계약이 아니다.
    //    (2026-08-30: 반복 경보 억제로 `broken` → `fresh`(신규분)로 바뀌었다.)
    expect(src).toMatch(/refId:\s*\w+\[0\]\.id/);
    expect(src, '일련번호를 refId 로 넘기면 Prisma P2023 으로 알림이 통째로 유실된다')
      .not.toMatch(/refId:\s*\w+\[0\]\.serial/);
    expect(src).toMatch(/await this\.notifications\?\.notify\(/);
    expect(src).toMatch(/sent === 0/);
  });
});
