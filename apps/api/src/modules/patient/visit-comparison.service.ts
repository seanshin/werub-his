import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

/**
 * 이번 방문 ↔ 직전 방문 대비 (patient-chart-refinement C7 · G2 "임상 판단은 값이 아니라 변화로 한다").
 *
 * 🔴 **값만 나란히 둔다.** "악화·호전·신규 위험" 같은 판정 문구를 서버도 화면도 만들지 않는다 —
 *    판정 기준이 정본에 있을 때만 판정한다(검사 flag 는 보고 시점에 기록된 값이라 그대로 싣는다).
 * 🔴 **모르는 것은 null.** 한쪽 방문에서 재지 않은 활력·하지 않은 검사는 0 이 아니라 null(화면 `-`).
 * 🔴 **직전 방문이 없으면 비교 대상이 없다고 말한다**(`previous: null` · reason `NO_PREVIOUS_VISIT`).
 *
 * 직전 방문 = 이번 방문보다 **먼저 생성된** 같은 환자의 방문 중 서명(SIGNED·AMENDED)된 가장 최근 것.
 *   작성 중(DRAFT) 기록은 내용이 확정되지 않아 "지난번 값"의 근거가 되지 못한다 — 이번 방문은 DRAFT 여도 된다.
 * 처방은 약물(MEDICATION)·활성(ACTIVE)만 — 취소된 처방은 "그 방문에서 쓴 약"이 아니다.
 * 활력은 그 방문에 연결된(encounterId) 진료 전 측정의 **최근 1건**. 연결이 없으면 null(환자 전체 최근값으로 대신하지 않는다).
 * 검사는 그 방문 처방에서 나온 결과만(`order.prescription.encounterId`). 같은 항목이 여러 번이면 가장 최근 1건 + 건수.
 */

const MAX_ROWS = 200;

export type ComparisonReason = 'NO_ENCOUNTER' | 'NO_PREVIOUS_VISIT' | null;

export interface VisitRef {
  id: string;
  createdAt: string;
  status: string;
  visitType: string | null;
  doctorName: string | null;
}

export interface VitalsSnapshot {
  measuredAt: string;
  systolicBp: number | null;
  diastolicBp: number | null;
  heartRate: number | null;
  temperature: number | null;
  spo2: number | null;
  respiratoryRate: number | null;
  painScore: number | null;
  weight: number | null;
  bmi: number | null;
}

export interface DiagnosisSide { type: string; certainty: string | null }
export interface DiagnosisRow { code: string; nameKo: string; nameEn: string | null; current: DiagnosisSide | null; previous: DiagnosisSide | null }

export interface MedicationSide { dosage: string | null; frequency: string | null; duration: number | null; route: string | null; count: number }
export interface MedicationRow { key: string; nameKo: string | null; nameEn: string | null; ingredient: string | null; current: MedicationSide | null; previous: MedicationSide | null }

export interface LabSide { value: string; unit: string; flag: string | null; status: string; resultAt: string; count: number }
export interface LabRow { key: string; testName: string; current: LabSide | null; previous: LabSide | null }

export interface VisitComparison {
  reason: ComparisonReason;
  current: VisitRef | null;
  previous: VisitRef | null;
  vitals: { current: VitalsSnapshot | null; previous: VitalsSnapshot | null };
  diagnoses: DiagnosisRow[];
  medications: MedicationRow[];
  labs: LabRow[];
  /** 🔴 한 방문의 처방·검사가 MAX_ROWS 를 넘어 잘렸으면 true — 잘린 비교를 전체처럼 그리지 않는다 */
  truncated: boolean;
}

interface Snapshot {
  vitals: VitalsSnapshot | null;
  diagnoses: Map<string, { nameKo: string; nameEn: string | null; side: DiagnosisSide }>;
  medications: Map<string, { nameKo: string | null; nameEn: string | null; ingredient: string | null; side: MedicationSide }>;
  labs: Map<string, { testName: string; side: LabSide }>;
  truncated: boolean;
}

