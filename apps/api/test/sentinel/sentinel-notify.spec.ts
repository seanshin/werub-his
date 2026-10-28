import { describe, it, expect, vi } from 'vitest';
import { SentinelNotifyService } from '../../src/sentinel/sentinel-notify.service';
import { SentinelService } from '../../src/sentinel/sentinel.service';

/**
 * P4 — 상시 감시 알림.
 *
 * 🔴 완료 판정: **기존 항목 재알림 0.** 매 스윕 같은 것을 다시 알리면 소음이 되고,
 *    소음은 진짜 경보를 죽인다. 그래서 스윕은 **처음 만든 행과 재발**에만 표시를 세운다.
 */
function mkPrisma(findings: Record<string, unknown>[] = [], admins = ['u1']) {
  const updated: Record<string, unknown>[] = [];
  const updatedMany: Record<string, unknown>[] = [];
  return {
    updated, updatedMany,
    sentinelFinding: {
      findMany: vi.fn(async () => findings),
      update: vi.fn(async (a: Record<string, unknown>) => { updated.push(a); return {}; }),
      updateMany: vi.fn(async (a: Record<string, unknown>) => { updatedMany.push(a); return {}; }),
    },
    user: { findMany: vi.fn(async () => admins.map((id) => ({ id }))) },
  };
}
const mkNotify = () => ({ notify: vi.fn(async () => ({ id: 'n1' })) });
const mkConfig = (vals: Record<string, unknown> = {}) => ({
  get: vi.fn(async (k: string) => (k in vals ? vals[k] : undefined)),
});
const mkRead = (axes: Record<string, unknown>[]) => ({ overview: vi.fn(async () => ({ axes })) });

const finding = (over: Record<string, unknown> = {}) => ({
  id: '11111111-1111-4111-8111-111111111111',
  axis: 'DATA', checkKey: 'integrity.09', severity: 'RED', label: '서명된 진료인데 진단 없음',
  value: 83, detail: null, unobservable: false, notifyPending: true, ...over,
});

