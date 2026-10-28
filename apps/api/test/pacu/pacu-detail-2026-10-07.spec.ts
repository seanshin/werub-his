/**
 * 회복실 상세화(2026-10-07).
 *  · 점수 이력: 종류별 첫 평가 = 입실(ADMIT) · 이후 화면이 고른 시점(기본 중간) · 덮어쓰지 않고 덧붙임
 *  · 진정(RASS): 단독으로도 측정으로 센다 · 미평가면 칸이 없다
 *  · 섭취·배설: 경로가 종류와 맞아야 · 합은 기록된 것만 · 수지는 양쪽 다 있을 때만
 *  · 마취과 퇴실 확인: 의사만 · 한 번(다시 눌러도 처음 시각) · 지연 사유·자리: 재실 중에만
 *  · 마취 인계 맥락: 마취기록 없으면 null(지어내지 않음) · 무효 처리된 수술 중 기록 제외
 *  · 질 지표: 기록된 것만 · 분모 0 = null · ICU 는 계획 여부 미기록
 *  · 데모 생성: 밤에는 만들지 않음 · 결정적 id · 이미 있으면 건너뜀 · 지난 데모 재실만 정리
 * 재주입: 위 규칙 하나를 되돌리면 실패한다.
 */
import { describe, it, expect, vi } from 'vitest';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { pacuIoTotals } from '@hospital-run/shared';
import { PacuService } from '../../src/modules/pacu/pacu.service';
import { DevDemoService } from '../../src/modules/dev-demo/dev-demo.service';

function svc(rec: Record<string, unknown> = {}) {
  const row: Record<string, unknown> = { id: 'r1', surgeryId: 's1', dischargeTime: null, scoreHistory: null, ioEntries: null, nursingNotes: null, vitalSigns: [], nurseId: 'n1', anesthesiaSignOffAt: null, ...rec };
  const prisma: any = {
    pacuRecord: {
      findUnique: vi.fn(async () => row),
      update: vi.fn(async ({ data }: any) => { Object.assign(row, data); return row; }),
      updateMany: vi.fn(async ({ where, data }: any) => { if (where.anesthesiaSignOffAt === null && row.anesthesiaSignOffAt) return { count: 0 }; Object.assign(row, data); return { count: 1 }; }),
    },
    surgery: { findUnique: vi.fn(async () => ({ id: 's1', procedureName: '담낭절제술' })) },
    anesthesiaRecord: { findUnique: vi.fn(async () => null) },
    intraopEvent: { findMany: vi.fn(async () => []) },
  };
  const s = new PacuService(prisma, undefined, undefined, undefined);
  return { s, prisma, row };
}
const ald = { activity: 2, respiration: 2, circulation: 2, consciousness: 2, spo2: 2, pain: 0 };

describe('점수 이력', () => {
  it('🔴 첫 평가는 입실 · 이후는 고른 시점 · 덧붙인다(덮어쓰지 않음)', async () => {
    const { s, row } = svc();
    await s.updateAldrete('r1', { score: 10, detail: ald, phase: 'DISCHARGE' } as any, 'n1');
    await s.updateAldrete('r1', { score: 10, detail: ald } as any, 'n1');
    await s.updateAldrete('r1', { score: 10, detail: ald, phase: 'DISCHARGE' } as any, 'n1');
    await s.updatePonv('r1', { score: 1 } as any, 'n1');
    const h = row.scoreHistory as any[];
    expect(h.map((e) => `${e.kind}:${e.phase}`)).toEqual(['ALDRETE:ADMIT', 'ALDRETE:INTERVAL', 'ALDRETE:DISCHARGE', 'PONV:ADMIT']);
    expect(h[0]).toMatchObject({ score: 10, by: 'n1' });
  });
});

describe('활력 RASS', () => {
  it('🔴 RASS 만 재도 기록된다 · 칸이 남는다 · 미평가면 칸 없음', async () => {
    const { s, row } = svc();
    await s.recordVitals('r1', { rass: -2 } as any, 'n1');
    await s.recordVitals('r1', { hr: 80 } as any, 'n1');
    const v = row.vitalSigns as any[];
    expect(v[0].rass).toBe(-2);
    expect('rass' in v[1]).toBe(false);
  });
});

describe('섭취·배설·간호기록·확인·지연·자리', () => {
  it('🔴 경로가 종류와 맞지 않으면 400 · 합은 기록된 것만', async () => {
    const { s } = svc();
    await expect(s.addIo('r1', { kind: 'IN', route: 'URINE', ml: 100 } as any, 'n1')).rejects.toThrow(BadRequestException);
    const r = await s.addIo('r1', { kind: 'IN', route: 'IV', ml: 200 } as any, 'n1');
    expect(r.totals).toEqual({ inMl: 200, outMl: null, balance: null });
  });
  it('🔴 마취과 퇴실 확인은 의사만 · 한 번', async () => {
    const { s, row } = svc();
    await expect(s.signOff('r1', 'n1', 'NURSE')).rejects.toThrow(ForbiddenException);
    const a: any = await s.signOff('r1', 'd1', 'DOCTOR');
    expect(a.alreadySigned).toBe(false);
    const first = row.anesthesiaSignOffAt;
    const b: any = await s.signOff('r1', 'd2', 'DOCTOR');
    expect(b.alreadySigned).toBe(true);
    expect(row.anesthesiaSignOffAt).toBe(first);
    expect(row.anesthesiaSignOffById).toBe('d1');
  });
  it('퇴실 뒤에는 지연 사유·자리·섭취배설·간호기록을 바꾸지 않는다', async () => {
    const { s } = svc({ dischargeTime: new Date() });
    await expect(s.setDelay('r1', { reason: 'NO_BED' } as any)).rejects.toThrow(BadRequestException);
    await expect(s.setBay('r1', { bayCode: 'B1' } as any)).rejects.toThrow(BadRequestException);
    await expect(s.addNote('r1', { text: 'x' } as any, 'n1')).rejects.toThrow(BadRequestException);
  });
  it('지연 사유 해제(null)는 메모도 지운다 · 빈 자리는 해제', async () => {
    const { s, prisma } = svc();
    await s.setDelay('r1', { reason: null, note: '남은 메모' } as any);
    expect(prisma.pacuRecord.update.mock.calls[0][0].data).toEqual({ delayReason: null, delayNote: null });
    await s.setBay('r1', { bayCode: '  ' } as any);
    expect(prisma.pacuRecord.update.mock.calls[1][0].data).toEqual({ bayCode: null });
  });
});