const num = (x: unknown): number | null => (x == null ? null : Number(x));
const iso = (d: Date | string | null | undefined): string => (d instanceof Date ? d.toISOString() : String(d));

@Injectable()
export class VisitComparisonService {
  constructor(private readonly prisma: PrismaService) {}

  async compare(patientId: string, encounterId?: string): Promise<VisitComparison> {
    const patient = await this.prisma.patient.findUnique({ where: { id: patientId }, select: { id: true } });
    if (!patient) throw new NotFoundException('Patient not found');

    const encSelect = {
      id: true, createdAt: true, status: true, visitType: true,
      doctor: { select: { familyName: true, givenName: true } },
    } as const;

    const current = encounterId
      // 🔴 다른 환자의 방문 id 를 넣어도 그 방문을 비교하지 않는다 — 환자 조건을 같이 건다(없으면 404)
      ? await this.prisma.encounter.findFirst({ where: { id: encounterId, patientId }, select: encSelect })
      : await this.prisma.encounter.findFirst({ where: { patientId }, orderBy: { createdAt: 'desc' }, select: encSelect });

    if (encounterId && !current) throw new NotFoundException('Encounter not found for this patient');

    const empty: VisitComparison = {
      reason: 'NO_ENCOUNTER', current: null, previous: null,
      vitals: { current: null, previous: null }, diagnoses: [], medications: [], labs: [], truncated: false,
    };
    if (!current) return empty;

    const previous = await this.prisma.encounter.findFirst({
      where: { patientId, id: { not: current.id }, createdAt: { lt: current.createdAt }, status: { in: ['SIGNED', 'AMENDED'] } },
      orderBy: { createdAt: 'desc' },
      select: encSelect,
    });

    const cur = await this.snapshot(current.id);
    const prev = previous ? await this.snapshot(previous.id) : null;

    const ref = (e: NonNullable<typeof current>): VisitRef => ({
      id: e.id,
      createdAt: iso(e.createdAt),
      status: String(e.status),
      visitType: e.visitType ?? null,
      doctorName: e.doctor ? `${e.doctor.familyName ?? ''}${e.doctor.givenName ?? ''}` || null : null,
    });

    const keys = <T>(a: Map<string, T>, b: Map<string, T> | undefined) => [...new Set([...a.keys(), ...(b ? b.keys() : [])])];

    const diagnoses: DiagnosisRow[] = keys(cur.diagnoses, prev?.diagnoses).map((code) => {
      const c = cur.diagnoses.get(code);
      const p = prev?.diagnoses.get(code);
      const meta = (c ?? p)!;
      return { code, nameKo: meta.nameKo, nameEn: meta.nameEn, current: c?.side ?? null, previous: p?.side ?? null };
    });

    const medications: MedicationRow[] = keys(cur.medications, prev?.medications).map((key) => {
      const c = cur.medications.get(key);
      const p = prev?.medications.get(key);
      const meta = (c ?? p)!;
      return { key, nameKo: meta.nameKo, nameEn: meta.nameEn, ingredient: meta.ingredient, current: c?.side ?? null, previous: p?.side ?? null };
    });

    const labs: LabRow[] = keys(cur.labs, prev?.labs).map((key) => {
      const c = cur.labs.get(key);
      const p = prev?.labs.get(key);
      return { key, testName: (c ?? p)!.testName, current: c?.side ?? null, previous: p?.side ?? null };
    });

    return {
      reason: previous ? null : 'NO_PREVIOUS_VISIT',
      current: ref(current),
      previous: previous ? ref(previous) : null,
      vitals: { current: cur.vitals, previous: prev?.vitals ?? null },
      diagnoses,
      medications,
      labs,
      truncated: cur.truncated || (prev?.truncated ?? false),
    };
  }

