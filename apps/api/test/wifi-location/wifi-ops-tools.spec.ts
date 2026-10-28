import { describe, it, expect, vi } from 'vitest';
import { createHash } from 'crypto';
import { WifiRegistryService } from '../../src/modules/wifi-location/wifi-registry.service';

/**
 * 무선 위치 운영 도구(2026-10-10) — 결정 뒤 실제 운영을 시작할 때 쓰는 것.
 *  · 수집기 키 교체: 새 키 원문 한 번 · 이전 키 즉시 무효(해시 교체) · 교체 시각
 *  · AP CSV 가져오기: 🔴 한 줄이라도 틀리면 넣지 않음 · 도면에 없는 층 · 이미 있는 BSSID 건너뜀(덮지 않음) · 미리보기 쓰기 0
 *  · 일괄 해제: 사유 필수 · 상한 · 이미 해제는 건너뜀
 *  · 환자 상태 거르기: 열린 연결에서만 · 상한 전에 거름
 */
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const GEO_CTX = {
  floors: [{ key: '1F', level: 1 }, { key: '2F', level: 2 }],
  spacesByFloor: new Map([['1F', [{ spaceNodeId: 'room-1', rect: { x: 0, y: 0, w: 10, h: 10 } }]]]),
};
function reg(prismaOver: Record<string, unknown> = {}) {
  const prisma: any = {
    wifiCollector: { findUnique: vi.fn(async () => ({ id: 'c1', label: 'WLC-1' })), update: vi.fn(async () => ({})) },
    wifiAccessPoint: { findMany: vi.fn(async () => []), createMany: vi.fn(async (a: any) => ({ count: a.data.length })) },
    wifiDeviceBinding: { findMany: vi.fn(async () => []), updateMany: vi.fn(async (a: any) => ({ count: a.where.id.in.length })), count: vi.fn(async () => 0) },
    patient: { findMany: vi.fn(async () => []) },
    admission: { findMany: vi.fn(async () => []) },
    ...prismaOver,
  };
  const pos = { context: vi.fn(async () => GEO_CTX), invalidate: vi.fn() };
  // 설정 미설정(키 교체 유예 없음 · 2026-10-10) — 이 스펙의 교체는 '이전 키 즉시 무효' 경로
  return { svc: new WifiRegistryService(prisma, pos as never, { get: vi.fn(async () => null) } as never), prisma, pos };
}

describe('수집기 키 교체', () => {
  it('🔴 새 키 원문은 응답에 한 번 · 저장은 그 키의 sha256 으로 교체(이전 키 무효) · 교체 시각', async () => {
    const { svc, prisma } = reg();
    const now = new Date('2026-10-10T05:00:00Z');
    const r = await svc.rotateCollectorKey('c1', now);
    expect(r.key).toMatch(/^wfc_[0-9a-f]{48}$/);
    const data = prisma.wifiCollector.update.mock.calls[0][0].data;
    expect(data).toEqual({ keyHash: sha(r.key), keyRotatedAt: now });
    // 원문은 저장하지 않는다
    expect(JSON.stringify(prisma.wifiCollector.update.mock.calls)).not.toContain(r.key);
  });
  it('없는 수집기는 404', async () => {
    const { svc } = reg({ wifiCollector: { findUnique: vi.fn(async () => null), update: vi.fn() } });
    await expect(svc.rotateCollectorKey('x')).rejects.toMatchObject({ response: { code: 'COLLECTOR_NOT_FOUND' } });
  });
});

