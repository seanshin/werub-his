import type { PrismaService } from '../../infrastructure/prisma/prisma.service';

/**
 * 입원 섭취·배설(I/O) **읽기 정본**(2026-10-10) — 한 재원의 I/O 를 두 원장에서 함께 읽는다.
 *
 * 🔴 왜: I/O 가 두 원장에 갈려 서로 읽지 않았다(운영 실측 — 같은 재원 9건이 양쪽에 다 있다).
 *    · I/O 화면·간호 스테이션 → `IntakeOutput`(유형·양 한 건씩)
 *    · 플로시트 입력 폼 → `FlowSheetEntry` 의 I/O 칸(intakeOral·outputUrine…)
 *   그래서 플로시트 합계와 I/O 화면·근무조 마감·병동 보드의 I/O 가 같은 날 서로 다른 값을 말했다.
 *   이제 새 플로시트 I/O 는 `IntakeOutput` 에 쓴다(`NursingService.addFlowSheetEntry`). 이미 플로시트 칸에 쌓인 값은
 *   옮기지 않고(소급 없음) 읽을 때 행으로 펼쳐 함께 보인다 — 행마다 `ledger` 로 어디서 왔는지 밝힌다.
 * 🔴 두 원장에 같은 사건이 둘 다 적혔는지는 알 수 없다 — 합치되 원장별 합계를 함께 낸다(가리지 않는다).
 */
export type IoLedger = 'IO' | 'FLOWSHEET';

export interface IoRow {
  id: string;
  ledger: IoLedger;
  admissionId: string;
  recordedAt: Date;
  intakeType: string | null;
  intakeAmount: number | null;
  intakeDetail: string | null;
  outputType: string | null;
  outputAmount: number | null;
  outputDetail: string | null;
  nurse: { id?: string; familyName: string | null; givenName: string | null } | null;
}

export interface IoWindow { gte?: Date; lt?: Date }

/** 플로시트 I/O 칸 → 유형(IntakeOutput 어휘) */
export const FLOWSHEET_IO_FIELDS = [
  { field: 'intakeOral', kind: 'intake', type: 'ORAL' },
  { field: 'intakeIv', kind: 'intake', type: 'IV' },
  { field: 'intakeOther', kind: 'intake', type: 'OTHER' },
  { field: 'outputUrine', kind: 'output', type: 'URINE' },
  { field: 'outputDrain', kind: 'output', type: 'DRAIN' },
  { field: 'outputOther', kind: 'output', type: 'OTHER' },
] as const;
export type FlowsheetIoField = (typeof FLOWSHEET_IO_FIELDS)[number]['field'];

const range = (w?: IoWindow) => (w?.gte || w?.lt ? { recordedAt: { ...(w.gte ? { gte: w.gte } : {}), ...(w.lt ? { lt: w.lt } : {}) } } : {});

export class AdmissionIoReader {
  constructor(private readonly prisma: PrismaService) {}

  /** 두 원장 행 — 시각 오름차순 · 플로시트 칸은 값이 있는 칸마다 한 행 */
  async rows(admissionIds: string[], w?: IoWindow): Promise<IoRow[]> {
    if (!admissionIds.length) return [];
    const nurse = { select: { id: true, familyName: true, givenName: true } } as const;
    const [io, fs] = await Promise.all([
      this.prisma.intakeOutput.findMany({ where: { admissionId: { in: admissionIds }, ...range(w) }, orderBy: { recordedAt: 'asc' }, include: { nurse } }),
      this.prisma.flowSheetEntry.findMany({
        where: {
          admissionId: { in: admissionIds }, ...range(w),
          OR: FLOWSHEET_IO_FIELDS.map((f) => ({ [f.field]: { not: null } })),
        },
        orderBy: { recordedAt: 'asc' },
        select: {
          id: true, admissionId: true, recordedAt: true, nurse,
          intakeOral: true, intakeIv: true, intakeOther: true, outputUrine: true, outputDrain: true, outputOther: true,
        },
      }),
    ]);
    const out: IoRow[] = io.map((r) => ({
      id: r.id, ledger: 'IO' as const, admissionId: r.admissionId, recordedAt: r.recordedAt,
      intakeType: r.intakeType, intakeAmount: r.intakeAmount, intakeDetail: r.intakeDetail,
      outputType: r.outputType, outputAmount: r.outputAmount, outputDetail: r.outputDetail,
      nurse: r.nurse ?? null,
    }));
    for (const e of fs) {
      for (const f of FLOWSHEET_IO_FIELDS) {
        const v = (e as Record<string, unknown>)[f.field] as number | null;
        if (v == null) continue;
        out.push({
          id: `fs:${e.id}:${f.field}`, ledger: 'FLOWSHEET', admissionId: e.admissionId, recordedAt: e.recordedAt,
          intakeType: f.kind === 'intake' ? f.type : null, intakeAmount: f.kind === 'intake' ? v : null, intakeDetail: null,
          outputType: f.kind === 'output' ? f.type : null, outputAmount: f.kind === 'output' ? v : null, outputDetail: null,
          nurse: e.nurse ?? null,
        });
      }
    }
    return out.sort((a, b) => a.recordedAt.getTime() - b.recordedAt.getTime());
  }

  /** 재원별 행 수(근무조 마감·병동 보드 '기록 유무') */
  async countByAdmission(admissionIds: string[], w: IoWindow): Promise<Map<string, number>> {
    const m = new Map<string, number>();
    for (const r of await this.rows(admissionIds, w)) m.set(r.admissionId, (m.get(r.admissionId) ?? 0) + 1);
    return m;
  }
}

/** 합계 — 전체와 원장별(같은 사건이 두 원장에 적혔을 가능성을 가리지 않는다) */
export function summarizeIo(rows: IoRow[]) {
  const sum = (rs: IoRow[], k: 'intakeAmount' | 'outputAmount') => rs.reduce((s, r) => s + (r[k] ?? 0), 0);
  const byLedger = (l: IoLedger) => {
    const rs = rows.filter((r) => r.ledger === l);
    return { intake: sum(rs, 'intakeAmount'), output: sum(rs, 'outputAmount'), rows: rs.length };
  };
  const totalIntake = sum(rows, 'intakeAmount');
  const totalOutput = sum(rows, 'outputAmount');
  return { totalIntake, totalOutput, balance: totalIntake - totalOutput, byLedger: { IO: byLedger('IO'), FLOWSHEET: byLedger('FLOWSHEET') } };
}
