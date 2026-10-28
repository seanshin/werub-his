import { Injectable, NotFoundException, BadRequestException, Logger, Optional } from '@nestjs/common';
import { dateOnlyValue, todayDateOnly, localDateKey } from '../../common/day-range';
import { dietTextureText, nrs2002RiskLevel } from '@hospital-run/shared';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { NotificationService } from '../notification/notification.service';
import { calcBmi } from '../vitals/vitals-evaluate';
import { ConfigRuntimeService } from '../config/config-runtime.service';

@Injectable()
export class NutritionAdvancedService {
  private readonly logger = new Logger(NutritionAdvancedService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly notification: NotificationService,
    @Optional() private readonly config?: ConfigRuntimeService,
  ) {}

  // ── NutritionAssessment ──

  async createAssessment(data: {
    patientId: string; admissionId?: string; assessmentType: string;
    height?: number; weight?: number; albumin?: number;
    nrsScore?: number; intakeStatus?: string; notes?: string;
  }, assessedBy: string) {
    // BMI 정본(vitals calcBmi) — 화면·활력 평가와 같은 산식(height=cm·소수1 반올림)
    const bmi = calcBmi(data.weight, data.height);

    // 위험등급은 nrsScore 에서 서버가 파생한다(화면이 보낸 등급은 받지 않는다 — 정본이 둘이 된다).
    // 🔴 임계값 정본은 shared `nrs2002RiskLevel` 하나 — 종전엔 이 자리와 화면에 각각 적혀 있었고
    //    서로 달랐다(화면 nrs>=3 HIGH / 여기 nrs>=5 HIGH). 점수 미상이면 등급도 미상(undefined).
    const riskLevel = nrs2002RiskLevel(data.nrsScore) ?? undefined;

    return this.prisma.nutritionAssessment.create({
      data: {
        patientId: data.patientId,
        admissionId: data.admissionId,
        assessmentType: data.assessmentType,
        height: data.height,
        weight: data.weight,
        bmi,
        albumin: data.albumin,
        nrsScore: data.nrsScore,
        riskLevel,
        intakeStatus: data.intakeStatus,
        notes: data.notes,
        assessedBy,
      },
    });
  }

  async getAssessments(patientId: string) {
    return this.prisma.nutritionAssessment.findMany({
      where: { patientId },
      orderBy: { assessedAt: 'desc' },
    });
  }

  // ── DietOrder ──

  async createDietOrder(data: {
    patientId: string; admissionId: string; dietType: string;
    calorieTarget?: number; proteinTarget?: number; fluidLimit?: number;
    restrictions?: Record<string, unknown>; texture?: string;
    startDate: string; endDate?: string; notes?: string;
  }, orderedBy: string) {
    const startDate = dateOnlyValue(data.startDate);
    if (!startDate) throw new BadRequestException('startDate 형식이 올바르지 않습니다(YYYY-MM-DD).');
    const endDate = data.endDate ? dateOnlyValue(data.endDate) : null;
    if (data.endDate && !endDate) throw new BadRequestException('endDate 형식이 올바르지 않습니다(YYYY-MM-DD).');

    /**
     * 🔴 한 시점에 활성 식이 처방은 **하나**여야 한다.
     *    종전엔 새 처방을 내도 이전 처방이 활성인 채로 남아, 소비처(`findFirst({isActive:true})`)가
     *    **어느 것을 정본으로 볼지 알 수 없었다**. 배식은 그중 하나를 따라간다 — 처방을 바꿨는데
     *    옛 식이가 계속 나갈 수 있다는 뜻이다.
     *
     * 🔴 그리고 처방을 바꿨으면 **아직 배식되지 않은 오늘 이후 식사**가 따라 바뀌어야 한다.
     *    이미 배식·섭취된 식사는 사실이므로 손대지 않는다.
     */
    const order = await this.prisma.$transaction(async (tx) => {
      await tx.dietOrder.updateMany({
        where: { admissionId: data.admissionId, isActive: true },
        data: { isActive: false, endDate: startDate },
      });
      return tx.dietOrder.create({
        data: {
          patientId: data.patientId,
          admissionId: data.admissionId,
          dietType: data.dietType,
          calorieTarget: data.calorieTarget,
          proteinTarget: data.proteinTarget,
          fluidLimit: data.fluidLimit,
          restrictions: (data.restrictions ?? undefined) as unknown as Prisma.InputJsonValue,
          texture: data.texture,
          startDate,
          endDate: endDate ?? undefined,
          notes: data.notes,
          orderedBy,
        },
      });
    });

    const applied = await this.applyDietToPendingMeals(data.admissionId, order.dietType, order.texture ?? null, startDate);
    return { ...order, mealsUpdated: applied };
  }

