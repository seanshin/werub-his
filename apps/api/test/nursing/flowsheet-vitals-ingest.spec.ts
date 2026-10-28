import { describe, it, expect, vi } from 'vitest';
import { NursingService } from '../../src/modules/nursing/nursing.service';
import { VitalsIngestService } from '../../src/modules/vitals/vitals-ingest.service';

/**
 * 입원 플로우시트 활력 쓰기 — **수집 포트 경유** 계약(2026-08-20 수렴).
 *
 * 종전 실측:
 *  · 수치 정책 반올림이 **없었다**(외래에만 있었다 — 같은 개념이 경로마다 달랐다)
 *  · DTO 가 받는 `intakeOther`·`outputOther`·`painLocation`·`gcsScore` 를 **prisma 로 넘기지 않아 조용히 버렸다**
 *    (400 도 아니고 성공 응답 + 데이터 소실 — whitelist 사고와 같은 계열)
 *  · `recordedAt` 미제공 시 `new Date()` 로 채워 **모르는 시각을 관측 시각처럼** 원장에 박았다
 */

function build() {
  const prisma = {
    flowSheetEntry: { create: vi.fn(async () => ({ id: 'fs1' })), findFirst: vi.fn().mockResolvedValue(null) },
    admission: { findUnique: vi.fn().mockResolvedValue({ id: 'a1', patientId: 'p1' }) },
    intakeOutput: { create: vi.fn((a: any) => a) },
    $transaction: vi.fn(async (ops: unknown[]) => ops),
  };
  const ingest = new VitalsIngestService(prisma as never);
  const svc = new NursingService(prisma as never, undefined, undefined, undefined, undefined, ingest);
  return { svc, prisma, ingest };
}

const data = () => build().prisma;

