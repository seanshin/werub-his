import { Injectable, NotFoundException, BadRequestException, ConflictException, Optional } from '@nestjs/common';
import { todayDateOnly, todayRange } from '../../common/day-range';
import { deriveSurgeryConsentStatus, SURGERY_CONSENT_TYPES, DEFAULT_CONSENT_WINDOW_DAYS } from '../consent/surgery-consent-status';
import { ageOf, DIAGNOSTIC_STATION_CATEGORY, resolveDiagnosticStationTypes } from '@hospital-run/shared';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import type { CompleteLabResultDto } from './dto/complete-lab-result.dto';
import { assertOrderTransition, buildOrderData, emitOrderCreated } from '../order/order.service';
import { completeTherapyOrder } from '../therapy-order/therapy-completion';
import { PharmacyService } from '../pharmacy/pharmacy.service';
import { ImagingSafetyService } from '../imaging/imaging-safety.service';
import { DiagnosticTestService } from '../diagnostic-test/diagnostic-test.service';
import { isIonizingModality } from '../../common/imaging-modality';
import { matchStationProcedureCodes } from '../../common/station-order-codes';
import { resolveCollectionTime } from './specimen-collection';

@Injectable()
export class WorkstationService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly pharmacy?: PharmacyService,
    @Optional() private readonly eventEmitter?: EventEmitter2,
    @Optional() private readonly imagingSafety?: ImagingSafetyService,
    @Optional() private readonly diagnosticTests?: DiagnosticTestService,
  ) {}

  // ── 스테이션 목록 ──
  async getStations(category?: string) {
    const where: Record<string, unknown> = { isActive: true };
    if (category) where.category = category;
    return this.prisma.workstationConfig.findMany({
      where,
      orderBy: [{ category: 'asc' }, { sortOrder: 'asc' }],
    });
  }

  // ── Worklist (대기 환자) ──
  // 스테이션 ID → 카테고리 fallback 매핑
  private static readonly STATION_DEPT_MAP: Record<string, string> = {
    'lab-phlebotomy': 'LAB', 'lab-hematology': 'LAB', 'lab-chemistry': 'LAB',
    'lab-urinalysis': 'LAB', 'lab-microbiology': 'LAB', 'lab-bloodbank': 'LAB', 'lab-pathology': 'LAB',
    // 🔴 FE 가 부르는 id 를 그대로 등재해야 한다 — `imaging-xray` 가 없어 **영상 스테이션이
    //    검사(LAB) 오더를 보고 있었다**(2026-08-12 실측). 별칭이 생기면 여기에 함께 넣는다.
    'imaging-xray': 'IMAGING',
    'img-xray': 'IMAGING', 'img-ct': 'IMAGING', 'img-mri': 'IMAGING',
    'img-ultrasound': 'IMAGING', 'img-mammography': 'IMAGING', 'img-intervention': 'IMAGING', 'img-nuclear': 'IMAGING',
    // 🔴 `diag-*` 는 여기서 **뺐다**(2026-08-26). 기초검사 오더는 `orders` 가 아니라
    //    `diagnostic_tests` 에 쌓이는데 이 매핑이 LAB 로 보내는 바람에, 설정 코드가
    //    코드 마스터와 하나도 안 맞아(교집합 0) **부서 전체 폴백**이 걸렸다 —
    //    심전도실·폐기능실·내시경실·청력실·심장검사실 다섯 화면이 전부 **같은 채혈 오더 8건**을
    //    자기 검사 대기로 보여주고 있었다. 아래 `getQueue` 가 기초검사 정본 큐로 위임한다.
  };

  // ── 수술 준비(병동) 큐 — 2026-09-30 ──
  /**
   * 🔴 종전 `surgery-prep` 은 `STATION_DEPT_MAP` 에 없어 **구조적으로 영원히 빈 목록**이었다(수술은 `orders` 에 없다 —
   *    정본은 `surgeries`). 화면은 "대기 중인 수술 준비가 없습니다"라고 말했고, 운영에는 오늘 예정 수술 4건이 있었다.
   *    큐 = 예정(SCHEDULED) 수술 · 어제 0시 ~ 내일 24시(KST) · 준비 상태는 **이미 있는 정본에서 파생**한다(새 상태를 만들지 않는다):
   *      마취전평가(`pre_anesthesia_evaluations`) · 수술/마취/수혈 동의(정본 `deriveSurgeryConsentStatus`) · WHO Sign-in(`surgical_checklists`)
   *    "준비 완료"를 합쳐 초록으로 그리지 않는다 — 항목마다 상태를 보인다(합치면 빠진 항목이 가려진다).
   */
  static readonly SURGERY_PREP_CAP = 200;
  static surgeryPrepWindow(now: Date = new Date()) {
    const { gte } = todayRange(now);
    const start = new Date(gte); start.setDate(start.getDate() - 1);
    const end = new Date(gte); end.setDate(end.getDate() + 2);
    return { start, end };
  }

  async getSurgeryPrepMeta(now: Date = new Date()) {
    const { start, end } = WorkstationService.surgeryPrepWindow(now);
    const [staleScheduled, inWindow] = await Promise.all([
      // 창보다 오래된 예정 수술 — 시작도 취소도 기록되지 않은 채 남은 것. 큐에 넣지 않되 **있다고 말한다**
      this.prisma.surgery.count({ where: { status: 'SCHEDULED', scheduledAt: { lt: start } } }),
      this.prisma.surgery.count({ where: { status: 'SCHEDULED', scheduledAt: { gte: start, lt: end } } }),
    ]);
    return { windowStart: start, windowEnd: end, staleScheduled, total: inWindow, truncated: inWindow > WorkstationService.SURGERY_PREP_CAP };
  }

  async getSurgeryPrepQueue(now: Date = new Date()) {
    const { start, end } = WorkstationService.surgeryPrepWindow(now);
    const surgeries = await this.prisma.surgery.findMany({
      where: { status: 'SCHEDULED', scheduledAt: { gte: start, lt: end } },
      orderBy: { scheduledAt: 'asc' },
      take: WorkstationService.SURGERY_PREP_CAP,
      select: {
        id: true, status: true, scheduledAt: true, procedureName: true, procedureCode: true, bodySite: true, laterality: true,
        anesthesiaType: true, admissionId: true, patientId: true, createdAt: true,
        patient: { select: { id: true, mrn: true, familyName: true, givenName: true, gender: true, dateOfBirth: true } },
        surgeon: { select: { familyName: true, givenName: true } },
        preAnesthesiaEvaluation: { select: { status: true, npoConfirmed: true, completedAt: true } },
      },
    });
    if (surgeries.length === 0) return [];
    const ids = surgeries.map((s) => s.id);
    const patientIds = [...new Set(surgeries.map((s) => s.patientId))];
    const since = new Date(now.getTime() - DEFAULT_CONSENT_WINDOW_DAYS * 86_400_000);
    const [consents, checklists] = await Promise.all([
      this.prisma.consentForm.findMany({
        where: { patientId: { in: patientIds }, consentType: { in: [...SURGERY_CONSENT_TYPES] }, OR: [{ surgeryId: { in: ids } }, { createdAt: { gte: since } }] },
        select: { id: true, patientId: true, consentType: true, status: true, signedAt: true, surgeryId: true, createdAt: true, isValid: true, revokedAt: true, supersededAt: true, expiresAt: true },
      }),
      this.prisma.surgicalChecklist.findMany({ where: { surgeryId: { in: ids } }, select: { surgeryId: true, signInCompletedAt: true } }),
    ]);
    const signInBy = new Map(checklists.map((c) => [c.surgeryId, c.signInCompletedAt]));
    return surgeries.map((s) => {
      const consent = deriveSurgeryConsentStatus(
        consents.filter((c) => c.patientId === s.patientId).map((c) => ({ ...c, consentType: c.consentType as string | null, status: c.status as string | null })),
        { surgeryId: s.id, since, now },
      );
      const pa = s.preAnesthesiaEvaluation;
      return {
        source: 'SURGERY' as const,
        surgeryId: s.id,
        status: s.status,
        scheduledAt: s.scheduledAt,
        // 예정 시각이 지났는데 시작 기록이 없다 — 지연인지 기록 누락인지는 모른다(판정하지 않고 사실만)
        pastScheduled: s.scheduledAt.getTime() < now.getTime(),
        procedureName: s.procedureName,
        procedureCode: s.procedureCode,
        bodySite: s.bodySite,
        laterality: s.laterality,
        anesthesiaType: s.anesthesiaType,
        admissionId: s.admissionId,
        surgeonName: s.surgeon ? `${s.surgeon.familyName ?? ''}${s.surgeon.givenName ?? ''}` || null : null,
        patient: s.patient ? { ...s.patient, age: s.patient.dateOfBirth ? ageOf(s.patient.dateOfBirth) : null } : null,
        prep: {
          // NONE = 평가 기록 없음 · DRAFT = 작성 중 · COMPLETED = 완료
          preAnesthesia: pa ? (pa.status === 'COMPLETED' ? 'COMPLETED' : 'DRAFT') : 'NONE',
          // 평가가 없으면 금식 여부를 모른다(null) — false(확인 안 함)와 다르다
          npoConfirmed: pa ? pa.npoConfirmed : null,
          consent: Object.fromEntries(consent.map((c) => [c.consentType, { state: c.state, matchedBy: c.matchedBy }])),
          signInCompletedAt: signInBy.get(s.id) ?? null,
        },
      };
    });
  }

  // 영양(급양) 큐 — 오늘 조리/배식 대기 식단
  private async getNutritionQueue() {
    const MEAL_LABEL: Record<string, string> = { BREAKFAST: '조식', LUNCH: '중식', DINNER: '석식', SNACK: '간식' };
    const today = todayDateOnly(); // 🔴 @db.Date 비교 — 로컬 자정(setHours)은 하루 밀린다(정본)
    // 🔴 조리 대기(ORDERED)·배식 대기(PREPARED)만 담으면 화면의 '완료' 탭이 **언제나 0건**이 된다.
    //    그 0 은 "오늘 배식이 없었다"가 아니라 "이 질의가 안 담았다"라 서로 다른 사실이다.
    const meals = await this.prisma.mealOrder.findMany({
      where: { date: today, status: { in: ['ORDERED', 'PREPARED', 'DELIVERED', 'UNDELIVERED'] } },
      include: { patient: { select: { id: true, mrn: true, familyName: true, givenName: true, gender: true, dateOfBirth: true } } },
      orderBy: [{ mealType: 'asc' }, { createdAt: 'asc' }],
      take: 200,
    });
    return meals.map((m) => {
      const age = m.patient?.dateOfBirth ? ageOf(m.patient.dateOfBirth) : null;
      return {
        /**
         * 🔴 **`orderId` 를 담지 않는다.** 여기 담기는 것은 `MealOrder.id` 이고
         *    `/workstation/order/:id/{receive,start,complete}` 는 `Order` 를 조회한다 —
         *    이름이 같다는 이유로 화면이 그 EP 를 불러 **개통 이래 전건 404** 였다
         *    (운영 실측: meal_orders 24건 중 orders 에도 있는 id 0건).
         *    급식 상태 정본은 `PATCH /api/v1/nutrition/meals/:id/status` 다.
         *    (기초검사 자리에서 같은 함정을 이미 겪어 그쪽은 처음부터 담지 않았다)
         */
        source: 'MEAL_ORDER' as const,
        mealOrderId: m.id,
        status: m.status,
        priority: 'ROUTINE',
        createdAt: m.createdAt,
        procedureCode: m.dietType,
        procedureName: `${MEAL_LABEL[m.mealType] ?? m.mealType} · ${m.dietType}${m.allergies ? ` · ⚠️알레르기 ${m.allergies}` : ''}${m.wardName ? ` · ${m.wardName}` : ''}`,
        patient: m.patient ? { ...m.patient, age } : null,
        encounterId: null, hasLabResult: false, hasImagingResult: false,
      };
    });
  }

  /**
   * 설정된 검사코드 중 **실제 코드 마스터에 존재하는 것만** 남긴다.
   * 하나도 없으면 설정이 코드 체계를 잘못 쓰고 있다는 뜻이므로 `mismatch` 로 알린다.
   */
  private async resolveStationCodes(codes: string[]): Promise<{ usable: string[]; mismatch: boolean }> {
    if (!codes.length) return { usable: [], mismatch: false };
    // 🔴 관리 화면(/admin/workstations 검사항목 설정)과 **같은 대조 정본**을 쓴다 — 따로 대조하면 갈라진다
    const { matched } = await matchStationProcedureCodes(this.prisma, codes);
    const usable = matched.map((r) => r.code);
    return { usable, mismatch: usable.length === 0 };
  }

  /**
   * 스테이션 설정 건강도 — 화면이 **왜 비었는지**를 말할 근거.
   *
   * 🔴 빈 목록에는 뜻이 셋 있는데 화면은 전부 "업무가 없습니다"라고만 했다.
   *    ⓐ 정말 할 일이 없다 ⓑ 설정이 안 맞아 부서 전체를 보는 중 ⓒ **이 스테이션은 아직
   *    업무 목록이 연결되지 않았다**(퇴원·중환자·접수·혈액은행 등 12종). ⓒ 는 오늘 예약이
   *    23건 있는데도 접수 워크스테이션이 0 을 보이던 상태다 — 사용자는 한가한 줄 안다.
   */
  async getStationConfigHealth(stationId: string) {
    const station = await this.prisma.workstationConfig.findUnique({ where: { stationId } });
    const codes = (station?.orderCodes as string[]) ?? [];
    const { usable, mismatch } = await this.resolveStationCodes(codes);

    const isTherapy = stationId.startsWith('tx-') || stationId.startsWith('therapy-');
    const hasOwnQueue =
      isTherapy ||
      stationId === 'pharmacy' ||
      stationId === 'surgery-prep' ||
      stationId === 'nutrition' ||
      stationId === 'nut-kitchen' ||
      station?.category === 'IMAGING' ||
      station?.category === DIAGNOSTIC_STATION_CATEGORY ||
      !!WorkstationService.STATION_DEPT_MAP[stationId];

    // 기초검사 자리의 설정 코드는 **수가코드가 아니라 검사 종류**(`EKG`·`PFT`…)다.
    // procedureCode 마스터로 대조하면 항상 mismatch 로 읽혀 화면이 거짓 경고를 낸다.
    if (station?.category === DIAGNOSTIC_STATION_CATEGORY) {
      const r = resolveDiagnosticStationTypes(station.orderCodes);
      return {
        configuredCodes: r.usable.length + r.unknown.length,
        matchedCodes: r.usable.length,
        configMismatch: r.usable.length === 0 && r.unknown.length > 0,
        queueWired: true,
      };
    }

    return {
      configuredCodes: codes.length,
      matchedCodes: usable.length,
      configMismatch: mismatch,
      /** false = 이 스테이션에 연결된 업무 목록이 없다(빈 목록이 "한가하다"는 뜻이 아니다) */
      queueWired: hasOwnQueue,
    };
  }

  async getQueue(stationId: string, statOnly?: boolean) {
    const station = await this.prisma.workstationConfig.findUnique({
      where: { stationId },
    });

    // config가 없어도 카테고리 fallback으로 동작
    const dept = station?.category === 'IMAGING' ? 'IMAGING'
      : WorkstationService.STATION_DEPT_MAP[stationId];
    const codes = (station?.orderCodes as string[]) ?? [];

    // 치료실은 TherapyOrder.scheduledDate + stationId 기반 조회.
    // 🔴 FE 는 `therapy-pt` 로 부르는데 판정이 `tx-` prefix 뿐이라 **치료실이 LAB 폴백**에 걸렸다.
    const isTherapyStation = stationId.startsWith('tx-') || stationId.startsWith('therapy-');
    if (isTherapyStation) {
      return this.getTherapyQueue(stationId, statOnly);
    }

    // 수술 준비는 `surgeries` 가 정본(수술은 orders 에 없다) — 2026-09-30
    if (stationId === 'surgery-prep') {
      return this.getSurgeryPrepQueue();
    }

    // 영양(급양)은 MealOrder 기반 조리/배식 큐(LAB 폴백 버그 수정)
    if (stationId === 'nutrition' || stationId === 'nut-kitchen') {
      return this.getNutritionQueue();
    }

    // 약국(pharmacy)은 STATION_DEPT_MAP에 없어 dept가 'LAB'로 폴백되던 버그 → PHARMACY 오더 워크리스트로 위임.
    // 조제/완료는 약국 도메인(startDispensing/completeDispensing·DUR게이트·이벤트·재고 outbox)이 SoT.
    if (stationId === 'pharmacy') {
      return this.getPharmacyWorklist(statOnly);
    }

    // 기초검사 자리는 `diagnostic_tests` 가 정본이다 — `orders` 에는 그 오더가 없다.
    // 🔴 `orderId` 를 담지 않는다: 이 id 로 `/workstation/order/:id/receive` 를 부르면
    //    남의 오더를 건드리는 것이 아니라 404 로 **크게 실패해야** 한다(조용한 오작동 방지).
    if (station?.category === DIAGNOSTIC_STATION_CATEGORY) {
      if (!this.diagnosticTests) return [];
      const { items } = await this.diagnosticTests.getStationQueue(stationId, { statOnly });
      return items.map((t) => ({
        source: 'DIAGNOSTIC_TEST' as const,
        diagnosticTestId: t.id,
        status: t.status,
        priority: t.priority,
        createdAt: t.createdAt,
        procedureCode: t.testType,
        procedureName: t.testName,
        patient: t.patient,
        encounterId: null,
        hasLabResult: false,
        hasImagingResult: false,
      }));
    }

    // 🔴 **미매핑 스테이션에 LAB 오더를 주지 않는다.** 종전엔 `?? 'LAB'` 폴백이라
    //    퇴원·중환자·접수·혈액은행 워크스테이션이 남의 검사 오더를 "퇴원 업무"·"ICU 업무"로
    //    보여줬다(2026-08-12 실측 12스테이션). 임상 워크리스트에서 **틀린 목록은 빈 목록보다 나쁘다**
    //    — 그 목록을 보고 조치하기 때문이다. 각 스테이션의 진짜 큐 배선은 도메인별 후속 과제.
    if (!dept) return [];

    // 🔴 **설정 코드가 실제 코드 체계와 다르면 필터가 항상 공집합이 된다.**
    //    `workstation_configs.order_codes` 는 `CBC`·`HbA1c` 같은 **별칭**인데 오더의
    //    procedureCode 는 `E6591`(HbA1c)·`E6502`(CRP) 같은 **EDI 수가코드**다 —
    //    설정 코드 중 코드 마스터에 실재하는 것이 **0개**였다(2026-08-12 실측).
    //    그 결과 검사 5탭·영상 6탭·진단 7탭 **18 스테이션이 구조적으로 영원히 0건**이었다.
    //    설정이 하나도 안 맞으면 **필터를 걸지 않고 부서 전체를 보여준다** — 잘못된 설정 때문에
    //    실제 업무가 조용히 사라지는 것이 훨씬 위험하다. 불일치 사실은 meta 로 화면에 알린다.
    const { usable } = await this.resolveStationCodes(codes);

    const where: Record<string, unknown> = {
      department: dept,
      status: { in: ['ORDERED', 'RECEIVED', 'IN_PROGRESS'] },
      prescription: {
        // 중단(2026-09-30)된 처방의 **이미 접수·시작된** 오더는 남긴다(접수 전은 중단 때 취소됨) — 큐에서 사라지면 아무도 마무리하지 않는다
        status: { in: ['ACTIVE', 'DISCONTINUED'] },
        ...(usable.length > 0
          ? { procedureCode: { code: { in: usable } } }
          : {}
        ),
      },
    };
    if (statOnly) where.priority = 'STAT';

    const orders = await this.prisma.order.findMany({
      where,
      include: {
        prescription: {
          include: {
            encounter: {
              include: {
                patient: {
                  select: {
                    id: true, mrn: true, familyName: true, givenName: true,
                    gender: true, dateOfBirth: true,
                  },
                },
              },
            },
            procedureCode: { select: { code: true, nameKo: true } },
          },
        },
        labResult: { select: { id: true, status: true } },
        imagingResult: { select: { id: true, status: true } },
        specimenCollector: { select: { familyName: true, givenName: true } },
      },
      orderBy: [
        { priority: 'asc' }, // STAT first (alphabetically before ROUTINE)
        { createdAt: 'asc' },
      ],
      take: 50,
    });

    return orders.map((o) => {
      const patient = o.prescription.encounter?.patient;
      const age = patient?.dateOfBirth
        ? ageOf(patient.dateOfBirth)
        : null;
      return {
        orderId: o.id,
        status: o.status,
        priority: o.priority,
        createdAt: o.createdAt,
        receivedAt: o.receivedAt,
        startedAt: o.startedAt,
        procedureCode: o.prescription.procedureCode?.code ?? null,
        procedureName: o.prescription.procedureCode?.nameKo ?? o.prescription.instructions ?? '',
        patient: patient ? { ...patient, age } : null,
        encounterId: o.prescription.encounter?.id ?? null,
        hasLabResult: !!o.labResult,
        hasImagingResult: !!o.imagingResult,
        // 검체 채취(2026-10-01) — 검사 오더만 의미가 있다 · 없으면 null(접수 시각으로 채우지 않는다)
        specimenCollectedAt: o.specimenCollectedAt,
        specimenCollectionSource: o.specimenCollectionSource,
        specimenCollectorName: o.specimenCollector ? `${o.specimenCollector.familyName}${o.specimenCollector.givenName}` : null,
        labResultStatus: o.labResult?.status ?? null,
        imagingResultStatus: o.imagingResult?.status ?? null,
      };
    });
  }

  // ── 약국 워크리스트 (PHARMACY 오더 + Dispensing 상태) ──
  // 상태(status)는 조제(Dispensing) 진행에 따른 유효상태로 매핑 — FE STATUS_MAP과 정합:
  //   Dispensing 없음 → order.status(ORDERED/RECEIVED) / PENDING → IN_PROGRESS(조제중) / DISPENSED → 검수대기 / VERIFIED → 완료
  // 큐 대상: 진행중(ORDERED/RECEIVED/IN_PROGRESS) + 검수대기(DISPENSED) + 불출대기(VERIFIED).
  // ISSUED(불출 완료)에서 큐를 이탈한다 — 검수가 종점이 아니라 실물 교부 확인까지가 체인.
  private async getPharmacyWorklist(statOnly?: boolean) {
    const where: Prisma.OrderWhereInput = {
      department: 'PHARMACY',
      // 🔴 **약사가 조제할 수 없는 것을 조제 큐에 올리지 않는다.**
      //    `orders.department='PHARMACY'` 로 저장된 것 중 절반 가까이가 약이 아니었다 —
      //    `병실 내 보행`·`침상머리 30° 거상`·`체위 변경`(ACTIVITY·NURSING)·`기본식사`(DIET)·
      //    `BUN 외 7종`(LAB). 실측 19건 중 **8건이 비약물**이었다(2026-08-12).
      //    구분자는 `prescription.type` 이다. department 만 믿으면 간호 지시가 조제 대기에 선다.
      prescription: { type: 'MEDICATION' },
      OR: [
        // 중단(DISCONTINUED)된 처방도 접수·진행 중 오더는 남는다(접수 전은 중단 때 취소됨) — 화면이 prescriptionStatus 로 '처방 중단'을 말한다
        { prescription: { status: { in: ['ACTIVE', 'DISCONTINUED'] } }, status: { in: ['ORDERED', 'RECEIVED', 'IN_PROGRESS'] } },
        // 🔴 이미 조제가 시작된 건은 **처방이 취소돼도** 큐에 남는다 — 약은 이미 만들어졌고
        //    누군가 처리해야 한다. 종전엔 최상위 `prescription.status='ACTIVE'` 때문에
        //    조제 중·검수 대기·불출 대기 건이 **통지 없이 목록에서 사라졌다**(약국 큐와 동일 결함).
        { dispensing: { is: { status: { in: ['PENDING', 'DISPENSED', 'VERIFIED'] } } } },
      ],
    };
    if (statOnly) where.priority = 'STAT';

    const orders = await this.prisma.order.findMany({
      where,
      include: {
        prescription: {
          include: {
            encounter: {
              include: {
                patient: { select: { id: true, mrn: true, familyName: true, givenName: true, gender: true, dateOfBirth: true } },
              },
            },
            medicationCode: { select: { code: true, nameKo: true, nameEn: true, ingredient: true, dosageForm: true, highAlertFlag: true, controlSchedule: true } },
          },
        },
        dispensing: { select: { id: true, status: true } },
      },
      orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
      take: 100,
    });

    return orders.map((o) => {
      const patient = o.prescription.encounter?.patient;
      const age = patient?.dateOfBirth
        ? ageOf(patient.dateOfBirth)
        : null;
      const dStatus = o.dispensing?.status;
      const effectiveStatus = dStatus === 'VERIFIED' ? 'VERIFIED'
        : dStatus === 'DISPENSED' ? 'DISPENSED'
        : dStatus === 'PENDING' ? 'IN_PROGRESS'
        : o.status; // ORDERED / RECEIVED
      const rx = o.prescription;
      return {
        orderId: o.id,
        status: effectiveStatus,
        priority: o.priority,
        createdAt: o.createdAt,
        receivedAt: o.receivedAt,
        startedAt: o.startedAt,
        medicationName: rx.medicationCode?.nameKo ?? rx.instructions ?? '',
        procedureCode: rx.medicationCode?.code ?? null,
        procedureName: rx.medicationCode?.nameKo ?? rx.instructions ?? '',
        highAlert: rx.medicationCode?.highAlertFlag ?? false,
        // 🔴 **원외 처방은 원내 조제 대상이 아니다.** 종전엔 이 큐에 `pharmacyType` 이
        //    필터도 없고 응답 필드에도 없어서, 화면이 EXTERNAL 을 INTERNAL 과 구별하지 못한 채
        //    '조제' 버튼을 띄웠다(실측 대기 6건 중 **4건이 EXTERNAL**).
        //    🔴 목록에서 **빼지 않는다** — 원외 건에도 약사가 할 일(처방전 교부)이 있고,
        //    숨기면 "없는 것"과 구별되지 않는다. 대신 무엇인지 말하게 한다.
        pharmacyType: o.pharmacyType,
        // 🔴 처방이 취소됐는데 조제가 진행 중일 수 있다 — 화면이 그 사실을 말해야
        //    약사가 "왜 이게 아직 여기 있는지"를 알고 폐기·반품을 판단한다.
        prescriptionStatus: rx.status,
        // 퇴원약(2026-09-30) — 병동 투약분이 아니라 환자가 가져갈 약이다(약 봉투·복약 설명이 달라진다)
        dischargeMed: rx.dischargeMed === true,
        patient: patient ? { ...patient, age } : null,
        encounterId: o.prescription.encounter?.id ?? null,
        dispensingId: o.dispensing?.id ?? null,
        dispensingStatus: dStatus ?? null,
        prescription: {
          dosage: rx.dosage ?? undefined,
          frequency: rx.frequency ?? undefined,
          route: rx.route ?? undefined,
          quantity: rx.quantity ?? undefined,
          priority: o.priority,
          medicationCode: rx.medicationCode ? { nameKo: rx.medicationCode.nameKo, code: rx.medicationCode.code } : undefined,
        },
      };
    });
  }

  // ── 치료실 대기열 (TherapyOrder 기반) ──
  private async getTherapyQueue(stationId: string, statOnly?: boolean) {
    const today = todayDateOnly(); // 🔴 @db.Date 비교 — 로컬 자정(setHours)은 하루 밀린다(정본)
    const tomorrow = new Date(today.getTime() + 86400000);

    const where: Record<string, unknown> = {
      stationId,
      scheduledDate: { gte: today, lt: tomorrow },
      completedAt: null,
    };

    const therapyOrders = await this.prisma.therapyOrder.findMany({
      where,
      include: {
        order: {
          include: {
            prescription: {
              include: {
                encounter: {
                  include: {
                    patient: {
                      select: { id: true, mrn: true, familyName: true, givenName: true, gender: true, dateOfBirth: true },
                    },
                  },
                },
                procedureCode: { select: { code: true, nameKo: true } },
              },
            },
          },
        },
        therapist: { select: { id: true, familyName: true, givenName: true } },
      },
      orderBy: [{ scheduledTime: 'asc' }, { createdAt: 'asc' }],
    });

    return therapyOrders
      .filter((to) => !statOnly || to.order.priority === 'STAT')
      .map((to) => {
        const patient = to.order.prescription.encounter?.patient;
        const age = patient?.dateOfBirth
          ? ageOf(patient.dateOfBirth)
          : null;
        return {
          orderId: to.order.id,
          therapyOrderId: to.id,
          status: to.order.status,
          priority: to.order.priority,
          createdAt: to.order.createdAt,
          receivedAt: to.order.receivedAt,
          procedureCode: to.order.prescription.procedureCode?.code ?? null,
          procedureName: to.order.prescription.instructions ?? to.therapyType,
          patient: patient ? { ...patient, age } : null,
          encounterId: to.order.prescription.encounter?.id ?? null,
          // 치료 특화
          therapyType: to.therapyType,
          scheduledTime: to.scheduledTime,
          duration: to.duration,
          sessionNo: to.sessionNo,
          totalSessions: to.totalSessions,
          therapist: to.therapist,
        };
      });
  }

  // ── 검체 접수 (ORDERED → RECEIVED) ──
  async receiveOrder(orderId: string, userId?: string) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException('오더를 찾을 수 없습니다');
    assertOrderTransition(order.status, 'RECEIVED');

    /**
     * 🔴 (2026-09-16 H4) 오더 접수와 검체 채취시각은 **한 트랜잭션**이다.
     *    종전엔 `order.update(RECEIVED)` 를 먼저 커밋하고 `labResult.collectedAt` 을 따로 적었다 —
     *    뒤가 실패하면 오더만 RECEIVED 로 남는데 위 `assertOrderTransition` 이 재접수를 막아
     *    **채취시각이 영구히 비어 있게 된다**(G3 가 영상·검사에서 고친 것과 같은 모양).
     */
    const now = new Date();
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.order.update({
        where: { id: orderId },
        data: { status: 'RECEIVED', receivedAt: now, receivedById: userId ?? null },
      });
      // 🔴 (2026-10-01) 접수는 채취가 아니다 — 종전엔 여기서 `labResult.collectedAt = 접수 순간`을 찍어 채취→접수 운반 시간이
      //    언제나 0 이었다. 결과 행이 이미 있으면 **기록된 채취 시각**을 옮겨 적을 뿐이다(없으면 null — 접수 시각으로 채우지 않는다).
      if (order.specimenCollectedAt) {
        const labResult = await tx.labResult.findUnique({ where: { orderId }, select: { id: true } });
        if (labResult) await tx.labResult.update({ where: { orderId }, data: { collectedAt: order.specimenCollectedAt } });
      }
      return updated;
    });
  }

  // ── 검체 채취 기록(2026-10-01) — 접수와 다른 사건 ──
  /**
   * 병동·채혈실에서 검체를 채취한 순간을 남긴다(정본 규칙 `specimen-collection.ts`).
   * 결과 행이 이미 있으면(과거 경로로 접수 순간이 채취로 찍힌 행 포함) 그 값을 **기록된 채취 시각으로** 바로잡는다 —
   * 접수 시각은 채취 시각이 아니었다.
   */
  async recordSpecimenCollection(orderId: string, userId: string, input: { collectedAt?: string | null; note?: string | null }) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { id: true, department: true, status: true, createdAt: true, receivedAt: true, specimenCollectedAt: true },
    });
    if (!order) throw new NotFoundException('오더를 찾을 수 없습니다');
    const now = new Date();
    const { at, source } = resolveCollectionTime(order, input, now);
    return this.prisma.$transaction(async (tx) => {
      // 동시 기록 경합 — 조건부 갱신으로 한 번만(먼저 기록한 사람이 이긴다)
      const done = await tx.order.updateMany({
        where: { id: orderId, specimenCollectedAt: null },
        data: {
          specimenCollectedAt: at, specimenCollectedById: userId, specimenCollectionRecordedAt: now,
          specimenCollectionSource: source, specimenCollectionNote: input.note?.trim() || null,
        },
      });
      if (done.count === 0) throw new ConflictException({ code: 'SPECIMEN_ALREADY_RECORDED', message: '이미 채취가 기록된 오더입니다' });
      const lr = await tx.labResult.findUnique({ where: { orderId }, select: { id: true } });
      if (lr) await tx.labResult.update({ where: { orderId }, data: { collectedAt: at } });
      return tx.order.findUnique({
        where: { id: orderId },
        select: {
          id: true, status: true, specimenCollectedAt: true, specimenCollectionRecordedAt: true, specimenCollectionSource: true,
          specimenCollector: { select: { id: true, familyName: true, givenName: true } },
        },
      });
    });
  }

  /**
   * 병동 채혈 대기 — 재원 환자의 검사 오더 중 **아직 채취도 접수도 안 된 것**(ORDERED · 채취 기록 없음).
   * 종전엔 병동 간호사가 볼 검사 오더 목록이 없었다(검사실 큐뿐) — 채취를 남길 자리가 없었다.
   */
  static readonly PENDING_COLLECTION_LIMIT = 200;
  async getPendingSpecimenCollections(opts: { wardId?: string }) {
    const L = WorkstationService.PENDING_COLLECTION_LIMIT;
    const orders = await this.prisma.order.findMany({
      where: {
        department: 'LAB',
        status: 'ORDERED',
        specimenCollectedAt: null,
        prescription: {
          status: 'ACTIVE',
          encounter: {
            patient: {
              admissions: { some: { status: 'ADMITTED', ...(opts.wardId ? { bed: { wardId: opts.wardId } } : {}) } },
            },
          },
        },
      },
      orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
      take: L + 1,
      select: {
        id: true, priority: true, createdAt: true,
        prescription: {
          select: {
            instructions: true,
            procedureCode: { select: { code: true, nameKo: true } },
            encounter: {
              select: {
                patient: {
                  select: {
                    id: true, mrn: true, familyName: true, givenName: true,
                    admissions: {
                      where: { status: 'ADMITTED' }, take: 1, orderBy: { admitDate: 'desc' },
                      select: { bed: { select: { roomNumber: true, bedNumber: true, ward: { select: { id: true, name: true } } } } },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });
    const now = Date.now();
    return {
      items: orders.slice(0, L).map((o) => {
        const p = o.prescription.encounter?.patient;
        const bed = p?.admissions[0]?.bed;
        return {
          orderId: o.id,
          priority: o.priority,
          orderedAt: o.createdAt,
          waitingMin: (now - o.createdAt.getTime()) / 60_000,
          testName: o.prescription.procedureCode?.nameKo ?? o.prescription.instructions ?? null,
          testCode: o.prescription.procedureCode?.code ?? null,
          patient: p ? { id: p.id, mrn: p.mrn, familyName: p.familyName, givenName: p.givenName } : null,
          ward: bed?.ward ?? null,
          room: bed ? `${bed.roomNumber}-${bed.bedNumber}` : null,
        };
      }),
      truncated: orders.length > L,
    };
  }

  // ── 검사 시작 (RECEIVED → IN_PROGRESS) ──
  async startOrder(orderId: string, userId?: string) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException('오더를 찾을 수 없습니다');
    assertOrderTransition(order.status, 'IN_PROGRESS');

    return this.prisma.order.update({
      where: { id: orderId },
      data: { status: 'IN_PROGRESS', startedAt: new Date(), startedById: userId ?? null },
    });
  }

  // ── 오더 완료 (RECEIVED/IN_PROGRESS → COMPLETED) ── 범용 워크스테이션 완료(치료 외 접수·수술준비·수혈·퇴원 등)
  async completeOrder(orderId: string, userId?: string) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException('오더를 찾을 수 없습니다');
    if (order.status === 'COMPLETED') return order; // 멱등(재완료 무해)
    assertOrderTransition(order.status, 'COMPLETED');

    return this.prisma.order.update({
      where: { id: orderId },
      data: { status: 'COMPLETED', completedAt: new Date(), completedById: userId ?? null },
    });
  }

  // ── 검사실 결과 입력 + 완료 ──
  async completeLabResult(
    orderId: string,
    body: CompleteLabResultDto,
    userId: string,
  ) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { prescription: { include: { encounter: true } } },
    });
    if (!order) throw new NotFoundException('오더를 찾을 수 없습니다');
    if (!order.prescription.encounter) throw new BadRequestException('Encounter가 없습니다');
    // 프로토콜 가드: 접수 전(ORDERED)·취소 오더는 결과입력 금지.
    // RECEIVED에서 입력 시 검사 시작을 암묵 스탬프, COMPLETED는 결과 정정 재입력으로 허용.
    if (order.status === 'ORDERED')
      throw new BadRequestException('접수(RECEIVED) 후 결과를 입력할 수 있습니다');
    if (order.status === 'CANCELLED')
      throw new BadRequestException('취소된 오더에는 결과를 입력할 수 없습니다');

    const techId = userId;
    const patientId = order.prescription.encounter.patientId;

    /**
     * 🔴 (2026-09-16 F3) 결과 헤더·항목·오더 완료는 **한 트랜잭션**이다.
     *    종전엔 정정 재입력에서 `deleteMany`(기존 항목 삭제)를 먼저 커밋하고 `createMany` 를 따로 불렀다 —
     *    재생성이 실패하면 **원래 있던 검사 결과 항목이 통째로 사라진 채** 헤더만 COMPLETED 로 남는다
     *    (화면은 '결과 완료'인데 항목이 0건 = 임상 기록 소실).
     *    오더 완료까지 같이 묶어 "결과는 있는데 오더는 미완료"도 함께 막는다.
     */
    const labResult = await this.prisma.$transaction(async (tx) => {
    // LabResult upsert
    let labResult = await tx.labResult.findUnique({ where: { orderId } });

    if (labResult) {
      const collected = await tx.order.findUnique({ where: { id: orderId }, select: { specimenCollectedAt: true } });
      await tx.labResult.update({
        where: { orderId },
        // 채취 시각은 오더의 채취 기록을 따른다(되돌림 등으로 비었으면 다시 옮겨 적는다 · 기록 없으면 그대로)
        data: { status: 'COMPLETED', notes: body.notes, completedAt: new Date(), ...(collected?.specimenCollectedAt ? { collectedAt: collected.specimenCollectedAt } : {}) },
      });
      // 기존 items 삭제 후 재생성
      await tx.labResultItem.deleteMany({ where: { labResultId: labResult.id } });
    } else {
      // 채취 시각은 오더에 기록된 채취(병동·채혈실) — 없으면 null(결과 입력 순간을 채취로 쓰지 않는다)
      const collected = await tx.order.findUnique({ where: { id: orderId }, select: { specimenCollectedAt: true } });
      labResult = await tx.labResult.create({
        data: {
          orderId,
          patientId,
          technicianId: techId,
          status: 'COMPLETED',
          notes: body.notes,
          completedAt: new Date(),
          collectedAt: collected?.specimenCollectedAt ?? null,
        },
      });
    }

    // LabResultItem 일괄 생성 (N+1 → 1 쿼리)
    await tx.labResultItem.createMany({
      data: body.items.map((item) => {
        let normalMin: number | null = null;
        let normalMax: number | null = null;
        if (item.refRange) {
          const match = item.refRange.match(/(\d+\.?\d*)\s*[-~]\s*(\d+\.?\d*)/);
          if (match) { normalMin = parseFloat(match[1]); normalMax = parseFloat(match[2]); }
        }
        /**
         * 🔴 2026-08-21 검사 흐름 검토 — 종전은 위급을 별표 붙은 H(정본에 없는 어휘)로, 이상을 무조건
         *    'H' 로 저장했다. 둘 다 틀렸다:
         *   ① **그 별표 어휘는 정본에 없다**(`CRITICAL_LAB_FLAGS` = HH·LL·AA·C·CC·CRITICAL·PANIC).
         *      `isCriticalFlag` 가 false 를 내므로, 검사자가 '위급'을 골라도 **flag 를 읽는 모든 소비처**
         *      (위급값 배너·FHIR interpretation·결과 화면)가 그것을 위급으로 보지 않는다.
         *      v3.96 "flag 를 H/L 만 처리하면 위급값이 정상처럼 샌다"의 재발이다.
         *   ② **방향을 보지 않았다** — 참고범위 **아래**인 값도 무조건 `'H'`(높음)로 저장됐다.
         *      `normalMin`/`normalMax` 를 바로 위에서 파싱해 두고도 쓰지 않았다.
         * 실측: 해당 어휘 0건 · 방향 오기 0건 — **아직 이 경로로 위급/이상 입력이 없었다.**
         *      구조적 결함이며 **첫 위급값 입력에서 터진다.**
         *
         * 🔴 검사자 판단(`finding`)은 존중한다 — 다만 **어휘와 방향은 정본이 정한다.**
         *    범위를 모르면 방향도 모른다 → 위급은 `CRITICAL`(정본 어휘), 이상은 `A`(방향 미상)로 둔다.
         *    모르는 방향을 'H' 라고 지어내지 않는다.
         */
        const numeric = Number(item.value);
        const known = !Number.isNaN(numeric) && String(item.value).trim() !== '';
        const belowLow = known && normalMin != null && numeric < normalMin;
        const aboveHigh = known && normalMax != null && numeric > normalMax;
        const direction: 'LOW' | 'HIGH' | null = belowLow ? 'LOW' : aboveHigh ? 'HIGH' : null;
        const flag = item.finding === 'CRITICAL'
          ? (direction === 'LOW' ? 'LL' : direction === 'HIGH' ? 'HH' : 'CRITICAL')
          : item.finding === 'ABNORMAL'
            ? (direction === 'LOW' ? 'L' : direction === 'HIGH' ? 'H' : 'A')
            : null;
        return {
          labResultId: labResult.id,
          testName: item.name,
          value: item.value,
          unit: item.unit ?? '',
          normalMin,
          normalMax,
          flag,
        };
      }),
    });

    // Order 완료 (+완료자 기록·RECEIVED에서 바로 완료 시 시작 시각/시행자 암묵 스탬프)
    await tx.order.update({
      where: { id: orderId },
      data: {
        status: 'COMPLETED',
        completedAt: new Date(),
        completedById: userId,
        result: body.items as unknown as Prisma.InputJsonValue,
        ...(order.status === 'RECEIVED' ? { startedAt: new Date(), startedById: userId } : {}),
      },
    });
    return labResult;
    });

    /**
     * 🔴 **참고범위를 벗어났는데 검사자가 '정상'으로 둔 항목**을 드러낸다.
     *    자동으로 이상 처리하지 않는다 — 검사자 판단을 덮으면 원장이 거짓이 된다(임상 판단은 사람의 것).
     *    그러나 **아무도 모르게 두지도 않는다.** 응답에 담아 화면이 되묻게 한다.
     *    (이 저장소 규약: 숨기는 방향으로는 자동이 없다 · 모르면 안전측으로 접는다)
     */
    const outOfRangeButNormal = body.items
      .filter((i) => i.finding !== 'ABNORMAL' && i.finding !== 'CRITICAL')
      .map((i) => {
        const m = i.refRange?.match(/(\d+\.?\d*)\s*[-~]\s*(\d+\.?\d*)/);
        if (!m) return null;
        const v = Number(i.value);
        if (Number.isNaN(v) || String(i.value).trim() === '') return null;
        const lo = parseFloat(m[1]); const hi = parseFloat(m[2]);
        if (v >= lo && v <= hi) return null;
        return { name: i.name, value: i.value, refRange: i.refRange!, direction: v < lo ? 'LOW' : 'HIGH' };
      })
      .filter(Boolean) as { name: string; value: string; refRange: string; direction: string }[];

    // ── 검사 완료 이벤트 (lab.service 경로와 정합) ──
    // 이 워크스테이션 경로가 lab.service.completeResult와 달리 이벤트를 발행하지 않아
    //  ① progressive billing(lab.result.completed 리스너) ② 위급값 통보(IPSG.2) 가 누락되던 결함 수정.
    const criticalValues = body.items
      .filter((i) => i.finding === 'CRITICAL')
      .map((i) => ({ testName: i.name, value: i.value, unit: i.unit ?? '', reason: '위급값 (검사자 지정)' }));
    const hasCritical = criticalValues.length > 0;

    this.eventEmitter?.emit('lab.result.completed', {
      labResultId: labResult.id,
      orderId,
      prescriptionId: order.prescription.id, // progressive billing 발생 트리거
      patientId,
      encounterId: order.prescription.encounterId,
      hasAbnormal: body.items.some((i) => i.finding === 'ABNORMAL' || i.finding === 'CRITICAL'),
      hasCritical,
      criticalValues,
    });

    // 위급값 발견 시 즉시 통보 이벤트 (CriticalValueAlert 기록 + 담당의/주치의 CRITICAL 푸시 + read-back 추적)
    if (hasCritical) {
      this.eventEmitter?.emit('lab.critical.value', {
        labResultId: labResult.id,
        orderId,
        patientId,
        encounterId: order.prescription.encounterId,
        criticalValues,
        severity: 'URGENT',
        message: `위급값 통보: ${criticalValues.map((c) => `${c.testName} ${c.value}${c.unit} (${c.reason})`).join(', ')}`,
      });
    }

    return {
      completed: true, orderId, hasCritical,
      /**
       * 🔴 참고범위를 벗어났는데 '정상'으로 기록된 항목 — 자동으로 고치지 않고 **되묻게** 한다.
       *    비어 있으면 그런 항목이 없다는 뜻이다(분모 = 이번에 입력한 항목 전체).
       */
      outOfRangeButNormal,
      itemsEntered: body.items.length,
    };
  }

  // ── 영상실 촬영 완료 (→ ACQUIRED) ──
  async acquireImaging(
    orderId: string,
    body: {
      dicomStudyUid?: string; quality?: string; notes?: string;
      modality?: string; bodyPart?: string;
      overrideSafety?: boolean; overrideReason?: string;
      dlp?: number; ctdiVol?: number; doseAreaProduct?: number; effectiveDoseMsv?: number;
    },
    userId?: string,
  ) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { prescription: { include: { encounter: true } } },
    });
    if (!order) throw new NotFoundException('오더를 찾을 수 없습니다');
    if (order.status === 'CANCELLED' || order.status === 'COMPLETED')
      throw new BadRequestException(`${order.status} 상태의 오더는 촬영할 수 없습니다`);

    // 시행 전 안전게이트 — imaging.acquire와 동일 choke point 공유(우회 경로 차단)
    const safety = this.imagingSafety
      ? await this.imagingSafety.assertAcquireGate(orderId, {
          modality: body.modality, bodyPart: body.bodyPart,
          override: body.overrideSafety, overrideReason: body.overrideReason, userId,
        })
      : null;

    const existing = await this.prisma.imagingResult.findUnique({ where: { orderId } });
    // modality 우선순위: 명시 입력 > 기존 저장값 > 게이트 판정(미상 'OT' 제외) — 재촬영 시 올바른 저장값을 'OT'로 덮지 않음
    const detected = safety && safety.modality !== 'OT' ? safety.modality : null;
    const modality = body.modality?.trim().toUpperCase() || existing?.modality || detected || 'CR';
    const safetyJson = safety as unknown as import('@prisma/client').Prisma.InputJsonValue | null;

    /**
     * 🔴 (2026-09-16 H4) 영상결과 기록과 오더 전이는 **한 트랜잭션**이다 — G3 가 `imaging.service` 에서
     *    고친 것과 같은 자리인데 **워크스테이션 쌍둥이 경로는 그대로였다**(한 곳만 고치면 갈라진다).
     *    종전엔 영상결과를 먼저 커밋하고 오더 전이를 따로 했다: 뒤가 실패하면 판독 대기열에는
     *    ACQUIRED 로 떠 있는데 오더는 시작조차 안 된 상태로 갈라진다.
     *    피폭선량 기록은 다른 서비스 호출이라 트랜잭션 **밖**에 둔다(외부·장시간 호출을 넣지 않는다).
     */
    const acquiredAt = new Date();
    const imagingResultId = await this.prisma.$transaction(async (tx) => {
      let id: string;
      if (existing) {
        await tx.imagingResult.update({
          where: { orderId },
          data: {
            status: 'ACQUIRED',
            modality,
            ...(body.bodyPart ? { bodyPart: body.bodyPart } : {}),
            ...(safetyJson ? { safetyChecks: safetyJson } : {}),
          },
        });
        id = existing.id;
      } else {
        const created = await tx.imagingResult.create({
          data: {
            orderId,
            patientId: order.prescription.encounter!.patientId,
            modality,
            bodyPart: body.bodyPart ?? null,
            status: 'ACQUIRED',
            ...(safetyJson ? { safetyChecks: safetyJson } : {}),
          },
        });
        id = created.id;
      }
      // 촬영자 기록. 접수 단계를 건너뛴 촬영(ORDERED)은 접수를 암묵 스탬프해 타임라인 공백 방지
      await tx.order.update({
        where: { id: orderId },
        data: {
          status: 'IN_PROGRESS',
          startedAt: acquiredAt,
          startedById: userId ?? null,
          ...(order.status === 'ORDERED'
            ? { receivedAt: acquiredAt, receivedById: userId ?? null }
            : {}),
        },
      });
      return id;
    });

    /**
     * 피폭선량 기록.
     *
     * 🔴 2026-08-27 — 종전 조건은 `safety?.ionizing` 이었다. 그 값은 **게이트가 판정한 modality**
     *    에서 나오는데, 시술코드가 없으면 `OT`(미상) → `ionizing=false` 가 된다(운영 실측:
     *    영상결과 209건 중 시술코드가 달린 건 46건뿐, **CT 36건·MG 16건은 전건 0**).
     *    그러면 방사선사가 콘솔 판독값을 **입력했는데도 조용히 버려진다** — 성공 응답 + 데이터 소실.
     *    (같은 유형: 입원 플로우시트가 받은 값 4개를 조용히 버리던 결함.)
     *
     *    그래서 판정 근거를 **실제로 저장되는 modality** 로 바꾼다. 이건 추정이 아니라 바로 위에서
     *    `imagingResult` 에 적은 사실이고, 어휘 정본(`isIonizingModality`)은 게이트·품질지표와 같다.
     *
     * 🔴 그래도 기록하지 못하면 **말한다.** 입력한 값이 어디로 갔는지 화면이 알 수 있어야 한다.
     */
    const doseProvided = body.dlp != null || body.ctdiVol != null
      || body.doseAreaProduct != null || body.effectiveDoseMsv != null;
    let doseRecorded = false;
    let doseSkippedReason: 'NON_IONIZING' | 'NO_USER' | 'SERVICE_UNAVAILABLE' | null = null;
    if (doseProvided) {
      if (!this.imagingSafety) doseSkippedReason = 'SERVICE_UNAVAILABLE';
      else if (!userId) doseSkippedReason = 'NO_USER';
      else if (!isIonizingModality(modality)) doseSkippedReason = 'NON_IONIZING';
      else {
        await this.imagingSafety.recordExposure({
          imagingResultId,
          patientId: order.prescription.encounter!.patientId,
          modality,
          bodyPart: body.bodyPart ?? null,
          dlp: body.dlp, ctdiVol: body.ctdiVol,
          doseAreaProduct: body.doseAreaProduct, effectiveDoseMsv: body.effectiveDoseMsv,
          enteredBy: userId,
        });
        doseRecorded = true;
      }
    }

    return {
      acquired: true,
      orderId,
      // WARN 모드/override 시 FE 표시용 — PASS 제외 안전경고 동봉
      safetyWarnings: safety ? safety.checks.filter((c) => c.level !== 'PASS') : undefined,
      // 선량을 입력한 경우에만 결과를 말한다(입력하지 않았으면 할 말이 없다)
      ...(doseProvided ? { doseRecorded, doseSkippedReason } : {}),
    };
  }

  // ── 영상 판독 입력 + 완료 (→ REPORTED) ──
  async reportImaging(
    orderId: string,
    body: { finding: string; conclusion: string; recommendation?: string },
    userId: string,
  ) {
    const imgResult = await this.prisma.imagingResult.findUnique({ where: { orderId } });
    if (!imgResult) throw new NotFoundException('영상 결과를 찾을 수 없습니다');

    /**
     * 🔴 (2026-09-16 H4) 판독 기록과 오더 완료는 **한 트랜잭션**이다(G3 `imaging.service` 와 같은 자리의 쌍둥이).
     *    종전엔 판독을 먼저 커밋하고 오더 완료를 따로 했다 — 뒤가 실패하면 결과는 REPORTED 라
     *    판독 대기열(ACQUIRED)에서 사라지는데 오더는 미완료로 남고, 아래 청구 트리거 이벤트도 나가지 않는다.
     */
    const reportedAt = new Date();
    const { updated, order } = await this.prisma.$transaction(async (tx) => {
      const u = await tx.imagingResult.update({
        where: { orderId },
        data: {
          status: 'REPORTED',
          finding: body.finding,
          impression: body.conclusion,
          reportedAt,
          radiologistId: userId,
        },
      });
      const o = await tx.order.update({
        where: { id: orderId },
        data: { status: 'COMPLETED', completedAt: reportedAt, completedById: userId },
        include: { prescription: { select: { id: true, encounterId: true, encounter: { select: { patientId: true } } } } },
      });
      return { updated: u, order: o };
    });

    // 영상 판독 완료 이벤트 (imaging.service 경로와 정합) — progressive billing 트리거 누락 수정
    this.eventEmitter?.emit('imaging.result.reported', {
      imagingResultId: updated.id,
      orderId,
      prescriptionId: order.prescription?.id,
      patientId: order.prescription?.encounter?.patientId,
      encounterId: order.prescription?.encounterId,
    });

    return { reported: true, orderId };
  }

  // ── 판독 대기열 ──
  async getReadingQueue() {
    return this.prisma.imagingResult.findMany({
      where: { status: 'ACQUIRED' },
      include: {
        order: {
          include: {
            prescription: {
              include: {
                encounter: {
                  include: {
                    patient: {
                      select: { id: true, mrn: true, familyName: true, givenName: true, gender: true, dateOfBirth: true },
                    },
                  },
                },
                procedureCode: { select: { code: true, nameKo: true } },
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
      take: 50,
    });
  }

  // ── 검사 항목 템플릿 ──
  async getTemplates(stationId?: string) {
    const where: Record<string, unknown> = { isActive: true };
    if (stationId) where.stationId = stationId;
    return this.prisma.labTestTemplate.findMany({ where, orderBy: { testName: 'asc' } });
  }

  async getLabTemplate(procedureCode: string) {
    return this.prisma.labTestTemplate.findUnique({
      where: { procedureCode },
    });
  }

  async createTemplate(body: {
    procedureCode: string;
    testName: string;
    stationId: string;
    items: Record<string, unknown>[];
  }) {
    return this.prisma.labTestTemplate.create({
      data: {
        procedureCode: body.procedureCode,
        testName: body.testName,
        stationId: body.stationId,
        items: body.items as unknown as Prisma.InputJsonValue,
      },
    });
  }

  async updateTemplate(code: string, body: { testName?: string; stationId?: string; items?: Record<string, unknown>[] }) {
    const data: Record<string, unknown> = {};
    if (body.testName !== undefined) data.testName = body.testName;
    if (body.stationId !== undefined) data.stationId = body.stationId;
    if (body.items !== undefined) data.items = body.items;
    return this.prisma.labTestTemplate.update({ where: { procedureCode: code }, data });
  }

  async deleteTemplate(code: string) {
    return this.prisma.labTestTemplate.update({ where: { procedureCode: code }, data: { isActive: false } });
  }

  // ── 델타 체크 (이전 결과 비교) ──
  async getDeltaCheck(orderId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        prescription: {
          include: {
            encounter: true,
            procedureCode: true,
          },
        },
      },
    });
    if (!order) return null;

    const patientId = order.prescription.encounter?.patientId;
    const procCode = order.prescription.procedureCode?.code;
    if (!patientId || !procCode) return null;

    // 같은 환자, 같은 검사의 최근 완료 결과
    const prevResult = await this.prisma.labResult.findFirst({
      where: {
        patientId,
        status: 'COMPLETED',
        order: {
          id: { not: orderId },
          prescription: { procedureCode: { code: procCode } },
        },
      },
      orderBy: { completedAt: 'desc' },
      select: { id: true, completedAt: true, items: true },
    });

    return prevResult;
  }

  // ══════════════════════════════════════════════
  // 치료 오더 일정 관리
  // ══════════════════════════════════════════════

  async getTherapySchedule(query: { stationId?: string; date?: string; therapistId?: string }) {
    const where: Record<string, unknown> = {};
    if (query.stationId) where.stationId = query.stationId;
    if (query.date) where.scheduledDate = new Date(query.date);
    if (query.therapistId) where.therapistId = query.therapistId;

    return this.prisma.therapyOrder.findMany({
      where,
      include: {
        order: {
          include: {
            prescription: {
              include: {
                encounter: {
                  include: {
                    patient: {
                      select: { id: true, mrn: true, familyName: true, givenName: true, gender: true, dateOfBirth: true },
                    },
                    doctor: { select: { familyName: true, givenName: true } },
                  },
                },
              },
            },
          },
        },
        therapist: { select: { id: true, familyName: true, givenName: true } },
      },
      orderBy: [{ scheduledTime: 'asc' }, { createdAt: 'asc' }],
    });
  }

  async createTherapyOrder(body: {
    encounterId: string;
    therapyType: string;
    stationId: string;
    scheduledDate: string;
    scheduledTime?: string;
    duration?: number;
    therapistId?: string;
    isRecurring?: boolean;
    recurPattern?: string;
    recurEndDate?: string;
    totalSessions?: number;
    instructions?: string;
  }, userId: string) {
    /**
     * 🔴 (2026-09-16 F3) 처방·오더·치료오더 **세 쌍은 한 트랜잭션**이다(회차마다).
     *    종전엔 셋을 따로 커밋해서, 치료오더 생성이 실패하면 처방과 오더만 남았다 —
     *    치료 목록·치료실 일정 어디에도 없는데 **오더는 살아 있어 청구·완료 경로만 열린** 유령 오더가 된다.
     *    오더 생성 이벤트는 커밋 뒤에 발행한다.
     */
    /**
     * 🔴 (2026-09-16 J4) 같은 진료·같은 치료·같은 치료실의 **같은 시각 슬롯**에 살아 있는 치료오더가 이미
     *    있으면 다시 만들지 않는다. F3 이 세 쌍을 트랜잭션으로 묶었지만, 버튼을 두 번 누르면 **한 벌이 통째로
     *    더** 생긴다 — 처방·오더가 두 벌이면 청구도 두 벌이다. 한 슬롯에 같은 치료가 두 번 잡히는 일은 없으므로
     *    시각이 지정된 경우에만 자연키로 본다(시각 미지정은 하루에 여러 회차가 정당해 막지 않는다).
     */
    if (body.scheduledTime) {
      const dup = await this.prisma.therapyOrder.findFirst({
        where: {
          therapyType: body.therapyType,
          stationId: body.stationId,
          scheduledDate: new Date(body.scheduledDate),
          scheduledTime: body.scheduledTime,
          order: { status: { notIn: ['CANCELLED', 'COMPLETED'] }, prescription: { encounterId: body.encounterId } },
        },
        include: { order: true },
      });
      if (dup) return { order: dup.order, therapyOrder: dup, duplicate: true as const };
    }
    const { order, therapyOrder } = await this.prisma.$transaction(async (tx) => {
      // 1. Prescription 생성
      const prescription = await tx.prescription.create({
        data: {
          encounterId: body.encounterId,
          type: 'THERAPY',
          status: 'ACTIVE',
          instructions: body.instructions ?? `${body.therapyType} 치료`,
          createdBy: userId,
          prescriberId: userId, // 치료 오더 작성 의료진이 책임 처방의
        },
      });

      // 2. Order 생성 — buildOrderData 단일 정본
      const order = await tx.order.create({
        data: buildOrderData({ prescriptionId: prescription.id, type: 'THERAPY' }),
      });

      // 3. TherapyOrder 생성
      const therapyOrder = await tx.therapyOrder.create({
        data: {
          orderId: order.id,
          therapyType: body.therapyType,
          scheduledDate: new Date(body.scheduledDate),
          scheduledTime: body.scheduledTime,
          duration: body.duration,
          therapistId: body.therapistId,
          stationId: body.stationId,
          isRecurring: body.isRecurring ?? false,
          recurPattern: body.recurPattern,
          recurEndDate: body.recurEndDate ? new Date(body.recurEndDate) : null,
          totalSessions: body.totalSessions,
          sessionNo: 1,
        },
      });
      return { order, therapyOrder };
    });
    if (this.eventEmitter) emitOrderCreated(this.eventEmitter, { orderId: order.id, type: 'THERAPY', encounterId: body.encounterId });

    // 4. 반복 일정 생성
    if (body.isRecurring && body.recurPattern && body.totalSessions && body.totalSessions > 1) {
      const dates = this.generateRecurDates(
        new Date(body.scheduledDate),
        body.recurPattern,
        body.totalSessions - 1,
        body.recurEndDate ? new Date(body.recurEndDate) : undefined,
      );

      for (let i = 0; i < dates.length; i++) {
        const ordN = await this.prisma.$transaction(async (tx) => {
          const rxN = await tx.prescription.create({
            data: { encounterId: body.encounterId, type: 'THERAPY', status: 'ACTIVE', instructions: body.instructions ?? `${body.therapyType} 치료`, createdBy: userId, prescriberId: userId },
          });
          const created = await tx.order.create({
            data: buildOrderData({ prescriptionId: rxN.id, type: 'THERAPY' }),
          });
          await tx.therapyOrder.create({
            data: {
              orderId: created.id,
              therapyType: body.therapyType,
              scheduledDate: dates[i],
              scheduledTime: body.scheduledTime,
              duration: body.duration,
              therapistId: body.therapistId,
              stationId: body.stationId,
              isRecurring: true,
              recurPattern: body.recurPattern,
              totalSessions: body.totalSessions,
              sessionNo: i + 2,
            },
          });
          return created;
        });
        if (this.eventEmitter) emitOrderCreated(this.eventEmitter, { orderId: ordN.id, type: 'THERAPY', encounterId: body.encounterId });
      }
    }

    return therapyOrder;
  }

  private generateRecurDates(startDate: Date, pattern: string, count: number, endDate?: Date): Date[] {
    const dates: Date[] = [];
    const d = new Date(startDate);
    const dayMap: Record<string, number[]> = {
      'MWF': [1, 3, 5],
      'TTS': [2, 4, 6],
      'DAILY': [0, 1, 2, 3, 4, 5, 6],
      'WEEKDAY': [1, 2, 3, 4, 5],
      'WEEKLY': [d.getDay()],
    };
    const allowedDays = dayMap[pattern] ?? dayMap['WEEKDAY'];

    while (dates.length < count) {
      d.setDate(d.getDate() + 1);
      if (endDate && d > endDate) break;
      if (allowedDays.includes(d.getDay())) {
        dates.push(new Date(d));
      }
    }
    return dates;
  }

  async completeTherapySession(therapyOrderId: string, resultData: Record<string, unknown>, userId?: string) {
    // 정본 `therapy-order/therapy-completion.ts` — 🔴 종전엔 오더 상태를 보지 않아 취소된 오더도 완료되고 매번 청구 이벤트가 나갔다
    return completeTherapyOrder(this.prisma, this.eventEmitter, therapyOrderId, resultData, userId);
  }

  // ══════════════════════════════════════════════
  // 스마트 환자 검색 (워크스테이션용)
  // ══════════════════════════════════════════════

  async getSmartPatients(search?: string) {
    const today = todayDateOnly(); // 🔴 @db.Date 비교 — 로컬 자정(setHours)은 하루 밀린다(정본)
    const tomorrow = new Date(today.getTime() + 86400000);

    const patientSelect = {
      id: true, mrn: true, familyName: true, givenName: true,
      gender: true, dateOfBirth: true, phone: true,
    };

    // 1. 오늘 접수 완료 (Encounter DRAFT, 오늘 생성)
    const checkedIn = await this.prisma.encounter.findMany({
      where: {
        status: 'DRAFT',
        createdAt: { gte: today, lt: tomorrow },
        ...(search && {
          patient: {
            OR: [
              { familyName: { contains: search } },
              { givenName: { contains: search } },
              { mrn: { contains: search } },
            ],
          },
        }),
      },
      include: { patient: { select: patientSelect } },
      orderBy: { createdAt: 'desc' },
      take: 10,
      distinct: ['patientId'],
    });

    // 2. 검진 접수 수검자 (오늘, CHECKED_IN/IN_PROGRESS)
    const checkupVisits = await this.prisma.checkupVisit.findMany({
      where: {
        scheduledDate: { gte: today, lt: tomorrow },
        status: { in: ['CHECKED_IN', 'IN_PROGRESS'] },
        ...(search && {
          patient: {
            OR: [
              { familyName: { contains: search } },
              { givenName: { contains: search } },
              { mrn: { contains: search } },
            ],
          },
        }),
      },
      include: {
        patient: { select: patientSelect },
        program: { select: { code: true, name: true, items: true } },
        _count: { select: { items: true } },
      },
      orderBy: { checkedInAt: 'asc' },
      take: 10,
    });

    // 3. 입원 환자
    const admitted = await this.prisma.admission.findMany({
      where: {
        status: 'ADMITTED',
        ...(search && {
          patient: {
            OR: [
              { familyName: { contains: search } },
              { givenName: { contains: search } },
              { mrn: { contains: search } },
            ],
          },
        }),
      },
      include: {
        patient: { select: patientSelect },
        bed: { include: { ward: { select: { name: true } } } },
      },
      take: 5,
    });

    // 4. 검색 결과 (위에 없는 환자)
    let searchResults: { id: string; mrn: string; familyName: string; givenName: string; gender: string | null; dateOfBirth: Date | null; phone: string | null }[] = [];
    if (search && search.length >= 1) {
      const existingIds = new Set([
        ...checkedIn.map((e) => e.patient.id),
        ...checkupVisits.map((v) => v.patient.id),
        ...admitted.map((a) => a.patient.id),
      ]);

      const results = await this.prisma.patient.findMany({
        where: {
          OR: [
            { familyName: { contains: search } },
            { givenName: { contains: search } },
            { mrn: { contains: search } },
            { phone: { contains: search } },
          ],
        },
        select: patientSelect,
        take: 10,
      });
      searchResults = results.filter((p) => !existingIds.has(p.id));
    }

    const age = (dob: Date | null) => dob ? ageOf(dob) : null;

    return {
      checkedInPatients: checkedIn.map((e) => ({
        ...e.patient,
        age: age(e.patient.dateOfBirth),
        badge: '접수완료',
        badgeColor: 'blue',
        checkedInAt: e.createdAt,
      })),
      checkupPatients: checkupVisits.map((v) => ({
        ...v.patient,
        age: age(v.patient.dateOfBirth),
        badge: '검진접수',
        badgeColor: 'green',
        programName: v.program.name,
        programCode: v.program.code,
        visitStatus: v.status,
        totalItems: Array.isArray(v.program.items) ? (v.program.items as unknown[]).length : 0,
        completedItems: v._count.items,
        visitId: v.id,
      })),
      admittedPatients: admitted.map((a) => ({
        ...a.patient,
        age: age(a.patient.dateOfBirth),
        badge: '입원',
        badgeColor: 'purple',
        wardName: a.bed?.ward?.name ?? '',
      })),
      searchResults: searchResults.map((p) => ({
        ...p,
        age: age(p.dateOfBirth),
      })),
    };
  }

  async getPatientPendingOrders(patientId: string, stationId?: string) {
    const today = todayDateOnly(); // 🔴 @db.Date 비교 — 로컬 자정(setHours)은 하루 밀린다(정본)
    const tomorrow = new Date(today.getTime() + 86400000);

    // 일반 오더
    const orders = await this.prisma.order.findMany({
      where: {
        status: { in: ['ORDERED', 'RECEIVED', 'IN_PROGRESS'] },
        prescription: {
          encounter: { patientId },
          status: { in: ['ACTIVE', 'DISCONTINUED'] }, // 중단 처방의 시작된 오더도 진행 중으로 보인다(2026-09-30)
        },
      },
      include: {
        prescription: { select: { instructions: true, type: true, procedureCode: { select: { nameKo: true } } } },
      },
      take: 10,
    });

    // 검진 방문
    const checkupVisit = await this.prisma.checkupVisit.findFirst({
      where: {
        patientId,
        scheduledDate: { gte: today, lt: tomorrow },
        status: { in: ['CHECKED_IN', 'IN_PROGRESS'] },
      },
      include: {
        program: { select: { name: true, items: true } },
        items: { where: { finding: 'PENDING' }, select: { testName: true } },
      },
    });

    return {
      hasExistingOrders: orders.length > 0,
      orders: orders.map((o) => ({
        orderId: o.id,
        procedureName: o.prescription.procedureCode?.nameKo ?? o.prescription.instructions ?? '',
        type: o.prescription.type,
        status: o.status,
        createdAt: o.createdAt,
      })),
      checkupVisit: checkupVisit ? {
        visitId: checkupVisit.id,
        programName: checkupVisit.program.name,
        pendingTests: checkupVisit.items.map((i) => i.testName),
      } : null,
    };
  }
}
