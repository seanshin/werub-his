import { Injectable, Logger } from '@nestjs/common';
import { stayDays, localeTimeText } from '@hospital-run/shared';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { DutyScheduleService } from '../duty-schedule/duty-schedule.service';

@Injectable()
export class WorkgroupService {
  private readonly logger = new Logger(WorkgroupService.name);
  constructor(private readonly prisma: PrismaService, private readonly dutySchedule: DutyScheduleService) {}

  // #1 의사 오늘 진료 목록
  async getDoctorSchedule(doctorId: string, date?: string) {
    const targetDate = date ? new Date(date) : new Date();
    targetDate.setHours(0, 0, 0, 0);
    const nextDay = new Date(targetDate); nextDay.setDate(nextDay.getDate() + 1);

    const doctor = await this.prisma.user.findUnique({
      where: { id: doctorId },
      select: { familyName: true, givenName: true, department: true },
    });

    const appointments = await this.prisma.appointment.findMany({
      where: { doctorId, scheduledAt: { gte: targetDate, lt: nextDay } },
      include: { patient: { select: { id: true, familyName: true, givenName: true, mrn: true } } },
      orderBy: { scheduledAt: 'asc' },
    });

    const completed = appointments.filter(a => a.status === 'COMPLETED').length;

    return {
      doctorId,
      doctorName: doctor ? `${doctor.familyName}${doctor.givenName}` : '-',
      department: doctor?.department ?? '-',
      date: targetDate.toISOString().split('T')[0],
      totalAppointments: appointments.length,
      completed,
      appointments: appointments.map(a => ({
        id: a.id,
        time: localeTimeText(new Date(a.scheduledAt), 'ko-KR', { hour: '2-digit', minute: '2-digit' }),
        patientId: `p-${a.patient.mrn}`,
        patientName: `${a.patient.familyName}O${a.patient.givenName?.substring(1) ?? ''}`,
        type: a.type === 'INITIAL' ? 'first_visit' : a.type === 'FOLLOW_UP' ? 'revisit' : 'follow_up',
        department: doctor?.department ?? '-',
        chiefComplaint: null,
        status: a.status === 'COMPLETED' ? 'completed' : a.status === 'CHECKED_IN' ? 'in_progress' : 'waiting',
      })),
    };
  }

  // #2 수술 일정
  async getSurgerySchedule(date?: string, doctorId?: string) {
    const targetDate = date ? new Date(date) : new Date();
    targetDate.setHours(0, 0, 0, 0);
    const nextDay = new Date(targetDate); nextDay.setDate(nextDay.getDate() + 1);

    const where: Prisma.SurgeryWhereInput = { scheduledAt: { gte: targetDate, lt: nextDay } };
    if (doctorId) where.surgeonId = doctorId;

    const surgeries = await this.prisma.surgery.findMany({
      where,
      include: {
        patient: { select: { familyName: true, givenName: true, mrn: true } },
        surgeon: { select: { familyName: true, givenName: true } },
      },
      orderBy: { scheduledAt: 'asc' },
    });

    return {
      surgeries: surgeries.map(s => ({
        id: s.id,
        operatingRoom: (s as any).operatingRoom ?? 'OR-1',
        startTime: localeTimeText(new Date(s.scheduledAt), 'ko-KR', { hour: '2-digit', minute: '2-digit' }),
        endTime: s.endedAt ? localeTimeText(new Date(s.endedAt), 'ko-KR', { hour: '2-digit', minute: '2-digit' }) : null,
        patientId: `p-${s.patient.mrn}`,
        patientName: `${s.patient.familyName}O${s.patient.givenName?.substring(1) ?? ''}`,
        procedure: s.procedureName,
        surgeon: `${s.surgeon.familyName}${s.surgeon.givenName}`,
        anesthesiologist: null,
        status: s.status === 'COMPLETED' ? 'completed' : s.status === 'IN_PROGRESS' ? 'in_progress' : 'scheduled',
        notes: s.opNote ?? null,
      })),
    };
  }

