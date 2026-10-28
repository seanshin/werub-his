import { consultationCodeFor, readInstitutionGrade } from '../billing/consultation-code';
import { TierPriceService } from '../billing/tier-price.service';
import { Injectable, Logger, NotFoundException, BadRequestException, Optional } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';
import { readJitsiEnv, signJitsiToken } from '../../common/jitsi/jitsi-token';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { assertDateParam } from '../../common/day-range';
import { MedicalAiService } from '../medical-ai/medical-ai.service';
import { EligibilityService } from '../eligibility/eligibility.service';
import {
  getTelehealthDepartmentPolicy,
  isTelehealthDepartmentEligible,
} from '../../common/telehealth-department-policy';

@Injectable()
export class TelehealthService {
  private readonly logger = new Logger(TelehealthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly eligibility: EligibilityService,
    @Optional() private readonly medicalAi?: MedicalAiService,
    @Optional() private readonly events?: EventEmitter2,
    /** 청구 단가 = 고시 종별 단가(2026-10-20) — 미주입이면 수가 마스터 */
    @Optional() private readonly tierPrice?: TierPriceService,
  ) {}

  /** AI 비동기 메시지 분류 (긴급/일반/재진) */
  async classifyPatientMessage(sessionId: string) {
    const session = await this.prisma.telehealthSession.findUnique({ where: { id: sessionId } });
    if (!session) throw new NotFoundException('세션을 찾을 수 없습니다');
    if (!this.medicalAi || !session.patientMessage) return { sessionId, patientId: session.patientId, classification: null, source: 'FALLBACK' };
    try {
      const result = await this.medicalAi.triage(session.patientMessage, {});
      return { sessionId, patientId: session.patientId, classification: result, message: session.patientMessage, source: 'AI' };
    } catch (e) {
      this.logger.warn(`AI 메시지 분류 실패: ${e}`);
      return { sessionId, patientId: session.patientId, classification: null, source: 'FALLBACK' };
    }
  }

  /** AI 의사 답변 초안 생성 */
  async suggestReply(sessionId: string) {
    const session = await this.prisma.telehealthSession.findUnique({
      where: { id: sessionId },
      include: { patient: { select: { familyName: true, givenName: true, dateOfBirth: true, gender: true } } },
    });
    if (!session) throw new NotFoundException('세션을 찾을 수 없습니다');
    if (!this.medicalAi || !session.patientMessage) return { sessionId, patientId: session.patientId, reply: null, source: 'FALLBACK' };
    try {
      // PHI 비식별(보수안): 환자 성명 미전송 — 호칭 자리는 [환자명] 플레이스홀더 지시 후 서버가 실명 후치환.
      const result = await this.medicalAi.clinicalQa({
        question: `환자의 원격진료 메시지에 대한 답변 초안을 작성해주세요. 환자 호칭이 필요하면 반드시 [환자명]으로만 표기하세요(임의 이름 창작 금지).\n\n주호소: ${session.chiefComplaint ?? ''}\n환자 메시지: ${session.patientMessage}`,
        specialty: 'general',
      });
      // [환자명] → 실명 후치환(서버 측)
      let reply = result;
      try {
        const patientName = `${session.patient.familyName}${session.patient.givenName}`;
        if (patientName) reply = JSON.parse(JSON.stringify(result).split('[환자명]').join(patientName));
      } catch { /* 후치환 실패 시 원본 유지 */ }
      return { sessionId, patientId: session.patientId, reply, source: 'AI' };
    } catch (e) {
      this.logger.warn(`AI 답변 초안 실패: ${e}`);
      return { sessionId, patientId: session.patientId, reply: null, source: 'FALLBACK' };
    }
  }

  /** Jitsi JWT 토큰 생성 (의사=모더레이터, 환자=게스트) — 서명 정본 `common/jitsi/jitsi-token.ts` 로 위임(P12) */
  generateJitsiToken(opts: { roomName: string; userName: string; userId: string; email?: string; isModerator: boolean }) {
    const env = readJitsiEnv({ get: (k) => this.config.get<string>(k) });
    if (!env) throw new BadRequestException('JITSI_JWT_SECRET 환경변수가 설정되지 않았습니다');
    return signJitsiToken(env, opts);
  }

