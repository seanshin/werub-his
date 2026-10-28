import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { WifiRegistryService, WIFI_AUTO_UNBIND_KEY, WIFI_AUTO_UNBIND_REASON, wifiKeyGraceMinutes } from '../../src/modules/wifi-location/wifi-registry.service';
import { WifiPositioningService, WIFI_KEY_GRACE_KEY, wifiGraceRedisKey, wifiGraceOfRedisKey } from '../../src/modules/wifi-location/wifi-positioning.service';
import { WifiAutoUnbindListener } from '../../src/modules/wifi-location/wifi-auto-unbind.listener';

/**
 * 무선 위치 사람 결정 두 가지의 동작(2026-10-10).
 *  · location.wifi.autoUnbindOnEnd — 정확히 true 일 때만 퇴원·전원·사망에 열린 단말 연결 해제(사유에 결정 키) · 미설정 = 지금처럼 사람이 점검
 *  · location.wifi.keyRotationGraceMinutes — 1~1440 정수일 때만 이전 키를 그 시간 동안 받는다(Redis TTL · 스키마 없음) · 유예 저장소를 못 읽으면 받지 않는다
 */
const NOW = new Date('2026-10-10T06:00:00Z');

function registry(cfg: Record<string, unknown>, opts: { stillAdmitted?: number; redis?: any } = {}) {
  const prisma: any = {
    admission: { count: vi.fn(async () => opts.stillAdmitted ?? 0) },
    wifiDeviceBinding: { updateMany: vi.fn(async () => ({ count: 2 })) },
    wifiCollector: {
      findUnique: vi.fn(async () => ({ id: 'c1', label: '병동 컨트롤러', keyHash: 'old-hash' })),
      update: vi.fn(async () => ({})),
    },
  };
  const config = { get: vi.fn(async (k: string) => (k in cfg ? cfg[k] : null)) };
  return { svc: new WifiRegistryService(prisma, {} as never, config as never, opts.redis), prisma, config };
}

describe('자동 해제 — 설정이 켜졌을 때만', () => {
  it('🔴 미설정·false·문자열 "true" 는 아무것도 바꾸지 않는다', async () => {
    for (const v of [undefined, false, 'true']) {
      const { svc, prisma } = registry(v === undefined ? {} : { [WIFI_AUTO_UNBIND_KEY]: v });
      expect(await svc.autoUnbindForPatient('p1', 'DISCHARGE', null, NOW)).toMatchObject({ applied: false, reason: 'SETTING_OFF' });
      expect(prisma.wifiDeviceBinding.updateMany).not.toHaveBeenCalled();
    }
  });
  it('켜짐 + 퇴원 → 그 환자의 열린 연결만 · 해제 시각·시스템(null)·결정 키가 든 사유', async () => {
    const { svc, prisma } = registry({ [WIFI_AUTO_UNBIND_KEY]: true });
    expect(await svc.autoUnbindForPatient('p1', 'DISCHARGE', null, NOW)).toEqual({ applied: true, reason: null, unbound: 2 });
    const a = prisma.wifiDeviceBinding.updateMany.mock.calls[0][0];
    expect(a.where).toEqual({ patientId: 'p1', unboundAt: null });
    expect(a.data).toEqual({ unboundAt: NOW, unboundById: null, unboundReason: WIFI_AUTO_UNBIND_REASON.DISCHARGE });
    expect(WIFI_AUTO_UNBIND_REASON.DISCHARGE).toContain(WIFI_AUTO_UNBIND_KEY);
  });
  it('🔴 퇴원인데 아직 다른 재원 중이면 해제하지 않는다 · 사망은 재원과 무관하게 해제하고 처리자를 남긴다', async () => {
    const a = registry({ [WIFI_AUTO_UNBIND_KEY]: true }, { stillAdmitted: 1 });
    expect(await a.svc.autoUnbindForPatient('p1', 'TRANSFER', null, NOW)).toMatchObject({ applied: false, reason: 'STILL_ADMITTED' });
    expect(a.prisma.wifiDeviceBinding.updateMany).not.toHaveBeenCalled();
    const b = registry({ [WIFI_AUTO_UNBIND_KEY]: true }, { stillAdmitted: 1 });
    await b.svc.autoUnbindForPatient('p1', 'DECEASED', 'u-doc', NOW);
    expect(b.prisma.wifiDeviceBinding.updateMany.mock.calls[0][0].data).toMatchObject({ unboundById: 'u-doc', unboundReason: WIFI_AUTO_UNBIND_REASON.DECEASED });
  });
});

