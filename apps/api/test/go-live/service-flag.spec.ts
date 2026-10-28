import { describe, it, expect, vi } from 'vitest';
import { GoLiveService } from '../../src/modules/go-live/go-live.service';
import { GO_LIVE_REGISTRY, AREA_LABEL } from '../../src/modules/go-live/go-live.registry';

/**
 * H 영역(서비스 개시 설정 확정) 계약 — 2026-07-30 신설.
 * 목적: 개발/시연용으로 열어둔 설정이 실서비스 개시까지 남는 것을 관제에서 잡는다.
 */
const svcWith = (cfg: Record<string, unknown>) => {
  const prisma: any = {};
  const config: any = { get: vi.fn((k: string) => Promise.resolve(cfg[k])) };
  return new GoLiveService(prisma, config);
};
const derive = (svc: GoLiveService, sourceKey: string, manual = 'NOT_READY') =>
  (svc as any).deriveServiceFlag(sourceKey, manual) as Promise<{ status: string; detail: string; auto: boolean }>;

describe('레지스트리 — H 영역 등재', () => {
  const h = GO_LIVE_REGISTRY.filter((d) => d.area === 'H');

  it('영역 라벨이 있고 항목이 등재돼 있다', () => {
    expect(AREA_LABEL.H).toBe('서비스 개시 설정 확정');
    expect(h.length).toBeGreaterThanOrEqual(10);
  });

  it('개발 전용 기능(데모 날짜 롤포워드)은 차단 항목으로 등재 — 실환자 진료일 이동 위험', () => {
    const d = h.find((x) => x.key === 'flag.devDemoDateRoll')!;
    expect(d.sourceKey).toBe('flag:dev.demoDateRoll=false');
    expect(d.isBlocking ?? true).toBe(true);
    expect(d.note).toMatch(/진료일/);
  });

  it('임상·법무 승인 대상은 비차단(DECIDE)으로 등재 — 개시 자체를 막지는 않음', () => {
    for (const key of ['flag.voiceWrite', 'flag.voiceOrder', 'flag.ambientEnabled']) {
      const d = h.find((x) => x.key === key)!;
      expect(d.sourceKey).toContain('=DECIDE');
      expect(d.isBlocking).toBe(false);
    }
  });

  it('모든 H 항목에 개시 시 확인 사항(note)이 붙어 있다', () => {
    expect(h.every((d) => (d.note ?? '').length > 10)).toBe(true);
  });

  it('H 항목 key 는 중복 없음', () => {
    expect(new Set(h.map((d) => d.key)).size).toBe(h.length);
  });
});

describe('deriveServiceFlag — 자동 판정(개발 전용 플래그)', () => {
  it('개발 플래그가 꺼져 있으면 READY', async () => {
    const r = await derive(svcWith({ 'dev.demoDateRoll': false }), 'flag:dev.demoDateRoll=false');
    expect(r).toMatchObject({ status: 'READY', auto: true });
    expect(r.detail).toContain('개시 목표 false');
  });

  it('🔴 개발 플래그가 켜진 채면 NOT_READY(현재값 노출)', async () => {
    const r = await derive(svcWith({ 'dev.demoDateRoll': true }), 'flag:dev.demoDateRoll=false');
    expect(r.status).toBe('NOT_READY');
    expect(r.detail).toContain('현재 true');
  });

  it('미설정도 목표 불일치로 판정(암묵적 통과 금지)', async () => {
    const r = await derive(svcWith({}), 'flag:dev.demoDateRoll=false');
    expect(r.status).toBe('NOT_READY');
    expect(r.detail).toContain('미설정');
  });

  it('문자열 값의 따옴표는 벗겨서 비교', async () => {
    const r = await derive(svcWith({ 'dev.demoDateRoll': '"false"' }), 'flag:dev.demoDateRoll=false');
    expect(r.status).toBe('READY');
  });
});

describe('deriveServiceFlag — DECIDE(운영 결정)', () => {
  it('자동 판정하지 않고 현재값을 보여주며 수동 status 를 존중', async () => {
    const r = await derive(svcWith({ 'voiceEmr.ambient.enabled': true }), 'flag:voiceEmr.ambient.enabled=DECIDE', 'IN_PROGRESS');
    expect(r).toMatchObject({ status: 'IN_PROGRESS', auto: false });
    expect(r.detail).toContain('현재 true');
    expect(r.detail).toContain('운영 결정');
  });

  it('운영자가 DONE 으로 확정하면 그 상태가 유지된다(자동 덮어쓰기 없음)', async () => {
    const r = await derive(svcWith({ 'voiceEmr.write.enabled': false }), 'flag:voiceEmr.write.enabled=DECIDE', 'DONE');
    expect(r.status).toBe('DONE');
    expect(r.auto).toBe(false);
  });

  it('소스 형식이 깨지면 NOT_READY(조용한 통과 금지)', async () => {
    const r = await derive(svcWith({}), 'flag:broken');
    expect(r.status).toBe('NOT_READY');
  });
});