  /**
   * 세션의 Jitsi 토큰 발급 (직원용).
   *
   * 🔴 (외부 점검) 종전에는 담당의가 **아닌** 직원이 부르면
   *    `userName` 이 **환자 이름**으로 떨어졌다. 그 직원이 방에 들어가면 이름표가 환자 이름으로 뜬다 —
   *    회의방이 "누가 그 자리에 있는가"를 거짓으로 말하는 것이고(CLAUDE.md §1),
   *    담당의·환자에게는 환자가 두 명 들어온 것처럼 보인다.
   *    표시명은 **부르는 직원 자신의 이름**으로 한다(모더레이터 권한은 담당의에게만 그대로).
   * 🔴 EP 를 닫는 것이 답은 아니다(§5) — 원격진료는 간호사·약사가 같은 방에 들어가야 하는 협업 자리다.
   *    닫는 대신 **자기 이름으로 들어가게** 한다. 담당의 여부는 moderator 로 계속 갈린다.
   *    모르면(사용자 행이 없으면) 남의 이름을 쓰지 않고 404 로 말한다.
   */
  async getJitsiToken(sessionId: string, userId: string) {
    const session = await this.prisma.telehealthSession.findUnique({
      where: { id: sessionId },
      include: {
        doctor: { select: { id: true, familyName: true, givenName: true, email: true } },
      },
    });
    if (!session) throw new NotFoundException('세션을 찾을 수 없습니다');

    const isDoctor = session.doctorId === userId;
    const self = isDoctor
      ? session.doctor
      : await this.prisma.user.findUnique({
          where: { id: userId },
          select: { id: true, familyName: true, givenName: true, email: true },
        });
    if (!self) throw new NotFoundException('토큰을 발급할 사용자를 찾을 수 없습니다');
    const roomName = session.roomId ?? `th-${sessionId.slice(0, 16)}`;

    return this.generateJitsiToken({
      roomName,
      userName: `${self.familyName}${self.givenName}`,
      userId,
      email: self.email ?? undefined,
      isModerator: isDoctor,
    });
  }

  /** 환자용 Jitsi 토큰 (인증 없이 세션 ID로 발급) */
  async getPatientJitsiToken(sessionId: string) {
    const session = await this.prisma.telehealthSession.findUnique({
      where: { id: sessionId },
      include: {
        patient: { select: { id: true, familyName: true, givenName: true } },
      },
    });
    if (!session) throw new NotFoundException('세션을 찾을 수 없습니다');
    const roomName = session.roomId ?? `th-${sessionId.slice(0, 16)}`;

    return this.generateJitsiToken({
      roomName,
      userName: `${session.patient.familyName}${session.patient.givenName} (환자)`,
      userId: session.patientId,
      isModerator: false,
    });
  }

  /**
   * 담당의를 확정하고 예약 가능 여부를 검증한다.
   * 🔴 종전엔 담당의를 **호출자 자신으로 강제**했다. 원내 예약 화면에 담당의 선택이 없었기 때문에,
   *    관리자·간호사가 잡은 예약은 담당의가 관리자·간호사 자신이 됐다 — 환자는 누가 진료할지 모르는
   *    채로 예약이 확정됐고, 그 세션은 어느 의사의 목록에도 뜨지 않는다.
   */
  private async resolveDoctor(doctorId: string | undefined) {
    if (!doctorId) {
      throw new BadRequestException('담당의를 선택해야 원격진료를 예약할 수 있습니다 — 누가 진료할지 정하지 않은 예약은 만들지 않습니다');
    }
    const doctor = await this.prisma.user.findUnique({
      where: { id: doctorId },
      select: { id: true, role: true, isActive: true, department: true },
    });
    if (!doctor || doctor.role !== 'DOCTOR' || !doctor.isActive) {
      throw new BadRequestException('담당의로 지정할 수 없는 사용자입니다 — 재직 중인 의사만 원격진료 담당의가 됩니다');
    }
    // 관리자가 '선택한 진료과만 허용'으로 설정했다면 예약도 그 설정을 지켜야 한다(설정 화면 정본)
    const policy = await getTelehealthDepartmentPolicy(this.prisma);
    if (!isTelehealthDepartmentEligible(policy, doctor.department)) {
      throw new BadRequestException(`${doctor.department}는 현재 비대면 진료 가능 진료과로 설정되어 있지 않습니다`);
    }
    return doctor;
  }