describe('마취 인계 맥락', () => {
  it('🔴 마취기록이 없으면 null(지어내지 않음) · 무효 기록 제외 조건', async () => {
    const { s, prisma } = svc();
    const r = await s.getHandoffContext('r1');
    expect(r.anesthesia).toBeNull();
    expect(prisma.intraopEvent.findMany.mock.calls[0][0].where).toEqual({ surgeryId: 's1', voidedAt: null });
  });
});

describe('질 지표', () => {
  const q = (rows: any[]) => (new PacuService({} as any) as any).qualityOf(rows, 36);
  it('🔴 분모는 기록된 것만 · 표본 0 = null', () => {
    const r = q([
      { ponvScore: null, scoreHistory: [{ kind: 'PONV', score: 0 }, { kind: 'PONV', score: 2 }], vitalSigns: [{ hr: 80 }, { temp: 35.5 }], complications: [{ type: 'REINTUBATION' }], disposition: 'ICU', anesthesiaSignOffAt: new Date() },
      { ponvScore: null, scoreHistory: null, vitalSigns: [], complications: null, disposition: 'WARD', anesthesiaSignOffAt: null },
    ]);
    expect(r.ponvModerate).toEqual({ num: 1, den: 1, rate: 1 });
    expect(r.arrivalHypothermia).toMatchObject({ num: 1, den: 1 });
    expect(r.respiratoryEvent).toEqual({ num: 1, den: 2, rate: 0.5 });
    expect(r.icuDisposition).toMatchObject({ num: 1, den: 2, plannedUnknown: true });
    expect(q([]).ponvModerate.rate).toBeNull();
  });
});

describe('PACU 데모 생성', () => {
  function demo(hourKst: number, existing = false) {
    const now = Date.UTC(2026, 9, 7, hourKst - 9, 0, 0);
    vi.useFakeTimers(); vi.setSystemTime(now);
    const created: any[] = [];
    const prisma: any = {
      $executeRaw: vi.fn(async () => 0),
      user: { findMany: vi.fn(async () => [{ id: 'd1' }, { id: 'd2' }]), findFirst: vi.fn(async () => ({ id: 'n1' })) },
      patient: { findMany: vi.fn(async () => Array.from({ length: 20 }, (_, i) => ({ id: `p${i}` }))) },
      surgery: { findUnique: vi.fn(async () => (existing ? { id: 'x' } : null)), create: vi.fn(async ({ data }: any) => { created.push(['s', data]); return data; }) },
      anesthesiaRecord: { create: vi.fn(async ({ data }: any) => { created.push(['a', data]); return data; }) },
      pacuRecord: { create: vi.fn(async ({ data }: any) => { created.push(['p', data]); return data; }) },
    };
    prisma.$transaction = vi.fn(async (fn: any) => fn(prisma));
    const svc = new DevDemoService(prisma, { get: vi.fn() } as any);
    return { svc, prisma, created };
  }
  it('🔴 밤(KST 7시 전)에는 정리만 하고 만들지 않는다', async () => {
    const { svc, prisma, created } = demo(3);
    const r = await svc.refreshPacu(false);
    vi.useRealTimers();
    expect(r.created).toBe(0);
    expect(prisma.$executeRaw).toHaveBeenCalled();
    expect(created.length).toBe(0);
  });
  it('🔴 낮에는 시나리오 7(재실 4·퇴실 2·입실 대기 1) · 결정적 id · 이미 있으면 건너뜀', async () => {
    const { svc, created } = demo(10);
    const r = await svc.refreshPacu(false);
    vi.useRealTimers();
    expect(r.created).toBe(7);
    const pacu = created.filter(([k]) => k === 'p').map(([, d]) => d);
    expect(pacu.length).toBe(6);
    expect(pacu.filter((d) => d.dischargeTime == null).length).toBe(4);
    expect(pacu.every((d) => String(d.id).startsWith('dd300000-0000-4000-a000-20261007'))).toBe(true);
    // 점수 이력의 세부 합 = 총점(서버 검증 규칙과 같다)
    for (const d of pacu) for (const e of (d.scoreHistory ?? []) as any[]) if (e.detail) expect(Object.values(e.detail as Record<string, number>).reduce((a, b) => a + b, 0)).toBe(e.score);
    const again = demo(10, true);
    const r2 = await again.svc.refreshPacu(false);
    vi.useRealTimers();
    expect(r2).toMatchObject({ created: 0, skipped: 7 });
  });
});

describe('shared pacuIoTotals', () => {
  it('🔴 한쪽만 기록되면 수지 없음 · 기록 없으면 전부 null', () => {
    expect(pacuIoTotals([])).toEqual({ inMl: null, outMl: null, balance: null });
    expect(pacuIoTotals([{ kind: 'IN', ml: 300 }, { kind: 'OUT', ml: 100 }])).toEqual({ inMl: 300, outMl: 100, balance: 200 });
  });
});
