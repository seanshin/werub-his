import { BadRequestException, Injectable, Optional } from '@nestjs/common';
import { SurgeryStatus } from '@prisma/client';
import { intraopVitalsOf, quantileOf, surgeryFlowOf, joinPatientName } from '@hospital-run/shared';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { ConfigRuntimeService } from '../config/config-runtime.service';
import { PacuService } from '../pacu/pacu.service';
import { dayRange, localDateKey } from '../../common/day-range';

/** 병원 표준시(KST) 오프셋 — OrSchedule 은 `@db.Date`(UTC 자정 표현) + 'HH:MM'(병원 벽시계)로 저장된다 */
const KST_MS = 9 * 3_600_000;
const MIN = 60_000;
/** 활력 추이선에 싣는 최근 점 수 — 넘으면 잘렸다고 말한다 */
export const LIVE_VITALS_POINTS = 40;
/** 첫 수술 정시 시작 허용 지연(분) — 원내 정책 · 기본 없음(미설정이면 정시율을 내지 않고 지연 분포만) */
export const ON_TIME_TOLERANCE_KEY = 'surgery.qi.firstCaseOnTimeToleranceMin';

const minutesOf = (hhmm: string): number | null => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm ?? '');
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};
/** OrSchedule 의 date(UTC 자정 = KST 날짜) + 'HH:MM'(KST) → 실제 시각 · 형식을 모르면 null(지어내지 않는다) */
export function orSlotAt(date: Date, hhmm: string): Date | null {
  const m = minutesOf(hhmm);
  return m == null ? null : new Date(date.getTime() + m * MIN - KST_MS);
}
const kstDay = (t: Date) => new Date(Date.UTC(new Date(t.getTime() + KST_MS).getUTCFullYear(), new Date(t.getTime() + KST_MS).getUTCMonth(), new Date(t.getTime() + KST_MS).getUTCDate()));
const diffMin = (a: Date | null | undefined, b: Date | null | undefined) => (a && b ? Math.round((b.getTime() - a.getTime()) / MIN) : null);
const stats = (xs: number[]) => ({ n: xs.length, median: quantileOf(xs, 0.5), p90: quantileOf(xs, 0.9) });

/**
 * 수술실 실시간 모니터·질 지표(2026-10-05 · `/surgery`).
 *
 * 🔴 판정 근거는 **수술 원장 시각**(`surgeries.started_at·ended_at`)이다. 수술 시작/종료 버튼은 수술방 예약
 *    (`or_schedules`)의 실제 시각·상태를 갱신하지 않는다(운영 실측: 예약 상태가 IN_PROGRESS 로 남은 행) —
 *    예약 상태로 방을 '사용 중'이라 하면 끝난 방을 쓰고 있다고 말한다.
 * 🔴 단계는 기록된 시각에서만 · 활력은 마취 기록 원장에서만 · 없는 것은 "기록 없음"으로 말한다.
 * 🔴 수술 안전(IPSG.4) 이행률은 여기서 다시 세지 않는다 — 정본 `qi/surgery-safety`(화면이 그 EP 를 부른다).
 */