  async createSession(data: { patientId: string; doctorId?: string; scheduledAt: string; sessionType: string; chiefComplaint?: string }) {
    const doctor = await this.resolveDoctor(data.doctorId);
    const roomId = `th-${randomBytes(8).toString('hex')}`;
    return this.prisma.telehealthSession.create({
      data: {
        patientId: data.patientId,
        doctorId: doctor.id,
        sessionType: data.sessionType,
        chiefComplaint: data.chiefComplaint,
        scheduledAt: new Date(data.scheduledAt),
        roomId,
      },
      include: {
        patient: { select: { familyName: true, givenName: true, mrn: true } },
        doctor: { select: { familyName: true, givenName: true, department: true } },
      },
    });
  }

  async getSessions(doctorId?: string, status?: string, date?: string) {
    assertDateParam(date, '조회일');
    const where: Record<string, unknown> = {};
    if (doctorId) where.doctorId = doctorId;
    if (status) where.status = status;
    if (date) {
      const d = new Date(date);
      where.scheduledAt = { gte: d, lt: new Date(d.getTime() + 86400000) };
    }
    return this.prisma.telehealthSession.findMany({
      where,
      include: {
        patient: { select: { id: true, familyName: true, givenName: true, mrn: true } },
        doctor: { select: { id: true, familyName: true, givenName: true, department: true } },
      },
      orderBy: { scheduledAt: 'asc' },
    });
  }

  async getSession(id: string) {
    const session = await this.prisma.telehealthSession.findUnique({
      where: { id },
      include: {
        patient: { select: { id: true, familyName: true, givenName: true, mrn: true, dateOfBirth: true, gender: true } },
        doctor: { select: { id: true, familyName: true, givenName: true, department: true } },
      },
    });
    if (!session) throw new NotFoundException('원격진료 세션을 찾을 수 없습니다');
    return session;
  }

  async startSession(id: string) {
    const session = await this.prisma.telehealthSession.findUnique({ where: { id } });
    if (!session) throw new NotFoundException('세션을 찾을 수 없습니다');

    // 🔴 종전에는 Encounter 가 **종료 시에만** 생겼다. 그래서 진료 중 의사 차트에서 고른 진단과
    //    입력한 처방을 붙일 곳이 없어 화면에만 쌓이다 사라졌다(환자는 처방을 못 받는다).
    //    진료를 시작하면 기록도 시작된다 — 처방은 정본 경로(`/encounters/:id/prescriptions`, DUR 게이트)로 들어간다.
    let encounterId = session.encounterId;
    if (!encounterId) {
      const encounter = await this.prisma.encounter.create({
        data: {
          patientId: session.patientId,
          doctorId: session.doctorId,
          // 🔴 (2026-09-15 D3) 주호소가 없으면 '원격진료'(진료 형태)를 주호소로 적었다 — 환자가 호소한 적 없는
          //    말이 진료기록 주호소가 된다. 칸은 nullable — 없으면 비워 둔다(형태는 objective 에 이미 있다).
          chiefComplaint: session.chiefComplaint ?? null,
          subjective: session.chiefComplaint ?? '',
          objective: `원격진료 (${session.sessionType === 'VIDEO' ? '화상' : session.sessionType === 'AUDIO' ? '음성' : '비동기'}) 진행 중`,
          // Encounter 는 DRAFT 로 시작한다(서명은 종료 시) — 진행 중 기록을 서명된 것처럼 만들지 않는다
          status: 'DRAFT',
        },
      });
      encounterId = encounter.id;
    }

    return this.prisma.telehealthSession.update({
      where: { id },
      data: { status: 'IN_PROGRESS', startedAt: new Date(), encounterId },
    });
  }

