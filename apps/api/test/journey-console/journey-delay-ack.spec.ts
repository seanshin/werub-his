import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { JourneyAckService, flagKeyOf } from '../../src/modules/journey-console/journey-ack.service';

/**
 * 신규 — 여정 지연 **확인·조치 기록**(2026-08-26).
 *
 * 🔴 관제는 지연을 보여줬지만 무엇을 했는지 남는 자리가 없었다. 같은 카드가 교대 내내
 *    빨갛게 떠 있고, 다음 근무자는 앞 사람이 이미 연락했는지 알 수 없었다.
 */
const SVC = join(process.cwd(), 'src/modules/journey-console/journey-ack.service.ts');
const CONSOLE_SVC = join(process.cwd(), 'src/modules/journey-console/journey-console.service.ts');

const TH = { opdWaitMin: 30, callDelayMin: 10, cashierDelayMin: 20, consultDelayMin: 60 };

const mk = (rows: unknown[] = [], fail = false) => {
  const create = vi.fn().mockImplementation((a: { data: Record<string, unknown> }) => ({ ...a.data }));
  const findMany = vi
    .fn()
    .mockImplementation(() => (fail ? Promise.reject(new Error('db')) : Promise.resolve(rows)));
  return { prisma: { journeyDelayAck: { create, findMany } } as never, create, findMany };
};

describe('확인 기록', () => {
  it('🔴 무엇을 했는지 없으면 확인이 아니다', async () => {
    const svc = new JourneyAckService(mk().prisma);
    await expect(
      svc.ack({ patientId: 'p', track: 'OPD', stage: 'RECEPTION', flags: ['WAIT_DELAY'], note: '  ' }, 'u', TH),
    ).rejects.toThrow(/적어 주세요/);
  });

  it('🔴 지연이 아닌 카드에는 확인을 남기지 않는다', async () => {
    const svc = new JourneyAckService(mk().prisma);
    await expect(
      svc.ack({ patientId: 'p', track: 'OPD', stage: 'RECEPTION', flags: [], note: '봤음' }, 'u', TH),
    ).rejects.toThrow(/지연으로 표시된 항목만/);
  });

  it('모르는 단계·트랙은 받지 않는다', async () => {
    const svc = new JourneyAckService(mk().prisma);
    await expect(
      svc.ack({ patientId: 'p', track: 'XX', stage: 'RECEPTION', flags: ['WAIT_DELAY'], note: 'a' }, 'u', TH),
    ).rejects.toThrow(/알 수 없는 트랙/);
    await expect(
      svc.ack({ patientId: 'p', track: 'OPD', stage: 'NOWHERE', flags: ['WAIT_DELAY'], note: 'a' }, 'u', TH),
    ).rejects.toThrow(/알 수 없는 단계/);
  });

  it('🔴 확인 유효 시간은 그 지연을 판정한 임계와 같다', () => {
    const svc = new JourneyAckService(mk().prisma);
    expect(svc.ttlMinutes(['WAIT_DELAY'], TH)).toBe(30);
    expect(svc.ttlMinutes(['CALL_DELAY'], TH)).toBe(10);
  });

  it('🔴 여러 지연이 겹치면 가장 짧은 임계를 따른다 — 급한 쪽이 먼저 다시 뜬다', () => {
    const svc = new JourneyAckService(mk().prisma);
    expect(svc.ttlMinutes(['WAIT_DELAY', 'CALL_DELAY'], TH)).toBe(10);
  });

  it('임계가 없는 지연(장기재원 등)도 유효 시간을 갖는다 — 화면이 "언제까지"를 항상 말한다', () => {
    const svc = new JourneyAckService(mk().prisma);
    expect(svc.ttlMinutes(['LONG_STAY'], TH)).toBeGreaterThan(0);
  });

  it('확인 유효 시간에 상한이 있다 — 임계가 아무리 길어도 무한히 덮지 않는다', () => {
    const svc = new JourneyAckService(mk().prisma);
    expect(svc.ttlMinutes(['WAIT_DELAY'], { ...TH, opdWaitMin: 100000 })).toBeLessThanOrEqual(8 * 60);
  });

  it('플래그 조합 키는 순서에 무관하고 중복을 접는다', () => {
    expect(flagKeyOf(['B', 'A'])).toBe(flagKeyOf(['A', 'B', 'A']));
  });

  it('🔴 새 지연이 붙으면 이전 확인이 덮지 못한다', async () => {
    const now = new Date(Date.now() + 60_000);
    const { prisma } = mk([
      { patientId: 'p1', flagKey: 'WAIT_DELAY', note: '연락함', ackedAt: new Date(), expiresAt: now, user: null },
    ]);
    const svc = new JourneyAckService(prisma);
    const { map } = await svc.activeAcks(['p1']);
    expect(map.get(`p1|${flagKeyOf(['WAIT_DELAY'])}`)).toBeTruthy();
    // 지연이 하나 더 붙으면 키가 달라져 이 확인이 적용되지 않는다
    expect(map.get(`p1|${flagKeyOf(['WAIT_DELAY', 'HIGH_UNPAID'])}`)).toBeUndefined();
  });

  it('🔴 조회 실패를 "확인 없음"으로 번역하지 않는다 — 같은 환자에게 두 번 연락하게 된다', async () => {
    const svc = new JourneyAckService(mk([], true).prisma);
    const r = await svc.activeAcks(['p1']);
    expect(r.failed).toBe(true);
    expect(r.map.size).toBe(0);
  });

  it('대조군 — 성공하면 실패라고 말하지 않는다', async () => {
    const svc = new JourneyAckService(mk([]).prisma);
    const r = await svc.activeAcks(['p1']);
    expect(r.failed).toBe(false);
  });

  it('만료된 확인은 조회 조건에서 빠진다', async () => {
    const { prisma, findMany } = mk([]);
    await new JourneyAckService(prisma).activeAcks(['p1']);
    const where = (findMany.mock.calls[0][0] as { where: { expiresAt: { gt: Date } } }).where;
    expect(where.expiresAt.gt).toBeInstanceOf(Date);
  });

  it('🔴 확인이 지연을 지우지 않는다 — 보드는 flags 를 그대로 두고 ack 만 덧붙인다', () => {
    const src = readFileSync(CONSOLE_SVC, 'utf8');
    expect(src).toMatch(/\)\.ack = ack;/);
    // 대조군: flags 를 비우거나 거르는 코드가 없어야 한다
    expect(src).not.toMatch(/c\.flags\s*=\s*\[\]/);
  });

  it('🔴 확인 결과가 "지연 표시는 남는다"를 말한다', () => {
    const src = readFileSync(SVC, 'utf8');
    expect(src).toMatch(/지연 표시는 그대로 남습니다/);
  });
});
