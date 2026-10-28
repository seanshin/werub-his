/**
 * 🔴 PACU 회복실 감시 — **모르는 것을 정상이라고 말하지 않는다** (2026-08-26).
 *
 * 이 파일이 지키는 것(각 항목은 결함을 재주입하면 실패한다):
 *  1. 활력 재측정 관제 — PACU 는 q15 재측정이 표준인데 화면·서버 어디에도 "다음 측정"이 없었다.
 *     · 재주입: `decorate` 의 `sinceMs` 를 `nowMs` 로 바꾸면 지연이 영원히 0 이 되어 실패한다.
 *  2. 한 번도 재지 않은 것(`noVitalsYet`)과 재서 정상인 것을 구분한다.
 *  3. **측정된 0 은 값이다** — `temp: 0`·`hr: 0` 이 `??`/falsy 로 미측정이 되면 실패한다.
 *  4. 저체온 3상(true/false/**null**) — 체온을 안 잰 환자를 "정상 체온"으로 접으면 실패한다.
 *  5. 빈 활력 제출을 기록하지 않는다(P16 — 실행하지 않고 성공 상태만 기록).
 *  6. 총점과 세부 항목 합이 어긋난 평가를 저장하지 않는다.
 *  7. 퇴실 게이트는 **약해지지 않는다** — 미평가도 막고, 사유가 있어야 통과한다.
 *     · 재주입: `below` 판정에서 `score === null` 을 빼면(=미평가를 통과) 실패한다.
 *  8. 표본이 없으면 평균은 `0` 이 아니라 `null`("산출 불가").
 *  9. 대조군 — **성공 경로가 실패로 말하지 않는다**(무조건 통과하는 가드 방지).
 */
import { describe, it, expect, vi } from 'vitest';
import { PacuService, PACU_SCALES } from '../../src/modules/pacu/pacu.service';

const MIN = 60_000;
const NOW = Date.now();

type AnyRec = Record<string, unknown>;

const baseRecord = (over: AnyRec = {}): AnyRec => ({
  id: 'pr-1',
  patientId: 'pt-1',
  surgeryId: 'sg-1',
  arrivalTime: new Date(NOW - 30 * MIN),
  dischargeTime: null,
  aldretScore: null,
  padssScore: null,
  painScore: null,
  vitalSigns: [],
  interventions: [],
  complications: [],
  painAssessments: [],
  arrivalHandoff: null,
  dischargeHandoff: null,
  dischargeOverride: null,
  nurseId: 'nu-1',
  ...over,
});

/** config 미설정(=DEFAULT) 기준. 주기 15분·재실 초과 120분·저체온 36.0℃ */
function svcFor(record: AnyRec, opts: { completed?: AnyRec[]; configValues?: Record<string, unknown> } = {}) {
  const prisma = {
    pacuRecord: {
      findUnique: vi.fn().mockResolvedValue(record),
      findMany: vi.fn().mockImplementation((args: AnyRec) => {
        const where = (args?.where ?? {}) as AnyRec;
        if (where.dischargeTime && where.dischargeTime !== null) return Promise.resolve(opts.completed ?? []);
        return Promise.resolve([record]);
      }),
      update: vi.fn().mockResolvedValue(record),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      count: vi.fn().mockResolvedValue(0),
    },
    // 퇴실 목적지(2026-09-30) — WARD 는 재원 중 입원이 있어야 한다 · 퇴실은 한 트랜잭션
    admission: { findFirst: vi.fn().mockResolvedValue({ id: 'adm-1', bedId: 'bed-1', bed: { roomNumber: '501', bedNumber: '1', ward: { name: '5병동' } } }) },
    icuAdmission: { findFirst: vi.fn().mockResolvedValue(null) },
    $transaction: vi.fn(),
  };
  prisma.$transaction.mockImplementation((fn: (tx: unknown) => unknown) => fn(prisma));
  const config = { get: vi.fn().mockImplementation((k: string) => Promise.resolve(opts.configValues?.[k] ?? null)) };
  const service = new PacuService(prisma as never, undefined, undefined, config as never);
  return { service, prisma, config };
}

const monitoringOf = async (record: AnyRec, opts?: Parameters<typeof svcFor>[1]) => {
  const { service } = svcFor(record, opts);
  const r = await service.getRecordById('pr-1');
  return (r as unknown as { monitoring: AnyRec }).monitoring;
};