  // #3 담당 입원 환자
  async getWardPatients(doctorId: string) {
    const admissions = await this.prisma.admission.findMany({
      where: { admittingDoctorId: doctorId, status: 'ADMITTED' },
      include: {
        patient: { select: { id: true, familyName: true, givenName: true, mrn: true } },
        bed: { include: { ward: { select: { name: true, floor: true } } } },
      },
    });

    // 낙상위험 + 알레르기 조회
    const patientIds = admissions.map(a => a.patientId);
    const [fallRisks, allergies] = await Promise.all([
      this.prisma.fallRiskAssessment.findMany({
        where: { patientId: { in: patientIds } },
        select: { patientId: true, riskLevel: true },
        orderBy: { assessedAt: 'desc' },
      }),
      this.prisma.allergy.findMany({
        where: { patientId: { in: patientIds }, isActive: true, type: 'DRUG' },
        select: { patientId: true, allergen: true },
      }),
    ]);

    return {
      patients: admissions.map(a => {
        const days = stayDays(a.admitDate) ?? 0;
        const alerts: string[] = [];
        const fr = fallRisks.find(f => f.patientId === a.patientId);
        if (fr && (fr.riskLevel === 'HIGH' || fr.riskLevel === 'MODERATE')) alerts.push('낙상 위험');
        const al = allergies.filter(x => x.patientId === a.patientId);
        if (al.length) alerts.push(`알레르기: ${al.map(x => x.allergen).join(', ')}`);

        return {
          patientId: `p-${a.patient.mrn}`,
          patientName: `${a.patient.familyName}O${a.patient.givenName?.substring(1) ?? ''}`,
          room: `${a.bed.roomNumber}호`,
          floor: `${a.bed.ward.floor}f`,
          admittedAt: a.admitDate.toISOString().split('T')[0],
          diagnosis: a.admitReason ?? '-',
          condition: 'stable',
          expectedDischarge: null,
          alerts,
          daysSinceAdmission: days,
        };
      }),
      totalCount: admissions.length,
    };
  }

  // #4 병동 현황
  async getWardStatus(floorId: string) {
    const floorNum = parseInt(floorId.replace(/[^-\d]/g, ''));
    const ward = await this.prisma.ward.findFirst({ where: { floor: floorNum } });
    if (!ward) return null;

    const beds = await this.prisma.bed.findMany({
      where: { wardId: ward.id },
      include: {
        admissions: {
          where: { status: 'ADMITTED' },
          include: {
            patient: { select: { familyName: true, givenName: true, mrn: true } },
            admittingDoctor: { select: { familyName: true, givenName: true } },
          },
          take: 1,
        },
      },
      orderBy: [{ roomNumber: 'asc' }, { bedNumber: 'asc' }],
    });

    // 병실별 그룹핑
    const roomMap = new Map<string, any[]>();
    for (const bed of beds) {
      const key = bed.roomNumber;
      if (!roomMap.has(key)) roomMap.set(key, []);
      roomMap.get(key)!.push(bed);
    }

    const rooms = [...roomMap.entries()].map(([roomNum, roomBeds]) => ({
      roomId: `z-${roomNum}`,
      roomName: `${roomNum}호`,
      roomType: `${roomBeds.length}bed`,
      capacity: roomBeds.length,
      patients: roomBeds.filter(b => b.admissions.length > 0).map(b => {
        const adm = b.admissions[0];
        return {
          patientId: `p-${adm.patient.mrn}`,
          patientName: `${adm.patient.familyName}O${adm.patient.givenName?.substring(1) ?? ''}`,
          bedNumber: b.bedNumber === 'A' ? 1 : b.bedNumber === 'B' ? 2 : parseInt(b.bedNumber) || 1,
          condition: 'stable',
          alerts: [],
          doctor: `${adm.admittingDoctor.familyName}${adm.admittingDoctor.givenName}`,
          admittedAt: adm.admitDate.toISOString().split('T')[0],
        };
      }),
    }));

    // 당직 근무자 (정본=DutyEntry — 모델 이원화 통합 2026-07-22). @db.Date는 UTC 자정 저장 — 로컬 날짜를 UTC 자정으로 매핑
    const now = new Date();
    const today = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
    const dutyEntries = await this.prisma.dutyEntry.findMany({
      where: { date: today },
      take: 10,
    });

    return {
      floorId,
      floorName: ward.name,
      totalBeds: beds.length,
      occupiedBeds: beds.filter(b => b.admissions.length > 0).length,
      rooms,
      onDutyStaff: dutyEntries.map(e => ({
        id: e.staffId,
        name: e.staffName,
        role: e.role,
        shift: e.shift.toLowerCase(),
      })),
    };
  }

