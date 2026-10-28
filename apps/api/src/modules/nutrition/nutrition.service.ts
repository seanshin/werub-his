import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { dateOnlyValue, todayDateOnly, localDateKey } from '../../common/day-range';
import { Prisma } from '@prisma/client';
import { dietTextureText } from '@hospital-run/shared';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

@Injectable()
export class NutritionService {
  private readonly logger = new Logger(NutritionService.name);

  /**
   * 🔴 `@db.Date` 비교값 정본(`dateOnlyValue`)을 통과시키되, **파싱 불가는 400 으로 말한다**.
   *    종전엔 `new Date(x)` 가 Invalid Date 를 그대로 Prisma 로 넘겨 500 이 났다
   *    — 사용자는 "서버 오류"를 보고 자기 입력이 문제인 줄 모른다.
   */
  private dayValue(value: string | Date | null | undefined, field = 'date'): Date {
    const d = dateOnlyValue(value);
    if (!d) throw new BadRequestException(`${field} 형식이 올바르지 않습니다(YYYY-MM-DD).`);
    return d;
  }
  constructor(private readonly prisma: PrismaService) {}

  async createMealOrder(data: { admissionId: string; patientId: string; date: string; mealType: string; dietType: string; allergies?: string; notes?: string }) {
    return this.prisma.mealOrder.create({ data: { ...data, date: this.dayValue(data.date) } });
  }

  /**
   * 일별 급식 목록.
   *
   * 🔴 배식 확인(5-Rights)을 함께 돌려준다(2026-09-02). 종전엔 `MealDeliveryCheck` 를 **쓰기만** 하고
   *    읽는 코드가 저장소 어디에도 없었다 — 본인·식이유형·**알레르기**·온도 확인이 원장에 남는데
   *    그것을 꺼내 볼 화면도 보고서도 없었다(오배식이 생겨도 "누가 무엇을 확인했는가"를 답할 수 없다).
   *    등록 EP 만으로는 기록이 아니다 — 조회 경로까지가 한 벌이다.
   *
   * 관계(@relation)가 없는 컬럼이라 include 로 못 붙인다 → 같은 조회에서 **배치로** 가져와 붙인다(N+1 아님).
   */
  async getMealOrders(date?: string, status?: string) {
    const targetDate = date ? this.dayValue(date) : todayDateOnly();
    const where: Prisma.MealOrderWhereInput = { date: targetDate };
    if (status) where.status = status;
    const meals = await this.prisma.mealOrder.findMany({
      where, orderBy: { mealType: 'asc' },
      include: { patient: { select: { id: true, familyName: true, givenName: true } }, admission: { select: { bed: { include: { ward: { select: { name: true } } } } } } },
    });
    if (!meals.length) return meals;

    const checks = await this.prisma.mealDeliveryCheck.findMany({
      where: { mealOrderId: { in: meals.map((m) => m.id) } },
      orderBy: { deliveredAt: 'desc' },
    });
    if (!checks.length) return meals.map((m) => ({ ...m, deliveryCheck: null }));

    const staff = await this.prisma.user.findMany({
      where: { id: { in: [...new Set(checks.map((c) => c.deliveredBy))] } },
      select: { id: true, familyName: true, givenName: true },
    });
    const nameOf = new Map(staff.map((u) => [u.id, `${u.familyName ?? ''}${u.givenName ?? ''}`.trim() || null]));
    // 같은 급식에 확인이 여러 번이면 **가장 최근 것**(정렬이 desc 라 첫 항목)
    const latest = new Map<string, (typeof checks)[number]>();
    for (const c of checks) if (!latest.has(c.mealOrderId)) latest.set(c.mealOrderId, c);

    return meals.map((m) => {
      const c = latest.get(m.id);
      return {
        ...m,
        deliveryCheck: c
          ? {
              patientVerified: c.patientVerified, dietVerified: c.dietVerified,
              allergyVerified: c.allergyVerified, tempOk: c.tempOk,
              deliveredAt: c.deliveredAt,
              // 🔴 이름을 못 찾으면 지어내지 않는다 — null 로 두고 화면이 그대로 말한다
              deliveredByName: nameOf.get(c.deliveredBy) ?? null,
            }
          : null,
      };
    });
  }