describe('PACU 활력 재측정 관제', () => {
  it('🔴 마지막 측정이 주기를 넘기면 "지연"으로 센다 — 종전엔 화면에 다음 측정 자체가 없었다', async () => {
    const m = await monitoringOf(baseRecord({
      vitalSigns: [{ time: new Date(NOW - 25 * MIN).toISOString(), hr: 70 }],
    }));
    expect(m.vitalsOverdue).toBe(true);
    expect(m.vitalsOverdueMin as number).toBeGreaterThanOrEqual(9); // 25분 전 측정 · 주기 15분
    expect(m.noVitalsYet).toBe(false);
  });

  it('주기 안이면 지연이 아니다 — 대조군(무조건 지연이라 말하지 않는다)', async () => {
    const m = await monitoringOf(baseRecord({
      vitalSigns: [{ time: new Date(NOW - 3 * MIN).toISOString(), hr: 70 }],
    }));
    expect(m.vitalsOverdue).toBe(false);
    expect(m.nextVitalsDueAt).not.toBeNull();
  });

  it('🔴 입실 후 한 번도 재지 않은 것은 "정상"이 아니라 별도의 사실이다(입실 시각부터 센다)', async () => {
    const m = await monitoringOf(baseRecord({ arrivalTime: new Date(NOW - 40 * MIN), vitalSigns: [] }));
    expect(m.noVitalsYet).toBe(true);
    expect(m.vitalsOverdue).toBe(true); // 입실 40분 · 첫 활력 없음
    expect(m.lastVitalsAt).toBeNull();
  });

  it('퇴실한 기록에 "지연 중"이라 말하지 않는다 — 지난 일이다', async () => {
    const m = await monitoringOf(baseRecord({
      dischargeTime: new Date(NOW - 60 * MIN),
      vitalSigns: [{ time: new Date(NOW - 90 * MIN).toISOString(), hr: 70 }],
    }));
    expect(m.vitalsOverdue).toBe(false);
    expect(m.vitalsOverdueMin).toBeNull();
    expect(m.nextVitalsDueAt).toBeNull();
  });

  it('재실 시간 초과를 센다(퇴실 기록은 실제 체류로 잰다)', async () => {
    const long = await monitoringOf(baseRecord({ arrivalTime: new Date(NOW - 200 * MIN) }));
    expect(long.prolongedStay).toBe(true);
    expect(long.stayMinutes as number).toBeGreaterThanOrEqual(199);
    const short = await monitoringOf(baseRecord({ arrivalTime: new Date(NOW - 20 * MIN) }));
    expect(short.prolongedStay).toBe(false); // 대조군
  });

  it('원내 설정이 있으면 그 주기를 쓴다(기본값을 정책인 척하지 않는다)', async () => {
    const m = await monitoringOf(
      baseRecord({ vitalSigns: [{ time: new Date(NOW - 20 * MIN).toISOString(), hr: 70 }] }),
      { configValues: { 'pacu.vitalsIntervalMin': 30 } },
    );
    expect(m.vitalsOverdue).toBe(false); // 주기 30분이면 20분 전 측정은 아직 여유
  });
});

describe('PACU 저체온 — 3상(측정·미측정)', () => {
  it('🔴 체온을 재지 않았으면 `null` 이다 — "정상 체온"으로 접지 않는다', async () => {
    const m = await monitoringOf(baseRecord({ vitalSigns: [{ time: new Date(NOW - 5 * MIN).toISOString(), hr: 70 }] }));
    expect(m.lastTemp).toBeNull();
    expect(m.hypothermia).toBeNull();
    expect(m.hypothermiaSeverity).toBeNull();
  });

  it('35~36 은 경도 저체온(가온 대상) · 35 미만은 저체온 · 정상은 정상', async () => {
    const at = new Date(NOW - 5 * MIN).toISOString();
    const mild = await monitoringOf(baseRecord({ vitalSigns: [{ time: at, temp: 35.6 }] }));
    expect(mild.hypothermia).toBe(true);
    expect(mild.hypothermiaSeverity).toBe('MILD');

    const severe = await monitoringOf(baseRecord({ vitalSigns: [{ time: at, temp: 34.2 }] }));
    expect(severe.hypothermiaSeverity).toBe('SEVERE');

    const normal = await monitoringOf(baseRecord({ vitalSigns: [{ time: at, temp: 36.8 }] }));
    expect(normal.hypothermia).toBe(false); // 대조군 — 정상을 저체온이라 말하지 않는다
    expect(normal.hypothermiaSeverity).toBeNull();
  });

  it('🔴 측정된 `0` 을 미측정으로 접지 않는다(0 은 값이다)', async () => {
    const at = new Date(NOW - 5 * MIN).toISOString();
    const m = await monitoringOf(baseRecord({ vitalSigns: [{ time: at, temp: 0, hr: 0, spo2: 0 }] }));
    expect(m.lastTemp).toBe(0);
    expect(m.hypothermia).toBe(true);
    const lv = m.lastVitals as AnyRec;
    expect(lv.hr).toBe(0);
    expect(lv.spo2).toBe(0);
  });

  it('활력 기록 시 경도 저체온에도 소견이 붙는다 — 기존 저체온·발열 판정은 그대로다', async () => {
    const flags = (v: AnyRec, warn?: number): string[] =>
      (PacuService.prototype as unknown as { vitalFlags: (x: AnyRec, w?: number) => string[] }).vitalFlags.call(null, v, warn);
    expect(flags({ temp: 35.5 }).join('|')).toContain('경도 저체온');
    expect(flags({ temp: 34.0 }).join('|')).toContain('저체온(기준 미만)');
    expect(flags({ temp: 39.0 }).join('|')).toContain('발열');
    expect(flags({ temp: 36.8 })).toEqual([]); // 대조군
  });
});

