import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { specialtyTodayList, specialtyTodayStats, specialtyRecordPatients } from '../../common/specialty-board';

@Injectable()
export class OphthalmologyService {
  constructor(private readonly prisma: PrismaService) {}

  /* ───── Patients (내 환자 목록) ───── */

  /** 기록이 있는 환자 — 최근 기록 순 상한 + 전체 수·잘림(정본 specialtyRecordPatients · 2026-10-10) */
  async getPatients() {
    return specialtyRecordPatients(this.prisma, (a) => this.prisma.eyeExam.groupBy(a as never), 'examinedAt');
  }

  /* ───── Exam ───── */

  async createExam(data: {
    patientId: string; encounterId?: string;
    vaOdUncorrected?: string; vaOsUncorrected?: string;
    vaOdCorrected?: string; vaOsCorrected?: string;
    refractionOd?: unknown; refractionOs?: unknown;
    iopOd?: number; iopOs?: number; iopMethod?: string;
    pupilOd?: string; pupilOs?: string; rapd?: boolean;
    slitLampOd?: unknown; slitLampOs?: unknown;
    fundusOd?: unknown; fundusOs?: unknown; fundusImageUrl?: string;
    octOd?: unknown; octOs?: unknown; octImageUrl?: string;
    vfOd?: unknown; vfOs?: unknown; vfImageUrl?: string;
    diagnosis?: string; plan?: string; notes?: string;
    examinedBy: string;
  }) {
    return this.prisma.eyeExam.create({
      data: {
        patientId: data.patientId,
        encounterId: data.encounterId,
        vaOdUncorrected: data.vaOdUncorrected,
        vaOsUncorrected: data.vaOsUncorrected,
        vaOdCorrected: data.vaOdCorrected,
        vaOsCorrected: data.vaOsCorrected,
        refractionOd: data.refractionOd as never,
        refractionOs: data.refractionOs as never,
        iopOd: data.iopOd,
        iopOs: data.iopOs,
        iopMethod: data.iopMethod,
        pupilOd: data.pupilOd,
        pupilOs: data.pupilOs,
        rapd: data.rapd,
        slitLampOd: data.slitLampOd as never,
        slitLampOs: data.slitLampOs as never,
        fundusOd: data.fundusOd as never,
        fundusOs: data.fundusOs as never,
        fundusImageUrl: data.fundusImageUrl,
        octOd: data.octOd as never,
        octOs: data.octOs as never,
        octImageUrl: data.octImageUrl,
        vfOd: data.vfOd as never,
        vfOs: data.vfOs as never,
        vfImageUrl: data.vfImageUrl,
        diagnosis: data.diagnosis,
        plan: data.plan,
        notes: data.notes,
        examinedBy: data.examinedBy,
      },
      include: { patient: { select: { familyName: true, givenName: true, mrn: true } } },
    });
  }

  async getExams(patientId: string) {
    return this.prisma.eyeExam.findMany({
      where: { patientId },
      include: { examiner: { select: { familyName: true, givenName: true } } },
      orderBy: { examinedAt: 'desc' },
    });
  }

  async getExamDetail(id: string) {
    const exam = await this.prisma.eyeExam.findUnique({
      where: { id },
      include: {
        patient: { select: { familyName: true, givenName: true, mrn: true } },
        examiner: { select: { familyName: true, givenName: true } },
      },
    });
    if (!exam) throw new NotFoundException('검사 기록을 찾을 수 없습니다');
    return exam;
  }

  /* ───── Surgery ───── */

  async createSurgery(data: {
    patientId: string; surgeryId?: string; eye: string; procedure: string;
    iolModel?: string; iolPower?: string; laserParams?: unknown;
    preOpVa?: string; postOpVa?: string; complications?: string;
    operatedBy: string;
  }) {
    return this.prisma.eyeSurgery.create({
      data: {
        patientId: data.patientId,
        surgeryId: data.surgeryId,
        eye: data.eye,
        procedure: data.procedure,
        iolModel: data.iolModel,
        iolPower: data.iolPower,
        laserParams: data.laserParams as never,
        preOpVa: data.preOpVa,
        postOpVa: data.postOpVa,
        complications: data.complications,
        operatedBy: data.operatedBy,
      },
      include: { patient: { select: { familyName: true, givenName: true, mrn: true } } },
    });
  }

