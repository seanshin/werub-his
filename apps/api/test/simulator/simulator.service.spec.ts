import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SimulatorService } from '../../src/modules/simulator/simulator.service';

/**
 * 🔴 시뮬레이터 원장 격리(2026-09-28) — 시뮬레이터는 실원장에 쓰지 않는다.
 * 종전: start 가 모든 환자의 열린 위치를 닫았고(updateMany leftAt:null), 실제 환자 id 로 여정 이벤트를 발행했다.
 * prisma 는 프록시로 — `admission.findMany`(읽기) 외의 **어떤 접근이든** 기록해 실패시킨다.
 */
function strictPrisma() {
  const touched: string[] = [];
  const admission = {
    findMany: vi.fn(async (args: any) => {
      // 환자 신원을 읽지 않는다
      expect(JSON.stringify(args)).not.toMatch(/familyName|givenName|patient/);
      return [{ id: 'adm-00000001', bed: { roomNumber: '301A', ward: { name: '3병동', floor: 3 } } }];
    }),
  };
  const prisma = new Proxy({}, {
    get(_t, model: string) {
      if (model === 'admission') return admission;
      return new Proxy({}, { get(_t2, op: string) { touched.push(`${model}.${op}`); return vi.fn(async () => { throw new Error(`금지된 접근 ${model}.${op}`); }); } });
    },
  });
  return { prisma: prisma as any, touched, admission };
}

describe('SimulatorService', () => {
  let service: SimulatorService;
  let ctx: ReturnType<typeof strictPrisma>;

  beforeEach(() => {
    vi.useFakeTimers();
    ctx = strictPrisma();
    service = new SimulatorService(ctx.prisma);
  });
  afterEach(() => { service.stop(); vi.useRealTimers(); });

  it('getStatus — 초기 상태 · 원장에 쓰지 않는다고 말한다', () => {
    const status = service.getStatus();
    expect(status.status).toBe('stopped');
    expect(status.writesLedger).toBe(false);
  });

  it('start/stop 사이클', async () => {
    await service.start({});
    expect(service.getStatus().status).toBe('running');
    service.stop();
    expect(service.getStatus().status).toBe('paused');
  });

  it('setSpeed', async () => {
    await service.start({});
    service.setSpeed(2);
    expect(service.getStatus().speed).toBe(2);
  });

  it('🔴 시작·진행·주입 전 과정에서 입원 현황 읽기 외 prisma 접근 0 · 가상 이름만', async () => {
    await service.start({ patientRate: 60, emergencyRate: 20, speed: 30 });
    for (let i = 0; i < 20; i++) await vi.advanceTimersByTimeAsync(1000);
    for (const t of ['EMERGENCY_ARRIVAL', 'SCHEDULED_VISIT', 'ADMISSION', 'DISCHARGE', 'LAB_ORDER', 'SURGERY_START']) await service.injectEvent(t, {});
    const st = service.getStatus();
    expect(ctx.touched).toEqual([]);
    expect(ctx.admission.findMany).toHaveBeenCalledTimes(1);
    expect(st.eventCount).toBeGreaterThan(5);
    expect(st.recentEvents.length).toBeGreaterThan(0);
    for (const e of st.recentEvents) expect(e.name).toMatch(/^SIM-/);
  });

  it('소스에 실원장 발행 경로가 없다(journey·위치 원장)', () => {
    const src = readFileSync(join(__dirname, '../../src/modules/simulator/simulator.service.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(src).not.toMatch(/JourneyService|journey\.emit|patientLocation|patient\.findMany/);
  });
});