  // #5 접수 현황
  async getReceptionStatus() {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const queue = await this.prisma.waitingQueue.findMany({
      where: { checkedInAt: { gte: today } },
    });

    const waiting = queue.filter(q => q.status === 'WAITING' || q.status === 'CHECKED_IN').length;
    const inProgress = queue.filter(q => q.status === 'IN_CONSULTATION' || q.status === 'CALLED').length;
    const completed = queue.filter(q => q.status === 'COMPLETED').length;
    const waitTimes = queue.filter(q => q.startedAt).map(q => Math.floor((q.startedAt!.getTime() - q.checkedInAt.getTime()) / 60000));
    const avgWait = waitTimes.length ? Math.round(waitTimes.reduce((a, b) => a + b, 0) / waitTimes.length) : null; // 🔴 대기 표본 0 = 산출 불가(0 분 아님)

    // 부서별
    const deptMap = new Map<string, { waiting: number; times: number[] }>();
    for (const q of queue) {
      const dept = q.departmentName ?? '기타';
      if (!deptMap.has(dept)) deptMap.set(dept, { waiting: 0, times: [] });
      const d = deptMap.get(dept)!;
      if (q.status === 'WAITING' || q.status === 'CHECKED_IN') d.waiting++;
      if (q.startedAt) d.times.push(Math.floor((q.startedAt.getTime() - q.checkedInAt.getTime()) / 60000));
    }

    const departments = [...deptMap.entries()].map(([name, d]) => ({
      name,
      waiting: d.waiting,
      avgWaitMinutes: d.times.length ? Math.round(d.times.reduce((a, b) => a + b, 0) / d.times.length) : null,
    }));

    // 🔴 표본이 없는 과(null)는 경보하지 않는다 — 희소 축의 0 을 경보하지 않는다
    const alerts = departments.filter((d): d is typeof d & { avgWaitMinutes: number } => d.avgWaitMinutes != null && d.avgWaitMinutes > 30).map(d => ({
      department: d.name,
      message: `대기 ${d.avgWaitMinutes}분 초과`,
      severity: 'warning',
    }));

    return { waiting, inProgress, completed, avgWaitMinutes: avgWait, departments, alerts };
  }

  // #6 수납 통계
  async getBillingSummary(date?: string) {
    const targetDate = date ? new Date(date) : new Date();
    targetDate.setHours(0, 0, 0, 0);
    const nextDay = new Date(targetDate); nextDay.setDate(nextDay.getDate() + 1);

    const billings = await this.prisma.billing.findMany({
      where: { createdAt: { gte: targetDate, lt: nextDay } },
    });

    const totalAmount = billings.reduce((s, b) => s + b.totalAmount, 0);
    const unpaid = billings.filter(b => b.status === 'PENDING').length;
    const paid = billings.filter(b => b.status === 'PAID');

    const claims = await this.prisma.claim.findMany({
      where: { createdAt: { gte: targetDate, lt: nextDay } },
    });

    return {
      date: targetDate.toISOString().split('T')[0],
      totalReceipts: billings.length,
      unpaid,
      totalAmount,
      breakdown: {
        outpatient: { count: billings.length, amount: totalAmount },
      },
      insurance: {
        pending: claims.filter(c => c.status === 'SUBMITTED').length,
        rejected: claims.filter(c => c.status === 'REJECTED').length,
        approved: claims.filter(c => c.status === 'APPROVED' || c.status === 'PAID').length,
      },
    };
  }