  /**
   * 식이 처방을 **아직 배식되지 않은** 식사에 반영한다(오늘 이후).
   * 🔴 이미 `DELIVERED`/`COMPLETED`/`PARTIAL`/`REFUSED` 인 식사는 **일어난 사실**이라 고치지 않는다 —
   *    지난 기록을 소급해 바꾸면 원장이 거짓이 된다.
   */
  private async applyDietToPendingMeals(admissionId: string, dietType: string, texture: string | null, from: Date): Promise<number> {
    const note = `식이 출처: 처방(활성)${texture ? ` · 질감 ${dietTextureText(texture)}` : ''}`;
    const start = from > todayDateOnly() ? from : todayDateOnly();
    const r = await this.prisma.mealOrder.updateMany({
      where: { admissionId, date: { gte: start }, status: { in: ['ORDERED', 'PREPARED'] } },
      data: { dietType, notes: note },
    });
    if (r.count > 0) this.logger.log(`식이 처방 변경 반영 admission=${admissionId} → 미배식 식사 ${r.count}건 갱신(${dietType})`);
    return r.count;
  }

  async getDietOrders(admissionId?: string) {
    const where: Record<string, unknown> = { isActive: true };
    if (admissionId) where.admissionId = admissionId;
    return this.prisma.dietOrder.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        patient: { select: { familyName: true, givenName: true, mrn: true } },
        orderer: { select: { familyName: true, givenName: true } },
      },
    });
  }

  async updateDietOrder(id: string, data: {
    dietType?: string; calorieTarget?: number; proteinTarget?: number;
    fluidLimit?: number; restrictions?: Record<string, unknown>; texture?: string;
    endDate?: string; isActive?: boolean; notes?: string;
  }) {
    const existing = await this.prisma.dietOrder.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('식이처방을 찾을 수 없습니다');

    const updateData: Record<string, unknown> = {};
    if (data.dietType !== undefined) updateData.dietType = data.dietType;
    if (data.calorieTarget !== undefined) updateData.calorieTarget = data.calorieTarget;
    if (data.proteinTarget !== undefined) updateData.proteinTarget = data.proteinTarget;
    if (data.fluidLimit !== undefined) updateData.fluidLimit = data.fluidLimit;
    if (data.restrictions !== undefined) updateData.restrictions = data.restrictions;
    if (data.texture !== undefined) updateData.texture = data.texture;
    if (data.endDate !== undefined) updateData.endDate = new Date(data.endDate);
    if (data.isActive !== undefined) updateData.isActive = data.isActive;
    if (data.notes !== undefined) updateData.notes = data.notes;

    return this.prisma.dietOrder.update({ where: { id }, data: updateData });
  }

  // ── NutritionCounsel ──

  async createCounsel(data: {
    patientId: string; counselType: string; topic: string;
    content: string; dietaryGoals?: Record<string, unknown>;
    duration?: number; followUpDate?: string;
  }, counseledBy: string) {
    return this.prisma.nutritionCounsel.create({
      data: {
        patientId: data.patientId,
        counselType: data.counselType,
        topic: data.topic,
        content: data.content,
        dietaryGoals: (data.dietaryGoals ?? undefined) as unknown as Prisma.InputJsonValue,
        duration: data.duration,
        counseledBy,
        followUpDate: data.followUpDate ? new Date(data.followUpDate) : undefined,
      },
    });
  }

  async getCounsels(patientId: string) {
    return this.prisma.nutritionCounsel.findMany({
      where: { patientId },
      orderBy: { counseledAt: 'desc' },
      include: {
        patient: { select: { familyName: true, givenName: true, mrn: true } },
        counselor: { select: { familyName: true, givenName: true } },
      },
    });
  }

  // ── Meal Intake Log (식사 섭취 기록) ──

  async recordMealIntake(data: {
    admissionId: string; patientId: string; mealOrderId?: string;
    mealType: string; date: string;
    intakePercent: number; // 0~100%
    calories?: number; protein?: number; fluid?: number;
    refusedItems?: string; notes?: string;
    leftoverPercent?: number; refusalReason?: string; trayCollected?: boolean; // 식후 관리(잔반·회수)
  }, recordedBy: string) {
    // 🔴 `@db.Date` 는 UTC 날짜 부분만 쓴다 — 로컬 자정으로 밀면 KST 에서 하루 앞이 된다(정본 `dateOnlyValue`)
    const date = dateOnlyValue(data.date);
    if (!date) throw new BadRequestException('date 형식이 올바르지 않습니다(YYYY-MM-DD).');

    // 식이처방에서 목표 칼로리 조회
    const dietOrder = await this.prisma.dietOrder.findFirst({
      where: { admissionId: data.admissionId, isActive: true },
      select: { calorieTarget: true, proteinTarget: true, fluidLimit: true },
    });

    // 칼로리 자동 계산 (목표 * 섭취율)
    const MEAL_RATIO: Record<string, number> = { BREAKFAST: 0.25, LUNCH: 0.35, DINNER: 0.35, SNACK: 0.05 };
    const mealRatio = MEAL_RATIO[data.mealType] ?? 0.33;
    const estimatedCalories = data.calories ??
      (dietOrder?.calorieTarget ? Math.round((dietOrder.calorieTarget as number) * mealRatio * (data.intakePercent / 100)) : undefined);

    // MealOrder 상태 + 섭취율 저장(+ 잔반·회수 식후 관리)
    let mealOrderUpdateFailed: string | null = null;
    if (data.mealOrderId) {
      const status = data.intakePercent >= 75 ? 'COMPLETED' : data.intakePercent >= 25 ? 'PARTIAL' : 'REFUSED';
      await this.prisma.mealOrder.update({
        where: { id: data.mealOrderId },
        data: {
          status, intakePercent: data.intakePercent, intakeRecordedBy: recordedBy, intakeRecordedAt: new Date(),
          leftoverPercent: data.leftoverPercent ?? (100 - data.intakePercent),
          refusalReason: data.refusalReason ?? null,
          trayCollectedAt: data.trayCollected ? new Date() : undefined,
        },
      }).catch((e) => {
        /**
         * 🔴 종전엔 이 실패를 통째로 삼켜 **섭취율·급식 상태가 저장되지 않았는데 응답은 성공**이었다.
         *    (없는 mealOrder 는 정상 상황이라 던지지는 않되, 실패했다는 사실은 남긴다.)
         */
        mealOrderUpdateFailed = e instanceof Error ? e.message : String(e);
        this.logger.warn(`급식 오더 섭취율 저장 실패 mealOrder=${data.mealOrderId}: ${mealOrderUpdateFailed}`);
      });
    }

    // 섭취 부진 자동 감지 → 주치의 알림(연속 3끼 ≤25%)
    if (data.intakePercent <= 25) {
      await this.alertLowIntake(data.admissionId, data.patientId).catch((e) => this.logger.warn(`저섭취 알림 실패: ${e instanceof Error ? e.message : e}`));
    }

    // IntakeOutput 기록 추가 (fluid 섭취로 연동)
    if (data.fluid && data.fluid > 0) {
      await this.prisma.intakeOutput.create({
        data: {
          admissionId: data.admissionId,
          recordedAt: new Date(),
          intakeType: 'ORAL',
          intakeAmount: data.fluid,
          intakeDetail: `${data.mealType} 식사 수분 섭취`,
          nurseId: recordedBy,
        },
      }).catch(() => { /* intakeOutput 실패 무시 */ });
    }

    return {
      admissionId: data.admissionId,
      mealType: data.mealType,
      /** 🔴 급식 오더에 섭취율이 반영되지 않았으면 그 사실을 함께 돌려준다(성공으로 읽히지 않게) */
      mealOrderUpdated: data.mealOrderId ? mealOrderUpdateFailed === null : null,
      ...(mealOrderUpdateFailed ? { mealOrderNote: '섭취 기록은 남았지만 급식 오더에 반영하지 못했습니다.' } : {}),
      date: localDateKey(date),
      intakePercent: data.intakePercent,
      estimatedCalories,
      protein: data.protein,
      fluid: data.fluid,
      refusedItems: data.refusedItems,
      recordedBy,
    };
  }

  /** 섭취 부진 자동 감지: 최근 기록된 3끼가 모두 ≤25%면 주치의에게 알림(폐순환 진입). */
  private async alertLowIntake(admissionId: string, patientId: string) {
    const recent = await this.prisma.mealOrder.findMany({
      where: { admissionId, intakePercent: { not: null } },
      orderBy: { intakeRecordedAt: 'desc' }, take: 3, select: { intakePercent: true },
    });
    if (recent.length < 3 || !recent.every((m) => (m.intakePercent ?? 100) <= 25)) return;

    // 주치의 해석: 현재 입원 → ChargeOfCare(ATTENDING) → attendingDoctorId
    const admission = await this.prisma.admission.findUnique({ where: { id: admissionId }, select: { attendingDoctorId: true } });
    const charge = await this.prisma.chargeOfCare.findFirst({ where: { admissionId, releasedAt: null, role: 'ATTENDING' }, select: { doctorId: true } });
    const attendingId = charge?.doctorId || admission?.attendingDoctorId;
    if (!attendingId) return;

    const patient = await this.prisma.patient.findUnique({ where: { id: patientId }, select: { familyName: true, givenName: true } });
    const name = patient ? `${patient.familyName ?? ''}${patient.givenName ?? ''}` : '환자';
    const notif = await this.notification.create(attendingId, {
      type: 'NUTRITION_ALERT',
      title: '섭취 부진 알림',
      message: `${name} 환자 연속 3끼 섭취 부진(≤25%) — 영양 재평가 검토가 필요합니다.`,
      severity: 'WARNING', refType: 'admission', refId: admissionId,
    });
    this.notification.pushNotification(attendingId, {
      id: notif.id, type: notif.type, title: notif.title, message: notif.message,
      severity: notif.severity, refType: notif.refType ?? undefined, refId: notif.refId ?? undefined,
    });
    this.logger.log(`섭취부진 알림: 주치의 ${attendingId} (admission ${admissionId})`);
  }

  async getDailyNutritionSummary(admissionId: string, date?: string) {
    const targetDate = date ? dateOnlyValue(date) : todayDateOnly();
    if (!targetDate) throw new BadRequestException('date 형식이 올바르지 않습니다(YYYY-MM-DD).');
    const nextDate = new Date(targetDate);
    nextDate.setUTCDate(nextDate.getUTCDate() + 1);

    // 식이처방 목표
    const dietOrder = await this.prisma.dietOrder.findFirst({
      where: { admissionId, isActive: true },
      select: { dietType: true, calorieTarget: true, proteinTarget: true, fluidLimit: true },
    });

    // 당일 식사 주문/섭취 기록
    const meals = await this.prisma.mealOrder.findMany({
      where: { admissionId, date: { gte: targetDate, lt: nextDate } },
      orderBy: { mealType: 'asc' },
    });

    // I/O에서 수분 섭취 합계
    const io = await this.prisma.intakeOutput.findMany({
      where: { admissionId, recordedAt: { gte: targetDate, lt: nextDate }, intakeType: 'ORAL' },
    });
    const totalFluid = io.reduce((s, r) => s + (r.intakeAmount ?? 0), 0);

    // 칼로리 추정 (섭취율 기반)
    // 🔴 (2026-09-16 J3) 종전엔 식이처방에 목표 열량이 없으면 **2000kcal 를 지어내** 분모로 썼다 —
    //    화면에는 "목표 2000kcal · 달성률 82%" 로 보였지만 그 목표를 정한 사람은 없다
    //    (기본값을 정책인 척하지 않는다). 목표가 없으면 열량 추정도 달성률도 만들지 않는다.
    const calorieTarget = dietOrder?.calorieTarget != null ? Number(dietOrder.calorieTarget) : null;
    const MEAL_RATIO: Record<string, number> = { BREAKFAST: 0.25, LUNCH: 0.35, DINNER: 0.35, SNACK: 0.05 };
    let estimatedCaloriesTotal = 0;
    let intakeRecordedMeals = 0;
    const mealSummary = meals.map(m => {
      // 🔴 (2026-09-21 H) 종전 `?? 0` — 섭취율이 **아직 기록되지 않은** 식사를 "0% 섭취"로 말하고
      //    그 0 을 총 섭취 열량에 더했다. 목표 열량은 J3 가 이미 고쳤는데(지어낸 2000kcal 제거)
      //    **같은 함수 안에서 섭취율만 0 으로 접고 있었다** — 한 화면이 "굶었다"와 "모른다"를
      //    같은 모양으로 그린다. 미기록은 `null`, 총합은 **기록된 식사만** 센다.
      const raw = (m as Record<string, unknown>).intakePercent;
      const percent = typeof raw === 'number' ? raw : null;
      const ratio = MEAL_RATIO[m.mealType] ?? 0.33;
      const cal = calorieTarget != null && percent != null ? Math.round(calorieTarget * ratio * (percent / 100)) : null;
      if (percent != null) { intakeRecordedMeals++; estimatedCaloriesTotal += cal ?? 0; }
      return { mealType: m.mealType, status: m.status, intakePercent: percent, estimatedCalories: cal };
    });

    return {
      date: targetDate.toISOString().split('T')[0],
      dietType: dietOrder?.dietType ?? '일반식',
      targets: {
        calories: calorieTarget,
        protein: dietOrder?.proteinTarget != null ? Number(dietOrder.proteinTarget) : null,
        fluid: dietOrder?.fluidLimit != null ? Number(dietOrder.fluidLimit) : null,
      },
      actual: {
        // 목표가 없으면 열량 추정 자체가 불가능하다(섭취율×목표로 만드는 값이다)
        // 🔴 섭취율이 **한 끼도 기록되지 않았으면** 추정 열량도 달성률도 없다(0kcal·0% 는 "굶었다"는 뜻이라 다르다).
        estimatedCalories: calorieTarget != null && intakeRecordedMeals > 0 ? estimatedCaloriesTotal : null,
        // 🔴 분모를 함께 — 몇 끼 중 몇 끼가 기록됐는지 보이지 않으면 부분 기록이 전체 달성률로 읽힌다.
        intakeRecordedMeals,
        totalMeals: meals.length,
        calorieRate: calorieTarget != null && calorieTarget > 0 && intakeRecordedMeals > 0
          ? Math.round((estimatedCaloriesTotal / calorieTarget) * 100)
          : null,
        calorieRateUnavailableReason: calorieTarget == null || calorieTarget <= 0
          ? 'NO_CALORIE_TARGET'
          : intakeRecordedMeals === 0
            ? 'NO_INTAKE_RECORDED'
            : null,
        totalFluid,
      },
      meals: mealSummary,
    };
  }

  // ── 급양사(영양사) 워크리스트 ──────────────────────────────────────────

  /**
   * 🔴 급양사가 **오늘 무엇을 해야 하는지** 한 곳에서 낸다.
   *
   * 2026-08-21 실측: 입력 기능(식이처방·특수영양·영양평가·영양상담 4탭)은 다 있는데
   * **"누구를 평가해야 하는가"가 어디에도 없었다.**
   *   · 재원 5명 중 영양평가가 있는 환자 **2명**(3명 미평가) — 화면이 아무 말도 하지 않았다
   *   · 상담 후속일(`followUpDate`)이 도래한 4건 — **저장만 하고 아무도 읽지 않았다**
   *   · 고위험 평가 2건 — 재평가 주기 관리 없음
   * 목록에서 시작하지 못하면 급양사는 환자를 **기억으로** 찾아야 한다.
   *
   * 🔴 기준값(스크리닝 기한·재평가 주기)은 **원내 정책**이다. 감으로 정하지 않고
   *    config 로 두되, 미설정이면 화면이 **"원내 정책 미확정 · 기본값 기준"** 이라고 밝힌다.
   */
  async getDietitianWorklist() {
    const [screeningHoursRaw, reassessDaysRaw] = await Promise.all([
      this.config?.getWithSource('nutrition.screeningWithinHours').then((r) => ({ ok: true as const, v: r.value, set: r.source === 'db' || r.source === 'env' })).catch(() => ({ ok: false as const, v: null, set: false })),
      this.config?.getWithSource('nutrition.reassessDays').then((r) => ({ ok: true as const, v: r.value, set: r.source === 'db' || r.source === 'env' })).catch(() => ({ ok: false as const, v: null, set: false })),
    ]);
    const screeningHours = Number(screeningHoursRaw?.v ?? 0) || 48;
    const reassessDays = Number(reassessDaysRaw?.v ?? 0) || 7;
    // 🔴 (2026-10-01) "확정"은 **원내가 값을 넣었을 때**다 — 카탈로그 기본값(48·7)이 돌아온 것을 확정으로 읽지 않는다.
    //    종전엔 config 가 주입되지 않아(모듈 미import) 늘 미확정이었고, 배선을 고치자 기본값이 "확정"으로 보일 뻔했다.
    const policySet = !!screeningHoursRaw?.set && !!reassessDaysRaw?.set;

    const admissions = await this.prisma.admission.findMany({
      where: { status: 'ADMITTED' },
      select: {
        id: true, patientId: true, admitDate: true,
        patient: { select: { mrn: true, familyName: true, givenName: true } },
        bed: { select: { bedNumber: true, ward: { select: { name: true } } } },
      },
    });
    const patientIds = admissions.map((a) => a.patientId);

    // 재원 환자의 최근 영양평가 — 환자당 1건(최신)
    const assessments = patientIds.length
      ? await this.prisma.nutritionAssessment.findMany({
          where: { patientId: { in: patientIds } },
          orderBy: { assessedAt: 'desc' },
          select: { patientId: true, assessedAt: true, riskLevel: true, nrsScore: true },
        })
      : [];
    const latest = new Map<string, (typeof assessments)[number]>();
    for (const a of assessments) if (!latest.has(a.patientId)) latest.set(a.patientId, a);

    const now = Date.now();
    const hoursSince = (d: Date) => (now - d.getTime()) / 3_600_000;
    const daysSince = (d: Date) => (now - d.getTime()) / 86_400_000;
    const isHigh = (r?: string | null) => !!r && /HIGH|고위험/i.test(r);

    const row = <E extends Record<string, unknown>>(a: (typeof admissions)[number], extra: E) => ({
      admissionId: a.id, patientId: a.patientId, mrn: a.patient.mrn,
      name: `${a.patient.familyName}${a.patient.givenName}`,
      ward: a.bed?.ward?.name ?? null, bed: a.bed?.bedNumber ?? null,
      admitDate: a.admitDate, ...extra,
    });

    /** ① 영양 스크리닝 미실시 — 인증 기준의 핵심 지표 */
    const notScreened = admissions
      .filter((a) => !latest.has(a.patientId))
      .map((a) => row(a, { hoursSinceAdmit: Math.floor(hoursSince(a.admitDate)), overdue: hoursSince(a.admitDate) > screeningHours }));

    /** ② 재평가 대상 — 고위험군이 기준일을 넘겼거나, 마지막 평가가 오래된 경우 */
    const reassess = admissions
      .filter((a) => {
        const last = latest.get(a.patientId);
        if (!last) return false; // ①에서 이미 잡힌다
        return daysSince(last.assessedAt) > reassessDays;
      })
      .map((a) => {
        const last = latest.get(a.patientId)!;
        return row(a, {
          lastAssessedAt: last.assessedAt, riskLevel: last.riskLevel, nrsScore: last.nrsScore,
          daysSinceAssessment: Math.floor(daysSince(last.assessedAt)), highRisk: isHigh(last.riskLevel),
        });
      })
      .sort((x, y) => Number(y.highRisk) - Number(x.highRisk));

    /** ③ 상담 후속일 도래 — 종전에는 저장만 하고 아무도 읽지 않았다 */
    const counselDue = await this.prisma.nutritionCounsel.findMany({
      where: { followUpDate: { not: null, lte: todayDateOnly() } },
      orderBy: { followUpDate: 'asc' },
      select: {
        id: true, patientId: true, topic: true, counselType: true, followUpDate: true, counseledAt: true,
        patient: { select: { mrn: true, familyName: true, givenName: true } },
      },
    });

    /** ④ 저섭취 — 오늘 25% 이하로 기록된 식사(중재 대상) */
    const lowIntake = await this.prisma.mealOrder.findMany({
      where: { date: todayDateOnly(), intakePercent: { lte: 25 } },
      select: {
        admissionId: true, patientId: true, mealType: true, intakePercent: true, dietType: true, refusalReason: true,
        patient: { select: { mrn: true, familyName: true, givenName: true } },
      },
    });

    /** ⑤ 특수영양(EN·TPN) 진행 중 — 모니터링 대상 */
    const specialActive = await this.prisma.specialNutritionOrder.findMany({
      where: { status: 'ACTIVE' },
      select: {
        id: true, admissionId: true, patientId: true, kind: true, route: true, formula: true,
        targetCalories: true, startDate: true, monitoring: true,
        patient: { select: { mrn: true, familyName: true, givenName: true } },
      },
    });

    return {
      /** 🔴 모든 수는 분모(재원 환자)와 함께 읽는다 */
      admissions: admissions.length,
      policy: {
        screeningWithinHours: screeningHours,
        reassessDays,
        /** 🔴 원내 정책이 확정되지 않았으면 화면이 그렇게 말한다 — 기본값을 정책인 척하지 않는다 */
        configured: policySet,
        note: policySet ? null : '원내 정책 미확정 — 기본값(스크리닝 48시간·재평가 7일) 기준으로 표시합니다.',
      },
      notScreened,
      reassess,
      counselDue,
      lowIntake,
      specialActive,
      measuredAt: new Date().toISOString(),
    };
  }

  // ── Dashboard ──

  async getDashboard() {
    // 🔴 종전엔 로컬 자정(KST)으로 `@db.Date` 를 비교해 **어제 급식을 세고 있었다**
    const today = todayDateOnly();
    const tomorrow = new Date(today);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);

    // Today's meal counts by dietType
    const mealsByDietType = await this.prisma.mealOrder.groupBy({
      by: ['dietType'],
      where: { date: { gte: today, lt: tomorrow } },
      _count: { id: true },
    });

    // Allergy patients (patients with active diet orders that have restrictions)
    const allergyPatients = await this.prisma.dietOrder.findMany({
      where: {
        isActive: true,
        restrictions: { not: null as unknown as undefined },
      },
      select: {
        id: true,
        dietType: true,
        restrictions: true,
        patient: { select: { familyName: true, givenName: true, mrn: true } },
      },
    });

    return {
      mealsByDietType: mealsByDietType.map(m => ({
        dietType: m.dietType,
        count: m._count.id,
      })),
      allergyPatients,
    };
  }

  // ── 특수영양(경장 EN·정맥 TPN) 처방 ──
  async createSpecialNutrition(data: {
    admissionId: string; patientId: string; kind: string; route?: string; formula?: string;
    targetCalories?: number; volumeMl?: number; rateMlHr?: number;
    composition?: unknown; monitoring?: unknown; startDate?: string; endDate?: string; notes?: string;
  }, orderedBy: string) {
    if (!data.admissionId || !data.patientId || !data.kind) throw new BadRequestException('admissionId·patientId·kind는 필수입니다.');
    // 🔴 (2026-09-15 B10) `@db.Date` — 종전 `new Date()` 기본값은 KST 00~09시에 **전날**로 저장됐고, 날짜 문자열 오류는 Prisma 500 이었다(정본 dateOnlyValue·todayDateOnly)
    const startDate = data.startDate ? dateOnlyValue(data.startDate) : todayDateOnly();
    if (!startDate) throw new BadRequestException('startDate 형식이 올바르지 않습니다(YYYY-MM-DD).');
    const endDate = data.endDate ? dateOnlyValue(data.endDate) : null;
    if (data.endDate && !endDate) throw new BadRequestException('endDate 형식이 올바르지 않습니다(YYYY-MM-DD).');
    /**
     * 🔴 (2026-09-16 K2) 바로 위 `createDietOrder` 는 "한 시점 한 활성 처방"을 지키는데 **여기만 안 지켰다**
     *    (같은 파일·같은 축의 쌍둥이). 다시 등록하거나 처방을 바꾸면 같은 종류의 활성 처방이 둘로 남고,
     *    모니터링 목록(`status: 'ACTIVE'` 전건)은 한 환자를 **주입 속도·목표 열량이 다른 두 줄**로 그렸다.
     *    무균조제 지시는 `specialNutritionOrderId` 로 처방을 가리키므로 어느 쪽을 따르는지도 갈린다.
     *
     * 🔴 **종류(kind)까지만 닫는다.** 경장(EN)과 정맥(TPN) 병용은 실제 임상에서 정당하다 —
     *    admission 단위로 닫으면 병용 처방을 서로 끄게 된다(막는 방향으로 지어내지 않는다).
     */
    return this.prisma.$transaction(async (tx) => {
      await tx.specialNutritionOrder.updateMany({
        where: { admissionId: data.admissionId, kind: data.kind, status: { not: 'DISCONTINUED' } },
        data: { status: 'DISCONTINUED', endDate: startDate },
      });
      return tx.specialNutritionOrder.create({
        data: {
          admissionId: data.admissionId, patientId: data.patientId, kind: data.kind, route: data.route ?? null, formula: data.formula ?? null,
          targetCalories: data.targetCalories ?? null, volumeMl: data.volumeMl ?? null, rateMlHr: data.rateMlHr ?? null,
          composition: (data.composition ?? undefined) as never, monitoring: (data.monitoring ?? undefined) as never,
          startDate, endDate,
          notes: data.notes ?? null, orderedBy,
        },
      });
    });
  }
  async getSpecialNutrition(admissionId: string) {
    return this.prisma.specialNutritionOrder.findMany({
      where: { admissionId, ...(admissionId ? {} : {}) },
      orderBy: [{ status: 'asc' }, { startDate: 'desc' }],
    });
  }
  async updateSpecialNutrition(id: string, data: { status?: string; endDate?: string; rateMlHr?: number; volumeMl?: number; notes?: string; composition?: unknown; monitoring?: unknown }) {
    const endDate = data.endDate ? dateOnlyValue(data.endDate) : undefined;
    if (data.endDate && !endDate) throw new BadRequestException('endDate 형식이 올바르지 않습니다(YYYY-MM-DD).');
    return this.prisma.specialNutritionOrder.update({
      where: { id },
      data: {
        status: data.status, rateMlHr: data.rateMlHr, volumeMl: data.volumeMl, notes: data.notes,
        endDate,
        composition: (data.composition ?? undefined) as never, monitoring: (data.monitoring ?? undefined) as never,
      },
    });
  }
}