  async getSurgeries(patientId: string) {
    return this.prisma.eyeSurgery.findMany({
      where: { patientId },
      include: { operator: { select: { familyName: true, givenName: true } } },
      orderBy: { operatedAt: 'desc' },
    });
  }

  /* ───── Prescription (EyePrescription model) ───── */

  // 무저장 스텁 제거(P3 2차) — EyePrescription 영속화. 종전 return 객체만 반환해 처방이 침묵 소실되던 결함.
  async prescribeGlasses(data: {
    patientId: string; refractionOd: unknown; refractionOs: unknown;
    pdOd?: number; pdOs?: number; notes?: string; prescribedBy: string;
  }) {
    const od = (data.refractionOd ?? {}) as { sphere?: number; cylinder?: number; axis?: number; add?: number };
    const os = (data.refractionOs ?? {}) as { sphere?: number; cylinder?: number; axis?: number; add?: number };
    return this.prisma.eyePrescription.create({
      data: {
        patientId: data.patientId, prescriptionType: 'GLASSES',
        odSphere: od.sphere, odCylinder: od.cylinder, odAxis: od.axis, odAdd: od.add,
        osSphere: os.sphere, osCylinder: os.cylinder, osAxis: os.axis, osAdd: os.add,
        pd: data.pdOd, prescribedBy: data.prescribedBy,
      },
      include: { patient: { select: { familyName: true, givenName: true, mrn: true } } },
    });
  }

  async prescribeContacts(data: {
    patientId: string; refractionOd: unknown; refractionOs: unknown;
    baseCurve?: string; diameter?: string; brand?: string; notes?: string; prescribedBy: string;
  }) {
    const od = (data.refractionOd ?? {}) as { sphere?: number; cylinder?: number; axis?: number; add?: number };
    const os = (data.refractionOs ?? {}) as { sphere?: number; cylinder?: number; axis?: number; add?: number };
    return this.prisma.eyePrescription.create({
      data: {
        patientId: data.patientId, prescriptionType: 'CONTACTS',
        odSphere: od.sphere, odCylinder: od.cylinder, odAxis: od.axis,
        osSphere: os.sphere, osCylinder: os.cylinder, osAxis: os.axis,
        baseCurve: data.baseCurve != null ? Number(data.baseCurve) : undefined,
        diameter: data.diameter != null ? Number(data.diameter) : undefined,
        brand: data.brand, prescribedBy: data.prescribedBy,
      },
      include: { patient: { select: { familyName: true, givenName: true, mrn: true } } },
    });
  }

  async createPrescription(data: {
    patientId: string; prescriptionType: string;
    odSphere?: number; odCylinder?: number; odAxis?: number; odAdd?: number;
    osSphere?: number; osCylinder?: number; osAxis?: number; osAdd?: number;
    pd?: number; baseCurve?: number; diameter?: number; brand?: string;
    prescribedBy: string;
  }) {
    return this.prisma.eyePrescription.create({
      data: {
        patientId: data.patientId,
        prescriptionType: data.prescriptionType,
        odSphere: data.odSphere,
        odCylinder: data.odCylinder,
        odAxis: data.odAxis,
        odAdd: data.odAdd,
        osSphere: data.osSphere,
        osCylinder: data.osCylinder,
        osAxis: data.osAxis,
        osAdd: data.osAdd,
        pd: data.pd,
        baseCurve: data.baseCurve,
        diameter: data.diameter,
        brand: data.brand,
        prescribedBy: data.prescribedBy,
      },
      include: { patient: { select: { familyName: true, givenName: true, mrn: true } } },
    });
  }

  async getPrescriptions(patientId: string) {
    return this.prisma.eyePrescription.findMany({
      where: { patientId },
      include: { prescriber: { select: { familyName: true, givenName: true } } },
      orderBy: { prescribedAt: 'desc' },
    });
  }

  /* ───── IOP Trend / Today / Stats ───── */

