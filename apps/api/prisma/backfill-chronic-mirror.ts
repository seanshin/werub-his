// 만성질환 측정 미러링 백필(P1 §9.3) — 기존 LabResult/EWS를 ChronicObservation으로 1회 미러.
// 멱등: (source, sourceId) upsert. 신규 이벤트 미러(ChronicSyncService)와 동일 키.
// 실행: cd apps/api && npx ts-node --transpile-only prisma/backfill-chronic-mirror.ts
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

const LAB_CODE_MAP: { match: RegExp; code: string }[] = [
  { match: /당화혈색소|hba1c|a1c/i, code: 'HBA1C' },
  { match: /공복.?혈당|fasting.*glucose|\bfbs\b/i, code: 'FBS' },
  { match: /식후.?(2|이).?시간.?혈당|postprandial|\bpp2\b|\bppg\b/i, code: 'PPG' },
  { match: /ldl/i, code: 'LDL' },
  { match: /중성지방|triglyceride|\btg\b/i, code: 'TG' },
  { match: /크레아티닌|creatinine|\bcr\b/i, code: 'CR' },
  { match: /egfr|사구체여과/i, code: 'EGFR' },
];
const CODE_SPEC: Record<string, { unit: string; min: number | null; max: number | null }> = {
  HBA1C: { unit: '%', min: 4.0, max: 6.5 }, FBS: { unit: 'mg/dL', min: 70, max: 100 }, PPG: { unit: 'mg/dL', min: null, max: 140 },
  SBP: { unit: 'mmHg', min: null, max: 120 }, LDL: { unit: 'mg/dL', min: null, max: 100 }, TG: { unit: 'mg/dL', min: null, max: 150 },
  CR: { unit: 'mg/dL', min: 0.5, max: 1.2 }, EGFR: { unit: 'mL/min', min: 60, max: null },
};
const mapCode = (t: string) => LAB_CODE_MAP.find((m) => m.match.test(t))?.code ?? null;
const parseNum = (v: string) => { const m = String(v).match(/-?\d+(\.\d+)?/); return m ? Number(m[0]) : null; };
const flagOf = (v: number, min: number | null, max: number | null) => (max != null && v > max ? 'H' : min != null && v < min ? 'L' : 'N');

async function upsert(d: { patientId: string; code: string; value: number; unit: string; measuredAt: Date; source: string; sourceId: string; context: string; min: number | null; max: number | null }) {
  await prisma.chronicObservation.upsert({
    where: { source_sourceId: { source: d.source, sourceId: d.sourceId } },
    update: { value: d.value, unit: d.unit, measuredAt: d.measuredAt, flag: flagOf(d.value, d.min, d.max), normalMin: d.min, normalMax: d.max, context: d.context },
    create: { patientId: d.patientId, code: d.code, value: d.value, unit: d.unit, measuredAt: d.measuredAt, source: d.source, sourceId: d.sourceId, context: d.context, normalMin: d.min, normalMax: d.max, flag: flagOf(d.value, d.min, d.max) },
  });
}

async function main() {
  // 1) LabResultItem → 미러(CHRONIC)
  const items = await prisma.labResultItem.findMany({
    select: { id: true, testName: true, value: true, unit: true, labResult: { select: { patientId: true, completedAt: true, collectedAt: true } } },
  });
  let lab = 0, labSkip = 0;
  for (const it of items) {
    const code = mapCode(it.testName);
    const val = code ? parseNum(it.value) : null;
    if (!code || val === null || !it.labResult?.patientId) { labSkip++; continue; }
    const spec = CODE_SPEC[code] ?? { unit: it.unit || '', min: null, max: null };
    await upsert({ patientId: it.labResult.patientId, code, value: val, unit: it.unit || spec.unit, measuredAt: it.labResult.completedAt ?? it.labResult.collectedAt ?? new Date(), source: 'LAB', sourceId: `LAB:${it.id}`, context: 'CHRONIC', min: spec.min, max: spec.max });
    lab++;
  }

  // 2) EarlyWarningScore → SBP 미러(ACUTE)
  const ews = await prisma.earlyWarningScore.findMany({ select: { id: true, patientId: true, systolicBp: true, recordedAt: true } });
  let e = 0;
  for (const w of ews) {
    if (w.systolicBp == null) continue;
    const s = CODE_SPEC.SBP;
    await upsert({ patientId: w.patientId, code: 'SBP', value: w.systolicBp, unit: s.unit, measuredAt: w.recordedAt, source: 'EWS', sourceId: `EWS:${w.id}:SBP`, context: 'ACUTE', min: s.min, max: s.max });
    e++;
  }

  console.log(`[backfill-chronic-mirror] LAB 미러 ${lab}건(스킵 ${labSkip}) + EWS(SBP) ${e}건 완료`);
}
main().catch((err) => { console.error('[backfill-chronic-mirror] 실패:', err); process.exit(1); }).finally(() => prisma.$disconnect());