describe('PACU 기록 정직성', () => {
  it('🔴 측정값이 하나도 없는 활력 제출은 기록하지 않는다(빈 기록은 "정상 확인된 라운드"로 읽힌다)', async () => {
    const { service, prisma } = svcFor(baseRecord());
    await expect(service.recordVitals('pr-1', {} as never)).rejects.toMatchObject({
      response: { code: 'PACU_VITALS_EMPTY' },
    });
    expect(prisma.pacuRecord.update).not.toHaveBeenCalled();
  });

  it('한 항목이라도 측정했으면 기록한다 — 대조군(0 도 측정이다)', async () => {
    const { service, prisma } = svcFor(baseRecord());
    const r = await service.recordVitals('pr-1', { hr: 0 } as never);
    expect(prisma.pacuRecord.update).toHaveBeenCalled();
    expect((r as AnyRec).flags as string[]).toContain('HR 0 — 심박 없음(즉시 확인)');
    expect((r as AnyRec).nextVitalsDueAt).toBeTruthy();
  });

  it('🔴 총점과 세부 항목 합이 다르면 저장하지 않는다(같은 기록이 두 말을 하게 두지 않는다)', async () => {
    const { service, prisma } = svcFor(baseRecord());
    // 6항목을 다 주되 합(10)이 총점(12)과 다르게 — 항목 누락 검사(2026-09-30)가 대신 통과시키지 않게
    await expect(service.updateAldrete('pr-1', { score: 12, detail: { activity: 2, respiration: 2, circulation: 2, consciousness: 2, spo2: 1, pain: 1 } } as never))
      .rejects.toMatchObject({ response: { code: 'PACU_SCORE_DETAIL_MISMATCH' } });
    expect(prisma.pacuRecord.update).not.toHaveBeenCalled();
  });

  it('총점과 세부가 맞으면 저장한다 — 대조군', async () => {
    const { service, prisma } = svcFor(baseRecord());
    const r = await service.updateAldrete('pr-1', {
      score: 11, detail: { activity: 2, respiration: 2, circulation: 2, consciousness: 2, spo2: 2, pain: 1 },
    } as never);
    expect(prisma.pacuRecord.update).toHaveBeenCalled();
    expect((r as AnyRec).max).toBe(PACU_SCALES.aldrete.max);
  });

  it('중재(처치)를 기록한다 — 컬럼만 있고 쓰는 EP 가 없던 자리', async () => {
    const { service, prisma } = svcFor(baseRecord());
    const r = await service.addIntervention('pr-1', { type: 'WARMING', detail: '가온담요 적용' } as never, 'u-1');
    expect(prisma.pacuRecord.update).toHaveBeenCalled();
    expect((r as { entry: AnyRec }).entry.type).toBe('WARMING');
    expect((r as { entry: AnyRec }).entry.by).toBe('u-1');
  });
});