  async endSession(id: string, notes?: string, diagnosisCode?: string) {
    const session = await this.prisma.telehealthSession.findUnique({
      where: { id },
      include: { patient: { select: { id: true } } },
    });
    if (!session) throw new NotFoundException('세션을 찾을 수 없습니다');
    const duration = session.startedAt ? Math.round((Date.now() - session.startedAt.getTime()) / 60000) : undefined;

    /**
     * 🔴 (2026-09-16 G3) 진료기록·청구·세션 종료는 **한 트랜잭션**이다.
     *    종전엔 셋을 따로 커밋해, 청구 생성이나 세션 종료가 실패하면 세션은 여전히 진행 중이고
     *    `session.encounterId` 도 비어 있어 **다시 종료하면 진료기록과 청구가 한 벌 더** 생겼다
     *    (중복 진료기록 + 중복 청구). 자격·수가 조회 같은 읽기는 트랜잭션 **밖**에서 끝낸다.
     */
    // 1. 진료기록·청구에 필요한 읽기 — 트랜잭션 밖에서 끝낸다(외부·장시간 호출을 트랜잭션에 넣지 않는다)
    let encounterId = session.encounterId;
    if (!encounterId) {
      // 초진 판정 — 아직 이번 진료기록을 만들기 전이므로 "다른 SIGNED 진료기록이 있는가"와 같다
      const isInitial = !(await this.prisma.encounter.findFirst({
        where: { patientId: session.patientId, status: 'SIGNED' },
      }));
      // 🔴 종전 `copayRate = 0.3` 하드코딩은 의료급여·산재·자보(전부 0%) 환자를 30% 과다청구했다.
      //    정본 resolveCopayRate(자격조회 우선·보험유형 폴백)로 자격을 반영한다.
      //    🔴 encounterId 는 넘기지 않는다 — 이 경로가 만드는 진료기록은 `eligibilityCheckId` 가 없어
      //    넘겨도 항상 환자 단위 조회로 떨어진다(같은 결과·트랜잭션 밖에서 미리 구한다).
      const patient = await this.prisma.patient.findUnique({ where: { id: session.patientId }, select: { insuranceType: true } });
      const { rate: copayRate, copayCategory } = await this.eligibility.resolveCopayRate(
        session.patientId, patient?.insuranceType ?? 'NHI', 'OUTPATIENT',
      );
      /**
       * 🔴 **청구에 라인을 붙인다**(2026-09-03 실측으로 봉합).
       *    종전엔 `billing.create` 에 `items` 가 없어 **라인 0개 청구**를 만들었고,
       *    그 상태로 수납까지 됐다(EDI/ERP 로 나갈 수 없는 청구). 정합성 32번이 잡은 그것이다.
       *    라인은 진찰료 코드(종별 초진·재진 — billing/consultation-code)를 마스터에서 찾아 붙인다.
       *    🔴 코드가 마스터에 없으면 **조용히 헤더만 만들지 않는다** — 소리내어 남긴다
       *    (수가 마스터 보정은 사람 몫 · billing.service 와 같은 방송).
       */
      // 🔴 (2026-10-14 수납·청구 결함 발굴 P5-3) 재진 코드는 외래 청구 정본과 같은 AA257 — 종전 AA261 은 수가 마스터에 없어
      //    재진 원격진료는 **라인 0개**였고, 헤더 금액은 라인과 무관한 하드코딩(초진 21,100 · 재진 11,690)이었다.
      // 🔴 (2026-10-20) 코드는 종별 정본(`billing.institution.grade`)으로 — 외래 청구와 같은 함수(종전 상급종합 고정)
      const consultCode = consultationCodeFor(await readInstitutionGrade(this.prisma), isInitial);
      const asOf = new Date();
      const consultProc = consultCode == null ? null : await this.prisma.procedureCode.findFirst({
        where: { code: consultCode, validFrom: { lte: asOf }, OR: [{ validTo: null }, { validTo: { gte: asOf } }] },
        orderBy: { validFrom: 'desc' },
      });
      await this.tierPrice?.apply([consultProc]); // 진찰료 단가 = 외래 청구와 같은 고시 종별 단가(종별 명시 설정 때만)
      // 2. 쓰기 — 진료기록·청구·세션 종료를 한 트랜잭션으로(셋 다 커밋되거나 셋 다 아니다)
      const { updated, newEncounterId } = await this.prisma.$transaction(async (tx) => {
        const encounter = await tx.encounter.create({
          data: {
            patientId: session.patientId,
            doctorId: session.doctorId,
            // 🔴 (2026-09-15 D3) 주호소가 없으면 '원격진료'(진료 형태)를 주호소로 적었다 — 환자가 호소한 적 없는
            //    말이 진료기록 주호소가 된다. 칸은 nullable — 없으면 비워 둔다(형태는 objective 에 이미 있다).
            chiefComplaint: session.chiefComplaint ?? null,
            subjective: session.chiefComplaint ?? '',
            objective: `원격진료 (${session.sessionType === 'VIDEO' ? '화상' : session.sessionType === 'AUDIO' ? '음성' : '비동기'}, ${duration ?? 0}분)`,
            assessment: notes ?? '',
            plan: '',
            status: 'SIGNED',
          },
        });
        // 헤더 금액은 라인에서 나온다(라인 없으면 0 — 지어내지 않는다 · 아래에서 코드 미등재를 알린다) · 자격 구분을 청구에 동결
        const consultFee = consultProc?.unitPrice ?? 0;
        const patientCopay = Math.round(consultFee * copayRate);
        await tx.billing.create({
          data: {
            encounterId: encounter.id,
            patientId: session.patientId,
            totalAmount: consultFee,
            insuranceCovered: consultFee - patientCopay,
            patientCopay,
            copayCategory: copayCategory ?? null,
            status: 'PENDING',
            ...(consultProc ? {
              items: { create: [{
                codeType: 'PROCEDURE', codeId: consultProc.id, codeName: consultProc.nameKo,
                quantity: 1, unitPrice: consultFee, amount: consultFee,
                copayRate, fullCopay: copayRate >= 1, insuranceCategory: 'COVERED',
              }] },
            } : {}),
          },
        });
        const updated = await tx.telehealthSession.update({
          where: { id },
          data: {
            status: 'COMPLETED',
            endedAt: new Date(),
            durationMinutes: duration,
            notes,
            encounterId: encounter.id,
          },
        });
        return { updated, newEncounterId: encounter.id };
      });
      // 커밋된 뒤에 알린다 — 수가 마스터 보정은 사람 몫이고, 알림 실패가 진료·청구를 되돌리지 않는다
      if (!consultProc) {
        this.logger.error(`원격진료 진찰료 코드 미등재 — 청구에 라인을 붙이지 못합니다 (code=${consultCode}, encounter=${newEncounterId})`);
        this.events?.emit('billing.consult_code_missing', { encounterId: newEncounterId, code: consultCode });
      }
      return updated;
    }

    // 3. 이미 진료기록이 연결된 세션은 종료만 한다
    return this.prisma.telehealthSession.update({
      where: { id },
      data: {
        status: 'COMPLETED',
        endedAt: new Date(),
        durationMinutes: duration,
        notes,
        encounterId,
      },
    });
  }

