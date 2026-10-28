/**
 * 수술실 실시간 모니터·질 지표(2026-10-05 · `/surgery`).
 *  · 방 상태는 수술 원장 상태에서(예약 상태 아님 — 시작/종료 버튼은 예약을 갱신하지 않는다)
 *  · 단계는 기록된 시각에서만 · 지금 단계 = 단계 순서상 시각이 있는 마지막
 *  · 예상 대비 초과는 예상이 있을 때만 · 활력 배열이 아니면 null(모름) · 진행 중으로 남은 지난 건은 따로 센다
 *  · 질 지표: 첫 수술 시작 지연(시작 기록 없는 건·취소는 분모 밖으로 따로) · 정시율은 원내 기준이 있을 때만 ·
 *    회전 시간(음수·24시간 이상 제외) · 취소율 분모는 이미 지난 예약 · 기록 완결 분자/분모 · 회복실 지연은 PACU 정본 기준
 * 재주입: 위 규칙 하나를 되돌리면 실패한다.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SurgeryMonitorService, orSlotAt, ON_TIME_TOLERANCE_KEY } from '../../src/modules/surgery/surgery-monitor.service';

const NOW = new Date('2026-10-05T03:00:00Z'); // KST 12:00
const DAY = new Date('2026-10-05T00:00:00Z'); // @db.Date 표현

const surg = (over: Record<string, unknown>) => ({
  id: 's1', status: 'SCHEDULED', procedureName: '복강경 담낭절제', bodySite: null, laterality: null,
  scheduledAt: new Date('2026-10-05T00:00:00Z'), startedAt: null, endedAt: null, incisionTime: null, closureTime: null,
  ebl: null, anesthesiaType: null, admissionId: null, opNote: null, complications: null,
  patient: { id: 'p1', familyName: '김', givenName: '하나', mrn: 'M1' }, surgeon: { familyName: '박', givenName: '외과' }, ...over,
});

function mk(o: { rooms?: unknown[]; slots?: unknown[]; surgeries?: any[]; checklists?: unknown[]; anes?: unknown[]; pre?: unknown[]; pacu?: unknown[]; notes?: unknown[]; ledger?: unknown[]; inProgressIds?: string[]; tolerance?: unknown; pacuSettings?: unknown } = {}) {
  const surgeries = o.surgeries ?? [];
  const prisma: any = {
    operatingRoom: { findMany: vi.fn(async () => o.rooms ?? [{ id: 'r1', name: 'OR-1', floor: '3', roomType: 'GENERAL' }]) },
    orSchedule: { findMany: vi.fn(async (a: any) => (a.select?.estimatedDuration && a.where?.surgeryId ? (o.slots ?? []).map((x: any) => ({ surgeryId: x.surgeryId, estimatedDuration: x.estimatedDuration })) : o.slots ?? [])) },
    surgery: {
      findMany: vi.fn(async (a: any) => {
        if (a.where?.status === 'IN_PROGRESS') return (o.inProgressIds ?? surgeries.filter((s) => s.status === 'IN_PROGRESS').map((s) => s.id)).map((id) => ({ id }));
        if (a.where?.id?.in) return surgeries.filter((s) => a.where.id.in.includes(s.id));
        if (a.select?.opNote) return surgeries;
        return surgeries.map((s) => ({ id: s.id }));
      }),
    },
    surgicalChecklist: { findMany: vi.fn(async () => o.checklists ?? []) },
    anesthesiaRecord: { findMany: vi.fn(async () => o.anes ?? []) },
    preAnesthesiaEvaluation: { findMany: vi.fn(async () => o.pre ?? []) },
    pacuRecord: { findMany: vi.fn(async () => o.pacu ?? []) },
    surgeryOpNote: { findMany: vi.fn(async () => o.notes ?? []) },
    intraopEvent: {
      findMany: vi.fn(async () => o.ledger ?? []),
      groupBy: vi.fn(async () => [...new Set((o.ledger ?? []).map((x: any) => x.surgeryId))].map((surgeryId) => ({ surgeryId, _count: { _all: 1 } }))),
    },
  };
  const config = { get: vi.fn(async (k: string) => (k === ON_TIME_TOLERANCE_KEY ? (o.tolerance ?? null) : null)) };
  const pacu = o.pacuSettings === undefined ? undefined : { getMonitoringSettings: vi.fn(async () => o.pacuSettings) };
  return { svc: new SurgeryMonitorService(prisma, config as never, pacu as never), prisma };
}

describe('예약 칸 시각', () => {
  it('🔴 @db.Date(UTC 자정 = KST 날짜) + HH:MM(KST) → 실제 시각 · 형식 모르면 null', () => {
    expect(orSlotAt(DAY, '08:30')!.toISOString()).toBe('2026-10-04T23:30:00.000Z');
    expect(orSlotAt(DAY, '9:00')!.toISOString()).toBe('2026-10-05T00:00:00.000Z');
    expect(orSlotAt(DAY, '')).toBeNull();
    expect(orSlotAt(DAY, 'x')).toBeNull();
  });
});

describe('실시간 보드', () => {
  it('🔴 방 상태는 수술 원장 상태에서 — 예약 상태가 IN_PROGRESS 로 남아 있어도 끝난 수술이면 사용 중 아님', async () => {
    const { svc } = mk({
      slots: [{ roomId: 'r1', surgeryId: 's1', date: DAY, startTime: '08:00', endTime: '10:00', estimatedDuration: 120, status: 'IN_PROGRESS' }],
      surgeries: [surg({ status: 'COMPLETED', startedAt: new Date('2026-10-04T23:00:00Z'), endedAt: new Date('2026-10-05T01:00:00Z') })],
    });
    const r: any = await svc.getLiveBoard(undefined, NOW);
    expect(r.rooms[0].state).toBe('IDLE');
    expect(r.summary).toMatchObject({ inUse: 0, completed: 1 });
  });

  it('🔴 단계는 기록된 시각만 · 지금 단계 = 단계 순서상 마지막 · 예상 대비 초과 · 시작 버튼은 절개가 아니다', async () => {
    const { svc } = mk({
      slots: [{ roomId: 'r1', surgeryId: 's1', date: DAY, startTime: '10:00', endTime: '11:00', estimatedDuration: 60 }],
      surgeries: [surg({ status: 'IN_PROGRESS', startedAt: new Date('2026-10-05T01:30:00Z'), incisionTime: new Date('2026-10-05T01:40:00Z') })],
      checklists: [{ surgeryId: 's1', signInCompletedAt: new Date('2026-10-05T01:10:00Z'), timeOutCompletedAt: new Date('2026-10-05T01:25:00Z'), signOutCompletedAt: null, countStatus: null, countDiscrepancyNote: null }],
      anes: [{ surgeryId: 's1', inductionTime: null, intubationTime: null, extubationTime: null, vitalSigns: null, ebl: null, urineOutput: null, asaClass: '2', anesthesiaType: 'GENERAL' }],
    });
    const r: any = await svc.getLiveBoard(undefined, NOW);
    const c = r.rooms[0].cases[0];
    expect(r.rooms[0].state).toBe('IN_USE');
    expect(c.phases.find((p: any) => p.key === 'INDUCTION').at).toBeNull(); // 유도 시각 없음 — 지났다고 하지 않는다
    expect(c.lastPhase).toBe('INCISION');
    expect(c.runMin).toBe(90); expect(c.estimatedMin).toBe(60); expect(c.overrunMin).toBe(30);
    expect(c.anesthesia.vitals).toBeNull(); // 활력 배열 없음 = 모름
    expect(c.safety).toMatchObject({ signIn: true, timeOut: true, signOut: false });
    expect(r.summary.overrun).toBe(1);
  });

  it('예상이 없으면 초과를 판정하지 않는다 · 방 없는 수술은 unassigned · 지난날 진행 중은 따로 센다', async () => {
    const { svc } = mk({
      surgeries: [surg({ id: 's9', status: 'IN_PROGRESS', scheduledAt: new Date('2026-09-30T00:00:00Z'), startedAt: new Date('2026-09-30T08:58:00Z') })],
    });
    const r: any = await svc.getLiveBoard(undefined, NOW);
    expect(r.unassigned).toHaveLength(1);
    expect(r.unassigned[0].overrunMin).toBeNull();
    expect(r.summary.staleInProgress).toBe(1);
  });

  it('활력은 시각순 · 최근 40점만 싣고 전체 수와 잘림을 말한다', async () => {
    const vs = Array.from({ length: 45 }, (_, i) => ({ time: new Date(Date.UTC(2026, 9, 5, 1, i)).toISOString(), heartRate: 70 + i, spo2: 99 }));
    const { svc } = mk({
      surgeries: [surg({ status: 'IN_PROGRESS', startedAt: new Date('2026-10-05T01:00:00Z') })],
      anes: [{ surgeryId: 's1', inductionTime: null, intubationTime: null, extubationTime: null, vitalSigns: vs.reverse(), ebl: null, urineOutput: null, asaClass: null, anesthesiaType: 'GENERAL' }],
    });
    const r: any = await svc.getLiveBoard(undefined, NOW);
    const a = r.unassigned[0].anesthesia;
    expect(a.vitals).toHaveLength(40);
    expect(a).toMatchObject({ vitalsTotal: 45, vitalsTruncated: true });
    expect(a.vitals[39].heartRate).toBe(114);
  });

  it('날짜 형식 오류는 400', async () => {
    await expect(mk().svc.getLiveBoard('2026/10/05', NOW)).rejects.toThrow(/YYYY-MM-DD/);
    await expect(mk().svc.getQuality('x', undefined, NOW)).rejects.toThrow(/YYYY-MM-DD/);
  });
});

describe('질 지표', () => {
  const day = (d: string) => new Date(`${d}T00:00:00Z`);
  const slot = (roomId: string, surgeryId: string, date: string, startTime: string, est = 60) => ({ roomId, surgeryId, date: day(date), startTime, estimatedDuration: est });

  it('🔴 첫 수술 시작 지연 — 방·날짜마다 가장 이른 예약 · 시작 기록 없음·취소는 분모 밖 · 기준 미설정이면 정시율 없음', async () => {
    const { svc } = mk({
      slots: [slot('r1', 'a', '2026-10-01', '08:00'), slot('r1', 'b', '2026-10-01', '10:00'), slot('r2', 'c', '2026-10-01', '08:00'), slot('r1', 'd', '2026-10-02', '08:00')],
      surgeries: [
        surg({ id: 'a', status: 'COMPLETED', scheduledAt: day('2026-10-01'), startedAt: new Date('2026-09-30T23:20:00Z'), endedAt: new Date('2026-10-01T00:20:00Z') }), // 08:20 → +20
        surg({ id: 'b', status: 'COMPLETED', scheduledAt: day('2026-10-01'), startedAt: new Date('2026-10-01T00:50:00Z'), endedAt: new Date('2026-10-01T01:30:00Z') }),
        surg({ id: 'c', status: 'COMPLETED', scheduledAt: day('2026-10-01'), startedAt: null, endedAt: null }),
        surg({ id: 'd', status: 'CANCELLED', scheduledAt: day('2026-10-02') }),
        // 아직 오지 않은 예약 — 취소율 분모에 넣지 않는다(지나지 않은 것은 취소될 수도, 안 될 수도)
        surg({ id: 'e', status: 'SCHEDULED', scheduledAt: new Date('2026-10-05T08:00:00Z') }),
      ],
    });
    const r: any = await svc.getQuality('2026-10-01', '2026-10-04', NOW);
    expect(r.firstCaseStart).toMatchObject({ n: 1, median: 20, roomDays: 3, noStartRecord: 1, cancelledFirst: 1, onTime: null, toleranceMin: null });
    // 회전 — a 종료 00:20 → b 시작 00:50 = 30분
    expect(r.turnover).toMatchObject({ n: 1, median: 30, excluded: 0 });
    // 예상 대비 — a 60분/60 · b 40분/60
    expect(r.durationVsEstimate).toMatchObject({ n: 2, over: 0, under: 1 });
    expect(r.volume.cancelled).toEqual({ numerator: 1, denominator: 4 });
  });

  it('기준이 설정되면 정시율(분자/분모) · 음수 회전은 제외로 센다', async () => {
    const { svc } = mk({
      tolerance: 15,
      slots: [slot('r1', 'a', '2026-10-01', '08:00'), slot('r1', 'b', '2026-10-01', '09:00')],
      surgeries: [
        surg({ id: 'a', status: 'COMPLETED', scheduledAt: day('2026-10-01'), startedAt: new Date('2026-09-30T23:10:00Z'), endedAt: new Date('2026-10-01T01:00:00Z') }),
        surg({ id: 'b', status: 'COMPLETED', scheduledAt: day('2026-10-01'), startedAt: new Date('2026-10-01T00:30:00Z'), endedAt: new Date('2026-10-01T01:30:00Z') }),
      ],
    });
    const r: any = await svc.getQuality('2026-10-01', '2026-10-04', NOW);
    expect(r.firstCaseStart.onTime).toEqual({ numerator: 1, denominator: 1 });
    expect(r.turnover).toMatchObject({ n: 0, median: null, excluded: 1 });
  });

  it('🔴 기록 완결은 완료 수술 분모 · 회복실 지연은 PACU 정본 기준과 출처 · 기준을 못 얻으면 null', async () => {
    const vit = [{ time: '2026-10-01T01:00:00Z', heartRate: 80 }];
    const a = mk({
      surgeries: [
        surg({ id: 'a', status: 'COMPLETED', scheduledAt: day('2026-10-01'), opNote: '기록', ebl: 100, incisionTime: new Date(), closureTime: new Date(), complications: '출혈' }),
        surg({ id: 'b', status: 'COMPLETED', scheduledAt: day('2026-10-01') }),
      ],
      anes: [{ surgeryId: 'a', vitalSigns: vit }],
      pre: [{ surgeryId: 'a', status: 'COMPLETED' }, { surgeryId: 'b', status: 'DRAFT' }],
      pacu: [
        { arrivalTime: new Date('2026-10-01T02:00:00Z'), dischargeTime: new Date('2026-10-01T05:00:00Z'), dischargeOverride: '보호자 요청', complications: [{ type: 'PONV' }] },
        { arrivalTime: new Date('2026-10-01T02:00:00Z'), dischargeTime: new Date('2026-10-01T03:00:00Z'), dischargeOverride: null, complications: null },
      ],
      pacuSettings: { prolongedStayMin: 120, source: 'DEFAULT' },
    });
    const r: any = await a.svc.getQuality('2026-10-01', '2026-10-04', NOW);
    expect(r.documentation).toMatchObject({
      opNote: { numerator: 1, denominator: 2 }, incisionClosure: { numerator: 1, denominator: 2 }, ebl: { numerator: 1, denominator: 2 },
      anesthesiaRecord: { numerator: 1, denominator: 2 }, intraopVitals: { numerator: 1, denominator: 2 }, preAnesthesiaCompleted: { numerator: 1, denominator: 2 },
    });
    expect(r.complications.surgeryRecorded).toEqual({ numerator: 1, denominator: 2 });
    expect(r.pacu).toMatchObject({ n: 2, prolonged: { numerator: 1, denominator: 2 }, prolongedMin: 120, prolongedSource: 'DEFAULT', overrideDischarge: { numerator: 1, denominator: 2 } });
    const b = mk({ pacu: [] });
    expect(((await b.svc.getQuality('2026-10-01', '2026-10-04', NOW)) as any).pacu).toMatchObject({ prolonged: null, prolongedSource: 'UNAVAILABLE', median: null });
  });

  it('🔴 수술 기록은 구조화 원장(SurgeryOpNote)도 본다 — 옛 칸만 보면 0 · 항생제·VTE 기록 · Clavien-Dindo 분포', async () => {
    const { svc } = mk({
      surgeries: [
        surg({ id: 'a', status: 'COMPLETED', scheduledAt: day('2026-10-01') }),
        surg({ id: 'b', status: 'COMPLETED', scheduledAt: day('2026-10-01') }),
      ],
      notes: [{ surgeryId: 'a', narrative: '복강경으로…', incisionTime: new Date(), closureTime: new Date(), estimatedBloodLoss: 50, complications: null, complicationGrade: 'II', prophylacticAbx: 'Cefazolin 2g', vteProphylaxis: true }],
    });
    const r: any = await svc.getQuality('2026-10-01', '2026-10-04', NOW);
    expect(r.documentation).toMatchObject({
      opNote: { numerator: 1, denominator: 2 }, incisionClosure: { numerator: 1, denominator: 2 }, ebl: { numerator: 1, denominator: 2 },
      prophylacticAbx: { numerator: 1, denominator: 2 }, vteProphylaxis: { numerator: 1, denominator: 2 },
    });
    expect(r.complications.surgeryRecorded).toEqual({ numerator: 1, denominator: 2 });
    expect(r.complications.gradeCounts).toEqual({ II: 1 });
  });

  it('실시간 — 수술 원장에 절개 시각이 없으면 구조화 기록의 절개 시각 · 실혈량도', async () => {
    const t = new Date('2026-10-05T01:40:00Z');
    const { svc } = mk({
      surgeries: [surg({ status: 'IN_PROGRESS', startedAt: new Date('2026-10-05T01:30:00Z') })],
      notes: [{ surgeryId: 's1', incisionTime: t, closureTime: null, estimatedBloodLoss: 120 }],
    });
    const c: any = (await svc.getLiveBoard(undefined, NOW) as any).unassigned[0];
    expect(c.phases.find((p: any) => p.key === 'INCISION').at).toEqual(t.toISOString());
    expect(c.lastPhase).toBe('INCISION');
    expect(c.ebl).toBe(120);
  });

  it('🔴 수술방 차트 원장의 활력도 싣는다 — 마취 기록 행이 없어도 · 옛 JSON 과 합쳐 시각순 · 질 지표도 센다', async () => {
    const { svc } = mk({
      surgeries: [surg({ status: 'IN_PROGRESS', startedAt: new Date('2026-10-05T01:00:00Z') })],
      ledger: [{ surgeryId: 's1', occurredAt: new Date('2026-10-05T01:30:00Z'), payload: { heartRate: 77, spo2: 99 } }],
    });
    const c: any = (await svc.getLiveBoard(undefined, NOW) as any).unassigned[0];
    expect(c.anesthesia.vitals).toEqual([expect.objectContaining({ heartRate: 77, spo2: 99, at: '2026-10-05T01:30:00.000Z' })]);
    const q = mk({ surgeries: [surg({ id: 's1', status: 'COMPLETED', scheduledAt: new Date('2026-10-01T00:00:00Z') })], ledger: [{ surgeryId: 's1' }] });
    expect(((await q.svc.getQuality('2026-10-01', '2026-10-04', NOW)) as any).documentation.intraopVitals).toEqual({ numerator: 1, denominator: 1 });
  });

  it('🔴 PACU 설정 조회를 null 로 접지 않는다(정본이 스스로 UNAVAILABLE 을 말한다) · 정시 기준 config 는 기본 없음', () => {
    const src = readFileSync(join(__dirname, '../../src/modules/surgery/surgery-monitor.service.ts'), 'utf8');
    expect(src).not.toMatch(/getMonitoringSettings\(\)\.catch/);
    const cfg = readFileSync(join(__dirname, '../../src/modules/config/config-runtime.service.ts'), 'utf8');
    expect(cfg).toMatch(/'surgery\.qi\.firstCaseOnTimeToleranceMin': \{ key: 'surgery\.qi\.firstCaseOnTimeToleranceMin', value: null,/);
  });
});
