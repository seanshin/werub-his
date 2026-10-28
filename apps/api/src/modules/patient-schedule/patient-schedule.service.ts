import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

export interface ScheduleQuery {
  from?: Date;
  to?: Date;
  sources?: string[]; // APPOINTMENT | SURGERY | MEDICATION | PRE_ORDER | PATHWAY
}

export interface ScheduleItem {
  at: Date;
  source: string;
  refType: string | null;
  refId: string | null;
  title: string;
  status: string | null;
  navUrl: string | null;
  detail?: Record<string, unknown>;
}

const nm = (u?: { familyName?: string | null; givenName?: string | null } | null) =>
  `${u?.familyName ?? ''}${u?.givenName ?? ''}`.trim();

const PRE_ORDER_TYPE_LABEL: Record<string, string> = {
  MEDICATION: '약처방', LAB: '검사', IMAGING: '영상', THERAPY: '치료', DIET: '식이', ACTIVITY: '활동', NURSING: '간호',
};

/** 환자 포털에 노출 가능한 계획 항목 유형 — 내부 운영 항목(간호·투약주기·사정) 비노출 (기획 §3.3 P3) */
export const PATIENT_VISIBLE_ITEM_TYPES = new Set(['VISIT', 'LAB', 'IMAGING', 'PROCEDURE', 'EDUCATION']);

/**
 * 환자 통합 일정 — 분산된 도메인(예약·수술·투약 MAR·사전처방·임상경로)을 read-only 병합.
 * 계획/실행의 SoT는 각 도메인이 유지하고 여기서는 조회만 한다 (journey-console 패턴).
 */
@Injectable()
export class PatientScheduleService {
  constructor(private readonly prisma: PrismaService) {}

  async getSchedule(patientId: string, q: ScheduleQuery) {
    const now = new Date();
    const from = q.from ?? new Date(now.getTime() - 7 * 86400_000);
    const to = q.to ?? new Date(now.getTime() + 60 * 86400_000);
    const want = (s: string) => !q.sources?.length || q.sources.includes(s);
    const items: ScheduleItem[] = [];

    if (want('APPOINTMENT')) {
      const appts = await this.prisma.appointment.findMany({
        where: { patientId, scheduledAt: { gte: from, lte: to } },
        include: { doctor: { select: { familyName: true, givenName: true, department: true } } },
        orderBy: { scheduledAt: 'asc' },
        take: 200,
      });
      for (const a of appts) {
        items.push({
          at: a.scheduledAt,
          source: 'APPOINTMENT',
          refType: 'Appointment',
          refId: a.id,
          title: `외래 예약 — ${nm(a.doctor)}${a.doctor?.department ? ` (${a.doctor.department})` : ''}`,
          status: a.status,
          navUrl: null,
          detail: { type: a.type, duration: a.duration },
        });
      }
    }

    if (want('SURGERY')) {
      const surgeries = await this.prisma.surgery.findMany({
        where: { patientId, scheduledAt: { gte: from, lte: to } },
        select: { id: true, scheduledAt: true, procedureName: true, status: true },
        orderBy: { scheduledAt: 'asc' },
        take: 50,
      });
      for (const s of surgeries) {
        items.push({
          at: s.scheduledAt,
          source: 'SURGERY',
          refType: 'Surgery',
          refId: s.id,
          title: `수술 — ${s.procedureName}`,
          status: s.status,
          navUrl: null,
        });
      }
    }

    if (want('MEDICATION')) {
      // MAR은 건수가 많아 일 단위로 집계 — 상세는 MAR 화면이 SoT
      const mars = await this.prisma.medicationAdministration.findMany({
        where: { patientId, scheduledAt: { gte: from, lte: to } },
        select: { scheduledAt: true, status: true },
        take: 2000,
      });
      const byDate = new Map<string, { total: number; done: number; scheduled: number }>();
      for (const m of mars) {
        const key = m.scheduledAt.toISOString().slice(0, 10);
        const agg = byDate.get(key) ?? { total: 0, done: 0, scheduled: 0 };
        agg.total += 1;
        if (m.status === 'ADMINISTERED') agg.done += 1;
        if (m.status === 'SCHEDULED') agg.scheduled += 1;
        byDate.set(key, agg);
      }
      for (const [date, agg] of byDate) {
        items.push({
          at: new Date(`${date}T12:00:00+09:00`),
          source: 'MEDICATION',
          refType: null,
          refId: null,
          title: `투약 ${agg.total}건${agg.done ? ` · 시행 ${agg.done}` : ''}${agg.scheduled ? ` · 예정 ${agg.scheduled}` : ''}`,
          status: agg.scheduled > 0 ? 'SCHEDULED' : 'COMPLETED',
          navUrl: null,
          detail: { date, ...agg },
        });
      }
    }

    if (want('PRE_ORDER')) {
      const preOrders = await this.prisma.preOrder.findMany({
        where: {
          patientId,
          scheduledDate: { not: null, gte: from, lte: to },
          status: { in: ['PENDING', 'MODIFIED', 'APPROVED'] },
        },
        include: {
          medicationCode: { select: { nameKo: true } },
          procedureCode: { select: { nameKo: true } },
        },
        orderBy: { scheduledDate: 'asc' },
        take: 100,
      });
      for (const p of preOrders) {
        const label = PRE_ORDER_TYPE_LABEL[p.type] ?? p.type;
        const name = p.medicationCode?.nameKo ?? p.procedureCode?.nameKo ?? '';
        items.push({
          at: p.scheduledDate!,
          source: 'PRE_ORDER',
          refType: 'PreOrder',
          refId: p.id,
          title: `사전처방(${label})${name ? ` — ${name}` : ''}`,
          status: p.status,
          navUrl: null,
          detail: { scheduledTime: p.scheduledTime, type: p.type },
        });
      }
    }

    if (want('PLAN')) {
      // 치료일정 전개(P2) 계획 항목 — PLANNED(수동 시행 유도)·LINKED(실 객체는 각 소스로도 노출되므로 계획 라벨로 병기)
      const planItems = await this.prisma.patientScheduleItem.findMany({
        where: {
          plannedAt: { gte: from, lte: to },
          status: { in: ['PLANNED', 'LINKED'] },
          schedule: { patientId, status: 'ACTIVE' },
        },
        include: { schedule: { select: { name: true } } },
        orderBy: { plannedAt: 'asc' },
        take: 200,
      });
      for (const p of planItems) {
        items.push({
          at: p.plannedAt,
          source: 'PLAN',
          refType: p.refType ?? 'PatientScheduleItem',
          refId: p.refId ?? p.id,
          title: `[${p.schedule?.name}] ${p.title}`,
          status: p.status,
          navUrl: null,
          detail: { itemType: p.itemType, itemId: p.id }, // itemId — 변경관리(P3) 조작 키
        });
      }
    }

    if (want('PATHWAY')) {
      const assignments = await this.prisma.pathwayAssignment.findMany({
        where: { patientId, status: 'ACTIVE' },
        include: {
          pathway: { select: { name: true, milestones: { select: { id: true, day: true, title: true, category: true }, orderBy: { day: 'asc' } } } },
          outcomes: { select: { milestoneId: true } },
        },
        take: 5,
      });
      for (const asg of assignments) {
        const doneMilestones = new Set(asg.outcomes.map((o) => o.milestoneId));
        for (const m of asg.pathway?.milestones ?? []) {
          const at = new Date(asg.startDate.getTime() + m.day * 86400_000);
          if (at < from || at > to) continue;
          items.push({
            at,
            source: 'PATHWAY',
            refType: 'PathwayMilestone',
            refId: m.id,
            title: `[${asg.pathway?.name}] ${m.title}`,
            status: doneMilestones.has(m.id) ? 'COMPLETED' : 'PLANNED',
            navUrl: null,
            detail: { category: m.category, day: m.day },
          });
        }
      }
    }

    items.sort((a, b) => a.at.getTime() - b.at.getTime());
    const counts: Record<string, number> = {};
    for (const it of items) counts[it.source] = (counts[it.source] ?? 0) + 1;
    return { from, to, items, counts };
  }