  /**
   * 급식 상태 전이. 🔴 **미배식은 사유와 한 벌이다** — 사유 없는 미배식은 원인을 잃고,
   * 나중에 "왜 안 나갔는지"를 아무도 답할 수 없다(NPO 였는지 환자 부재였는지가 임상적으로 다르다).
   * 운영 실측에서 급식 원장 24행 중 23행이 `UNDELIVERED` 였다 — 이 축이 사실상 원장의 본체다.
   */
  async updateStatus(id: string, status: string, undeliveredReason?: string) {
    if (status === 'UNDELIVERED' && !undeliveredReason) {
      throw new BadRequestException('미배식은 사유가 필요합니다(NPO·검사·부재·거부·퇴원·기타).');
    }
    /**
     * 🔴 없는 급식 오더면 Prisma 가 `P2025` 를 던진다 — 종전엔 그것이 **500 `INTERNAL_ERROR`** 로
     *    나갔다(운영 실측). 판정은 **전역 예외 필터 한 곳**에서 한다(`P2025` → 404).
     *    여기서 존재 확인을 한 번 더 하면 같은 사실에 정본이 둘이 되고, 1,031개 호출부 중
     *    이 하나만 다르게 말하게 된다.
     */
    return this.prisma.mealOrder.update({
      where: { id },
      data: {
        status,
        // 미배식이 아닌 상태로 되돌리면 사유도 함께 지운다 — 남아 있으면 지난 사유가 사실처럼 읽힌다
        undeliveredReason: status === 'UNDELIVERED' ? undeliveredReason : null,
      },
    });
  }

  /** 검식(관능·검수) 기록 — 조리 배치 품질 확인 */
  async createInspection(data: { productionBatchId: string; pass?: boolean; taste?: number; temperature?: number; portion?: number; hygiene?: number; notes?: string }, inspectedBy: string) {
    return this.prisma.mealInspection.create({
      data: { productionBatchId: data.productionBatchId, pass: data.pass ?? true, taste: data.taste, temperature: data.temperature, portion: data.portion, hygiene: data.hygiene, notes: data.notes ?? null, inspectedBy },
    });
  }

