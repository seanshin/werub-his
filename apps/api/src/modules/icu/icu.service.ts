import { admitIcuInTx } from './icu-admit';
import { Injectable, NotFoundException, BadRequestException, ConflictException, Logger, Optional } from '@nestjs/common';
import { ageOf } from '@hospital-run/shared';
import { PATIENT_SENSITIVE_OMIT } from '../../common/patient-select';

import { Prisma, type IcuRecord } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { PatientSafetyService } from '../patient-safety/patient-safety.service';
import { VitalsIngestService } from '../vitals/vitals-ingest.service';
import { computeNews2, computeApache2, computeSofa, IcuVitalRec } from './icu-scores';

/** ICU 번들 6종 — 저장 모델 없음(2026-09-15). 결과는 기록 흉내 대신 이 사실을 말한다. */
export type IcuBundleKind = 'SEPSIS_BUNDLE' | 'INFECTION_BUNDLE' | 'SEDATION' | 'CRRT' | 'ECMO' | 'WEANING_TRIAL';
export const ICU_BUNDLE_NOT_PERSISTED = {
  recorded: false,
  reason: 'NOT_PERSISTED',
  /** 기록된 적이 없으므로 시각·기록자는 없다(모르는 시각을 박지 않는다) */
  recordedAt: null,
  recordedBy: null,
} as const;

/**
 * I/O 합산 — 🔴 (2026-09-15) 종전 `r.intakeOral ?? 0` 합산은 **I/O 를 한 번도 적지 않은 날을 0ml** 로 말했다.
 * 기록이 하나도 없으면 `null`(= 기록 없음), 하나라도 있으면 그 값들의 합이다(진짜 0 과 구분).
 */
export function sumRecorded(values: Array<number | null | undefined>): number | null {
  const got = values.filter((v): v is number => v != null);
  return got.length === 0 ? null : got.reduce((a, b) => a + b, 0);
}

type IoRow = { intakeOral?: number | null; intakeIv?: number | null; intakeOther?: number | null; outputUrine?: number | null; outputDrain?: number | null; outputOther?: number | null };
/** 섭취·배출 합계와 균형 — 한쪽이라도 기록이 없으면 균형은 산출 불가(null) */
export function ioSummary(rows: IoRow[]) {
  const intakeOral = sumRecorded(rows.map((r) => r.intakeOral));
  const intakeIv = sumRecorded(rows.map((r) => r.intakeIv));
  const intakeOther = sumRecorded(rows.map((r) => r.intakeOther));
  const outputUrine = sumRecorded(rows.map((r) => r.outputUrine));
  const outputDrain = sumRecorded(rows.map((r) => r.outputDrain));
  const outputOther = sumRecorded(rows.map((r) => r.outputOther));
  const totalIntake = sumRecorded([intakeOral, intakeIv, intakeOther]);
  const totalOutput = sumRecorded([outputUrine, outputDrain, outputOther]);
  const balance = totalIntake != null && totalOutput != null ? totalIntake - totalOutput : null;
  return { intakeOral, intakeIv, intakeOther, outputUrine, outputDrain, outputOther, totalIntake, totalOutput, balance };
}

/** 인공호흡기 설정값 — IcuRecord 에 담을 자리가 있다(ventMode·fio2·peep·tidalVolume) */
const VENT_SETTING_KEYS = ['ventMode', 'fio2', 'peep', 'tidalVolume'] as const;

@Injectable()
export class IcuService {
  private readonly logger = new Logger(IcuService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly patientSafety: PatientSafetyService,
    /** 활력 수집 포트 — 미주입(단위 테스트)이면 `vitalsPort` 가 같은 prisma 로 구성한다 */
    @Optional() private readonly vitalsIngest?: VitalsIngestService,
  ) {}

  private _vitalsPortFallback?: VitalsIngestService;
  /** 🔴 포트 우회 경로를 만들지 않기 위한 폴백(nursing 과 같은 이유) */
  private get vitalsPort(): VitalsIngestService {
    return this.vitalsIngest ?? (this._vitalsPortFallback ??= new VitalsIngestService(this.prisma));
  }

  /** 최신 IcuRecord(계산 입력) 조회 — 없으면 null */
  private async latestRecord(admissionId: string): Promise<IcuVitalRec | null> {
    const r = await this.prisma.icuRecord.findFirst({ where: { admissionId }, orderBy: { recordTime: 'desc' } });
    if (!r) return null;
    return {
      heartRate: r.heartRate, systolicBp: r.systolicBp, diastolicBp: r.diastolicBp,
      spo2: r.spo2, respiratoryRate: r.respiratoryRate, temperature: r.temperature as unknown as number | null,
      gcScore: r.gcScore, consciousness: r.consciousness, fio2: r.fio2, ventMode: r.ventMode, outputUrine: r.outputUrine,
    };
  }

