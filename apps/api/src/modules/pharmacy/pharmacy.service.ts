import { Injectable, NotFoundException, BadRequestException, ConflictException, ForbiddenException, Logger, Optional } from '@nestjs/common';
import { ageOf } from '@hospital-run/shared';
import { Cron, CronExpression } from '@nestjs/schedule';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { MedicalAiService } from '../medical-ai/medical-ai.service';
import { DispensingStatus, Prisma, UserRole } from '@prisma/client';
import { IntegrationOutboxService } from '../integration/integration-outbox.service';
import { ConfigRuntimeService } from '../config/config-runtime.service';
import { assertStateTransition, stateChangedConflict, TransitionMap } from '../../common/state-transition';
import { durGateDecision } from './dur-gate';
import { NotificationService } from '../notification/notification.service';
import { prescribedByWhere, responsiblePrescriberOf } from '../../common/responsible-prescriber';
import {
  ADR_STATUS, classifyKidsTransmission, kidsNotTransmittedNote, localKidsRef, transmitKidsReport,
} from './kids-reporting';
import { gateMode } from '../../common/gate-mode';
import { SafetyGateService } from '../safety-gate/safety-gate.service';
import { recordBlockchainSignature } from '../../common/util/blockchain-signature';
import { truncateWithNote } from '../../common/stored-truncation';
import { firstPatientPushResult, patientPushResult } from '../notification/patient-push.contract';
import { recordGateViolation } from '../../common/gate-violation-record';

/** 대체조제 상태 어휘 — 스키마 주석(GenericSubstitution.status) 그대로 */
export type SubstitutionStatus = 'REQUESTED' | 'APPROVED' | 'REJECTED';
/** 의사 판정은 한 번이다 — 승인·거부를 서로 뒤집지 않는다(조제가 승인만 보고 나간다) */
export const SUBSTITUTION_TRANSITIONS: TransitionMap<SubstitutionStatus> = {
  REQUESTED: ['APPROVED', 'REJECTED'],
  APPROVED: [],
  REJECTED: [],
};
export const SUBSTITUTION_TX_CTX = { code: 'SUBSTITUTION', message: '이미 판정된 대체조제입니다' };

@Injectable()
export class PharmacyService {
  private readonly logger = new Logger(PharmacyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
    private readonly outbox: IntegrationOutboxService,
    private readonly configRuntime: ConfigRuntimeService,
    @Optional() private readonly medicalAi?: MedicalAiService,
    /**
     * 🔴 위반 원장 — 정본은 `SafetyGateService.record`(modules/safety-gate).
     *    `pharmacy.highAlertDoubleCheck`(기본 BLOCK)·`asp.enforce` 두 게이트는 **집행은 하는데
     *    위반이 아무 곳에도 영속되지 않아**, 관제(`/admin/safety-gates`)의 "위반 0건"이
     *    '준수'인지 '한 번도 평가된 적 없음'인지 구분할 방법이 없었다(v4.4.0 DUR 43룰과 같은 유형).
     *    여기서는 **기록만 추가한다** — 막는 조건·예외 타입·문구는 한 글자도 바뀌지 않는다.
     */
    @Optional() private readonly gates?: SafetyGateService,
    /** 대체조제 요청 → 책임 처방의 인앱 알림(원내만). 미주입이면 응답의 prescriberNotice 가 그렇게 말한다 */
    @Optional() private readonly notifications?: NotificationService,
  ) {}

  /**
   * 게이트 위반을 원장에 남긴다 — **위반일 때만** 부른다(통과 건을 기록하면 진짜 경보가 묻힌다).
   *
   * 🔴 실패를 `.catch(() => {})` 로 지우지 않는다. 원장이 죽은 사실이 조용해지면
   *    "위반 0건"이 다시 거짓말을 시작한다. 기록 실패는 로그로 남기되,
   *    **집행(차단/통과)은 기록 성패와 무관하게** 호출부에서 그대로 진행된다.
   */
  private async recordGateViolation(v: {
    /** config 키 그대로 — 관제·GateViolationLog 가 이 문자열로 조인한다(지어내지 않는다) */
    gateKey: string;
    /** 실효 모드 그대로. OFF 면 애초에 부르지 않는다(끈 게이트의 위반은 위반이 아니다) */
    severity: 'WARN' | 'BLOCK';
    /** 사람이 읽을 **위반 사실** — "차단했다"가 아니라 "무엇이 어긋났다"를 적는다 */
    message: string;
    refType: string;
    refId: string;
  }): Promise<void> {
    const { gateKey, severity, message, refType, refId } = v;
    if (!this.gates) {
      this.logger.error(`[게이트 ${gateKey}=${severity}] 위반 원장 미주입(SafetyGateService) — ${refType}:${refId} ${message}`);
      return;
    }
    try {
      await this.gates.record(gateKey, severity, message, refType, refId);
    } catch (e) {
      this.logger.error(`[게이트 ${gateKey}=${severity}] 위반 원장 기록 실패 — ${refType}:${refId} ${message} · ${e}`);
    }
  }