  /**
   * 재원 환자 일괄 식사 생성.
   *
   * 🔴 2026-08-21: 종전엔 `dietType: adm.dietType ?? '일반식'` 이었다 — **식이 처방(`DietOrder`)을
   *    보지 않았다.** 입원 목록 화면은 이미 "임상 정본은 활성 처방"이라 병합해 두었는데(2026-08-12),
   *    **정작 주방에 나가는 식사는 입원 시 지정값**이었다. 운영 실측:
   *      · 고단백식(HIGH_PROTEIN) 처방 환자 → 실제 배식 **일반식**
   *      · 신장식(RENAL) 처방 환자 → 실제 배식 **저단백식(CKD)**
   *    게다가 운영 `admissions.diet_type` 은 **전부 비어 있어**, 앞으로 생성되는 식사는
   *    전부 `'일반식'` 이 될 상태였다. 화면과 배식이 다른 말을 하면 확인할 방법이 없다.
   *
   * 🔴 처방이 없으면 `'일반식'` 을 **조용히** 쓰지 않는다 — 그 사실을 `notes` 에 남겨
   *    병동·주방이 "처방 없이 기본식으로 나간다"는 것을 알 수 있게 한다(막지 않고 드러낸다).
   */
  async generateDailyOrders(date: string) {
    const d = this.dayValue(date);
    const admissions = await this.prisma.admission.findMany({
      where: { status: 'ADMITTED' },
      include: {
        patient: { select: { id: true, allergiesRel: { where: { isActive: true, type: 'FOOD' }, select: { allergen: true, severity: true } } } },
        bed: { include: { ward: { select: { name: true } } } },
      },
    });

    // 🔴 임상 정본 = 활성 식이 처방. 같은 입원에 여러 건이면 최신 것을 쓴다(정상 상태는 1건).
    const dietOrders = admissions.length
      ? await this.prisma.dietOrder.findMany({
          where: { admissionId: { in: admissions.map((a) => a.id) }, isActive: true },
          orderBy: { createdAt: 'desc' },
          select: { admissionId: true, dietType: true, texture: true, createdAt: true },
        })
      : [];
    const dietByAdmission = new Map<string, (typeof dietOrders)[number]>();
    for (const o of dietOrders) if (!dietByAdmission.has(o.admissionId)) dietByAdmission.set(o.admissionId, o);
    let withoutOrder = 0;
    const meals = ['BREAKFAST', 'LUNCH', 'DINNER'];
    // 기존 존재분 조회 → create/skip 정확 산출
    const existing = await this.prisma.mealOrder.findMany({
      where: { date: d, mealType: { in: meals }, admissionId: { in: admissions.map((a) => a.id) } },
      select: { admissionId: true, mealType: true },
    });
    const existSet = new Set(existing.map((e) => `${e.admissionId}|${e.mealType}`));
    let created = 0, skipped = 0;
    for (const adm of admissions) {
      // 정식 Allergy(음식) 자동 반영 — 구조화 목록 문자열화
      const foodAllergies = (adm.patient.allergiesRel ?? []).map((a) => `${a.allergen}(${a.severity})`).join(', ') || null;
      const wardName = adm.bed?.ward?.name ?? null;
      const order = dietByAdmission.get(adm.id);
      const resolved = NutritionService.resolveDiet(order, adm.dietType);
      if (resolved.source === 'DEFAULT') withoutOrder++;
      for (const meal of meals) {
        const isNew = !existSet.has(`${adm.id}|${meal}`);
        try {
          // @@unique([admissionId,date,mealType]) 멱등 upsert
          await this.prisma.mealOrder.upsert({
            where: { admissionId_date_mealType: { admissionId: adm.id, date: d, mealType: meal } },
            create: { admissionId: adm.id, patientId: adm.patientId, date: d, mealType: meal, dietType: resolved.dietType, allergies: foodAllergies, wardName, notes: resolved.note },
            // 알레르기·병동·**식이(처방 반영)** 최신화. 기존 상태·섭취는 보존한다.
            update: { allergies: foodAllergies, wardName, dietType: resolved.dietType, notes: resolved.note },
          });
          if (isNew) created++; else skipped++;
        } catch { skipped++; }
      }
    }
    // 🔴 "처방 없이 기본식으로 나간 환자 수"를 분모와 함께 돌려준다 — 0 이 아니면 확인이 필요하다
    return { generated: created, skipped, admissions: admissions.length, withoutDietOrder: withoutOrder };
  }

  /**
   * 식이 정본 해석 — **활성 처방 > 입원 시 지정 > 기본식**.
   * 🔴 기본식으로 떨어졌다는 사실을 `note` 로 남긴다. 조용히 '일반식'을 쓰면
   *    당뇨·신장 환자가 일반식을 받아도 아무도 그것을 알아채지 못한다.
   */
  static resolveDiet(
    order: { dietType: string; texture?: string | null } | undefined,
    admissionDiet: string | null | undefined,
  ): { dietType: string; source: 'ORDER' | 'ADMISSION' | 'DEFAULT'; note: string } {
    if (order) {
      const tx = order.texture ? ` · 질감 ${dietTextureText(order.texture)}` : '';
      return { dietType: order.dietType, source: 'ORDER', note: `식이 출처: 처방(활성)${tx}` };
    }
    if (admissionDiet) {
      return { dietType: admissionDiet, source: 'ADMISSION', note: '식이 출처: 입원 시 지정 — 식이 처방 없음' };
    }
    return { dietType: '일반식', source: 'DEFAULT', note: '🔴 식이 처방이 없어 기본 일반식으로 배식됩니다 — 처방 확인이 필요합니다.' };
  }