  private async snapshot(encounterId: string): Promise<Snapshot> {
    const [vital, diagnoses, prescriptions, labResults] = await Promise.all([
      this.prisma.preVisitVitals.findFirst({ where: { encounterId }, orderBy: { measuredAt: 'desc' } }),
      this.prisma.encounterDiagnosis.findMany({
        where: { encounterId },
        orderBy: { rank: 'asc' },
        select: { type: true, certainty: true, diagnosisCode: { select: { code: true, nameKo: true, nameEn: true } } },
      }),
      this.prisma.prescription.findMany({
        where: { encounterId, type: 'MEDICATION', status: 'ACTIVE' },
        orderBy: { createdAt: 'asc' },
        take: MAX_ROWS + 1,
        select: {
          medicationCodeId: true, dosage: true, frequency: true, duration: true, route: true,
          medicationCode: { select: { code: true, nameKo: true, nameEn: true, ingredient: true } },
        },
      }),
      this.prisma.labResult.findMany({
        where: { order: { prescription: { encounterId } }, status: { in: ['COMPLETED', 'VERIFIED'] } },
        orderBy: { createdAt: 'desc' },
        take: MAX_ROWS + 1,
        select: {
          status: true, verifiedAt: true, completedAt: true, createdAt: true,
          items: { select: { testName: true, testCode: true, loincCode: true, value: true, unit: true, flag: true } },
        },
      }),
    ]);

    const vitals: VitalsSnapshot | null = vital
      ? {
          measuredAt: iso(vital.measuredAt),
          systolicBp: vital.systolicBp, diastolicBp: vital.diastolicBp, heartRate: vital.heartRate,
          temperature: num(vital.temperature), spo2: vital.spo2, respiratoryRate: vital.respiratoryRate,
          painScore: vital.painScore, weight: num(vital.weight), bmi: num(vital.bmi),
        }
      : null;

    const dx = new Map<string, { nameKo: string; nameEn: string | null; side: DiagnosisSide }>();
    for (const d of diagnoses) {
      if (!d.diagnosisCode || dx.has(d.diagnosisCode.code)) continue;
      dx.set(d.diagnosisCode.code, { nameKo: d.diagnosisCode.nameKo, nameEn: d.diagnosisCode.nameEn ?? null, side: { type: d.type, certainty: d.certainty ?? null } });
    }

    const truncatedRx = prescriptions.length > MAX_ROWS;
    const meds = new Map<string, { nameKo: string | null; nameEn: string | null; ingredient: string | null; side: MedicationSide }>();
    for (const rx of prescriptions.slice(0, MAX_ROWS)) {
      // 약물 코드가 없는 처방은 서로 같은 약인지 알 수 없다 — 합치지 않고 따로 둔다(비교 행이 짝을 잃는 쪽이 지어낸 짝보다 낫다)
      const key = rx.medicationCodeId ?? `uncoded:${meds.size}`;
      const prevEntry = meds.get(key);
      if (prevEntry) { prevEntry.side.count += 1; continue; }
      meds.set(key, {
        nameKo: rx.medicationCode?.nameKo ?? null,
        nameEn: rx.medicationCode?.nameEn ?? null,
        ingredient: rx.medicationCode?.ingredient ?? null,
        side: { dosage: rx.dosage ?? null, frequency: rx.frequency ?? null, duration: rx.duration ?? null, route: rx.route ?? null, count: 1 },
      });
    }

    const truncatedLab = labResults.length > MAX_ROWS;
    const labs = new Map<string, { testName: string; side: LabSide }>();
    // 결과는 최근순 — 같은 항목의 첫 등장이 가장 최근 값
    for (const r of labResults.slice(0, MAX_ROWS)) {
      const resultAt = iso(r.verifiedAt ?? r.completedAt ?? r.createdAt);
      for (const it of r.items) {
        const key = it.loincCode || it.testCode || it.testName;
        const existing = labs.get(key);
        if (existing) { existing.side.count += 1; continue; }
        labs.set(key, {
          testName: it.testName,
          side: { value: it.value, unit: it.unit, flag: it.flag ?? null, status: String(r.status), resultAt, count: 1 },
        });
      }
    }

    return { vitals, diagnoses: dx, medications: meds, labs, truncated: truncatedRx || truncatedLab };
  }
}
