import { assertSeedAllowed } from './seed-mode-guard';
assertSeedAllowed(__filename, 'DEMO'); // 🔴 가상 병원 데모·기관 특정 데이터 — REAL 에서 중단(상용 릴리즈 T2-3)
// 만성질환(당뇨) 시계열 시드 — 환자 ~30%를 당뇨로, 각 5~30회 측정(18개월 분산), 추이 시나리오.
// 멱등: 환자별 결정적 PRNG(재실행 동일 데이터) + 시드분 삭제 후 재생성(source='CHECKUP' 마커).
// 선행: chronic-observations.sql 적용 + prisma generate.
// 실행: cd apps/api && npx ts-node prisma/seed-diabetes-chronic.ts
import { PrismaClient } from '@prisma/client';
import { createHash } from 'crypto';

const prisma = new PrismaClient();
const SEED_SOURCE = 'CHECKUP'; // 시드 마커(재실행 시 이 source 만 삭제)

/** 문자열 → 32bit seed → mulberry32 PRNG(결정적) */
function rng(seedStr: string) {
  let a = parseInt(createHash('sha256').update(seedStr).digest('hex').slice(0, 8), 16) >>> 0;
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const hashPct = (s: string) => parseInt(createHash('sha256').update(s).digest('hex').slice(0, 6), 16) % 100;
const round1 = (n: number) => Math.round(n * 10) / 10;
const flagOf = (v: number, min: number | null, max: number | null) => (max != null && v > max ? 'H' : min != null && v < min ? 'L' : 'N');

interface Spec { code: string; unit: string; min: number | null; max: number | null }
const SPECS: Record<string, Spec> = {
  HBA1C: { code: 'HBA1C', unit: '%', min: 4.0, max: 6.5 },
  FBS: { code: 'FBS', unit: 'mg/dL', min: 70, max: 100 },
  PPG: { code: 'PPG', unit: 'mg/dL', min: null, max: 140 },
  SBP: { code: 'SBP', unit: 'mmHg', min: null, max: 120 },
  DBP: { code: 'DBP', unit: 'mmHg', min: null, max: 80 },
  WEIGHT: { code: 'WEIGHT', unit: 'kg', min: null, max: null },
  BMI: { code: 'BMI', unit: 'kg/m2', min: 18.5, max: 23 },
};

async function main() {
  const patients = await prisma.patient.findMany({ select: { id: true }, orderBy: { createdAt: 'asc' } });
  const diabetic = patients.filter((p) => hashPct(`dm:${p.id}`) < 30); // ~30%
  const e11 = await prisma.diagnosisCode.findFirst({ where: { code: 'E11' }, select: { id: true } });
  const sysUser = await prisma.user.findFirst({ where: { role: 'ADMIN' }, select: { id: true } }); // ProblemList.addedBy(필수)용
  let totalObs = 0;

  for (const p of diabetic) {
    const r = rng(`obs:${p.id}`);
    const n = 5 + Math.floor(r() * 26); // 5~30회
    const scenario = ['IMPROVING', 'WORSENING', 'STABLE'][Math.floor(r() * 3)];
    const baseHba1c = [6.6, 7.6, 9.0][Math.floor(r() * 3)]; // 양호/경계/불량
    const drift = scenario === 'IMPROVING' ? -0.12 : scenario === 'WORSENING' ? 0.12 : 0; // 회당 HbA1c 변화
    let weight = round1(58 + r() * 32); // 58~90kg
    const heightM = 1.55 + r() * 0.3; // 1.55~1.85m

    const rows: { patientId: string; code: string; value: number; unit: string; measuredAt: Date; source: string; normalMin: number | null; normalMax: number | null; flag: string }[] = [];
    const now = Date.now();
    const spanMs = 18 * 30 * 86400000; // 18개월
    for (let i = 0; i < n; i++) {
      const measuredAt = new Date(now - Math.round(((n - 1 - i) / Math.max(n - 1, 1)) * spanMs));
      const hba1c = Math.max(5.2, round1(baseHba1c + drift * i + (r() - 0.5) * 0.4));
      const fbs = Math.round(100 + (hba1c - 6) * 22 + (r() - 0.5) * 16);
      const ppg = Math.round(fbs + 50 + r() * 60);
      const sbp = Math.round(118 + (r() - 0.3) * 30);
      const dbp = Math.round(74 + (r() - 0.3) * 18);
      weight = round1(weight + (scenario === 'IMPROVING' ? -0.3 : scenario === 'WORSENING' ? 0.3 : 0) + (r() - 0.5));
      const bmi = round1(weight / (heightM * heightM));
      const push = (code: string, value: number) => { const s = SPECS[code]; rows.push({ patientId: p.id, code, value, unit: s.unit, measuredAt, source: SEED_SOURCE, normalMin: s.min, normalMax: s.max, flag: flagOf(value, s.min, s.max) }); };
      if (i % 3 === 0) push('HBA1C', hba1c); // ~3회마다
      push('FBS', fbs);
      if (r() < 0.5) push('PPG', ppg);
      push('SBP', sbp); push('DBP', dbp);
      push('WEIGHT', weight); push('BMI', bmi);
    }

    await prisma.$transaction([
      prisma.chronicObservation.deleteMany({ where: { patientId: p.id, source: SEED_SOURCE } }),
      prisma.chronicObservation.createMany({ data: rows }),
    ]);
    totalObs += rows.length;

    if (e11 && sysUser) {
      const pid = createHash('sha256').update(`pl:${p.id}:E11`).digest('hex');
      const plId = `${pid.slice(0, 8)}-${pid.slice(8, 12)}-4${pid.slice(13, 16)}-a${pid.slice(17, 20)}-${pid.slice(20, 32)}`;
      await prisma.problemList.upsert({
        where: { id: plId },
        update: {},
        create: { id: plId, patientId: p.id, diagnosisCodeId: e11.id, addedBy: sysUser.id, description: '제2형 당뇨병(시드)', status: 'ACTIVE', severity: 'MODERATE', onsetDate: new Date(now - spanMs) },
      }).catch((e: unknown) => { console.error('[PL-FAIL]', p.id, e instanceof Error ? e.message.split('\n')[0] : e); });
    }
  }
  // ── 고혈압 단독 코호트(비당뇨) — 혈압/체중 추이가 당뇨 외 환자에도 보이도록 ──
  const diabeticIds = new Set(diabetic.map((p) => p.id));
  const hypertensive = patients.filter((p) => !diabeticIds.has(p.id) && hashPct(`htn:${p.id}`) < 25); // 비당뇨 중 ~25%
  const i10 = await prisma.diagnosisCode.findFirst({ where: { code: 'I10' }, select: { id: true } });
  let htnObs = 0;

  for (const p of hypertensive) {
    const r = rng(`htn:${p.id}`);
    const n = 6 + Math.floor(r() * 18); // 6~24회
    const scenario = ['IMPROVING', 'WORSENING', 'STABLE'][Math.floor(r() * 3)];
    const baseSbp = [138, 150, 162][Math.floor(r() * 3)]; // 1/2기 고혈압
    const sDrift = scenario === 'IMPROVING' ? -1.2 : scenario === 'WORSENING' ? 1.0 : 0; // 회당 SBP 변화
    let weight = round1(60 + r() * 30);
    const heightM = 1.55 + r() * 0.3;

    const rows: { patientId: string; code: string; value: number; unit: string; measuredAt: Date; source: string; normalMin: number | null; normalMax: number | null; flag: string }[] = [];
    const now = Date.now();
    const spanMs = 18 * 30 * 86400000;
    for (let i = 0; i < n; i++) {
      const measuredAt = new Date(now - Math.round(((n - 1 - i) / Math.max(n - 1, 1)) * spanMs));
      const sbp = Math.round(baseSbp + sDrift * i + (r() - 0.5) * 12);
      const dbp = Math.round(sbp * 0.62 + (r() - 0.5) * 8);
      weight = round1(weight + (scenario === 'IMPROVING' ? -0.2 : scenario === 'WORSENING' ? 0.2 : 0) + (r() - 0.5));
      const bmi = round1(weight / (heightM * heightM));
      const push = (code: string, value: number) => { const s = SPECS[code]; rows.push({ patientId: p.id, code, value, unit: s.unit, measuredAt, source: SEED_SOURCE, normalMin: s.min, normalMax: s.max, flag: flagOf(value, s.min, s.max) }); };
      push('SBP', sbp); push('DBP', dbp); push('WEIGHT', weight); push('BMI', bmi);
      if (r() < 0.3) push('FBS', Math.round(92 + (r() - 0.5) * 16));
    }

    await prisma.$transaction([
      prisma.chronicObservation.deleteMany({ where: { patientId: p.id, source: SEED_SOURCE } }),
      prisma.chronicObservation.createMany({ data: rows }),
    ]);
    htnObs += rows.length;

    if (i10 && sysUser) {
      const pid = createHash('sha256').update(`pl:${p.id}:I10`).digest('hex');
      const plId = `${pid.slice(0, 8)}-${pid.slice(8, 12)}-4${pid.slice(13, 16)}-a${pid.slice(17, 20)}-${pid.slice(20, 32)}`;
      await prisma.problemList.upsert({
        where: { id: plId },
        update: {},
        create: { id: plId, patientId: p.id, diagnosisCodeId: i10.id, addedBy: sysUser.id, description: '본태성 고혈압(시드)', status: 'ACTIVE', severity: 'MODERATE', onsetDate: new Date(now - spanMs) },
      }).catch((e: unknown) => { console.error('[PL-FAIL]', p.id, e instanceof Error ? e.message.split('\n')[0] : e); });
    }
  }

  console.log(`[seed-diabetes-chronic] 당뇨 ${diabetic.length}명(${totalObs}건) + 고혈압 ${hypertensive.length}명(${htnObs}건) / 전체 ${patients.length}명 시드 완료`);
}

main().catch((e) => { console.error('[seed-diabetes-chronic] 실패:', e); process.exit(1); }).finally(() => prisma.$disconnect());