  /** 병동별 식수 집계 — 병동 × 식이유형 매트릭스 + 배식 상태 + 섭취율 */
  async getMealCensus(date?: string, mealType?: string) {
    const d = date ? this.dayValue(date) : todayDateOnly();
    const where: Prisma.MealOrderWhereInput = { date: d };
    if (mealType) where.mealType = mealType;
    const orders = await this.prisma.mealOrder.findMany({ where, select: { admissionId: true, wardName: true, dietType: true, status: true, intakePercent: true, notes: true } });
    /**
     * 🔴 **식이 처방 없이 기본식으로 나가는 환자**를 센다(분모와 함께).
     *    당뇨·신장 환자가 일반식을 받아도 종전에는 화면이 아무 말도 하지 않았다.
     *    출처는 생성 시 `notes` 에 기록된다(`resolveDiet`).
     */
    const noOrderAdmissions = new Set(
      orders.filter((o) => (o.notes ?? '').includes('식이 처방이 없어')).map((o) => o.admissionId),
    );
    const byWard: Record<string, { total: number; byDiet: Record<string, number>; byStatus: Record<string, number>; intakeSum: number; intakeCount: number; lowIntake: number }> = {};
    const dietTotals: Record<string, number> = {};
    let lowIntakeTotal = 0;
    for (const o of orders) {
      const w = o.wardName ?? '(미지정)';
      const b = (byWard[w] ??= { total: 0, byDiet: {}, byStatus: {}, intakeSum: 0, intakeCount: 0, lowIntake: 0 });
      b.total++;
      b.byDiet[o.dietType] = (b.byDiet[o.dietType] ?? 0) + 1;
      b.byStatus[o.status] = (b.byStatus[o.status] ?? 0) + 1;
      dietTotals[o.dietType] = (dietTotals[o.dietType] ?? 0) + 1;
      if (o.intakePercent != null) { b.intakeSum += o.intakePercent; b.intakeCount++; if (o.intakePercent <= 25) { b.lowIntake++; lowIntakeTotal++; } }
    }
    const admissionSet = new Set(orders.map((o) => o.admissionId));
    const wards = Object.entries(byWard).map(([ward, v]) => ({
      ward, total: v.total, byDiet: v.byDiet, byStatus: v.byStatus, lowIntake: v.lowIntake,
      avgIntake: v.intakeCount ? Math.round(v.intakeSum / v.intakeCount) : null,
    })).sort((a, b) => b.total - a.total);
    return {
      date: localDateKey(d), mealType: mealType ?? 'ALL', total: orders.length, lowIntakeTotal, wards, dietTotals,
      /** 🔴 식이 처방 없이 기본식으로 나가는 환자 — 분모(재원 환자 수)와 함께 읽는다 */
      dietOrderGap: { withoutOrder: noOrderAdmissions.size, admissions: admissionSet.size },
    };
  }

