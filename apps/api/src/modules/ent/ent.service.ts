import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { specialtyTodayList, specialtyTodayStats, specialtyRecordPatients } from '../../common/specialty-board';

@Injectable()
export class EntService {
  constructor(private readonly prisma: PrismaService) {}

  /* ───── Patients (내 환자 목록) ───── */

  /** 기록이 있는 환자 — 최근 기록 순 상한 + 전체 수·잘림(정본 specialtyRecordPatients · 2026-10-10) */
  async getPatients() {
    return specialtyRecordPatients(this.prisma, (a) => this.prisma.entExam.groupBy(a as never), 'examinedAt');
  }

  /* ───── Exam ───── */

  async createExam(data: {
    patientId: string; encounterId?: string;
    otoscopyRight?: unknown; otoscopyLeft?: unknown;
    audiogramRight?: unknown; audiogramLeft?: unknown;
    ptaRight?: number; ptaLeft?: number;
    speechRight?: number; speechLeft?: number;
    tympanometryRight?: string; tympanometryLeft?: string;
    nasalEndoscopy?: unknown; nasalEndoscopyImageUrl?: string;
    pharynxExam?: unknown; laryngoscopyImageUrl?: string;
    diagnosis?: string; notes?: string; examinedBy: string;
  }) {
    return this.prisma.entExam.create({
      data: {
        patientId: data.patientId,
        encounterId: data.encounterId,
        otoscopyRight: data.otoscopyRight as never,
        otoscopyLeft: data.otoscopyLeft as never,
        audiogramRight: data.audiogramRight as never,
        audiogramLeft: data.audiogramLeft as never,
        ptaRight: data.ptaRight,
        ptaLeft: data.ptaLeft,
        speechRight: data.speechRight,
        speechLeft: data.speechLeft,
        tympanometryRight: data.tympanometryRight,
        tympanometryLeft: data.tympanometryLeft,
        nasalEndoscopy: data.nasalEndoscopy as never,
        nasalEndoscopyImageUrl: data.nasalEndoscopyImageUrl,
        pharynxExam: data.pharynxExam as never,
        laryngoscopyImageUrl: data.laryngoscopyImageUrl,
        diagnosis: data.diagnosis,
        notes: data.notes,
        examinedBy: data.examinedBy,
      },
      include: { patient: { select: { familyName: true, givenName: true, mrn: true } } },
    });
  }

  async getExams(patientId: string) {
    return this.prisma.entExam.findMany({
      where: { patientId },
      include: { examiner: { select: { familyName: true, givenName: true } } },
      orderBy: { examinedAt: 'desc' },
    });
  }

  /* ───── Audiogram ───── */

  async getAudiogram(patientId: string) {
    return this.prisma.entExam.findMany({
      // 🔴 종전 `{ not: undefined }` 는 Prisma 가 "조건 없음"으로 읽어 no-op 이었다 —
      //    청력도가 없는 검사까지 '청력검사' 목록에 섞였다. JsonB 의 SQL NULL 은 Prisma.DbNull.
      //    한쪽 귀만 측정한 검사도 청력검사다 — 우측만 보고 거르면 **좌측만 있는 검사가 사라진다.**
      where: {
        patientId,
        OR: [
          { audiogramRight: { not: Prisma.DbNull } },
          { audiogramLeft: { not: Prisma.DbNull } },
        ],
      },
      select: {
        id: true,
        audiogramRight: true, audiogramLeft: true,
        ptaRight: true, ptaLeft: true,
        speechRight: true, speechLeft: true,
        tympanometryRight: true, tympanometryLeft: true,
        examinedAt: true,
      },
      orderBy: { examinedAt: 'asc' },
    });
  }

  /* ───── Hearing Aid — HearingAid 모델 영속화(무저장 스텁 근절 R1b) ───── */

