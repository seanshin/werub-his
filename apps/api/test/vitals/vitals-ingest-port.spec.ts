import { describe, it, expect, vi } from 'vitest';
import { VitalsIngestService } from '../../src/modules/vitals/vitals-ingest.service';

/**
 * 활력 수집 포트 계약 — 기획 `vitals-device-integration.plan.md` §3·§10.
 *
 * 🔴 이 파일의 각 테스트는 **결함을 재주입하면 실패**해야 한다(재주입 확인 목록은 릴리즈 보고에).
 *    "통과하는 테스트가 아무것도 보증하지 않을 수 있다" — 가드는 결함을 되돌려 넣어 깨져야 가드다.
 */

const T0 = new Date('2026-08-20T01:00:00.000Z');

function build() {
  const prisma = {
    preVisitVitals: { create: vi.fn(async (a: any) => ({ id: 'pv1', measuredAt: a.data.measuredAt ?? T0 })), findFirst: vi.fn().mockResolvedValue(null) },
    flowSheetEntry: { create: vi.fn(async () => ({ id: 'fs1' })), findFirst: vi.fn().mockResolvedValue(null) },
    icuRecord: { create: vi.fn(async () => ({ id: 'icu1' })), findFirst: vi.fn().mockResolvedValue(null) },
  };
  const events = { emit: vi.fn() };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { svc: new VitalsIngestService(prisma as any, events as any), prisma, events };
}

const OUT = (over: Record<string, unknown> = {}) => ({
  route: 'OUTPATIENT' as const,
  patientId: 'p1',
  recordedBy: 'n1',
  receivedAt: T0,
  values: { systolicBp: 120, diastolicBp: 80, heartRate: 72 },
  ...over,
});

describe('정규화 — 결측은 null · 실측 0 은 결측이 아니다', () => {
  it('미측정 항목은 null 로 저장한다(0·기본값으로 접지 않는다)', async () => {
    const { svc, prisma } = build();
    await svc.ingest(OUT({ values: { systolicBp: 120 } }));
    const d = prisma.preVisitVitals.create.mock.calls[0][0].data;
    expect(d.spo2).toBeNull();
    expect(d.temperature).toBeNull();
    expect(d.painScore).toBeNull();
    // 🔴 NEWS2 요소도 마찬가지 — false 로 접으면 보충산소 2점이 조용히 사라진다
    expect(d.respiratoryRate).toBeNull();
  });

  it('실측 0 을 미측정으로 버리지 않는다', async () => {
    const { svc, prisma } = build();
    await svc.ingest(OUT({ values: { painScore: 0, spo2: 0, heartRate: 0 } }));
    const d = prisma.preVisitVitals.create.mock.calls[0][0].data;
    expect(d.painScore).toBe(0);
    expect(d.spo2).toBe(0);
    expect(d.heartRate).toBe(0);
  });

  it('수기 입력은 수치 정책 정본(roundBy)을 탄다', async () => {
    const { svc, prisma } = build();
    await svc.ingest(OUT({ values: { temperature: 36.55, weight: 70.25, heartRate: 72.4 } }));
    const d = prisma.preVisitVitals.create.mock.calls[0][0].data;
    expect(d.temperature).toBe(36.6);
    expect(d.weight).toBe(70.3);
    expect(d.heartRate).toBe(72);
  });

  it('🔴 기기 보고값은 재반올림하지 않는다(외부 보고값 변조 금지)', async () => {
    const { svc, prisma } = build();
    await svc.ingest(OUT({ source: { kind: 'DEVICE' }, values: { temperature: 36.55, weight: 70.25 } }));
    const d = prisma.preVisitVitals.create.mock.calls[0][0].data;
    expect(d.temperature).toBe(36.55);
    expect(d.weight).toBe(70.25);
  });

  it('의식 어휘는 원문 그대로 저장한다(어휘 접기는 채점의 일)', async () => {
    const { svc, prisma } = build();
    await svc.ingest({ route: 'INPATIENT', admissionId: 'a1', recordedBy: 'n1', receivedAt: T0, values: { consciousness: 'VERBAL' } });
    expect(prisma.flowSheetEntry.create.mock.calls[0][0].data.consciousness).toBe('VERBAL');
  });
});