  /** AI 처방 검토 자동화 */
  async reviewPrescriptionAI(orderId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        prescription: { include: { medicationCode: true, encounter: { include: { patient: { select: { id: true, dateOfBirth: true, gender: true } } } } } },
      },
    });
    if (!order?.prescription) throw new NotFoundException('처방을 찾을 수 없습니다');
    // 🔴 감사 귀속(§ai-phi-audit-coverage) — Order 에는 patientId 컬럼이 없어 처방→진료 경유로 찾는다.
    const patientId = order.prescription.encounter?.patientId ?? null;
    if (!this.medicalAi) return { orderId, patientId, review: null, source: 'FALLBACK' };
    try {
      const med = order.prescription.medicationCode;
      const patient = order.prescription.encounter?.patient;
      const age = ageOf(patient.dateOfBirth) ?? undefined;
      const result = await this.medicalAi.recommendDrugs({
        patientId: patient?.id ?? '',
        diagnosis: order.prescription.encounter?.chiefComplaint ?? '',
        patientContext: { age, currentMedications: med ? [med.nameKo ?? ''] : [] },
      });
      // 🔴 출처를 지어내지 않는다 — `recommendDrugs` 는 검증에 떨어지면 스스로 `FALLBACK` 을
      //    돌려준다. 종전엔 그것과 무관하게 `'AI'` 를 붙여, **검증 탈락 결과를 화면이 "AI" 로**
      //    표시했다(AI/FALLBACK/UNAVAILABLE 3상태 규약 위반).
      const source = (result as { source?: string })?.source ?? 'FALLBACK';
      return { orderId, patientId, review: result, drugName: med?.nameKo, source };
    } catch (e) {
      this.logger.warn(`AI 처방 검토 실패: ${e}`);
      return { orderId, patientId, review: null, source: 'FALLBACK' };
    }
  }

  /** AI 복약지도 자동 생성 */
  async generateMedicationGuidance(orderId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { prescription: { include: { medicationCode: true, encounter: { select: { patientId: true } } } } },
    });
    if (!order?.prescription?.medicationCode) throw new NotFoundException('처방 약물을 찾을 수 없습니다');
    const patientId = order.prescription.encounter?.patientId ?? null;
    if (!this.medicalAi) return { orderId, patientId, guidance: null, source: 'FALLBACK' };
    try {
      const med = order.prescription.medicationCode;
      const result = await this.medicalAi.patientEducation({
        diagnosis: med.nameKo ?? '',
        treatmentPlan: `${med.nameKo} ${order.prescription.dosage ?? ''} ${order.prescription.frequency ?? ''}`,
        medications: [med.nameKo ?? ''],
        language: 'ko',
      });
      return { orderId, patientId, drugName: med.nameKo, guidance: result, source: 'AI' };
    } catch (e) {
      this.logger.warn(`AI 복약지도 생성 실패: ${e}`);
      return { orderId, patientId, guidance: null, source: 'FALLBACK' };
    }
  }

  async getQueue(pharmacyType?: string) {
    // 🔴 조제가 끝나면 **오더는 COMPLETED** 로 닫힌다. 종전엔 큐가 ORDERED/RECEIVED/IN_PROGRESS 만
    //    반환해서 **검수 단계(조제완료·미불출)가 큐에서 통째로 빠졌고**, 약국 화면의 '검수 대기' 탭은
    //    데이터가 있어도 **구조적으로 영원히 0건**이었다(2026-08-12 실측: 조제 5건이 화면에 0으로).
    //    검수는 약사가 해야 하는 실제 작업이므로 큐에 남아야 한다. 불출(ISSUED)된 건은 제외.
    const where: Record<string, unknown> = {
      department: 'PHARMACY',
      // 🔴 약사가 조제할 수 없는 것을 큐에 올리지 않는다 — `department='PHARMACY'` 에는 제 부서가
      //    없는 처방(DIET·ACTIVITY·NURSING·LAB)이 대체 저장된다(OrderDepartment enum 갭).
      //    실측 원내 14건 중 8건이 비약물이었고 화면에는 전부 약품명 '약물'·용법 공백으로 섰다
      //    (2026-08-13). 구분자는 prescription.type — workstation getPharmacyWorklist 와 같은 계약.
      prescription: { type: 'MEDICATION' },
      OR: [
        // ① 활성·중단 처방의 진행 중 오더 — 중단(2026-09-30)은 접수 전 오더를 취소하므로 여기 남는 것은 이미 접수·시작된 것뿐
        { prescription: { status: { in: ['ACTIVE', 'DISCONTINUED'] } }, status: { in: ['ORDERED', 'RECEIVED', 'IN_PROGRESS'] } },
        // ② 이미 조제가 시작된 건 — **처방 상태와 무관하게** 남는다.
        //    검수 대기(DISPENSED)·불출 대기(VERIFIED) 는 오더가 COMPLETED 로 닫혀 있어 조제 상태로 잡는다.
        //    VERIFIED 를 빼면 검수 확인 즉시 행이 사라져 불출(수령 확인) 경로가 화면에서 끊긴다.
        //
        //    🔴 종전엔 최상위에 `prescription.status='ACTIVE'` 가 걸려 있어,
        //    **처방이 취소되면 조제 중·검수 대기·불출 대기 건이 통지 없이 목록에서 사라졌다.**
        //    `prescription.cancel` 은 `status='ORDERED'` 오더만 취소하고 진행 중인 것은
        //    의도적으로 보존하는데(약이 이미 만들어졌다), 정작 그것을 처리할 화면에서 증발했다.
        //    Dispensing 행은 미완결로 원장에 남는다. 실측 현재 해당 0건 — 아직 일어난 적 없다.
        //    → 남긴다. 취소 사실은 화면이 말한다(아래 `prescription.status` 를 함께 싣는다).
        { dispensing: { status: { in: ['PENDING', 'DISPENSED', 'VERIFIED'] } } },
      ],
    };
    if (pharmacyType) where.pharmacyType = pharmacyType;
    return this.prisma.order.findMany({
      where,
      orderBy: { createdAt: 'asc' },
      include: {
        prescription: {
          include: {
            encounter: { select: { id: true, patient: { select: { id: true, mrn: true, familyName: true, givenName: true } } } },
            medicationCode: { select: { code: true, nameKo: true, nameEn: true, ingredient: true, dosageForm: true, highAlertFlag: true, controlSchedule: true } },
          },
        },
        dispensing: { select: { id: true, status: true } },
      },
    });
  }

  async startDispensing(orderId: string, pharmacistId: string, notes?: string, durOverrideReason?: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { prescription: { include: { medicationCode: true, encounter: { select: { patientId: true } } } } },
    });
    if (!order) throw new NotFoundException('Order not found');

    if (order.status !== 'ORDERED' && order.status !== 'RECEIVED') {
      throw new ConflictException(
        `Cannot start dispensing for order with status ${order.status}. Expected: ORDERED or RECEIVED`
      );
    }

    // 🔴 **원외(EXTERNAL) 처방은 원내에서 조제하지 않는다.**
    //    환자가 처방전을 들고 원외 약국으로 가는 건이다. 종전엔 이 검사가 없어
    //    ① 워크스테이션 약국 큐가 `pharmacyType` 필터 없이 EXTERNAL 을 세우고(실측 대기 6건 중 4건)
    //    ② `/pharmacy` 상세 패널의 '조제 시작' 버튼이 모드로 막히지 않아
    //    실제로 **EXTERNAL 오더에 조제가 1건 생성됐다**(`00b5db14…`·2026-07-10·비시드 UUID).
    //    화면을 고쳐도 EP 는 열려 있으므로 서버가 마지막 방어선이다.
    //    막기만 하면 방치되므로 **무엇을 해야 하는지**(처방전 출력)를 메시지에 담는다.
    if (order.pharmacyType === 'EXTERNAL') {
      throw new ConflictException(
        '원외 처방입니다 — 원내 조제 대상이 아닙니다. 처방전을 출력해 환자에게 교부하세요. ' +
          '원내 조제가 필요하면 처방의가 처방을 원내(INTERNAL)로 다시 내야 합니다.',
      );
    }

    // DUR 강제 게이트(규제 §37): 경고 미해결 처방은 오버라이드 사유 없이 조제 불가
    // config pharmacy.durGate.enforce — OFF|WARN|BLOCK 3상(기본 OFF·구 true/false 값은 true=BLOCK 호환). 위반은 GateViolationLog(관제)
    const rx = order.prescription;
    const hasDurWarnings = rx?.durWarnings != null && (Array.isArray(rx.durWarnings) ? rx.durWarnings.length > 0 : true);
    if (rx) {
      const raw = String((await this.configRuntime.get('pharmacy.durGate.enforce')) ?? 'OFF');
      const mode = raw === 'true' ? 'BLOCK' : raw === 'false' ? 'OFF' : gateMode(raw, 'OFF');
      const recordGate = (severity: string, message: string) => {
        // 🔴 기록 실패를 삼키지 않는다(정본 `common/gate-violation-record`) — 조제 오버라이드가 원장에 안 남으면 관제가 "위반 0"
        void recordGateViolation(this.prisma, this.logger, {
          gateKey: 'pharmacy.durGate.enforce', severity, message, refType: 'PRESCRIPTION', refId: rx.id,
        });
      };
      const decision = durGateDecision({ hasWarnings: hasDurWarnings, overridden: rx.durOverridden, overrideReason: durOverrideReason, gateEnforced: mode === 'BLOCK' });
      if (decision === 'RECORD_OVERRIDE') {
        await this.prisma.prescription.update({
          where: { id: rx.id },
          data: { durOverridden: true, durOverrideReason: durOverrideReason!.trim(), durOverrideBy: pharmacistId, durOverrideAt: new Date() },
        });
        recordGate('OVERRIDE', `조제 오버라이드(약사) — ${durOverrideReason!.trim().slice(0, 500)}`);
      } else if (decision === 'BLOCK') {
        recordGate('BLOCK', 'DUR 경고 미해결 처방 조제 차단');
        throw new ConflictException('DUR 경고가 확인되지 않았습니다. 조제를 진행하려면 경고 검토 후 오버라이드 사유를 입력하세요.');
      } else if (mode === 'WARN' && hasDurWarnings && !rx.durOverridden) {
        recordGate('WARN', 'DUR 경고 미해결 처방 조제 진행(WARN)');
        this.logger.warn(`pharmacy DUR gate WARN — rx ${rx.id} 경고 미해결 조제 진행`);
      }
    }

    // ASP 게이트(P2-F) — 제한항생제(medicationCode.aspRestrictedLevel)인데 승인된 ASP 요청 없으면 조제 차단.
    //  config asp.enforce(OFF|WARN|BLOCK·기본 OFF, fallback 'OFF'). 승인-투약은 prescriptionId로 1:1 매칭.
    if (rx?.medicationCode?.aspRestrictedLevel) {
      const aspMode = gateMode(await this.configRuntime.get('asp.enforce'), 'OFF');
      if (aspMode !== 'OFF') {
        const approved = await this.prisma.aspRequest.findFirst({ where: { prescriptionId: rx.id, status: 'APPROVED' } });
        if (!approved) {
          // 🔴 2026-08-26 — 위반을 원장에 남긴다(종전엔 BLOCK 은 예외만, WARN 은 logger.warn 뿐이라
          //    관제에서 이 게이트는 영원히 "위반 0건"이었다). 차단 여부는 아래에서 종전 그대로 판단한다.
          await this.recordGateViolation({
            gateKey: 'asp.enforce',
            severity: aspMode,
            message: `제한항생제(${rx.medicationCode.aspRestrictedLevel}${rx.medicationCode.nameKo ? ` · ${rx.medicationCode.nameKo}` : ''}) — ASP 승인 없이 조제`,
            refType: 'PRESCRIPTION',
            refId: rx.id,
          });
          if (aspMode === 'BLOCK') {
            throw new ConflictException('제한 항생제입니다 — 항생제 스튜어드십(ASP) 승인 후 조제할 수 있습니다.');
          }
          this.logger.warn(`ASP 미승인 제한항생제 조제(WARN): rx ${rx.id} ${rx.medicationCode.aspRestrictedLevel}`);
        }
      }
    }

    // 외래/입원 분기 — 재원 중 환자의 조제는 INPATIENT (기존엔 항상 기본값 OUTPATIENT로 저장되던 결함)
    const patientId = order.prescription.encounter?.patientId ?? '';
    const activeAdmissions = patientId
      ? await this.prisma.admission.count({ where: { patientId, status: 'ADMITTED' } })
      : 0;

    /**
     * 🔴 (2026-09-16 F3) 오더 상태와 조제 기록은 **한 트랜잭션**이다.
     *    종전엔 `order.update(IN_PROGRESS)` 를 먼저 커밋하고 `dispensing.create` 를 따로 불렀다 —
     *    조제 기록 생성이 실패하면 오더는 '조제 중'인데 **조제 기록이 없는 반쪽 상태**가 남고,
     *    위의 상태 검사(ORDERED/RECEIVED 만 허용)가 재시도를 막아 그 오더는 **영구히 잠긴다**
     *    (약국 큐에 '조제 중'으로 떠 있는데 아무도 이어서 조제할 수 없다).
     *    게이트 판정·DUR 오버라이드 기록은 위에서 이미 끝났고(위반 원장은 tx 밖이라 롤백돼도 남는다),
     *    여기 두 쓰기만 묶는다.
     */
    return this.prisma.$transaction(async (tx) => {
      await tx.order.update({
        where: { id: orderId },
        data: { status: 'IN_PROGRESS', startedAt: new Date(), startedById: pharmacistId },
      });

      // Create dispensing record
      return tx.dispensing.create({
        data: {
          orderId,
          patientId,
          pharmacistId,
          careType: activeAdmissions > 0 ? 'INPATIENT' : 'OUTPATIENT',
          notes,
          items: order.prescription.medicationCodeId
            ? {
                create: [
                  {
                    medicationCodeId: order.prescription.medicationCodeId,
                    prescribedQty: order.prescription.quantity ?? 1,
                    dispensedQty: order.prescription.quantity ?? 1,
                  },
                ],
              }
            : undefined,
        },
        include: { items: { include: { medicationCode: { select: { nameKo: true, nameEn: true, ingredient: true, code: true } } } } },
      });
    });
  }

  /**
   * 🔴 고위험약 2차 확인자로 **유효한 역할** — 게이트 판정과 목록 조회가 이 상수 하나를 본다.
   *
   * 종전엔 이 규칙이 `completeDispensing` 안에만 있었고 목록을 주는 EP 가 아예 없었다.
   * 화면을 붙이려고 `GET /users?role=PHARMACIST` 를 쓰면 **두 번 갈라진다** —
   * 그 EP 는 `@Roles(ADMIN, DOCTOR, NURSE)` 라 **약사가 부르면 403**(정작 필요한 직군이 못 부른다)이고,
   * `role=PHARMACIST` 로만 거르면 게이트가 인정하는 **ADMIN 확인자가 목록에 없다.**
   * 고를 수 없는 사람을 서버만 인정하는 상태는 "고를 수 있는 사람이 없다"와 구별되지 않는다.
   */
  private static readonly SECOND_CHECKER_ROLES: UserRole[] = [UserRole.PHARMACIST, UserRole.ADMIN];

  /**
   * 고위험약/마약류 조제 완료의 2차 확인자 후보 — **활성**·자격 역할·**본인 제외**.
   *
   * 🔴 이 EP 가 없어서 `pharmacy.highAlertDoubleCheck` 게이트(미설정 → fail-closed **BLOCK**)가
   *    구조적으로 통과 불가였다: 두 조제 화면이 `complete` 를 **body 없이** 호출해
   *    `secondCheckBy` 가 항상 undefined 였고, web 전역에 `secondCheckBy` 는 **0건**이었다.
   *    고위험약이 실제로 처방되는 날 조제가 409 로 영원히 막힌다(현재 실피해 0 —
   *    운영에 고위험/마약류 참조 처방이 0건이라 **잴 것이 없었을 뿐**이다).
   *
   * 게이트를 약화하지 않는다. **고를 사람을 준다.**
   */
  async listSecondCheckers(excludeUserId?: string) {
    const rows = await this.prisma.user.findMany({
      where: {
        isActive: true,
        role: { in: PharmacyService.SECOND_CHECKER_ROLES },
        ...(excludeUserId ? { id: { not: excludeUserId } } : {}),
      },
      select: { id: true, familyName: true, givenName: true, role: true },
      orderBy: [{ familyName: 'asc' }, { givenName: 'asc' }],
      take: 100,
    });
    return rows;
  }

  async completeDispensing(id: string, secondCheckBy?: string) {
    const dispensing = await this.prisma.dispensing.findUnique({
      where: { id },
      include: {
        items: { include: { medicationCode: { select: { nameKo: true, nameEn: true, ingredient: true, highAlertFlag: true, controlSchedule: true } } } },
        order: { select: { prescriptionId: true } },
      },
    });
    if (!dispensing) throw new NotFoundException('Dispensing not found');

    if (dispensing.status !== DispensingStatus.PENDING) {
      throw new ConflictException(`Cannot complete dispensing with status ${dispensing.status}`);
    }

    // Validate that items are present
    if (!dispensing.items || dispensing.items.length === 0) {
      throw new BadRequestException('No dispensing items found');
    }

    // 고위험약/마약류 독립 2인확인(ISMP) — 게이트 BLOCK/WARN 시 조제약사≠2차확인자 강제.
    const highAlertItems = dispensing.items.filter(
      (it) => it.medicationCode?.highAlertFlag || it.medicationCode?.controlSchedule,
    );
    // 2차 확인자는 실재·활성 약사(≠조제약사)여야 유효 — 임의 UUID로 게이트 우회 방지.
    let validSecond = false;
    if (secondCheckBy && secondCheckBy !== dispensing.pharmacistId) {
      const checker = await this.prisma.user
        .findUnique({ where: { id: secondCheckBy }, select: { isActive: true, role: true } })
        .catch(() => null);
      // 🔴 자격 판정은 후보 목록(`listSecondCheckers`)과 **같은 상수**를 본다.
      //    갈라지면 화면에 뜨는 사람을 서버가 거부하거나(고를 수 없다), 목록에 없는 사람이 통과한다.
      validSecond =
        !!checker && checker.isActive && PharmacyService.SECOND_CHECKER_ROLES.includes(checker.role);
    }
    if (highAlertItems.length) {
      const gate = gateMode(await this.configRuntime.get('pharmacy.highAlertDoubleCheck'));
      // 🔴 2026-08-26 — 위반을 원장에 남긴다. 종전엔 BLOCK 은 예외만 던지고 WARN 은 `logger.warn` 뿐이라
      //    `/admin/safety-gates` 에서 이 게이트가 개통 이래 "위반 0건"이었다 —
      //    그 0 이 '준수'인지 '평가된 적 없음'인지 구분할 근거가 아무 데도 없었다.
      //    **집행은 아래에서 종전 그대로**(BLOCK=409 ConflictException·WARN=통과) 판단한다.
      if (!validSecond && gate !== 'OFF') {
        await this.recordGateViolation({
          gateKey: 'pharmacy.highAlertDoubleCheck',
          severity: gate,
          message: `고위험약/마약류(${highAlertItems.map((i) => i.medicationCode?.nameKo).join(', ')}) 조제 완료 — 조제약사와 다른 유효한 2차 확인자 없음`,
          refType: 'Dispensing',
          refId: id,
        });
      }
      if (!validSecond && gate === 'BLOCK') {
        throw new ConflictException(
          `고위험약/마약류(${highAlertItems.map((i) => i.medicationCode?.nameKo).join(', ')}) 조제 완료에는 조제약사와 다른 2차 확인자(활성 약사)가 필요합니다`,
        );
      }
      if (!validSecond && gate === 'WARN') {
        this.logger.warn(`고위험약 2인확인 없이 조제 완료(WARN): dispensing ${id}`);
      }
    }
    const recordSecondCheck = highAlertItems.length > 0 && validSecond;

    // 원자적 전이 + 오더/부가정보 갱신을 한 트랜잭션으로 — 부분 실패 시 DISPENSED-미완료 불일치·ERP 미발행 방지.
    const result = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.dispensing.updateMany({
        where: { id, status: DispensingStatus.PENDING },
        data: { status: DispensingStatus.DISPENSED, dispensedAt: new Date() },
      });
      if (claimed.count === 0) throw new ConflictException('이미 처리 중이거나 완료된 조제입니다');
      await tx.order.update({
        where: { id: dispensing.orderId },
        // 공개판: 유효한 2차 확인자만 완료자 칸에 적는다(무효한 ID 가 오더 기록에 남지 않게)
        data: { status: 'COMPLETED', completedAt: new Date(), ...(secondCheckBy && validSecond ? { completedById: secondCheckBy } : {}) },
      });
      return tx.dispensing.update({
        where: { id },
        data: recordSecondCheck ? { secondCheckBy, secondCheckAt: new Date() } : {},
        include: { items: { include: { medicationCode: true } } },
      });
    });

    // 조제 완료 이벤트 — prescriptionId 동봉 (미동봉 시 billing-accrual 리스너가 no-op 되어 조제 청구 라인이 발생하지 않던 결함)
    this.eventEmitter.emit('dispensing.completed', {
      dispensingId: id,
      orderId: dispensing.orderId,
      prescriptionId: dispensing.order?.prescriptionId,
      patientId: dispensing.patientId,
    });

    // ERP 약품 재고 소비 통보(materials)
    void this.outbox.enqueue('pharmacy', 'pharmacy.dispensed', `pharmacy:disp:${id}`, {
      dispensingId: id, orderId: dispensing.orderId,
      items: result.items.map((it) => ({ medicationCode: it.medicationCode?.code, name: it.medicationCode?.nameKo, dispensedQty: it.dispensedQty })),
    });

    return result;
  }

  /**
   * 조제 검수(DISPENSED → VERIFIED).
   *
   * 🔴 "약 조제 완료 — 약국에서 수령해주세요"가 **사실이 되는 순간은 여기**다.
   *    `issueDispensing`(ISSUED)은 이미 환자에게 실물을 건넨 뒤라 "수령해주세요"가 거짓이 되고,
   *    `dispense`(DISPENSED)는 아직 독립 검수 전이라 줄 수 없다(`issueDispensing` 가 VERIFIED 만 허용).
   *    → 검수 완료 = 불출 가능 = 수령 안내가 참이 되는 시점.
   * @param opts.notifyPatient 환자 앱 푸시 명시 옵트인(설정과 **둘 다** 필요)
   */
  async verifyDispensing(id: string, userId?: string, blockchainSignature?: {
    certificateId: string;
    signatureValue: string;
    signatureAlgorithm: string;
    documentHash: string;
  }, opts?: { notifyPatient?: boolean }) {
    const dispensing = await this.prisma.dispensing.findUnique({ where: { id } });
    if (!dispensing) throw new NotFoundException('Dispensing not found');

    if (dispensing.status !== DispensingStatus.DISPENSED) {
      throw new ConflictException(
        `Cannot verify dispensing with status ${dispensing.status}. Expected: DISPENSED`
      );
    }

    // 직무분리: 검수자 ≠ 조제약사(자가검수 방지)
    if (userId && userId === dispensing.pharmacistId) {
      throw new ConflictException('조제한 약사는 본인 조제 건을 검수할 수 없습니다(독립 검수 필요)');
    }

    const result = await this.prisma.dispensing.update({
      where: { id },
      data: {
        status: DispensingStatus.VERIFIED,
        verifiedAt: new Date(),
        ...(userId && { verifiedBy: userId }),
      },
      include: { items: { include: { medicationCode: true } } },
    });

    // Blockchain signature (non-blocking)
    if (blockchainSignature && userId) {
      try {
        await recordBlockchainSignature(this.prisma, blockchainSignature, {
          documentType: 'DISPENSING',
          documentId: id,
          patientId: dispensing.patientId,
          signerUserId: userId,
        });
} catch (e) {
        console.error('Blockchain signature failed (non-blocking):', e);
      }
    }

    // 🔴 환자 앱 푸시 — 외래 조제만. 입원 조제는 병동 인계라 환자가 약국에 갈 일이 없다
    //    ("약국에서 수령해주세요"가 입원 환자에게는 사실이 아니다) → NOT_APPLICABLE.
    let patientPush = patientPushResult('NOT_APPLICABLE');
    if (dispensing.careType === 'OUTPATIENT') {
      patientPush = firstPatientPushResult(
        await this.eventEmitter.emitAsync('prescription.ready', {
          patientId: dispensing.patientId,
          dispensingId: id,
          notifyPatient: opts?.notifyPatient === true,
        }),
      );
    }

    return { ...result, patientPush };
  }

  /**
   * 불출(교부) — 검수(VERIFIED) 완료 건의 실물 전달 확인.
   * 외래: 환자/보호자 수령, 입원: 병동 인계. issuedTo에 수령 확인 정보 기록.
   */
  async issueDispensing(id: string, userId?: string, issuedTo?: string) {
    const dispensing = await this.prisma.dispensing.findUnique({
      where: { id },
      include: { order: { select: { prescriptionId: true } } },
    });
    if (!dispensing) throw new NotFoundException('Dispensing not found');

    if (dispensing.status !== DispensingStatus.VERIFIED) {
      throw new ConflictException(
        `Cannot issue dispensing with status ${dispensing.status}. Expected: VERIFIED (검수 완료 건만 불출 가능)`,
      );
    }

    // 원자적 전이(updateMany 클레임) — 동시 불출 이중처리 방지
    const claimed = await this.prisma.dispensing.updateMany({
      where: { id, status: DispensingStatus.VERIFIED },
      data: {
        status: DispensingStatus.ISSUED,
        issuedAt: new Date(),
        issuedBy: userId ?? null,
        issuedTo: issuedTo?.trim() || null,
      },
    });
    if (claimed.count === 0) throw new ConflictException('이미 불출 처리된 조제입니다');

    // 입원 조제 불출 시 미연결 MAR에 실물 조제(dispensingId) 연결 — 병동 인계 추적 폐쇄
    if (dispensing.careType === 'INPATIENT' && dispensing.order?.prescriptionId) {
      await this.prisma.medicationAdministration
        .updateMany({
          where: { prescriptionId: dispensing.order.prescriptionId, dispensingId: null },
          data: { dispensingId: id },
        })
        .catch((e) => this.logger.warn(`MAR-조제 연결 실패(비차단): ${e.message}`));
    }

    this.eventEmitter.emit('dispensing.issued', {
      dispensingId: id,
      orderId: dispensing.orderId,
      patientId: dispensing.patientId,
      careType: dispensing.careType,
    });

    return this.prisma.dispensing.findUnique({
      where: { id },
      include: { items: { include: { medicationCode: true } } },
    });
  }

  async getDispensingDetail(id: string) {
    const include = {
      items: { include: { medicationCode: true } },
      patient: { select: { id: true, mrn: true, familyName: true, givenName: true } },
      pharmacist: { select: { id: true, familyName: true, givenName: true } },
      order: { include: { prescription: { include: { medicationCode: true, encounter: { include: { patient: { select: { id: true, mrn: true, familyName: true, givenName: true } }, doctor: { select: { id: true, familyName: true, givenName: true, department: true } } } } } } } },
    } as const;

    // dispensing ID로 조회
    let dispensing = await this.prisma.dispensing.findUnique({ where: { id }, include });

    // 못 찾으면 order ID로 fallback
    if (!dispensing) {
      dispensing = await this.prisma.dispensing.findFirst({ where: { orderId: id }, include });
    }

    // dispensing 없으면 order에서 처방 정보만 반환 (접수 대기 상태)
    if (!dispensing) {
      const order = await this.prisma.order.findUnique({
        where: { id },
        include: { prescription: { include: { medicationCode: true, encounter: { include: { patient: { select: { id: true, mrn: true, familyName: true, givenName: true } }, doctor: { select: { id: true, familyName: true, givenName: true, department: true } } } } } } },
      });
      if (!order) throw new NotFoundException('Dispensing or Order not found');
      return { id: order.id, orderId: order.id, status: order.status, prescription: order.prescription, order, items: [], patient: order.prescription?.encounter?.patient ?? null, pharmacist: null };
    }

    // 🔴 FE 상세 패널은 최상위 `prescription` 을 읽는다(위 접수 대기 폴백과 같은 shape).
    //    dispensing 경로만 order.prescription 아래에 숨어 있어 조제중~불출대기 건을 선택하면
    //    환자·약물·용법이 전부 빈칸으로 떴다(2026-08-13 실측 — 접수 대기 행만 채워져 눈에 안 띔).
    return { ...dispensing, prescription: dispensing.order?.prescription ?? null };
  }

  async updateDispensingItems(
    id: string,
    items: Array<{ medicationCodeId: string; prescribedQty: number; dispensedQty: number }>
  ) {
    const dispensing = await this.prisma.dispensing.findUnique({
      where: { id },
      include: { items: true, order: { include: { prescription: { select: { id: true, quantity: true, medicationCodeId: true } } } } },
    });
    if (!dispensing) throw new NotFoundException('Dispensing not found');

    if (dispensing.status !== DispensingStatus.PENDING) {
      throw new ConflictException(`Cannot update items for dispensing with status ${dispensing.status}`);
    }

    // 실 처방 수량(오더의 prescription.quantity) — 클라이언트 prescribedQty를 신뢰하지 않고 이와 대조.
    const orderedQty = dispensing.order?.prescription?.quantity ?? null;

    // 처방 초과 조제·음수 차단
    for (const it of items) {
      if (it.dispensedQty < 0 || it.prescribedQty < 0) {
        throw new BadRequestException('조제/처방 수량은 음수일 수 없습니다');
      }
      if (it.dispensedQty > it.prescribedQty) {
        throw new BadRequestException(`조제 수량(${it.dispensedQty})이 처방 수량(${it.prescribedQty})을 초과할 수 없습니다`);
      }
      // 클라이언트가 prescribedQty를 부풀려 초과 조제하는 것 방지 — 실 처방 수량 대비 검증.
      if (orderedQty != null && it.dispensedQty > orderedQty) {
        throw new BadRequestException(`조제 수량(${it.dispensedQty})이 실제 처방 수량(${orderedQty})을 초과할 수 없습니다`);
      }
    }

    // 공개판: 약품도 처방과 대조한다 — 처방 약품 또는 **승인된 대체조제** 약품만 조제 항목이 될 수 있다.
    //    (수량만 보면 승인 없이 다른 약으로 바뀐다.) 처방에 약품 코드가 없으면(자유 기재) 대조하지 않는다.
    const rx = dispensing.order?.prescription;
    if (rx?.medicationCodeId) {
      const subs = await this.prisma.genericSubstitution.findMany({
        where: { originalPrescriptionId: rx.id, status: 'APPROVED' },
        select: { substituteMedicationCodeId: true },
      });
      const allowed = new Set([rx.medicationCodeId, ...subs.map((s) => s.substituteMedicationCodeId)]);
      const wrong = items.filter((it) => !allowed.has(it.medicationCodeId));
      if (wrong.length > 0) {
        throw new BadRequestException('처방 약품(또는 승인된 대체조제 약품)이 아닌 항목은 조제할 수 없습니다 — 대체조제 승인을 먼저 받으세요');
      }
    }

    // 항목 교체를 하나의 트랜잭션으로(삭제 후 생성 중 실패로 항목 유실 방지).
    return this.prisma.$transaction(async (tx) => {
      await tx.dispensingItem.deleteMany({ where: { dispensingId: id } });
      return tx.dispensing.update({
        where: { id },
        data: {
          items: {
            create: items.map((item) => ({
              medicationCodeId: item.medicationCodeId,
              prescribedQty: item.prescribedQty,
              dispensedQty: item.dispensedQty,
            })),
          },
        },
        include: { items: { include: { medicationCode: true } } },
      });
    });
  }

  async cancelDispensing(id: string, reason: string) {
    const dispensing = await this.prisma.dispensing.findUnique({
      where: { id },
      include: { order: true },
    });
    if (!dispensing) throw new NotFoundException('Dispensing not found');

    if (dispensing.status === DispensingStatus.VERIFIED) {
      throw new ConflictException('Cannot cancel verified dispensing');
    }
    // 공개판: 교부(ISSUED) · 이미 취소된 조제는 취소하지 않는다 — 오더가 접수로 돌아가 같은 처방을 다시 조제하게 된다.
    //    교부 뒤에 되돌릴 일은 반납 · 회수 절차로 다룬다.
    if (dispensing.status !== DispensingStatus.PENDING && dispensing.status !== DispensingStatus.DISPENSED) {
      throw new ConflictException(`Cannot cancel dispensing with status ${dispensing.status}`);
    }

    /**
     * 🔴 (2026-09-16 F3) 오더 되돌림과 조제 취소는 **한 트랜잭션**이다.
     *    종전엔 `order.update(RECEIVED)` 를 먼저 커밋해서, 조제 취소가 실패하면
     *    오더는 다시 조제 가능한데 **이전 조제 기록은 살아 있는** 반쪽 상태가 남았다 —
     *    그 상태로 다시 조제하면 같은 처방에 조제 기록이 둘이 된다(이중 불출).
     */
    return this.prisma.$transaction(async (tx) => {
      // Reset order status
      await tx.order.update({
        where: { id: dispensing.orderId },
        data: { status: 'RECEIVED', startedAt: null },
      });

      return tx.dispensing.update({
        where: { id },
        data: {
          status: DispensingStatus.CANCELLED,
          notes: `${dispensing.notes || ''}${reason ? '\n취소사유: ' + reason : ''}`,
        },
      });
    });
  }

  // ── 재고/배치 관리 ──

  async getInventory(medicationCodeId?: string) {
    const where: Record<string, unknown> = {};
    if (medicationCodeId) where.medicationCodeId = medicationCodeId;
    return this.prisma.medicationBatch.findMany({
      where: { ...where, remainingQty: { gt: 0 } },
      include: { medicationCode: { select: { code: true, nameKo: true, dosageForm: true } } },
      orderBy: { expirationDate: 'asc' },
    });
  }

  async getExpiringBatches(days = 30) {
    const cutoff = new Date(Date.now() + days * 86400000);
    return this.prisma.medicationBatch.findMany({
      where: { expirationDate: { lte: cutoff }, remainingQty: { gt: 0 } },
      include: { medicationCode: { select: { code: true, nameKo: true, nameEn: true, ingredient: true } } },
      orderBy: { expirationDate: 'asc' },
    });
  }

  async getLowStock(threshold = 10) {
    const batches = await this.prisma.medicationBatch.groupBy({
      by: ['medicationCodeId'],
      _sum: { remainingQty: true },
      having: { remainingQty: { _sum: { lte: threshold } } },
    });
    const ids = batches.map(b => b.medicationCodeId);
    if (ids.length === 0) return [];
    return this.prisma.medicationCode.findMany({
      where: { id: { in: ids } },
      select: { id: true, code: true, nameKo: true, batches: { where: { remainingQty: { gt: 0 } }, select: { remainingQty: true } } },
    });
  }

  async receiveBatch(data: { medicationCodeId: string; lotNumber: string; expirationDate: string; quantity: number; manufacturer?: string; storageCondition?: string; isControlled?: boolean; notes?: string }) {
    return this.prisma.medicationBatch.create({
      data: {
        medicationCodeId: data.medicationCodeId,
        lotNumber: data.lotNumber,
        expirationDate: new Date(data.expirationDate),
        quantity: data.quantity,
        remainingQty: data.quantity,
        manufacturer: data.manufacturer,
        receivedAt: new Date(),
        storageCondition: data.storageCondition ?? 'ROOM',
        isControlled: data.isControlled ?? false,
        notes: data.notes,
      },
      include: { medicationCode: { select: { code: true, nameKo: true, nameEn: true, ingredient: true } } },
    });
  }

  async adjustBatch(batchId: string, newQty: number, reason: string) {
    const batch = await this.prisma.medicationBatch.findUnique({ where: { id: batchId } });
    if (!batch) throw new NotFoundException('Batch not found');
    return this.prisma.medicationBatch.update({
      where: { id: batchId },
      data: { remainingQty: newQty, notes: `${batch.notes || ''}\n조정: ${batch.remainingQty}→${newQty} (${reason})` },
    });
  }

  // ── 바코드 스캔 ──

  async scanBarcode(barcode: string, dispensingId: string) {
    // 바코드로 약품 매칭
    const med = await this.prisma.medicationCode.findFirst({ where: { barcode } });
    if (!med) return { matched: false, message: '등록되지 않은 바코드입니다.' };

    // dispensing의 해당 약품 항목 찾기
    const item = await this.prisma.dispensingItem.findFirst({
      where: { dispensingId, medicationCodeId: med.id },
    });
    if (!item) return { matched: false, medicationCode: med, message: '이 조제 건에 해당 약품이 없습니다.' };

    // 바코드 확인 기록
    await this.prisma.dispensingItem.update({
      where: { id: item.id },
      data: { scannedBarcode: barcode, scannedAt: new Date(), barcodeVerified: true },
    });

    return {
      matched: true,
      medicationCode: med,
      dispensingItemId: item.id,
      isControlled: !!med.controlSchedule,
      controlSchedule: med.controlSchedule,
    };
  }

  // ── 복약지도 ──

  async createCounsel(data: { dispensingId: string; pharmacistId: string; patientId: string; counselType?: string; content: string; drugInteractions?: string; sideEffects?: string; foodInteractions?: string; storageInstructions?: string; duration?: number }) {
    return this.prisma.dispensingCounsel.create({
      data: { ...data, counselType: data.counselType ?? 'INITIAL', counseledAt: new Date() },
    });
  }

  /**
   * 복약지도 대상 후보 — 그 환자의 최근 조제분.
   *
   * 🔴 `POST /pharmacy/counsel` 은 `dispensingId` 를 요구하는데, **환자의 조제 목록을 주는
   * EP 가 없었다**. 그래서 화면을 붙이려면 약사가 조제 UUID 를 외워 타이핑해야 했고,
   * 결과적으로 복약지도 기록 경로가 개통 이래 열린 적이 없다("0행"의 세 번째 뜻 —
   * 시드 부재도 미배선도 아닌 **쓰기 경로 막힘**).
   *
   * `counselCount` 는 이미 남긴 지도 건수다 — 0 은 진짜 0(행을 셌다).
   */
  async getCounselCandidates(patientId: string) {
    const rows = await this.prisma.dispensing.findMany({
      where: { patientId },
      orderBy: { createdAt: 'desc' },
      take: 30,
      select: {
        id: true, status: true, careType: true, createdAt: true,
        dispensedAt: true, issuedAt: true,
        items: { select: { medicationCode: { select: { nameKo: true, nameEn: true, ingredient: true, code: true } } } },
        _count: { select: { counsels: true } },
      },
    });
    return rows.map((d) => ({
      id: d.id,
      status: d.status,
      careType: d.careType,
      createdAt: d.createdAt.toISOString(),
      // 실제로 일어난 시각만 — 조제·불출 전이면 null(모르는 시각을 지어내지 않는다)
      dispensedAt: d.dispensedAt ? d.dispensedAt.toISOString() : null,
      issuedAt: d.issuedAt ? d.issuedAt.toISOString() : null,
      // 품목명이 하나도 없으면 빈 배열 — '약물' 같은 대체 표기를 만들지 않는다
      medications: d.items
        .map((i) => i.medicationCode?.nameKo ?? i.medicationCode?.nameEn ?? null)
        .filter((n): n is string => !!n),
      counselCount: d._count.counsels,
    }));
  }

  async getCounsels(dispensingId: string) {
    return this.prisma.dispensingCounsel.findMany({
      where: { dispensingId },
      include: { pharmacist: { select: { familyName: true, givenName: true } } },
      orderBy: { counseledAt: 'desc' },
    });
  }

  async getPatientCounsels(patientId: string) {
    return this.prisma.dispensingCounsel.findMany({
      where: { patientId },
      include: { pharmacist: { select: { familyName: true, givenName: true } }, dispensing: { include: { order: { include: { prescription: { include: { medicationCode: { select: { nameKo: true, nameEn: true, ingredient: true, code: true } } } } } } } } },
      orderBy: { counseledAt: 'desc' },
      take: 50,
    });
  }

  // ── 대체조제 ──

  async requestSubstitution(data: { originalPrescriptionId: string; substituteMedicationCodeId: string; reason: string; pharmacistId: string }) {
    const row = await this.prisma.genericSubstitution.create({
      // 🔴 (B5) 네 필드만 — 종전 `...data` 는 호출자 객체의 status·doctorApproved 까지 원장에 넣었다(승인 없는 승인)
      data: {
        originalPrescriptionId: data.originalPrescriptionId,
        substituteMedicationCodeId: data.substituteMedicationCodeId,
        reason: data.reason,
        pharmacistId: data.pharmacistId,
        requestedAt: new Date(),
      },
      include: {
        substituteMedication: { select: { nameKo: true, code: true } },
        // 책임 처방의·알림 본문 — 생성 결과에 함께 싣는다(별도 사전 조회를 두지 않는다)
        originalPrescription: {
          select: {
            prescriberId: true, createdBy: true,
            medicationCode: { select: { nameKo: true } },
            encounter: { select: { patient: { select: { familyName: true, givenName: true } } } },
          },
        },
      },
    });
    return { ...row, prescriberNotice: await this.noticeSubstitutionPrescriber(row) };
  }

  /**
   * 🔴 대체조제 요청 → 책임 처방의 **원내 인앱 알림**(대외 발신 아님). 종전엔 요청만 쌓이고 승인할 의사에게
   *    아무 신호가 없었다(승인 화면도 약제 관리 화면뿐 — 의사 메뉴에 없다). 실패는 요청을 되돌리지 않되 응답에 싣는다.
   *    문장은 조립하지 않는다(서버 조립 한국어 가드) — 본문은 환자·약물 값만.
   */
  private async noticeSubstitutionPrescriber(row: {
    id: string;
    substituteMedication?: { nameKo: string | null } | null;
    originalPrescription?: {
      prescriberId: string | null; createdBy: string;
      medicationCode?: { nameKo: string | null } | null;
      encounter?: { patient?: { familyName: string | null; givenName: string | null } | null } | null;
    } | null;
  }): Promise<{ attempted: boolean; sent: boolean; reason: 'NO_PRESCRIPTION' | 'NO_NOTIFIER' | 'FAILED' | null }> {
    const rx = row.originalPrescription;
    if (!rx) return { attempted: false, sent: false, reason: 'NO_PRESCRIPTION' };
    if (!this.notifications) return { attempted: false, sent: false, reason: 'NO_NOTIFIER' };
    const pt = rx.encounter?.patient;
    const ptName = pt ? `${pt.familyName ?? ''}${pt.givenName ?? ''}`.trim() : '';
    const drugs = [rx.medicationCode?.nameKo, row.substituteMedication?.nameKo].filter((v): v is string => !!v).join(' → ');
    try {
      await this.notifications.notify(responsiblePrescriberOf(rx), {
        type: 'SUBSTITUTION_REQUEST',
        title: '🔄 대체조제 — 승인 요청',
        message: [ptName, drugs].filter(Boolean).join(' · '),
        severity: 'WARNING',
        refType: 'GENERIC_SUBSTITUTION',
        refId: row.id,
      });
      return { attempted: true, sent: true, reason: null };
    } catch (e) {
      this.logger.warn(`대체조제 처방의 알림 실패(비차단) substitution=${row.id}: ${(e as Error).message}`);
      return { attempted: true, sent: false, reason: 'FAILED' };
    }
  }

  /**
   * 🔴 대체조제 판정 권한 — 의사는 **자기가 책임 처방의인 처방**의 대체조제만 승인·거부한다(관리자 예외).
   *    종전엔 `@Roles(DOCTOR, ADMIN)` 만 보고 누구의 처방인지 보지 않아 아무 의사나 판정할 수 있었다.
   *    판정 쓰기(`decideSubstitution`)와 분리 — 전이 메서드 안의 조회를 사전 확인으로 읽는 스캐너 규약.
   */
  async assertCanDecideSubstitution(id: string, actor: { id: string; role: UserRole | string }): Promise<void> {
    if (actor.role === UserRole.ADMIN) return;
    const sub = await this.prisma.genericSubstitution.findUnique({
      where: { id },
      select: { originalPrescription: { select: { prescriberId: true, createdBy: true } } },
    });
    if (!sub) throw new NotFoundException('대체조제 기록을 찾을 수 없습니다');
    if (!sub.originalPrescription || responsiblePrescriberOf(sub.originalPrescription) !== actor.id) {
      throw new ForbiddenException({ code: 'NOT_RESPONSIBLE_PRESCRIBER', message: '본인이 책임 처방의인 처방의 대체조제만 판정할 수 있습니다' });
    }
  }

  /**
   * 대체조제 의사 판정 — 🔴 (2026-09-15 D1) 종전엔 현재 상태를 보지 않아 **이미 승인된 대체조제를 거부로,
   * 거부된 것을 승인으로 뒤집을 수 있었다**(약사는 승인만 보고 조제한다 · 약사법 대체조제 사후통보 기록이 바뀐다).
   * 대기(PENDING)만 판정한다 · 같은 판정을 다시 보내면 쓰지 않고 그대로 돌려준다.
   *
   * 🔴 (2026-09-30) **누가·언제·왜**를 함께 남긴다 — 종전엔 승인/거부 여부만 남아, 관리자가 대신 판정한 것과
   *    책임 처방의가 판정한 것을 구별할 수 없었고 거부 사유가 약사에게 가지 않았다.
   *    거부는 사유 필수(약사가 다음 조치를 정해야 한다) · 승인 메모는 선택.
   */
  private async decideSubstitution(id: string, next: 'APPROVED' | 'REJECTED', actorId: string, noteRaw?: string | null) {
    const note = (noteRaw ?? '').trim() || null;
    if (next === 'REJECTED' && !note) {
      throw new BadRequestException({ code: 'SUBSTITUTION_REJECT_REASON_REQUIRED', message: 'A reason is required to reject a substitution' });
    }
    const cur = await this.prisma.genericSubstitution.findUnique({ where: { id }, select: { status: true } });
    if (!cur) throw new NotFoundException('대체조제 기록을 찾을 수 없습니다');
    // 같은 판정 재전송 — 먼저 판정한 사람·사유를 덮지 않는다
    if (cur.status === next) return { ...(await this.prisma.genericSubstitution.findUnique({ where: { id } })), pharmacistNotice: null };
    assertStateTransition(SUBSTITUTION_TRANSITIONS, cur.status as SubstitutionStatus, next, SUBSTITUTION_TX_CTX);
    const upd = await this.prisma.genericSubstitution.updateMany({
      where: { id, status: cur.status },
      data: { doctorApproved: next === 'APPROVED', doctorNotified: true, status: next, decidedById: actorId, decidedAt: new Date(), decisionNote: note },
    });
    if (upd.count === 0) stateChangedConflict(SUBSTITUTION_TX_CTX, cur.status);
    const row = await this.prisma.genericSubstitution.findUnique({
      where: { id },
      include: { substituteMedication: { select: { nameKo: true } }, originalPrescription: { select: { medicationCode: { select: { nameKo: true } } } } },
    });
    return { ...row, pharmacistNotice: row ? await this.noticeSubstitutionPharmacist(row, next) : null };
  }

  /**
   * 판정 → 요청한 약사에게 **원내 인앱 알림**(대외 발신 아님) — 종전엔 약사가 대기 목록에서 사라진 것으로만 알았다.
   * 실패는 판정을 되돌리지 않되 응답에 싣는다 · 문장은 조립하지 않는다(값만).
   */
  private async noticeSubstitutionPharmacist(
    row: { id: string; pharmacistId: string; decisionNote: string | null; substituteMedication?: { nameKo: string | null } | null; originalPrescription?: { medicationCode?: { nameKo: string | null } | null } | null },
    next: 'APPROVED' | 'REJECTED',
  ): Promise<{ attempted: boolean; sent: boolean; reason: 'NO_NOTIFIER' | 'FAILED' | null }> {
    if (!this.notifications) return { attempted: false, sent: false, reason: 'NO_NOTIFIER' };
    const drugs = [row.originalPrescription?.medicationCode?.nameKo, row.substituteMedication?.nameKo].filter((v): v is string => !!v).join(' → ');
    try {
      await this.notifications.notify(row.pharmacistId, {
        type: 'SUBSTITUTION_DECIDED',
        title: next === 'APPROVED' ? '✅ 대체조제 — 승인됨' : '⛔ 대체조제 — 거부됨',
        message: [drugs, row.decisionNote].filter(Boolean).join(' · '),
        severity: next === 'APPROVED' ? 'INFO' : 'WARNING',
        refType: 'GENERIC_SUBSTITUTION',
        refId: row.id,
      });
      return { attempted: true, sent: true, reason: null };
    } catch (e) {
      this.logger.warn(`대체조제 판정 약사 알림 실패(비차단) substitution=${row.id}: ${(e as Error).message}`);
      return { attempted: true, sent: false, reason: 'FAILED' };
    }
  }

  async approveSubstitution(id: string, actorId: string, note?: string | null) {
    return this.decideSubstitution(id, 'APPROVED', actorId, note);
  }

  async rejectSubstitution(id: string, actorId: string, reason?: string | null) {
    return this.decideSubstitution(id, 'REJECTED', actorId, reason);
  }

  /**
   * 최근 판정된 대체조제(약사·관리자) — 판정자·역할·시각·사유와 함께.
   * 🔴 판정자 칸이 생기기 전에 판정된 건은 `decidedBy` 가 null 이다 — 화면이 "기록 없음(기능 도입 전)"이라 말한다(지어내지 않는다).
   */
  async getDecidedSubstitutions(days?: number) {
    const LIMIT = 200;
    const windowDays = Number.isInteger(days) && (days as number) > 0 && (days as number) <= 365 ? (days as number) : 30;
    const since = new Date(Date.now() - windowDays * 86400_000);
    const rows = await this.prisma.genericSubstitution.findMany({
      // 판정 시각이 없으면(종전 판정) 요청 시각으로 창을 본다
      where: { status: { in: ['APPROVED', 'REJECTED'] }, OR: [{ decidedAt: { gte: since } }, { decidedAt: null, requestedAt: { gte: since } }] },
      include: {
        originalPrescription: { select: { prescriberId: true, createdBy: true, medicationCode: { select: { nameKo: true, code: true } }, encounter: { select: { patient: { select: { familyName: true, givenName: true, mrn: true } } } } } },
        substituteMedication: { select: { nameKo: true, code: true } },
        pharmacist: { select: { familyName: true, givenName: true } },
      },
      orderBy: [{ decidedAt: { sort: 'desc', nulls: 'last' } }, { requestedAt: 'desc' }],
      take: LIMIT + 1,
    });
    const truncated = rows.length > LIMIT;
    const page = truncated ? rows.slice(0, LIMIT) : rows;
    const ids = [...new Set(page.map((r) => r.decidedById).filter((v): v is string => !!v))];
    const users = ids.length ? await this.prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, familyName: true, givenName: true, role: true } }) : [];
    const umap = new Map(users.map((u) => [u.id, u]));
    const items = page.map((r) => {
      const u = r.decidedById ? umap.get(r.decidedById) : undefined;
      const prescriberId = r.originalPrescription ? responsiblePrescriberOf(r.originalPrescription) : null;
      return {
        ...r,
        decidedBy: r.decidedById ? {
          id: r.decidedById,
          name: u ? `${u.familyName ?? ''}${u.givenName ?? ''}`.trim() || null : null,
          role: u?.role ?? null,
          // 책임 처방의 본인이 판정했는가 — 아니면 관리자 대리(화면이 구분해 말한다)
          isPrescriber: !!prescriberId && prescriberId === r.decidedById,
        } : null,
      };
    });
    return { items, truncated, limit: LIMIT, windowDays };
  }

  /**
   * 🔴 의사의 대체조제 승인 워크리스트 — 내가 책임 처방의인 처방의 대기분만.
   *    종전 대기 목록은 약사·관리자 전용(약제 관리 화면)이라, 승인 권한을 가진 의사가 **승인할 건을 볼 길이 없었다**.
   *    전건 목록을 의사에게 여는 대신 자기 스코프만 연다.
   */
  /** 🔴 (2026-10-10) 환자 id 를 싣는다 — 종전엔 이름·MRN 만이라 의사 화면에서 차트로 갈 수 없었고 할 일함 '환자별'이 id 로 묶지 못했다 */
  async getMyPendingSubstitutions(userId: string) {
    return this.prisma.genericSubstitution.findMany({
      where: { status: 'REQUESTED', originalPrescription: prescribedByWhere(userId) },
      include: {
        originalPrescription: { include: { medicationCode: { select: { nameKo: true, nameEn: true, ingredient: true, code: true } }, encounter: { select: { patient: { select: { id: true, familyName: true, givenName: true, mrn: true } } } } } },
        substituteMedication: { select: { nameKo: true, code: true } },
        pharmacist: { select: { familyName: true, givenName: true } },
      },
      orderBy: { requestedAt: 'desc' },
    });
  }

  /**
   * DUR 경고 무시(오버라이드) 기록 — 읽기 전용 검토 목록.
   *
   * 🔴 종전엔 처방에 `durOverridden`·사유·주체·시각이 **남기만 하고 아무 화면도 모아 보여주지 않았다**
   *    (QI 가 건수만 셌다). 무시 사유를 아무도 읽지 않으면 기록은 감사가 아니라 흔적일 뿐이다.
   *    약사·관리자는 전건, 의사는 자기가 책임 처방의인 처방만. 잘랐으면 잘랐다고 말한다(meta.truncated).
   *    스키마는 바꾸지 않는다 — 처방 행에 이미 있는 네 컬럼을 읽는다.
   */
  async getDurOverrides(actor: { id: string; role: UserRole | string }, days?: number) {
    const LIMIT = 200;
    const windowDays = Number.isInteger(days) && (days as number) > 0 && (days as number) <= 365 ? (days as number) : 30;
    const since = new Date(Date.now() - windowDays * 86400_000);
    const scope = actor.role === UserRole.DOCTOR ? prescribedByWhere(actor.id) : {};
    const rows = await this.prisma.prescription.findMany({
      where: { durOverridden: true, durOverrideAt: { gte: since }, ...scope },
      select: {
        id: true, durOverrideReason: true, durOverrideBy: true, durOverrideAt: true, durWarnings: true,
        prescriberId: true, createdBy: true, status: true,
        medicationCode: { select: { nameKo: true, code: true } },
        encounter: { select: { patient: { select: { id: true, familyName: true, givenName: true, mrn: true } } } },
      },
      orderBy: { durOverrideAt: 'desc' },
      take: LIMIT + 1,
    });
    const truncated = rows.length > LIMIT;
    const page = truncated ? rows.slice(0, LIMIT) : rows;
    const userIds = [...new Set(page.flatMap((r) => [r.durOverrideBy, responsiblePrescriberOf(r)]).filter((v): v is string => !!v))];
    const users = userIds.length
      ? await this.prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, familyName: true, givenName: true, role: true } })
      : [];
    const umap = new Map(users.map((u) => [u.id, u]));
    const nameOf = (id: string | null) => {
      const u = id ? umap.get(id) : undefined;
      const n = u ? `${u.familyName ?? ''}${u.givenName ?? ''}`.trim() : '';
      return n || null; // 모르면 null — 빈 문자열로 지어내지 않는다
    };
    const items = page.map((r) => {
      const prescriberId = responsiblePrescriberOf(r);
      return {
        prescriptionId: r.id,
        status: r.status,
        drugName: r.medicationCode?.nameKo ?? null,
        drugCode: r.medicationCode?.code ?? null,
        patient: r.encounter?.patient ?? null,
        /** 사유 원문 — 비어 있으면 null(무시 사유 미기록이라는 사실) */
        reason: r.durOverrideReason?.trim() ? r.durOverrideReason : null,
        overriddenBy: r.durOverrideBy,
        overriddenByName: nameOf(r.durOverrideBy),
        overriddenByRole: r.durOverrideBy ? umap.get(r.durOverrideBy)?.role ?? null : null,
        overriddenAt: r.durOverrideAt ? r.durOverrideAt.toISOString() : null,
        prescriberId,
        prescriberName: nameOf(prescriberId),
        /** 무시된 경고 원문(처방 시점 DUR 결과) — 없으면 null */
        warnings: r.durWarnings ?? null,
      };
    });
    return { items, truncated, limit: LIMIT, windowDays, scope: actor.role === UserRole.DOCTOR ? 'MINE' as const : 'ALL' as const };
  }

  async getPendingSubstitutions() {
    return this.prisma.genericSubstitution.findMany({
      where: { status: 'REQUESTED' },
      include: {
        originalPrescription: { include: { medicationCode: { select: { nameKo: true, nameEn: true, ingredient: true, code: true } }, encounter: { select: { patient: { select: { familyName: true, givenName: true, mrn: true } } } } } },
        substituteMedication: { select: { nameKo: true, code: true } },
        pharmacist: { select: { familyName: true, givenName: true } },
      },
      orderBy: { requestedAt: 'desc' },
    });
  }

  // ── ADR 보고 ──

  async createAdr(data: { patientId: string; reporterId: string; reportType?: string; suspectedDrugName: string; suspectedDrugCode?: string; reactionDescription: string; onsetDate: string; severity: string; outcome: string; causalityAssessment?: string; naranjoScore?: number; actionTaken?: string; parentReportId?: string; seriousDeath?: boolean; seriousLifeThreat?: boolean; seriousHospital?: boolean; seriousDisability?: boolean; seriousCongenital?: boolean }) {
    // 중대성 자동 도출 — 개별 기준 중 하나라도 참이거나 사망/치명 결과면 serious
    const isSerious = !!(data.seriousDeath || data.seriousLifeThreat || data.seriousHospital || data.seriousDisability || data.seriousCongenital
      || data.severity === 'FATAL' || data.outcome === 'FATAL');
    const report = await this.prisma.adverseReactionReport.create({
      data: { ...data, reportType: data.reportType ?? 'INITIAL', onsetDate: new Date(data.onsetDate), isSerious },
    });
    // 🔴안전 루프 폐쇄: 확정 인과성(CERTAIN/PROBABLE) ADR → 알레르기 등록(향후 처방 DUR/경고에 반영). 중복방지.
    await this.linkAdrToAllergy(report).catch((e) => this.logger.warn(`ADR→Allergy 연계 실패(보고는 정상): ${e}`));
    return report;
  }

  /** 확정 ADR을 알레르기 레코드로 연계 — allergenCode(=주성분코드)로 DUR 매칭 폐쇄. 이미 있으면 생성 안 함. */
  private async linkAdrToAllergy(report: { id: string; patientId: string; reporterId: string; suspectedDrugName: string; suspectedDrugCode: string | null; reactionDescription: string; severity: string; causalityAssessment: string | null; naranjoScore: number | null }) {
    if (report.causalityAssessment !== 'CERTAIN' && report.causalityAssessment !== 'PROBABLE') return;
    // 중복 방지: 활성 DRUG 알레르기가 동일 코드(있으면) 또는 동일 원인명으로 이미 존재하면 skip
    const dup = await this.prisma.allergy.findFirst({
      where: {
        patientId: report.patientId,
        isActive: true,
        type: 'DRUG',
        ...(report.suspectedDrugCode ? { allergenCode: report.suspectedDrugCode } : { allergen: report.suspectedDrugName }),
      },
      select: { id: true },
    });
    if (dup) return;
    const sevMap: Record<string, 'MILD' | 'MODERATE' | 'SEVERE' | 'LIFE_THREATENING'> = {
      MILD: 'MILD', MODERATE: 'MODERATE', SEVERE: 'SEVERE', FATAL: 'LIFE_THREATENING',
    };
    await this.prisma.allergy.create({
      data: {
        patientId: report.patientId,
        type: 'DRUG',
        allergen: report.suspectedDrugName,
        allergenCode: report.suspectedDrugCode ?? undefined,
        // 🔴 (2026-09-15 U4) 알레르기 반응 칸은 VarChar(500) 인데 ADR 원문(Text)은 더 길 수 있다 — 종전엔 조용히 잘랐다.
        //    알레르기 목록은 임상 판단 근거라 **잘렸다고 표시**하고 전문 위치를 적는다(ADR 보고 원문은 그대로 보존).
        reaction: truncateWithNote(report.reactionDescription, 500, ' …(전문: ADR 보고)'),
        /**
         * 🔴 (2026-09-15 D3) ADR 보고의 중증도는 자유 문자열이고(어휘 정본이 없어 강제하지 않는다),
         *    알레르기 `severity` 는 4값 enum 이라 어휘 밖 값이 오면 종전엔 **조용히 MODERATE** 가 됐다.
         *    알레르기 등록 자체는 막지 않는다(막으면 DUR 이 이 반응을 못 본다) — 다만 기본값으로 떨어진
         *    사실과 원문 값을 `notes` 에 남겨 약사가 다시 판정할 수 있게 한다(§4 "조용히 하지 않는다").
         */
        severity: sevMap[report.severity] ?? 'MODERATE',
        // 인과성 CERTAIN=확정, PROBABLE=미확정(추가 확인 여지) — 안전측 표기
        verificationStatus: report.causalityAssessment === 'CERTAIN' ? 'CONFIRMED' : 'UNCONFIRMED',
        reportedBy: 'ADR보고',
        recordedBy: report.reporterId,
        notes: `ADR 보고 연계(${report.id}) · 인과성 ${report.causalityAssessment}${report.naranjoScore != null ? ` · Naranjo ${report.naranjoScore}` : ''}${sevMap[report.severity] ? '' : ` · 중증도 미상(보고 원값 '${report.severity}' — 기본 중등도로 기록, 재판정 필요)`}`,
      },
    });
    this.logger.log(`ADR ${report.id} → 알레르기 등록(환자 ${report.patientId}, ${report.suspectedDrugName})`);
  }

  async getAdrReports(patientId?: string) {
    const rows = await this.prisma.adverseReactionReport.findMany({
      where: patientId ? { patientId } : {},
      include: {
        patient: { select: { familyName: true, givenName: true, mrn: true } },
        reporter: { select: { familyName: true, givenName: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    // 🔴 저장값(kidsReported)만으로 '보고완료'를 말하지 않는다 — 전송 근거는 읽는 쪽에서 판정한다.
    //    과거 스텁이 찍어 둔 행이 있어도 변조하지 않고 `UNVERIFIED`(전송 근거 없음)로 읽는다.
    return rows.map((r) => ({ ...r, kidsTransmission: classifyKidsTransmission(r) }));
  }

  /**
   * KIDS(한국의약품안전관리원) 제출 — E2B(R3) 페이로드 생성 + 전송 시도.
   *
   * 🔴 종전에는 전송 코드가 없는데도 `kidsReported:true` · `status:'SUBMITTED'` ·
   *    `KIDS-STUB-xxxx` 접수번호를 찍었고, 함수 첫 줄 `if (r.kidsReported) return r;` 가
   *    그 마킹을 멱등 가드로 삼았다. **실제 연동이 붙어도 그 건은 영구히 다시 보고되지 않는다**
   *    (약사법상 이상사례 보고 의무의 영구 미이행). 규약·판정은 `kids-reporting.ts` 정본.
   *    → **전송하지 않은 것에 보고완료를 찍지 않는다. 미전송은 항상 재보고 가능하다.**
   */
  async submitAdrToKids(id: string) {
    const r = await this.prisma.adverseReactionReport.findUnique({ where: { id } });
    if (!r) throw new NotFoundException('ADR 보고 없음');
    // 멱등 차단은 **실제로 KIDS 에 도달한 건**에만 건다(저장 플래그가 아니라 전송 근거로 판정).
    const prior = classifyKidsTransmission(r);
    if (prior.transmitted) return { ...r, kidsTransmission: prior };
    // E2B(R3) 최소 페이로드 매핑(ICH E2B 구조 근사) — 실제 전송 시 XML 직렬화로 확장
    const payload = {
      messageType: 'ichicsr', safetyReportId: r.id, reportType: r.reportType,
      patient: { reference: r.patientId },
      reaction: { description: r.reactionDescription, onset: r.onsetDate, outcome: r.outcome },
      drug: { name: r.suspectedDrugName, code: r.suspectedDrugCode, action: r.actionTaken },
      seriousness: {
        serious: r.isSerious, death: r.seriousDeath, lifeThreatening: r.seriousLifeThreat,
        hospitalization: r.seriousHospital, disability: r.seriousDisability, congenitalAnomaly: r.seriousCongenital,
      },
      causality: { assessment: r.causalityAssessment, naranjoScore: r.naranjoScore },
    };

    const now = new Date();
    const result = await transmitKidsReport(payload).catch((e) => ({
      outcome: 'FAILED' as const, reason: e instanceof Error ? e.message : String(e),
    }));

    // 나간 대로 적는다 — 도달 근거(SENT)가 없으면 보고완료 마킹을 세우지 않는다.
    const data: Prisma.AdverseReactionReportUpdateInput =
      result.outcome === 'SENT'
        ? {
            kidsReported: true,
            kidsReportDate: result.at ?? now,
            status: ADR_STATUS.SUBMITTED,
            kidsPayload: payload as Prisma.InputJsonValue,
            kidsReportNumber: result.externalRef ?? null, // KIDS 가 준 번호만 담는다
          }
        : {
            kidsReported: false,
            kidsReportDate: null, // 모르는 시각은 원장에 박지 않는다
            status: result.outcome === 'FAILED' ? ADR_STATUS.SEND_FAILED : ADR_STATUS.LOCAL_RECORDED,
            kidsPayload: payload as Prisma.InputJsonValue,
            // 원내 접수번호는 LOCAL- 접두어로 기관 번호가 아님을 드러낸다
            kidsReportNumber: r.kidsReportNumber?.startsWith('LOCAL-') ? r.kidsReportNumber : localKidsRef(now),
          };

    const updated = await this.prisma.adverseReactionReport.update({ where: { id }, data });
    if (result.outcome !== 'SENT') {
      this.logger.warn(`ADR ${id} KIDS ${kidsNotTransmittedNote(now, result.reason)}`);
    }
    return { ...updated, kidsTransmission: classifyKidsTransmission(updated) };
  }

  /**
   * KIDS 제출용 E2B(R3) ICSR XML 생성(실전송 서식). 🔴전송은 KIDS 게이트웨이(외부)·이 파일 업로드/전송이 실보고.
   * ICH E2B(R3) 구조 근사 — 실운영 시 지역센터/KIDS 스키마로 정합.
   */
  async buildE2bXml(id: string): Promise<{ filename: string; content: string }> {
    const r = await this.prisma.adverseReactionReport.findUnique({
      where: { id }, include: { patient: { select: { familyName: true, givenName: true, dateOfBirth: true, gender: true } } },
    });
    if (!r) throw new NotFoundException('ADR 보고 없음');
    const esc = (s: unknown) => String(s ?? '').replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c] as string));
    const d = (dt: Date | null) => (dt ? dt.toISOString().slice(0, 10).replace(/-/g, '') : '');
    const seriousness = [
      r.seriousDeath && '1', r.seriousLifeThreat && '2', r.seriousHospital && '3', r.seriousDisability && '4', r.seriousCongenital && '5',
    ].filter(Boolean).join(',');
    const content = `<?xml version="1.0" encoding="UTF-8"?>
<ichicsr lang="ko">
  <ichicsrmessageheader>
    <messagetype>ichicsr</messagetype>
    <messageformatversion>2.1</messageformatversion>
    <messagesenderidentifier>WERUBYHOSP-HIS</messagesenderidentifier>
    <messagereceiveridentifier>KIDS</messagereceiveridentifier>
  </ichicsrmessageheader>
  <safetyreport>
    <safetyreportid>${esc(r.id)}</safetyreportid>
    <reporttype>${esc(r.reportType)}</reporttype>
    <serious>${r.isSerious ? '1' : '2'}</serious>
    <seriousnesscriteria>${esc(seriousness)}</seriousnesscriteria>
    <patient>
      <patientinitial>${esc((r.patient?.familyName ?? '').slice(0, 1))}</patientinitial>
      <patientbirthdate>${d(r.patient?.dateOfBirth ?? null)}</patientbirthdate>
      <patientsex>${r.patient?.gender === 'MALE' ? '1' : r.patient?.gender === 'FEMALE' ? '2' : '0'}</patientsex>
      <reaction>
        <reactiondescription>${esc(r.reactionDescription)}</reactiondescription>
        <reactionstartdate>${d(r.onsetDate)}</reactionstartdate>
        <reactionoutcome>${esc(r.outcome)}</reactionoutcome>
      </reaction>
      <drug>
        <drugcharacterization>1</drugcharacterization>
        <medicinalproduct>${esc(r.suspectedDrugName)}</medicinalproduct>
        <drugcode>${esc(r.suspectedDrugCode)}</drugcode>
        <actiondrug>${esc(r.actionTaken)}</actiondrug>
      </drug>
      <causality>
        <assessment>${esc(r.causalityAssessment)}</assessment>
        <naranjoscore>${esc(r.naranjoScore)}</naranjoscore>
      </causality>
    </patient>
  </safetyreport>
</ichicsr>
`;
    return { filename: `E2B-${r.id.slice(0, 8)}.xml`, content };
  }

  /**
   * Naranjo 인과성 알고리즘 — 10문항(+/-/모름) 응답을 점수화·등급 산출.
   * answers: 각 문항 'yes'|'no'|'unknown'. 반환 점수·인과성(≥9 확실·5~8 개연·1~4 가능·≤0 의심).
   */
  computeNaranjo(answers: string[]): { score: number; causality: string; answered: number; unknown: number } {
    // 문항별 (yes, no, unknown) 배점 — Naranjo ADR probability scale 표준.
    const W: Array<[number, number, number]> = [
      [1, 0, 0],   // 1. 이 반응에 대한 이전 결정적 보고가 있는가
      [2, -1, 0],  // 2. 의심약물 투여 후 반응이 나타났는가
      [1, 0, 0],   // 3. 중단/길항제 투여 시 반응이 호전되었는가
      [2, -1, 0],  // 4. 재투여 시 반응이 재발했는가
      [-1, 2, 0],  // 5. 약물 외 다른 원인이 있는가
      [-1, 1, 0],  // 6. 위약 투여 시에도 반응이 나타나는가
      [1, 0, 0],   // 7. 혈중농도가 독성 수준이었는가
      [1, 0, 0],   // 8. 용량 증감에 따라 반응이 심해지거나 약해졌는가
      [1, 0, 0],   // 9. 과거 유사약물 노출 시 유사반응이 있었는가
      [1, 0, 0],   // 10. 객관적 증거로 반응이 확인되었는가
    ];
    let score = 0;
    let answered = 0;
    for (let i = 0; i < W.length; i++) {
      const a = (answers[i] ?? 'unknown').toLowerCase();
      if (a === 'yes' || a === 'no') answered++;
      score += a === 'yes' ? W[i][0] : a === 'no' ? W[i][1] : W[i][2];
    }
    const causality = score >= 9 ? 'CERTAIN' : score >= 5 ? 'PROBABLE' : score >= 1 ? 'POSSIBLE' : 'UNLIKELY';
    // 🔴 같은 점수라도 "10문항을 평가한 결과"와 "대부분 모름이라 0점"은 다른 근거다.
    //    화면이 그 차이를 말할 수 있도록 함께 돌려준다(점수만 주면 캐비아트를 붙일 수 없다).
    return { score, causality, answered, unknown: W.length - answered };
  }

  async getAdrStats() {
    const results = await this.prisma.adverseReactionReport.groupBy({
      by: ['suspectedDrugCode', 'severity'],
      _count: { id: true },
    });
    return results;
  }

  // ── 기기 관리 ──

  async getDevices() {
    return this.prisma.pharmacyDevice.findMany({ orderBy: { name: 'asc' } });
  }

  async createDevice(data: { name: string; type: string; connectionType: string; connectionConfig: Record<string, unknown>; location?: string }) {
    // 🔴 (B5) 등록 필드만 — 종전 `data as never` 는 status·lastHeartbeatAt 까지 받아 하트비트 없는 "ONLINE" 을 만들 수 있었다
    return this.prisma.pharmacyDevice.create({
      data: {
        name: data.name,
        type: data.type,
        connectionType: data.connectionType,
        connectionConfig: data.connectionConfig as never,
        location: data.location,
      },
    });
  }

  async deviceHeartbeat(id: string) {
    return this.prisma.pharmacyDevice.update({ where: { id }, data: { status: 'ONLINE', lastHeartbeatAt: new Date() } });
  }

  async createAtcJob(dispensingId: string, deviceId: string, medications: unknown[]) {
    return this.prisma.atcDispenseJob.create({
      data: { dispensingId, deviceId, medications: medications as never },
    });
  }

  async getAtcJobStatus(id: string) {
    return this.prisma.atcDispenseJob.findUnique({ where: { id }, include: { device: { select: { name: true, type: true } } } });
  }

  async updateAtcJobStatus(id: string, status: string, errorMessage?: string) {
    const data: Record<string, unknown> = { status };
    if (status === 'PROCESSING') data.startedAt = new Date();
    if (status === 'COMPLETED') data.completedAt = new Date();
    if (errorMessage) data.errorMessage = errorMessage;
    return this.prisma.atcDispenseJob.update({ where: { id }, data: data as never });
  }

  // ── 분할조제 (Split Dispensing) ──

  /**
   * 🔴 이 두 EP(`POST /pharmacy/split-dispensing`, `/next`)는 **부르는 화면이 없고,
   *    지금 구조로는 배선해도 작동하지 않는다.** 화면을 붙이려다 확인한 사실(2026-08-26):
   *
   *    `Dispensing.orderId` 에 **UNIQUE** 가 걸려 있다(운영 DB 실측 —
   *    `dispensings_order_id_key`). 그런데 `dispenseSplitNext` 는 **같은 orderId 로
   *    새 Dispensing 행을 만든다** → 2회차는 항상 P2002(unique 위반)로 실패한다.
   *    첫 회차조차 이미 조제가 시작된 오더에는 만들 수 없다.
   *    운영 실측: `dispensings` 330행 중 `split_seq_no > 1` 인 행 **0건**.
   *    `splitOfId`(분할 원본 연결) 도 두 메서드 어디에서도 채우지 않는다.
   *
   *    그래서 **버튼을 만들지 않았다** — 100% 실패하는 버튼은 기능이 아니라 거짓말이다.
   *    회수하려면 스키마 결정이 먼저다(회차를 별도 테이블로 두거나 orderId UNIQUE 해제).
   *    가드: `test/pharmacy/split-dispensing-blocked.spec.ts`
   *
   * 장기처방 분할조제 — 90일 처방을 30일씩 3회 분할 등
   * @param orderId 원본 오더 ID
   * @param totalSplits 분할 횟수 (예: 3)
   * @param pharmacistId 약사 ID
   */
  async startSplitDispensing(orderId: string, totalSplits: number, pharmacistId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { prescription: { include: { medicationCode: true, encounter: { select: { patientId: true } } } } },
    });
    if (!order) throw new NotFoundException('Order not found');

    const totalQty = order.prescription.quantity ?? 1;
    const partialQty = Math.ceil(totalQty / totalSplits);

    // 첫 번째 분할 조제
    const dispensing = await this.prisma.dispensing.create({
      data: {
        orderId,
        patientId: order.prescription.encounter?.patientId ?? '',
        pharmacistId,
        splitSeqNo: 1,
        totalPrescribedQty: totalQty,
        partialQty: Math.min(partialQty, totalQty),
        remainingQty: totalQty - Math.min(partialQty, totalQty),
        careType: order.pharmacyType === 'EXTERNAL' ? 'OUTPATIENT' : 'OUTPATIENT',
        items: order.prescription.medicationCodeId
          ? {
              create: [{
                medicationCodeId: order.prescription.medicationCodeId,
                prescribedQty: totalQty,
                dispensedQty: Math.min(partialQty, totalQty),
              }],
            }
          : undefined,
      },
      include: { items: { include: { medicationCode: { select: { nameKo: true, nameEn: true, ingredient: true, code: true } } } } },
    });

    await this.prisma.order.update({
      where: { id: orderId },
      data: { status: 'IN_PROGRESS', startedAt: new Date(), startedById: pharmacistId },
    });

    return dispensing;
  }

  /**
   * 분할조제 후속 회차 — 잔여 처방에서 다음 분할분 조제
   * @param orderId 원본 오더 ID
   * @param pharmacistId 약사 ID
   */
  async dispenseSplitNext(orderId: string, pharmacistId: string) {
    // 마지막 분할 조제 기록 조회
    const lastSplit = await this.prisma.dispensing.findFirst({
      where: { orderId },
      orderBy: { splitSeqNo: 'desc' },
    });
    if (!lastSplit) throw new NotFoundException('이전 분할조제 기록이 없습니다');
    if ((lastSplit.remainingQty ?? 0) <= 0) throw new BadRequestException('잔여 수량이 없습니다 — 이미 전량 조제 완료');

    const totalQty = lastSplit.totalPrescribedQty ?? 0;
    const nextSeq = (lastSplit.splitSeqNo ?? 1) + 1;
    // 균등 분할: 첫 분할과 동일 수량, 마지막은 잔여 전량
    const firstPartialQty = lastSplit.partialQty ?? Math.ceil(totalQty / 3);
    const thisQty = Math.min(firstPartialQty, lastSplit.remainingQty ?? 0);
    const newRemaining = (lastSplit.remainingQty ?? 0) - thisQty;

    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { prescription: { include: { medicationCode: true, encounter: { select: { patientId: true } } } } },
    });

    /**
     * 🔴 **부르면 사실을 말한다**(2026-08-27).
     *
     *    `dispensings.order_id` 에 UNIQUE 가 걸려 있어 2회차 생성은 **항상 P2002** 다.
     *    종전에는 그 P2002 가 그대로 밖으로 나갔다 — 부른 쪽은 "이 기능이 구조적으로
     *    아직 성립하지 않는다"가 아니라 "무슨 중복 오류"로 읽는다.
     *    화면은 이 EP 를 부르지 않지만(가드), **화면 밖에서 부를 수 있는 것은 막지 못한다.**
     *
     *    🔴 여기서 스키마를 고치지 않는다 — 어디에 회차를 담을지는 등재된 사람 결정이다
     *    (`/admin/decisions/pharmacy.splitDispensingSchema`). 결정이 반영되면 이 catch 는
     *    자연히 지나가고 코드는 그대로 동작한다(미리 막지 않는 이유).
     */
    // 🔴 `let` 로 바깥에 두고 try 안에서 **대입**한다. `const` 로 다시 선언하면 바깥이 가려져
    //    `return dispensing` 이 `undefined` 를 돌려준다(2026-08-27 대조군 테스트가 잡았다 —
    //    암묵적 any 라 tsc 는 통과했다).
    let dispensing: Awaited<ReturnType<typeof this.prisma.dispensing.create>>;
    try {
      dispensing = await this.prisma.dispensing.create({
        data: {
          orderId,
          patientId: order?.prescription.encounter?.patientId ?? '',
          pharmacistId,
          splitSeqNo: nextSeq,
          totalPrescribedQty: totalQty,
          partialQty: thisQty,
          remainingQty: newRemaining,
          careType: 'OUTPATIENT',
          items: order?.prescription.medicationCodeId
            ? {
                create: [{
                  medicationCodeId: order.prescription.medicationCodeId,
                  prescribedQty: totalQty,
                  dispensedQty: thisQty,
                }],
              }
            : undefined,
        },
        include: { items: { include: { medicationCode: { select: { nameKo: true, nameEn: true, ingredient: true, code: true } } } } },
      });
    } catch (e) {
      if ((e as { code?: string })?.code === 'P2002') {
        throw new BadRequestException({
          code: 'SPLIT_DISPENSING_NOT_AVAILABLE',
          message:
            '분할조제 2회차는 현재 스키마에서 성립하지 않습니다 — `dispensings.order_id` 가 UNIQUE 라 ' +
            '같은 오더로 회차 행을 만들 수 없습니다. 어디에 회차를 담을지는 미결 결정입니다 ' +
            '(/admin/decisions/pharmacy.splitDispensingSchema). 조제 기록은 만들어지지 않았습니다.',
          decisionKey: 'pharmacy.splitDispensingSchema',
        });
      }
      throw e;
    }


    // 잔여 0이면 오더 완료
    if (newRemaining <= 0) {
      await this.prisma.order.update({
        where: { id: orderId },
        data: { status: 'COMPLETED', completedAt: new Date(), completedById: pharmacistId },
      });
    }

    return dispensing;
  }

  /**
   * 분할조제 현황 조회
   */
  async getSplitHistory(orderId: string) {
    const splits = await this.prisma.dispensing.findMany({
      where: { orderId },
      orderBy: { splitSeqNo: 'asc' },
      include: {
        items: { include: { medicationCode: { select: { nameKo: true, nameEn: true, ingredient: true, code: true } } } },
        pharmacist: { select: { familyName: true, givenName: true } },
      },
    });

    const total = splits[0]?.totalPrescribedQty ?? 0;
    const dispensed = splits.reduce((sum, s) => sum + (s.partialQty ?? 0), 0);
    const remaining = total - dispensed;

    return {
      totalPrescribedQty: total,
      dispensedQty: dispensed,
      remainingQty: remaining,
      splitCount: splits.length,
      isComplete: remaining <= 0,
      splits,
    };
  }

  // ── 원외처방전 자동 만료 ──

  /**
   * 원외처방전 자동 만료 처리
   * - pharmacyType='EXTERNAL', status='ORDERED', 생성 후 3일 초과한 오더를 CANCELLED로 변경
   * - 매일 00:00에 자동 실행되며, POST /api/v1/pharmacy/expire-external 으로 수동 트리거 가능
   */
  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async expireExternalPrescriptions(): Promise<{ expiredCount: number }> {
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);

    /**
     * 🔴 **취소 스탬프를 함께 찍는다**(2026-09-03 실측으로 봉합).
     *    종전에는 `status: 'CANCELLED'` 만 쓰고 `cancelledAt` 을 비워 뒀다.
     *    운영에 스탬프 없는 취소 오더 63건 중 **59건이 이 크론이 만든 것**이었다.
     *    `order-sign-entry.ts` 는 "시각을 모르는 취소는 로그를 만들지 않는다"(추정 금지)이므로
     *    **CPOE 서명 로그에 이 취소가 통째로 빠진다** — 누가·언제 끊었는지 사후에 복원할 수 없다.
     *    행위자는 사람이 아니라 시스템이라 `cancelledById` 는 비운다(사람을 지어내지 않는다).
     */
    const cancelledAt = new Date();
    const result = await this.prisma.order.updateMany({
      where: {
        pharmacyType: 'EXTERNAL',
        status: 'ORDERED',
        createdAt: { lt: threeDaysAgo },
      },
      data: {
        status: 'CANCELLED',
        cancelledAt,
        notes: 'AUTO_EXPIRED: 처방전 유효기간 만료',
      },
    });

    this.logger.log(`[ExpireExternal] 원외처방전 자동 만료 처리 완료 — ${result.count}건`);
    return { expiredCount: result.count };
  }

  // ── 라벨 데이터 생성 ──

  async generateLabel(dispensingId: string) {
    const dispensing = await this.prisma.dispensing.findUnique({
      where: { id: dispensingId },
      include: {
        patient: { select: { familyName: true, givenName: true, dateOfBirth: true } },
        pharmacist: { select: { familyName: true, givenName: true } },
        items: { include: { medicationCode: { select: { nameKo: true, code: true, dosageForm: true, storageCondition: true } } } },
        order: { include: { prescription: { select: { dosage: true, frequency: true, route: true, duration: true, quantity: true } } } },
      },
    });
    if (!dispensing) throw new NotFoundException('Dispensing not found');

    const rx = dispensing.order?.prescription;
    return {
      patientName: `${dispensing.patient?.familyName ?? ''}${dispensing.patient?.givenName ?? ''}`,
      dateOfBirth: dispensing.patient?.dateOfBirth,
      pharmacistName: `${dispensing.pharmacist?.familyName ?? ''}${dispensing.pharmacist?.givenName ?? ''}`,
      medications: dispensing.items.map(item => ({
        name: item.medicationCode.nameKo,
        code: item.medicationCode.code,
        dosageForm: item.medicationCode.dosageForm,
        storageCondition: item.medicationCode.storageCondition,
        quantity: item.dispensedQty,
      })),
      dosage: rx?.dosage,
      frequency: rx?.frequency,
      route: rx?.route,
      duration: rx?.duration,
      dispensedAt: dispensing.dispensedAt,
    };
  }
}