describe('PACU 퇴실 게이트 — 약해지지 않는다', () => {
  it('🔴 평가 기록이 없으면 막는다 — 그리고 "0점"이 아니라 "미평가"라고 말한다', async () => {
    const { service, prisma } = svcFor(baseRecord({ aldretScore: null }));
    await expect(service.discharge('pr-1', 'u-1', 'WARD')).rejects.toMatchObject({
      response: { code: 'ALDRETE_NOT_ASSESSED' },
    });
    expect(prisma.pacuRecord.update).not.toHaveBeenCalled();
    const { service: s2 } = svcFor(baseRecord({ padssScore: null }));
    await expect(s2.discharge('pr-1', 'u-1', 'HOME')).rejects.toMatchObject({
      response: { code: 'PADSS_NOT_ASSESSED' },
    });
  });

  it('기준 미달은 사유 없이 통과하지 못한다(Aldrete·PADSS 양쪽)', async () => {
    const { service } = svcFor(baseRecord({ aldretScore: PACU_SCALES.aldrete.dischargeMin - 1 }));
    await expect(service.discharge('pr-1', 'u-1', 'WARD')).rejects.toMatchObject({
      response: { code: 'ALDRETE_BELOW_THRESHOLD' },
    });
    const { service: s2 } = svcFor(baseRecord({ padssScore: PACU_SCALES.padss.dischargeMin - 1 }));
    await expect(s2.discharge('pr-1', 'u-1', 'HOME')).rejects.toMatchObject({
      response: { code: 'PADSS_BELOW_THRESHOLD' },
    });
  });

  it('기준 미달 강제 퇴실은 의사만 — 간호사 단독 불가', async () => {
    const { service } = svcFor(baseRecord({ aldretScore: 5 }));
    await expect(service.discharge('pr-1', 'nu-1', 'WARD', '사유', undefined, 'NURSE')).rejects.toMatchObject({
      response: { code: 'DISCHARGE_OVERRIDE_REQUIRES_DOCTOR' },
    });
  });

  it('기준을 충족하면 사유 없이 퇴실된다 — 대조군(게이트가 통과도 시켜야 게이트다)', async () => {
    const { service, prisma } = svcFor(baseRecord({ aldretScore: PACU_SCALES.aldrete.dischargeMin }));
    await service.discharge('pr-1', 'u-1', 'WARD', undefined, undefined, 'NURSE');
    expect(prisma.pacuRecord.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ disposition: 'WARD', dischargeOverride: null }) }),
    );
  });
});

describe('PACU 집계 — 표본이 없으면 0 이 아니라 산출 불가', () => {
  it('🔴 퇴실 표본이 없으면 평균은 `null` 이다(0 은 "평균 0분"이라는 다른 사실이다)', async () => {
    const { service } = svcFor(baseRecord(), { completed: [] });
    const s = await service.getStats();
    expect(s.avgStayMinutes).toBeNull();
    expect(s.avgAldrete).toBeNull();
    expect(s.measurableCount).toBe(0);
  });

  it('강제 퇴실·강제 종결분은 평균에서 빼고, 뺀 건수를 함께 낸다(분모를 밝힌다)', async () => {
    const completed = [
      { arrivalTime: new Date(NOW - 120 * MIN), dischargeTime: new Date(NOW - 60 * MIN), aldretScore: 10, dischargeOverride: null, dischargeHandoff: {} },
      { arrivalTime: new Date(NOW - 90 * MIN), dischargeTime: new Date(NOW - 60 * MIN), aldretScore: 10, dischargeOverride: 'true', dischargeHandoff: null },
    ];
    const { service } = svcFor(baseRecord(), { completed });
    const s = await service.getStats();
    expect(s.measurableCount).toBe(1);
    expect(s.excludedOverride).toBe(1);
    expect(s.avgStayMinutes).toBe(60);
  });

  it('감시 설정의 출처를 밝힌다 — 미설정을 정책인 척하지 않는다', async () => {
    const { service } = svcFor(baseRecord());
    expect((await service.getMonitoringSettings()).source).toBe('DEFAULT');
    const withCfg = svcFor(baseRecord(), { configValues: { 'pacu.vitalsIntervalMin': 10 } });
    expect((await withCfg.service.getMonitoringSettings()).source).toBe('CONFIG');
  });

  it('🔴 설정 조회가 실패해도 감시는 계속하되 "실패"를 "미설정"으로 번역하지 않는다', async () => {
    const prisma = { pacuRecord: { findUnique: vi.fn(), findMany: vi.fn(), update: vi.fn(), count: vi.fn() } };
    const config = { get: vi.fn().mockRejectedValue(new Error('db down')) };
    const service = new PacuService(prisma as never, undefined, undefined, config as never);
    const s = await service.getMonitoringSettings();
    expect(s.source).toBe('UNAVAILABLE');
    expect(s.vitalsIntervalMin).toBeGreaterThan(0); // 감시는 멈추지 않는다
  });
});