describe('자동 해제 배선', () => {
  const listener = () => {
    const registryMock = { autoUnbindForPatient: vi.fn(async () => ({ applied: true, reason: null, unbound: 1 })) };
    return { l: new WifiAutoUnbindListener(registryMock as never), r: registryMock };
  };
  it('퇴원·전원은 해제 경로로 · 🔴 입원 취소는 해제하지 않는다(재원이 없었다 — 외래·응급 연결일 수 있다)', async () => {
    const { l, r } = listener();
    await l.onAdmissionClosed({ admissionId: 'a1', patientId: 'p1', reason: 'DISCHARGE' });
    await l.onAdmissionClosed({ admissionId: 'a2', patientId: 'p1', reason: 'TRANSFER' });
    await l.onAdmissionClosed({ admissionId: 'a3', patientId: 'p1', reason: 'CANCELLED' });
    expect(r.autoUnbindForPatient.mock.calls.map((c: unknown[]) => c[1])).toEqual(['DISCHARGE', 'TRANSFER']);
  });
  it('사망 이벤트 → 처리자와 함께 · 실패는 던지지 않는다(사망 처리를 막지 않는다)', async () => {
    const { l, r } = listener();
    await l.onDeceased({ patientId: 'p1', userId: 'u1' });
    expect(r.autoUnbindForPatient).toHaveBeenCalledWith('p1', 'DECEASED', 'u1');
    r.autoUnbindForPatient.mockRejectedValueOnce(new Error('db'));
    await expect(l.onDeceased({ patientId: 'p1', userId: 'u1' })).resolves.toBeUndefined();
  });
  it('🔴 사망 처리는 트랜잭션이 끝난 뒤 patient.deceased 를 낸다(사망 자동 퇴원은 admission.closed 를 내지 않는다)', () => {
    const src = readFileSync(join(__dirname, '../../src/modules/patient/patient.service.ts'), 'utf8');
    const body = src.slice(src.indexOf('async markDeceased'), src.indexOf('// ── Photo Upload'));
    const txEnd = body.indexOf('return { updated, deceasedInfo, actions };\n    });');
    const emit = body.indexOf("this.events?.emit('patient.deceased', { patientId, userId })");
    expect(txEnd).toBeGreaterThan(0);
    expect(emit).toBeGreaterThan(txEnd);
  });
});