  private async ageYears(patientId: string): Promise<number | null> {
    const p = await this.prisma.patient.findUnique({ where: { id: patientId }, select: { dateOfBirth: true } });
    if (!p?.dateOfBirth) return null;
    return ageOf(p.dateOfBirth);
  }

  async getBeds() {
    return this.prisma.icuBed.findMany({
      include: {
        admissions: {
          where: { status: 'ADMITTED' },
          include: {
            patient: { select: { id: true, mrn: true, familyName: true, givenName: true } },
            records: { orderBy: { recordTime: 'desc' }, take: 1 },
          },
          take: 1,
        },
      },
      orderBy: [{ unitName: 'asc' }, { bedNumber: 'asc' }],
    });
  }

  async getPatients() {
    const admissions = await this.prisma.icuAdmission.findMany({
      where: { status: 'ADMITTED' },
      include: {
        patient: { select: { id: true, mrn: true, familyName: true, givenName: true, gender: true, dateOfBirth: true } },
        icuBed: { select: { id: true, unitName: true, bedNumber: true } },
        records: { orderBy: { recordTime: 'desc' }, take: 1 },
      },
      orderBy: { admitDate: 'desc' },
    });

    // 🔴 **APACHE II·SOFA 는 활력처럼 매번 적는 값이 아니다.** 입실 시 산출하고 이후 갱신하지
    //    않으므로, '최신 활력 기록'에서 찾으면 **영원히 비어 보인다**(실측: 기록 13건 중 점수는
    //    9건에 있는데 재실 3명의 최신 기록엔 전부 NULL → 화면 APACHE 열이 늘 `-`).
    //    점수가 **실제로 기록된 가장 최근 값**을 따로 붙여, 언제 잰 값인지와 함께 보여준다.
    const ids = admissions.map((a) => a.id);
    const scored = ids.length
      ? await this.prisma.icuRecord.findMany({
          where: {
            admissionId: { in: ids },
            OR: [{ apacheScore: { not: null } }, { sofaScore: { not: null } }],
          },
          orderBy: { recordTime: 'desc' },
          select: { admissionId: true, recordTime: true, apacheScore: true, sofaScore: true },
        })
      : [];

    const latestScore = new Map<string, { apacheScore: number | null; sofaScore: number | null; scoredAt: Date }>();
    for (const r of scored) {
      if (!latestScore.has(r.admissionId)) {
        latestScore.set(r.admissionId, { apacheScore: r.apacheScore, sofaScore: r.sofaScore, scoredAt: r.recordTime });
      }
    }

    return admissions.map((a) => ({ ...a, latestScores: latestScore.get(a.id) ?? null }));
  }

  async getPatientDetail(admissionId: string) {
    const adm = await this.prisma.icuAdmission.findUnique({
      where: { id: admissionId },
      include: {
        patient: { omit: PATIENT_SENSITIVE_OMIT },
        icuBed: true,
        records: { orderBy: { recordTime: 'desc' }, take: 50 },
      },
    });
    if (!adm) throw new NotFoundException('ICU admission not found');

    // Calculate I/O totals for today
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const todayRecords = adm.records.filter(r => new Date(r.recordTime) >= today);
    // 🔴 I/O 를 적지 않은 항목·날은 0 이 아니라 null(기록 없음) — ioSummary 참고
    const ioTotal = ioSummary(todayRecords);

    return { ...adm, ioTotal };
  }

  async admit(data: { patientId: string; icuBedId: string; doctorId: string; admitReason: string; severity?: string; ventilator?: boolean; isolation?: boolean }) {
    const bed = await this.prisma.icuBed.findUnique({ where: { id: data.icuBedId } });
    if (!bed) throw new NotFoundException('ICU bed not found');
    if (bed.status !== 'AVAILABLE') throw new BadRequestException('Bed is not available');
    // 이미 재원 중인 환자 이중입원 방지
    const active = await this.prisma.icuAdmission.findFirst({ where: { patientId: data.patientId, status: 'ADMITTED' }, select: { id: true } });
    if (active) throw new BadRequestException('환자가 이미 ICU에 재원 중입니다');

    // 비관적 선점·입실 생성은 정본 `admitIcuInTx`(PACU 퇴실 → ICU 도 같은 함수)
    return this.prisma.$transaction((tx) => admitIcuInTx(tx, data));
  }

