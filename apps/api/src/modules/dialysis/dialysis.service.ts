import { Injectable, Logger, NotFoundException, BadRequestException, ConflictException, Optional } from '@nestjs/common';
import { todayDateOnly, dateOnlyValue } from '../../common/day-range';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { ConfigRuntimeService } from '../config/config-runtime.service';
import { gateMode } from '../../common/gate-mode';
import { enforceGate, type GateWarning } from '../../common/gate-enforce';
// 게이트 위반 원장 — UF율 상한 초과 처방이 WARN 에서도 남아야 승격 근거가 생긴다
import { SafetyGateService } from '../safety-gate/safety-gate.service';
import { mergeTargetMap } from '../../common/qi-targets';

// UF 안전 기준 코드 기본 — 개정 표면 = config dialysis.ufLimits(부분 병합·§7 P1)
const UF_LIMIT_DEFAULTS = { maxRateMlKgHr: 13, underDryWeightToleranceKg: 1 };

@Injectable()
export class DialysisService {
  private readonly logger = new Logger(DialysisService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly configRuntime?: ConfigRuntimeService,
    @Optional() private readonly gates?: SafetyGateService,
  ) {}

  private async ufLimits() {
    return mergeTargetMap(UF_LIMIT_DEFAULTS, await this.configRuntime?.get('dialysis.ufLimits').catch(() => null));
  }

  /* ───── Orders ───── */

  async createOrder(data: {
    patientId: string; modality: string; frequency: string; duration: number;
    dialyzerType?: string; bloodFlowRate?: number; dialysateFlow?: number;
    dryWeight?: number; ufGoal?: number; anticoagulant?: string; accessType?: string;
    pdSolution?: string; pdVolume?: number; pdExchanges?: number; dwellTime?: number;
    prescribedBy: string; startDate: string; notes?: string;
  }) {
    // UF율 게이트(P3) — 시간당 제수율(ufGoal mL / (duration h) / dryWeight kg) 상한(~13mL/kg/hr) 초과 시 처방 차단.
    //  과속 제수는 투석 중 저혈압 유발. config dialysis.ufRateEnforce(기본 OFF·fallback 'OFF').
    // 🔴 2026-08-26: 종전엔 `=== 'BLOCK'` 하나만 분기해 **WARN 이 OFF 와 완전히 동일**했다 —
    //    WARN 에서 상한 초과 처방이 무기록 통과했다. 3상 정본으로 맞춘다(BLOCK 동작 불변).
    // 🔴 평가 모집단은 **UF율을 계산할 수 있는 처방**뿐이다(ufGoal·duration·dryWeight 셋 다 있는 건).
    //    셋 중 하나라도 없으면 제수율을 모르는 것이지 "안전"이 아니다 — 모르는 것을 위반으로 세지 않는다
    //    (거짓 경보는 진짜 경보를 죽인다). 입력 누락은 이 게이트가 아니라 DTO 가 다룰 일이다.
    let ufGate: { mode: ReturnType<typeof gateMode>; violated: boolean; message: string } | null = null;
    if (data.ufGoal && data.duration && data.dryWeight) {
      const hours = data.duration / 60; // duration=분
      const ufRate = hours > 0 ? data.ufGoal / hours / data.dryWeight : 0; // mL/kg/hr
      const maxRate = (await this.ufLimits()).maxRateMlKgHr;
      ufGate = {
        mode: gateMode(await this.configRuntime?.get('dialysis.ufRateEnforce'), 'OFF'),
        violated: ufRate > maxRate,
        message: `시간당 제수율 ${ufRate.toFixed(1)}mL/kg/hr이 안전상한(${maxRate}mL/kg/hr)을 초과합니다 — 투석시간 연장 또는 UF목표 하향 필요.`,
      };
      if (ufGate.mode === 'BLOCK') {
        // BLOCK 은 처방 생성 **전에** 막는다(원장에도 남는다)
        await enforceGate({
          gateKey: 'dialysis.ufRateEnforce', mode: ufGate.mode, violated: ufGate.violated,
          code: 'DIALYSIS_UF_RATE_EXCEEDED', message: ufGate.message,
          refType: 'Patient', refId: data.patientId,
          recorder: this.gates, logger: this.logger,
        });
      }
    }
    const created = await this.prisma.dialysisOrder.create({
      data: {
        patientId: data.patientId,
        modality: data.modality,
        frequency: data.frequency,
        duration: data.duration,
        dialyzerType: data.dialyzerType,
        bloodFlowRate: data.bloodFlowRate,
        dialysateFlow: data.dialysateFlow,
        dryWeight: data.dryWeight != null ? new Prisma.Decimal(data.dryWeight) : undefined,
        ufGoal: data.ufGoal,
        anticoagulant: data.anticoagulant,
        accessType: data.accessType,
        pdSolution: data.pdSolution,
        pdVolume: data.pdVolume,
        pdExchanges: data.pdExchanges,
        dwellTime: data.dwellTime,
        prescribedBy: data.prescribedBy,
        startDate: new Date(data.startDate),
        notes: data.notes,
      },
      include: { patient: { select: { familyName: true, givenName: true, mrn: true } } },
    });

    // WARN — 막지 않았으나 남긴다. 생성된 처방을 지목해야 사후에 UF목표를 조정할 수 있다.
    let ufWarning: GateWarning | null = null;
    if (ufGate && ufGate.mode === 'WARN') {
      ufWarning = await enforceGate({
        gateKey: 'dialysis.ufRateEnforce', mode: ufGate.mode, violated: ufGate.violated,
        code: 'DIALYSIS_UF_RATE_EXCEEDED', message: ufGate.message,
        refType: 'DialysisOrder', refId: created.id,
        recorder: this.gates, logger: this.logger,
      });
    }
    return ufWarning ? { ...created, warnings: [ufWarning.message] } : created;
  }

