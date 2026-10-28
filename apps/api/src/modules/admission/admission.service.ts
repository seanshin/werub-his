import { transferBedInTx } from '../inpatient/bed-transfer';
import { Injectable, NotFoundException, ConflictException, BadRequestException, Optional } from '@nestjs/common';
import { PATIENT_SENSITIVE_OMIT } from '../../common/patient-select';
import { stayDays, bradenRiskLevel } from '@hospital-run/shared';
import { nursingDayWindowOrToday, NursingService } from '../nursing/nursing.service';

import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AdmissionVitalsReader } from '../vitals/admission-vitals.reader';
import type { TransferCareDto } from './dto/admission.dto';
import { AdmissionStatus, BedStatus, Prisma } from '@prisma/client';
import { InpatientService } from '../inpatient/inpatient.service';
import { JourneyService } from '../journey/journey.service';

@Injectable()
export class AdmissionService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly eventEmitter?: EventEmitter2,
    @Optional() private readonly inpatient?: InpatientService,
    @Optional() private readonly journey?: JourneyService,
    /** 입원 활력 읽기 정본(2026-10-10) — 미주입(단위 테스트)이면 같은 prisma 로 구성 */
    @Optional() private readonly admissionVitalsInjected?: AdmissionVitalsReader,
  ) {}

  private _admissionVitalsFallback?: AdmissionVitalsReader;
  private get admissionVitals(): AdmissionVitalsReader {
    return this.admissionVitalsInjected ?? (this._admissionVitalsFallback ??= new AdmissionVitalsReader(this.prisma));
  }

  async create(patientId: string, bedId: string, admittingDoctorId: string, admitDate: string, admitReason?: string, dietType?: string) {
    const patient = await this.prisma.patient.findUnique({ where: { id: patientId } });
    if (!patient) throw new NotFoundException('Patient not found');

    // 트랜잭션으로 병상 점유 + 입원 + 주치의/병상 이력을 원자적으로 (동시 배정 방지 + /inpatient/admit와 데이터 정합)
    const admission = await this.prisma.$transaction(async (tx) => {
      // 환자 단위 advisory lock — 재원 중복 체크를 락 안에서(동시 이중입원 race 제거·/inpatient/admit 정합)
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`admit:${patientId}`}))`;
      const active = await tx.admission.findFirst({ where: { patientId, status: AdmissionStatus.ADMITTED }, select: { id: true } });
      if (active) throw new ConflictException('이미 재원 중인 환자입니다.');

      // 비관적 잠금: updateMany로 AVAILABLE/RESERVED 상태인 경우만 OCCUPIED 전환
      const updated = await tx.bed.updateMany({
        where: { id: bedId, status: { in: [BedStatus.AVAILABLE, BedStatus.RESERVED] } },
        data: { status: BedStatus.OCCUPIED },
      });

      if (updated.count === 0) {
        const bed = await tx.bed.findUnique({ where: { id: bedId } });
        if (!bed) throw new NotFoundException('Bed not found');
        throw new ConflictException(`병상이 이미 사용 중입니다 (${bed.status}). 다른 병상을 선택하세요.`);
      }

      const admission = await tx.admission.create({
        data: {
          patientId,
          bedId,
          admittingDoctorId,
          attendingDoctorId: admittingDoctorId, // 주치의 초기값 — getAttending/census 정합(누락 시 null 되던 것)
          admitDate: new Date(admitDate),
          admitReason: admitReason || null,
          dietType: dietType || null,
          status: AdmissionStatus.ADMITTED,
        },
        include: {
          patient: { select: { id: true, mrn: true, familyName: true, givenName: true } },
          bed: { include: { ward: { select: { name: true } } } },
        },
      });
      // 주치의(ChargeOfCare)·병상 이력(BedAssignment) — /inpatient/admit 정합(census attendingDoctor·bedHistory 채움)
      await tx.chargeOfCare.create({ data: { admissionId: admission.id, doctorId: admittingDoctorId, assignedAt: new Date() } });
      await tx.bedAssignment.create({ data: { admissionId: admission.id, bedId, assignedAt: new Date(), reason: 'ADMISSION' } });

      return admission;
    });
    // 여정 프로토콜(IPD) 자동 생성 트리거(부작용 — 리스너가 인스턴스 보장)
    this.eventEmitter?.emit('admission.created', { admissionId: admission.id, patientId: admission.patientId }); // 정본 이벤트 — /inpatient/admit 도 같은 것을 emit 한다
    // 여정 타임라인 ADMISSION (구 경로는 누락됐던 것 — /inpatient/admit 정합)
    this.journey?.emit({
      patientId, eventType: 'ADMISSION',
      title: `입원 (${admission.bed?.ward?.name ?? ''})`, department: admission.bed?.ward?.name ?? undefined,
      doctorId: admittingDoctorId, refType: 'ADMISSION', refId: admission.id, navUrl: `/inpatient/${admission.id}`,
      // 여정 P1: 입원 시각은 직원이 입력한 값이다(날짜만 주면 하루 정밀도)
      occurredAt: admission.admitDate, occurredAtSource: 'USER_CLAIMED',
      occurredAtPrecision: /^\d{4}-\d{2}-\d{2}$/.test(admitDate) ? 'DAY' : 'MINUTE',
    });
    return admission;
  }

  /** 퇴원 — 정본은 InpatientService.discharge(트랜잭션+ChargeOfCare/BedAssignment 종료+여정 DISCHARGE)로 위임.
   *  두 엔드포인트(admissions/:id/discharge·inpatient/:id/discharge)가 동일 구현을 공유(이중화 해소). */
  async discharge(admissionId: string, dischargeDate: string, dischargeSummary?: string) {
    if (!this.inpatient) throw new ConflictException('퇴원 처리 서비스를 사용할 수 없습니다.');
    return this.inpatient.discharge(admissionId, dischargeSummary ?? '', undefined, new Date(dischargeDate));
  }

  /** 전과 — 담당의(ATTENDING) 변경 정식 기록 (2026-07 전체검토 B-5). 기존 ChargeOfCare release + 신규 assign + 여정 이벤트 */
  async transferCare(admissionId: string, dto: TransferCareDto, userId?: string) {
    const admission = await this.prisma.admission.findUnique({
      where: { id: admissionId },
      select: { id: true, patientId: true, status: true },
    });
    if (!admission) throw new NotFoundException('입원 기록을 찾을 수 없습니다');
    if (admission.status !== 'ADMITTED') throw new ConflictException('재원 중인 입원만 전과할 수 있습니다');
    const newDoctor = await this.prisma.user.findUnique({ where: { id: dto.newDoctorId }, select: { id: true, role: true, familyName: true, givenName: true, department: true } });
    if (!newDoctor || newDoctor.role !== 'DOCTOR') throw new BadRequestException('전과 대상 의사가 유효하지 않습니다');
    if (!dto.reason?.trim()) throw new BadRequestException('전과 사유가 필요합니다');

    const result = await this.prisma.$transaction(async (tx) => {
      const current = await tx.chargeOfCare.findFirst({
        where: { admissionId, role: 'ATTENDING', releasedAt: null },
        orderBy: { assignedAt: 'desc' },
      });
      if (current?.doctorId === dto.newDoctorId) throw new ConflictException('이미 해당 의사가 담당 중입니다');
      if (current) {
        await tx.chargeOfCare.update({ where: { id: current.id }, data: { releasedAt: new Date(), reason: `[전과] ${dto.reason.trim()}`.slice(0, 200) } });
      }
      return tx.chargeOfCare.create({
        data: {
          admissionId, doctorId: dto.newDoctorId, role: 'ATTENDING', assignedAt: new Date(),
          reason: dto.reason.trim().slice(0, 200), handoffNote: dto.handoffNote?.trim() || null, assignedBy: userId ?? null,
        },
        include: { doctor: { select: { familyName: true, givenName: true, department: true } } },
      });
    });
    this.journey?.emit({
      patientId: admission.patientId, eventType: 'TRANSFER_CARE',
      title: `전과 — ${result.doctor?.familyName ?? ''}${result.doctor?.givenName ?? ''}${result.doctor?.department ? ` (${result.doctor.department})` : ''}`,
      doctorId: dto.newDoctorId, refType: 'CHARGE_OF_CARE', refId: result.id, navUrl: `/inpatient/${admissionId}`,
      episode: { type: 'Admission', id: admissionId }, // 여정 P1: 원 기록은 주치의 이력 — 방문 단위는 입원
      occurredAt: result.assignedAt,
    });
    return result;
  }

  async transferBed(admissionId: string, newBedId: string, reason?: string) {
    const admission = await this.prisma.admission.findUnique({
      where: { id: admissionId },
      include: { bed: true },
    });
    if (!admission) throw new NotFoundException('Admission not found');

    if (admission.status !== AdmissionStatus.ADMITTED) {
      throw new ConflictException(`Cannot transfer bed for admission with status ${admission.status}`);
    }

    const newBed = await this.prisma.bed.findUnique({ where: { id: newBedId } });
    if (!newBed) throw new NotFoundException('New bed not found');

    // 전실(4쓰기: 신병상 점유·배정기록·입원 bedId·구병상 반납)을 원자적으로 —
    // 부분 실패 시 병상 desync(이중배정/누수) 방지. 신병상 점유는 비관적 잠금(updateMany)으로 경쟁 차단.
    // 🔴 (2026-09-30) 종전엔 이 경로가 **이전 배정 이력을 닫지 않고** 새 배정만 만들어, 한 입원에 활성 배정이 둘 남았다.
    //    전실 트랜잭션 정본 `transferBedInTx` 하나로(입원 화면 전실·PACU 퇴실 → 다른 병상도 같은 함수) · 공개 계약(409)은 유지.
    return this.prisma.$transaction((tx) => transferBedInTx(tx, admission, newBedId, reason || null, new Date(),
      () => new ConflictException('New bed is not available. Cannot transfer')));
  }

  async getDetail(admissionId: string) {
    const admission = await this.prisma.admission.findUnique({
      where: { id: admissionId },
      include: {
        patient: { select: { id: true, mrn: true, familyName: true, givenName: true } },
        bed: { select: { id: true, roomNumber: true, bedNumber: true, ward: { select: { name: true } } } },
      },
    });

    if (!admission) throw new NotFoundException('Admission not found');
    return admission;
  }

  async getPatientAdmissions(patientId: string) {
    return this.prisma.admission.findMany({
      where: { patientId },
      orderBy: { admitDate: 'desc' },
      include: {
        bed: { select: { roomNumber: true, bedNumber: true, ward: { select: { name: true } } } },
      },
    });
  }

  async getActiveAdmissions(wardId?: string, attendingDoctorId?: string) {
    const where: Prisma.AdmissionWhereInput = { status: AdmissionStatus.ADMITTED };
    if (wardId) {
      where.bed = { wardId };
    }
    // 주치의 화면은 **자기 환자만** 봐야 한다 — 종전엔 이 필터가 없어 전원이 나왔다
    if (attendingDoctorId) {
      where.attendingDoctorId = attendingDoctorId;
    }

    const admissions = await this.prisma.admission.findMany({
      where,
      orderBy: { admitDate: 'asc' },
      include: {
        patient: {
          select: { id: true, mrn: true, familyName: true, givenName: true, gender: true, dateOfBirth: true },
        },
        bed: {
          select: { id: true, roomNumber: true, bedNumber: true, ward: { select: { id: true, name: true } } },
        },
        attendingDoctor: {
          select: { id: true, familyName: true, givenName: true, department: true },
        },
        nursingAssessments: {
          orderBy: { assessedAt: 'desc' },
          take: 1,
          select: {
            fallRiskAssessment: { select: { riskLevel: true, score: true } },
            bradenScore: true,
          },
        },
        encounters: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: {
            diagnoses: {
              where: { type: 'PRIMARY' },
              take: 1,
              select: {
                diagnosisCode: { select: { code: true, nameKo: true, nameEn: true } },
              },
            },
          },
        },
        // Phase 3: 간호 기록 최신 시간
        nursingNotes: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { createdAt: true },
        },
      },
    });

    // Phase 3: patientId 기반 추가 데이터 batch 조회
    const patientIds = admissions.map(a => a.patientId);

    // 🔴 (2026-09-30) 간호 스테이션 보드와 같은 정의로(같은 사실에 정본이 둘이면 갈라진다):
    //   투약 대기 = **오늘 간호일** 예정(종전: 전 기간 SCHEDULED) · 지난 미처리는 따로(carriedOver) ·
    //   낙상 = 환자의 **최신 낙상위험평가**(종전: 최신 간호초기평가에 딸린 것 — 재평가가 반영되지 않았다)
    const today = nursingDayWindowOrToday();
    const [latestVitals, pendingMeds, carriedMeds, fallRows] = await Promise.all([
      // 최근 VS 기록 시간 — 🔴 (2026-10-10) 종전 외래 원장만 봐서 플로시트·워크스테이션에서 잰 활력이 "기록 없음"이었고,
      //   입원 전 외래 측정이 '최근 VS'로 보였다 → 입원 활력 읽기 정본(두 원장 · 이번 재원 안)
      this.admissionVitals.latestByAdmission(admissions).then((m) => [...m.values()].map((v) => ({ patientId: v.patientId, measuredAt: v.at }))),
      // 오늘 간호일 투약 대기(SCHEDULED)
      this.prisma.medicationAdministration.groupBy({
        by: ['patientId'],
        where: { patientId: { in: patientIds }, status: 'SCHEDULED', scheduledAt: today },
        _count: { id: true },
      }),
      // 지난 날짜에서 넘어온 미처리(최근 7일)
      //   이번 입원 안으로만 센다(입원일 이전 미처리 = 지난 입원 것 — MAR 화면의 carriedOver 와 같은 규칙)
      this.prisma.medicationAdministration.findMany({
        where: { patientId: { in: patientIds }, status: 'SCHEDULED', scheduledAt: { gte: new Date(today.gte.getTime() - NursingService.CARRY_OVER_DAYS * 86_400_000), lt: today.gte } },
        select: { patientId: true, scheduledAt: true },
        take: 5000,
      }),
      patientIds.length
        ? this.prisma.fallRiskAssessment.findMany({
            where: { patientId: { in: patientIds } }, orderBy: { assessedAt: 'desc' }, distinct: ['patientId'],
            select: { patientId: true, riskLevel: true, score: true, assessedAt: true },
          })
        : Promise.resolve([] as { patientId: string; riskLevel: string; score: number; assessedAt: Date }[]),
    ]);
    const admitByPatient = new Map(admissions.map((a) => [a.patientId, a.admitDate]));
    const carriedMap = new Map<string, number>();
    for (const m of carriedMeds) {
      const since = admitByPatient.get(m.patientId);
      if (since && m.scheduledAt < since) continue;
      carriedMap.set(m.patientId, (carriedMap.get(m.patientId) ?? 0) + 1);
    }
    const fallByPatient = new Map(fallRows.map((f) => [f.patientId, f]));

    const vitalsMap = new Map(latestVitals.map(v => [v.patientId, v.measuredAt]));
    const medCountMap = new Map(pendingMeds.map(m => [m.patientId, m._count.id]));

    // 활성 식이처방(영양팀 정본)을 환자별로 모은다
    const dietPatientIds = [...new Set(admissions.map((a) => a.patientId))];
    const dietOrders = dietPatientIds.length
      ? await this.prisma.dietOrder.findMany({
          where: { patientId: { in: dietPatientIds }, isActive: true },
          orderBy: { createdAt: 'desc' },
          select: { patientId: true, dietType: true },
        })
      : [];
    const dietByPatient = new Map<string, { dietType: string }>();
    for (const d of dietOrders) if (!dietByPatient.has(d.patientId)) dietByPatient.set(d.patientId, { dietType: d.dietType });

    // flatten for frontend convenience
    return admissions.map((adm) => {
      const na = adm.nursingAssessments?.[0] ?? null;
      const enc = adm.encounters?.[0] ?? null;
      const dx = enc?.diagnoses?.[0] ?? null;

      return {
        id: adm.id,
        patientId: adm.patientId,
        bedId: adm.bedId,
        admitDate: adm.admitDate,
        admitReason: adm.admitReason,
        status: adm.status,
        patient: adm.patient,
        // 🔴 **환자의 식이가 두 곳에 따로 있다.** `admissions.dietType`(입원 시 지정)과
        //    `diet_orders`(영양팀 식이처방)가 연결돼 있지 않아, 고단백식 처방을 받은 환자가
        //    입원 목록에서는 식이 `-` 로 보였다(2026-08-12 실측·최순자).
        //    **임상 정본은 활성 식이처방**이다 — 입원 시 지정은 초기값일 뿐이다.
        dietType: dietByPatient.get(adm.patientId)?.dietType ?? adm.dietType ?? null,
        dietSource: dietByPatient.has(adm.patientId) ? 'ORDER' : adm.dietType ? 'ADMISSION' : null,
        bed: adm.bed
          ? { id: adm.bed.id, roomNumber: adm.bed.roomNumber, bedLabel: adm.bed.bedNumber, ward: adm.bed.ward }
          : null,
        attendingDoctor: adm.attendingDoctor,
        // 입원 일수 — 정본 stayDays(보드와 같은 규칙 · 입원 당일 = 1일차)
        stayDays: stayDays(adm.admitDate),
        nursingAssessment: na || fallByPatient.has(adm.patientId)
          ? {
              fallRiskLevel: fallByPatient.get(adm.patientId)?.riskLevel ?? na?.fallRiskAssessment?.riskLevel ?? 'NONE',
              fallRiskAssessedAt: fallByPatient.get(adm.patientId)?.assessedAt ?? null,
              // 🔴 (2026-09-21 H) 종전 `?? 0` — 낙상위험평가가 **없는** 환자를 Morse **0점**
              //    (= 가장 안전한 점수)으로 말했다. 등급 쪽은 이미 `NONE` 을 "미평가"로 읽도록
              //    간호스테이션이 회색 처리해 뒀는데(2026-08-20), 점수만 0 으로 남아 있었다 —
              //    같은 사실을 한 응답 안에서 둘로 말한 자리다. 미평가는 `null`(산출 불가)이다.
              fallRiskScore: fallByPatient.get(adm.patientId)?.score ?? na?.fallRiskAssessment?.score ?? null,
              // 🔴 (2026-09-30) Braden 이 없으면 'LOW' 였다 — 미평가를 저위험으로 말하지 않는다(null = 미평가)
              // 2026-10-10 등급은 shared 정본 — 6~23 밖 점수는 등급을 지어내지 않는다(null)
              pressureUlcerRisk: bradenRiskLevel(na?.bradenScore),
              bradenScore: na?.bradenScore ?? null,
            }
          : null,
        primaryDiagnosis: dx?.diagnosisCode ?? null,
        lastVitalsAt: vitalsMap.get(adm.patientId) ?? null,
        lastNursingNoteAt: adm.nursingNotes?.[0]?.createdAt ?? null,
        pendingMedCount: medCountMap.get(adm.patientId) ?? 0,
        carriedOverMedCount: carriedMap.get(adm.patientId) ?? 0,
      };
    });
  }

  async updateAdmission(admissionId: string, dietType?: string, attendingDoctorId?: string) {
    const admission = await this.prisma.admission.findUnique({ where: { id: admissionId } });
    if (!admission) throw new NotFoundException('Admission not found');

    const updateData: Prisma.AdmissionUncheckedUpdateInput = {};
    if (dietType) updateData.dietType = dietType;
    if (attendingDoctorId) updateData.attendingDoctorId = attendingDoctorId;

    if (Object.keys(updateData).length === 0) {
      throw new BadRequestException('No update data provided');
    }

    return this.prisma.admission.update({
      where: { id: admissionId },
      data: updateData,
      include: { patient: { omit: PATIENT_SENSITIVE_OMIT }, bed: true },
    });
  }
}
