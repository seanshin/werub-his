import { billingOutstanding } from '@hospital-run/shared';
import { Injectable, Optional } from '@nestjs/common';
import { JourneyAckService, flagKeyOf } from './journey-ack.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { ConfigRuntimeService } from '../config/config-runtime.service';
// 🔴 집합·상한·목표는 정본 하나에서만 나온다(flow-canon). 여기서 다시 선언하지 말 것 —
//    종전에 관제/분석/경영이 각자 상수를 들고 있어 같은 순간에 다른 수를 말했다(W8 Q9·Q10·Q12).
import {
  ER_ACTIVE,
  FlowTargets,
  KTAS_DOOR_TO_TRIAGE_FALLBACK,
  OPD_ACTIVE,
  OPD_DONE_TODAY,
  OPD_WAITING_STAGES,
  UNPAID_STATUS,
  erPreTriageWhere,
  notFutureCheckIn,
  resolveFlowTargets,
  resolveFlowTargetsWithSource,
} from './flow-canon';

// 환자여정 통합 관제 — 읽기 집계 전용(신규 도메인 모델 0). 기존 WaitingQueue+Admission+Billing 조합.
// 보드는 ERP 무호출(HIS Billing 미수납 잔액). 중간진료비 상세는 드릴다운에서 /billing/erp-invoice 재사용.

type Thresholds = FlowTargets;

function fullName(family?: string, given?: string): string {
  const full = `${family ?? ''}${given ?? ''}`;
  return full || '-';
}
// 환자명 마스킹 — EXECUTIVE(strong)는 홍*동, ADMIN(약)은 실명. 직원명은 마스킹 없음.
function maskName(family?: string, given?: string, strong = true): string {
  const full = fullName(family, given);
  if (!strong || full === '-') return full;
  return full.length <= 1 ? full : full[0] + '*'.repeat(Math.max(1, full.length - 2)) + full[full.length - 1];
}

function minutesSince(d?: Date | null): number {
  if (!d) return 0;
  return Math.max(0, Math.round((Date.now() - new Date(d).getTime()) / 60_000));
}
function daysSince(d?: Date | null): number {
  if (!d) return 0;
  return Math.max(0, Math.floor((Date.now() - new Date(d).getTime()) / 86_400_000));
}

@Injectable()
export class JourneyConsoleService {
  constructor(
    private readonly prisma: PrismaService,
    // 🔴 선택 인자 **앞**에 둔다 — 뒤에 두면 기존 호출부가 `config` 를 여기로 흘려보낸다
    private readonly acks: JourneyAckService,
    @Optional() private readonly config?: ConfigRuntimeService,
  ) {}

  /** 임계 정본 — `flow-canon.resolveFlowTargets` 하나. 보드·KPI·분석이 같은 값을 쓴다. */
  /**
   * 확인 유효 시간 산출용 임계 — 🔴 **보드가 지연을 판정한 것과 같은 값**이어야 한다.
   * 다른 값을 쓰면 확인이 다음 지연까지 덮거나, 확인하자마자 만료된다.
   */
  async thresholdsForAck(): Promise<Record<string, number>> {
    return this.thresholds() as unknown as Promise<Record<string, number>>;
  }

  private async thresholds(): Promise<Thresholds> {
    return resolveFlowTargets(this.config);
  }

  /** 드릴다운 열람 감사(P5) — 누가 어느 환자의 여정·진료비를 열람했는지 기록. */
  auditPatientView(viewerId: string, patientId: string) {
    void this.prisma.auditLog.create({
      data: { userId: viewerId, action: 'READ', resourceType: 'JOURNEY_CONSOLE_PATIENT', resourceId: patientId },
    }).catch(() => undefined);
  }