describe('시각 — 모르는 시각을 아는 척하지 않는다', () => {
  it('측정 시각 미상이면 그 사실을 돌려준다(now 로 채우고 침묵하지 않는다)', async () => {
    const { svc } = build();
    const r = await svc.ingest(OUT());
    expect(r.timeFlags).toContain('MEASURED_AT_UNKNOWN');
    expect(r.timeFlags).toContain('MEASURED_AT_DEFAULTED_TO_RECEIPT');
    expect(r.measuredAt).toBeNull(); // 🔴 수신 시각을 측정 시각처럼 돌려주지 않는다
  });

  it('미상이면 PreVisitVitals.measuredAt 을 넘기지 않는다(DB 기본값)', async () => {
    const { svc, prisma } = build();
    await svc.ingest(OUT());
    expect(prisma.preVisitVitals.create.mock.calls[0][0].data).not.toHaveProperty('measuredAt');
  });

  it('미래 측정 시각을 표시한다 — 통과시키지 않는다', async () => {
    const { svc } = build();
    const r = await svc.ingest(OUT({ measuredAt: new Date(T0.getTime() + 60 * 60 * 1000) }));
    expect(r.timeFlags).toContain('FUTURE_MEASURED_AT');
  });

  it('🔴 부호가 아니라 격차를 잰다 — 초 단위 시계 오차는 사건이 아니다(거짓 경보 금지)', async () => {
    const { svc } = build();
    const r = await svc.ingest(OUT({ measuredAt: new Date(T0.getTime() + 1) }));
    expect(r.timeFlags).not.toContain('FUTURE_MEASURED_AT');
  });

  it('과도한 소급은 표시하되 **거부하지 않는다**(늦게 온 과거 측정은 버릴 것이 아니다)', async () => {
    const { svc } = build();
    const r = await svc.ingest(OUT({ measuredAt: new Date(T0.getTime() - 48 * 60 * 60 * 1000) }));
    expect(r.timeFlags).toContain('EXCESSIVE_BACKDATE');
    expect(r.status).toBe('STORED');
  });

  it('잡값 시각은 null 로 접는다(파싱 실패를 now 로 메우지 않는다)', async () => {
    const { svc } = build();
    const r = await svc.ingest(OUT({ measuredAt: 'not-a-date' }));
    expect(r.measuredAt).toBeNull();
    expect(r.timeFlags).toContain('MEASURED_AT_UNKNOWN');
  });
});

describe('멱등 — 같은 측정의 재수신은 두 번 저장하지 않는다', () => {
  it('같은 환자·같은 측정시각·같은 값이면 저장하지 않고 duplicate 로 알린다', async () => {
    const { svc, prisma } = build();
    prisma.preVisitVitals.findFirst.mockResolvedValue({ id: 'pv-old' });
    const r = await svc.ingest(OUT({ measuredAt: T0 }));
    expect(r.status).toBe('DUPLICATE');
    expect(r.duplicate).toBe(true);
    expect(r.duplicateOfId).toBe('pv-old');
    expect(prisma.preVisitVitals.create).not.toHaveBeenCalled();
  });

  it('멱등 키는 기존 컬럼 조합이다 — 환자+측정시각+활력 6값', async () => {
    const { svc, prisma } = build();
    await svc.ingest(OUT({ measuredAt: T0 }));
    const where = prisma.preVisitVitals.findFirst.mock.calls[0][0].where;
    expect(where).toMatchObject({ patientId: 'p1', measuredAt: T0, systolicBp: 120, diastolicBp: 80, heartRate: 72 });
    // 🔴 미측정 항목은 null 로 대조한다(빠뜨리면 다른 측정이 중복으로 걸린다)
    expect(where.spo2).toBeNull();
  });

  it('🔴 측정 시각을 모르면 멱등 판정을 하지 않는다 — 삽입 시각으로 중복을 재면 정상 재측정이 지워진다', async () => {
    const { svc, prisma } = build();
    const r = await svc.ingest(OUT());
    expect(r.dedupeChecked).toBe(false); // "중복 없음"이 아니라 "판정 불가"
    expect(prisma.preVisitVitals.findFirst).not.toHaveBeenCalled();
    expect(r.status).toBe('STORED');
  });

  it('입원·중환자 경로도 같은 규칙을 쓴다(경로마다 갈라지지 않는다)', async () => {
    const a = build();
    a.prisma.flowSheetEntry.findFirst.mockResolvedValue({ id: 'fs-old' });
    expect((await a.svc.ingest({ route: 'INPATIENT', admissionId: 'a1', recordedBy: 'n1', receivedAt: T0, measuredAt: T0, values: { heartRate: 70 } })).status).toBe('DUPLICATE');

    const b = build();
    b.prisma.icuRecord.findFirst.mockResolvedValue({ id: 'icu-old' });
    expect((await b.svc.ingest({ route: 'ICU', admissionId: 'a1', recordedBy: 'n1', receivedAt: T0, measuredAt: T0, values: { heartRate: 70 } })).status).toBe('DUPLICATE');
  });
});