  // #10 당직 스케줄 (정본=DutyEntry — 모델 이원화 통합 2026-07-22, 응답 형태 불변)
  async getDutySchedule(month?: string, department?: string) {
    const targetMonth = month ?? new Date().toISOString().substring(0, 7);
    const [year, mon] = targetMonth.split('-').map(Number);
    const startDate = new Date(Date.UTC(year, mon - 1, 1));
    const endDate = new Date(Date.UTC(year, mon, 1));

    const entries = await this.prisma.dutyEntry.findMany({
      where: { date: { gte: startDate, lt: endDate }, ...(department ? { department } : {}) },
      orderBy: [{ date: 'asc' }, { shift: 'asc' }],
    });

    // 날짜별 그룹핑
    const dateMap = new Map<string, typeof entries>();
    for (const e of entries) {
      const key = e.date.toISOString().split('T')[0];
      if (!dateMap.has(key)) dateMap.set(key, [] as never);
      dateMap.get(key)!.push(e);
    }

    const today = new Date().toISOString().split('T')[0];
    const todaySchedules = dateMap.get(today) ?? [];

    return {
      month: targetMonth,
      schedules: [...dateMap.entries()].map(([dateStr, items]) => ({
        date: dateStr,
        shifts: items.map(e => ({
          shift: e.shift.toLowerCase(),
          staff: [{
            id: e.staffId,
            name: e.staffName,
            role: e.role,
            department: e.department ?? '-',
          }],
        })),
      })),
      today: {
        onDuty: todaySchedules.map(e => ({
          name: e.staffName,
          shift: e.shift.toLowerCase(),
          department: e.department ?? '-',
        })),
      },
    };
  }

  // #14 투약 스케줄
  async getMedicationSchedule(nurseId: string, hours = 4) {
    const now = new Date();
    const until = new Date(now.getTime() + hours * 3600000);

    const meds = await this.prisma.medicationAdministration.findMany({
      where: { nurseId, scheduledAt: { gte: now, lte: until }, status: 'SCHEDULED' },
      include: {
        patient: { select: { familyName: true, givenName: true, mrn: true } },
        prescription: { include: { medicationCode: { select: { nameKo: true } } } },
      },
      orderBy: { scheduledAt: 'asc' },
    });

    // overdue
    const overdue = await this.prisma.medicationAdministration.findMany({
      where: { nurseId, scheduledAt: { lt: now }, status: 'SCHEDULED' },
    });

    return {
      upcoming: meds.map(m => ({
        id: m.id,
        patientId: `p-${m.patient.mrn}`,
        patientName: `${m.patient.familyName}O${m.patient.givenName?.substring(1) ?? ''}`,
        room: '-',
        medication: m.prescription?.medicationCode?.nameKo ?? m.dose,
        route: m.route,
        frequency: '-',
        scheduledAt: m.scheduledAt.toISOString(),
        status: 'pending',
        isOverdue: false,
        notes: m.notes ?? '',
      })),
      overdueCount: overdue.length,
    };
  }

  // #16 미투약 목록
  async getOverdueMedications(wardId?: string) {
    const now = new Date();
    const overdue = await this.prisma.medicationAdministration.findMany({
      where: { scheduledAt: { lt: now }, status: 'SCHEDULED' },
      include: {
        patient: { select: { familyName: true, givenName: true, mrn: true } },
        prescription: { include: { medicationCode: { select: { nameKo: true } } } },
      },
      orderBy: { scheduledAt: 'asc' },
    });

    return {
      overdue: overdue.map(m => {
        const mins = Math.floor((now.getTime() - m.scheduledAt.getTime()) / 60000);
        return {
          id: m.id,
          patientName: `${m.patient.familyName}O${m.patient.givenName?.substring(1) ?? ''}`,
          room: '-',
          medication: m.prescription?.medicationCode?.nameKo ?? m.dose,
          route: m.route,
          scheduledAt: m.scheduledAt.toISOString(),
          overdueMinutes: mins,
          assignedNurse: '-',
          severity: mins > 30 ? 'high' : mins > 15 ? 'medium' : 'low',
        };
      }),
      totalOverdue: overdue.length,
    };
  }