describe('키 교체 유예', () => {
  const redis = () => {
    const store = new Map<string, string>();
    return {
      store,
      get: vi.fn(async (k: string) => store.get(k) ?? null),
      set: vi.fn(async (k: string, v: string) => { store.set(k, v); return 'OK'; }),
      del: vi.fn(async (k: string) => { store.delete(k); return 1; }),
    };
  };
  it('설정 값 해석 — 1~1440 정수만 · 그 밖은 유예 없음', () => {
    expect([1, 60, 1440].map(wifiKeyGraceMinutes)).toEqual([1, 60, 1440]);
    expect([0, 1441, 1.5, '60', null, undefined].map(wifiKeyGraceMinutes)).toEqual([null, null, null, null, null, null]);
  });
  it('🔴 유예 설정이 있으면 이전 키 해시를 TTL 과 함께 보관 · 응답이 유예 끝 시각을 말한다', async () => {
    const rd = redis();
    const { svc } = registry({ [WIFI_KEY_GRACE_KEY]: 30 }, { redis: rd });
    const r = await svc.rotateCollectorKey('c1', NOW);
    expect(rd.set).toHaveBeenCalledWith(wifiGraceRedisKey('old-hash'), 'c1', 'EX', 1800);
    expect(r.graceUntil).toEqual(new Date(NOW.getTime() + 30 * 60_000));
    expect(r.graceMinutes).toBe(30);
    expect(r.keyNotice).toContain('유예');
  });
  it('다시 교체하면 그 전 유예를 끝낸다(유예 중인 키는 늘 하나)', async () => {
    const rd = redis();
    rd.store.set(wifiGraceOfRedisKey('c1'), 'older-hash');
    rd.store.set(wifiGraceRedisKey('older-hash'), 'c1');
    const { svc } = registry({ [WIFI_KEY_GRACE_KEY]: 30 }, { redis: rd });
    await svc.rotateCollectorKey('c1', NOW);
    expect(rd.store.has(wifiGraceRedisKey('older-hash'))).toBe(false);
    expect(rd.store.get(wifiGraceRedisKey('old-hash'))).toBe('c1');
  });
  it('대조군 — 유예 미설정이면 보관하지 않고 즉시 무효라고 말한다 · 🔴 저장 실패도 즉시 무효로(유예를 지어내지 않는다)', async () => {
    const rd = redis();
    const a = await registry({}, { redis: rd }).svc.rotateCollectorKey('c1', NOW);
    expect(rd.set).not.toHaveBeenCalled();
    expect(a.graceUntil).toBeNull();
    const broken = { get: vi.fn(async () => null), del: vi.fn(async () => 1), set: vi.fn(async () => { throw new Error('redis down'); }) };
    const b = await registry({ [WIFI_KEY_GRACE_KEY]: 30 }, { redis: broken }).svc.rotateCollectorKey('c1', NOW);
    expect(b.graceUntil).toBeNull();
    expect(b.graceMinutes).toBeNull();
    expect(b.keyNotice).toContain('방금 무효');
  });

  const positioning = (rd: any, active = true) => {
    const prisma: any = {
      wifiCollector: {
        findFirst: vi.fn(async (a: any) => (a.where.keyHash ? null : active && a.where.id === 'c1' ? { id: 'c1', mode: 'NETWORK' } : null)),
      },
    };
    return new WifiPositioningService(prisma, {} as never, {} as never, undefined, rd);
  };
  const hashOf = (k: string) => createHash('sha256').update(k).digest('hex');
  it('🔴 유예 중인 이전 키 → 같은 수집기로 받고 viaGraceKey 표시', async () => {
    const rd = redis();
    rd.store.set(wifiGraceRedisKey(hashOf('old-key')), 'c1');
    expect(await positioning(rd).authCollector('old-key')).toEqual({ id: 'c1', mode: 'NETWORK', viaGraceKey: true });
  });
  it('유예 만료(키 없음)·중지된 수집기·유예 저장소 오류·저장소 없음 → 401', async () => {
    await expect(positioning(redis()).authCollector('old-key')).rejects.toMatchObject({ response: { code: 'COLLECTOR_KEY_INVALID' } });
    const rd = redis(); rd.store.set(wifiGraceRedisKey(hashOf('old-key')), 'c1');
    await expect(positioning(rd, false).authCollector('old-key')).rejects.toMatchObject({ response: { code: 'COLLECTOR_KEY_INVALID' } });
    const broken = { get: vi.fn(async () => { throw new Error('down'); }) };
    await expect(positioning(broken).authCollector('old-key')).rejects.toMatchObject({ response: { code: 'COLLECTOR_KEY_INVALID' } });
    await expect(positioning(undefined).authCollector('old-key')).rejects.toMatchObject({ response: { code: 'COLLECTOR_KEY_INVALID' } });
  });
});