  // ── 생산(조리) — 급양과 ──
  /** 생산량 산출 — 당일 식수(MealOrder)를 끼니×식이유형별 생산 배치로 전개(조리지시서). */
  async generateProduction(date: string) {
    const d = this.dayValue(date);
    const orders = await this.prisma.mealOrder.findMany({ where: { date: d }, select: { mealType: true, dietType: true, allergies: true } });
    const agg: Record<string, { qty: number; allergy: number }> = {};
    for (const o of orders) { const k = `${o.mealType}|${o.dietType}`; const a = (agg[k] ??= { qty: 0, allergy: 0 }); a.qty++; if (o.allergies) a.allergy++; }
    let batches = 0;
    for (const [k, v] of Object.entries(agg)) {
      const [mealType, dietType] = k.split('|');
      await this.prisma.productionBatch.upsert({
        where: { date_mealType_dietType: { date: d, mealType, dietType } },
        create: { date: d, mealType, dietType, plannedQty: v.qty, allergyNote: v.allergy ? `알레르기 대체 ${v.allergy}건` : null },
        update: { plannedQty: v.qty, allergyNote: v.allergy ? `알레르기 대체 ${v.allergy}건` : null }, // 상태·실생산 보존
      });
      batches++;
    }
    return { batches, meals: orders.length };
  }
  async getProduction(date?: string) {
    const d = date ? this.dayValue(date) : todayDateOnly();
    const batches = await this.prisma.productionBatch.findMany({ where: { date: d }, orderBy: [{ mealType: 'asc' }, { dietType: 'asc' }] });
    const ids = batches.map((b) => b.id);
    const insp = ids.length ? await this.prisma.mealInspection.findMany({ where: { productionBatchId: { in: ids } }, orderBy: { inspectedAt: 'desc' } }) : [];
    const inspBy = new Map<string, { pass: boolean }>();
    for (const i of insp) if (!inspBy.has(i.productionBatchId)) inspBy.set(i.productionBatchId, { pass: i.pass });
    const haccp = ids.length ? await this.prisma.haccpCheck.findMany({ where: { productionBatchId: { in: ids } }, select: { productionBatchId: true, withinLimit: true } }) : [];
    const haccpBy = new Map<string, { count: number; violation: boolean }>();
    for (const h of haccp) { if (!h.productionBatchId) continue; const e = haccpBy.get(h.productionBatchId) ?? { count: 0, violation: false }; e.count++; if (!h.withinLimit) e.violation = true; haccpBy.set(h.productionBatchId, e); }
    return batches.map((b) => ({ ...b, inspection: inspBy.get(b.id) ?? null, haccp: haccpBy.get(b.id) ?? { count: 0, violation: false } }));
  }
  async updateProductionStatus(id: string, data: { status?: string; producedQty?: number; notes?: string }, cookedBy: string) {
    const patch: Prisma.ProductionBatchUpdateInput = { producedQty: data.producedQty, notes: data.notes, cookedBy };
    if (data.status === 'COOKING') patch.cookStartAt = new Date();
    if (data.status === 'DONE') patch.cookEndAt = new Date();
    if (data.status) patch.status = data.status;
    return this.prisma.productionBatch.update({ where: { id }, data: patch });
  }

  // ── HACCP CCP(중요관리점) 기록 ──
  /** CCP 기준(법정 표준): 가열 중심온도 ≥75℃·냉장 ≤5℃·온장 ≥57℃·배식소요 ≤120분. 기준 이탈 자동 판정. */
  static ccpWithinLimit(ccpType: string, value?: number): boolean {
    if (value == null) return true;
    switch (ccpType) {
      case 'HEATING': return value >= 75; // 가열 중심온도(℃)
      case 'COLD': return value <= 5;      // 냉장 보관(℃)
      case 'HOT': return value >= 57;      // 온장 보관(℃)
      case 'TIME': return value <= 120;    // 조리→배식 소요(분)
      default: return true;
    }
  }
  async recordHaccp(data: { productionBatchId?: string; date?: string; mealType?: string; ccpType: string; value?: number; correctiveAction?: string }, checkedBy: string) {
    let d: Date;
    if (data.date) { d = this.dayValue(data.date); }
    else if (data.productionBatchId) {
      const b = await this.prisma.productionBatch.findUnique({ where: { id: data.productionBatchId }, select: { date: true, mealType: true } });
      // 🔴 배치의 date 는 이미 `@db.Date`(UTC 자정)다 — 다시 로컬 자정으로 밀면 하루가 어긋난다
      d = b?.date ?? todayDateOnly(); data.mealType ??= b?.mealType ?? undefined;
    } else { d = todayDateOnly(); }
    const withinLimit = NutritionService.ccpWithinLimit(data.ccpType, data.value);
    return this.prisma.haccpCheck.create({
      data: {
        productionBatchId: data.productionBatchId ?? null, date: d, mealType: data.mealType ?? null,
        ccpType: data.ccpType, value: data.value ?? null, withinLimit,
        correctiveAction: withinLimit ? null : (data.correctiveAction ?? null), checkedBy,
      },
    });
  }
  async getHaccp(date?: string) {
    const d = date ? this.dayValue(date) : todayDateOnly();
    return this.prisma.haccpCheck.findMany({ where: { date: d }, orderBy: { checkedAt: 'desc' } });
  }