  async getOrders(params?: { patientId?: string; isActive?: boolean }) {
    const where: Record<string, unknown> = {};
    if (params?.patientId) where.patientId = params.patientId;
    if (params?.isActive !== undefined) where.isActive = params.isActive;
    return this.prisma.dialysisOrder.findMany({
      where,
      include: {
        patient: { select: { familyName: true, givenName: true, mrn: true } },
        _count: { select: { sessions: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getOrderDetail(id: string) {
    const order = await this.prisma.dialysisOrder.findUnique({
      where: { id },
      include: {
        patient: { select: { familyName: true, givenName: true, mrn: true } },
        prescriber: { select: { familyName: true, givenName: true } },
        sessions: { orderBy: { scheduledDate: 'desc' }, take: 20 },
      },
    });
    if (!order) throw new NotFoundException('투석 처방을 찾을 수 없습니다');
    return order;
  }

  async updateOrder(id: string, data: {
    isActive?: boolean; endDate?: string; frequency?: string;
    duration?: number; dryWeight?: number; ufGoal?: number;
    anticoagulant?: string; notes?: string;
  }) {
    const order = await this.prisma.dialysisOrder.findUnique({ where: { id } });
    if (!order) throw new NotFoundException('투석 처방을 찾을 수 없습니다');
    return this.prisma.dialysisOrder.update({
      where: { id },
      data: {
        ...(data.isActive !== undefined && { isActive: data.isActive }),
        ...(data.endDate && { endDate: new Date(data.endDate) }),
        ...(data.frequency && { frequency: data.frequency }),
        ...(data.duration && { duration: data.duration }),
        ...(data.dryWeight != null && { dryWeight: new Prisma.Decimal(data.dryWeight) }),
        ...(data.ufGoal != null && { ufGoal: data.ufGoal }),
        ...(data.anticoagulant !== undefined && { anticoagulant: data.anticoagulant }),
        ...(data.notes !== undefined && { notes: data.notes }),
      },
    });
  }

  /* ───── Sessions ───── */

  async generateSessions(data: { orderId: string; year: number; month: number }) {
    const order = await this.prisma.dialysisOrder.findUnique({ where: { id: data.orderId } });
    if (!order) throw new NotFoundException('투석 처방을 찾을 수 없습니다');
    if (!order.isActive) throw new BadRequestException('비활성 처방입니다');

    // frequency 파싱: "주 3회" → 3, "매일" → 7
    const freqMatch = order.frequency.match(/(\d+)/);
    const perWeek = order.frequency.includes('매일') ? 7 : (freqMatch ? parseInt(freqMatch[1]) : 3);

    const sessions: Prisma.DialysisSessionCreateManyInput[] = [];
    // 🔴 scheduledDate 는 @db.Date — `new Date(y,m,d)`(KST 로컬 자정)은 UTC 로 전날이 되고, 게다가
    //    `getDay()`(KST 요일)가 **저장되는 날짜의 요일과 어긋난다**(월요일 세션이 일요일로 저장). UTC 자정
    //    기준으로 만들어 요일·날짜를 일치시킨다(정본 dateOnlyValue + getUTCDay).
    const mm = String(data.month).padStart(2, '0');
    const startOfMonth = dateOnlyValue(`${data.year}-${mm}-01`)!;
    const ny = data.month === 12 ? data.year + 1 : data.year;
    const nm = String(data.month === 12 ? 1 : data.month + 1).padStart(2, '0');
    const nextMonth = dateOnlyValue(`${ny}-${nm}-01`)!; // 배타 상한

    // HD: 월/수/금 (주3회) 또는 월~금 (주5회) 등
    const hdDays = perWeek <= 3 ? [1, 3, 5] : perWeek <= 5 ? [1, 2, 3, 4, 5] : [0, 1, 2, 3, 4, 5, 6];

    const current = new Date(startOfMonth);
    while (current < nextMonth) {
      if (hdDays.includes(current.getUTCDay())) {
        sessions.push({
          orderId: data.orderId,
          patientId: order.patientId,
          scheduledDate: new Date(current),
          status: 'SCHEDULED',
        });
      }
      current.setUTCDate(current.getUTCDate() + 1);
    }

    await this.prisma.dialysisSession.createMany({ data: sessions });
    return this.prisma.dialysisSession.findMany({
      where: {
        orderId: data.orderId,
        scheduledDate: { gte: startOfMonth, lt: nextMonth },
      },
      orderBy: { scheduledDate: 'asc' },
    });
  }

  async getSessions(params?: { date?: string; patientId?: string; shift?: string }) {
    const where: Record<string, unknown> = {};
    if (params?.patientId) where.patientId = params.patientId;
    if (params?.shift) where.shift = params.shift;
    if (params?.date) {
      const d = new Date(params.date);
      const next = new Date(d);
      next.setDate(next.getDate() + 1);
      where.scheduledDate = { gte: d, lt: next };
    }
    return this.prisma.dialysisSession.findMany({
      where,
      include: {
        order: {
          // 🔴 BFR·UF 목표·투석액 유량·항응고제가 select 에 없어 카드가 늘 '-'·'미설정'이었다(2026-10-07)
          select: { modality: true, duration: true, dialyzerType: true, dryWeight: true, accessType: true,
            bloodFlowRate: true, dialysateFlow: true, ufGoal: true, anticoagulant: true,
            patient: { select: { id: true, familyName: true, givenName: true, mrn: true, gender: true, dateOfBirth: true } } },
        },
        machine: { select: { name: true, model: true } },
        nurse: { select: { familyName: true, givenName: true } },
      },
      orderBy: { scheduledDate: 'asc' },
    });
  }

  async getSessionDetail(id: string) {
    const session = await this.prisma.dialysisSession.findUnique({
      where: { id },
      include: {
        order: {
          include: {
            patient: { select: { familyName: true, givenName: true, mrn: true } },
            prescriber: { select: { familyName: true, givenName: true } },
          },
        },
        machine: true,
        nurse: { select: { familyName: true, givenName: true } },
      },
    });
    if (!session) throw new NotFoundException('투석 세션을 찾을 수 없습니다');
    return session;
  }

  async startSession(id: string, data: {
    preWeight?: number; preTemp?: number; preBp?: string; preHr?: number;
    machineId?: string; shift?: string; nurseId?: string;
  }) {
    const session = await this.prisma.dialysisSession.findUnique({ where: { id } });
    if (!session) throw new NotFoundException('투석 세션을 찾을 수 없습니다');
    // 상태기계 — SCHEDULED에서만 시작(완료된 세션 재시작으로 기록 손상 방지)
    if (session.status !== 'SCHEDULED') throw new BadRequestException(`시작 가능한 상태가 아닙니다(현재 ${session.status})`);
    // 투석 전 체중은 UF(제수) 안전의 기준 — 필수
    if (data.preWeight == null) throw new BadRequestException('투석 전 체중(preWeight)은 필수입니다');
    // 원자적 상태전이 — SCHEDULED 조건부 updateMany로 동시 시작(TOCTOU) 직렬화
    const claimed = await this.prisma.dialysisSession.updateMany({
      where: { id, status: 'SCHEDULED' },
      data: {
        status: 'IN_PROGRESS',
        startTime: new Date(),
        preWeight: data.preWeight != null ? new Prisma.Decimal(data.preWeight) : undefined,
        preTemp: data.preTemp != null ? new Prisma.Decimal(data.preTemp) : undefined,
        preBp: data.preBp,
        preHr: data.preHr,
        machineId: data.machineId,
        shift: data.shift,
        nurseId: data.nurseId,
      },
    });
    if (claimed.count === 0) throw new ConflictException('이미 시작되었거나 시작 가능한 상태가 아닙니다');
    return this.prisma.dialysisSession.findUnique({ where: { id } });
  }

  async addIntradialyticVitals(id: string, vitals: unknown) {
    const session = await this.prisma.dialysisSession.findUnique({ where: { id } });
    if (!session) throw new NotFoundException('투석 세션을 찾을 수 없습니다');

    const existing = (session.intradialyticVitals as unknown[]) || [];
    const updated = [...existing, vitals];

    return this.prisma.dialysisSession.update({
      where: { id },
      data: { intradialyticVitals: updated as never },
    });
  }

  async completeSession(id: string, data: {
    postWeight?: number; postTemp?: number; postBp?: string; postHr?: number;
    actualUf?: number; actualDuration?: number; notes?: string;
    /** 실측 Kt/V(장비·검사 산출) — 없으면 저장하지 않는다(근사치로 채우지 않는다) */
    ktV?: number;
  }) {
    const session = await this.prisma.dialysisSession.findUnique({
      where: { id },
      include: { order: true },
    });
    if (!session) throw new NotFoundException('투석 세션을 찾을 수 없습니다');
    // 상태기계 — 진행 중(IN_PROGRESS)에서만 완료(미시작 세션의 COMPLETED 직행 방지)
    if (session.status !== 'IN_PROGRESS') throw new BadRequestException(`완료 가능한 상태가 아닙니다(현재 ${session.status})`);
    // 투석 후 체중 필수 + 순증(체중 증가)은 이상 소견으로 차단(제수 미달·기록 오류)
    if (data.postWeight == null) throw new BadRequestException('투석 후 체중(postWeight)은 필수입니다');
    if (session.preWeight != null && data.postWeight > Number(session.preWeight)) {
      throw new BadRequestException({ code: 'DIALYSIS_WEIGHT_GAIN', message: `투석 후 체중(${data.postWeight})이 전 체중(${Number(session.preWeight)})보다 큽니다 — 확인 필요.` });
    }
    // 과다 제수(除水) 하한 — 건체중 대비 큰 폭 하회는 심한 투석 중 저혈압/쇼크 위험. 순증(gain) 반대 방향의 결함.
    const dryW = session.order?.dryWeight != null ? Number(session.order.dryWeight) : null;
    const UF_UNDER_TOLERANCE_KG = (await this.ufLimits()).underDryWeightToleranceKg; // 건체중 하회 허용 오차(kg)
    if (dryW != null && data.postWeight < dryW - UF_UNDER_TOLERANCE_KG) {
      throw new BadRequestException({ code: 'DIALYSIS_OVER_UF', message: `투석 후 체중(${data.postWeight})이 건체중(${dryW})보다 ${(dryW - data.postWeight).toFixed(1)}kg 낮습니다 — 과다 제수 위험, 확인 필요.` });
    }

    // 🔴 Kt/V 는 **실측만 원장에 남긴다**(2026-08-18).
    //    종전엔 화면이 보낸 실측값이 DTO 누락으로 버려지고, 그 자리를 체중 기반 **비진단 근사식**이
    //    덮어써서 `getStats` 의 '적절도 달성률'이 지어낸 값 위에서 계산됐다(P15).
    //    정식 Daugirdas 2세대는 pre/post BUN 이 필요한데 그 컬럼이 없다 — 없는 것은 없다고 말한다.
    //    근사치는 저장하지 않고 참고용으로만 응답에 실어 보낸다(화면이 '추정'으로 표기).
    const measuredKtV = data.ktV;
    let estimatedKtV: number | undefined;
    if (measuredKtV == null && data.postWeight && session.preWeight) {
      const preW = Number(session.preWeight);
      const postW = data.postWeight;
      const uf = preW - postW; // 체중 감소량 (kg)
      const t = (data.actualDuration || session.order.duration) / 60; // 시간
      estimatedKtV = Math.round(((uf / postW) * 2.2 + 0.03 * t) * 100) / 100;
    }

    // 원자적 상태전이 — IN_PROGRESS 조건부 updateMany로 동시 완료(TOCTOU·후체중 덮어쓰기) 직렬화
    const claimed = await this.prisma.dialysisSession.updateMany({
      where: { id, status: 'IN_PROGRESS' },
      data: {
        status: 'COMPLETED',
        endTime: new Date(),
        postWeight: data.postWeight != null ? new Prisma.Decimal(data.postWeight) : undefined,
        postTemp: data.postTemp != null ? new Prisma.Decimal(data.postTemp) : undefined,
        postBp: data.postBp,
        postHr: data.postHr,
        actualUf: data.actualUf,
        actualDuration: data.actualDuration,
        ktV: measuredKtV != null ? new Prisma.Decimal(measuredKtV) : undefined,
        notes: data.notes,
      },
    });
    if (claimed.count === 0) throw new ConflictException('이미 완료되었거나 진행 중이 아닙니다');
    const saved = await this.prisma.dialysisSession.findUnique({ where: { id }, include: { order: true } });
    // 실측이 없을 때만 참고 추정치를 동봉한다 — 저장값이 아니라는 것을 이름으로 밝힌다
    return { ...saved, estimatedKtV: estimatedKtV ?? null, ktVSource: measuredKtV != null ? 'MEASURED' : null };
  }

  async addComplication(id: string, complication: { type: string; description?: string; time?: string; action?: string }) {
    const session = await this.prisma.dialysisSession.findUnique({ where: { id } });
    if (!session) throw new NotFoundException('투석 세션을 찾을 수 없습니다');

    const existing = (session.complications as unknown[]) || [];
    const updated = [...existing, complication];

    return this.prisma.dialysisSession.update({
      where: { id },
      data: { complications: updated as never },
    });
  }

  /* ───── Machines ───── */

  async getMachines(params?: { machineType?: string; status?: string }) {
    const where: Record<string, unknown> = {};
    if (params?.machineType) where.machineType = params.machineType;
    if (params?.status) where.status = params.status;
    return this.prisma.dialysisMachine.findMany({ where, orderBy: { name: 'asc' } });
  }

  async createMachine(data: {
    name: string; model?: string; serialNumber?: string;
    machineType: string; location?: string;
  }) {
    return this.prisma.dialysisMachine.create({ data });
  }

  async updateMachineStatus(id: string, status: string) {
    const machine = await this.prisma.dialysisMachine.findUnique({ where: { id } });
    if (!machine) throw new NotFoundException('투석기를 찾을 수 없습니다');
    return this.prisma.dialysisMachine.update({ where: { id }, data: { status } });
  }

  async disinfectMachine(id: string) {
    const machine = await this.prisma.dialysisMachine.findUnique({ where: { id } });
    if (!machine) throw new NotFoundException('투석기를 찾을 수 없습니다');
    return this.prisma.dialysisMachine.update({
      where: { id },
      data: { lastDisinfection: new Date() },
    });
  }

  /* ───── Dashboard / Stats ───── */

  async getDashboard() {
    const today = todayDateOnly(); // 🔴 @db.Date 비교 — 로컬 자정은 하루 밀린다(정본)
    const tomorrow = new Date(today.getTime() + 86400000);

    const [todaySessions, shiftCounts, machineStatus, activeOrders] = await Promise.all([
      this.prisma.dialysisSession.count({ where: { scheduledDate: { gte: today, lt: tomorrow } } }),
      this.prisma.dialysisSession.groupBy({
        by: ['shift'],
        where: { scheduledDate: { gte: today, lt: tomorrow } },
        _count: true,
      }),
      this.prisma.dialysisMachine.groupBy({ by: ['status'], _count: true }),
      this.prisma.dialysisOrder.count({ where: { isActive: true } }),
    ]);

    return { todaySessions, shiftCounts, machineStatus, activeOrders };
  }

  async getPatientHistory(patientId: string) {
    const sessions = await this.prisma.dialysisSession.findMany({
      where: { order: { patientId } },
      select: {
        scheduledDate: true, preWeight: true, postWeight: true,
        actualUf: true, ktV: true, complications: true, status: true,
      },
      orderBy: { scheduledDate: 'desc' },
      take: 50,
    });
    return sessions;
  }

  async getStats() {
    const [totalOrders, activeOrders, completedSessions, modalityCounts] = await Promise.all([
      this.prisma.dialysisOrder.count(),
      this.prisma.dialysisOrder.count({ where: { isActive: true } }),
      this.prisma.dialysisSession.count({ where: { status: 'COMPLETED' } }),
      this.prisma.dialysisOrder.groupBy({ by: ['modality'], _count: true }),
    ]);

    // Kt/V 달성률
    const sessionsWithKtV = await this.prisma.dialysisSession.findMany({
      where: { status: 'COMPLETED', ktV: { not: null } },
      select: { ktV: true },
      take: 200,
      orderBy: { scheduledDate: 'desc' },
    });

    const ktVValues = sessionsWithKtV.map(s => Number(s.ktV));
    const ktVAdequate = ktVValues.filter(v => v >= 1.2).length;
    // 🔴 표본이 없으면 달성률 0% 가 아니라 **산출 불가(null)** 다 — 0% 는 "전부 미달"이라는 다른 사실이다.
    const ktVRate = ktVValues.length > 0 ? Math.round((ktVAdequate / ktVValues.length) * 100) : null;
    const ktVAvg = ktVValues.length > 0 ? Math.round((ktVValues.reduce((a, b) => a + b, 0) / ktVValues.length) * 100) / 100 : null;

    return {
      totalOrders, activeOrders, completedSessions, modalityCounts,
      ktVRate, ktVAvg,
      ktVSampleN: ktVValues.length, // 분모를 함께 낸다(0 이면 화면이 '산출 불가'로 말한다)
    };
  }
}
