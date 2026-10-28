import { describe, it, expect, vi } from 'vitest';
import { NursingService } from '../../src/modules/nursing/nursing.service';
import { AdmissionIoReader, summarizeIo } from '../../src/modules/nursing/admission-io.reader';

/**
 * 입원 섭취·배설(I/O) 두 원장(2026-10-10).
 * 🔴 I/O 화면·스테이션은 IntakeOutput, 플로시트 폼은 FlowSheetEntry 의 I/O 칸에 썼고 서로 읽지 않았다(운영 같은 재원 9건이 양쪽에).
 *    플로시트 합계와 I/O 화면·근무조 마감·병동 보드가 같은 날 다른 I/O 를 말했다.
 */
const T = (h: number) => new Date(Date.UTC(2026, 9, 10, h));
const IO_ROWS = [
  { id: 'io1', admissionId: 'a1', recordedAt: T(1), intakeType: 'ORAL', intakeAmount: 300, intakeDetail: null, outputType: 'URINE', outputAmount: 200, outputDetail: null, nurse: null },
];
const FS_ROWS = [
  { id: 'f1', admissionId: 'a1', recordedAt: T(3), nurse: null, intakeOral: null, intakeIv: 500, intakeOther: null, outputUrine: 0, outputDrain: 50, outputOther: null },
];
const prisma = (io = IO_ROWS, fs = FS_ROWS) => ({
  intakeOutput: { findMany: vi.fn(async () => io), create: vi.fn(async (a: any) => a.data) },
  flowSheetEntry: { findMany: vi.fn(async (a: any) => (a.where?.OR ? fs : [])) },
  admission: { findUnique: vi.fn(async () => ({ id: 'a1', patientId: 'p1', admitDate: T(0), dischargeDate: null })) },
  preVisitVitals: { findMany: vi.fn(async () => []) },
  user: { findMany: vi.fn(async () => []) },
});

describe('AdmissionIoReader — 두 원장을 행으로', () => {
  it('플로시트 I/O 칸은 값이 있는 칸마다 한 행(유형은 I/O 원장 어휘) · 측정한 0 도 행 · 시각 순', async () => {
    const rows = await new AdmissionIoReader(prisma() as never).rows(['a1']);
    expect(rows.map((r) => [r.id, r.ledger, r.intakeType, r.intakeAmount, r.outputType, r.outputAmount])).toEqual([
      ['io1', 'IO', 'ORAL', 300, 'URINE', 200],
      ['fs:f1:intakeIv', 'FLOWSHEET', 'IV', 500, null, null],
      ['fs:f1:outputUrine', 'FLOWSHEET', null, null, 'URINE', 0],
      ['fs:f1:outputDrain', 'FLOWSHEET', null, null, 'DRAIN', 50],
    ]);
  });
  it('합계는 전체 + 원장별(같은 사건이 둘 다 적혔는지 가리지 않는다)', async () => {
    const s = summarizeIo(await new AdmissionIoReader(prisma() as never).rows(['a1']));
    expect(s).toMatchObject({ totalIntake: 800, totalOutput: 250, balance: 550, byLedger: { IO: { intake: 300, output: 200, rows: 1 }, FLOWSHEET: { intake: 500, output: 50, rows: 3 } } });
  });
});

describe('읽는 곳이 두 원장을 본다', () => {
  it('🔴 I/O 합계 화면 — 플로시트에 적은 I/O 가 빠지지 않는다', async () => {
    const s = await new NursingService(prisma() as never).getIntakeOutputSummary('a1', '2026-10-10');
    expect(s).toMatchObject({ totalIntake: 800, totalOutput: 250 });
    expect(s.byLedger.FLOWSHEET.rows).toBe(3);
  });
  it('🔴 플로시트 시트 합계 — I/O 화면에서 적은 섭취·배설이 빠지지 않는다 · 유형별 칸 이름 유지', async () => {
    const r: any = await new NursingService(prisma() as never).getFlowSheet('a1', '2026-10-10');
    expect(r.totals).toMatchObject({ intakeOral: 300, intakeIv: 500, outputUrine: 200, outputDrain: 50, totalIntake: 800, totalOutput: 250 });
    // 기록이 없는 칸은 null(0 이 아니다) · 있는 칸은 합
    const withIo = r.grid.filter((g: any) => g.io);
    expect(withIo.reduce((a: number, g: any) => a + g.io.intake, 0)).toBe(800);
    expect(r.grid.filter((g: any) => !g.io).every((g: any) => g.io === null)).toBe(true);
  });
});

describe('I/O 원장 쓰기 규칙', () => {
  const svc = () => new NursingService(prisma() as never);
  it('🔴 빈 행·유형만·양만은 거절(합계에 0·유형 없는 양이 생기지 않게)', async () => {
    await expect(svc().createIntakeOutput('a1', {} as never, 'n1')).rejects.toMatchObject({ response: { code: 'IO_EMPTY' } });
    await expect(svc().createIntakeOutput('a1', { intakeType: 'ORAL' } as never, 'n1')).rejects.toMatchObject({ response: { code: 'IO_PAIR_INCOMPLETE' } });
    await expect(svc().createIntakeOutput('a1', { outputAmount: 100 } as never, 'n1')).rejects.toMatchObject({ response: { code: 'IO_PAIR_INCOMPLETE' } });
  });
  it('미래 시각 거절 · 대조군 — 유형+양(0 포함)은 저장', async () => {
    await expect(svc().createIntakeOutput('a1', { intakeType: 'ORAL', intakeAmount: 100, recordedAt: new Date(Date.now() + 3_600_000).toISOString() } as never, 'n1')).rejects.toMatchObject({ response: { code: 'IO_RECORDED_AT_FUTURE' } });
    const p = prisma();
    await new NursingService(p as never).createIntakeOutput('a1', { outputType: 'URINE', outputAmount: 0 } as never, 'n1');
    expect(p.intakeOutput.create).toHaveBeenCalledTimes(1);
  });
});
