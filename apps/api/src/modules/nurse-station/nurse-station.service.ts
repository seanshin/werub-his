import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { takeOverInTx } from './take-over';
import { PATIENT_SENSITIVE_OMIT } from '../../common/patient-select';
import { roundBy } from '@hospital-run/shared';

import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { NotificationService } from '../notification/notification.service';
import { PatientSafetyService } from '../patient-safety/patient-safety.service';
import { VitalsService } from '../vitals/vitals.service';
import { vitalItemFlags } from '../vitals/vitals-evaluate';
import { RecordVitalsDto } from './dto/nurse-station.dto';

@Injectable()
export class NurseStationService {
  private readonly logger = new Logger(NurseStationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationService: NotificationService,
    private readonly safetyService: PatientSafetyService,
    private readonly eventEmitter: EventEmitter2,
    private readonly vitalsService: VitalsService, // 활력 쓰기 정본
  ) {}

  /**
   * 간호사가 담당하는 의사들의 대기 환자 목록 조회
   */
  async getQueue(nurseId: string) {
    // 1. 간호사의 활성 케어팀에서 담당 의사 ID 목록 조회
    const careTeams = await this.prisma.careTeam.findMany({
      where: { nurseId, isActive: true },
      select: { doctorId: true, departmentName: true },
    });

    if (careTeams.length === 0) {
      return [];
    }

    const doctorIds = careTeams.map((ct) => ct.doctorId);

    // 2. 오늘 해당 의사들의 대기열 조회
    const todayStart = this.getTodayStart();
    return this.prisma.waitingQueue.findMany({
      where: {
        doctorId: { in: doctorIds },
        checkedInAt: { gte: todayStart },
        status: { in: ['WAITING', 'CALLED', 'IN_CONSULTATION'] },
      },
      include: {
        patient: {
          select: { id: true, mrn: true, familyName: true, givenName: true, dateOfBirth: true, gender: true },
        },
        doctor: { select: { id: true, familyName: true, givenName: true } },
      },
      orderBy: [{ status: 'asc' }, { queueNumber: 'asc' }],
    });
  }

