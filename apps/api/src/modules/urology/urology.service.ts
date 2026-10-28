import { Injectable } from '@nestjs/common';
import { psaDensity, psaDensityUnavailableReason } from '@hospital-run/shared';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { specialtyTodayList, specialtyTodayStats, specialtyRecordPatients } from '../../common/specialty-board';

@Injectable()
export class UrologyService {
  constructor(private readonly prisma: PrismaService) {}

  /* ───── Patients ───── */

  /** 기록이 있는 환자 — 최근 기록 순 상한 + 전체 수·잘림(정본 specialtyRecordPatients · 2026-10-10) */
  async getPatients() {
    return specialtyRecordPatients(this.prisma, (a) => this.prisma.urologyExam.groupBy(a as never), 'examinedAt');
  }

  /* ───── Exams ───── */

  async getExams(patientId: string) {
    const rows = await this.prisma.urologyExam.findMany({
      where: { patientId },
      include: { examiner: { select: { familyName: true, givenName: true } } },
      orderBy: { examinedAt: 'desc' },
    });
    // PSA 밀도(2026-10-10) — 같은 검사 행의 PSA ÷ 용적을 서버가 계산 · 없으면 null + 이유(다른 날 용적을 끌어오지 않는다)
    return rows.map((r) => ({
      ...r,
      psaDensity: psaDensity(r.psaValue as never, r.prostateVolume as never),
      psaDensityUnavailable: psaDensityUnavailableReason(r.psaValue, r.prostateVolume),
    }));
  }

  async createExam(data: {
    patientId: string; encounterId?: string;
    ipssScore?: number; ipssQol?: number;
    psaValue?: number; urodynamics?: unknown;
    prostateVolume?: number;
    diagnosis?: string; plan?: string;
    examinedBy: string;
  }) {
    return this.prisma.urologyExam.create({
      data: {
        patientId: data.patientId,
        encounterId: data.encounterId,
        ipssScore: data.ipssScore,
        ipssQol: data.ipssQol,
        psaValue: data.psaValue,
        urodynamics: data.urodynamics as never,
        prostateVolume: data.prostateVolume,
        diagnosis: data.diagnosis,
        plan: data.plan,
        examinedBy: data.examinedBy,
      },
      include: { patient: { select: { familyName: true, givenName: true, mrn: true } } },
    });
  }

  /* ───── 시술 기록 — 시술 모듈 부재 갭 해소 ───── */

  async createProcedure(data: {
    patientId: string; encounterId?: string; procedureType: string;
    indication?: string; anesthesia?: string; findings?: string;
    complications?: string; specimenTaken?: boolean; notes?: string;
    performedBy: string;
  }) {
    return this.prisma.urologyProcedure.create({
      data: {
        patientId: data.patientId,
        encounterId: data.encounterId,
        procedureType: data.procedureType,
        indication: data.indication,
        anesthesia: data.anesthesia,
        findings: data.findings,
        complications: data.complications,
        specimenTaken: data.specimenTaken,
        notes: data.notes,
        performedBy: data.performedBy,
      },
      include: { patient: { select: { familyName: true, givenName: true, mrn: true } } },
    });
  }

  async getProcedures(patientId: string) {
    return this.prisma.urologyProcedure.findMany({
      where: { patientId },
      orderBy: { performedAt: 'desc' },
      take: 50,
      include: { performer: { select: { familyName: true, givenName: true } } },
    });
  }

  /* ───── PSA Trend ───── */

  async getPsaTrend(patientId: string) {
    const exams = await this.prisma.urologyExam.findMany({
      where: { patientId, psaValue: { not: null } },
      select: { examinedAt: true, psaValue: true, prostateVolume: true },
      orderBy: { examinedAt: 'asc' },
    });
    return exams.map(e => ({ date: e.examinedAt, psa: e.psaValue, psaDensity: psaDensity(e.psaValue as never, e.prostateVolume as never) }));
  }

  /* ───── IPSS Trend ───── */

  async getIpssTrend(patientId: string) {
    const exams = await this.prisma.urologyExam.findMany({
      where: { patientId, ipssScore: { not: null } },
      select: { examinedAt: true, ipssScore: true },
      orderBy: { examinedAt: 'asc' },
    });
    return exams.map(e => ({ date: e.examinedAt, ipss: e.ipssScore }));
  }

  /* ───── Today / Stats ───── */

  async getToday() {
    // 정본 = 오늘 예약(Appointment) — 종전엔 `return []` 리터럴이라 영구 공집합이었다
    return specialtyTodayList(this.prisma, 'urology');
  }

  async getStats() {
    const total = await this.prisma.urologyExam.count();
    return { totalExams: total, ...(await specialtyTodayStats(this.prisma, 'urology')) };
  }
}