  // #7 인수인계 양식 (환자 정보 자동 채움)
  async getHandoffTemplate(wardId: string, shift?: string) {
    const floorNum = parseInt(wardId.replace(/[^-\d]/g, ''));
    const ward = await this.prisma.ward.findFirst({ where: { floor: isNaN(floorNum) ? undefined : floorNum } });
    if (!ward) return { wardId, wardName: '-', patients: [] };

    const admissions = await this.prisma.admission.findMany({
      where: { status: 'ADMITTED', bed: { wardId: ward.id } },
      include: {
        patient: { select: { id: true, familyName: true, givenName: true, mrn: true } },
        bed: { select: { roomNumber: true, bedNumber: true } },
      },
    });

    // 각 환자별 최근 활력징후, 투약, 미결사항 조회
    const patients = await Promise.all(admissions.map(async (adm) => {
      // 최근 nursing assessment에서 vitals
      const nursing = await this.prisma.nursingAssessment.findFirst({
        where: { admissionId: adm.id },
        orderBy: { createdAt: 'desc' },
        select: { additionalData: true, painScore: true },
      });

      // 활성 투약
      const meds = await this.prisma.medicationAdministration.findMany({
        where: { patientId: adm.patientId, status: 'SCHEDULED' },
        include: { prescription: { include: { medicationCode: { select: { nameKo: true } } } } },
        take: 5,
      });

      // 낙상 위험
      const fallRisk = await this.prisma.fallRiskAssessment.findFirst({
        where: { patientId: adm.patientId },
        orderBy: { assessedAt: 'desc' },
        select: { riskLevel: true },
      });

      const alerts: string[] = [];
      if (fallRisk && (fallRisk.riskLevel === 'HIGH' || fallRisk.riskLevel === 'MODERATE')) alerts.push('낙상 위험');

      return {
        patientId: `p-${adm.patient.mrn}`,
        patientName: `${adm.patient.familyName}O${adm.patient.givenName?.substring(1) ?? ''}`,
        room: `${adm.bed.roomNumber}호`,
        bed: adm.bed.bedNumber === 'A' ? 1 : adm.bed.bedNumber === 'B' ? 2 : parseInt(adm.bed.bedNumber) || 1,
        diagnosis: adm.admitReason ?? '-',
        condition: 'stable',
        vitals: nursing?.additionalData ?? null,
        notes: '',
        alerts,
        medications: meds.map(m => ({
          name: m.prescription?.medicationCode?.nameKo ?? m.dose,
          route: m.route,
          schedule: '-',
          nextDue: localeTimeText(m.scheduledAt, 'ko-KR', { hour: '2-digit', minute: '2-digit' }),
        })),
        pendingOrders: [],
      };
    }));

    const shiftLabel = shift === 'day' ? 'night_to_day' : shift === 'night' ? 'day_to_night' : 'shift_change';

    return {
      wardId,
      wardName: ward.name,
      shift: shiftLabel,
      handoffTime: new Date().toISOString(),
      patients,
    };
  }

  // #8 인수인계 제출
  async submitHandoff(body: {
    wardId: string; shift: string; handoffTime: string;
    fromNurseId: string; toNurseId: string;
    patients: Array<{ patientId: string; notes: string; alerts?: string[]; priority?: string }>;
    generalNotes?: string;
  }) {
    // 각 환자별 ClinicalHandoff 생성
    // 🔴 2026-08-20 — 종전엔 MRN 이 안 풀리는 환자를 조용히 `continue` 로 건너뛰고도
    //    **무조건** `status:'submitted'` + `submittedAt: now` 를 돌려줬다(P16 — 실행하지 않고
    //    성공 상태만 기록). 인계가 한 건도 저장되지 않아도 화면은 "제출 완료"를 봤다.
    //    이제 실제로 만들어진 것만 세고, 0건이면 제출이라 말하지 않는다.
    //    (`handoffId` 도 `ho-<날짜>-<병동>-<근무>` 로 **날조**돼 있었다 — 이력 조회가 돌려주는
    //     실제 ClinicalHandoff id 와 서로 다른 정본이었다. 이제 생성된 실제 id 를 돌려준다.)
    const createdIds: string[] = [];
    const unresolved: string[] = [];
    for (const p of body.patients) {
      // patientId "p-P2026-0001" → 실제 ID
      const mrn = p.patientId.replace('p-', '');
      const patient = await this.prisma.patient.findFirst({ where: { mrn: { contains: mrn } } });
      if (!patient) { unresolved.push(p.patientId); continue; }

      const created = await this.prisma.clinicalHandoff.create({
        data: {
          type: 'NURSING_SHIFT', // 간호사 → 간호사 교대(2026-10-26 — 종전 SHIFT_CHANGE 로 의사 교대와 섞였다 · shared HANDOFF_TYPES)
          patientId: patient.id,
          fromDoctorId: body.fromNurseId,
          toDoctorId: body.toNurseId,
          summary: p.notes,
          pendingItems: p.alerts ? JSON.stringify(p.alerts) : undefined,
        },
      });
      createdIds.push(created.id);
    }

    const recorded = createdIds.length > 0;
    if (unresolved.length) {
      this.logger.warn(`인수인계 제출 — 환자 미해소 ${unresolved.length}건(인계 미저장): ${unresolved.join(', ')}`);
    }
    return {
      // 제출 시각은 **실제로 저장된 경우에만** 남긴다(저장된 게 없으면 아무 일도 일어나지 않았다).
      status: recorded ? 'submitted' : 'not_recorded',
      submittedAt: recorded ? new Date().toISOString() : null,
      handoffIds: createdIds,
      handoffId: createdIds[0] ?? null,
      createdCount: createdIds.length,
      requestedCount: body.patients.length,
      unresolvedPatientIds: unresolved,
      ...(recorded ? {} : { message: '인계가 한 건도 저장되지 않았습니다 — 환자 식별(MRN)을 확인하십시오' }),
    };
  }