  // ── 배식 확인(5-Rights) — 오배식 방지 ──
  async recordDeliveryCheck(mealOrderId: string, data: { patientVerified?: boolean; dietVerified?: boolean; allergyVerified?: boolean; tempOk?: boolean }, deliveredBy: string) {
    const check = await this.prisma.mealDeliveryCheck.create({
      data: {
        mealOrderId,
        patientVerified: data.patientVerified ?? false, dietVerified: data.dietVerified ?? false,
        allergyVerified: data.allergyVerified ?? false, tempOk: data.tempOk ?? false, deliveredBy,
      },
    });
    /**
     * 🔴 종전엔 `.catch(() => undefined)` 로 상태 갱신 실패를 삼켰다 — 배식 확인(5-Rights)은 원장에 남는데
     *    급식 상태는 '미배식'인 채로 남아, 병동 화면과 확인 기록이 서로 다른 말을 했다.
     *    실패를 지우지 않고 **확인 기록과 함께 돌려준다**(확인은 이미 남았으므로 전파해 없던 일로 만들지 않는다).
     */
    let statusUpdated = true;
    let statusError: string | null = null;
    try {
      await this.prisma.mealOrder.update({ where: { id: mealOrderId }, data: { status: 'DELIVERED' } });
    } catch (e) {
      statusUpdated = false;
      statusError = e instanceof Error ? e.message : String(e);
      this.logger.error(`배식 확인은 기록됐으나 급식 상태 갱신 실패 mealOrder=${mealOrderId}: ${statusError}`);
    }
    return {
      ...check,
      statusUpdated,
      ...(statusUpdated ? {} : { statusNote: '배식 확인은 기록됐지만 급식 상태를 "배식 완료"로 바꾸지 못했습니다 — 목록에서 다시 확인하십시오.' }),
    };
  }

  // ══════════════════════════════════════════════
  // 직원 식단표 (Staff Meal Menu)
  // ══════════════════════════════════════════════

  /** 주간 식단표 조회 */
  async getStaffMenuWeek(startDate: string) {
    const start = this.dayValue(startDate, 'week');
    const end = new Date(start);
    end.setDate(end.getDate() + 7);

    return this.prisma.staffMealMenu.findMany({
      where: { date: { gte: start, lt: end } },
      orderBy: [{ date: 'asc' }, { mealType: 'asc' }, { courseType: 'asc' }],
    });
  }

  /** 월간 식단표 조회 */
  async getStaffMenuMonth(year: number, month: number) {
    // 🔴 `StaffMealMenu.date` 는 @db.Date — `new Date(year, month-1, 1)`(KST 로컬 자정)은 UTC 로 **전달 말일**이라
    //    `date >= 그 날짜` 가 **전월 마지막 날 메뉴를 이달에 섞는다**(하한 밀림). @db.Date 월 경계는 UTC 자정이어야
    //    한다 → `dateOnlyValue('YYYY-MM-01')`. (같은 파일 getStaffMenuWeek/ByDate 는 이미 dayValue 를 쓴다.)
    const mm = String(month).padStart(2, '0');
    const start = this.dayValue(`${year}-${mm}-01`);
    const ny = month === 12 ? year + 1 : year;
    const nm = String(month === 12 ? 1 : month + 1).padStart(2, '0');
    const end = this.dayValue(`${ny}-${nm}-01`); // 배타 상한(다음 달 1일)

    return this.prisma.staffMealMenu.findMany({
      where: { date: { gte: start, lt: end } },
      orderBy: [{ date: 'asc' }, { mealType: 'asc' }, { courseType: 'asc' }],
    });
  }