  async getIopTrend(patientId: string) {
    return this.prisma.eyeExam.findMany({
      where: { patientId, iopOd: { not: null } },
      select: { id: true, iopOd: true, iopOs: true, iopMethod: true, examinedAt: true },
      orderBy: { examinedAt: 'asc' },
    });
  }

  async getToday() {
    // 🔴 라벨은 '오늘 예약'인데 검사·시술 기록을 반환하고 있었다(환자명·시간 칸이 전부 '-' 였던 원인).
    //    정본 = Appointment. 종전 목록은 각 과의 exams/records EP 로 계속 볼 수 있다.
    return specialtyTodayList(this.prisma, 'ophthalmology');
  }

  async getStats() {
    const [totalExams, totalSurgeries, recentExams] = await Promise.all([
      this.prisma.eyeExam.count(),
      this.prisma.eyeSurgery.count(),
      this.prisma.eyeExam.count({ where: { examinedAt: { gte: new Date(Date.now() - 30 * 86400000) } } }),
    ]);
    // 🔴 화면 상단 4카드는 completed/inProgress/waiting 을 읽는데 종전 이 응답에는 그 키가 없어
    //    **개통 이래 항상 0** 이었다(표본 부재가 아니라 재본 적 없는 값을 0이라 단정 — P1).
    //    정본은 specialtyTodayStats(Appointment) 하나다. import 만 해두고 부르지 않았다.
    return { totalExams, totalSurgeries, recentExams, ...(await specialtyTodayStats(this.prisma, 'ophthalmology')) };
  }

  /* ───── Fundus Photo Viewer (Phase 2) ───── */

  async uploadFundusPhoto(examId: string, data: {
    eye: 'OD' | 'OS'; photoUrl: string; description?: string;
  }) {
    const exam = await this.prisma.eyeExam.findUnique({ where: { id: examId } });
    if (!exam) throw new NotFoundException('검사 기록을 찾을 수 없습니다');

    // Store fundus photo info in the exam's fundus JSON field for the given eye
    const fundusField = data.eye === 'OD' ? 'fundusOd' : 'fundusOs';
    const existingFundus = (exam[fundusField] as Record<string, unknown>) ?? {};
    const updatedFundus = {
      ...existingFundus,
      photoUrl: data.photoUrl,
      description: data.description,
      uploadedAt: new Date().toISOString(),
    };

    return this.prisma.eyeExam.update({
      where: { id: examId },
      data: {
        [fundusField]: updatedFundus as never,
        ...(data.eye === 'OD' ? { fundusImageUrl: data.photoUrl } : {}),
      },
      include: { patient: { select: { familyName: true, givenName: true, mrn: true } } },
    });
  }

  async getFundusPhotos(patientId: string) {
    const exams = await this.prisma.eyeExam.findMany({
      where: {
        patientId,
        OR: [
          { fundusOd: { not: null as never } },
          { fundusOs: { not: null as never } },
          { fundusImageUrl: { not: null } },
        ],
      },
      select: {
        id: true,
        fundusOd: true,
        fundusOs: true,
        fundusImageUrl: true,
        examinedAt: true,
        examiner: { select: { familyName: true, givenName: true } },
      },
      orderBy: { examinedAt: 'desc' },
    });
    return exams;
  }

  async compareFundusPhotos(photoId1: string, photoId2: string) {
    const [exam1, exam2] = await Promise.all([
      this.prisma.eyeExam.findUnique({
        where: { id: photoId1 },
        select: {
          id: true, fundusOd: true, fundusOs: true, fundusImageUrl: true,
          examinedAt: true, diagnosis: true,
          patient: { select: { familyName: true, givenName: true, mrn: true } },
        },
      }),
      this.prisma.eyeExam.findUnique({
        where: { id: photoId2 },
        select: {
          id: true, fundusOd: true, fundusOs: true, fundusImageUrl: true,
          examinedAt: true, diagnosis: true,
          patient: { select: { familyName: true, givenName: true, mrn: true } },
        },
      }),
    ]);
    if (!exam1 || !exam2) throw new NotFoundException('검사 기록을 찾을 수 없습니다');
    return { left: exam1, right: exam2 };
  }
}
