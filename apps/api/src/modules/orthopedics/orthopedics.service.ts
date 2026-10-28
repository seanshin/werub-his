import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { specialtyTodayList, specialtyTodayStats, specialtyRecordPatients } from '../../common/specialty-board';

@Injectable()
export class OrthopedicsService {
  constructor(private readonly prisma: PrismaService) {}

  /* ───── Patients ───── */

  /** 기록이 있는 환자 — 최근 기록 순 상한 + 전체 수·잘림(정본 specialtyRecordPatients · 2026-10-10) */
  async getPatients() {
    return specialtyRecordPatients(this.prisma, (a) => this.prisma.orthoExam.groupBy(a as never), 'examinedAt');
  }

  /* ───── Exams ───── */

  async getExams(patientId: string) {
    return this.prisma.orthoExam.findMany({
      where: { patientId },
      include: { examiner: { select: { familyName: true, givenName: true } } },
      orderBy: { examinedAt: 'desc' },
    });
  }

  async createExam(data: {
    patientId: string; encounterId?: string;
    bodyPart: string; side?: string; diagnosis?: string; plan?: string;
    rom?: unknown; mmt?: unknown;
    specialTests?: unknown; imagingFindings?: unknown;
    fractureClass?: string; painVas?: number;
    painLocation?: string; painPattern?: string;
    examinedBy: string;
  }) {
    return this.prisma.orthoExam.create({
      data: {
        patientId: data.patientId,
        encounterId: data.encounterId,
        bodyPart: data.bodyPart,
        side: data.side,
        diagnosis: data.diagnosis,
        plan: data.plan,
        rom: data.rom as never,
        mmt: data.mmt as never,
        specialTests: data.specialTests as never,
        imagingFindings: data.imagingFindings as never,
        fractureClass: data.fractureClass,
        painVas: data.painVas,
        painLocation: data.painLocation,
        painPattern: data.painPattern,
        examinedBy: data.examinedBy,
      },
      include: { patient: { select: { familyName: true, givenName: true, mrn: true } } },
    });
  }

  /* ───── Today / Stats ───── */

  async getToday() {
    // 정본 = 오늘 예약(Appointment) — 종전엔 `return []` 리터럴이라 영구 공집합이었다
    return specialtyTodayList(this.prisma, 'orthopedics');
  }

  async getStats() {
    const total = await this.prisma.orthoExam.count();
    return { totalExams: total, ...(await specialtyTodayStats(this.prisma, 'orthopedics')) };
  }
}
