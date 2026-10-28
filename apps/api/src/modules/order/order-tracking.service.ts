import { BadRequestException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  attentionThresholdsOf, currentAndNextStage, isAbnormalFlag, isCriticalFlag, orderTrackPhaseOf, joinPatientName, ageOf, patientOrderNotes,
  ACTIVE_TRACK_PHASES, ORDER_DEPTS, ORDER_TRACK_PHASES,
  type OrderTrackPhase,
} from '@hospital-run/shared';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { ConfigRuntimeService } from '../config/config-runtime.service';
import { dayRange, localDateKey } from '../../common/day-range';
import { orderStages, medianOf, type LensOrderInput } from '../journey/clinical-lens';
import { OrderService } from './order.service';
import type { CareContextResult } from './care-context';

type TrackRow = Prisma.OrderGetPayload<{ select: typeof TRACK_SELECT }>;

/** 한 응답에 싣는 오더 상한 — 넘으면 잘랐다고 말한다(전체 수와 함께) */
const TRACK_LIMIT = 600;
const ACTIVE_STATUSES = ['ORDERED', 'RECEIVED', 'IN_PROGRESS'] as const;


/** 추적 한 줄에 필요한 필드 — 목록·환자 상세가 같은 모양(상세는 결과·사람·처방 세부를 더한다) */
const TRACK_SELECT = {
    id: true, department: true, status: true, priority: true, createdAt: true, receivedAt: true, startedAt: true,
    completedAt: true, cancelledAt: true, acknowledgedAt: true, specimenCollectedAt: true, specimenCollectionSource: true,
    prescription: {
      select: {
        type: true, priority: true, durChecked: true, durWarnings: true, durOverridden: true,
        medicationCode: { select: { nameKo: true } }, procedureCode: { select: { nameKo: true } },
        encounter: {
          select: {
            patientId: true, admissionId: true, visitType: true,
            admission: { select: { bed: { select: { roomNumber: true, bedNumber: true, ward: { select: { name: true } } } } } },
            patient: { select: { id: true, mrn: true, familyName: true, givenName: true, koreanName: true, dateOfBirth: true, gender: true } },
            doctor: { select: { familyName: true, givenName: true } },
          },
        },
      },
    },
    labResult: { select: { status: true, collectedAt: true, completedAt: true, verifiedAt: true, items: { select: { flag: true } } } },
    imagingResult: { select: { status: true, acquiredAt: true, reportedAt: true } },
    dispensing: { select: { status: true, dispensedAt: true, verifiedAt: true, issuedAt: true } },
  } satisfies Prisma.OrderSelect;

/** 환자 상세(드릴다운) — 추적 한 줄 + 결과·사람·처방 세부 */
const DETAIL_SELECT = {
  ...TRACK_SELECT,
  notes: true,
  receiver: { select: { familyName: true, givenName: true } },
  starter: { select: { familyName: true, givenName: true } },
  completer: { select: { familyName: true, givenName: true } },
  acknowledger: { select: { familyName: true, givenName: true } },
  canceller: { select: { familyName: true, givenName: true } },
  prescription: {
    select: {
      ...TRACK_SELECT.prescription.select,
      id: true, dosage: true, frequency: true, route: true, duration: true, quantity: true, durOverrideReason: true,
    },
  },
  labResult: { select: { status: true, collectedAt: true, completedAt: true, verifiedAt: true, items: { select: { testName: true, value: true, unit: true, flag: true, normalMin: true, normalMax: true } } } },
  imagingResult: { select: { status: true, acquiredAt: true, reportedAt: true, finding: true, impression: true } },
} satisfies Prisma.OrderSelect;
type DetailRow = Prisma.OrderGetPayload<{ select: typeof DETAIL_SELECT }>;
/** 환자 상세 기간 — 최근 7일 발행분 + 끝나지 않은 오더(날짜 무관) */
const DETAIL_DAYS = 7;
const DETAIL_LIMIT = 300;
const personName = (u?: { familyName: string | null; givenName: string | null } | null) => (u ? joinPatientName(u.familyName, u.givenName) || null : null);