describe('신규 알림 — 무엇을 보내고 무엇을 보내지 않는가', () => {
  it('적색 신규 발견을 관리자에게 보낸다', async () => {
    const prisma = mkPrisma([finding()]);
    const notif = mkNotify();
    const svc = new SentinelNotifyService(prisma as never, notif as never, mkConfig() as never, mkRead([]) as never);
    const r = await svc.sendNew();
    expect(r.sent).toBe(1);
    expect(notif.notify).toHaveBeenCalledTimes(1);
    const arg = notif.notify.mock.calls[0][1] as { severity: string; type: string; title: string; refId: string };
    expect(arg.type).toBe('SENTINEL_FINDING');
    // 🔴 임상 경보와 같은 색으로 뜨면 진짜 경보가 묻힌다
    expect(arg.severity).toBe('INFO');
    expect(arg.title).toContain('데이터 정합성');
    // 🔴 refId 는 UUID 여야 정본이 링크를 만든다(코드를 넘기면 링크가 생략된다)
    expect(arg.refId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('🔴 보낸 뒤 표시를 내린다 — 다음 주기에 같은 것을 다시 보내지 않는다(완료 판정)', async () => {
    const prisma = mkPrisma([finding()]);
    const svc = new SentinelNotifyService(prisma as never, mkNotify() as never, mkConfig() as never, mkRead([]) as never);
    await svc.sendNew();
    expect(prisma.updated).toHaveLength(1);
    expect((prisma.updated[0] as { data: { notifyPending: boolean; notifiedAt: Date } }).data.notifyPending).toBe(false);
    expect((prisma.updated[0] as { data: { notifiedAt: Date } }).data.notifiedAt).toBeInstanceOf(Date);
  });

  it('🔴 관측 불가는 어떤 설정에서도 알리지 않는다 — "확인 못 함"으로 사람을 깨우지 않는다', async () => {
    const prisma = mkPrisma([finding({ unobservable: true })]);
    const notif = mkNotify();
    const svc = new SentinelNotifyService(
      prisma as never, notif as never,
      mkConfig({ 'sentinel.notify.severities': ['RED', 'AMBER', 'INFO'] }) as never, mkRead([]) as never,
    );
    const r = await svc.sendNew();
    expect(notif.notify).not.toHaveBeenCalled();
    expect(r.sent).toBe(0);
    // 화면에는 남지만 알림 표시는 내린다(매번 재검토하지 않게)
    expect(prisma.updatedMany).toHaveLength(1);
  });

  it('설정된 심각도 밖은 보내지 않는다(기본은 적색만)', async () => {
    const prisma = mkPrisma([finding({ severity: 'AMBER' }), finding({ severity: 'INFO', id: '22222222-2222-4222-8222-222222222222' })]);
    const notif = mkNotify();
    const svc = new SentinelNotifyService(prisma as never, notif as never, mkConfig() as never, mkRead([]) as never);
    const r = await svc.sendNew();
    expect(notif.notify).not.toHaveBeenCalled();
    expect(r.attempted).toBe(2);
    expect(r.sent).toBe(0);
  });

  it('설정을 넓히면 황색도 간다(대조군 — 설정이 실제로 동작한다)', async () => {
    const prisma = mkPrisma([finding({ severity: 'AMBER' })]);
    const notif = mkNotify();
    const svc = new SentinelNotifyService(
      prisma as never, notif as never,
      mkConfig({ 'sentinel.notify.severities': ['RED', 'AMBER'] }) as never, mkRead([]) as never,
    );
    expect((await svc.sendNew()).sent).toBe(1);
  });

  it('꺼져 있으면 보내지 않고 사유를 돌려준다', async () => {
    const prisma = mkPrisma([finding()]);
    const notif = mkNotify();
    const svc = new SentinelNotifyService(
      prisma as never, notif as never,
      mkConfig({ 'sentinel.notify.enabled': false }) as never, mkRead([]) as never,
    );
    const r = await svc.sendNew();
    expect(notif.notify).not.toHaveBeenCalled();
    expect(r.reason).toMatch(/enabled=false/);
  });

  it('🔴 발신 실패는 표시를 내리지 않는다 — 다음 주기에 다시 시도한다', async () => {
    const prisma = mkPrisma([finding()]);
    const notif = { notify: vi.fn(async () => { throw new Error('DB 오류'); }) };
    const svc = new SentinelNotifyService(prisma as never, notif as never, mkConfig() as never, mkRead([]) as never);
    const r = await svc.sendNew();
    expect(r.sent).toBe(0);
    expect(prisma.updated, '실패했는데 보낸 것으로 표시하면 그 발견은 영영 안 간다').toHaveLength(0);
  });

  it('관리자가 없으면 보내지 않는다(0명에게 보냈다고 말하지 않는다)', async () => {
    const prisma = mkPrisma([finding()], []);
    const notif = mkNotify();
    const svc = new SentinelNotifyService(prisma as never, notif as never, mkConfig() as never, mkRead([]) as never);
    expect((await svc.sendNew()).sent).toBe(0);
    expect(notif.notify).not.toHaveBeenCalled();
  });
});

describe('주간 요약 — 미판정을 0으로 합치지 않는다', () => {
  it('축별 상태를 그대로 옮긴다', async () => {
    const notif = mkNotify();
    const read = mkRead([
      { key: 'DATA', label: '데이터 정합성', open: 20, bySeverity: { RED: 6, AMBER: 8, INFO: 6 }, unobservable: 0, unavailableReason: null },
      { key: 'FLOW', label: '흐름 완결성', open: 0, bySeverity: { RED: 0, AMBER: 0, INFO: 0 }, unobservable: 3, unavailableReason: null },
      { key: 'CONTRACT', label: '계약 드리프트', open: null, bySeverity: null, unobservable: null, unavailableReason: '스윕이 아직 한 번도 실행되지 않았습니다.' },
    ]);
    const svc = new SentinelNotifyService(mkPrisma() as never, notif as never, mkConfig() as never, read as never);
    const r = await svc.weeklyDigest();
    expect(r.sent).toBe(1);
    const msg = (notif.notify.mock.calls[0][1] as { message: string }).message;
    expect(msg).toContain('데이터 정합성: 미해결 20 (적색 6)');
    expect(msg, '관측 불가를 0으로 합치면 요약이 화면보다 낙관적이 된다').toContain('관측 불가 3');
    expect(msg, '미판정을 0으로 적으면 안 된다').toContain('계약 드리프트: 미판정');
  });

  it('꺼져 있으면 보내지 않는다', async () => {
    const notif = mkNotify();
    const svc = new SentinelNotifyService(
      mkPrisma() as never, notif as never,
      mkConfig({ 'sentinel.notify.weeklyDigest': false }) as never, mkRead([]) as never,
    );
    expect((await svc.weeklyDigest()).sent).toBe(0);
    expect(notif.notify).not.toHaveBeenCalled();
  });
});

/** 스윕이 표시를 세우는 규칙 — 여기가 "재알림 0"의 진짜 근원이다 */
function sweepPrisma(existing: Record<string, unknown> | null) {
  const runs: Record<string, unknown>[] = [];
  const written: Record<string, unknown>[] = [];
  return {
    written,
    sentinelRun: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { const r = { id: 'r', ...data }; runs.push(r); return r; }),
      update: vi.fn(async () => ({})),
      findFirst: vi.fn(async () => null),
    },
    sentinelFinding: {
      findUnique: vi.fn(async () => existing),
      upsert: vi.fn(async (a: Record<string, unknown>) => { written.push(a); return {}; }),
      findMany: vi.fn(async () => []),
    },
    sentinelRuntimeSignal: { findMany: vi.fn(async () => []), upsert: vi.fn(async () => ({})) },
    $queryRawUnsafe: vi.fn(async () => [{ 구분: '🔴', '점검 항목': '09 서명된 진료인데 진단 없음', 건수: 83 }]),
  };
}

describe('🔴 스윕이 표시를 세우는 규칙 — 기존 항목 재알림 0', () => {
  const ROOT = process.cwd() + '/../..';

  it('처음 만드는 위반은 알림 대상이다', async () => {
    const prisma = sweepPrisma(null);
    await new SentinelService(prisma as never).sweepData(ROOT);
    const w = prisma.written[0] as { create: { notifyPending: boolean } };
    expect(w.create.notifyPending).toBe(true);
  });

  it('🔴 이미 있는 위반은 매 스윕 다시 알리지 않는다(완료 판정의 핵심)', async () => {
    const prisma = sweepPrisma({ value: 83, resolvedAt: null });
    await new SentinelService(prisma as never).sweepData(ROOT);
    const w = prisma.written[0] as { update: Record<string, unknown> };
    expect(w.update.notifyPending, '기존 위반을 다시 알리면 소음이 된다').toBeUndefined();
  });

  it('해결됐다가 재발하면 다시 알린다', async () => {
    const prisma = sweepPrisma({ value: 0, resolvedAt: new Date() });
    await new SentinelService(prisma as never).sweepData(ROOT);
    const w = prisma.written[0] as { update: { notifyPending?: boolean } };
    expect(w.update.notifyPending).toBe(true);
  });

  it('처음 봤는데 0이면 알리지 않는다(없던 문제를 만들지 않는다)', async () => {
    const prisma = sweepPrisma(null);
    prisma.$queryRawUnsafe = vi.fn(async () => [{ 구분: '⚪', '점검 항목': '07 ACTIVE 처방인데 오더 없음', 건수: 0 }]) as never;
    await new SentinelService(prisma as never).sweepData(ROOT);
    const w = prisma.written[0] as { create: { notifyPending: boolean } };
    expect(w.create.notifyPending).toBe(false);
  });
});