  async discharge(id: string, userId?: string, transfer?: { toDoctorId?: string; toWard?: string }) {
    const admission = await this.prisma.icuAdmission.findUnique({ where: { id } });
    if (!admission) throw new NotFoundException('ICU admission not found');
    if (admission.status !== 'ADMITTED') throw new BadRequestException('Already discharged');

    const result = await this.prisma.$transaction(async (tx) => {
      await tx.icuBed.update({ where: { id: admission.icuBedId }, data: { status: 'AVAILABLE' } });
      return tx.icuAdmission.update({ where: { id }, data: { status: 'DISCHARGED', dischargeDate: new Date() } });
    });

    // ICU→병동 전동 SBAR/I-PASS 핸드오프(P3) — 인수의(toDoctorId) 지정 시 ClinicalHandoff 생성(ER→입원과 대칭).
    //  기존: ICU엔 전동 로직 없이 퇴실만 → 최근 활력·미완 처치 누락 전달 위험. 비차단.
    if (userId && transfer?.toDoctorId) {
      try {
        const latest = await this.prisma.icuRecord.findFirst({
          where: { admissionId: id }, orderBy: { recordTime: 'desc' },
          select: { heartRate: true, systolicBp: true, spo2: true, respiratoryRate: true, temperature: true, consciousness: true },
        });
        await this.prisma.clinicalHandoff.create({
          data: {
            type: 'ICU_TO_WARD',
            patientId: admission.patientId,
            fromDoctorId: userId,
            toDoctorId: transfer.toDoctorId,
            summary: `ICU 퇴실 병동 전동 인수인계${transfer.toWard ? ` → ${transfer.toWard}` : ''}`,
            illness: 'UNSTABLE',
            situationAwareness: 'ICU 퇴실 후 병동 전동',
            vitalSigns: (latest ?? undefined) as never,
          },
        });
      } catch (e) {
        this.logger.warn(`ICU→병동 핸드오프 생성 실패(비차단): ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    return result;
  }

  async addRecord(admissionId: string, data: {
    recordedBy: string;
    heartRate?: number; systolicBp?: number; diastolicBp?: number; spo2?: number;
    respiratoryRate?: number; temperature?: number;
    gcScore?: number; consciousness?: string; pupilReaction?: string;
    intakeOral?: number; intakeIv?: number; intakeOther?: number;
    outputUrine?: number; outputDrain?: number; outputOther?: number;
    ventMode?: string; fio2?: number; peep?: number; tidalVolume?: number; pip?: number;
    apacheScore?: number; sofaScore?: number; painScore?: number; sedationScore?: number;
    notes?: string;
  }) {
    const admission = await this.prisma.icuAdmission.findUnique({ where: { id: admissionId } });
    if (!admission) throw new NotFoundException('ICU admission not found');

    // 🔴 저장은 **활력 수집 포트**를 지난다. 종전엔 여기서 prisma 로 직접 썼고,
    //    `data.x ? Number(data.x) : undefined` 라 **실측 0 이 전부 미측정으로 사라졌다** —
    //    RASS 0(각성)·통증 0·PEEP 0·SpO₂ 0(프로브 이탈)·심박 0(무수축)이 기록되지 않았다.
    //    "미측정을 0 으로 접지 않는다"의 대칭 — **0 을 미측정으로 버리지도 않는다**. 포트가 둘 다 지킨다.
    const ingest = await this.vitalsPort.ingest<IcuRecord>({
      route: 'ICU',
      admissionId,
      recordedBy: data.recordedBy,
      // 🔴 ICU 기록에는 측정 시각 입력 자리가 없다(DTO·스키마 모두). 지어내지 않고 미상으로 넘긴다 —
      //    포트가 `MEASURED_AT_UNKNOWN`+`MEASURED_AT_DEFAULTED_TO_RECEIPT` 로 표시하고 수신 시각을 박는다.
      //    (종전 `recordTime: new Date()` 와 저장되는 값은 같다. 달라진 것은 그 사실을 말한다는 점이다.)
      values: {
        heartRate: data.heartRate,
        systolicBp: data.systolicBp,
        diastolicBp: data.diastolicBp,
        spo2: data.spo2,
        respiratoryRate: data.respiratoryRate,
        temperature: data.temperature,
        painScore: data.painScore,
        consciousness: data.consciousness,
      },
      extras: {
        gcScore: data.gcScore,
        pupilReaction: data.pupilReaction,
        intakeOral: data.intakeOral,
        intakeIv: data.intakeIv,
        intakeOther: data.intakeOther,
        outputUrine: data.outputUrine,
        outputDrain: data.outputDrain,
        outputOther: data.outputOther,
        ventMode: data.ventMode,
        fio2: data.fio2,
        peep: data.peep,
        tidalVolume: data.tidalVolume,
        pip: data.pip,
        apacheScore: data.apacheScore,
        sofaScore: data.sofaScore,
        sedationScore: data.sedationScore,
        notes: data.notes,
      },
    });
    if (ingest.status !== 'STORED' || !ingest.stored) {
      this.logger.warn(`ICU 기록 미저장(${ingest.status}${ingest.pendingReason ? `/${ingest.pendingReason}` : ''}) 재원 ${admissionId}`);
      return ingest.stored;
    }
    const record = ingest.stored;

    // NEWS2 자동 산출 — 병동(nursing)과 동일 경로 재사용(EarlyWarningScore 영속 + ews.recorded emit + 에스컬레이션).
    //  기존: ICU 활력이 저장만 되고 EWS는 아무도 영속·에스컬레이션하지 않아 조기경보가 병동과 이원화되던 결함.
    //  필수 6요소가 모두 있고 기록자(recordedBy)가 있을 때만. 비차단(실패해도 활력 기록은 성공).
    const rr = record.respiratoryRate, sp = record.spo2, sbp = record.systolicBp, hr = record.heartRate;
    const temp = record.temperature != null ? Number(record.temperature) : null;
    const cons = record.consciousness;
    if (record.recordedBy && rr != null && sp != null && sbp != null && hr != null && temp != null && cons) {
      try {
        await this.patientSafety.calculateAndSaveEws(admission.patientId, record.recordedBy, {
          respiratoryRate: rr, spO2: sp,
          supplementalO2: (record.fio2 != null && record.fio2 > 21) || !!record.ventMode,
          spO2Scale: 1, systolicBp: sbp, heartRate: hr, consciousness: cons, temperature: temp,
        });
      } catch (e) {
        this.logger.warn(`ICU EWS 자동 산출 실패(비차단): ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    return record;
  }

  async getRecords(admissionId: string) {
    return this.prisma.icuRecord.findMany({ where: { admissionId }, orderBy: { recordTime: 'desc' }, take: 500 });
  }

  /** 플로우시트 — 시계열 표 형태 (최근 24시간) */
  async getFlowsheet(admissionId: string) {
    const since = new Date(); since.setHours(since.getHours() - 24);
    const records = await this.prisma.icuRecord.findMany({
      where: { admissionId, recordTime: { gte: since } },
      orderBy: { recordTime: 'asc' },
    });

    return {
      records,
      summary: {
        count: records.length,
        lastVitals: records.length > 0 ? records[records.length - 1] : null,
        // 🔴 섭취·배출 중 한쪽이라도 기록이 없으면 균형은 산출 불가(null) — 0 으로 말하지 않는다
        ioBalance: ioSummary(records).balance,
      },
    };
  }

  /**
   * 인공호흡기 사용 여부·설정 변경.
   * 🔴 (2026-09-15) 종전: DTO 로 ventMode·fio2·peep·tidalVolume 을 받고 `ventilator` boolean 만 저장 — 설정값은
   *    **성공 응답과 함께 조용히 버려졌다.** 입원 존재 확인도 없어 없는 id 는 Prisma 오류(500)였다.
   *    설정값을 담을 자리는 이미 IcuRecord 에 있다 → **활력 수집 정본(addRecord → ingest 포트)** 으로 기록한다.
   *    기록자 = 로그인 사용자. 기록이 보류되면(PENDING 등) 저장되지 않았다는 사실을 응답이 말한다.
   */
  async updateVentilator(
    admissionId: string,
    data: { ventilator: boolean; ventMode?: string; fio2?: number; peep?: number; tidalVolume?: number },
    userId: string,
  ) {
    const exists = await this.prisma.icuAdmission.findUnique({ where: { id: admissionId }, select: { id: true } });
    if (!exists) throw new NotFoundException('ICU admission not found');

    const admission = await this.prisma.icuAdmission.update({
      where: { id: admissionId },
      data: { ventilator: data.ventilator },
    });

    const provided = VENT_SETTING_KEYS.filter((k) => data[k] != null);
    if (provided.length === 0) {
      return { ...admission, settings: { provided: [], stored: false, recordId: null, reason: 'NO_SETTINGS_PROVIDED' as const } };
    }
    const record = await this.addRecord(admissionId, {
      recordedBy: userId,
      ventMode: data.ventMode, fio2: data.fio2, peep: data.peep, tidalVolume: data.tidalVolume,
    });
    return {
      ...admission,
      settings: record
        ? { provided, stored: true, recordId: (record as { id: string }).id, reason: null }
        : { provided, stored: false, recordId: null, reason: 'RECORD_NOT_STORED' as const },
    };
  }

  async getDashboard() {
    const beds = await this.prisma.icuBed.findMany();
    const totalBeds = beds.length;
    const occupied = beds.filter(b => b.status === 'OCCUPIED').length;
    const available = beds.filter(b => b.status === 'AVAILABLE').length;

    const [ventilatorCount, isolationCount, admissions] = await Promise.all([
      this.prisma.icuAdmission.count({ where: { status: 'ADMITTED', ventilator: true } }),
      this.prisma.icuAdmission.count({ where: { status: 'ADMITTED', isolation: true } }),
      this.prisma.icuAdmission.findMany({
        where: { status: 'ADMITTED' },
        select: { severity: true },
      }),
    ]);

    const severityCounts = {
      CRITICAL: admissions.filter(a => a.severity === 'CRITICAL').length,
      SEVERE: admissions.filter(a => a.severity === 'SEVERE').length,
      MODERATE: admissions.filter(a => a.severity === 'MODERATE').length,
    };

    return {
      totalBeds, occupied, available,
      // 🔴 등록 ICU 병상이 0이면 가동률은 0%(=여유 있음)가 아니라 **산출 불가**다(/executive 와 같은 규약).
      //    분자·분모는 위 `occupied`/`totalBeds` 가 이미 낸다 — 화면은 그것으로 `n / N (p%)` 를 그린다.
      occupancyRate: totalBeds > 0 ? Math.round((occupied / totalBeds) * 100) : null,
      ventilatorCount, isolationCount, severityCounts,
    };
  }

  // ── APACHE II 스코어 (실계산 — 최신 IcuRecord 기반·검사성분 미연동 명시) ──

  async calculateApache(admissionId: string) {
    const admission = await this.prisma.icuAdmission.findUnique({ where: { id: admissionId } });
    if (!admission) throw new NotFoundException('ICU admission not found');
    const rec = await this.latestRecord(admissionId);
    if (!rec) return { admissionId, score: null, note: '기록 없음 — 활력 입력 후 산정', calculatedAt: new Date() };
    const age = await this.ageYears(admission.patientId);
    const r = computeApache2(rec, age);
    return { admissionId, ...r, calculatedAt: new Date() };
  }

  // ── SOFA 스코어 (실계산 — GCS·MAP·요량 기반·검사성분 미연동 명시) ──

  async calculateSofa(admissionId: string) {
    const admission = await this.prisma.icuAdmission.findUnique({ where: { id: admissionId } });
    if (!admission) throw new NotFoundException('ICU admission not found');
    const rec = await this.latestRecord(admissionId);
    if (!rec) return { admissionId, totalScore: null, note: '기록 없음 — 활력 입력 후 산정', calculatedAt: new Date() };
    const r = computeSofa(rec);
    return { admissionId, ...r, calculatedAt: new Date() };
  }

  // ── NEWS2 조기경고 (실계산 — 재실 전 환자 최신 활력 기반) ──

  async getNews2Alerts() {
    const admissions = await this.prisma.icuAdmission.findMany({
      where: { status: 'ADMITTED' },
      include: {
        icuBed: { select: { bedNumber: true } },
        records: { orderBy: { recordTime: 'desc' }, take: 1 },
      },
    });
    const patIds = [...new Set(admissions.map((a) => a.patientId))];
    const pats = patIds.length ? await this.prisma.patient.findMany({ where: { id: { in: patIds } }, select: { id: true, familyName: true, givenName: true } }) : [];
    const pMap = new Map(pats.map((p) => [p.id, p]));

    const alerts = admissions
      .map((a) => {
        const rec = a.records[0];
        if (!rec) return null;
        const vr: IcuVitalRec = { heartRate: rec.heartRate, systolicBp: rec.systolicBp, diastolicBp: rec.diastolicBp, spo2: rec.spo2, respiratoryRate: rec.respiratoryRate, temperature: rec.temperature as unknown as number | null, gcScore: rec.gcScore, consciousness: rec.consciousness, fio2: rec.fio2, ventMode: rec.ventMode };
        const n = computeNews2(vr);
        const p = pMap.get(a.patientId);
        return {
          admissionId: a.id, patientName: p ? `${p.familyName ?? ''}${p.givenName ?? ''}` : '-',
          bedNumber: a.icuBed?.bedNumber ?? '-', news2Score: n.score, riskLevel: n.riskLevel,
          /** 산출 불가 사유 — 무엇이 관측되지 않아 점수를 못 냈는지(빈 배열=산출됨) */
          missing: n.missing,
          triggeredAt: rec.recordTime,
          parameters: { heartRate: rec.heartRate, systolicBp: rec.systolicBp, spo2: rec.spo2, respiratoryRate: rec.respiratoryRate, temperature: rec.temperature, consciousness: rec.consciousness },
        };
      })
      // 🔴 산출 불가 건을 **버리지 않는다** — 종전엔 관측이 빠진 환자가 부분 점수로 낮게 나와
      //    임계 아래로 떨어지면 보드에서 조용히 사라졌다. 이제 'UNSCORABLE' 로 함께 올려
      //    "무엇이 없어서 못 냈는지"를 화면이 말하게 한다(0점으로 바꾸지 않는다).
      .filter((x): x is NonNullable<typeof x> =>
        x != null && (x.riskLevel === 'MEDIUM' || x.riskLevel === 'HIGH' || x.riskLevel === 'UNSCORABLE'))
      // 산출 불가는 점수로 정렬할 수 없다 — 맨 위에 둔다(확인이 필요한 건이므로)
      .sort((a, b) => (b.news2Score ?? Number.MAX_SAFE_INTEGER) - (a.news2Score ?? Number.MAX_SAFE_INTEGER));
    return alerts;
  }

  // ── ICU 번들 6종(패혈증·감염·진정·CRRT·ECMO·SBT) ──
  //
  // 🔴 (2026-09-15 P16) 여섯 EP 모두 **아무것도 저장하지 않고** `completedAt/recordedAt: new Date()` 와 함께
  //    "기록됐다"는 모양만 돌려줬다. 빠진 값은 지어냈다 — SBT `result: 'PASS'`·이탈 결정 `CONTINUE_WEANING`,
  //    감염 번들 준수율 `100`, RASS `0`·BPS `3`·CAM-ICU 음성, CRRT 혈류 200·투석액 1500·항응고 citrate,
  //    ECMO VV·혈류 3.5·RPM 3000·FiO2 100. 담을 모델이 schema 에 없다(IcuRecord 는 활력·I/O·호흡기·점수만).
  //    스키마를 만드는 것은 이 배치의 몫이 아니므로 **기록 흉내를 멈춘다** — 받은 값을 지어낸 기본값으로 채워
  //    되돌려주지 않고, 저장되지 않았다는 사실과 사유만 말한다. 호출하는 web·mobile 화면은 0(2026-09-15 grep).
  //    입원 존재 확인(404)은 유지한다 — 잘못된 id 를 '저장 안 됨'으로 흐리지 않는다.

  private async notPersisted(admissionId: string, kind: IcuBundleKind) {
    const admission = await this.prisma.icuAdmission.findUnique({ where: { id: admissionId }, select: { id: true } });
    if (!admission) throw new NotFoundException('ICU admission not found');
    return { admissionId, kind, ...ICU_BUNDLE_NOT_PERSISTED };
  }

  async recordSepsisBundle(admissionId: string, _data: Record<string, unknown>) { return this.notPersisted(admissionId, 'SEPSIS_BUNDLE'); }
  async recordInfectionBundle(admissionId: string, _data: Record<string, unknown>) { return this.notPersisted(admissionId, 'INFECTION_BUNDLE'); }
  async recordSedation(admissionId: string, _data: Record<string, unknown>) { return this.notPersisted(admissionId, 'SEDATION'); }
  async recordCrrt(admissionId: string, _data: Record<string, unknown>) { return this.notPersisted(admissionId, 'CRRT'); }
  async recordEcmo(admissionId: string, _data: Record<string, unknown>) { return this.notPersisted(admissionId, 'ECMO'); }
  async recordWeaningTrial(admissionId: string, _data: Record<string, unknown>) { return this.notPersisted(admissionId, 'WEANING_TRIAL'); }
}
