import { Injectable, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { specialtyTodayList, specialtyTodayStats, specialtyRecordPatients } from '../../common/specialty-board';
import { isDentalLabStatus, nextDentalLabStatus } from '@hospital-run/shared';

@Injectable()
export class DentalService {
  constructor(private readonly prisma: PrismaService) {}

  /* ───── Patients (내 환자 목록) ───── */

  /** 기록이 있는 환자 — 최근 기록 순 상한 + 전체 수·잘림(정본 specialtyRecordPatients · 2026-10-10) */
  async getPatients() {
    return specialtyRecordPatients(this.prisma, (a) => this.prisma.dentalChart.groupBy(a as never), 'chartedAt');
  }

  /* ───── Chart ───── */

  async getChart(patientId: string) {
    return this.prisma.dentalChart.findMany({
      where: { patientId },
      include: { chartedByUser: { select: { familyName: true, givenName: true } } },
      orderBy: { chartedAt: 'desc' },
    });
  }

  async createChart(data: {
    patientId: string; encounterId?: string;
    teethStatus: unknown; perioStatus?: unknown;
    occlusion?: string; oralHygiene?: string; notes?: string;
    chartedBy: string;
  }) {
    return this.prisma.dentalChart.create({
      data: {
        patientId: data.patientId,
        encounterId: data.encounterId,
        teethStatus: data.teethStatus as never,
        perioStatus: data.perioStatus as never,
        occlusion: data.occlusion,
        oralHygiene: data.oralHygiene,
        notes: data.notes,
        chartedBy: data.chartedBy,
      },
      include: { patient: { select: { familyName: true, givenName: true, mrn: true } } },
    });
  }

  /* ───── Plans ───── */

  async createPlan(data: {
    patientId: string; tooth: string; procedure: string; category: string;
    priority?: number; estimatedCost?: number; insuranceCovered?: boolean;
    sessions?: number; notes?: string; plannedBy: string;
  }) {
    return this.prisma.dentalTreatmentPlan.create({
      data: {
        patientId: data.patientId,
        tooth: data.tooth,
        procedure: data.procedure,
        category: data.category,
        priority: data.priority,
        estimatedCost: data.estimatedCost,
        insuranceCovered: data.insuranceCovered,
        sessions: data.sessions,
        notes: data.notes,
        plannedBy: data.plannedBy,
      },
      include: { patient: { select: { familyName: true, givenName: true, mrn: true } } },
    });
  }

  async getPlans(patientId: string) {
    return this.prisma.dentalTreatmentPlan.findMany({
      where: { patientId },
      include: {
        plannedByUser: { select: { familyName: true, givenName: true } },
        _count: { select: { records: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async updatePlanStatus(id: string, status: string) {
    const plan = await this.prisma.dentalTreatmentPlan.findUnique({ where: { id } });
    if (!plan) throw new NotFoundException('치료 계획을 찾을 수 없습니다');
    return this.prisma.dentalTreatmentPlan.update({ where: { id }, data: { status } });
  }

  /* ───── Records ───── */

  /** 국소마취제 최대용량(mg) — 상한은 에피네프린 병용 기준(무병용 초과분만 확실 차단·오탐 방지). perKg는 체중 확보 시 병행 검증 */
  private static readonly ANESTHETIC_MAX: Record<string, { absMaxMg: number; perKgMg: number }> = {
    LIDOCAINE: { absMaxMg: 500, perKgMg: 7 },
    ARTICAINE: { absMaxMg: 500, perKgMg: 7 },
    MEPIVACAINE: { absMaxMg: 400, perKgMg: 6.6 },
    BUPIVACAINE: { absMaxMg: 175, perKgMg: 2.5 },
    PRILOCAINE: { absMaxMg: 600, perKgMg: 8 },
  };

  /** 국소마취 최대용량 게이트 — 구조화 입력(agent+doseMg) 시에만 검증(레거시 자유문자열은 통과) */
  private async assertAnestheticDose(patientId: string, agent?: string, doseMg?: number) {
    if (!agent || agent === 'NONE' || doseMg == null) return;
    const limit = DentalService.ANESTHETIC_MAX[agent];
    if (!limit) return;
    if (doseMg > limit.absMaxMg) {
      throw new BadRequestException({
        code: 'DENTAL_ANESTHETIC_OVERDOSE',
        message: `국소마취제 최대용량 초과: ${agent} ${doseMg}mg > 절대상한 ${limit.absMaxMg}mg`,
      });
    }
    const vitals = await this.prisma.preVisitVitals.findFirst({
      where: { patientId, weight: { not: null } },
      orderBy: { measuredAt: 'desc' },
      select: { weight: true },
    });
    if (vitals?.weight) {
      const weightMax = Math.round(Number(vitals.weight) * limit.perKgMg * 10) / 10;
      if (doseMg > weightMax) {
        throw new BadRequestException({
          code: 'DENTAL_ANESTHETIC_OVERDOSE',
          message: `국소마취제 체중기준 최대용량 초과: ${agent} ${doseMg}mg > ${weightMax}mg (체중 ${vitals.weight}kg × ${limit.perKgMg}mg/kg)`,
        });
      }
    }
  }

  async createRecord(data: {
    planId?: string; patientId: string; encounterId?: string;
    tooth: string; procedure: string; surfaces?: unknown;
    material?: string; anesthesia?: string;
    anesthesiaAgent?: string; anesthesiaDoseMg?: number;
    canalLength?: unknown;
    shade?: string; labOrder?: string; xrayTaken?: boolean;
    findings?: string; nextVisit?: string; treatedBy: string;
  }) {
    await this.assertAnestheticDose(data.patientId, data.anesthesiaAgent, data.anesthesiaDoseMg);
    return this.prisma.dentalTreatmentRecord.create({
      data: {
        planId: data.planId,
        patientId: data.patientId,
        encounterId: data.encounterId,
        tooth: data.tooth,
        procedure: data.procedure,
        surfaces: data.surfaces as never,
        material: data.material,
        anesthesia: data.anesthesia,
        anesthesiaAgent: data.anesthesiaAgent === 'NONE' ? null : data.anesthesiaAgent,
        anesthesiaDoseMg: data.anesthesiaDoseMg,
        canalLength: data.canalLength as never,
        shade: data.shade,
        labOrder: data.labOrder,
        xrayTaken: data.xrayTaken,
        findings: data.findings,
        nextVisit: data.nextVisit,
        treatedBy: data.treatedBy,
      },
    });
  }

  async getRecords(patientId: string) {
    return this.prisma.dentalTreatmentRecord.findMany({
      where: { patientId },
      include: {
        plan: { select: { procedure: true, category: true } },
        treatedByUser: { select: { familyName: true, givenName: true } },
      },
      orderBy: { treatedAt: 'desc' },
    });
  }

  /* ───── Lab Orders (DentalLabOrder model) ───── */

  async createLabOrder(data: {
    patientId: string; planId?: string; tooth: string;
    orderType: string; material: string; shade?: string;
    labName?: string; impression?: string; dueDate?: string;
    cost?: number; orderedBy: string;
  }) {
    return this.prisma.dentalLabOrder.create({
      data: {
        patientId: data.patientId,
        planId: data.planId,
        tooth: data.tooth,
        orderType: data.orderType,
        material: data.material,
        shade: data.shade,
        labName: data.labName,
        impression: data.impression,
        dueDate: data.dueDate ? new Date(data.dueDate) : undefined,
        cost: data.cost,
        orderedBy: data.orderedBy,
      },
      include: { patient: { select: { familyName: true, givenName: true, mrn: true } } },
    });
  }

  async getDentalLabOrders(patientId?: string) {
    return this.prisma.dentalLabOrder.findMany({
      where: patientId ? { patientId } : undefined,
      include: {
        patient: { select: { familyName: true, givenName: true, mrn: true } },
        orderer: { select: { familyName: true, givenName: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  async updateLabOrderStatus(id: string, status: string) {
    // 🔴 종전엔 아무 문자열이나 받아 의뢰 → 장착완료로 건너뛰거나 되돌릴 수 있었다(2026-10-07) — 정본 흐름 한 단계씩만
    if (!isDentalLabStatus(status)) throw new BadRequestException({ code: 'DENTAL_LAB_STATUS_UNKNOWN', message: '알 수 없는 기공 상태입니다.', details: { status } });
    const order = await this.prisma.dentalLabOrder.findUnique({ where: { id } });
    if (!order) throw new NotFoundException('기공의뢰를 찾을 수 없습니다');
    const expected = nextDentalLabStatus(order.status);
    if (expected !== status) {
      throw new ConflictException({
        code: 'DENTAL_LAB_STATUS_SEQUENCE',
        message: expected ? '기공 상태는 다음 단계로만 넘어갈 수 있습니다.' : '더 넘어갈 단계가 없습니다.',
        details: { current: order.status, expected, requested: status },
      });
    }
    const now = new Date();
    const extra: Record<string, Date> = {};
    if (status === 'SENT') extra.sentAt = now;
    if (status === 'RECEIVED') extra.receivedAt = now;
    // 동시 클릭 — 읽은 상태 그대로일 때만 넘긴다
    const moved = await this.prisma.dentalLabOrder.updateMany({ where: { id, status: order.status }, data: { status, ...extra } });
    if (moved.count === 0) throw new ConflictException('다른 사용자가 먼저 상태를 바꿨습니다 — 새로고침 후 다시 시도하세요');
    return this.prisma.dentalLabOrder.findUnique({
      where: { id },
      include: { patient: { select: { familyName: true, givenName: true, mrn: true } } },
    });
  }

  /* ───── Today / Lab (legacy) / Stats / Perio ───── */

  async getToday() {
    // 🔴 라벨은 '오늘 예약'인데 검사·시술 기록을 반환하고 있었다(환자명·시간 칸이 전부 '-' 였던 원인).
    //    정본 = Appointment. 종전 목록은 각 과의 exams/records EP 로 계속 볼 수 있다.
    return specialtyTodayList(this.prisma, 'dental');
  }

  async getLabOrders() {
    return this.prisma.dentalTreatmentRecord.findMany({
      where: { labOrder: { not: null } },
      orderBy: { treatedAt: 'desc' },
      take: 50,
    });
  }

  async getStats() {
    const [totalPlans, activePlans, completedRecords, categoryCounts] = await Promise.all([
      this.prisma.dentalTreatmentPlan.count(),
      this.prisma.dentalTreatmentPlan.count({ where: { status: 'IN_PROGRESS' } }),
      this.prisma.dentalTreatmentRecord.count(),
      this.prisma.dentalTreatmentPlan.groupBy({ by: ['category'], _count: true }),
    ]);
    // 🔴 화면 상단 4카드(completed/inProgress/waiting)의 키가 이 응답에 없어 개통 이래 항상 0 이었다.
    //    정본 = specialtyTodayStats(Appointment). import 만 해두고 부르지 않았다.
    return { totalPlans, activePlans, completedRecords, categoryCounts, ...(await specialtyTodayStats(this.prisma, 'dental')) };
  }

  async getPerio(patientId: string) {
    return this.prisma.dentalChart.findMany({
      // 🔴 종전 `{ not: undefined }` 는 Prisma 가 "조건 없음"으로 읽어 no-op 이었다(ENT audiogram 과 동형).
      where: { patientId, perioStatus: { not: Prisma.DbNull } },
      select: { id: true, perioStatus: true, chartedAt: true, chartedByUser: { select: { familyName: true, givenName: true } } },
      orderBy: { chartedAt: 'desc' },
    });
  }

  async createPerio(data: {
    patientId: string; encounterId?: string; perioStatus: unknown;
    notes?: string; chartedBy: string;
  }) {
    return this.prisma.dentalChart.create({
      data: {
        patientId: data.patientId,
        encounterId: data.encounterId,
        teethStatus: [] as never,
        perioStatus: data.perioStatus as never,
        notes: data.notes,
        chartedBy: data.chartedBy,
      },
    });
  }

  /* ───── Recalls (Phase 2) ───── */

  async createRecall(data: {
    patientId: string; tooth?: string;
    recallType: '6MONTH' | '1YEAR' | 'CUSTOM';
    scheduledDate: string; notes?: string; createdBy: string;
  }) {
    return this.prisma.dentalRecall.create({
      data: {
        patientId: data.patientId,
        tooth: data.tooth,
        recallType: data.recallType,
        scheduledDate: new Date(data.scheduledDate),
        notes: data.notes,
        createdBy: data.createdBy,
      },
      include: { patient: { select: { familyName: true, givenName: true, mrn: true } } },
    });
  }

  async getRecalls(patientId?: string) {
    return this.prisma.dentalRecall.findMany({
      where: {
        ...(patientId ? { patientId } : {}),
        status: { in: ['SCHEDULED', 'OVERDUE'] },
      },
      include: {
        patient: { select: { familyName: true, givenName: true, mrn: true } },
        creator: { select: { familyName: true, givenName: true } },
      },
      orderBy: { scheduledDate: 'asc' },
      take: 100,
    });
  }

  async completeRecall(id: string) {
    const recall = await this.prisma.dentalRecall.findUnique({ where: { id } });
    if (!recall) throw new NotFoundException('리콜 스케줄을 찾을 수 없습니다');
    return this.prisma.dentalRecall.update({
      where: { id },
      data: { status: 'COMPLETED', completedAt: new Date() },
      include: { patient: { select: { familyName: true, givenName: true, mrn: true } } },
    });
  }
}