describe('AP CSV 가져오기', () => {
  const H = 'bssid,label,floorKey,x,y,vendor';
  it('미리보기는 쓰기 0 · 새로/이미 있음/층을 센다', async () => {
    const { svc, prisma } = reg({ wifiAccessPoint: { findMany: vi.fn(async () => [{ bssid: '02:00:00:00:00:02' }]), createMany: vi.fn() } });
    const r = await svc.importAccessPoints(`${H}\n02:00:00:00:00:01,A,1F,5,5,\n02:00:00:00:00:02,B,1F,6,6,`, true, 'u1');
    expect(r).toMatchObject({ applied: false, created: 0, valid: 2, create: 1, floors: ['1F'], errors: [] });
    expect(r.skipExisting).toEqual([{ line: 3, bssid: '02:00:00:00:00:02' }]);
    expect(prisma.wifiAccessPoint.createMany).not.toHaveBeenCalled();
  });
  it('🔴 한 줄이라도 틀리면(형식·도면에 없는 층) 적용해도 아무것도 넣지 않는다', async () => {
    const { svc, prisma } = reg();
    const bad = await svc.importAccessPoints(`${H}\n02:00:00:00:00:01,A,1F,5,5,\n02:00:00:00:00:03,C,9F,1,1,`, false, 'u1');
    expect(bad).toMatchObject({ applied: false, created: 0 });
    expect(bad.errors).toEqual([{ line: 3, reason: 'FLOOR_NOT_IN_DRAWING', value: '9F' }]);
    const bad2 = await svc.importAccessPoints(`${H}\n02:00:00:00:00:01,A,1F,5,5,\nnope,B,1F,1,1,`, false, 'u1');
    expect(bad2.errors[0]).toMatchObject({ line: 3, reason: 'BSSID_INVALID' });
    expect(prisma.wifiAccessPoint.createMany).not.toHaveBeenCalled();
  });
  it('적용 — create-only(이미 있는 것은 넣지 않음 · skipDuplicates) · 층 레벨·방·출처 REGISTERED · 캐시 무효화', async () => {
    const { svc, prisma, pos } = reg({ wifiAccessPoint: { findMany: vi.fn(async () => [{ bssid: '02:00:00:00:00:02' }]), createMany: vi.fn(async (a: any) => ({ count: a.data.length })) } });
    const r = await svc.importAccessPoints(`${H}\n02:00:00:00:00:01,A,1F,5,5,Cisco\n02:00:00:00:00:02,B,1F,6,6,\n02:00:00:00:00:04,D,2F,1,1,`, false, 'u1');
    expect(r).toMatchObject({ applied: true, created: 2 });
    const arg = prisma.wifiAccessPoint.createMany.mock.calls[0][0];
    expect(arg.skipDuplicates).toBe(true);
    expect(arg.data.map((d: any) => d.bssid)).toEqual(['02:00:00:00:00:01', '02:00:00:00:00:04']);
    expect(arg.data[0]).toMatchObject({ floorLevel: 1, zoneId: 'room-1', vendor: 'Cisco', dataOrigin: 'REGISTERED', createdById: 'u1' });
    expect(arg.data[1]).toMatchObject({ floorLevel: 2, zoneId: null });
    expect(pos.invalidate).toHaveBeenCalled();
  });
});

describe('일괄 해제', () => {
  it('🔴 사유 없으면 거절 · 0개·101개 거절', async () => {
    const { svc } = reg();
    await expect(svc.unbindMany(['a'], '  ', 'u1')).rejects.toMatchObject({ response: { code: 'UNBIND_REASON_REQUIRED' } });
    await expect(svc.unbindMany([], '회수', 'u1')).rejects.toMatchObject({ response: { code: 'UNBIND_BULK_SIZE' } });
    await expect(svc.unbindMany(Array.from({ length: 101 }, (_, i) => `id${i}`), '회수', 'u1')).rejects.toMatchObject({ response: { code: 'UNBIND_BULK_SIZE' } });
  });
  it('열린 것만 해제(시각·사람·사유) · 이미 해제·없는 것은 따로 센다 · 같은 id 중복은 한 번', async () => {
    const { svc, prisma } = reg({
      wifiDeviceBinding: {
        findMany: vi.fn(async () => [{ id: 'b1', unboundAt: null }, { id: 'b2', unboundAt: new Date() }]),
        updateMany: vi.fn(async () => ({ count: 1 })),
      },
    });
    const now = new Date('2026-10-10T05:00:00Z');
    const r = await svc.unbindMany(['b1', 'b2', 'b3', 'b1'], ' 퇴원 회수 ', 'u1', now);
    expect(r).toEqual({ requested: 3, unbound: 1, alreadyUnbound: 1, notFound: 1 });
    expect(prisma.wifiDeviceBinding.updateMany.mock.calls[0][0]).toEqual({ where: { id: { in: ['b1'] }, unboundAt: null }, data: { unboundAt: now, unboundById: 'u1', unboundReason: '퇴원 회수' } });
  });
});

describe('환자 상태 거르기', () => {
  it('🔴 열린 연결만 읽어 상태로 거른다 · 전체 수는 거른 수', async () => {
    const rows = [
      { id: 'b1', patientId: 'dead', unboundAt: null, boundAt: new Date() },
      { id: 'b2', patientId: 'stay', unboundAt: null, boundAt: new Date() },
      { id: 'b3', patientId: 'out', unboundAt: null, boundAt: new Date() },
    ];
    const { svc, prisma } = reg({
      wifiDeviceBinding: { findMany: vi.fn(async () => rows), count: vi.fn(async () => 3) },
      patient: { findMany: vi.fn(async () => [{ id: 'dead', isDeceased: true }, { id: 'stay', isDeceased: false }, { id: 'out', isDeceased: false }]) },
      admission: { findMany: vi.fn(async () => [{ patientId: 'stay' }]) },
    });
    const r = await svc.listBindings({ state: 'DECEASED' });
    expect(prisma.wifiDeviceBinding.findMany.mock.calls[0][0].where).toEqual({ unboundAt: null });
    expect(r.items.map((x: any) => x.id)).toEqual(['b1']);
    expect(r.meta).toMatchObject({ total: 1, truncated: false });
    const n = await svc.listBindings({ state: 'NOT_ADMITTED' });
    expect(n.items.map((x: any) => x.id)).toEqual(['b3']);
  });
});