  async cancelSession(id: string) {
    return this.prisma.telehealthSession.update({
      where: { id },
      data: { status: 'CANCELLED' },
    });
  }

  async patientJoin(id: string) {
    return this.prisma.telehealthSession.update({
      where: { id },
      data: { status: 'WAITING' },
    });
  }

  // 비동기 진료
  async submitPatientMessage(id: string, message: string, photos?: unknown[]) {
    return this.prisma.telehealthSession.update({
      where: { id },
      data: { patientMessage: message, patientPhotos: photos as never, status: 'WAITING' },
    });
  }

  async submitDoctorReply(id: string, reply: string) {
    return this.prisma.telehealthSession.update({
      where: { id },
      data: { doctorReply: reply, status: 'COMPLETED', endedAt: new Date() },
    });
  }

  // 처방 연동
  async markPrescriptionIssued(id: string) {
    return this.prisma.telehealthSession.update({
      where: { id },
      data: { prescriptionIssued: true },
    });
  }

  /** 약사 처방 검토 의견 저장 */
  async submitPharmacyReview(id: string, userId: string, review: string) {
    return this.prisma.telehealthSession.update({
      where: { id },
      data: {
        pharmacyReview: review,
        pharmacyReviewBy: userId,
        pharmacyReviewAt: new Date(),
      },
    });
  }

  /** 약사 검토 의견 조회 */
  async getPharmacyReview(id: string) {
    const session = await this.prisma.telehealthSession.findUnique({
      where: { id },
      select: { pharmacyReview: true, pharmacyReviewBy: true, pharmacyReviewAt: true },
    });
    if (!session) throw new NotFoundException('세션을 찾을 수 없습니다');
    return session;
  }