  /** 특정일 식단 조회 */
  async getStaffMenuByDate(date: string) {
    const d = this.dayValue(date);
    const next = new Date(d);
    next.setDate(next.getDate() + 1);

    return this.prisma.staffMealMenu.findMany({
      where: { date: { gte: d, lt: next } },
      orderBy: [{ mealType: 'asc' }, { courseType: 'asc' }],
    });
  }

  /** 식단 등록/수정 (급양과) */
  async upsertStaffMenu(data: {
    date: string; mealType: string; courseType: string;
    menuName: string; description?: string; price?: number;
    calories?: number; allergens?: string; imageUrl?: string; isSpecial?: boolean;
  }, userId: string) {
    const date = this.dayValue(data.date);

    return this.prisma.staffMealMenu.upsert({
      where: { date_mealType_courseType: { date, mealType: data.mealType, courseType: data.courseType } },
      create: {
        date, mealType: data.mealType, courseType: data.courseType,
        menuName: data.menuName, description: data.description,
        price: data.price ?? 0, calories: data.calories,
        allergens: data.allergens, imageUrl: data.imageUrl,
        isSpecial: data.isSpecial ?? false, createdBy: userId,
      },
      update: { menuName: data.menuName, description: data.description, price: data.price, calories: data.calories, allergens: data.allergens, imageUrl: data.imageUrl, isSpecial: data.isSpecial },
    });
  }

  /** 식단 삭제 */
  async deleteStaffMenu(id: string) {
    return this.prisma.staffMealMenu.delete({ where: { id } });
  }

  /** 주간 식단 일괄 등록 (급양과) */
  async bulkCreateStaffMenu(menus: Array<{
    date: string; mealType: string; courseType: string;
    menuName: string; description?: string; price?: number;
    calories?: number; allergens?: string; isSpecial?: boolean;
  }>, userId: string) {
    let created = 0;
    for (const m of menus) {
      await this.upsertStaffMenu(m, userId);
      created++;
    }
    return { created };
  }

  // ══════════════════════════════════════════════
  // 직원 식수 신청
  // ══════════════════════════════════════════════

  /** 식수 신청 */
  async requestStaffMeal(userId: string, data: { date: string; mealType: string; courseType?: string }) {
    const date = this.dayValue(data.date);

    return this.prisma.staffMealRequest.upsert({
      where: { userId_date_mealType: { userId, date, mealType: data.mealType } },
      create: { userId, date, mealType: data.mealType, courseType: data.courseType ?? 'A' },
      update: { courseType: data.courseType ?? 'A', status: 'REQUESTED', cancelledAt: null },
    });
  }

  /** 식수 취소 */
  async cancelStaffMeal(userId: string, id: string) {
    return this.prisma.staffMealRequest.updateMany({
      where: { id, userId, status: 'REQUESTED' },
      data: { status: 'CANCELLED', cancelledAt: new Date() },
    });
  }

  /** 내 식수 신청 내역 (주간) */
  async getMyMealRequests(userId: string, startDate: string) {
    const start = this.dayValue(startDate, 'week');
    const end = new Date(start);
    end.setDate(end.getDate() + 7);

    return this.prisma.staffMealRequest.findMany({
      where: { userId, date: { gte: start, lt: end }, status: { not: 'CANCELLED' } },
      orderBy: [{ date: 'asc' }, { mealType: 'asc' }],
    });
  }