  /** 흐름 보드 — 외래(WaitingQueue) + 입원(Admission) 단계별. ERP 무호출. strongMask=EXECUTIVE. */
  async getBoard(filters: { track?: string; dept?: string; ward?: string; insuranceType?: string; minStayMin?: number; minUnpaid?: number } = {}, strongMask = true) {
    const track = (filters.track ?? 'ALL').toUpperCase();
    const wantOpd = track === 'ALL' || track === 'OPD';
    const wantIpd = track === 'ALL' || track === 'IPD';
    const wantEr = track === 'ALL' || track === 'ER';
    const TH = await this.thresholds();
    const ktasTarget = TH.doorToTriage;

    const now = new Date();
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    const dischargeCut = new Date(Date.now() - 3 * 86_400_000); // 최근 3일 퇴원(정산대기)
    const [queues, admissions, erVisits] = await Promise.all([
      wantOpd
        ? this.prisma.waitingQueue.findMany({
            where: {
              // 🔴 당일 완료는 COMPLETED 하나가 아니다 — 처방 없이 수납한 건은 VISIT_COMPLETED 다
              OR: [{ status: { in: OPD_ACTIVE } }, { status: { in: OPD_DONE_TODAY }, completedAt: { gte: todayStart } }],
              // 🔴 아직 오지 않은 사람은 '지금 원내에 있는 사람'이 아니다(W8 Q9·전 축 공통 상한).
              //    실측 2026-08-14: 미래 접수 2건이 대기 198명에 섞여 '0분'으로 표시됐다.
              checkedInAt: notFutureCheckIn(now),
              ...(filters.dept ? { departmentName: { contains: filters.dept, mode: 'insensitive' } } : {}),
            },
            include: {
              patient: { select: { id: true, mrn: true, familyName: true, givenName: true, insuranceType: true } },
              doctor: { select: { familyName: true, givenName: true } },
            },
            orderBy: { checkedInAt: 'asc' },
          })
        : Promise.resolve([]),
      wantIpd
        ? this.prisma.admission.findMany({
            where: {
              OR: [{ status: 'ADMITTED' }, { status: 'DISCHARGED', dischargeDate: { gte: dischargeCut } }], // 정산대기(최근 퇴원) 포함
              ...(filters.ward ? { bed: { ward: { name: { contains: filters.ward, mode: 'insensitive' } } } } : {}),
            },
            include: {
              patient: { select: { id: true, mrn: true, familyName: true, givenName: true, insuranceType: true } },
              bed: { select: { roomNumber: true, bedNumber: true, ward: { select: { name: true } } } },
              attendingDoctor: { select: { familyName: true, givenName: true, department: true } },
            },
            orderBy: { admitDate: 'asc' },
          })
        : Promise.resolve([]),
      wantEr
        ? this.prisma.emergencyVisit.findMany({
            where: { OR: [{ status: { in: ER_ACTIVE } }, { status: 'COMPLETED', dispositionAt: { gte: todayStart } }] }, // 종결은 당일분만(카운트용)
            include: { patient: { select: { id: true, mrn: true, familyName: true, givenName: true, insuranceType: true } } },
            orderBy: { arrivalAt: 'asc' },
          })
        : Promise.resolve([]),
    ]);

    // 미수납 일괄 조회(encounterId/patientId) — ERP 무호출, HIS Billing 기준
    const encounterIds = queues.map((q) => q.encounterId).filter((x): x is string => !!x);
    // 환자 단위 미수납 대상 = 입원 + 응급(응급은 encounter 결속이 없어 patientId 로 본다)
    const ipdPatientIds = [...new Set([...admissions.map((a) => a.patientId), ...erVisits.map((v) => v.patientId)])];
    const billings = await this.prisma.billing.findMany({
      where: {
        status: { in: UNPAID_STATUS },
        OR: [
          ...(encounterIds.length ? [{ encounterId: { in: encounterIds } }] : []),
          ...(ipdPatientIds.length ? [{ patientId: { in: ipdPatientIds } }] : []),
        ],
      },
      select: { encounterId: true, patientId: true, patientCopay: true, paidAmount: true },
    });
    const unpaidByEnc = new Map<string, number>();
    const unpaidByPatient = new Map<string, number>();
    for (const b of billings) {
      const due = (b.patientCopay ?? 0) - (b.paidAmount ?? 0);
      if (due <= 0) continue;
      unpaidByEnc.set(b.encounterId, (unpaidByEnc.get(b.encounterId) ?? 0) + due);
      unpaidByPatient.set(b.patientId, (unpaidByPatient.get(b.patientId) ?? 0) + due);
    }

    const opd = queues.map((q) => {
      // 🔴 CALLED(호출됨)가 else 로 흘러 '접수'에 묻혀 있었다 — 호출 칸이 항상 0이고
      //    상황판의 접수 수치가 원무 카드(WAITING 만 셈)와 1 만큼 어긋나 보였다.
      //    호출은 "불렀는데 아직 안 들어옴" = 진료실 앞 병목이라 별도 단계로 세운다.
      const stageSrc =
        q.status === 'COMPLETED' ? { stage: 'DONE', since: q.completedAt }
        : q.status === 'IN_CONSULTATION' ? { stage: 'IN_CONSULT', since: q.startedAt }
        : q.status === 'CASHIER_WAITING' ? { stage: 'CASHIER_WAITING', since: q.completedAt ?? q.startedAt }
        : q.status === 'CALLED' ? { stage: 'CALLED', since: q.calledAt ?? q.checkedInAt }
        : { stage: 'RECEPTION', since: q.checkedInAt };
      const stayMin = minutesSince(stageSrc.since);
      const unpaid = q.encounterId ? unpaidByEnc.get(q.encounterId) ?? 0 : 0;
      const flags: string[] = [];
      // 🔴 접수대기 지연 — 종전엔 이 판정이 **아예 없어서** 접수 칸에 몇 시간이 쌓여도 flag·알림이 0 이었다.
      //    (2026-08-10 실측: 대기 196명·평균 352분인데 감지 0건) 관제가 "정상"이라고 말하던 근인.
      if (stageSrc.stage === 'RECEPTION' && stayMin > TH.opdWaitMin) flags.push('WAIT_DELAY');
      // 호출 후 미입실 — 환자가 자리를 떴거나 안내가 닿지 않은 상태
      if (stageSrc.stage === 'CALLED' && stayMin > TH.callDelayMin) flags.push('CALL_DELAY');
      if (stageSrc.stage === 'CASHIER_WAITING' && stayMin > TH.cashierDelayMin) flags.push('CASHIER_DELAY');
      if (stageSrc.stage === 'IN_CONSULT' && stayMin > TH.consultDelayMin) flags.push('CONSULT_DELAY');
      if (unpaid > TH.highUnpaid) flags.push('HIGH_UNPAID');
      return {
        patientId: q.patientId, name: maskName(q.patient.familyName, q.patient.givenName, strongMask), mrn: q.patient.mrn,
        // 정본 대기열 호출 EP(PATCH /waiting-queue/:id/call) 배선용. 관제 전용 쓰기 경로는 만들지 않는다.
        queueId: q.id,
        track: 'OPD', stage: stageSrc.stage, dept: q.departmentName, room: q.roomName,
        doctorName: fullName(q.doctor?.familyName, q.doctor?.givenName), encounterId: q.encounterId,
        queueNumber: q.queueNumber, stayMin, unpaid, insuranceType: q.patient.insuranceType, flags,
      };
    }).filter((c) => (!filters.minStayMin || c.stayMin >= filters.minStayMin) && (!filters.minUnpaid || c.unpaid >= filters.minUnpaid)
      && (!filters.insuranceType || c.insuranceType === filters.insuranceType));

    const ipd = admissions.map((a) => {
      const stayDays = daysSince(a.admitDate);
      const stage = a.status === 'DISCHARGED' ? 'DISCHARGED'
        : a.dischargeSummary ? 'DISCHARGE_PLANNED'
        : stayDays < 1 ? 'ADMITTED' : 'INWARD';
      const unpaid = unpaidByPatient.get(a.patientId) ?? 0;
      const flags: string[] = [];
      if (a.status !== 'DISCHARGED' && stayDays > TH.defaultAlos * TH.longStayMul) flags.push('LONG_STAY');
      if (unpaid > TH.highUnpaid) flags.push('HIGH_UNPAID');
      if (a.status === 'DISCHARGED' && unpaid > 0) flags.push('SETTLE_PENDING');
      return {
        patientId: a.patientId, name: maskName(a.patient.familyName, a.patient.givenName, strongMask), mrn: a.patient.mrn,
        track: 'IPD', stage, ward: a.bed?.ward?.name ?? null,
        bed: a.bed ? `${a.bed.roomNumber ?? ''}-${a.bed.bedNumber ?? ''}` : null,
        doctorName: fullName(a.attendingDoctor?.familyName, a.attendingDoctor?.givenName), dept: a.attendingDoctor?.department ?? null,
        admitDate: a.admitDate, stayDays, unpaid, insuranceType: a.patient.insuranceType, flags,
      };
    }).filter((c) => (!filters.minUnpaid || c.unpaid >= filters.minUnpaid) && (!filters.insuranceType || c.insuranceType === filters.insuranceType));

    // ── 응급 — 도착→트리아지→처치→퇴실결정. 지연 판정은 **KTAS 등급별 목표**(분석 화면과 같은 키).
    //    🔴 등급 혼합 단일 임계는 위험하다: LEVEL_1 은 1분, LEVEL_5 는 120분이 목표다.
    const er = erVisits.map((v) => {
      const stage = v.status === 'COMPLETED' ? 'ER_DONE'
        : v.dispositionAt || v.status === 'PENDING_DISPOSITION' ? 'ER_DISPOSITION'
        : v.treatmentStartedAt ? 'ER_TREATMENT'
        : v.triagedAt ? 'ER_TRIAGED'
        : 'ER_ARRIVED';
      const since = stage === 'ER_DONE' ? v.dispositionAt
        : stage === 'ER_DISPOSITION' ? (v.dispositionAt ?? v.treatmentStartedAt)
        : stage === 'ER_TREATMENT' ? v.treatmentStartedAt
        : stage === 'ER_TRIAGED' ? v.triagedAt
        : v.arrivalAt;
      const stayMin = minutesSince(since);
      const totalMin = minutesSince(v.arrivalAt);
      const unpaid = unpaidByPatient.get(v.patientId) ?? 0;
      const flags: string[] = [];
      // 도착했는데 아직 트리아지가 안 된 상태만 door-to-triage 목표로 본다(이미 분류된 건은 대상 아님)
      if (stage === 'ER_ARRIVED' && stayMin > (ktasTarget[v.triageLevel] ?? 30)) flags.push('TRIAGE_DELAY');
      if (unpaid > TH.highUnpaid) flags.push('HIGH_UNPAID');
      return {
        patientId: v.patientId, name: maskName(v.patient.familyName, v.patient.givenName, strongMask), mrn: v.patient.mrn,
        track: 'ER', stage, dept: '응급의학과', doctorName: '-', encounterId: null,
        ktas: v.triageLevel, chiefComplaint: v.chiefComplaint, stayMin, totalMin,
        unpaid, insuranceType: v.patient.insuranceType, flags,
      };
    }).filter((c) => (!filters.minStayMin || c.stayMin >= filters.minStayMin) && (!filters.minUnpaid || c.unpaid >= filters.minUnpaid)
      && (!filters.insuranceType || c.insuranceType === filters.insuranceType));

    // ── 지연 확인 기록 붙이기
    //    🔴 확인은 **지연을 숨기지 않는다** — flags 는 그대로 두고 `ack` 만 덧붙는다.
    //    🔴 조회 실패는 "확인 없음"으로 번역하지 않는다(같은 환자에게 두 번 연락하게 된다).
    const delayed = [...opd, ...ipd, ...er].filter((c) => c.flags.length > 0);
    const { map: ackMap, failed: ackFailed } = await this.acks.activeAcks(
      [...new Set(delayed.map((c) => c.patientId))],
    );
    for (const c of delayed) {
      const ack = ackMap.get(`${c.patientId}|${flagKeyOf(c.flags)}`);
      if (ack) (c as Record<string, unknown>).ack = ack;
    }

    return {
      asOf: new Date().toISOString(),
      opd, ipd, er,
      /** 🔴 확인 기록을 못 읽었으면 그렇게 말한다 — 화면이 "확인 없음"으로 그리지 않게 */
      ackUnavailable: ackFailed,
    };
  }

