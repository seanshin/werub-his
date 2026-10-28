import { Injectable, Logger, NotFoundException, BadRequestException, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { JourneyService } from '../journey/journey.service';
import { ConfigRuntimeService } from '../config/config-runtime.service';
import { gateMode } from '../../common/gate-mode';
import { enforceGate, type GateWarning } from '../../common/gate-enforce';
// 게이트 위반 원장 — WARN 도 남아야 모아 오식별 축의 승격 근거가 생긴다
import { SafetyGateService } from '../safety-gate/safety-gate.service';
import { CreateDeliveryDto, UpdateDeliveryDto, CreateNewbornDto, AddLaborProgressDto } from './dto/delivery.dto';
import { specialtyTodayList, specialtyTodayStats, specialtyRecordPatients } from '../../common/specialty-board';
// 환자확인 판정 정본 — 선언이 아니라 대조 항목에서 PASS/FAIL 을 유도한다(IPSG.1)
import { identityVerdict, identityReasonForStore } from '../../common/identity-check-verdict';

const PT_SEL = { id: true, familyName: true, givenName: true, mrn: true } as const;

/** 모아 식별밴드 대조의 환자확인 유형 — 원장(IPSG.1) 검색·통계가 이 값으로 센다 */
export const MOTHER_BABY_CHECK_TYPE = 'MOTHER_BABY';
/** 대조 실패 사유(고정) — 어느 밴드가 틀렸는지는 원장의 `verifiedItems` 가 기계로 말한다 */
export const MOTHER_BABY_MISMATCH_REASON = '모아 식별밴드 불일치';

@Injectable()
export class ObGynService {
  private readonly logger = new Logger(ObGynService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly events?: EventEmitter2,
    @Optional() private readonly journey?: JourneyService,
    @Optional() private readonly configRuntime?: ConfigRuntimeService,
    @Optional() private readonly gates?: SafetyGateService,
  ) {}

  /* ───── Patients ───── */

  /** 기록이 있는 환자 — 최근 기록 순 상한 + 전체 수·잘림(정본 specialtyRecordPatients · 2026-10-10) */
  async getPatients() {
    return specialtyRecordPatients(this.prisma, (a) => this.prisma.obGynExam.groupBy(a as never), 'examinedAt');
  }

  /* ───── Exams ───── */

  async getExams(patientId: string, examType?: string) {
    return this.prisma.obGynExam.findMany({
      where: {
        patientId,
        ...(examType ? { examType } : {}),
      },
      include: { examiner: { select: { familyName: true, givenName: true } } },
      orderBy: { examinedAt: 'desc' }, take: 200,
    });
  }

  async createExam(data: {
    patientId: string; encounterId?: string;
    examType: 'PRENATAL' | 'GYNECOLOGY' | 'LABOR' | 'POSTPARTUM';
    gestationalAge?: string; edd?: string;
    gravida?: number; para?: number;
    prePregnancyWeight?: number; currentWeight?: number;
    bloodPressure?: string; urineProtein?: string; urineGlucose?: string;
    edema?: string; fundalHeight?: number;
    fetalHeartRate?: number; fetalMovement?: string;
    ultrasound?: unknown; nst?: unknown;
    cervicalDilation?: number; effacement?: number; station?: number;
    papSmear?: string; hpvTest?: string; pelvicUltrasound?: unknown;
    diagnosis?: string; plan?: string;
    examinedBy: string;
  }) {
    const exam = await this.prisma.obGynExam.create({
      data: {
        patientId: data.patientId,
        encounterId: data.encounterId,
        examType: data.examType,
        gestationalAge: data.gestationalAge,
        edd: data.edd ? new Date(data.edd) : undefined,
        gravida: data.gravida,
        para: data.para,
        prePregnancyWeight: data.prePregnancyWeight,
        currentWeight: data.currentWeight,
        bloodPressure: data.bloodPressure,
        urineProtein: data.urineProtein,
        urineGlucose: data.urineGlucose,
        edema: data.edema,
        fundalHeight: data.fundalHeight,
        fetalHeartRate: data.fetalHeartRate,
        fetalMovement: data.fetalMovement,
        ultrasound: data.ultrasound as never,
        nst: data.nst as never,
        cervicalDilation: data.cervicalDilation,
        effacement: data.effacement,
        station: data.station,
        papSmear: data.papSmear,
        hpvTest: data.hpvTest,
        pelvicUltrasound: data.pelvicUltrasound as never,
        diagnosis: data.diagnosis,
        plan: data.plan,
        examinedBy: data.examinedBy,
      },
      include: { patient: { select: { familyName: true, givenName: true, mrn: true } } },
    });

    // 전자간증 경보(P3) — 중증 고혈압(수축기≥160 또는 이완기≥110) + 요단백 양성 시 산모 담당의 통지.
    const bp = this.parseBp(data.bloodPressure);
    const proteinuria = /[1-9]\s*\+|\bpos|양성/i.test(data.urineProtein ?? '');
    if (bp && (bp.sys >= 160 || bp.dia >= 110) && proteinuria) {
      this.events?.emit('obgyn.preeclampsia', { patientId: data.patientId, examId: exam.id, bloodPressure: data.bloodPressure, urineProtein: data.urineProtein });
    }
    return exam;
  }

  private parseBp(bp?: string): { sys: number; dia: number } | null {
    if (!bp) return null;
    const m = bp.match(/(\d{2,3})\s*\/\s*(\d{2,3})/);
    return m ? { sys: Number(m[1]), dia: Number(m[2]) } : null;
  }

  /* ───── 분만(Labor & Delivery) ───── */

  private async attachPatients<T extends { patientId: string }>(rows: T[]): Promise<(T & { patient: { id: string; familyName: string | null; givenName: string | null; mrn: string | null } | null })[]> {
    const ids = [...new Set(rows.map((r) => r.patientId))];
    const pats = ids.length ? await this.prisma.patient.findMany({ where: { id: { in: ids } }, select: PT_SEL }) : [];
    const m = new Map(pats.map((p) => [p.id, p]));
    return rows.map((r) => ({ ...r, patient: m.get(r.patientId) ?? null }));
  }

  /** 분만 개시(진통 입원) */
  async createDelivery(dto: CreateDeliveryDto) {
    return this.prisma.deliveryRecord.create({
      data: {
        patientId: dto.patientId, encounterId: dto.encounterId ?? null,
        gestationalWeeks: dto.gestationalWeeks ?? null,
        laborOnsetAt: dto.laborOnsetAt ? new Date(dto.laborOnsetAt) : new Date(),
      },
    });
  }

  // 분만 상태 전이 규칙(단방향). 종말상태(CLOSED)에서 되돌리기·역행 금지.
  private static readonly DELIVERY_TRANSITIONS: Record<string, string[]> = {
    IN_LABOR: ['DELIVERED'],
    DELIVERED: ['POSTPARTUM', 'CLOSED'],
    POSTPARTUM: ['CLOSED'],
    CLOSED: [],
  };

  /** 분만 갱신(분만 완료·산욕) */
  async updateDelivery(id: string, dto: UpdateDeliveryDto, userId: string) {
    const d = await this.prisma.deliveryRecord.findUnique({ where: { id } });
    if (!d) throw new NotFoundException('분만 기록 없음');
    // 종말상태(CLOSED)는 확정 기록 — 상태전이뿐 아니라 임상필드(분만유형·출혈량·시각 등) 변조도 차단.
    // 정정이 필요하면 별도 개정(amend/재서명) 흐름이어야 하며, 조용한 덮어쓰기는 불가.
    if (d.status === 'CLOSED') throw new BadRequestException({ code: 'DELIVERY_CLOSED', message: '종료된 분만 기록은 수정할 수 없습니다(개정 흐름 필요)' });
    const data: Prisma.DeliveryRecordUncheckedUpdateInput = { ...dto } as Prisma.DeliveryRecordUncheckedUpdateInput;
    if (dto.deliveredAt) data.deliveredAt = new Date(dto.deliveredAt);
    if (dto.deliveryType && !d.deliveredBy) data.deliveredBy = userId;

    // 명시적 상태 전이 검증(역행·되살리기 차단). deliveryType 기반 자동 승격은 종전 유지.
    let nextStatus = dto.status;
    if (dto.deliveryType && d.status === 'IN_LABOR' && !dto.status) nextStatus = 'DELIVERED';
    if (nextStatus && nextStatus !== d.status) {
      const allowed = ObGynService.DELIVERY_TRANSITIONS[d.status] ?? [];
      if (!allowed.includes(nextStatus)) {
        throw new BadRequestException({ code: 'DELIVERY_INVALID_TRANSITION', message: `분만 상태 ${d.status}→${nextStatus} 전이는 허용되지 않습니다` });
      }
      // DELIVERED 진입 시 분만유형·분만시각 필수(불완전 종료 방지).
      if (nextStatus === 'DELIVERED') {
        const deliveryType = dto.deliveryType ?? d.deliveryType;
        const deliveredAt = dto.deliveredAt ?? d.deliveredAt;
        if (!deliveryType || !deliveredAt) {
          throw new BadRequestException({ code: 'DELIVERY_INCOMPLETE', message: 'DELIVERED 전이에는 분만유형·분만시각이 필요합니다' });
        }
      }
      data.status = nextStatus;
    }
    return this.prisma.deliveryRecord.update({ where: { id }, data });
  }

  async getDeliveryDetail(id: string) {
    const d = await this.prisma.deliveryRecord.findUnique({
      where: { id },
      include: { newborns: true, laborProgress: { orderBy: { recordedAt: 'asc' } } },
    });
    if (!d) throw new NotFoundException('분만 기록 없음');
    const [withPt] = await this.attachPatients([d]);
    return withPt;
  }

  async addNewborn(deliveryId: string, dto: CreateNewbornDto) {
    const d = await this.prisma.deliveryRecord.findUnique({ where: { id: deliveryId } });
    if (!d) throw new NotFoundException('분만 기록 없음');
    if (d.status === 'CLOSED') throw new BadRequestException({ code: 'DELIVERY_CLOSED', message: '종료된 분만 기록에는 신생아를 추가할 수 없습니다' });
    // 모아 식별밴드 게이트(P2-B) — config obgyn.newbornId.enforce(기본 OFF·fallback 'OFF').
    //  BLOCK 시 식별밴드(idBandNo) 없이 등록 거부(신생아 오식별 sentinel 방지).
    // 🔴 2026-08-26: 종전엔 `=== 'BLOCK'` 하나만 분기해 **WARN 이 OFF 와 완전히 동일**했다.
    //    모아 오식별은 sentinel event 다 — WARN 으로 켜 두고도 밴드 없는 등록이 아무 흔적을
    //    남기지 않으면 BLOCK 승격을 판단할 근거가 영영 생기지 않는다.
    //    BLOCK 은 등록 **전에**(막아야 하므로), WARN 은 등록 **후에**(생성된 신생아를 지목해야 추적된다) 기록한다.
    const bandMode = gateMode(await this.configRuntime?.get('obgyn.newbornId.enforce'), 'OFF');
    const bandMissing = !dto.idBandNo?.trim();
    const BAND_GATE = {
      gateKey: 'obgyn.newbornId.enforce',
      code: 'NEWBORN_ID_BAND_REQUIRED',
      message: '신생아 식별밴드 번호(idBandNo) 없이 신생아 등록 — 모아 오식별 위험.',
      blockMessage: '신생아 식별밴드 번호(idBandNo)는 필수입니다 — 모아 오식별 방지.',
    } as const;
    if (bandMode === 'BLOCK') {
      await enforceGate({
        ...BAND_GATE, mode: bandMode, violated: bandMissing,
        refType: 'DeliveryRecord', refId: deliveryId,
        recorder: this.gates, logger: this.logger,
      });
    }
    const nicuAdmission = dto.nicuAdmission ?? false;
    // 출생 순번 — 미지정 시 기존 신생아 수+1 자동. 분만 행 잠금으로 동시 등록(다태아) 순번 경합 직렬화.
    // @@unique([deliveryId,birthOrder])가 최종 backstop(경합/명시지정 중복 시 P2002).
    let newborn;
    try {
      newborn = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM delivery_records WHERE id = ${deliveryId}::uuid FOR UPDATE`;
      const existingCount = await tx.newbornRecord.count({ where: { deliveryId } });
      const birthOrder = dto.birthOrder ?? existingCount + 1;
      return tx.newbornRecord.create({
        data: {
          deliveryId, sex: dto.sex, birthOrder, idBandNo: dto.idBandNo ?? null,
          motherBandNo: dto.motherBandNo ?? null,
          birthAt: dto.birthAt ? new Date(dto.birthAt) : (d.deliveredAt ?? new Date()),
          weightG: dto.weightG ?? null,
          lengthCm: dto.lengthCm != null ? new Prisma.Decimal(dto.lengthCm) : null,
          headCircCm: dto.headCircCm != null ? new Prisma.Decimal(dto.headCircCm) : null,
          apgar1: dto.apgar1 ?? null, apgar5: dto.apgar5 ?? null, apgar10: dto.apgar10 ?? null,
          resuscitation: dto.resuscitation ?? null, nicuAdmission,
          feedingType: dto.feedingType ?? null, notes: dto.notes ?? null,
        },
      });
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        const target = String((e.meta as { target?: unknown })?.target ?? '');
        if (target.includes('id_band')) throw new BadRequestException({ code: 'NEWBORN_ID_BAND_DUP', message: '이미 사용 중인 신생아 식별밴드 번호입니다 — 밴드 중복 부여 불가.' });
        throw new BadRequestException({ code: 'NEWBORN_BIRTH_ORDER_DUP', message: '출생 순번이 중복됩니다(다태아 동시 등록 경합).' });
      }
      throw e;
    }

    // WARN — 막지 않았으나 남긴다. 등록된 신생아를 지목해야 사후에 밴드를 채울 수 있다.
    let bandWarning: GateWarning | null = null;
    if (bandMode === 'WARN') {
      bandWarning = await enforceGate({
        ...BAND_GATE, mode: bandMode, violated: bandMissing,
        refType: 'NewbornRecord', refId: newborn.id,
        recorder: this.gates, logger: this.logger,
      });
    }

    // 신생아 위중(5분 Apgar<7) 또는 NICU 입원 시 능동 통지 — 기존엔 NICU/소아과에 아무 신호도 없었음.
    const lowApgar = dto.apgar5 != null && dto.apgar5 < 7;
    if (lowApgar || nicuAdmission) {
      const reasons = [
        lowApgar ? `5분 Apgar ${dto.apgar5}` : null,
        nicuAdmission ? 'NICU 입원' : null,
      ].filter(Boolean).join(' · ');
      this.events?.emit('newborn.critical', {
        deliveryId, newbornId: newborn.id, motherPatientId: d.patientId,
        apgar5: dto.apgar5 ?? null, nicuAdmission, reasons,
      });
      // 산모 여정 타임라인에 표면화(신생아 미등록 상태라 산모 기준).
      this.journey?.emit({
        patientId: d.patientId, eventType: 'NEWBORN_CRITICAL', refType: 'DeliveryRecord', refId: deliveryId, // 여정 P0-5: 원 기록 귀속
        title: `신생아 집중관리 필요 (${reasons})`,
        description: `분만 ${deliveryId} 신생아 — 소아과/NICU 평가 권고`,
      });
    }
    // 원장에만 있고 화면이 모르면 절반이다 — WARN 통과 사실을 응답에도 싣는다
    return bandWarning ? { ...newborn, warnings: [bandWarning.message] } : newborn;
  }

  /** 모아 식별 검증(P2-B) — 수유·투약 전 산모·신생아 밴드 이중 대조. 불일치 시 차단(오식별 sentinel 방지). */
  /**
   * 모아 식별밴드 대조(수유·투약 전 이중 확인).
   *
   * 🔴 (2026-09-15 D3) 종전에는 **대조 결과를 어디에도 남기지 않았다.** 불일치면 400 으로 막기만 해서,
   *    오식별 시도(= 다른 산모의 아기에게 수유·투약할 뻔한 사건)가 흔적 없이 사라졌다. 판정 규칙 §4:
   *    "체크리스트가 버튼을 막는다면 그 체크는 **서버에 남아야** 한다" · "막으면 방치된다 — 봉쇄가 아니라
   *    기록과 가시화로". 그래서 통과·불일치 **둘 다** 환자확인 원장(IPSG.1 정본 `patient_identification_checks`)에
   *    남긴다 — 판정은 선언이 아니라 대조 항목에서 유도한다(`common/identity-check-verdict.ts`).
   *    원장이 산모(patientId)에 귀속되므로 분만 기록이 없는 신생아는 기록 대상이 아니다(그 사실도 응답에 싣는다).
   */
  async verifyMotherBabyMatch(newbornId: string, scannedMotherBand: string, scannedBabyBand: string, verifiedBy?: string) {
    const nb = await this.prisma.newbornRecord.findUnique({ where: { id: newbornId }, include: { delivery: { select: { patientId: true } } } });
    if (!nb) throw new NotFoundException('신생아 기록을 찾을 수 없습니다');
    const babyOk = !!nb.idBandNo && nb.idBandNo === scannedBabyBand;
    const motherOk = !!nb.motherBandNo && nb.motherBandNo === scannedMotherBand;
    const motherPatientId = nb.delivery?.patientId ?? null;

    const outcome = identityVerdict(
      {
        verifiedItems: { motherBand: motherOk, babyBand: babyOk },
        result: babyOk && motherOk ? 'PASS' : 'FAIL',
        // 사유는 고정 문구 — **어느 쪽이 틀렸는지는 `verifiedItems` 가 기계로 말한다**(문장을 조립하지 않는다)
        failureReason: babyOk && motherOk ? undefined : MOTHER_BABY_MISMATCH_REASON,
      },
      { method: 'BARCODE' },
    );
    let recorded = false;
    if (motherPatientId && verifiedBy) {
      await this.prisma.patientIdentificationCheck.create({
        data: {
          patientId: motherPatientId,
          checkType: MOTHER_BABY_CHECK_TYPE,
          method: 'BARCODE',
          verifiedItems: outcome.items as never,
          verifiedBy,
          verifiedAt: new Date(),
          result: outcome.verdict,
          failureReason: identityReasonForStore(outcome),
        },
      });
      recorded = true;
    } else {
      this.logger.warn(`모아 대조 결과를 원장에 남기지 못했습니다 — newborn=${newbornId} 산모=${motherPatientId ?? 'null'} 확인자=${verifiedBy ?? 'null'}`);
    }

    if (outcome.verdict === 'FAIL') {
      throw new BadRequestException({
        code: 'MOTHER_BABY_MISMATCH',
        message: '모아 식별밴드 불일치 — 수유·투약 전 재확인이 필요합니다.',
        details: { babyOk, motherOk, recorded },
      });
    }
    return { matched: true, newbornId, motherPatientId, recorded };
  }

  async addLaborProgress(deliveryId: string, dto: AddLaborProgressDto, userId: string) {
    const d = await this.prisma.deliveryRecord.findUnique({ where: { id: deliveryId } });
    if (!d) throw new NotFoundException('분만 기록 없음');
    if (d.status === 'CLOSED' || d.status === 'POSTPARTUM') throw new BadRequestException({ code: 'DELIVERY_NOT_IN_LABOR', message: '진통/분만 중이 아닌 기록에는 분만진행을 추가할 수 없습니다' });
    // 🔴 (2026-10-10) 잰 값이 하나도 없는 진행 기록을 받지 않는다 — 종전 빈 버튼 클릭이 "진행 기록" 행을 만들었다
    const { recordedAt: rawAt, ...values } = dto;
    const measured = (['cervicalDilation', 'station', 'contractionFreq', 'contractionDur', 'fetalHeartRate'] as const).some((k) => values[k] != null);
    if (!measured) throw new BadRequestException({ code: 'LABOR_PROGRESS_EMPTY', message: '잰 값이 하나도 없습니다 — 개대·하강도·수축·태아심박 중 하나 이상을 기록하세요' });
    // 측정 시각 — 비우면 저장 시각(DB 기본값) · 미래는 받지 않는다
    let recordedAt: Date | undefined;
    if (rawAt) {
      recordedAt = new Date(rawAt);
      if (Number.isNaN(recordedAt.getTime())) throw new BadRequestException({ code: 'LABOR_PROGRESS_TIME_INVALID', message: '측정 시각 형식이 아닙니다' });
      if (recordedAt.getTime() > Date.now() + 5 * 60_000) throw new BadRequestException({ code: 'LABOR_PROGRESS_TIME_FUTURE', message: '측정 시각이 미래입니다' });
    }
    const rec = await this.prisma.laborProgressRecord.create({
      data: { deliveryId, ...values, ...(recordedAt ? { recordedAt } : {}), recordedBy: userId },
    });

    // 태아곤란 경보(P3) — 태아심박수(FHR) 정상 110~160 이탈(서맥<110·빈맥>160) 시 산모 담당의 통지.
    const fhr = dto.fetalHeartRate;
    if (fhr != null && (fhr < 110 || fhr > 160)) {
      this.events?.emit('labor.fetal_distress', { deliveryId, patientId: d.patientId, fhr, type: fhr < 110 ? 'BRADYCARDIA' : 'TACHYCARDIA' });
    }
    return rec;
  }

  /** L&D 보드 — 진행 중 분만 + 오늘 분만 완료 */
  async getBoard() {
    const [inLabor, todayDelivered] = await Promise.all([
      this.prisma.deliveryRecord.findMany({
        where: { status: { in: ['IN_LABOR', 'DELIVERED', 'POSTPARTUM'] } },
        // 🔴 밴드 등록 여부를 화면이 알아야 한다 — 모르면 "대조 불가"와 "대조 실패"를 구분할 수 없다.
        //    번호 자체는 대조 입력의 정답이 되므로 내려보내지 않는다(화면에 답이 보이면 대조가 아니다).
        include: {
          newborns: {
            select: {
              id: true, sex: true, apgar1: true, apgar5: true, nicuAdmission: true,
              idBandNo: true, motherBandNo: true,
            },
          },
          laborProgress: { orderBy: { recordedAt: 'desc' }, take: 1 },
        },
        orderBy: { laborOnsetAt: 'asc' },
      }),
      this.prisma.deliveryRecord.count({ where: { deliveredAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) } } }),
    ]);
    const rows = await this.attachPatients(inLabor);
    const now = Date.now();
    const items = rows.map((r) => ({
      ...r,
      // 🔴 밴드 **번호는 내려보내지 않고** 등록 여부만 내려보낸다.
      //    화면에 정답이 보이면 대조는 대조가 아니라 베껴 쓰기가 된다(숨기는 방향으로는 자동이 없다).
      newborns: r.newborns.map(({ idBandNo, motherBandNo, ...n }) => ({
        ...n,
        bandsRegistered: !!idBandNo && !!motherBandNo,
      })),
      name: r.patient ? `${r.patient.familyName ?? ''}${r.patient.givenName ?? ''}` : '-',
      mrn: r.patient?.mrn ?? '-',
      laborMins: r.laborOnsetAt ? Math.floor((now - new Date(r.laborOnsetAt).getTime()) / 60000) : null,
      latestProgress: r.laborProgress[0] ?? null,
    }));
    return {
      summary: {
        inLabor: items.filter((i) => i.status === 'IN_LABOR').length,
        delivered: items.filter((i) => i.status === 'DELIVERED').length,
        postpartum: items.filter((i) => i.status === 'POSTPARTUM').length,
        todayDelivered,
      },
      items,
    };
  }

  /* ───── Today / Stats (실구현) ───── */

  async getToday() {
    // 🔴 라벨은 '오늘 예약'인데 검사·시술 기록을 반환하고 있었다(환자명·시간 칸이 전부 '-' 였던 원인).
    //    정본 = Appointment. 종전 목록은 각 과의 exams/records EP 로 계속 볼 수 있다.
    return specialtyTodayList(this.prisma, 'obgyn');
  }

  async getStats() {
    const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    const [totalExams, deliveredThisMonth, byType, nicuCount] = await Promise.all([
      this.prisma.obGynExam.count(),
      this.prisma.deliveryRecord.count({ where: { deliveredAt: { gte: monthStart } } }),
      this.prisma.deliveryRecord.groupBy({ by: ['deliveryType'], _count: { id: true }, where: { deliveredAt: { gte: monthStart }, deliveryType: { not: null } } }),
      this.prisma.newbornRecord.count({ where: { nicuAdmission: true, createdAt: { gte: monthStart } } }),
    ]);
    const cesarean = byType.find((b) => b.deliveryType === 'CESAREAN')?._count.id ?? 0;
    return {
      ...(await specialtyTodayStats(this.prisma, 'obgyn')),
      totalExams,
      inLabor: await this.prisma.deliveryRecord.count({ where: { status: 'IN_LABOR' } }),
      deliveredThisMonth,
      // 🔴 (2026-09-16 J3) 분만 0건인 달에 제왕절개율 `0%` 를 그렸다 — 제왕절개율은 인증·QI 지표라
      //    "0%" 는 **가장 좋은 성적**으로 읽힌다(P17: 근거 없이 안심시킴). 표본이 없으면 산출하지 않는다.
      cesareanRate: deliveredThisMonth > 0 ? Math.round((cesarean / deliveredThisMonth) * 100) : null,
      // 사유는 **코드**로 내려보낸다(문장을 서버가 조립하면 화면 언어를 바꿔도 한국어로 남는다)
      cesareanRateUnavailableReason: deliveredThisMonth > 0 ? null : 'NO_DELIVERIES',
      byType: byType.map((b) => ({ type: b.deliveryType, count: b._count.id })),
      nicuThisMonth: nicuCount,
    };
  }
}