  /** 급양과 — 일별 식수 현황 */
  async getStaffMealStats(date: string) {
    const d = this.dayValue(date);
    const next = new Date(d);
    next.setDate(next.getDate() + 1);

    const requests = await this.prisma.staffMealRequest.groupBy({
      by: ['mealType', 'courseType'],
      where: { date: { gte: d, lt: next }, status: { not: 'CANCELLED' } },
      _count: { id: true },
    });

    const byMeal: Record<string, { total: number; byCourse: Record<string, number> }> = {};
    for (const r of requests) {
      if (!byMeal[r.mealType]) byMeal[r.mealType] = { total: 0, byCourse: {} };
      byMeal[r.mealType].total += r._count.id;
      byMeal[r.mealType].byCourse[r.courseType] = r._count.id;
    }

    return { date: d.toISOString().slice(0, 10), byMeal };
  }

  /** 급양과 — 주간 식수 통계 */
  async getStaffMealWeeklyStats(startDate: string) {
    const start = this.dayValue(startDate, 'week');
    const days: Array<{ date: string; byMeal: Record<string, any> }> = [];

    for (let i = 0; i < 7; i++) {
      const d = new Date(start);
      d.setDate(d.getDate() + i);
      const stat = await this.getStaffMealStats(d.toISOString().slice(0, 10));
      days.push(stat);
    }
    return days;
  }

  /** 마감 확정 — 해당 일자 신청(REQUESTED)을 CONFIRMED로 전이(발주량 확정). ADMIN. */
  async confirmStaffMeals(date: string) {
    const d = this.dayValue(date);
    const next = new Date(d);
    next.setDate(next.getDate() + 1);
    const r = await this.prisma.staffMealRequest.updateMany({
      where: { date: { gte: d, lt: next }, status: 'REQUESTED' },
      data: { status: 'CONFIRMED' },
    });
    return { confirmed: r.count, date: d.toISOString().slice(0, 10) };
  }

  /** 월별 식대 정산 — 직원별 식수 × 메뉴가격 합계(급여공제 연계용). ADMIN. */
  async getStaffMealSettlement(month: string, userId?: string) {
    // 🔴 종전 `${month}-01T00:00:00+09:00` 은 UTC 로 **전달 말일 15:00** 이 되어
    //    `@db.Date` 비교에서 **전달 말일 신청이 이번 달 정산에 포함**됐다(급여공제 금액이 어긋난다).
    const start = this.dayValue(`${month}-01`, 'month');
    const end = new Date(start);
    end.setUTCMonth(end.getUTCMonth() + 1);
    const requests = await this.prisma.staffMealRequest.findMany({
      where: { date: { gte: start, lt: end }, status: { not: 'CANCELLED' }, ...(userId ? { userId } : {}) },
      select: { userId: true, date: true, mealType: true, courseType: true },
    });
    const menus = await this.prisma.staffMealMenu.findMany({
      where: { date: { gte: start, lt: end } },
      select: { date: true, mealType: true, courseType: true, price: true },
    });
    const key = (d: Date, m: string, c: string) => `${d.toISOString().slice(0, 10)}|${m}|${c}`;
    const priceMap = new Map(menus.map((mn) => [key(mn.date, mn.mealType, mn.courseType), mn.price]));
    const byUser: Record<string, { count: number; amount: number }> = {};
    for (const r of requests) {
      const price = priceMap.get(key(r.date, r.mealType, r.courseType ?? 'A')) ?? 0;
      const b = (byUser[r.userId] ??= { count: 0, amount: 0 });
      b.count++;
      b.amount += price;
    }
    const ids = Object.keys(byUser);
    const users = ids.length ? await this.prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, familyName: true, givenName: true } }) : [];
    const nameBy = new Map(users.map((u) => [u.id, `${u.familyName ?? ''}${u.givenName ?? ''}`]));
    const rows = ids.map((id) => ({ userId: id, name: nameBy.get(id) ?? '', count: byUser[id].count, amount: byUser[id].amount })).sort((a, b) => b.amount - a.amount);
    return { month, totalMeals: requests.length, totalAmount: rows.reduce((s, r) => s + r.amount, 0), rows };
  }
}
