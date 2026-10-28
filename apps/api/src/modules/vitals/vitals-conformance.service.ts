import { Injectable } from '@nestjs/common';
import { vitalConformance, type VitalConformanceCode } from '@hospital-run/shared';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

/**
 * 활력 기록 표준 적합성 점검(2026-10-07) — 원장에 쌓인 측정 기록이 표시 표준(shared `vital-signs.ts`)에 맞는지 센다.
 *
 *  · 대상: 외래 측정(PreVisitVitals)·병동 플로시트(FlowSheetEntry)·ICU 기록(IcuRecord)·조기경보(EarlyWarningScore)
 *  · 🔴 고치지 않는다 — 수만 세고 표본 id 를 준다(데이터를 코드로 교정하지 않는다 · 확인은 사람이 기록에서)
 *  · 🔴 기간 안 최근 `SCAN_CAP` 건만 본다 — 잘랐으면 `truncated` 로 말한다(전체 수 병기)
 *  · 원장 스키마의 필드 이름이 정본과 다른 것(조기경보 `spO2`)은 기록 결함이 아니라 스키마 사실이라 `schemaAliases` 로 따로 말한다
 */
const SCAN_CAP = 5000;
const SAMPLE_CAP = 20;

export type VitalLedgerSource = 'PRE_VISIT' | 'FLOWSHEET' | 'ICU' | 'EWS';

export interface VitalLedgerReport {
  source: VitalLedgerSource;
  total: number;
  scanned: number;
  truncated: boolean;
  /** 표준 확인이 필요한(ERROR) 기록 수 */
  recordsWithErrors: number;
  byCode: Partial<Record<VitalConformanceCode, number>>;
  samples: Array<{ id: string; at: string | null; code: VitalConformanceCode; key?: string; value?: unknown }>;
}

@Injectable()
export class VitalsConformanceService {
  constructor(private readonly prisma: PrismaService) {}

  async report(days: number): Promise<{ days: number; since: string; ledgers: VitalLedgerReport[]; schemaAliases: Array<{ model: string; field: string; canonical: string }> }> {
    const since = new Date(Date.now() - days * 86400_000);
    const vitalsSelect = { systolicBp: true, diastolicBp: true, heartRate: true, temperature: true, spo2: true, respiratoryRate: true } as const;
    const [pv, pvTotal, fs, fsTotal, icu, icuTotal, ews, ewsTotal] = await Promise.all([
      this.prisma.preVisitVitals.findMany({ where: { measuredAt: { gte: since } }, orderBy: { measuredAt: 'desc' }, take: SCAN_CAP,
        select: { id: true, measuredAt: true, ...vitalsSelect, painScore: true, weight: true, height: true, bmi: true } }),
      this.prisma.preVisitVitals.count({ where: { measuredAt: { gte: since } } }),
      this.prisma.flowSheetEntry.findMany({ where: { recordedAt: { gte: since } }, orderBy: { recordedAt: 'desc' }, take: SCAN_CAP,
        select: { id: true, recordedAt: true, ...vitalsSelect, consciousness: true, painScore: true } }),
      this.prisma.flowSheetEntry.count({ where: { recordedAt: { gte: since } } }),
      this.prisma.icuRecord.findMany({ where: { recordTime: { gte: since } }, orderBy: { recordTime: 'desc' }, take: SCAN_CAP,
        select: { id: true, recordTime: true, ...vitalsSelect, consciousness: true, painScore: true } }),
      this.prisma.icuRecord.count({ where: { recordTime: { gte: since } } }),
      this.prisma.earlyWarningScore.findMany({ where: { recordedAt: { gte: since } }, orderBy: { recordedAt: 'desc' }, take: SCAN_CAP,
        select: { id: true, recordedAt: true, systolicBp: true, heartRate: true, temperature: true, spO2: true, respiratoryRate: true, consciousness: true } }),
      this.prisma.earlyWarningScore.count({ where: { recordedAt: { gte: since } } }),
    ]);
    const now = new Date();
    const ledgers: VitalLedgerReport[] = [
      tally('PRE_VISIT', pvTotal, pv.map(({ id, measuredAt, ...v }) => ({ id, at: measuredAt, v })), now),
      tally('FLOWSHEET', fsTotal, fs.map(({ id, recordedAt, ...v }) => ({ id, at: recordedAt, v })), now),
      tally('ICU', icuTotal, icu.map(({ id, recordTime, ...v }) => ({ id, at: recordTime, v })), now),
      // 조기경보는 혈압 이완기를 받지 않는 원장이다(NEWS2 는 수축기만) — 짝 없음은 이 원장의 정의라 세지 않는다
      tally('EWS', ewsTotal, ews.map(({ id, recordedAt, spO2, ...v }) => ({ id, at: recordedAt, v: { ...v, spo2: spO2 } })), now, ['BP_INCOMPLETE']),
    ];
    return {
      days,
      since: since.toISOString(),
      ledgers,
      schemaAliases: [{ model: 'EarlyWarningScore', field: 'spO2', canonical: 'spo2' }],
    };
  }
}

function tally(
  source: VitalLedgerSource, total: number,
  rows: Array<{ id: string; at: Date | null; v: Record<string, unknown> }>, now: Date,
  ignore: VitalConformanceCode[] = [],
): VitalLedgerReport {
  const byCode: Partial<Record<VitalConformanceCode, number>> = {};
  const samples: VitalLedgerReport['samples'] = [];
  let recordsWithErrors = 0;
  for (const r of rows) {
    const { issues } = vitalConformance(r.v, { measuredAt: r.at, now });
    const kept = issues.filter((i) => !ignore.includes(i.code));
    if (kept.some((i) => i.severity === 'ERROR')) recordsWithErrors += 1;
    for (const i of kept) {
      byCode[i.code] = (byCode[i.code] ?? 0) + 1;
      if (samples.length < SAMPLE_CAP && i.severity === 'ERROR') samples.push({ id: r.id, at: r.at ? r.at.toISOString() : null, code: i.code, key: i.key, value: i.value });
    }
  }
  return { source, total, scanned: rows.length, truncated: total > rows.length, recordsWithErrors, byCode, samples };
}