const minutes = (a: Date | string | null | undefined, b: Date) => {
  if (!a) return null;
  const t = (a instanceof Date ? a : new Date(a)).getTime();
  return Number.isFinite(t) ? Math.max(0, Math.floor((b.getTime() - t) / 60_000)) : null;
};

/**
 * 오더 실시간 추적(2026-10-06 · `/orders` 실시간 추적·환자별 매트릭스).
 *
 * 모집단 = 고른 날(KST) 발행분 ∪ **아직 끝나지 않은 오더 전부**(날짜 무관 — 어제 낸 STAT 이 오늘 화면에서 사라지면 안 된다).
 * 🔴 단계는 도메인 원장의 단계 시각(`orderStages` — 의료진 관점 여정과 같은 정본) · 시각이 없으면 그 단계는 비어 있다(채우지 않는다).
 * 🔴 결과 미확인은 결과 확인함과 같은 조건(검사·영상 완료 + 의사 확인 시각 없음) — 단, 지난 날의 완료분은 모집단 밖(결과 확인함이 정본 목록).
 * 🔴 "지연"은 원내 정책 — `orders.tracking.attentionMin` 이 없으면 경과만 내고 주의 판정을 하지 않는다.
 */
@Injectable()
export class OrderTrackingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: OrderService,
    @Optional() private readonly config?: ConfigRuntimeService,
  ) {}

  /** 추적 한 줄 — 목록·환자 상세가 같은 규칙(국면·단계·경과·주의·DUR) */
  static toItem(o: TrackRow & CareContextResult, now: Date, rangeStart: Date, thresholds: Record<string, number> | null) {
    const stages = orderStages(o as unknown as LensOrderInput);
    const phase = orderTrackPhaseOf({ department: o.department, status: o.status, stages });
    const { current, next } = currentAndNextStage(stages);
    const active = (ACTIVE_TRACK_PHASES as readonly string[]).includes(phase);
    const priority = o.priority ?? o.prescription?.priority ?? 'ROUTINE';
    const sinceOrderedMin = minutes(o.createdAt, now);
    const doneAt = phase === 'DONE' ? (stages.filter((s) => s.at).at(-1)?.at ?? null) : null;
    const flags = (o.labResult?.items ?? []).map((i) => i.flag);
    const p = o.prescription?.encounter?.patient;
    const limit = thresholds?.[priority] ?? null;
    return {
      id: o.id,
      department: o.department,
      name: o.prescription?.procedureCode?.nameKo ?? o.prescription?.medicationCode?.nameKo ?? null,
      priority,
      status: o.status,
      phase,
      careContext: o.careContext,
      // 성+이름은 정본(joinPatientName — 외국 이름 띄어쓰기) · 외국인은 한국식 호칭을 함께
      patient: p ? { id: p.id, name: joinPatientName(p.familyName, p.givenName), koreanName: p.koreanName ?? null, mrn: p.mrn, age: ageOf(p.dateOfBirth), gender: p.gender ?? null } : null,
      location: o.prescription?.encounter?.admission?.bed
        ? { ward: o.prescription.encounter.admission.bed.ward?.name ?? null, room: o.prescription.encounter.admission.bed.roomNumber, bed: o.prescription.encounter.admission.bed.bedNumber }
        : null,
      doctor: o.prescription?.encounter?.doctor ? `${o.prescription.encounter.doctor.familyName ?? ''}${o.prescription.encounter.doctor.givenName ?? ''}` : null,
      createdAt: o.createdAt.toISOString(),
      stages,
      current, next,
      // 지금 단계에 머문 시간 — 활성일 때만(끝난 오더에 '경과'를 붙이지 않는다)
      inStageMin: active && current?.at ? minutes(current.at, now) : null,
      // 발행 → 지금(활성) 또는 발행 → 마지막 단계(완료)
      sinceOrderedMin: active ? sinceOrderedMin : null,
      totalMin: doneAt ? minutes(o.createdAt, new Date(doneAt)) : null,
      critical: flags.some((f) => isCriticalFlag(f)),
      abnormal: flags.some((f) => isAbnormalFlag(f)),
      // 주의 = 기준이 있을 때만 · 대기·진행(결과 미확인은 의사 확인 몫이라 같은 기준으로 재지 않는다)
      attention: limit != null && (phase === 'WAITING' || phase === 'IN_PROCESS') && sinceOrderedMin != null ? sinceOrderedMin >= limit : null,
      carriedOver: o.createdAt < rangeStart,
      // DUR — 약제 오더만 · 경고가 있었는지·무시(사유 기록)했는지(위원회 기준 점검 재료 · 경고 없으면 null)
      dur: o.department === 'PHARMACY' && o.prescription?.durChecked
        ? { warned: Array.isArray(o.prescription.durWarnings) && o.prescription.durWarnings.length > 0, overridden: !!o.prescription.durOverridden }
        : null,
    };
  }

  async getTracking(date?: string, department?: string, now: Date = new Date()) {
    if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new BadRequestException('date 는 YYYY-MM-DD 형식이어야 합니다.');
    if (department && !(ORDER_DEPTS as readonly string[]).includes(department)) throw new BadRequestException('알 수 없는 부서입니다.');
    const day = date ?? localDateKey(now);
    const range = dayRange(day, day)!;

    const where: Prisma.OrderWhereInput = {
      ...(department ? { department: department as Prisma.OrderWhereInput['department'] } : {}),
      OR: [
        { createdAt: { gte: range.gte, lt: range.lt } },
        { status: { in: [...ACTIVE_STATUSES] } },
      ],
    };
    const [total, rows, rawThresholds] = await Promise.all([
      this.prisma.order.count({ where }),
      this.prisma.order.findMany({
        where,
        // 오래된 것부터 — 잘리면 가장 최근 발행분이 빠진다(truncated·total 로 말한다)
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: TRACK_LIMIT,
        select: TRACK_SELECT,
      }),
      this.config ? this.config.get('orders.tracking.attentionMin') : Promise.resolve(null),
    ]);
    const thresholds = attentionThresholdsOf(rawThresholds);
    const withCtx = await this.orders.withCareContext(rows);

    const items = withCtx.map((o) => OrderTrackingService.toItem(o, now, range.gte!, thresholds));

    // 부서 × 국면 요약
    const lanes = ORDER_DEPTS.map((dept) => {
      const xs = items.filter((i) => i.department === dept);
      const byPhase = Object.fromEntries(ORDER_TRACK_PHASES.map((ph) => [ph, xs.filter((i) => i.phase === ph).length])) as Record<OrderTrackPhase, number>;
      const waiting = xs.filter((i) => i.phase === 'WAITING');
      return {
        department: dept,
        total: xs.length,
        byPhase,
        stat: xs.filter((i) => i.priority === 'STAT' && (ACTIVE_TRACK_PHASES as readonly string[]).includes(i.phase)).length,
        oldestWaitingMin: waiting.length ? Math.max(...waiting.map((i) => i.sinceOrderedMin ?? 0)) : null,
        // 발행 → 완료(결과) 중앙값 — 고른 날 끝난 것만 · 표본 수 함께(0 이면 null)
        turnaroundMin: medianOf(xs.filter((i) => i.phase === 'DONE' || i.phase === 'RESULT_UNACK').map((i) => {
          const res = i.stages.find((s) => ['RESULTED', 'REPORTED', 'ISSUED', 'COMPLETED'].includes(s.key) && s.at);
          return res?.at ? minutes(i.createdAt, new Date(res.at)) : null;
        })),
      };
    });

    // 환자 × 부서 매트릭스 — 활성이 있는 환자 먼저(긴급·위급·가장 오래된 대기 순)
    const byPatient = new Map<string, typeof items>();
    for (const i of items) if (i.patient) byPatient.set(i.patient.id, [...(byPatient.get(i.patient.id) ?? []), i]);
    const matrix = [...byPatient.values()].map((xs) => {
      const cells = Object.fromEntries(ORDER_DEPTS.map((dept) => {
        const ds = xs.filter((i) => i.department === dept);
        return [dept, ds.length ? {
          total: ds.length,
          byPhase: Object.fromEntries(ORDER_TRACK_PHASES.map((ph) => [ph, ds.filter((i) => i.phase === ph).length])),
          stat: ds.filter((i) => i.priority === 'STAT').length,
          critical: ds.filter((i) => i.critical).length,
          attention: ds.filter((i) => i.attention === true).length,
          oldestActiveMin: ds.some((i) => i.sinceOrderedMin != null) ? Math.max(...ds.map((i) => i.sinceOrderedMin ?? 0)) : null,
          orderIds: ds.map((i) => i.id),
        } : null];
      }));
      const active = xs.filter((i) => (ACTIVE_TRACK_PHASES as readonly string[]).includes(i.phase));
      // 담당 진료의 — 이 환자 오더의 진료의(여럿이면 모두 · 지어내지 않는다)
      const doctors = [...new Set(xs.map((i) => i.doctor).filter((d): d is string => !!d))];
      return {
        patient: xs[0].patient!,
        careContext: xs[0].careContext,
        location: xs.find((i) => i.location)?.location ?? null,
        doctors,
        // 확인 사항 — 기록에서 규칙으로 센 사실(shared patientOrderNotes · 임상 판단 아님)
        notes: patientOrderNotes(xs),
        total: xs.length,
        active: active.length,
        stat: active.filter((i) => i.priority === 'STAT').length,
        critical: xs.filter((i) => i.critical).length,
        oldestActiveMin: active.length ? Math.max(...active.map((i) => i.sinceOrderedMin ?? 0)) : null,
        cells,
      };
    }).sort((a, b) => (b.stat - a.stat) || (b.critical - a.critical) || ((b.oldestActiveMin ?? -1) - (a.oldestActiveMin ?? -1)) || (b.active - a.active));

    const count = (ph: OrderTrackPhase) => items.filter((i) => i.phase === ph).length;
    return {
      date: day,
      now: now.toISOString(),
      population: 'DAY_ISSUED_PLUS_ACTIVE' as const,
      truncated: total > items.length,
      total,
      attention: { configured: thresholds != null, thresholds },
      summary: {
        active: items.filter((i) => (ACTIVE_TRACK_PHASES as readonly string[]).includes(i.phase)).length,
        waiting: count('WAITING'), inProcess: count('IN_PROCESS'), resultUnack: count('RESULT_UNACK'),
        done: count('DONE'), cancelled: count('CANCELLED'),
        statActive: items.filter((i) => i.priority === 'STAT' && (ACTIVE_TRACK_PHASES as readonly string[]).includes(i.phase)).length,
        critical: items.filter((i) => i.critical).length,
        attention: thresholds ? items.filter((i) => i.attention === true).length : null,
        carriedOver: items.filter((i) => i.carriedOver).length,
      },
      lanes,
      orders: items,
      matrix,
    };
  }

  /**
   * 환자 한 명의 오더 드릴다운 — 최근 7일 발행분 ∪ 끝나지 않은 오더 · 결과(검사 수치·플래그·참고 범위 / 영상 판독 / 조제 단계)·사람·처방 세부.
   * 🔴 결과는 원장 값 그대로(재반올림·재판정 없음) — 플래그는 보고된 값 · 참고 범위가 없으면 null.
   * 🔴 DUR 경고는 저장된 문구 그대로 · 무시 사유가 없으면 null(지어내지 않는다).
   */
  async getPatientDetail(patientId: string, now: Date = new Date()) {
    const since = new Date(now.getTime() - DETAIL_DAYS * 24 * 60 * 60_000);
    const where: Prisma.OrderWhereInput = {
      prescription: { encounter: { patientId } },
      OR: [{ createdAt: { gte: since } }, { status: { in: [...ACTIVE_STATUSES] } }],
    };
    const [total, rows, rawThresholds] = await Promise.all([
      this.prisma.order.count({ where }),
      this.prisma.order.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: DETAIL_LIMIT, select: DETAIL_SELECT }),
      this.config ? this.config.get('orders.tracking.attentionMin') : Promise.resolve(null),
    ]);
    if (!rows.length) {
      const p = await this.prisma.patient.findUnique({ where: { id: patientId }, select: { id: true } });
      if (!p) throw new NotFoundException('환자를 찾을 수 없습니다');
    }
    const thresholds = attentionThresholdsOf(rawThresholds);
    const withCtx = await this.orders.withCareContext(rows);
    const items = withCtx.map((o) => {
      const base = OrderTrackingService.toItem(o, now, since, thresholds);
      const d = o as unknown as DetailRow;
      const rx = d.prescription;
      return {
        ...base,
        // 7일 기간 밖에서 이어진 활성 오더 — 목록과 같은 뜻(기간 시작 이전 발행)
        prescription: rx ? {
          id: rx.id, type: rx.type, dosage: rx.dosage, frequency: rx.frequency, route: rx.route, duration: rx.duration, quantity: rx.quantity,
          durWarnings: Array.isArray(rx.durWarnings) ? (rx.durWarnings as unknown[]).map((w) => (typeof w === 'string' ? w : (w as { message?: string })?.message ?? null)).filter((w): w is string => !!w) : [],
          durOverridden: !!rx.durOverridden, durOverrideReason: rx.durOverrideReason ?? null,
        } : null,
        people: {
          received: personName(d.receiver), started: personName(d.starter), completed: personName(d.completer),
          acknowledged: personName(d.acknowledger), cancelled: personName(d.canceller),
        },
        notes: d.notes ?? null,
        lab: d.labResult ? {
          status: d.labResult.status,
          items: d.labResult.items.map((i) => ({
            name: i.testName, value: i.value, unit: i.unit, flag: i.flag,
            // 참고 범위 — 원장 값 그대로(문자열로 · 재반올림 없음)
            range: i.normalMin != null || i.normalMax != null ? { min: i.normalMin?.toString() ?? null, max: i.normalMax?.toString() ?? null } : null,
          })),
        } : null,
        imaging: d.imagingResult ? { status: d.imagingResult.status, impression: d.imagingResult.impression ?? null, finding: d.imagingResult.finding ? d.imagingResult.finding.slice(0, 1000) : null, reportedAt: d.imagingResult.reportedAt?.toISOString() ?? null } : null,
        dispensing: d.dispensing ? { status: d.dispensing.status } : null,
      };
    });
    const head = items.find((i) => i.patient);
    const p = head?.patient ?? null;
    return {
      now: now.toISOString(),
      period: { from: since.toISOString(), days: DETAIL_DAYS },
      truncated: total > items.length,
      total,
      patient: p,
      location: items.find((i) => i.location)?.location ?? null,
      careContext: head?.careContext ?? null,
      doctors: [...new Set(items.map((i) => i.doctor).filter((x): x is string => !!x))],
      attention: { configured: thresholds != null },
      notes: patientOrderNotes(items),
      byDept: ORDER_DEPTS.map((dept) => {
        const xs = items.filter((i) => i.department === dept);
        return { department: dept, total: xs.length, byPhase: Object.fromEntries(ORDER_TRACK_PHASES.map((ph) => [ph, xs.filter((i) => i.phase === ph).length])) as Record<OrderTrackPhase, number> };
      }),
      orders: items,
    };
  }
}