  /**
   * 상단 KPI — 활성·대기·미수납·매출.
   *
   * 🔴 표본 수(`n`)를 함께 반환한다. 종전엔 표본이 0 일 때도 값 `0` 을 그대로 내보내
   *    화면이 "평균 대기 0m·오늘 수납 ₩0" 이라고 단언했고, 관제자는 그것을 **"대기 없음·수납 없음"**
   *    으로 읽었다(2026-08-10 실측: 실제 대기 196명·평균 352분). n=0 은 값이 아니라 **모른다**는 뜻이다.
   */
  async getKpi() {
    const { targets: TH, sources: thresholdSources } = await resolveFlowTargetsWithSource(this.config);
    /**
     * 🔴 같은 "너무 오래 기다렸다"에 정본이 둘이다(2026-08-26 실측).
     *    관제는 `qi.targets.opdWaitMinutes`(운영 **미설정** → 코드 기본값 30분)로 지연을 판정하고,
     *    원무 화면(`/reception`)은 원내가 **실제로 설정한** `clinical.queue.*`(20/60분)로 색을 칠한다.
     *    같은 환자가 화면마다 지연이었다 아니었다 한다.
     *    🔴 여기서 임의로 통일하지 않는다 — 통일은 **원내 정책**이다(사람 결정 `qi.waitThresholdUnify`).
     *    대신 두 값을 **함께 내어 화면이 그 사실을 말하게** 한다.
     */
    const fieldWait = await Promise.all([
      this.config?.get('clinical.queue.waitWarningMinutes').catch(() => null) ?? null,
      this.config?.get('clinical.queue.maxWaitMinutes').catch(() => null) ?? null,
    ]);
    const now = new Date();
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    const waitCut = new Date(Date.now() - TH.opdWaitMin * 60_000);
    const callCut = new Date(Date.now() - TH.callDelayMin * 60_000);
    const cashierCut = new Date(Date.now() - TH.cashierDelayMin * 60_000);
    const consultCut = new Date(Date.now() - TH.consultDelayMin * 60_000);
    const longStayCut = new Date(Date.now() - TH.defaultAlos * TH.longStayMul * 86_400_000);
    const ktasLevels = Object.keys(KTAS_DOOR_TO_TRIAGE_FALLBACK);
    const [activeOpd, activeIpd, unpaidAgg, paidTodayAgg, waitingNow, totalBeds, admittedRows, waitDelay, callDelay, cashierDelay, consultDelay, longStay, dischargedRows, unpaidRows, triageDelayByLevel] = await Promise.all([
      // 🔴 미래 접수 상한 — 아직 오지 않은 사람을 '활성'으로 세지 않는다(W8 Q9).
      this.prisma.waitingQueue.count({ where: { status: { in: OPD_ACTIVE }, checkedInAt: notFutureCheckIn(now) } }),
      this.prisma.admission.count({ where: { status: 'ADMITTED' } }),
      // 🔴 (P4-1) 금액은 아래 행(unpaidRows)에서 감면까지 빼고 센다 — 여기서는 건수만
      this.prisma.billing.count({ where: { status: { in: UNPAID_STATUS } } }),
      this.prisma.billing.aggregate({ where: { status: 'PAID', paidAt: { gte: todayStart } }, _sum: { paidAmount: true }, _count: true }),
      // 🔴 대기 평균의 정의를 **현재 대기 중 환자의 경과**로 바꾼다. 종전 정의(당일 완료분 회고)는
      //    `startedAt` 을 요구해 표본이 오늘 1건까지 줄었고, 거기에 상한 필터(<600분)까지 걸려 0 이 됐다.
      //    관제는 회고가 아니라 지금을 본다. 회고 통계(p50/p90·위반율)는 /flow-analytics 소관.
      //    🔴 단, 미래 접수는 표본이 아니다 — 경과가 음수라 평균을 끌어내리고 '0분'으로 보인다(W8 Q9).
      this.prisma.waitingQueue.findMany({ where: { status: { in: OPD_WAITING_STAGES }, checkedInAt: notFutureCheckIn(now) }, select: { checkedInAt: true } }),
      // 🔴 **입원 병상만** 센다. `Ward.type` 정본이 "입원 가용 조회에서 EMERGENCY 제외"라고
      //    이미 못박고 있는데 이 소비처만 안 쓰고 있었다(2026-08-26 실측: 5/57=9% 로 보이던 것이
      //    실제로는 5/32=16% — **여유가 실제보다 많아 보였다**. 입원 결정이 그 수를 본다).
      //    조회 실패는 0 → `bedOccupancy: null`(산출 불가)로 흐른다. 0% 로 단언하지 않는다.
      this.prisma.bed.count({ where: { ward: { type: { not: 'EMERGENCY' } } } }).catch(() => 0),
      this.prisma.admission.findMany({ where: { status: 'ADMITTED' }, select: { admitDate: true } }),
      this.prisma.waitingQueue.count({ where: { status: 'WAITING', checkedInAt: { lt: waitCut } } }),
      // 🔴 CALL_DELAY — 보드 카드에는 붙는데 KPI `alerts` 에는 **키 자체가 없었다**(W8 Q12).
      //    보드와 같은 판정: 호출 시각(없으면 접수 시각) 기준 경과.
      this.prisma.waitingQueue.count({
        where: { status: 'CALLED', OR: [{ calledAt: { lt: callCut } }, { calledAt: null, checkedInAt: { lt: callCut } }] },
      }),
      this.prisma.waitingQueue.count({ where: { status: 'CASHIER_WAITING', completedAt: { lt: cashierCut } } }),
      this.prisma.waitingQueue.count({ where: { status: 'IN_CONSULTATION', startedAt: { lt: consultCut } } }),
      this.prisma.admission.count({ where: { status: 'ADMITTED', admitDate: { lt: longStayCut } } }),
      // 🔴 SETTLE_PENDING — 보드는 '퇴원했는데 미수납'에 이 flag 를 붙이는데 **KPI 에는 키가 없었다**.
      //    요약만 보는 사람에게 정산 대기는 존재하지 않는 사건이었다(운영 실측 19건).
      //    W8 Q12 에서 같은 유형을 고쳤는데, 그때 만든 계약 테스트가 **FE 목록을 손으로 베껴** 두어
      //    새 flag 가 추가돼도 통과했다 — 가드를 서버에서 유도하도록 함께 고쳤다.
      this.prisma.admission.findMany({ where: { status: 'DISCHARGED' }, select: { patientId: true } }),
      this.prisma.billing.findMany({ where: { status: { in: UNPAID_STATUS } }, select: { patientId: true, patientCopay: true, discountAmount: true, paidAmount: true } }),
      // 🔴 TRIAGE_DELAY — 응급 트리아지 지연이 관제 요약에서 **영구 실종**이었다(W8 Q12).
      //    보드는 `TRIAGE_DELAY:1` 을 붙이는데 상단 KPI 에는 그 키가 없어, 요약만 보는 사람에게
      //    응급 지연은 존재하지 않는 사건이었다. 등급별 목표가 다르므로 등급 단위로 센다.
      Promise.all(ktasLevels.map((lv) =>
        this.prisma.emergencyVisit.count({ where: erPreTriageWhere(lv, TH.doorToTriage[lv] ?? 30, now) }),
      )),
    ]);

    const unpaidTotal = unpaidRows.reduce((s, b) => s + (billingOutstanding(b) ?? 0), 0);
    const waits = waitingNow.map((w) => minutesSince(w.checkedInAt)).filter((m) => m >= 0); // 상한 없음 — 상한은 실제 지연을 지운다
    // 🔴 (2026-09-17 L4) 정본(avgStay.value)은 n=0 에 null 인데 이 하위호환 값만 0 이었다 — **같은 응답 안에서
    //    같은 사실을 둘로 말했다**(P12). 구 소비자도 0 일보다 null 이 사실이다.
    const avgStayDays = admittedRows.length ? Math.round((admittedRows.reduce((s, a) => s + daysSince(a.admitDate), 0) / admittedRows.length) * 10) / 10 : null;
    const highUnpaid = unpaidRows.filter((b) => (billingOutstanding(b) ?? 0) > TH.highUnpaid).length;
    // 보드와 같은 판정: 퇴원 상태인데 그 환자에게 미수납이 남아 있다
    const dischargedPatientIds = new Set(dischargedRows.map((a) => a.patientId));
    const settlePending = [...new Set(unpaidRows.filter((b) => b.patientId && dischargedPatientIds.has(b.patientId)).map((b) => b.patientId))].length;

    return {
      asOf: new Date().toISOString(),
      activeOpd, activeIpd,
      // value 는 n>0 일 때만 의미가 있다. n=0 이면 화면은 '산출 불가'로 표시한다(0 표시 금지).
      avgWait: { value: waits.length ? Math.round(waits.reduce((a, b) => a + b, 0) / waits.length) : null, n: waits.length },
      avgWaitMin: waits.length ? Math.round(waits.reduce((a, b) => a + b, 0) / waits.length) : null, // 하위호환(구 소비자) — 정본 avgWait.value 와 같은 판정
      avgStay: { value: avgStayDays, n: admittedRows.length },
      avgStayDays,
      unpaidTotal, unpaidCount: unpaidAgg,
      bedOccupancy: totalBeds ? Math.round((activeIpd / totalBeds) * 100) / 100 : null,
      /** 🔴 비율에는 분모를 함께 낸다 — 분모가 무엇인지 모르면 9% 와 16% 를 구별할 수 없다 */
      bedOccupied: activeIpd,
      bedTotal: totalBeds || null,
      bedDenominatorNote: '입원 병상만(응급병동 제외)',
      revenueToday: { confirmed: paidTodayAgg._sum?.paidAmount ?? 0, n: paidTodayAgg._count },
      thresholds: TH, // 화면이 "무엇을 기준으로 지연이라 했는지" 보여줄 수 있게
      /** 🔴 그 기준이 **원내가 정한 값인지 코드 기본값인지** — 기본값을 정책인 척하지 않는다 */
      thresholdSources,
      /** 🔴 현장 화면이 쓰는 다른 기준 — 관리 화면과 현장이 다른 것을 볼 때 그 사실을 말한다 */
      fieldWaitThresholds: {
        warnMinutes: typeof fieldWait[0] === 'number' ? fieldWait[0] : null,
        dangerMinutes: typeof fieldWait[1] === 'number' ? fieldWait[1] : null,
        source: 'clinical.queue.*',
        screen: '/reception',
      },
      /**
       * 🔴 보드 flag 와 **같은 키 집합**이어야 한다(W8 Q12). 화면(ALERT_ORDER)은 7종을 기대하는데
       *    서버는 5종만 냈고, 빠진 둘 중 하나가 **응급 트리아지 지연**이었다.
       *    보드에 새 flag 를 추가하면 여기도 같이 추가한다 — 계약 테스트가 이를 강제한다.
       */
      alerts: {
        WAIT_DELAY: waitDelay,
        TRIAGE_DELAY: triageDelayByLevel.reduce((a, b) => a + b, 0),
        CALL_DELAY: callDelay,
        CONSULT_DELAY: consultDelay,
        CASHIER_DELAY: cashierDelay,
        LONG_STAY: longStay,
        HIGH_UNPAID: highUnpaid,
        SETTLE_PENDING: settlePending,
      },
      /** 트리아지 지연 등급 내역 — 합계만 보면 LEVEL_1 1건과 LEVEL_5 1건이 같아 보인다 */
      triageDelayByKtas: Object.fromEntries(ktasLevels.map((lv, i) => [lv, triageDelayByLevel[i] ?? 0])),
    };
  }
}