describe('환자 결속 — 임의 환자에 붙이지 않는다', () => {
  it('환자 결속 근거가 없으면 저장하지 않고 PENDING 을 돌려준다', async () => {
    const { svc, prisma } = build();
    const r = await svc.ingest(OUT({ patientId: '' }));
    expect(r.status).toBe('PENDING');
    expect(r.pendingReason).toBe('NO_PATIENT_BINDING');
    expect(prisma.preVisitVitals.create).not.toHaveBeenCalled();
  });

  it('입원·중환자는 재원(admissionId)이 결속 근거다', async () => {
    const { svc } = build();
    expect((await svc.ingest({ route: 'INPATIENT', recordedBy: 'n1', receivedAt: T0, values: {} })).pendingReason).toBe('NO_PATIENT_BINDING');
    expect((await svc.ingest({ route: 'ICU', recordedBy: 'n1', receivedAt: T0, values: {} })).pendingReason).toBe('NO_PATIENT_BINDING');
  });

  it('🔴 기록자가 없으면 저장하지 않는다 — 아무 사람 ID 를 빌려 쓰지 않는다', async () => {
    const { svc, prisma } = build();
    const r = await svc.ingest(OUT({ recordedBy: null }));
    expect(r.pendingReason).toBe('NO_RECORDER');
    expect(prisma.preVisitVitals.create).not.toHaveBeenCalled();
  });
});

describe('이벤트 — 한 곳에서만 발행한다', () => {
  it('외래 저장 시 vitals.recorded 를 정확히 한 번 발행한다', async () => {
    const { svc, events } = build();
    await svc.ingest(OUT());
    const calls = events.emit.mock.calls.filter((c) => c[0] === 'vitals.recorded');
    expect(calls).toHaveLength(1);
    expect(calls[0][1]).toMatchObject({ patientId: 'p1', vitalsId: 'pv1', encounterId: null, systolicBp: 120 });
  });

  it('저장하지 않았으면 발행하지 않는다(중복·보류)', async () => {
    const a = build();
    a.prisma.preVisitVitals.findFirst.mockResolvedValue({ id: 'old' });
    await a.svc.ingest(OUT({ measuredAt: T0 }));
    expect(a.events.emit).not.toHaveBeenCalled();

    const b = build();
    await b.svc.ingest(OUT({ recordedBy: null }));
    expect(b.events.emit).not.toHaveBeenCalled();
  });

  it('🔴 입원·중환자 경로는 vitals.recorded 를 발행하지 않는다 — 켜면 만성추이에 급성기 값이 섞인다(임상 판단 필요·P1)', async () => {
    const { svc, events } = build();
    await svc.ingest({ route: 'INPATIENT', admissionId: 'a1', recordedBy: 'n1', receivedAt: T0, values: { systolicBp: 120 } });
    await svc.ingest({ route: 'ICU', admissionId: 'a1', recordedBy: 'n1', receivedAt: T0, values: { systolicBp: 120 } });
    expect(events.emit).not.toHaveBeenCalledWith('vitals.recorded', expect.anything());
    // 대신 재원 단위 사건(요약 캐시 무효화 등 · 2026-10-10) — 만성 추이 미러는 이것을 듣지 않는다
    expect(events.emit).toHaveBeenCalledWith('vitals.admission.recorded', { admissionId: 'a1', route: 'INPATIENT' });
    expect(events.emit).toHaveBeenCalledWith('vitals.admission.recorded', { admissionId: 'a1', route: 'ICU' });
  });

  it('이벤트가 싣는 값은 **저장된 값**이다(정본이 둘이 되지 않는다)', async () => {
    const { svc, events } = build();
    await svc.ingest(OUT({ values: { weight: 70.25 }, extras: { bmi: 22.94 } }));
    const p = events.emit.mock.calls[0][1];
    expect(p.weight).toBe(70.3);
    expect(p.bmi).toBe(22.9);
  });
});

describe('🔴 스키마가 없어 저장하지 못하는 것 — 저장한 척하지 않는다', () => {
  it('출처·기기·신뢰도·원문참조는 저장되지 않았다고 반환값이 밝힌다', async () => {
    const { svc, prisma } = build();
    const source = { kind: 'DEVICE' as const, deviceId: 'eq-1', deviceSerial: 'SN-9', reliability: 'CALIBRATION_EXPIRED' as const, rawRef: 'raw-1' };
    const r = await svc.ingest(OUT({ source }));

    expect(r.unstored.reason).toBe('SCHEMA_PENDING');
    expect(r.unstored.source).toEqual(source);
    expect(r.unstored.fields).toEqual(expect.arrayContaining(['source', 'deviceId', 'reliability', 'rawRef', 'receivedAt']));

    // 저장 payload 어디에도 출처가 없다 — 있는 척하는 컬럼을 만들지 않았다
    const d = JSON.stringify(prisma.preVisitVitals.create.mock.calls[0][0].data);
    for (const leak of ['eq-1', 'SN-9', 'CALIBRATION_EXPIRED', 'raw-1', 'DEVICE']) {
      expect(d).not.toContain(leak);
    }
  });
});