  async createHearingAid(data: {
    patientId: string; encounterId?: string; ear: string; model?: string;
    type?: string; gain?: unknown; notes?: string;
    prescribedBy: string;
  }) {
    return this.prisma.hearingAid.create({
      data: {
        patientId: data.patientId,
        encounterId: data.encounterId,
        ear: data.ear,
        model: data.model,
        type: data.type,
        gain: data.gain as never,
        notes: data.notes,
        prescribedBy: data.prescribedBy,
      },
      include: { patient: { select: { familyName: true, givenName: true, mrn: true } } },
    });
  }

  async getHearingAids(patientId: string) {
    return this.prisma.hearingAid.findMany({
      where: { patientId },
      orderBy: { prescribedAt: 'desc' },
      take: 50,
      include: { prescriber: { select: { familyName: true, givenName: true } } },
    });
  }

  /* ───── Sleep Study (SleepStudy model) ───── */

  async createSleepStudy(data: {
    patientId: string; studyType: string; studyDate: string;
    ahi: number; oxygenSatMin?: number; oxygenSatAvg?: number;
    sleepEfficiency?: number; totalSleepTime?: number; remPercent?: number;
    supineAhi?: number; diagnosis?: string;
    cpapRecommended?: boolean; cpapPressure?: number;
    interpretedBy: string;
  }) {
    // Auto severity from AHI
    const ahiVal = Number(data.ahi);
    const severity = ahiVal < 5 ? 'NORMAL' : ahiVal < 15 ? 'MILD' : ahiVal < 30 ? 'MODERATE' : 'SEVERE';
    // 🔴 CPAP 권고는 의사의 판단이다 — 종전엔 값이 없으면 AHI ≥ 15 로 시스템이 "권고"를 기록했다(2026-10-07).
    //    판단하지 않은 것은 null(미기록)로 남긴다. 중증도(AHI 구간)는 정의라 자동으로 둔다.
    const cpapRecommended = data.cpapRecommended ?? null;

    return this.prisma.sleepStudy.create({
      data: {
        patientId: data.patientId,
        studyType: data.studyType,
        studyDate: new Date(data.studyDate),
        ahi: data.ahi,
        oxygenSatMin: data.oxygenSatMin,
        oxygenSatAvg: data.oxygenSatAvg,
        sleepEfficiency: data.sleepEfficiency,
        totalSleepTime: data.totalSleepTime,
        remPercent: data.remPercent,
        supineAhi: data.supineAhi,
        severity,
        diagnosis: data.diagnosis,
        cpapRecommended,
        cpapPressure: data.cpapPressure,
        interpretedBy: data.interpretedBy,
      },
      include: { patient: { select: { familyName: true, givenName: true, mrn: true } } },
    });
  }

  async getSleepStudies(patientId: string) {
    return this.prisma.sleepStudy.findMany({
      where: { patientId },
      include: { interpreter: { select: { familyName: true, givenName: true } } },
      orderBy: { studyDate: 'desc' },
    });
  }

  /* ───── Today / Stats ───── */

  async getToday() {
    // 🔴 라벨은 '오늘 예약'인데 검사·시술 기록을 반환하고 있었다(환자명·시간 칸이 전부 '-' 였던 원인).
    //    정본 = Appointment. 종전 목록은 각 과의 exams/records EP 로 계속 볼 수 있다.
    return specialtyTodayList(this.prisma, 'ent');
  }

  async getStats() {
    const [totalExams, recentExams] = await Promise.all([
      this.prisma.entExam.count(),
      this.prisma.entExam.count({ where: { examinedAt: { gte: new Date(Date.now() - 30 * 86400000) } } }),
    ]);
    // 🔴 화면 상단 4카드(completed/inProgress/waiting)의 키가 이 응답에 없어 개통 이래 항상 0 이었다.
    //    정본 = specialtyTodayStats(Appointment). import 만 해두고 부르지 않았다.
    return { totalExams, recentExams, ...(await specialtyTodayStats(this.prisma, 'ent')) };
  }
}