  // #9 인수인계 이력
  async getHandoffHistory(wardId?: string, from?: string, to?: string, limit = 20) {
    const where: Prisma.ClinicalHandoffWhereInput = {};
    if (from || to) {
      const createdAtFilter: Prisma.DateTimeFilter = {};
      if (from) createdAtFilter.gte = new Date(from);
      if (to) createdAtFilter.lte = new Date(to + 'T23:59:59Z');
      where.createdAt = createdAtFilter;
    }

    const handoffs = await this.prisma.clinicalHandoff.findMany({
      where,
      include: {
        fromDoctor: { select: { familyName: true, givenName: true } },
        toDoctor: { select: { familyName: true, givenName: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    // 그룹핑 (같은 시간대 제출 건을 묶음)
    const grouped = new Map<string, any>();
    for (const h of handoffs) {
      const key = `${h.createdAt.toISOString().split('T')[0]}-${h.fromDoctorId}`;
      if (!grouped.has(key)) {
        grouped.set(key, {
          handoffId: h.id,
          wardId: wardId ?? '-',
          shift: h.type,
          fromNurse: h.fromDoctor ? `${h.fromDoctor.familyName}${h.fromDoctor.givenName}` : '-',
          toNurse: h.toDoctor ? `${h.toDoctor.familyName}${h.toDoctor.givenName}` : '-',
          patientCount: 0,
          submittedAt: h.createdAt.toISOString(),
          acknowledgedAt: h.acknowledgedAt?.toISOString() ?? null,
        });
      }
      grouped.get(key)!.patientCount++;
    }

    return { handoffs: [...grouped.values()], totalCount: grouped.size };
  }

  // #11 당직 교대 요청 — 정본 DutySwapRequest로 위임(SystemConfig 임시구현 제거 — 모델 이원화 통합 2026-07-22). 응답 형태 불변
  async requestDutySwap(body: { requesterId: string; targetId: string; originalDate: string; originalShift: string; swapDate: string; swapShift: string; reason: string }) {
    const result = await this.dutySchedule.requestSwap(body);
    const swap = result.data;
    return {
      requestId: swap.id,
      status: 'pending_approval',
      requester: swap.requesterName,
      target: swap.targetName,
    };
  }

  // #17 현재 활성 알림
  async getActiveAlerts(severity?: string) {
    // 여러 소스에서 알림 수집
    const alerts: Array<{ id: string; type: string; severity: string; zoneId?: string; zoneName?: string; message: string; createdAt: string }> = [];

    // 1. 미투약 (30분 이상 overdue → high)
    const now = new Date();
    const overdueThreshold = new Date(now.getTime() - 30 * 60000);
    const overdueMeds = await this.prisma.medicationAdministration.findMany({
      where: { scheduledAt: { lt: overdueThreshold }, status: 'SCHEDULED' },
      include: { patient: { select: { familyName: true, givenName: true } } },
      take: 10,
    });
    for (const m of overdueMeds) {
      const mins = Math.floor((now.getTime() - m.scheduledAt.getTime()) / 60000);
      alerts.push({
        id: `alert-med-${m.id.substring(0, 8)}`,
        type: 'overdue_medication',
        severity: mins > 60 ? 'critical' : 'warning',
        message: `투약 ${mins}분 지연: ${m.patient.familyName}${m.patient.givenName} (${m.dose})`,
        createdAt: m.scheduledAt.toISOString(),
      });
    }

    // 2. 대기 시간 초과 (30분 이상)
    const longWait = await this.prisma.waitingQueue.findMany({
      where: { status: { in: ['WAITING', 'CHECKED_IN'] }, checkedInAt: { lt: new Date(now.getTime() - 30 * 60000) } },
      take: 5,
    });
    for (const w of longWait) {
      const mins = Math.floor((now.getTime() - w.checkedInAt.getTime()) / 60000);
      alerts.push({
        id: `alert-wait-${w.id.substring(0, 8)}`,
        type: 'wait_exceeded',
        severity: 'warning',
        zoneName: w.departmentName ?? '-',
        message: `${w.departmentName ?? '외래'} 대기 ${mins}분 초과`,
        createdAt: w.checkedInAt.toISOString(),
      });
    }

    // 3. 안전사건 (최근 24시간)
    const recentSafety = await this.prisma.safetyIncident.findMany({
      where: { occurredAt: { gte: new Date(now.getTime() - 24 * 3600000) }, status: 'REPORTED' },
      take: 5,
    });
    for (const s of recentSafety) {
      alerts.push({
        id: `alert-safety-${s.id.substring(0, 8)}`,
        type: s.type === 'FALL' ? 'fall' : s.type === 'MEDICATION_ERROR' ? 'medication_error' : 'safety_incident',
        severity: s.severity === 'HIGH' ? 'critical' : 'warning',
        message: s.description.substring(0, 80),
        createdAt: s.occurredAt.toISOString(),
      });
    }

    const filtered = severity ? alerts.filter(a => a.severity === severity) : alerts;
    return { alerts: filtered.sort((a, b) => b.createdAt.localeCompare(a.createdAt)), totalCount: filtered.length };
  }

  // #18 알림 확인/대응
  async acknowledgeAlert(alertId: string, body: { acknowledgedBy: string; action: string; notes?: string }) {
    // 🔴 2026-10-08 — 종전엔 알림 확인이 `alert-safety-<id앞부분>` 접두 매칭으로 **사고 상태를 RESOLVED/INVESTIGATING 으로 바꿨다**.
    //    사고 상태 변경은 검토 권한(`safety:incident:review`)과 전이 검증을 거치는 `/safety/incidents/:id/status` 하나뿐이다.
    //    알림 확인은 확인 기록일 뿐 사고를 닫지 않는다.
    return { alertId, action: body.action, acknowledgedAt: new Date().toISOString() };
  }

  // #19 키오스크 대기 현황
  async getKioskWaiting(departmentId: string) {
    // departmentId를 부서명으로 매핑
    const deptMap: Record<string, string> = {
      'dept-internal': '내과', 'dept-surgery': '외과', 'dept-pediatrics': '소아청소년과',
      'dept-obgyn': '산부인과', 'dept-ortho': '정형외과', 'dept-er': '응급의학과',
    };
    const deptName = deptMap[departmentId] ?? departmentId;

    const today = new Date(); today.setHours(0, 0, 0, 0);
    const queue = await this.prisma.waitingQueue.findMany({
      where: { departmentName: deptName, checkedInAt: { gte: today } },
      orderBy: { checkedInAt: 'asc' },
    });

    const waiting = queue.filter(q => q.status === 'WAITING' || q.status === 'CHECKED_IN');
    const inProgress = queue.filter(q => q.status === 'IN_CONSULTATION' || q.status === 'CALLED');
    const waitTimes = waiting.map(q => Math.floor((Date.now() - q.checkedInAt.getTime()) / 60000));
    const avgWait = waitTimes.length ? Math.round(waitTimes.reduce((a, b) => a + b, 0) / waitTimes.length) : null; // 🔴 대기 표본 0 = 산출 불가(0 분 아님)

    // 번호표 (개인정보 없음)
    let position = 0;
    const queueItems = waiting.map(q => {
      position++;
      return {
        ticketNumber: `${deptName.charAt(0)}-${String(position).padStart(3, '0')}`,
        position,
        status: 'waiting',
      };
    });
    for (const q of inProgress) {
      queueItems.push({
        ticketNumber: `${deptName.charAt(0)}-${String(0).padStart(3, '0')}`,
        position: 0,
        status: 'in_progress',
      });
    }

    return {
      department: deptName,
      currentWaiting: waiting.length,
      estimatedWaitMinutes: avgWait,
      queue: queueItems,
      // 🔴 대기 표본이 없으면(null) 지연 안내를 만들지 않는다 — 모르는 것을 방송하지 않는다
      announcement: avgWait != null && avgWait > 30 ? `${deptName} 진료 지연 안내: 현재 평균 ${avgWait}분 대기` : null,
    };
  }

  // #20 번호표 발급
  async issueKioskTicket(body: { departmentId: string; patientId: string; visitType: string }) {
    const deptMap: Record<string, string> = {
      'dept-internal': '내과', 'dept-surgery': '외과', 'dept-pediatrics': '소아청소년과',
      'dept-obgyn': '산부인과', 'dept-ortho': '정형외과',
    };
    const deptName = deptMap[body.departmentId] ?? body.departmentId;

    // 오늘 발급된 번호표 카운트
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const todayCount = await this.prisma.waitingQueue.count({
      where: { departmentName: deptName, checkedInAt: { gte: today } },
    });

    const ticketNumber = todayCount + 1;
    const ticketStr = `${deptName.charAt(0)}-${String(ticketNumber).padStart(3, '0')}`;

    // WaitingQueue에 추가
    // doctorId는 부서 대표 의사로 (없으면 admin)
    const deptDoctor = await this.prisma.user.findFirst({ where: { department: deptName, role: 'DOCTOR' }, select: { id: true } });
    const adminUser = await this.prisma.user.findFirst({ where: { role: 'ADMIN' }, select: { id: true } });
    await this.prisma.waitingQueue.create({
      data: {
        patientId: body.patientId,
        doctorId: deptDoctor?.id ?? adminUser?.id ?? body.patientId,
        departmentName: deptName,
        queueNumber: ticketNumber,
        type: 'WALK_IN',
        visitType: body.visitType === 'revisit' ? 'FOLLOW_UP' : 'INITIAL',
        status: 'WAITING',
        checkedInAt: new Date(),
      },
    });

    // 대기 인원
    const waiting = await this.prisma.waitingQueue.count({
      where: { departmentName: deptName, checkedInAt: { gte: today }, status: { in: ['WAITING', 'CHECKED_IN'] } },
    });

    return {
      ticketNumber: ticketStr,
      department: deptName,
      position: waiting,
      estimatedWaitMinutes: waiting * 8,
      issuedAt: new Date().toISOString(),
    };
  }

  // AI 당직 자동 배정 — 강한 편성 엔진(DutyScheduleService.autoGenerate, 연속야간·전이규칙 제약)으로 위임.
  // 제약 없는 약한 로직 제거(모델 이원화 통합 2026-07-22). 응답 형태 불변
  async autoAssignDuty(month: string) {
    const result = await this.dutySchedule.autoGenerate(month, '전체', {});
    if ('error' in result) return { error: result.error, assigned: 0 };
    return {
      month,
      totalDays: result.totalDays,
      totalAssignments: result.generated,
      staffCount: result.staffCount,
      summary: (result.summary ?? [])
        .map(s => ({
          name: s.staffName,
          department: s.department ?? '-',
          totalShifts: s.totalShifts,
          dayShifts: s.dayShifts,
          eveningShifts: s.eveningShifts,
          nightShifts: s.nightShifts,
        }))
        .sort((a, b) => b.totalShifts - a.totalShifts),
    };
  }
}