  /**
   * 환자 포털용 일정(P3) — 예약·수술·검사 예정만 필터, 내부 항목 비노출(기획 §3.3).
   * - PLAN: 환자 노출 유형(VISIT/LAB/IMAGING/PROCEDURE/EDUCATION)만
   * - PRE_ORDER: 검사·영상만(약처방 상세는 비노출) + PLAN(LINKED)과 동일 건 중복 제거
   * - 내부 조작 키(detail.itemId)·참조 id는 응답에서 제거
   */
  async getPortalSchedule(patientId: string, q: { from?: Date; to?: Date }) {
    const now = new Date();
    const from = q.from ?? new Date(now.getTime() - 86400_000); // 어제부터(당일 자정 경계 보호)
    const to = q.to ?? new Date(now.getTime() + 60 * 86400_000);
    const full = await this.getSchedule(patientId, { from, to, sources: ['APPOINTMENT', 'SURGERY', 'PRE_ORDER', 'PLAN'] });

    const planRefIds = new Set(
      full.items.filter((it) => it.source === 'PLAN' && it.refType === 'PreOrder' && it.refId).map((it) => it.refId),
    );
    const visible = full.items.filter((it) => {
      if (['CANCELLED', 'NO_SHOW'].includes(String(it.status ?? ''))) return false; // 취소·미방문은 환자 화면 비노출
      if (it.source === 'PLAN') return PATIENT_VISIBLE_ITEM_TYPES.has(String(it.detail?.itemType ?? ''));
      if (it.source === 'PRE_ORDER') {
        const isExam = ['LAB', 'IMAGING'].includes(String(it.detail?.type ?? ''));
        return isExam && !planRefIds.has(it.refId); // 치료계획에 이미 표기된 사전처방은 중복 제거
      }
      return true; // APPOINTMENT | SURGERY
    });

    const items = visible.map((it) => ({ at: it.at, source: it.source, title: it.title, status: it.status }));
    const counts: Record<string, number> = {};
    for (const it of items) counts[it.source] = (counts[it.source] ?? 0) + 1;
    return { from: full.from, to: full.to, items, counts };
  }
}
