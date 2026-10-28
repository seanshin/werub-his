import { ConflictException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { stayDays, CRITICAL_LAB_FLAGS, isAbnormalFlag, isCriticalFlag, isJudgedFlag, mergeVitalsThresholds, vitalItemFlags, type VitalsThresholds } from '@hospital-run/shared';
import { ConfigRuntimeService } from '../config/config-runtime.service';
import { AdmissionVitalsReader } from '../vitals/admission-vitals.reader';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { OrderDepartment, Prisma } from '@prisma/client';
import { myOrdersPrescriptionWhere } from '../order/my-orders-scope';
import { RESULTS_INBOX_DEFAULT_LIMIT, RESULTS_INBOX_MAX_LIMIT } from './dto/results-inbox.dto';
import { dayRange, todayRange, localDateKey } from '../../common/day-range';

/** 결과 확인함의 한 건 — 위급 > 이상 > 그 외(정상·미판정·영상) 순으로 앞에 선다 */
export type ResultSeverity = 'CRITICAL' | 'ABNORMAL' | 'NORMAL' | 'UNJUDGED' | 'NO_FLAG';

/**
 * 🔴 "결과가 도착했고 아직 아무도 확인하지 않은 오더" 정본 — 센서스 `pendingLabCount` 와 같은 조건이다.
 *    (COMPLETED = 결과 입력 완료. 검사는 검증(VERIFIED) 전 예비 결과도 여기 든다 — 화면이 검증 여부를 따로 말한다)
 *    취소된 오더는 빼고, 약·치료 오더는 결과 확인 대상이 아니다.
 */
const UNACKED_RESULT_WHERE: Prisma.OrderWhereInput = {
  status: 'COMPLETED',
  acknowledgedAt: null,
  cancelledAt: null,
  department: { in: [OrderDepartment.LAB, OrderDepartment.IMAGING] },
};

type PatientStatus = 'CRITICAL' | 'UNSTABLE' | 'NEW' | 'DC_PLAN' | 'STABLE';

interface BedWithWard {
  roomNumber: string;
  bedNumber: string;
  ward?: { name: string } | null;
}

/** 내 후속 일 목록 상한 */
export const MY_FOLLOWUP_LIMIT = 50;
/** 처리 기한(시간) — 1~168 정수만 · 그 밖은 미설정(null) */
export function normalizeDueHours(v: unknown): number | null {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  return typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= 168 ? n : null;
}

@Injectable()
export class DoctorsService {
  constructor(
    private readonly prisma: PrismaService,
    /** 활력 임계 개정(clinical.vitals.thresholds) — 담당 환자 상태 판정이 알림·화면과 같은 기준을 쓰게 */
    @Optional() private readonly config?: ConfigRuntimeService,
    /** 입원 활력 읽기 정본(플로시트 + 재원 중 외래 원장 · 2026-10-10) — 미주입(단위 테스트)이면 같은 prisma 로 구성 */
    @Optional() private readonly admissionVitalsInjected?: AdmissionVitalsReader,
  ) {}

  private _admissionVitalsFallback?: AdmissionVitalsReader;
  private get admissionVitals(): AdmissionVitalsReader {
    return this.admissionVitalsInjected ?? (this._admissionVitalsFallback ??= new AdmissionVitalsReader(this.prisma));
  }

  async getMyCensus(doctorId: string, sortBy?: string) {
    // 1. ChargeOfCare 기반 담당 환자
    const charges = await this.prisma.chargeOfCare.findMany({
      where: { doctorId, releasedAt: null, role: 'ATTENDING' },
      select: {
        admissionId: true,
        admission: {
          include: {
            patient: { select: { id: true, familyName: true, givenName: true, mrn: true, gender: true, dateOfBirth: true, photoUrl: true } },
            bed: { include: { ward: true } },
          },
        },
      },
    });

    // 2. admittingDoctor 폴백 — ChargeOfCare 없는 환자
    const chargedAdmissionIds = charges.map(c => c.admissionId);
    const fallbackAdmissions = await this.prisma.admission.findMany({
      where: {
        admittingDoctorId: doctorId,
        status: 'ADMITTED',
        id: { notIn: chargedAdmissionIds },
      },
      include: {
        patient: { select: { id: true, familyName: true, givenName: true, mrn: true, gender: true, dateOfBirth: true, photoUrl: true } },
        bed: { include: { ward: true } },
      },
    });

    const allAdmissions = [
      ...charges.map(c => c.admission),
      ...fallbackAdmissions,
    ].filter(a => a.status === 'ADMITTED');

    if (allAdmissions.length === 0) {
      return {
        doctorInfo: await this.getDoctorInfo(doctorId),
        totalPatients: 0,
        byStatus: { critical: 0, unstable: 0, new: 0, stable: 0, dcPlan: 0 },
        patients: [],
      };
    }

    const admissionIds = allAdmissions.map(a => a.id);
    const patientIds = allAdmissions.map(a => a.patientId);
    const now = new Date();
    const todayStart = new Date(now.toISOString().slice(0, 10) + 'T00:00:00+09:00');

    // 3. 배치 쿼리
    const vitalsThresholds = mergeVitalsThresholds(this.config ? await this.config.get('clinical.vitals.thresholds') : null);
    const [latestVitals, lastRounds, pendingOrders, todayNotes, urgentNotes] = await Promise.all([
      // 🔴 (2026-10-10) 플로시트만 보면 간호 스테이션에서 잰 활력이 "기록 없음"이었다 — 두 원장 정본으로
      this.admissionVitals.latestByAdmission(allAdmissions).then((m) => [...m.values()].map((v) => ({ ...v, recordedAt: v.at }))),
      this.prisma.round.findMany({
        where: { admissionId: { in: admissionIds } },
        orderBy: { roundedAt: 'desc' },
        distinct: ['admissionId'],
        select: { admissionId: true, roundedAt: true, roundType: true },
      }),
      this.prisma.order.findMany({
        // 결과 확인함(getResultsInbox)과 같은 정본 조건 — 여기 숫자를 누르면 그 목록이 열린다
        where: {
          ...UNACKED_RESULT_WHERE,
          prescription: { encounter: { patientId: { in: patientIds } } },
        },
        select: {
          id: true, department: true,
          prescription: { select: { instructions: true, type: true, encounter: { select: { patientId: true } } } },
        },
      }),
      this.prisma.nursingNote.groupBy({
        by: ['admissionId'],
        where: { admissionId: { in: admissionIds }, createdAt: { gte: todayStart } },
        _count: { _all: true },
      }),
      this.prisma.nursingNote.findMany({
        where: {
          admissionId: { in: admissionIds },
          priority: 'URGENT',
          createdAt: { gte: new Date(now.getTime() - 24 * 60 * 60 * 1000) },
        },
        select: { admissionId: true, content: true, createdAt: true },
      }),
    ]);

    // 활성 처방 수
    const activePrescriptions = await this.prisma.prescription.groupBy({
      by: ['encounterId'],
      where: { status: 'ACTIVE', encounter: { patientId: { in: patientIds } } },
      _count: { _all: true },
    });
    const encounterIds = activePrescriptions.map(p => p.encounterId);
    const rxCountByPatient = new Map<string, number>();
    if (encounterIds.length > 0) {
      const encounters = await this.prisma.encounter.findMany({
        where: { id: { in: encounterIds } },
        select: { id: true, patientId: true },
      });
      const encPatientMap = new Map(encounters.map(e => [e.id, e.patientId]));
      activePrescriptions.forEach(p => {
        const pid = encPatientMap.get(p.encounterId);
        if (pid) rxCountByPatient.set(pid, (rxCountByPatient.get(pid) || 0) + p._count._all);
      });
    }

    // 인덱스 맵
    const vitalMap = new Map(latestVitals.map(v => [v.admissionId, v]));
    const roundMap = new Map(lastRounds.map(r => [r.admissionId, r]));
    const noteCountMap = new Map(todayNotes.map(n => [n.admissionId, n._count._all]));
    const urgentMap = new Map<string, typeof urgentNotes>();
    urgentNotes.forEach(n => {
      const list = urgentMap.get(n.admissionId) || [];
      list.push(n);
      urgentMap.set(n.admissionId, list);
    });

    // 환자별 미확인 검사
    const pendingLabMap = new Map<string, { count: number; items: string[] }>();
    pendingOrders.forEach(o => {
      const pid = o.prescription?.encounter?.patientId;
      if (!pid) return;
      const entry = pendingLabMap.get(pid) || { count: 0, items: [] };
      entry.count++;
      const name = o.prescription?.instructions || o.prescription?.type || String(o.department);
      if (name && !entry.items.includes(name)) entry.items.push(name);
      pendingLabMap.set(pid, entry);
    });

    // 4. 환자 카드 구성
    const patients = allAdmissions.map(adm => {
      const v = vitalMap.get(adm.id);
      const round = roundMap.get(adm.id);
      const urgent = urgentMap.get(adm.id) || [];
      const pendingLab = pendingLabMap.get(adm.patientId) || { count: 0, items: [] };
      const daysAdmitted = stayDays(adm.admitDate) ?? 1;
      const wardName = (adm.bed as BedWithWard | null)?.ward?.name || '';

      // DC_PLAN — 퇴원 예정일이 설정되고 2일 이내로 임박한 경우(구: dischargeDate는 퇴원 후에만 채워져 무동작)
      const exp = (adm as { expectedDischargeDate?: Date | null }).expectedDischargeDate;
      const dischargePlanned = !!exp && new Date(exp).getTime() <= now.getTime() + 2 * 86400000;
      const status = this.classifyStatus(v, vitalsThresholds, wardName, urgent.length, daysAdmitted, dischargePlanned);

      return {
        patient: adm.patient,
        admission: {
          id: adm.id,
          admitDate: adm.admitDate,
          expectedDischargeDate: exp ?? null,
          ward: wardName,
          room: (adm.bed as BedWithWard | null)?.roomNumber || '',
          bed: (adm.bed as BedWithWard | null)?.bedNumber || '',
          dietType: adm.dietType,
          daysAdmitted,
          admitReason: adm.admitReason,
        },
        status,
        primaryDiagnosis: adm.admitReason || null,
        latestVitals: v ? {
          systolicBp: v.systolicBp, diastolicBp: v.diastolicBp, heartRate: v.heartRate,
          temperature: v.temperature ? Number(v.temperature) : null,
          spo2: v.spo2, painScore: v.painScore,
          recordedAt: v.recordedAt,
        } : null,
        vitalTrend: 'STABLE' as const,
        lastRoundAt: round?.roundedAt?.toISOString() || null,
        lastRoundType: round?.roundType || null,
        pendingLabCount: pendingLab.count,
        pendingLabItems: pendingLab.items.slice(0, 5),
        todayNursingNotes: noteCountMap.get(adm.id) || 0,
        activeRxCount: rxCountByPatient.get(adm.patientId) || 0,
        urgentAlerts: urgent.map(u => ({
          type: 'NURSING_URGENT',
          message: (u.content || '긴급 간호 보고').substring(0, 80),
          severity: 'WARNING',
          at: u.createdAt.toISOString(),
        })),
      };
    });

    // 5. 정렬
    const statusOrder: Record<PatientStatus, number> = { CRITICAL: 1, UNSTABLE: 2, NEW: 3, STABLE: 4, DC_PLAN: 5 };
    patients.sort((a, b) => {
      if (sortBy === 'ward') return a.admission.ward.localeCompare(b.admission.ward);
      if (sortBy === 'admitDate') return new Date(b.admission.admitDate).getTime() - new Date(a.admission.admitDate).getTime();
      return statusOrder[a.status] - statusOrder[b.status];
    });

    const byStatus = {
      critical: patients.filter(p => p.status === 'CRITICAL').length,
      unstable: patients.filter(p => p.status === 'UNSTABLE').length,
      new: patients.filter(p => p.status === 'NEW').length,
      stable: patients.filter(p => p.status === 'STABLE').length,
      dcPlan: patients.filter(p => p.status === 'DC_PLAN').length,
    };

    return {
      doctorInfo: await this.getDoctorInfo(doctorId),
      totalPatients: patients.length,
      byStatus,
      patients,
    };
  }

  /** 오늘 회진 대상 + 진행률 */
  /**
   * 오늘 회진 현황 — **전 의료진**(사람 신고 2026-08-26: "의료진마다 회진 스케줄이 전체적으로
   * 표시되어야 하지 않나?").
   *
   * 종전엔 `getMyRoundsToday(내 id)` 뿐이라 **본인 것만** 보였다. 병동에서 "오늘 회진이 어디까지
   * 돌았나"를 보려면 담당의별 진행률이 한 화면에 있어야 한다.
   *
   * 🔴 **담당의가 없는 재원 건을 버리지 않는다.** 버리면 총합이 병동 재원 수와 맞지 않고,
   *    아무도 그 환자를 회진 대상으로 보지 않게 된다 — `UNASSIGNED` 묶음으로 **드러낸다**.
   * 🔴 **분모를 함께 낸다**(rounded/total). 비율만 내면 "다 돌았다"가 표본 부재일 수 있다.
   */
  async getRoundsTodayAll() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const admissions = await this.prisma.admission.findMany({
      where: { status: 'ADMITTED' },
      include: {
        patient: { select: { id: true, familyName: true, givenName: true, mrn: true } },
        bed: { include: { ward: true } },
        attendingDoctor: { select: { id: true, familyName: true, givenName: true, department: true } },
        rounds: { where: { roundedAt: { gte: today } }, orderBy: { roundedAt: 'desc' }, take: 1 },
      },
      orderBy: { admitDate: 'asc' },
    });

    // 담당의 정본 — ChargeOfCare(현재 담당) 우선, 없으면 입원 시 지정의
    const charges = await this.prisma.chargeOfCare.findMany({
      where: { admissionId: { in: admissions.map((a) => a.id) }, releasedAt: null, role: 'ATTENDING' },
      include: { doctor: { select: { id: true, familyName: true, givenName: true, department: true } } },
    });
    const chargeBy = new Map(charges.map((c) => [c.admissionId, c.doctor]));

    type Doc = { id: string; familyName: string | null; givenName: string | null; department: string | null };
    const groups = new Map<string, { doctor: Doc | null; total: number; rounded: number; patients: unknown[] }>();

    for (const a of admissions) {
      const doc = (chargeBy.get(a.id) ?? a.attendingDoctor) as Doc | null;
      // 🔴 담당의 미지정도 한 묶음으로 남긴다 — 조용히 빠지면 아무도 안 본다
      const key = doc?.id ?? 'UNASSIGNED';
      const g = groups.get(key) ?? { doctor: doc, total: 0, rounded: 0, patients: [] };
      const done = a.rounds.length > 0;
      g.total += 1;
      if (done) g.rounded += 1;
      g.patients.push({
        admissionId: a.id,
        patientId: a.patient.id,
        name: `${a.patient.familyName ?? ''}${a.patient.givenName ?? ''}`,
        mrn: a.patient.mrn,
        ward: a.bed?.ward?.name ?? null,
        bed: a.bed ? `${a.bed.roomNumber ?? ''}-${a.bed.bedNumber ?? ''}` : null,
        roundedAt: a.rounds[0]?.roundedAt ?? null,
      });
      groups.set(key, g);
    }

    const doctors = [...groups.entries()]
      .map(([key, g]) => ({
        doctorId: key === 'UNASSIGNED' ? null : key,
        doctorName: g.doctor ? `${g.doctor.familyName ?? ''}${g.doctor.givenName ?? ''}` : null,
        department: g.doctor?.department ?? null,
        total: g.total,
        rounded: g.rounded,
        patients: g.patients,
      }))
      // 미완료가 많은 순 → 담당의 미지정은 맨 위(아무도 안 보는 것이 가장 위험하다)
      .sort((a, b) => {
        if (!a.doctorId) return -1;
        if (!b.doctorId) return 1;
        return (b.total - b.rounded) - (a.total - a.rounded);
      });

    return {
      asOf: new Date().toISOString(),
      total: admissions.length,
      rounded: admissions.filter((a) => a.rounds.length > 0).length,
      unassigned: groups.get('UNASSIGNED')?.total ?? 0,
      doctors,
    };
  }

  /**
   * 내 후속 일(2026-10-10 · 의사 할 일함) — 나 기준 EP 가 없던 세 목록.
   *  · 미서명 진료기록(DRAFT · 담당의 = 나) · 미서명 퇴원요약(DRAFT · 작성의 = 나)
   *  · 회신이 도착한 내 협진(REPLIED · 의뢰의 = 나) — 읽고 종결하면 사라진다
   *  · 처리 기한(원내 정책 `doctor.inbox.dueHours`) — 미설정이면 null(늦음 판정 없음)
   * 각 목록 상한 50 + 전체 수(자르면 잘랐다고 말한다).
   */
  /**
   * 내가 처리한 것(2026-10-10 · 의사 할 일함 '오늘 처리한 것') — **처리자·시각이 원장에 남는 것만** 센다(지어내지 않는다).
   *  · 결과 확인(Order.acknowledgedBy) · 구두 처방 사후 서명(prescriberCosignedBy) · 처방 갱신(renewedFromId · 입력자=나)
   *  · 사전처방 승인(PreOrder.approvedBy) · 약사 중재 회신(respondedBy) · 협진 회신(replyDoctorId) · 진료기록·퇴원요약 서명(signedBy)
   *  · 🔴 협진 종결은 종결자 칸이 원장에 없어 세지 않는다(`notCounted` 로 밝힌다)
   * 하루(로컬 KST) · 종류마다 상한 50 + 전체 수.
   */
  async getMyHandled(doctorId: string, date?: string) {
    const r = date ? dayRange(date, date) : null;
    const day = r?.gte && r?.lt ? { gte: r.gte, lt: r.lt } : todayRange();
    const L = MY_FOLLOWUP_LIMIT;
    const patient = { select: { id: true, mrn: true, familyName: true, givenName: true } } as const;
    const [acks, acksN, cosigns, cosignsN, renews, renewsN, pres, presN, ivs, ivsN, replies, repliesN, encs, encsN, dss, dssN] = await Promise.all([
      this.prisma.order.findMany({
        where: { acknowledgedBy: doctorId, acknowledgedAt: day }, orderBy: { acknowledgedAt: 'desc' }, take: L,
        select: { id: true, acknowledgedAt: true, department: true, prescription: { select: { procedureCode: { select: { nameKo: true } }, encounter: { select: { patient } } } } },
      }),
      this.prisma.order.count({ where: { acknowledgedBy: doctorId, acknowledgedAt: day } }),
      this.prisma.prescription.findMany({
        where: { prescriberCosignedBy: doctorId, prescriberCosignedAt: day }, orderBy: { prescriberCosignedAt: 'desc' }, take: L,
        select: { id: true, prescriberCosignedAt: true, medicationCode: { select: { nameKo: true } }, encounter: { select: { patient } } },
      }),
      this.prisma.prescription.count({ where: { prescriberCosignedBy: doctorId, prescriberCosignedAt: day } }),
      this.prisma.prescription.findMany({
        where: { renewedFromId: { not: null }, createdBy: doctorId, createdAt: day }, orderBy: { createdAt: 'desc' }, take: L,
        select: { id: true, createdAt: true, medicationCode: { select: { nameKo: true } }, encounter: { select: { patient } } },
      }),
      this.prisma.prescription.count({ where: { renewedFromId: { not: null }, createdBy: doctorId, createdAt: day } }),
      this.prisma.preOrder.findMany({
        where: { approvedBy: doctorId, approvedAt: day }, orderBy: { approvedAt: 'desc' }, take: L,
        select: { id: true, approvedAt: true, type: true, patient },
      }),
      this.prisma.preOrder.count({ where: { approvedBy: doctorId, approvedAt: day } }),
      this.prisma.pharmacistIntervention.findMany({
        where: { respondedBy: doctorId, respondedAt: day }, orderBy: { respondedAt: 'desc' }, take: L,
        select: { id: true, respondedAt: true, status: true, patientId: true },
      }),
      this.prisma.pharmacistIntervention.count({ where: { respondedBy: doctorId, respondedAt: day } }),
      this.prisma.consultation.findMany({
        where: { replyDoctorId: doctorId, repliedAt: day }, orderBy: { repliedAt: 'desc' }, take: L,
        select: { id: true, repliedAt: true, toDepartment: true, encounter: { select: { patient } } },
      }),
      this.prisma.consultation.count({ where: { replyDoctorId: doctorId, repliedAt: day } }),
      this.prisma.encounter.findMany({
        where: { signedBy: doctorId, signedAt: day }, orderBy: { signedAt: 'desc' }, take: L,
        select: { id: true, signedAt: true, patient },
      }),
      this.prisma.encounter.count({ where: { signedBy: doctorId, signedAt: day } }),
      this.prisma.dischargeSummary.findMany({
        where: { signedBy: doctorId, signedAt: day }, orderBy: { signedAt: 'desc' }, take: L,
        select: { id: true, admissionId: true, signedAt: true, admission: { select: { patient } } },
      }),
      this.prisma.dischargeSummary.count({ where: { signedBy: doctorId, signedAt: day } }),
    ]);
    type P = { id: string; mrn: string; familyName: string | null; givenName: string | null } | null | undefined;
    const row = (kind: string, id: string, at: Date | null, label: string | null, p: P, href: string | null) => ({ kind, id, at, label, patient: p ?? null, href });
    const items = [
      ...acks.map((o) => row('RESULT_ACK', o.id, o.acknowledgedAt, o.prescription?.procedureCode?.nameKo ?? null, o.prescription?.encounter?.patient, o.prescription?.encounter?.patient ? `/patients/${o.prescription.encounter.patient.id}?tab=labresults` : null)),
      ...cosigns.map((x) => row('VERBAL_COSIGN', x.id, x.prescriberCosignedAt, x.medicationCode?.nameKo ?? null, x.encounter?.patient, x.encounter?.patient ? `/patients/${x.encounter.patient.id}?tab=orders` : null)),
      ...renews.map((x) => row('RENEWAL', x.id, x.createdAt, x.medicationCode?.nameKo ?? null, x.encounter?.patient, x.encounter?.patient ? `/patients/${x.encounter.patient.id}?tab=medications` : null)),
      ...pres.map((x) => row('PREORDER_APPROVE', x.id, x.approvedAt, x.type, x.patient, x.patient ? `/patients/${x.patient.id}?tab=pre-orders` : null)),
      ...ivs.map((x) => row('PHARMACIST_REPLY', x.id, x.respondedAt, x.status, null, x.patientId ? `/patients/${x.patientId}?tab=medications` : null)),
      ...replies.map((x) => row('CONSULT_REPLY', x.id, x.repliedAt, x.toDepartment, x.encounter?.patient, x.encounter?.patient ? `/patients/${x.encounter.patient.id}?tab=referrals` : null)),
      ...encs.map((x) => row('ENCOUNTER_SIGN', x.id, x.signedAt, null, x.patient, x.patient ? `/patients/${x.patient.id}/encounter/new?encounterId=${x.id}` : null)),
      ...dss.map((x) => row('DISCHARGE_SIGN', x.id, x.signedAt, null, x.admission?.patient, `/inpatient/${x.admissionId}/discharge-summary`)),
    ].sort((a, b) => (b.at?.getTime() ?? 0) - (a.at?.getTime() ?? 0));
    const counts = {
      RESULT_ACK: acksN, VERBAL_COSIGN: cosignsN, RENEWAL: renewsN, PREORDER_APPROVE: presN,
      PHARMACIST_REPLY: ivsN, CONSULT_REPLY: repliesN, ENCOUNTER_SIGN: encsN, DISCHARGE_SIGN: dssN,
    };
    const shown = { RESULT_ACK: acks.length, VERBAL_COSIGN: cosigns.length, RENEWAL: renews.length, PREORDER_APPROVE: pres.length, PHARMACIST_REPLY: ivs.length, CONSULT_REPLY: replies.length, ENCOUNTER_SIGN: encs.length, DISCHARGE_SIGN: dss.length };
    return {
      date: localDateKey(day.gte), counts,
      total: Object.values(counts).reduce((a, b) => a + b, 0),
      truncated: (Object.keys(counts) as Array<keyof typeof counts>).some((k) => counts[k] > shown[k]),
      items, limit: L,
      // 원장에 처리자 칸이 없어 세지 않는 일 — 화면이 그대로 말한다
      notCounted: ['CONSULT_CLOSE'],
    };
  }

  async getMyFollowups(doctorId: string) {
    const LIMIT = MY_FOLLOWUP_LIMIT;
    const patient = { select: { id: true, mrn: true, familyName: true, givenName: true } } as const;
    const [encItems, encTotal, dsItems, dsTotal, cItems, cTotal, dueRaw] = await Promise.all([
      this.prisma.encounter.findMany({
        where: { doctorId, status: 'DRAFT' }, orderBy: { createdAt: 'asc' }, take: LIMIT,
        select: { id: true, createdAt: true, updatedAt: true, chiefComplaint: true, patient },
      }),
      this.prisma.encounter.count({ where: { doctorId, status: 'DRAFT' } }),
      this.prisma.dischargeSummary.findMany({
        where: { doctorId, status: 'DRAFT' }, orderBy: { createdAt: 'asc' }, take: LIMIT,
        select: { id: true, admissionId: true, createdAt: true, updatedAt: true, admission: { select: { patient, dischargeDate: true, status: true } } },
      }),
      this.prisma.dischargeSummary.count({ where: { doctorId, status: 'DRAFT' } }),
      this.prisma.consultation.findMany({
        where: { requestingDoctorId: doctorId, status: 'REPLIED' }, orderBy: { repliedAt: 'asc' }, take: LIMIT,
        select: {
          id: true, toDepartment: true, urgency: true, reason: true, replyContent: true, recommendations: true, repliedAt: true, createdAt: true,
          replyDoctor: { select: { familyName: true, givenName: true } }, encounter: { select: { id: true, patient } },
        },
      }),
      this.prisma.consultation.count({ where: { requestingDoctorId: doctorId, status: 'REPLIED' } }),
      this.config ? this.config.get('doctor.inbox.dueHours') : Promise.resolve(null),
    ]);
    return {
      unsignedEncounters: { items: encItems, total: encTotal, truncated: encTotal > encItems.length },
      unsignedDischargeSummaries: { items: dsItems, total: dsTotal, truncated: dsTotal > dsItems.length },
      repliedConsults: { items: cItems, total: cTotal, truncated: cTotal > cItems.length },
      policy: { dueHours: normalizeDueHours(dueRaw) },
      limit: LIMIT,
    };
  }

  async getMyRoundsToday(doctorId: string) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // 담당 환자 목록
    const charges = await this.prisma.chargeOfCare.findMany({
      where: { doctorId, releasedAt: null, role: 'ATTENDING' },
      select: { admissionId: true },
    });
    const fallback = await this.prisma.admission.findMany({
      where: { admittingDoctorId: doctorId, status: 'ADMITTED', id: { notIn: charges.map(c => c.admissionId) } },
      select: { id: true },
    });
    const admissionIds = [...charges.map(c => c.admissionId), ...fallback.map(f => f.id)];

    if (admissionIds.length === 0) {
      return { total: 0, rounded: 0, patients: [] };
    }

    const admissions = await this.prisma.admission.findMany({
      where: { id: { in: admissionIds }, status: 'ADMITTED' },
      include: {
        patient: { select: { id: true, familyName: true, givenName: true, mrn: true, gender: true, dateOfBirth: true } },
        bed: { include: { ward: true } },
        rounds: { where: { roundedAt: { gte: today }, doctorId }, orderBy: { roundedAt: 'desc' }, take: 1 },
      },
    });

    // 최근 바이탈
    // 두 원장 정본(2026-10-10) — 간호 스테이션 입력도 회진 목록에 보인다
    const vitalMap = new Map([...(await this.admissionVitals.latestByAdmission(admissions)).values()].map((v) => [v.admissionId, { ...v, recordedAt: v.at }]));

    // 간호 노트 (오늘)
    const notes = await this.prisma.nursingNote.findMany({
      where: { admissionId: { in: admissionIds }, createdAt: { gte: today } },
      orderBy: { createdAt: 'desc' },
      select: { admissionId: true, content: true, priority: true, createdAt: true },
      take: 50,
    });
    const noteMap = new Map<string, typeof notes>();
    notes.forEach(n => {
      const list = noteMap.get(n.admissionId) || [];
      list.push(n);
      noteMap.set(n.admissionId, list);
    });

    const patients = admissions.map(adm => {
      const rounded = adm.rounds.length > 0;
      const lastRound = adm.rounds[0] || null;
      const vital = vitalMap.get(adm.id);
      const nursingNotes = noteMap.get(adm.id) || [];

      return {
        admissionId: adm.id,
        patient: adm.patient,
        ward: (adm.bed as BedWithWard | null)?.ward?.name || '',
        room: (adm.bed as BedWithWard | null)?.roomNumber || '',
        bed: (adm.bed as BedWithWard | null)?.bedNumber || '',
        admitReason: adm.admitReason,
        rounded,
        lastRound: lastRound ? { roundedAt: lastRound.roundedAt, roundType: lastRound.roundType, notes: lastRound.notes } : null,
        latestVitals: vital ? {
          systolicBp: vital.systolicBp, diastolicBp: vital.diastolicBp,
          heartRate: vital.heartRate, temperature: vital.temperature ? Number(vital.temperature) : null,
          spo2: vital.spo2, recordedAt: vital.recordedAt,
        } : null,
        nursingAlerts: nursingNotes.filter(n => n.priority === 'URGENT').map(n => n.content?.substring(0, 60) || ''),
      };
    });

    // 미회진 → 불안정(위급) → 안정 순 정렬
    patients.sort((a, b) => {
      if (a.rounded !== b.rounded) return a.rounded ? 1 : -1;
      return 0;
    });

    return {
      total: patients.length,
      rounded: patients.filter(p => p.rounded).length,
      patients,
    };
  }

  /** 빠른 회진 기록 */
  async quickRound(doctorId: string, dto: { admissionId: string; assessment: string; plan: string; status?: string; roundType?: string }) {
    return this.prisma.round.create({
      data: {
        admissionId: dto.admissionId,
        doctorId,
        roundType: dto.roundType || 'MORNING',
        roundedAt: new Date(),
        assessment: dto.assessment,
        plan: dto.plan,
        notes: dto.status || null,
      },
    });
  }

  /**
   * 검사결과 확인함 — 결과가 도착했는데 아직 확인하지 않은 오더(줄어드는 목록).
   *
   * 🔴 (2026-09-30) `PATCH doctors/orders/:id/acknowledge` 는 처음부터 있었는데 **부르는 화면이 없어**
   *    센서스의 "미확인 검사 N건"을 줄일 방법이 없었다. 확인할 목록이 없으면 의사는 기억으로 일한다.
   *
   * 정렬: 위급 flag 가 있는 결과 → 이상 flag → 그 외(정상·미판정·영상), 각 묶음 안에서는 최근 완료순.
   *   묶음을 DB 에서 나눠 세고 나눠 가져온다 — 최근 N건을 먼저 자르고 메모리에서 정렬하면
   *   **오래된 위급값이 잘려 나간다**(가장 급한 것이 가장 먼저 사라진다).
   * 자르면 자른다고 말한다 — `total`·묶음별 `counts` 를 함께 돌려준다.
   */
  async getResultsInbox(userId: string, opts: { patientId?: string; limit?: number; offset?: number } = {}) {
    const limit = Math.min(Math.max(opts.limit ?? RESULTS_INBOX_DEFAULT_LIMIT, 1), RESULTS_INBOX_MAX_LIMIT);
    const offset = Math.max(opts.offset ?? 0, 0);
    const scope: 'MINE' | 'PATIENT' = opts.patientId ? 'PATIENT' : 'MINE';
    const scopeWhere: Prisma.OrderWhereInput = opts.patientId
      ? { prescription: { encounter: { patientId: opts.patientId } } }
      : { prescription: myOrdersPrescriptionWhere(userId) };

    const critical: Prisma.OrderWhereInput = {
      labResult: { items: { some: { flag: { in: [...CRITICAL_LAB_FLAGS] } } } },
    };
    // 이상 = 정상(N·NORMAL)도 미판정(null·빈 값)도 아닌 flag. 위급은 앞 묶음이 가져간다.
    const abnormal: Prisma.OrderWhereInput = {
      labResult: { items: { some: { flag: { notIn: ['N', 'NORMAL', '', ...CRITICAL_LAB_FLAGS], not: null } } } },
    };
    const buckets: Prisma.OrderWhereInput[] = [
      { AND: [UNACKED_RESULT_WHERE, scopeWhere, critical] },
      { AND: [UNACKED_RESULT_WHERE, scopeWhere, { NOT: critical }, abnormal] },
      { AND: [UNACKED_RESULT_WHERE, scopeWhere, { NOT: critical }, { NOT: abnormal }] },
    ];
    const counts = await Promise.all(buckets.map((where) => this.prisma.order.count({ where })));

    const select = {
      id: true, department: true, priority: true, completedAt: true, createdAt: true,
      labResult: {
        select: {
          id: true, status: true, completedAt: true, verifiedAt: true,
          items: { select: { testName: true, value: true, unit: true, flag: true } },
        },
      },
      imagingResult: { select: { id: true, status: true, modality: true, bodyPart: true, impression: true, reportedAt: true } },
      prescription: {
        select: {
          id: true, type: true, instructions: true, prescriberId: true, createdBy: true,
          procedureCode: { select: { code: true, nameKo: true } },
          encounter: {
            select: {
              id: true, doctorId: true,
              patient: { select: { id: true, familyName: true, givenName: true, mrn: true } },
            },
          },
        },
      },
    } satisfies Prisma.OrderSelect;

    // 묶음을 이어 붙인 가상의 한 줄에서 [offset, offset+limit) 구간을 가져온다
    const rows: Prisma.OrderGetPayload<{ select: typeof select }>[] = [];
    let skip = offset;
    for (let i = 0; i < buckets.length && rows.length < limit; i++) {
      if (skip >= counts[i]) { skip -= counts[i]; continue; }
      const got = await this.prisma.order.findMany({
        where: buckets[i],
        orderBy: [{ completedAt: 'desc' }, { id: 'desc' }],
        skip,
        take: limit - rows.length,
        select,
      });
      rows.push(...got);
      skip = 0;
    }

    const items = rows.map((o) => {
      const labItems = o.labResult?.items ?? [];
      let severity: ResultSeverity;
      if (o.department === OrderDepartment.IMAGING || !o.labResult) severity = 'NO_FLAG';
      else if (labItems.some((it) => isCriticalFlag(it.flag))) severity = 'CRITICAL';
      else if (labItems.some((it) => isJudgedFlag(it.flag) && isAbnormalFlag(it.flag))) severity = 'ABNORMAL';
      // 🔴 미판정(null) 항목이 하나라도 있으면 "정상"이라 말하지 않는다 — 판정하지 못한 것이다
      else if (labItems.length === 0 || labItems.some((it) => !isJudgedFlag(it.flag))) severity = 'UNJUDGED';
      else severity = 'NORMAL';
      const rx = o.prescription;
      return {
        orderId: o.id,
        department: o.department,
        priority: o.priority,
        completedAt: o.completedAt,
        severity,
        testName: rx?.procedureCode?.nameKo ?? rx?.instructions ?? null,
        testCode: rx?.procedureCode?.code ?? null,
        patient: rx?.encounter?.patient ?? null,
        encounterId: rx?.encounter?.id ?? null,
        orderedByMe: !!rx && (rx.prescriberId === userId || rx.createdBy === userId || rx.encounter?.doctorId === userId),
        lab: o.labResult
          ? {
              resultId: o.labResult.id,
              /** COMPLETED = 예비(검증 전) · VERIFIED = 검증 확정 */
              status: o.labResult.status,
              verifiedAt: o.labResult.verifiedAt,
              itemCount: labItems.length,
              // 이상·위급 항목만 싣는다(전 항목은 차트에서 본다) — 몇 개 중인지 itemCount 로 함께 말한다
              flaggedItems: labItems.filter((it) => isJudgedFlag(it.flag) && isAbnormalFlag(it.flag)),
              unjudgedCount: labItems.filter((it) => !isJudgedFlag(it.flag)).length,
            }
          : null,
        imaging: o.imagingResult
          ? {
              resultId: o.imagingResult.id,
              status: o.imagingResult.status,
              modality: o.imagingResult.modality,
              bodyPart: o.imagingResult.bodyPart,
              impression: o.imagingResult.impression,
              reportedAt: o.imagingResult.reportedAt,
            }
          : null,
      };
    });

    const total = counts[0] + counts[1] + counts[2];
    return {
      scope,
      patientId: opts.patientId ?? null,
      total,
      counts: { critical: counts[0], abnormal: counts[1], other: counts[2] },
      offset,
      limit,
      items,
    };
  }

  /**
   * 검사 결과 확인(acknowledge) — 🔴 결과가 없는 오더는 확인할 수 없다.
   *
   * 종전엔 아무 오더나 `acknowledgedAt` 을 찍었다. 결과가 오기 전에 확인하면 **나중에 도착한 결과가
   * 이미 확인된 것으로 숨는다**(줄어드는 목록에서 영영 빠진다). 그래서 결과 입력 완료(COMPLETED)·
   * 미취소 오더만 확인한다. 이미 확인된 건은 그대로 돌려준다 — 먼저 확인한 사람을 덮어쓰지 않는다.
   */
  async acknowledgeOrder(orderId: string, doctorId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { id: true, status: true, cancelledAt: true, acknowledgedAt: true, acknowledgedBy: true },
    });
    if (!order) throw new NotFoundException('오더를 찾을 수 없습니다');
    if (order.acknowledgedAt) return order;
    if (order.status !== 'COMPLETED' || order.cancelledAt) {
      throw new ConflictException('결과가 아직 없는 오더는 확인할 수 없습니다');
    }
    // 읽고 쓰는 사이에 다른 사람이 먼저 확인했으면 덮어쓰지 않는다(where 에 미확인 조건)
    await this.prisma.order.updateMany({
      where: { id: orderId, acknowledgedAt: null, status: 'COMPLETED', cancelledAt: null },
      data: { acknowledgedBy: doctorId, acknowledgedAt: new Date() },
    });
    return this.prisma.order.findUnique({
      where: { id: orderId },
      select: { id: true, status: true, cancelledAt: true, acknowledgedAt: true, acknowledgedBy: true },
    });
  }

  /**
   * 결과 일괄 확인 — 결과가 있는(COMPLETED·미취소) 미확인 오더만 확인한다.
   * 🔴 몇 건을 확인했고 몇 건을 건너뛰었는지 그대로 돌려준다(요청 수를 "확인됨"으로 말하지 않는다).
   */
  async acknowledgeOrders(orderIds: string[], doctorId: string) {
    const ids = [...new Set(orderIds)];
    const res = await this.prisma.order.updateMany({
      where: { id: { in: ids }, ...UNACKED_RESULT_WHERE },
      data: { acknowledgedBy: doctorId, acknowledgedAt: new Date() },
    });
    return { requested: ids.length, acknowledged: res.count, skipped: ids.length - res.count };
  }

  /**
   * 담당 환자 상태.
   * 🔴 (2026-10-01) 활력 기준을 여기만의 숫자(HR>140 위급·SBP>160 불안정…)로 적고 있었다 — 같은 환자가 알림(HR≥130 위급)·
   *    간호 스테이션·입원 상세와 다른 판정을 받았다. 이제 임계 정본(shared + 환자안전위 개정)으로:
   *    위급 역치 = CRITICAL · 주의 역치 = UNSTABLE. 통증은 상태 판정에 넣지 않는다(종전에도 보지 않았다).
   */
  private classifyStatus(
    v: any, T: VitalsThresholds, wardName: string, urgentCount: number,
    daysAdmitted: number, dischargePlanned: boolean,
  ): PatientStatus {
    const num = (x: unknown) => (x == null || x === '' || !Number.isFinite(Number(x)) ? null : Number(x));
    const f = v ? vitalItemFlags({
      systolicBp: num(v.systolicBp), diastolicBp: num(v.diastolicBp), heartRate: num(v.heartRate),
      temperature: num(v.temperature), spo2: num(v.spo2), respiratoryRate: num(v.respiratoryRate),
    }, T) : null;
    const physio = f ? [f.systolicBp, f.diastolicBp, f.heartRate, f.temperature, f.spo2, f.respiratoryRate] : [];
    if (physio.includes('CRITICAL')) return 'CRITICAL';
    if (wardName?.includes('ICU') || wardName?.includes('중환자')) return 'CRITICAL';
    if (urgentCount > 0) return 'CRITICAL';

    if (physio.includes('WARNING')) return 'UNSTABLE';

    if (daysAdmitted <= 1) return 'NEW';
    if (dischargePlanned) return 'DC_PLAN';
    return 'STABLE';
  }

  private async getDoctorInfo(doctorId: string) {
    if (!doctorId) return null;
    const user = await this.prisma.user.findUnique({
      where: { id: doctorId },
      select: { id: true, familyName: true, givenName: true, department: true, specialty: true },
    });
    return user ? {
      id: user.id,
      name: `${user.familyName}${user.givenName}`,
      department: user.department,
      specialty: user.specialty,
    } : null;
  }
}