  /**
   * 특정 대기열 항목의 간호 업무 목록 조회
   */
  async getTasks(queueId: string) {
    return this.prisma.nurseTask.findMany({
      where: { queueId },
      include: {
        patient: { select: { id: true, mrn: true, familyName: true, givenName: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  /**
   * 진료 전 간호 업무 자동 생성
   */
  async generateTasks(queueId: string, nurseId: string) {
    const queue = await this.prisma.waitingQueue.findUnique({
      where: { id: queueId },
      include: { patient: { omit: PATIENT_SENSITIVE_OMIT } },
    });
    if (!queue) throw new NotFoundException('대기열 항목을 찾을 수 없습니다.');

    // 이미 생성된 PRE_VISIT 태스크가 있으면 중복 방지
    const existing = await this.prisma.nurseTask.findFirst({
      where: { queueId, phase: 'PRE_VISIT' },
    });
    if (existing) {
      return this.getTasks(queueId);
    }

    const baseTasks = [
      { taskType: 'VITALS', phase: 'PRE_VISIT' },
      { taskType: 'ALLERGY_CHECK', phase: 'PRE_VISIT' },
      { taskType: 'READY_NOTIFY', phase: 'PRE_VISIT' },
    ];

    // 문진표 제출 여부 확인
    const questionnaire = await this.prisma.questionnaireToken.findFirst({
      where: {
        patientId: queue.patientId,
        status: 'COMPLETED',
      },
    });
    if (questionnaire) {
      baseTasks.push({ taskType: 'QUESTIONNAIRE_REVIEW', phase: 'PRE_VISIT' });
    }

    // 시술 예약 확인 (오늘 해당 환자의 수술/시술 여부)
    const todayStart = this.getTodayStart();
    const todayEnd = new Date(todayStart);
    todayEnd.setDate(todayEnd.getDate() + 1);
    const surgery = await this.prisma.surgery.findFirst({
      where: {
        patientId: queue.patientId,
        scheduledAt: { gte: todayStart, lt: todayEnd },
        status: { not: 'CANCELLED' },
      },
    });
    if (surgery) {
      baseTasks.push({ taskType: 'CONSENT_PREP', phase: 'PRE_VISIT' });
    }

    await this.prisma.nurseTask.createMany({
      data: baseTasks.map((t) => ({
        queueId,
        patientId: queue.patientId,
        nurseId,
        phase: t.phase,
        taskType: t.taskType,
        status: 'PENDING',
      })),
    });

    return this.getTasks(queueId);
  }

  /**
   * 업무 완료 처리
   */
  async completeTask(taskId: string) {
    const task = await this.prisma.nurseTask.findUnique({ where: { id: taskId } });
    if (!task) throw new NotFoundException('업무를 찾을 수 없습니다.');
    if (task.status === 'COMPLETED') throw new BadRequestException('이미 완료된 업무입니다.');

    return this.prisma.nurseTask.update({
      where: { id: taskId },
      data: { status: 'COMPLETED', completedAt: new Date() },
    });
  }

  /**
   * 업무 건너뛰기
   */
  async skipTask(taskId: string, reason: string) {
    const task = await this.prisma.nurseTask.findUnique({ where: { id: taskId } });
    if (!task) throw new NotFoundException('업무를 찾을 수 없습니다.');

    return this.prisma.nurseTask.update({
      where: { id: taskId },
      data: { status: 'SKIPPED', notes: reason, completedAt: new Date() },
    });
  }

  /**
   * 오늘의 간호 업무 통계
   */
  async getStats(nurseId: string) {
    const todayStart = this.getTodayStart();

    const [pending, completed, total] = await Promise.all([
      this.prisma.nurseTask.count({
        where: { nurseId, status: 'PENDING', createdAt: { gte: todayStart } },
      }),
      this.prisma.nurseTask.count({
        where: { nurseId, status: 'COMPLETED', createdAt: { gte: todayStart } },
      }),
      this.prisma.nurseTask.count({
        where: { nurseId, createdAt: { gte: todayStart } },
      }),
    ]);

    return { pending, completed, total, skipped: total - pending - completed };
  }

  /**
   * 대기열 문맥 활력 기록 — **정본(VitalsService.record)에 위임**(2026-07-30 통합).
   * 종전엔 여기에만 BMI·이상치·이벤트·태스크완료·알림·NEWS2 가 붙어 있어 다른 쓰기 경로가 반쪽이었음.
   */
  async recordVitals(queueId: string, dto: RecordVitalsDto, nurseId: string) {
    const queue = await this.prisma.waitingQueue.findUnique({
      where: { id: queueId },
    });
    if (!queue) throw new NotFoundException('대기열 항목을 찾을 수 없습니다.');

    return this.vitalsService.record({
      patientId: dto.patientId,
      encounterId: queue.encounterId ?? undefined,
      queueId,
      // 활력 저장 정규화 — 수치 정책 정본(roundBy) 경유(number|undefined 필드라 ?? undefined)
      systolicBp: roundBy(dto.systolicBp, 'systolicBp') ?? undefined,
      diastolicBp: roundBy(dto.diastolicBp, 'diastolicBp') ?? undefined,
      heartRate: roundBy(dto.heartRate, 'heartRate') ?? undefined,
      temperature: roundBy(dto.temperature, 'temperature') ?? undefined,
      spo2: roundBy(dto.spo2, 'spo2') ?? undefined,
      respiratoryRate: roundBy(dto.respiratoryRate, 'respiratoryRate') ?? undefined,
      weight: roundBy(dto.weight, 'weight') ?? undefined,
      height: roundBy(dto.height, 'height') ?? undefined,
      painScore: dto.painScore,
      notes: dto.notes,
    }, nurseId);
  }


  /**
   * 대기열 항목의 바이탈 사인 조회
   */
  async getVitals(queueId: string) {
    const rows = await this.prisma.preVisitVitals.findMany({
      where: { queueId },
      orderBy: { measuredAt: 'desc' },
    });
    return rows.map((r) => this.serializeVitals(r as unknown as Record<string, unknown>));
  }

  /**
   * 진료 후 간호 업무 자동 생성
   */
  async generatePostVisitTasks(encounterId: string, nurseId: string) {
    const encounter = await this.prisma.encounter.findUnique({
      where: { id: encounterId },
      include: {
        prescriptions: true,
        diagnoses: true,
      },
    });
    if (!encounter) throw new NotFoundException('진료 기록을 찾을 수 없습니다.');

    // 이미 생성된 POST_VISIT 태스크가 있으면 중복 방지
    const existing = await this.prisma.nurseTask.findFirst({
      where: { encounterId, phase: 'POST_VISIT' },
    });
    if (existing) {
      return this.prisma.nurseTask.findMany({
        where: { encounterId },
        orderBy: { createdAt: 'asc' },
      });
    }

    const tasks: { taskType: string; phase: string }[] = [];

    // 처방이 있으면 처방 안내 업무
    if (encounter.prescriptions && encounter.prescriptions.length > 0) {
      tasks.push({ taskType: 'PRESCRIPTION_GUIDE', phase: 'POST_VISIT' });
    }

    // 진단이 있으면 질환 교육 업무
    if (encounter.diagnoses && encounter.diagnoses.length > 0) {
      tasks.push({ taskType: 'DISEASE_EDUCATION', phase: 'POST_VISIT' });
    }

    // 다음 예약 안내는 항상
    tasks.push({ taskType: 'NEXT_APPOINTMENT_GUIDE', phase: 'POST_VISIT' });
    // 수납 안내도 항상
    tasks.push({ taskType: 'BILLING_GUIDE', phase: 'POST_VISIT' });

    if (tasks.length > 0) {
      await this.prisma.nurseTask.createMany({
        data: tasks.map((t) => ({
          encounterId,
          patientId: encounter.patientId,
          nurseId,
          phase: t.phase,
          taskType: t.taskType,
          status: 'PENDING',
        })),
      });
    }

    return this.prisma.nurseTask.findMany({
      where: { encounterId },
      orderBy: { createdAt: 'asc' },
    });
  }

  /**
   * 진료 후 업무 목록 조회
   */
  async getPostVisitTasksByEncounter(encounterId: string) {
    return this.prisma.nurseTask.findMany({
      where: { encounterId, phase: 'POST_VISIT' },
      include: {
        patient: { select: { id: true, mrn: true, familyName: true, givenName: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  // Prisma Decimal → number (프론트 직접 렌더 시 React #31 방지)
  private serializeVitals<T extends Record<string, unknown>>(v: T): T {
    const num = (x: unknown) => (x == null ? x : Number(x));
    return { ...v, temperature: num(v.temperature), weight: num(v.weight), height: num(v.height), bmi: num(v.bmi) } as T;
  }

  /**
   * 환자별 바이탈 사인 이력 조회
   */
  async getVitalsByPatient(patientId: string) {
    return (await this.getVitalsByPatientWithRule(patientId)).rows;
  }

  /**
   * 환자별 활력 + 항목별 이상 표시(`flags`) + 적용 임계의 출처(2026-10-01).
   * 🔴 간호 스테이션이 임계 숫자를 화면에 따로 적어(SBP>140·HR>100…) 환자안전위가 `clinical.vitals.thresholds` 를
   *    개정해도 그 화면만 옛 기준이었다 — 판정은 서버 정본(`vitals-evaluate`)으로 하고 화면은 그것을 그린다.
   */
  async getVitalsByPatientWithRule(patientId: string) {
    const [rows, rule] = await Promise.all([
      // 🔴 (2026-10-10) 외래 원장만 읽어 입원 중 플로시트 활력이 차트 바이탈 탭에 없었다 — 두 원장 합침(행마다 ledger)
      this.vitalsService.listRecent(patientId, 50),
      this.vitalsService.effectiveThresholds(),
    ]);
    // PreVisitVitals에는 nurse 관계가 없음(nurseId 스칼라) → 배치 조회로 nurseName 부착 (차트 바이탈 탭 표시)
    const nurseIds = Array.from(new Set(rows.map((r) => r.nurseId).filter(Boolean)));
    const nurses = nurseIds.length
      ? await this.prisma.user.findMany({ where: { id: { in: nurseIds } }, select: { id: true, familyName: true, givenName: true } })
      : [];
    const nameById = new Map(nurses.map((n) => [n.id, `${n.familyName ?? ''}${n.givenName ?? ''}`.trim()]));
    const out = rows.map((r) => {
      const sv = this.serializeVitals(r as unknown as Record<string, unknown>);
      const v = sv as unknown as Record<string, number | null | undefined>;
      return {
        ...sv,
        nurseName: nameById.get(r.nurseId) ?? null,
        flags: vitalItemFlags({
          systolicBp: v.systolicBp, diastolicBp: v.diastolicBp, heartRate: v.heartRate, temperature: v.temperature,
          spo2: v.spo2, respiratoryRate: v.respiratoryRate, painScore: v.painScore,
        }, rule.thresholds),
      };
    });
    return {
      rows: out,
      rule: { source: rule.source, droppedKeys: rule.droppedKeys, invertedKeys: rule.invertedKeys, thresholds: rule.thresholds },
    };
  }

  /**
   * Vitals → Encounter 자동 연결 (Phase 4)
   * 대기열에서 진료 시작 시, 기존 PreVisitVitals를 encounter에 연결
   */
  async linkVitalsToEncounter(queueId: string, encounterId: string) {
    const updated = await this.prisma.preVisitVitals.updateMany({
      where: { queueId, encounterId: null },
      data: { encounterId },
    });
    if (updated.count > 0) {
      this.logger.log(`Linked ${updated.count} vitals record(s) to encounter ${encounterId}`);
    }
  }

  /**
   * 진료과별 간호 업무 생성 (Phase 5)
   */
  async generateDepartmentTasks(queueId: string, nurseId: string, department: string) {
    const deptTasks: Record<string, { taskType: string; phase: string }[]> = {
      '안과': [{ taskType: 'VISUAL_ACUITY', phase: 'PRE_VISIT' }, { taskType: 'IOP_CHECK', phase: 'PRE_VISIT' }],
      '이비인후과': [{ taskType: 'HEARING_TEST', phase: 'PRE_VISIT' }],
      '피부과': [{ taskType: 'PHOTO_RECORD', phase: 'PRE_VISIT' }],
      '소아청소년과': [{ taskType: 'GROWTH_MEASURE', phase: 'PRE_VISIT' }],
      '산부인과': [{ taskType: 'URINE_TEST', phase: 'PRE_VISIT' }, { taskType: 'WEIGHT_CHECK', phase: 'PRE_VISIT' }],
      '내과': [{ taskType: 'BLOOD_SUGAR', phase: 'PRE_VISIT' }],
      '정형외과': [{ taskType: 'XRAY_CONFIRM', phase: 'PRE_VISIT' }],
    };

    const extras = deptTasks[department] || [];
    if (extras.length === 0) return;

    const queue = await this.prisma.waitingQueue.findUnique({ where: { id: queueId } });
    if (!queue) return;

    await this.prisma.nurseTask.createMany({
      data: extras.map((t) => ({
        queueId,
        patientId: queue.patientId,
        nurseId,
        phase: t.phase,
        taskType: t.taskType,
        status: 'PENDING',
      })),
    });

    this.logger.log(`Department tasks (${department}) created for queue ${queueId}`);
  }

  /**
   * 진료 후 환자 교육 기록 (Phase 6)
   */
  async recordEducation(
    encounterId: string,
    nurseId: string,
    data: { topic: string; content: string; materials?: string },
  ) {
    const encounter = await this.prisma.encounter.findUnique({
      where: { id: encounterId },
      select: { patientId: true },
    });
    if (!encounter) throw new NotFoundException('진료 기록을 찾을 수 없습니다.');

    return this.prisma.universalNursingNote.create({
      data: {
        patientId: encounter.patientId,
        nurseId,
        contextType: 'OUTPATIENT',
        contextId: encounterId,
        noteType: 'EDUCATION',
        content: `[${data.topic}] ${data.content}${data.materials ? '\n교육 자료: ' + data.materials : ''}`,
        recordedAt: new Date(),
      },
    });
  }

  /**
   * #17 처방 설명 가이드(기획 outpatient-nurse-workflow §4 — 진료 후 간호사가 환자에게 약을 설명할 때 보는 자료).
   *
   * 🔴 **파생만 한다** — 처방 정본(Prescription)의 용량·빈도·일수·경로·처방의 지시와, 약품 마스터(MedicationCode)의
   *    성분·제형·보관·고위험·마약류·임부 분류를 **있는 값 그대로** 싣는다. 용법·주의 문구를 만들지 않는다.
   *    마스터에 연결되지 않은 처방은 `medication: null`(화면은 "마스터 미등록"). 기획서가 말한 AI 교육자료
   *    (`POST /ai/patient-education`)는 이 조회가 부르지 않는다 — AI 초안은 별도 동작이며 사람이 요청해야 한다.
   * 취소된 처방은 뺀다. 200건을 넘으면 잘랐다고 말한다.
   */
  static readonly RX_GUIDE_LIMIT = 200;

  async getRxGuide(encounterId: string) {
    const encounter = await this.prisma.encounter.findUnique({
      where: { id: encounterId },
      select: { id: true, patientId: true, status: true },
    });
    if (!encounter) throw new NotFoundException('Encounter not found');
    const rows = await this.prisma.prescription.findMany({
      // 복약 설명은 지금 먹는 약 — 취소·중단(2026-09-30) 모두 뺀다(중단된 약을 설명하면 계속 먹으라는 말이 된다)
      where: { encounterId, type: 'MEDICATION', status: 'ACTIVE' },
      orderBy: { createdAt: 'asc' },
      take: NurseStationService.RX_GUIDE_LIMIT + 1,
      select: {
        id: true, dosage: true, frequency: true, duration: true, quantity: true, route: true,
        instructions: true, priority: true, dispensingType: true, createdAt: true,
        medicationCode: {
          select: {
            code: true, nameKo: true, nameEn: true, ingredient: true, dosageForm: true, unit: true,
            storageCondition: true, highAlertFlag: true, highAlertCategory: true,
            controlSchedule: true, narcoticType: true, pregnancyCategory: true, lasaGroup: true, isActive: true,
          },
        },
      },
    });
    const truncated = rows.length > NurseStationService.RX_GUIDE_LIMIT;
    const items = rows.slice(0, NurseStationService.RX_GUIDE_LIMIT).map((r) => ({
      prescriptionId: r.id,
      order: {
        dosage: r.dosage, frequency: r.frequency, durationDays: r.duration, quantity: r.quantity, route: r.route,
        prescriberInstructions: r.instructions, priority: r.priority, dispensingType: r.dispensingType, createdAt: r.createdAt,
      },
      medication: r.medicationCode
        ? {
            code: r.medicationCode.code, nameKo: r.medicationCode.nameKo, nameEn: r.medicationCode.nameEn,
            ingredient: r.medicationCode.ingredient, dosageForm: r.medicationCode.dosageForm, unit: r.medicationCode.unit,
            storageCondition: r.medicationCode.storageCondition,
            highAlert: r.medicationCode.highAlertFlag, highAlertCategory: r.medicationCode.highAlertCategory,
            controlSchedule: r.medicationCode.controlSchedule, narcoticType: r.medicationCode.narcoticType,
            pregnancyCategory: r.medicationCode.pregnancyCategory, lasaGroup: r.medicationCode.lasaGroup,
            masterActive: r.medicationCode.isActive,
          }
        : null,
    }));
    return { encounterId: encounter.id, patientId: encounter.patientId, truncated, limit: NurseStationService.RX_GUIDE_LIMIT, items, source: 'PRESCRIPTION_AND_MASTER' as const };
  }

  private getTodayStart(): Date {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }

  // ── 담당환자 배정 ──

  async getMyAssignments(nurseId: string) {
    // 🔴 (2026-09-30) 재원 중인 입원만 — 종전엔 퇴원 환자의 남은 배정까지 "내 담당 N"에 셌다(해제 경로가 수동 버튼뿐이었다)
    return this.prisma.nursePatientAssignment.findMany({
      where: { nurseId, releasedAt: null, admission: { status: 'ADMITTED' } },
      include: {
        admission: {
          include: {
            patient: { select: { id: true, mrn: true, familyName: true, givenName: true } },
            bed: { select: { roomNumber: true, bedNumber: true, ward: { select: { id: true, name: true } } } },
          },
        },
      },
      orderBy: { assignedAt: 'desc' },
    });
  }

  async getAssignmentsByAdmission(admissionId: string) {
    return this.prisma.nursePatientAssignment.findMany({
      where: { admissionId, releasedAt: null },
      include: {
        nurse: { select: { id: true, familyName: true, givenName: true, department: true } },
      },
    });
  }

  /**
   * 담당환자 배정.
   * 🔴 (2026-09-30) 종전엔 같은 간호사·같은 입원을 누를 때마다 활성 배정이 한 줄씩 쌓였고(화면 "내 담당 N"이 부풀었다),
   *    퇴원한 입원에도 배정할 수 있었다. 이미 활성이면 그 배정을 그대로 돌려준다(멱등) · 재원 중인 입원만.
   */
  async assignPatient(data: { nurseId: string; admissionId: string; shiftType?: string; isPrimary?: boolean; assignedBy: string }) {
    const adm = await this.prisma.admission.findUnique({ where: { id: data.admissionId }, select: { status: true } });
    if (!adm) throw new NotFoundException({ code: 'ADMISSION_NOT_FOUND', message: 'Admission not found' });
    if (adm.status !== 'ADMITTED') throw new BadRequestException({ code: 'ADMISSION_NOT_ACTIVE', message: 'Only admitted patients can be assigned' });
    const include = {
      admission: { include: { patient: { select: { familyName: true, givenName: true } } } },
      nurse: { select: { familyName: true, givenName: true } },
    } as const;
    const existing = await this.prisma.nursePatientAssignment.findFirst({
      where: { nurseId: data.nurseId, admissionId: data.admissionId, releasedAt: null }, include,
    });
    if (existing) return existing;
    // 🔴 (2026-10-07) 배정 대상이 간호사인지 확인하지 않았다(아무 사용자 id 나 받았다)
    const nurse = await this.prisma.user.findUnique({ where: { id: data.nurseId }, select: { role: true } });
    if (!nurse || nurse.role !== 'NURSE') throw new BadRequestException({ code: 'NOT_A_NURSE', message: '간호사 계정에만 담당을 배정할 수 있습니다.' });
    const isPrimary = data.isPrimary ?? true;
    // 🔴 (2026-10-07) 일괄 배정이 기존 주 담당을 그대로 둬 **한 환자에 주 담당이 둘** — 하번 간호사의 "내 담당"·근무조 마감에 계속 남았다.
    //    새 주 담당이면 같은 입원의 다른 주 담당을 보조로 내린다(해제하지 않는다 — 해제는 상번 인수·배정 해제의 몫)
    return this.prisma.$transaction(async (tx) => {
      if (isPrimary) {
        await tx.nursePatientAssignment.updateMany({
          where: { admissionId: data.admissionId, releasedAt: null, isPrimary: true, nurseId: { not: data.nurseId } },
          data: { isPrimary: false },
        });
      }
      return tx.nursePatientAssignment.create({
        data: {
          nurseId: data.nurseId,
          admissionId: data.admissionId,
          shiftType: data.shiftType ?? 'DAY',
          isPrimary,
          assignedBy: data.assignedBy,
        },
        include,
      });
    });
  }

  /**
   * 상번 인수 — 인계받은 입원의 담당을 내가 넘겨받는다(2026-09-30).
   * 그 입원의 **다른 간호사** 활성 배정은 같은 트랜잭션에서 해제된다(교대가 끝난 하번의 배정이 남아
   * "내 담당"이 두 사람에게 동시에 보이던 것). 자동으로 하지 않는다 — 인수자가 누를 때만.
   */
  async takeOverAssignment(nurseId: string, admissionId: string, shiftType: string) {
    return this.prisma.$transaction((tx) => takeOverInTx(tx, nurseId, admissionId, shiftType));
  }

  /** 배정 해제 — 이미 해제된 것은 다시 찍지 않는다(해제 시각을 덮어 이력이 바뀌지 않게) */
  async releaseAssignment(id: string) {
    const done = await this.prisma.nursePatientAssignment.updateMany({
      where: { id, releasedAt: null },
      data: { releasedAt: new Date() },
    });
    const row = await this.prisma.nursePatientAssignment.findUnique({ where: { id } });
    if (!row) throw new NotFoundException({ code: 'ASSIGNMENT_NOT_FOUND', message: 'Assignment not found' });
    return { ...row, alreadyReleased: done.count === 0 };
  }

  /**
   * 입원 종료(퇴원·취소) → 그 입원의 담당 배정 해제(2026-09-30).
   * 🔴 종전엔 해제 경로가 수동 버튼 하나뿐이라 퇴원 환자가 "내 담당"에 남아 담당 수를 부풀렸다.
   */
  async releaseForAdmission(admissionId: string) {
    const r = await this.prisma.nursePatientAssignment.updateMany({
      where: { admissionId, releasedAt: null },
      data: { releasedAt: new Date() },
    });
    return r.count;
  }
}
