import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { specialtyTodayList, specialtyTodayStats, specialtyRecordPatients } from '../../common/specialty-board';

@Injectable()
export class NeurosurgeryService {
  constructor(private readonly prisma: PrismaService) {}

  /* ───── Patients ───── */

  /** 기록이 있는 환자 — 최근 기록 순 상한 + 전체 수·잘림(정본 specialtyRecordPatients · 2026-10-10) */
  async getPatients() {
    return specialtyRecordPatients(this.prisma, (a) => this.prisma.neuroExam.groupBy(a as never), 'examinedAt');
  }

  /* ───── Exams ───── */

  async getExams(patientId: string) {
    return this.prisma.neuroExam.findMany({
      where: { patientId },
      include: { examiner: { select: { familyName: true, givenName: true } } },
      orderBy: { examinedAt: 'desc' },
    });
  }

  async createExam(data: {
    patientId: string; encounterId?: string;
    gcsEye?: number; gcsVerbal?: number; gcsMotor?: number;
    gcsTotal?: number; pupilRight?: unknown; pupilLeft?: unknown;
    anisocoria?: boolean;
    motorExam?: unknown; sensoryExam?: unknown;
    reflexes?: unknown; babinski?: unknown;
    cranialNerves?: unknown; asiaScale?: string; nihss?: number;
    diagnosis?: string; plan?: string;
    examinedBy: string;
  }) {
    return this.prisma.neuroExam.create({
      data: {
        patientId: data.patientId,
        encounterId: data.encounterId,
        gcsEye: data.gcsEye,
        gcsVerbal: data.gcsVerbal,
        gcsMotor: data.gcsMotor,
        gcsTotal: data.gcsTotal,
        pupilRight: data.pupilRight as never,
        pupilLeft: data.pupilLeft as never,
        anisocoria: data.anisocoria,
        motorExam: data.motorExam as never,
        sensoryExam: data.sensoryExam as never,
        reflexes: data.reflexes as never,
        babinski: data.babinski as never,
        cranialNerves: data.cranialNerves as never,
        asiaScale: data.asiaScale,
        nihss: data.nihss,
        diagnosis: data.diagnosis,
        plan: data.plan,
        examinedBy: data.examinedBy,
      },
      include: { patient: { select: { familyName: true, givenName: true, mrn: true } } },
    });
  }

  /* ───── GCS Trend ───── */

  async getGcsTrend(patientId: string) {
    const exams = await this.prisma.neuroExam.findMany({
      where: { patientId },
      select: {
        examinedAt: true,
        gcsEye: true,
        gcsVerbal: true,
        gcsMotor: true,
        gcsTotal: true,
      },
      orderBy: { examinedAt: 'asc' },
    });
    return exams.map(e => ({
      date: e.examinedAt,
      eye: e.gcsEye,
      verbal: e.gcsVerbal,
      motor: e.gcsMotor,
      total: e.gcsTotal,
    }));
  }

  /* ───── Today / Stats ───── */

  async getToday() {
    // 정본 = 오늘 예약(Appointment) — 종전엔 `return []` 리터럴이라 영구 공집합이었다
    return specialtyTodayList(this.prisma, 'neurosurgery');
  }

  async getStats() {
    const total = await this.prisma.neuroExam.count();
    return { totalExams: total, ...(await specialtyTodayStats(this.prisma, 'neurosurgery')) };
  }
}
