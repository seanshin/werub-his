import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { specialtyTodayList, specialtyTodayStats, specialtyRecordPatients } from '../../common/specialty-board';

@Injectable()
export class PlasticService {
  constructor(private readonly prisma: PrismaService) {}

  /* ───── Patients ───── */

  /** 기록이 있는 환자 — 최근 기록 순 상한 + 전체 수·잘림(정본 specialtyRecordPatients · 2026-10-10) */
  async getPatients() {
    return specialtyRecordPatients(this.prisma, (a) => this.prisma.plasticExam.groupBy(a as never), 'examinedAt');
  }

  /* ───── Exams ───── */

  async getExams(patientId: string) {
    return this.prisma.plasticExam.findMany({
      where: { patientId },
      include: { examiner: { select: { familyName: true, givenName: true } } },
      orderBy: { examinedAt: 'desc' },
    });
  }

  async createExam(data: {
    patientId: string; encounterId?: string;
    bodyPart: string; procedure: string;
    anesthesiaType?: string; material?: string;
    fitzpatrickType?: number; skinElasticity?: string;
    scarTendency?: string; photoAngles?: unknown;
    beforePhotoUrls?: unknown; afterPhotoUrls?: unknown;
    complications?: string; duration?: number;
    diagnosis?: string; plan?: string;
    examinedBy: string;
  }) {
    return this.prisma.plasticExam.create({
      data: {
        patientId: data.patientId,
        encounterId: data.encounterId,
        bodyPart: data.bodyPart,
        procedure: data.procedure,
        anesthesiaType: data.anesthesiaType,
        material: data.material,
        fitzpatrickType: data.fitzpatrickType,
        skinElasticity: data.skinElasticity,
        scarTendency: data.scarTendency,
        photoAngles: data.photoAngles as never,
        beforePhotoUrls: data.beforePhotoUrls as never,
        afterPhotoUrls: data.afterPhotoUrls as never,
        complications: data.complications,
        duration: data.duration,
        diagnosis: data.diagnosis,
        plan: data.plan,
        examinedBy: data.examinedBy,
      },
      include: { patient: { select: { familyName: true, givenName: true, mrn: true } } },
    });
  }

  /* ───── Today / Stats ───── */

  async getToday() {
    // 정본 = 오늘 예약(Appointment) — 종전엔 `return []` 리터럴이라 영구 공집합이었다
    return specialtyTodayList(this.prisma, 'plastic');
  }

  async getStats() {
    const total = await this.prisma.plasticExam.count();
    return { totalExams: total, ...(await specialtyTodayStats(this.prisma, 'plastic')) };
  }
}