@Injectable()
export class SurgeryMonitorService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly config?: ConfigRuntimeService,
    @Optional() private readonly pacu?: PacuService,
  ) {}

  /** 오늘(또는 지정 날짜·KST) 수술실 실시간 보드 */
  async getLiveBoard(date?: string, now: Date = new Date()) {
    if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new BadRequestException('날짜는 YYYY-MM-DD 형식이어야 합니다.');
    const day = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? new Date(`${date}T00:00:00Z`) : kstDay(now);
    const dayStart = new Date(day.getTime() - KST_MS);
    const dayEnd = new Date(dayStart.getTime() + 86_400_000);

    const [rooms, schedules, daySurgeries, inProgress] = await Promise.all([
      this.prisma.operatingRoom.findMany({ where: { isActive: true }, select: { id: true, name: true, floor: true, roomType: true }, orderBy: { name: 'asc' } }),
      this.prisma.orSchedule.findMany({ where: { date: day } }),
      this.prisma.surgery.findMany({ where: { scheduledAt: { gte: dayStart, lt: dayEnd } }, select: { id: true } }),
      // 진행 중으로 남은 건은 날짜와 무관하게 — 종료 기록이 빠졌을 수 있다(경과로 말한다)
      this.prisma.surgery.findMany({ where: { status: SurgeryStatus.IN_PROGRESS }, select: { id: true } }),
    ]);
    const ids = [...new Set([...schedules.map((s) => s.surgeryId), ...daySurgeries.map((s) => s.id), ...inProgress.map((s) => s.id)])];
    const cases = ids.length ? await this.loadCases(ids, now) : [];
    const caseById = new Map(cases.map((c) => [c.id, c]));
    const slotBySurgery = new Map(schedules.map((s) => [s.surgeryId, s]));

    const roomViews = rooms.map((room) => {
      const roomCases = schedules
        .filter((s) => s.roomId === room.id)
        .map((s) => ({ slot: s, c: caseById.get(s.surgeryId) ?? null }))
        .sort((a, b) => (minutesOf(a.slot.startTime) ?? 9e9) - (minutesOf(b.slot.startTime) ?? 9e9))
        .map(({ slot, c }) => ({
          ...(c ?? { id: slot.surgeryId, missing: true }),
          slot: {
            startTime: slot.startTime, endTime: slot.endTime, estimatedDuration: slot.estimatedDuration,
            plannedStart: orSlotAt(day, slot.startTime), plannedEnd: orSlotAt(day, slot.endTime),
          },
        }));
      const current = roomCases.find((c) => 'status' in c && c.status === 'IN_PROGRESS') ?? null;
      const next = roomCases.find((c) => 'status' in c && c.status === 'SCHEDULED') ?? null;
      return {
        id: room.id, name: room.name, floor: room.floor, roomType: room.roomType,
        // 방 상태 = 수술 원장 상태에서(예약 상태 아님)
        state: current ? 'IN_USE' as const : next ? 'WAITING' as const : 'IDLE' as const,
        currentCaseId: current?.id ?? null,
        nextCaseId: next?.id ?? null,
        cases: roomCases,
      };
    });

    // 방이 없는 오늘 수술 · 진행 중으로 남은 다른 날 수술
    const unassigned = cases.filter((c) => !slotBySurgery.has(c.id));
    return {
      date: localDateKey(new Date(day.getTime() + 12 * 3_600_000)),
      now,
      rooms: roomViews,
      unassigned,
      summary: {
        rooms: roomViews.length,
        inUse: roomViews.filter((r) => r.state === 'IN_USE').length,
        inProgress: cases.filter((c) => c.status === 'IN_PROGRESS').length,
        scheduled: cases.filter((c) => c.status === 'SCHEDULED').length,
        completed: cases.filter((c) => c.status === 'COMPLETED').length,
        overrun: cases.filter((c) => c.overrunMin != null && c.overrunMin > 0).length,
        // 진행 중 기록인데 시작이 어제 이전 — 종료 기록 누락 의심(판정 아님 · 경과만)
        staleInProgress: cases.filter((c) => c.status === 'IN_PROGRESS' && c.startedAt && c.startedAt < dayStart).length,
      },
    };
  }

  /** 수술 한 건의 모니터 카드 — 단계 시각·경과·예상 대비·활력·안전·마취 전 평가 */
  private async loadCases(ids: string[], now: Date) {
    const [surgeries, checklists, anes, pre, pacu, slots, notes, ledgerVitals] = await Promise.all([
      this.prisma.surgery.findMany({
        where: { id: { in: ids } },
        select: {
          id: true, status: true, procedureName: true, bodySite: true, laterality: true, scheduledAt: true, startedAt: true, endedAt: true,
          incisionTime: true, closureTime: true, ebl: true, anesthesiaType: true, admissionId: true,
          patient: { select: { id: true, familyName: true, givenName: true, koreanName: true, mrn: true } },
          surgeon: { select: { familyName: true, givenName: true } },
        },
      }),
      this.prisma.surgicalChecklist.findMany({
        where: { surgeryId: { in: ids } },
        select: { surgeryId: true, signInCompletedAt: true, timeOutCompletedAt: true, signOutCompletedAt: true, countStatus: true, countDiscrepancyNote: true },
      }),
      this.prisma.anesthesiaRecord.findMany({
        where: { surgeryId: { in: ids } },
        select: { surgeryId: true, inductionTime: true, intubationTime: true, extubationTime: true, vitalSigns: true, ebl: true, urineOutput: true, asaClass: true, anesthesiaType: true },
      }),
      this.prisma.preAnesthesiaEvaluation.findMany({ where: { surgeryId: { in: ids } }, select: { surgeryId: true, asaClass: true, status: true, completedAt: true, npoConfirmed: true } }),
      this.prisma.pacuRecord.findMany({ where: { surgeryId: { in: ids } }, select: { surgeryId: true, arrivalTime: true, dischargeTime: true, aldretScore: true }, orderBy: { arrivalTime: 'desc' } }),
      this.prisma.orSchedule.findMany({ where: { surgeryId: { in: ids } }, select: { surgeryId: true, estimatedDuration: true } }),
      // 구조화 수술 기록(수술 기록 화면이 쓰는 정본) — 절개·봉합 시각·실혈량이 여기 있을 수 있다
      this.prisma.surgeryOpNote.findMany({ where: { surgeryId: { in: ids } }, select: { surgeryId: true, incisionTime: true, closureTime: true, estimatedBloodLoss: true } }),
      // 수술 중 기록 원장(수술방 차트 · 2026-10-05)의 활력 — 무효 처리된 줄은 빼고
      this.prisma.intraopEvent.findMany({ where: { surgeryId: { in: ids }, kind: 'VITALS', voidedAt: null }, select: { surgeryId: true, occurredAt: true, payload: true } }),
    ]);
    const ledgerBy = new Map<string, { time: string; [k: string]: unknown }[]>();
    for (const v of ledgerVitals) {
      ledgerBy.set(v.surgeryId, [...(ledgerBy.get(v.surgeryId) ?? []), { ...(v.payload as Record<string, unknown>), time: v.occurredAt.toISOString() }]);
    }
    const by = <T extends { surgeryId: string }>(xs: T[]) => { const m = new Map<string, T>(); for (const x of xs) if (!m.has(x.surgeryId)) m.set(x.surgeryId, x); return m; };
    const clBy = by(checklists); const anBy = by(anes); const preBy = by(pre); const pacuBy = by(pacu); const estBy = by(slots); const noteBy = by(notes);

    return surgeries.map((s) => {
      const cl = clBy.get(s.id); const an = anBy.get(s.id); const pr = preBy.get(s.id); const pc = pacuBy.get(s.id); const nt = noteBy.get(s.id);
      // 🔴 같은 사실이 두 원장에 있다(수술 원장 칸 · 구조화 수술 기록) — 수술 원장 값이 없으면 구조화 기록 값을 쓴다
      const incisionAt = s.incisionTime ?? nt?.incisionTime ?? null;
      const closureAt = s.closureTime ?? nt?.closureTime ?? null;
      // 흐름은 shared 정본 하나(수술방 차트와 같은 규칙) — 지금 단계 = 시각이 기록된 마지막 단계(단계 순서 기준)
      const { phases, lastPhase } = surgeryFlowOf({
        SIGN_IN: cl?.signInCompletedAt, INDUCTION: an?.inductionTime, TIME_OUT: cl?.timeOutCompletedAt, START: s.startedAt,
        INCISION: incisionAt, CLOSURE: closureAt, SIGN_OUT: cl?.signOutCompletedAt, END: s.endedAt,
        PACU_IN: pc?.arrivalTime, PACU_OUT: pc?.dischargeTime,
      });
      const est = estBy.get(s.id)?.estimatedDuration ?? null;
      const runMin = s.status === 'IN_PROGRESS' ? diffMin(s.startedAt, now) : s.status === 'COMPLETED' ? diffMin(s.startedAt, s.endedAt) : null;
      // 활력 = 옛 마취 기록 JSON + 수술 중 기록 원장 — 둘 다 없으면 null(모름), 원장만 있으면 원장
      const legacy = intraopVitalsOf(an?.vitalSigns);
      const ledger = ledgerBy.has(s.id) ? intraopVitalsOf(ledgerBy.get(s.id)) : null;
      const vitalsAll = legacy || ledger ? [...(legacy ?? []), ...(ledger ?? [])].sort((a, b) => a.at.localeCompare(b.at)) : null;
      const vitals = vitalsAll ? vitalsAll.slice(-LIVE_VITALS_POINTS) : null;
      return {
        id: s.id, status: s.status, procedureName: s.procedureName, bodySite: s.bodySite, laterality: s.laterality,
        scheduledAt: s.scheduledAt, startedAt: s.startedAt, endedAt: s.endedAt,
        patient: s.patient ? { id: s.patient.id, name: joinPatientName(s.patient.familyName, s.patient.givenName), koreanName: s.patient.koreanName ?? null, mrn: s.patient.mrn } : null,
        surgeon: s.surgeon ? `${s.surgeon.familyName}${s.surgeon.givenName}` : null,
        anesthesiaType: an?.anesthesiaType ?? s.anesthesiaType ?? null,
        phases, lastPhase,
        runMin, estimatedMin: est,
        // 예상 대비 초과 — 예상이 없으면 판정하지 않는다(null)
        overrunMin: runMin != null && est != null ? runMin - est : null,
        safety: {
          checklistPresent: !!cl,
          signIn: !!cl?.signInCompletedAt, timeOut: !!cl?.timeOutCompletedAt, signOut: !!cl?.signOutCompletedAt,
          countStatus: cl?.countStatus ?? null,
          countUnresolved: cl?.countStatus === 'MISMATCH' && !cl.countDiscrepancyNote?.trim(),
          lateralitySet: s.laterality != null,
        },
        preAnesthesia: pr ? { asaClass: pr.asaClass, status: pr.status, completedAt: pr.completedAt, npoConfirmed: pr.npoConfirmed } : null,
        asaClass: pr?.asaClass ?? an?.asaClass ?? null,
        anesthesia: an ? {
          inductionAt: an.inductionTime, intubationAt: an.intubationTime, extubationAt: an.extubationTime,
          ebl: an.ebl, urineOutput: an.urineOutput,
          // 활력 — 배열이 아니면 null(모름) · 잘랐으면 전체 수와 함께
          vitals, vitalsTotal: vitalsAll ? vitalsAll.length : null, vitalsTruncated: !!vitalsAll && vitalsAll.length > LIVE_VITALS_POINTS,
          lastVitalAt: vitalsAll && vitalsAll.length ? vitalsAll[vitalsAll.length - 1].at : null,
        } : ledger ? {
          // 마취 기록 행은 없지만 수술방 차트에 활력이 적혔다 — 활력만 싣는다
          inductionAt: null, intubationAt: null, extubationAt: null, ebl: null, urineOutput: null,
          vitals, vitalsTotal: vitalsAll ? vitalsAll.length : null, vitalsTruncated: !!vitalsAll && vitalsAll.length > LIVE_VITALS_POINTS,
          lastVitalAt: vitalsAll && vitalsAll.length ? vitalsAll[vitalsAll.length - 1].at : null,
        } : null,
        ebl: s.ebl ?? nt?.estimatedBloodLoss ?? null,
        pacu: pc ? { arrivalAt: pc.arrivalTime, dischargeAt: pc.dischargeTime, aldrete: pc.aldretScore } : null,
      };
    });
  }

  /**
   * 수술실 운영·기록 질 지표(기간 · 기본 이번 달) — 측정값만 · 분자/분모 · 표본 0 = null.
   * 기준(정시 허용 지연)은 원내 정책 config · 미설정이면 정시율을 내지 않고 지연 분포만 낸다.
   */
  async getQuality(from?: string, to?: string, now: Date = new Date()) {
    // 날짜 형식 오류는 500 이 아니라 400(자기 입력 문제인 줄 알게)
    for (const v of [from, to]) if (v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new BadRequestException('날짜는 YYYY-MM-DD 형식이어야 합니다.');
    const defFrom = localDateKey(new Date(now.getFullYear(), now.getMonth(), 1));
    const defTo = localDateKey(now);
    const r = dayRange(from || defFrom, to || defTo)!;
    const range = { gte: r.gte!, lt: r.lt! };
    const period = { from: from || defFrom, to: to || defTo };

    const [surgeries, schedules, toleranceRaw] = await Promise.all([
      this.prisma.surgery.findMany({
        where: { scheduledAt: range },
        select: {
          id: true, status: true, scheduledAt: true, startedAt: true, endedAt: true, incisionTime: true, closureTime: true,
          opNote: true, ebl: true, complications: true,
        },
      }),
      this.prisma.orSchedule.findMany({ where: { date: { gte: kstDay(range.gte), lt: kstDay(new Date(range.lt.getTime())) } }, select: { roomId: true, surgeryId: true, date: true, startTime: true, estimatedDuration: true } }),
      this.config?.get(ON_TIME_TOLERANCE_KEY) ?? null,
    ]);
    // 🔴 비어 있으면 미설정 — `Number(null)` 은 0 이라 그대로 두면 미설정이 '허용 지연 0분'이 된다
    const tolerance = (() => {
      if (toleranceRaw == null || (typeof toleranceRaw === 'string' && !toleranceRaw.trim())) return null;
      const n = Number(toleranceRaw);
      return Number.isInteger(n) && n >= 0 && n <= 120 ? n : null;
    })();
    const sById = new Map(surgeries.map((s) => [s.id, s]));
    const ids = surgeries.map((s) => s.id);
    const performed = surgeries.filter((s) => s.status === SurgeryStatus.IN_PROGRESS || s.status === SurgeryStatus.COMPLETED);
    const completed = surgeries.filter((s) => s.status === SurgeryStatus.COMPLETED);
    const pastScheduled = surgeries.filter((s) => s.scheduledAt < now);
    const cancelled = pastScheduled.filter((s) => s.status === SurgeryStatus.CANCELLED);

    // ① 첫 수술 정시 시작 — 방·날짜마다 예약상 가장 이른 건 · 시작 기록 없는 건은 분모 밖(따로 센다)
    const firstBy = new Map<string, (typeof schedules)[number]>();
    for (const sc of schedules) {
      const k = `${sc.roomId}|${sc.date.toISOString()}`;
      const cur = firstBy.get(k);
      if (!cur || (minutesOf(sc.startTime) ?? 9e9) < (minutesOf(cur.startTime) ?? 9e9)) firstBy.set(k, sc);
    }
    const firstDelays: number[] = []; let firstNoStart = 0; let firstCancelled = 0;
    for (const sc of firstBy.values()) {
      const s = sById.get(sc.surgeryId);
      if (!s) continue;
      if (s.status === SurgeryStatus.CANCELLED) { firstCancelled += 1; continue; }
      const planned = orSlotAt(sc.date, sc.startTime);
      const d = diffMin(planned, s.startedAt);
      if (d == null) { firstNoStart += 1; continue; }
      firstDelays.push(d);
    }

    // ② 수술방 회전 시간 — 같은 방·같은 날 이어진 두 건: 앞 건 종료 → 다음 건 시작(음수·24시간 이상은 기록 이상으로 제외)
    const byRoomDay = new Map<string, { start: Date; end: Date | null }[]>();
    for (const sc of schedules) {
      const s = sById.get(sc.surgeryId);
      if (!s?.startedAt) continue;
      const k = `${sc.roomId}|${sc.date.toISOString()}`;
      byRoomDay.set(k, [...(byRoomDay.get(k) ?? []), { start: s.startedAt, end: s.endedAt }]);
    }
    const turnovers: number[] = []; let turnoverExcluded = 0;
    for (const list of byRoomDay.values()) {
      list.sort((a, b) => a.start.getTime() - b.start.getTime());
      for (let i = 1; i < list.length; i++) {
        const g = diffMin(list[i - 1].end, list[i].start);
        if (g == null || g < 0 || g >= 24 * 60) { turnoverExcluded += 1; continue; }
        turnovers.push(g);
      }
    }

    // ③ 예상 대비 실제 소요 — 예상(수술방 배정)과 실제(시작~종료)가 둘 다 있는 완료 건
    const durDiffs: number[] = [];
    for (const sc of schedules) {
      const s = sById.get(sc.surgeryId);
      const act = s?.status === SurgeryStatus.COMPLETED ? diffMin(s.startedAt, s.endedAt) : null;
      if (act != null && act >= 0 && sc.estimatedDuration > 0) durDiffs.push(act - sc.estimatedDuration);
    }

    // ④ 기록 완결(완료 수술) — 수술기록·절개/봉합 시각·실혈량·마취 기록·수술 중 활력·마취 전 평가 완료
    const pacuSel = { arrivalTime: true, dischargeTime: true, dischargeOverride: true, complications: true } as const;
    const [anes, pre, pacu, notes, ledgerVit] = ids.length ? await Promise.all([
      this.prisma.anesthesiaRecord.findMany({ where: { surgeryId: { in: ids } }, select: { surgeryId: true, vitalSigns: true } }),
      this.prisma.preAnesthesiaEvaluation.findMany({ where: { surgeryId: { in: ids } }, select: { surgeryId: true, status: true } }),
      this.prisma.pacuRecord.findMany({ where: { arrivalTime: range }, select: pacuSel }),
      // 구조화 수술 기록 — 수술 기록 화면(OpNotePanel)이 쓰는 정본 · 수술 원장 opNote 칸은 옛 칸
      this.prisma.surgeryOpNote.findMany({
        where: { surgeryId: { in: ids } },
        select: { surgeryId: true, narrative: true, incisionTime: true, closureTime: true, estimatedBloodLoss: true, complications: true, complicationGrade: true, prophylacticAbx: true, vteProphylaxis: true },
      }),
      this.prisma.intraopEvent.groupBy({ by: ['surgeryId'], where: { surgeryId: { in: ids }, kind: 'VITALS', voidedAt: null }, _count: { _all: true } }),
    ]) : [[], [], await this.prisma.pacuRecord.findMany({ where: { arrivalTime: range }, select: pacuSel }), [], []];
    const ledgerVitalsIds = new Set(ledgerVit.map((g) => g.surgeryId));
    const anBy = new Map(anes.map((a) => [a.surgeryId, a]));
    const preBy = new Map(pre.map((p) => [p.surgeryId, p]));
    const noteBy = new Map(notes.map((n) => [n.surgeryId, n]));
    const cnt = (pred: (s: (typeof completed)[number]) => boolean) => ({ numerator: completed.filter(pred).length, denominator: completed.length });
    // 🔴 같은 사실이 두 원장에 있다 — 어느 쪽에든 기록돼 있으면 기록된 것(옛 칸만 보면 '수술 기록 0'이 된다)
    const documentation = {
      opNote: cnt((s) => !!s.opNote?.trim() || !!noteBy.get(s.id)?.narrative?.trim()),
      incisionClosure: cnt((s) => !!(s.incisionTime ?? noteBy.get(s.id)?.incisionTime) && !!(s.closureTime ?? noteBy.get(s.id)?.closureTime)),
      ebl: cnt((s) => s.ebl != null || noteBy.get(s.id)?.estimatedBloodLoss != null),
      // 예방적 항생제·VTE 예방 — 구조화 수술 기록에 '적혀 있는가'(투여 시각·적정성 판정 아님)
      prophylacticAbx: cnt((s) => !!noteBy.get(s.id)?.prophylacticAbx?.trim()),
      vteProphylaxis: cnt((s) => noteBy.get(s.id)?.vteProphylaxis != null),
      anesthesiaRecord: cnt((s) => anBy.has(s.id)),
      intraopVitals: cnt((s) => (intraopVitalsOf(anBy.get(s.id)?.vitalSigns)?.length ?? 0) > 0 || ledgerVitalsIds.has(s.id)),
      preAnesthesiaCompleted: cnt((s) => preBy.get(s.id)?.status === 'COMPLETED'),
    };

    // ⑤ 회복실 — 체류 시간(퇴실한 건) · 지연 기준은 PACU 설정 정본(출처 함께) · 기준 미달 강제 퇴실 수
    // getMonitoringSettings 는 조회 실패를 스스로 UNAVAILABLE 로 말한다 — 여기서 실패를 null 로 접지 않는다
    const settings = this.pacu ? await this.pacu.getMonitoringSettings() : null;
    const stays = pacu.map((p) => diffMin(p.arrivalTime, p.dischargeTime)).filter((v): v is number => v != null && v >= 0);
    const prolongedMin = settings?.prolongedStayMin ?? null;

    return {
      period,
      generatedAt: now,
      volume: {
        scheduled: surgeries.length, performed: performed.length, completed: completed.length,
        // 🔴 취소 시점 기록이 없다 — 당일 취소 여부는 구분할 수 없다(분모는 이미 지난 예약)
        cancelled: { numerator: cancelled.length, denominator: pastScheduled.length },
      },
      firstCaseStart: {
        ...stats(firstDelays),
        onTime: tolerance == null ? null : { numerator: firstDelays.filter((d) => d <= tolerance).length, denominator: firstDelays.length },
        toleranceMin: tolerance,
        roomDays: firstBy.size, noStartRecord: firstNoStart, cancelledFirst: firstCancelled,
      },
      turnover: { ...stats(turnovers), excluded: turnoverExcluded },
      durationVsEstimate: {
        ...stats(durDiffs),
        over: durDiffs.filter((d) => d > 0).length, under: durDiffs.filter((d) => d < 0).length,
      },
      documentation,
      complications: {
        // 기록 기반 — 기록되지 않은 합병증은 세지 못한다(0 이 '없었다'는 뜻이 아니다)
        surgeryRecorded: { numerator: completed.filter((s) => !!s.complications?.trim() || !!noteBy.get(s.id)?.complications?.trim() || !!noteBy.get(s.id)?.complicationGrade?.trim()).length, denominator: completed.length },
        // Clavien-Dindo 등급 분포 — 등급이 적힌 것만(어휘 밖 값은 원문 그대로 센다)
        gradeCounts: (() => {
          const m: Record<string, number> = {};
          for (const s of completed) { const g = noteBy.get(s.id)?.complicationGrade?.trim(); if (g) m[g] = (m[g] ?? 0) + 1; }
          return m;
        })(),
        pacuRecorded: { numerator: pacu.filter((p) => Array.isArray(p.complications) && p.complications.length > 0).length, denominator: pacu.length },
      },
      pacu: {
        ...stats(stays),
        prolonged: prolongedMin == null ? null : { numerator: stays.filter((m) => m > prolongedMin).length, denominator: stays.length },
        prolongedMin, prolongedSource: settings?.source ?? 'UNAVAILABLE',
        overrideDischarge: { numerator: pacu.filter((p) => !!p.dischargeOverride?.trim()).length, denominator: pacu.filter((p) => p.dischargeTime).length },
        stillIn: pacu.filter((p) => !p.dischargeTime).length,
      },
    };
  }
}