describe('addFlowSheetEntry — 수집 포트 경유', () => {
  it('수치 정책 정본(roundBy)을 탄다 — 외래 경로와 같은 처리', async () => {
    const { svc, prisma } = build();
    await svc.addFlowSheetEntry('a1', 'n1', { temperature: 36.55, heartRate: 72.4 } as never);
    const d = prisma.flowSheetEntry.create.mock.calls[0][0].data;
    expect(d.temperature).toBe(36.6);
    expect(d.heartRate).toBe(72);
  });

  it('🔴 DTO 가 받는 항목을 조용히 버리지 않는다 — 활력 칸은 플로시트, I/O 는 I/O 원장(2026-10-10)', async () => {
    const { svc, prisma } = build();
    const r = await svc.addFlowSheetEntry('a1', 'n1', {
      intakeOther: 120, outputOther: 30, outputUrine: 0, painLocation: '우측 하복부', gcsScore: 14,
    } as never);
    const d = prisma.flowSheetEntry.create.mock.calls[0][0].data;
    expect(d.painLocation).toBe('우측 하복부');
    expect(d.gcsScore).toBe(14);
    // 🔴 I/O 는 플로시트 칸이 아니라 I/O 원장 — 종전엔 플로시트 칸에만 남아 I/O 화면·근무조 마감·병동 보드가 몰랐다
    expect(d.intakeOther ?? null).toBeNull();
    expect(d.outputOther ?? null).toBeNull();
    const io = prisma.intakeOutput.create.mock.calls.map((c: any) => c[0].data);
    expect(io).toEqual(expect.arrayContaining([
      expect.objectContaining({ admissionId: 'a1', nurseId: 'n1', intakeType: 'OTHER', intakeAmount: 120 }),
      expect.objectContaining({ outputType: 'OTHER', outputAmount: 30 }),
      expect.objectContaining({ outputType: 'URINE', outputAmount: 0 }), // 측정한 0 mL 도 기록
    ]));
    expect(io).toHaveLength(3);
    expect(r).toMatchObject({ ioRecorded: 3 });
  });

  it('I/O 만 적으면 플로시트(활력) 행을 만들지 않는다 — 빈 활력 행이 "측정함"으로 세지 않게', async () => {
    const { svc, prisma } = build();
    const r = await svc.addFlowSheetEntry('a1', 'n1', { intakeOral: 200 } as never);
    expect(prisma.flowSheetEntry.create).not.toHaveBeenCalled();
    expect(prisma.intakeOutput.create).toHaveBeenCalledTimes(1);
    expect(r).toEqual({ ioRecorded: 1, vitals: null });
  });

  it('🔴 아무 값도 없으면 400 — 빈 행을 만들지 않는다', async () => {
    const { svc, prisma } = build();
    await expect(svc.addFlowSheetEntry('a1', 'n1', { notes: '메모만' } as never)).rejects.toMatchObject({ response: { code: 'FLOWSHEET_EMPTY' } });
    expect(prisma.flowSheetEntry.create).not.toHaveBeenCalled();
  });

  it('🔴 근무조를 보내지 않으면 측정 시각의 교대 — 종전 DAY 고정', async () => {
    const { svc, prisma } = build();
    await svc.addFlowSheetEntry('a1', 'n1', { recordedAt: '2026-10-09T17:30:00.000Z', heartRate: 70 } as never); // 02:30 KST
    expect(prisma.flowSheetEntry.create.mock.calls[0][0].data.shiftType).toBe('NIGHT');
    await svc.addFlowSheetEntry('a1', 'n1', { recordedAt: '2026-10-10T08:00:00.000Z', heartRate: 71 } as never); // 17:00 KST
    expect(prisma.flowSheetEntry.create.mock.calls[1][0].data.shiftType).toBe('EVENING');
    await svc.addFlowSheetEntry('a1', 'n1', { recordedAt: '2026-10-10T08:00:00.000Z', heartRate: 72, shiftType: 'DAY' } as never);
    expect(prisma.flowSheetEntry.create.mock.calls[2][0].data.shiftType).toBe('DAY'); // 보낸 값은 그대로
  });

  it('미측정은 null — 0 이나 정상값으로 접지 않는다', async () => {
    const { svc, prisma } = build();
    await svc.addFlowSheetEntry('a1', 'n1', { heartRate: 80 } as never);
    const d = prisma.flowSheetEntry.create.mock.calls[0][0].data;
    expect(d.spo2).toBeNull();
    expect(d.consciousness).toBeNull();
    expect(d.painScore).toBeNull();
  });

  it('recordedAt 을 주면 그 시각으로 저장하고 멱등 판정이 켜진다', async () => {
    const { svc, prisma } = build();
    const at = '2026-08-20T01:00:00.000Z';
    await svc.addFlowSheetEntry('a1', 'n1', { recordedAt: at, heartRate: 80 } as never);
    expect(prisma.flowSheetEntry.create.mock.calls[0][0].data.recordedAt).toEqual(new Date(at));
    expect(prisma.flowSheetEntry.findFirst).toHaveBeenCalled();
  });

  it('같은 시각·같은 값의 재수신은 저장하지 않는다', async () => {
    const { svc, prisma } = build();
    prisma.flowSheetEntry.findFirst.mockResolvedValue({ id: 'fs-old' });
    const r = await svc.addFlowSheetEntry('a1', 'n1', { recordedAt: '2026-08-20T01:00:00.000Z', heartRate: 80 } as never);
    expect(prisma.flowSheetEntry.create).not.toHaveBeenCalled();
    expect(r).toBeNull();
  });

  it('🔴 recordedAt 이 없으면 멱등 판정을 하지 않는다(삽입 시각으로 중복을 재지 않는다)', async () => {
    const { svc, prisma } = build();
    await svc.addFlowSheetEntry('a1', 'n1', { heartRate: 80 } as never);
    expect(prisma.flowSheetEntry.findFirst).not.toHaveBeenCalled();
    expect(prisma.flowSheetEntry.create).toHaveBeenCalled();
  });

  // 2026-10-10 근무조는 기록 시각에서 도출한다 — 종전 테스트가 "실행 시각이 낮"일 때만 통과했다(오후 3시 실행에서 EVENING)
  it('shiftType 미지정 → 기록 시각의 근무조(낮 10시 = DAY · 밤 23시 = NIGHT)', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-10-10T01:00:00Z')); // KST 10:00
      const a = build();
      await a.svc.addFlowSheetEntry('a1', 'n1', { heartRate: 80 } as never);
      expect(a.prisma.flowSheetEntry.create.mock.calls[0][0].data.shiftType).toBe('DAY');
      vi.setSystemTime(new Date('2026-10-10T14:00:00Z')); // KST 23:00
      const b = build();
      await b.svc.addFlowSheetEntry('a1', 'n1', { heartRate: 80 } as never);
      expect(b.prisma.flowSheetEntry.create.mock.calls[0][0].data.shiftType).toBe('NIGHT');
    } finally {
      vi.useRealTimers();
    }
  });

  it('의식 어휘는 원문 보존 — 구 AVPU 를 저장 시점에 접지 않는다', async () => {
    const { svc, prisma } = build();
    await svc.addFlowSheetEntry('a1', 'n1', { consciousness: 'VERBAL' } as never);
    expect(prisma.flowSheetEntry.create.mock.calls[0][0].data.consciousness).toBe('VERBAL');
  });

  it('NEWS2 는 7요소 완비 시에만 산출한다(포트 수렴 뒤에도 유지)', async () => {
    const prisma = data();
    const safety = { calculateAndSaveEws: vi.fn().mockResolvedValue({ riskLevel: 'LOW' }) };
    const svc = new NursingService(prisma as never, undefined, undefined, safety as never, undefined, new VitalsIngestService(prisma as never));

    await svc.addFlowSheetEntry('a1', 'n1', {
      respiratoryRate: 16, spo2: 98, systolicBp: 120, heartRate: 70, temperature: 36.5, consciousness: 'ALERT',
    } as never); // 보충산소 미관측
    expect(safety.calculateAndSaveEws).not.toHaveBeenCalled();

    await svc.addFlowSheetEntry('a1', 'n1', {
      respiratoryRate: 16, spo2: 98, systolicBp: 120, heartRate: 70, temperature: 36.5, consciousness: 'ALERT',
      supplementalO2: true,
    } as never);
    expect(safety.calculateAndSaveEws).toHaveBeenCalledTimes(1);
    expect(safety.calculateAndSaveEws.mock.calls[0][2].supplementalO2).toBe(true);
  });
});