  /** 세션 내 처방 목록 (약사용 실시간 조회) */
  async getSessionPrescriptions(id: string) {
    const session = await this.prisma.telehealthSession.findUnique({
      where: { id },
      select: { encounterId: true, patientId: true },
    });
    if (!session) throw new NotFoundException('세션을 찾을 수 없습니다');

    if (session.encounterId) {
      return this.prisma.prescription.findMany({
        where: { encounterId: session.encounterId },
        include: { medicationCode: { select: { nameKo: true, nameEn: true, ingredient: true, dosageForm: true } } },
        orderBy: { createdAt: 'desc' },
      });
    }
    // Encounter 미생성 시 환자 최근 처방 (encounter 경유)
    return this.prisma.prescription.findMany({
      where: { encounter: { patientId: session.patientId } },
      include: { medicationCode: { select: { nameKo: true, nameEn: true, ingredient: true, dosageForm: true } } },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });
  }

  // 통계
  async getStats(doctorId?: string) {
    const where = doctorId ? { doctorId } : {};
    const [total, completed, today, avgRating] = await Promise.all([
      this.prisma.telehealthSession.count({ where }),
      this.prisma.telehealthSession.count({ where: { ...where, status: 'COMPLETED' } }),
      // 🔴 '오늘 예정'은 상한(내일 00시)이 있어야 한다 — 하한만 걸면 다음 주 예약까지 전부 오늘로 합산(W3 반복 패턴)
      this.prisma.telehealthSession.count({ where: { ...where, scheduledAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)), lt: new Date(new Date(new Date().setHours(0, 0, 0, 0)).getTime() + 86400000) } } }),
      this.prisma.telehealthSession.aggregate({ where: { ...where, patientRating: { not: null } }, _avg: { patientRating: true } }),
    ]);
    return { total, completed, today, avgRating: avgRating._avg.patientRating };
  }

  // 데모 세션 생성 (환자/의사 자동 매칭)
  async createDemoSession(userId: string, sessionType: string) {
    const patient = await this.prisma.patient.findFirst({
      where: { isDeceased: false },
      select: { id: true, familyName: true, givenName: true },
      orderBy: { createdAt: 'desc' },
    });
    if (!patient) throw new BadRequestException('테스트 환자가 없습니다. 시드 데이터를 실행하세요.');

    const doctor = await this.prisma.user.findFirst({
      where: { role: 'DOCTOR', isActive: true },
      select: { id: true, familyName: true, givenName: true, department: true },
    });
    // 🔴 종전엔 의사가 없으면 **호출자(관리자·간호사)를 담당의로 박았다.** 담당의가 아닌 사람을
    //    담당의라고 적느니, 데모 세션을 만들지 않는 편이 사실이다.
    if (!doctor) throw new BadRequestException('활성 상태의 의사 계정이 없어 데모 세션을 만들 수 없습니다');

    const complaints = [
      '두통이 3일째 지속됩니다. 진통제가 효과 없습니다.',
      '최근 혈압이 높아져서 약 조절 상담을 원합니다.',
      '피부에 붉은 반점이 생겼습니다. 가려움증 동반.',
      '기침과 가래가 1주일째 계속됩니다.',
      '허리 통증으로 일상생활이 어렵습니다.',
    ];

    const roomId = `demo-${randomBytes(6).toString('hex')}`;
    const session = await this.prisma.telehealthSession.create({
      data: {
        patientId: patient.id,
        doctorId: doctor.id,
        scheduledAt: new Date(),
        sessionType,
        chiefComplaint: complaints[Math.floor(Math.random() * complaints.length)],
        roomId,
        status: 'WAITING',
      },
      include: {
        patient: { select: { familyName: true, givenName: true, mrn: true } },
        doctor: { select: { familyName: true, givenName: true, department: true } },
      },
    });

    return session;
  }

  // 포털용: 환자 세션 목록
  async getPatientSessions(patientId: string) {
    return this.prisma.telehealthSession.findMany({
      where: { patientId },
      include: { doctor: { select: { familyName: true, givenName: true, department: true } } },
      orderBy: { scheduledAt: 'desc' },
      take: 20,
    });
  }
}
