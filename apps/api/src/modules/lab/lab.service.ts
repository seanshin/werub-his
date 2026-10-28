import { Injectable, NotFoundException, ConflictException, BadRequestException, ForbiddenException, Logger, Optional } from '@nestjs/common';
import { isAbnormalFlag, isCriticalFlag, fromFhirInterpretation, ageOf, ageInMonths } from '@hospital-run/shared';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { LabResultStatus, Prisma } from '@prisma/client';
import { MedicalAiService } from '../medical-ai/medical-ai.service';
import { aiUnavailable } from '../medical-ai/ai-grounding';
import { ReferenceRangeService } from '../reference-range/reference-range.service';
import { JourneyService } from '../journey/journey.service';
import { recordBlockchainSignature } from '../../common/util/blockchain-signature';
import {
  CRITICAL_ALERT_ACKNOWLEDGED_STATUSES,
  CRITICAL_ALERT_OPEN_STATUSES,
  canTransitionCriticalAlert,
  type CriticalAlertStatus,
} from './critical-value-alert-states';

/** AI 출력에 한자·가나가 섞였는가 — 한국어로 요청한 임상 해석에서 이건 출력 품질 이상이다 */
export function mixedScript(v: unknown): boolean {
  const text = typeof v === 'string' ? v : JSON.stringify(v ?? '');
  return /[\u3040-\u30ff\u4e00-\u9fff]/.test(text);
}

@Injectable()
export class LabService {
  private readonly logger = new Logger(LabService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
    private readonly medicalAi: MedicalAiService,
    private readonly referenceRange: ReferenceRangeService,
    @Optional() private readonly journey?: JourneyService,
  ) {}

  /** 단위 호환성 — 둘 다 단위가 있고 다르면 불호환(단위불일치 오판정 차단). 한쪽이 무단위면 허용(정성/무단위). */
  private unitCompatible(itemUnit?: string | null, rangeUnit?: string | null): boolean {
    const iu = LabService.normalizeUnit(itemUnit ?? '');
    const ru = LabService.normalizeUnit(rangeUnit ?? '');
    if (!iu || !ru) return true;
    return iu === ru;
  }

  /**
   * 만 나이·개월 — 🔴 **정본(`ageOf`/`ageInMonths`)에 위임한다.**
   *    종전엔 같은 계산을 여기 다시 적었고, 정본이 거르는 **미래 생년월일·150세 초과**를
   *    통과시켰다. 그 값이 **검사 기준치 연령대 매칭**에 들어간다 —
   *    엉뚱한 연령 구간의 정상범위로 판정하면 위급값을 정상이라 부를 수 있다.
   */
  private ageYearsFrom(dob?: Date | null): number | null {
    return ageOf(dob ?? null);
  }

  private ageMonthsFrom(dob?: Date | null): number | null {
    return ageInMonths(dob ?? null);
  }

  /**
   * 검사 항목을 AI 입력 형식으로 — **실제 값만** 넘긴다.
   * 🔴 값이 비었거나 공백인 항목은 버린다(빈 값을 `'pending'` 같은 문자열로 메우면 그건 검사값이 아니다).
   */
  private static toAiResults(
    items: Array<{ testName: string; value: string | null; unit: string | null; normalMin: unknown; normalMax: unknown }>,
  ) {
    return items
      .filter((i) => i.value != null && String(i.value).trim() !== '')
      .map((i) => ({
        testName: i.testName,
        value: String(i.value),
        unit: i.unit ?? undefined,
        normalMin: i.normalMin != null ? Number(i.normalMin) : undefined,
        normalMax: i.normalMax != null ? Number(i.normalMax) : undefined,
      }));
  }

  /**
   * AI 검사 결과 해석.
   *
   * 🔴 원 결함(2026-08-18 적발 · P15): 검사값 자리에 문자열 **`'pending'`**, 검사명 자리에 **주호소**를
   *    넣고 해석을 받았다 — `results: [{ testName: <주호소>, value: 'pending', unit: '' }]`.
   *    해석 대상 검사가 존재하지 않는데 "검사 해석"이 나왔다. 실제 결과 항목(`LabResultItem`)은
   *    바로 옆에 있었는데 한 번도 읽지 않았다.
   * → 실제 항목(검사명·값·단위·정상범위)을 넘기고, **항목이 없으면 호출하지 않는다.**
   */
  async interpretResultAI(orderId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        labResult: { include: { items: { select: { testName: true, value: true, unit: true, normalMin: true, normalMax: true, flag: true } } } },
        prescription: { include: { encounter: { include: { patient: { select: { id: true, familyName: true, givenName: true, dateOfBirth: true, gender: true } } } } } },
      },
    });
    if (!order?.labResult) throw new NotFoundException('검사 결과를 찾을 수 없습니다');

    const patientId = order.prescription?.encounter?.patient?.id ?? order.labResult.patientId;
    const results = LabService.toAiResults(order.labResult.items);
    if (!patientId) {
      return { orderId, patientId: null, interpretation: null, ...aiUnavailable('NO_SOURCE_DATA', '검사 결과에 환자 연결이 없어 해석 맥락(나이·성별·문제목록·투약)을 구성할 수 없습니다.') };
    }
    if (!results.length) {
      // 표본 부재의 정답은 폴백이 아니라 '산출 불가' — 결과가 아직 없다는 사실을 그대로 말한다.
      return {
        orderId,
        patientId,
        interpretation: null,
        ...aiUnavailable('NO_SOURCE_DATA', `검사 결과 항목이 아직 입력되지 않았습니다(현재 상태: ${order.labResult.status}). 결과가 입력된 뒤 해석할 수 있습니다.`),
      };
    }

    try {
      const result = await this.medicalAi.interpretLab({
        patientId,
        results,
        // 주호소는 **맥락**이지 검사명이 아니다 — 자리에 맞게 넣는다.
        clinicalContext: order.prescription?.encounter?.chiefComplaint ?? undefined,
      });
      return { orderId, patientId, interpretation: result, testedCount: results.length, source: 'AI' };
    } catch (e) {
      this.logger.warn(`AI 검사 해석 실패: ${e}`);
      return { orderId, patientId, interpretation: null, source: 'FALLBACK', error: '해석 서비스 일시 불가' };
    }
  }

  /**
   * AI 추가 검사 추천.
   *
   * 🔴 원 결함: 프롬프트가 `검사 <주호소>에서 이상 수치가 발견되었습니다` 라는 **허위 전제**를 박았다.
   *    이상 여부를 확인한 적이 없고, 검사명 자리에 주호소가 들어가 있었다(P15).
   * → 실제 항목과 실제 이상표시(flag)만 전제로 쓴다. 항목이 없으면 호출하지 않는다.
   */
  async suggestFollowupTests(orderId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        labResult: { include: { items: { select: { testName: true, value: true, unit: true, normalMin: true, normalMax: true, flag: true } } } },
        prescription: { include: { encounter: true } },
      },
    });
    if (!order?.labResult) throw new NotFoundException('검사 결과를 찾을 수 없습니다');

    // 🔴 감사 귀속(§ai-phi-audit-coverage) — interpretResultAI 와 같은 경로로 찾는다(정본이 둘이 되지 않게).
    const patientId = order.prescription?.encounter?.patientId ?? order.labResult.patientId ?? null;
    const items = order.labResult.items.filter((i) => i.value != null && String(i.value).trim() !== '');
    if (!items.length) {
      return {
        orderId,
        patientId,
        suggestions: null,
        ...aiUnavailable('NO_SOURCE_DATA', `검사 결과 항목이 아직 입력되지 않았습니다(현재 상태: ${order.labResult.status}). 추가 검사 추천의 근거가 없습니다.`),
      };
    }

    const abnormal = items.filter((i) => isAbnormalFlag(i.flag));
    const line = (i: (typeof items)[number]) => {
      const ref = i.normalMin != null || i.normalMax != null ? ` (정상 ${i.normalMin ?? '?'}~${i.normalMax ?? '?'})` : '';
      return `- ${i.testName}: ${i.value}${i.unit ? ' ' + i.unit : ''}${ref}${i.flag ? ` [${i.flag}]` : ''}`;
    };
    // 전제는 **관측된 사실**만 — 이상이 없으면 "이상이 발견되었다"고 말하지 않는다.
    const premise = abnormal.length
      ? `아래 검사 결과 중 ${abnormal.length}개 항목에 이상표시(flag)가 있습니다.`
      : '아래 검사 결과에는 이상표시(flag)가 붙은 항목이 없습니다. 그럼에도 임상적으로 추가 확인이 필요한 항목이 있으면 알려주고, 없으면 "추가 검사 불필요"라고 답하세요.';
    const cc = order.prescription?.encounter?.chiefComplaint;

    try {
      const result = await this.medicalAi.clinicalQa({
        question: `${premise}\n${cc ? `주호소: ${cc}\n` : ''}\n검사 결과:\n${items.map(line).join('\n')}\n\n추가로 필요한 검사를 한국어로 최대 3개 추천하고, 각각 왜 필요한지 위 결과의 어떤 항목 때문인지 밝혀주세요.`,
      });
      return { orderId, patientId, suggestions: result, testedCount: items.length, abnormalCount: abnormal.length, source: 'AI' };
    } catch (e) {
      this.logger.warn(`AI 추가 검사 추천 실패: ${e}`);
      return { orderId, patientId, suggestions: null, source: 'FALLBACK', error: '추천 서비스 일시 불가' };
    }
  }

  /** AI 검사 트렌드 분석 — 동일 환자 과거 vs 현재 변화 감지 */
  async analyzeLabTrend(patientId: string, testName?: string) {
    // 완료 검사의 항목값을 testName별 시계열로 집계 — 실제 수치(value·unit·정상범위·이상표시) 포함해 추세 비교 가능
    const results = await this.prisma.labResult.findMany({
      // 🔴 종전엔 COMPLETED 만 — **확인(VERIFIED)된 결과가 통째로 빠져** 두 달 전 미확인 결과를 "현재값"으로 해석했다(2026-10-02)
      where: { patientId, status: { in: ['COMPLETED', 'VERIFIED'] } },
      orderBy: [{ completedAt: 'desc' }],
      take: 30,
      select: {
        completedAt: true, createdAt: true,
        items: { select: { testName: true, value: true, unit: true, flag: true, normalMin: true, normalMax: true } },
      },
    });
    // 🔴 표본 부재는 '호출 실패(FALLBACK)'가 아니다 — 부르지 않았다는 사실을 그대로 말한다.
    if (!results.length) return { patientId, trend: null, ...aiUnavailable('NO_SOURCE_DATA', '완료된 검사 결과가 없어 추세를 산출할 수 없습니다.') };
    if (!this.medicalAi) return { patientId, trend: null, ...aiUnavailable('SOURCE_UNREACHABLE', 'AI 보조가 비활성화되어 있습니다.') };

    // testName → [{date, value, unit, flag, ref}] (시간 오름차순)
    const series: Record<string, { date: string; value: string; unit: string; flag: string | null; ref: string | null }[]> = {};
    for (const r of results) {
      const date = (r.completedAt ?? r.createdAt).toISOString().slice(0, 10);
      for (const it of r.items) {
        if (testName && it.testName !== testName) continue;
        const ref = it.normalMin != null || it.normalMax != null ? `${it.normalMin ?? ''}~${it.normalMax ?? ''}` : null;
        (series[it.testName] ??= []).push({ date, value: it.value, unit: it.unit, flag: it.flag, ref });
      }
    }
    for (const k of Object.keys(series)) series[k].sort((a, b) => a.date.localeCompare(b.date));
    if (!Object.keys(series).length) return { patientId, trend: null, ...aiUnavailable('NO_SOURCE_DATA', '해당 검사 항목의 결과가 없어 추세를 산출할 수 없습니다.') };

    try {
      const result = await this.medicalAi.clinicalQa({
        question: `다음은 환자의 검사 항목별 시계열(날짜·값·단위·정상범위 ref·이상표시 flag)입니다. 각 항목의 추세(안정/개선/악화)와 임상적 주의사항을 한국어로 간결히 요약하세요. 1회뿐인 항목은 현재값과 정상범위 해석만 하세요.\n\n${JSON.stringify(series)}`,
      });
      const tested = Object.entries(series).map(([test, pts]) => ({ test, points: pts.length }));
      // 🔴 출력에 한국어가 아닌 문자(한자·가나)가 섞이면 말한다 — 실측 출력이 중국어로 "정상 범위"라고 적었다(2026-10-02)
      const qualityWarnings = mixedScript(result) ? ['MIXED_SCRIPT'] : [];
      return { patientId, trend: result, tested, source: 'AI', qualityWarnings, disclaimer: await this.medicalAi.getDisclaimer() };
    } catch (e) {
      this.logger.warn(`AI 트렌드 분석 실패: ${e}`);
      return { patientId, trend: null, source: 'FALLBACK' };
    }
  }

  async getQueue() {
    return this.prisma.order.findMany({
      where: { department: 'LAB', status: { in: ['ORDERED', 'RECEIVED', 'IN_PROGRESS'] } },
      orderBy: { createdAt: 'asc' },
      include: {
        prescription: {
          include: {
            encounter: { select: { patient: { select: { id: true, mrn: true, familyName: true, givenName: true } } } },
            procedureCode: { select: { code: true, nameKo: true } },
          },
        },
      },
    });
  }

  async collect(orderId: string, technicianId: string, notes?: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { prescription: { include: { encounter: { select: { patientId: true } } } } },
    });
    if (!order) throw new NotFoundException('Order not found');

    if (order.status !== 'ORDERED' && order.status !== 'RECEIVED') {
      throw new ConflictException(
        `Cannot collect sample for order with status ${order.status}. Expected: ORDERED or RECEIVED`
      );
    }

    /**
     * 🔴 (2026-09-16 G3) 오더 전이와 검사결과 생성은 **한 트랜잭션**이다.
     *    종전엔 오더를 IN_PROGRESS 로 먼저 커밋해, 결과 생성이 실패하면 위 상태 검사가 재시도를 막아
     *    **그 오더가 영구히 잠겼다**(F3 의 약제 조제 시작·이번 영상 촬영과 같은 모양).
     */
    return this.prisma.$transaction(async (tx) => {
      await tx.order.update({
        where: { id: orderId },
        data: { status: 'IN_PROGRESS', receivedAt: new Date(), receivedById: technicianId, startedAt: new Date(), startedById: technicianId },
      });
      return tx.labResult.create({
        data: {
          orderId,
          patientId: order.prescription.encounter?.patientId ?? '',
          technicianId,
          status: LabResultStatus.COLLECTED,
          // 🔴 (2026-10-01) 이 EP 는 검사실 **접수**다 — 채취 시각은 오더에 기록된 채취(병동·채혈실)를 옮겨 적는다.
          //    종전엔 접수 순간을 채취로 찍었다. 채취 기록이 없으면 null(모르는 시각을 지어내지 않는다).
          collectedAt: order.specimenCollectedAt ?? null,
          notes,
        },
        include: {
          technician: { select: { id: true, familyName: true, givenName: true } },
          order: { include: { prescription: true } },
        },
      });
    });
  }

  /** 검사코드(testCode)→표준 LOINC 배치 해소(코드마스터 LabTestCode). 이름 매칭 없이 코드 기반만(오LOINC 방지). */
  private async resolveLoincByCode(codes: Array<string | undefined | null>): Promise<Map<string, string>> {
    const uniq = [...new Set(codes.filter((c): c is string => !!c))];
    const map = new Map<string, string>();
    if (!uniq.length) return map;
    const masters = await this.prisma.labTestCode.findMany({
      where: { code: { in: uniq }, loincCode: { not: null } },
      select: { code: true, loincCode: true },
    });
    for (const m of masters) if (m.loincCode) map.set(m.code, m.loincCode);
    return map;
  }

  async submitResult(
    orderId: string,
    items: Array<{
      testName: string;
      value: string;
      unit: string;
      normalMin?: number;
      normalMax?: number;
      testCode?: string;  // (LOINC 훅) 검사코드 지정 시 마스터에서 LOINC 해소
      loincCode?: string; // 직접 지정도 허용
    }>,
    notes?: string,
    userId?: string,
  ) {
    const labResult = await this.prisma.labResult.findUnique({
      where: { orderId },
      include: { items: true },
    });
    if (!labResult) throw new NotFoundException('Lab result not found');

    if (labResult.status !== LabResultStatus.COLLECTED && labResult.status !== LabResultStatus.IN_PROGRESS) {
      throw new ConflictException(
        `Cannot submit results for lab order with status ${labResult.status}. Expected: COLLECTED or IN_PROGRESS`
      );
    }

    if (!items || items.length === 0) {
      throw new BadRequestException('At least one test result must be provided');
    }

    // (LOINC 훅) testCode 지정 항목은 코드마스터에서 LOINC 배치 해소 — 이름 매칭(오LOINC 위험) 대신 코드 기반만.
    // FE가 검사코드 피커로 testCode를 넘기면 즉시 LOINC 부착(백엔드 선반영).
    const loincByCode = await this.resolveLoincByCode(items.map((i) => i.testCode));

    // 환자 인구학(성별·나이) — 기준치 마스터 자동 해소용
    const orderPt = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { prescription: { select: { encounter: { select: { patient: { select: { gender: true, dateOfBirth: true } } } } } } },
    });
    const demo = orderPt?.prescription?.encounter?.patient;
    const ageYears = this.ageYearsFrom(demo?.dateOfBirth);
    const ageMonths = this.ageMonthsFrom(demo?.dateOfBirth);
    const sex = demo?.gender ?? null;

    // 기준치 판정: 기술자가 범위 미입력 시 기준치 마스터에서 성별·연령 반영 해소 → 이상치 미판정 방지. LL/HH=위급.
    const flaggedItems = await Promise.all(items.map(async (item) => {
      const loincCode = item.loincCode ?? (item.testCode ? loincByCode.get(item.testCode) ?? undefined : undefined);
      let low = item.normalMin ?? null;
      let high = item.normalMax ?? null;
      let critLow: number | null = null;
      let critHigh: number | null = null;
      let textNormal: string | null = null;
      // 위급역치는 정상범위 제공 여부와 무관하게 항상 마스터에서 조회(P0: 정상범위 수동입력 시 위급 누락 방지).
      const r = await this.referenceRange.resolve({ testCode: item.testCode, loincCode, sex, ageYears, ageMonths });
      if (r && this.unitCompatible(item.unit, r.unit)) {
        // 🔴단위 일치(또는 둘 중 무단위)일 때만 적용 — 단위 불일치 시 반대방향 위급 오판정 방지.
        if (low == null && high == null) { low = r.low; high = r.high; }
        critLow = r.criticalLow;
        critHigh = r.criticalHigh;
        textNormal = r.textNormal;
      }
      const flag = this.referenceRange.flagValue(item.value, { low, high, criticalLow: critLow, criticalHigh: critHigh, textNormal });
      return {
        testName: item.testName,
        value: item.value,
        unit: item.unit,
        testCode: item.testCode ?? undefined,
        loincCode,
        normalMin: low,
        normalMax: high,
        labResultId: labResult.id,
        flag,
      };
    }));

    // Delete existing items and create new ones
    await this.prisma.labResultItem.deleteMany({ where: { labResultId: labResult.id } });
    // 결과 확정과 위급값 경보를 한 트랜잭션으로 묶는다.
    // 종전엔 순차 쓰기라 결과가 COMPLETED 로 확정된 뒤 criticalValueAlert 생성만 실패하면
    // **위급값 경보가 유실**됐다("여기서 확정 영속하면 유실 불가"라는 의도와 구현이 어긋나 있었음).
    // 중간에 외부 I/O 가 없어 트랜잭션 구간이 짧다. — 2026-07 트랜잭션 경계 전수
    const { order, criticalValues, hasCritical, critPatientId, critDoctorId } = await this.prisma.$transaction(async (tx) => {
      await tx.labResultItem.createMany({ data: flaggedItems });

      // Update lab result status
      await tx.labResult.update({
        where: { id: labResult.id },
        data: {
          status: LabResultStatus.COMPLETED,
          completedAt: new Date(),
          notes,
        },
      });

      // Update order status — 완료 시행자 스탬프
      const order = await tx.order.update({
        where: { id: orderId },
        data: { status: 'COMPLETED', completedAt: new Date(), ...(userId ? { completedById: userId } : {}) },
        include: { prescription: { select: { id: true, encounterId: true, encounter: { select: { patientId: true, doctorId: true } } } } },
      });

      // ── 위급값 (Critical Value) 감지 ──
      const criticalValues = await this.detectCriticalValues(flaggedItems);
      // 기준치 마스터 위급역치(LL/HH)도 위급값에 포함 — 이름기반 임계가 못 잡은 항목 보강(중복 제거)
      for (const it of flaggedItems) {
        if ((isCriticalFlag(it.flag)) && !criticalValues.some((c) => c.testName === it.testName)) {
          criticalValues.push({ testName: it.testName, value: it.value, unit: it.unit, reason: it.flag === 'LL' ? '기준치 위급 저치' : '기준치 위급 고치' });
        }
      }
      const hasCritical = criticalValues.length > 0;

      // ── 위급값 영구 기록(read-back 확인 레코드) — 결과 저장 흐름에서 직접 영속 ──
      // 종전엔 fire-and-forget 리스너에서만 생성 → 리스너 실패 시 위급값 알림·read-back 레코드 유실(환자안전).
      // 여기서 확정 영속하면 유실 불가. 담당의 알림/푸시는 리스너(best-effort)가 계속 담당.
      const critPatientId = order.prescription?.encounter?.patientId;
      const critDoctorId = order.prescription?.encounter?.doctorId ?? null;
      if (hasCritical && critPatientId) {
        await tx.criticalValueAlert.createMany({
          data: criticalValues.map((c) => ({
            labResultId: labResult.id, patientId: critPatientId, doctorId: critDoctorId,
            testName: c.testName, value: c.value, unit: c.unit, reason: c.reason,
          })),
        });
      }
      return { order, criticalValues, hasCritical, critPatientId, critDoctorId };
    });

    // 환자 여정 — 검사 결과 완료(여정 콘솔·동선 집계). fire-and-forget이라 결과 저장에 영향 없음.
    if (critPatientId) {
      const abnormalCount = flaggedItems.filter((i) => isAbnormalFlag(i.flag)).length;
      this.journey?.emit({
        patientId: critPatientId,
        eventType: 'LAB_RESULT',
        title: '검사 결과 완료',
        description: `${flaggedItems.length}개 항목${abnormalCount > 0 ? ` · 이상 ${abnormalCount}건` : ' · 정상'}${hasCritical ? ' · 🔴위급값' : ''}`,
        department: '진단검사의학과',
        refType: 'LabResult',
        refId: labResult.id,
        severity: hasCritical ? 'CRITICAL' : abnormalCount > 0 ? 'WARNING' : undefined,
      });
    }

    // 검사 결과 완료 이벤트 → 알림/차트 연동
    this.eventEmitter.emit('lab.result.completed', {
      labResultId: labResult.id,
      orderId,
      prescriptionId: order.prescription?.id, // progressive billing 발생 트리거
      patientId: order.prescription?.encounter?.patientId,
      encounterId: order.prescription?.encounterId,
      hasAbnormal: flaggedItems.some(i => isAbnormalFlag(i.flag)),
      hasCritical,
      criticalValues,
    });

    // 위급값 발견 시 즉시 알림 이벤트 (SSE → 주치의 + 병동 간호사)
    if (hasCritical) {
      this.eventEmitter.emit('lab.critical.value', {
        labResultId: labResult.id,
        orderId,
        patientId: order.prescription?.encounter?.patientId,
        encounterId: order.prescription?.encounterId,
        criticalValues,
        severity: 'URGENT',
        message: `위급값 통보: ${criticalValues.map(c => `${c.testName} ${c.value}${c.unit} (${c.reason})`).join(', ')}`,
      });
    }

    return this.prisma.labResult.findUnique({
      where: { id: labResult.id },
      include: { items: true, technician: { select: { id: true, familyName: true, givenName: true } } },
    });
  }

  // ── 위급값 정의 (Critical Value Thresholds) ──
  // aliases: 공백 없는 항목은 검사명 '토큰'과 정확일치(부분문자열 금지 — 'ph'가 'Phosphatase'에 오매칭되던 문제 방지),
  //          공백 포함 항목은 정규화 전체문자열 부분일치. units: 허용 단위(정규화). 비면 단위 무관(pH/INR 등).
  // 임계값은 단위별로 정의(byUnit) — 같은 분석물이라도 단위 스케일에 따라 임계가 다름(트로포닌 ng/mL vs ng/L,
  // 혈소판 /µL vs ×10³/µL vs 10⁹/L). anyUnit=단위 무관(pH·INR). requireUnit=단위 없으면 스케일 모호로 스킵(PLT).
  private static readonly CRITICAL_THRESHOLDS: Array<{
    aliases: string[]; reason: string;
    byUnit?: Record<string, { low?: number; high?: number }>;
    anyUnit?: { low?: number; high?: number };
    requireUnit?: boolean;
  }> = [
    { aliases: ['k', 'k+', 'potassium', '칼륨'], reason: '칼륨 위급', byUnit: { 'meq/l': { low: 2.5, high: 6.5 }, 'mmol/l': { low: 2.5, high: 6.5 } } },
    { aliases: ['na', 'na+', 'sodium', '나트륨'], reason: '나트륨 위급', byUnit: { 'meq/l': { low: 120, high: 160 }, 'mmol/l': { low: 120, high: 160 } } },
    { aliases: ['glucose', 'glu', 'fbs', 'bst', '혈당', '포도당'], reason: '혈당 위급', byUnit: { 'mg/dl': { low: 40, high: 500 }, 'mmol/l': { low: 2.2, high: 27.8 } } },
    { aliases: ['hgb', 'hb', 'hemoglobin', '혈색소'], reason: '중증 빈혈', byUnit: { 'g/dl': { low: 7.0 }, 'g/l': { low: 70 } } },
    // 혈소판: 스케일 모호(단위 필수) — 원시 /µL(20000)·×10³/µL(20)·10⁹/L(20).
    {
      aliases: ['plt', 'platelet', 'platelets', '혈소판'], reason: '중증 혈소판 감소', requireUnit: true,
      byUnit: { '/ul': { low: 20000 }, 'ul': { low: 20000 }, 'x103/ul': { low: 20 }, '103/ul': { low: 20 }, 'k/ul': { low: 20 }, '109/l': { low: 20 } },
    },
    { aliases: ['troponin', 'tni', 'tnt', 'trop', 'ctni', 'ctnt'], reason: '심근경색 의심', byUnit: { 'ng/ml': { high: 0.04 }, 'ug/l': { high: 0.04 }, 'ng/l': { high: 40 } } },
    { aliases: ['inr', 'pt inr', 'pt-inr'], reason: 'INR 위급 상승', anyUnit: { high: 5.0 } },
    { aliases: ['ca', 'ca++', 'calcium', '칼슘'], reason: '칼슘 위급', byUnit: { 'mg/dl': { low: 6.0, high: 13.0 }, 'mmol/l': { low: 1.5, high: 3.25 } } },
    { aliases: ['ph'], reason: '산-염기 위급', anyUnit: { low: 7.2, high: 7.6 } },
    { aliases: ['lactate', 'lactic', '젖산'], reason: '유산 위급 상승', byUnit: { 'mmol/l': { high: 4.0 }, 'mg/dl': { high: 36 } } },
  ];

  // 상첨자·^·공백 접기 — ×10³/µL → x103/ul, 10⁹/L → 109/l 로 정규화(byUnit 키와 일치).
  private static normalizeUnit(u?: string): string {
    const sup: Record<string, string> = { '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9' };
    return (u ?? '').toLowerCase()
      .replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹]/g, (c) => sup[c] ?? c)
      .replace(/[µμ]/g, 'u').replace(/×/g, 'x').replace(/\*/g, '').replace(/\^/g, '').replace(/\s+/g, '');
  }

  /** 값 파싱 — '>500'·'≥500'·'<40'·'≤40'·'HI'·'LO'·'1,050' 등 센티넬/구분자 해석(극단값 놓침 방지). */
  private static parseValue(raw: string): { num: number | null; gt: boolean; lt: boolean } {
    const s = (raw ?? '').trim();
    const up = s.toUpperCase();
    if (/^(HI|HIGH|H\*?|\+\+\+)$/.test(up)) return { num: null, gt: true, lt: false };
    if (/^(LO|LOW|L\*?|---)$/.test(up)) return { num: null, gt: false, lt: true };
    const gt = /^[>≥]/.test(s);
    const lt = /^[<≤]/.test(s);
    const num = parseFloat(s.replace(/[<>≤≥=]/g, '').replace(/,/g, ''));
    return { num: isNaN(num) ? null : num, gt, lt };
  }

  // ── 위급 임계 정본 로더 — ReferenceRange(criticalLow/High) 캐시 60초 ──
  private criticalRangeCache: { at: number; rows: { aliases: string[]; unitNorm: string; low: number | null; high: number | null; label: string }[] } | null = null;

  private async getCriticalRanges() {
    if (this.criticalRangeCache && Date.now() - this.criticalRangeCache.at < 60_000) return this.criticalRangeCache.rows;
    try {
      const rows = await this.prisma.referenceRange.findMany({
        where: { isActive: true, OR: [{ criticalLow: { not: null } }, { criticalHigh: { not: null } }] },
        select: { testCode: true, testName: true, unit: true, criticalLow: true, criticalHigh: true },
      });
      const mapped = rows.map((r) => {
        const nameNorm = (r.testName ?? '').toLowerCase();
        const aliases = [
          ...nameNorm.split(/[^a-z0-9가-힣+]+/).filter(Boolean), // 'K (칼륨)' → ['k','칼륨']
          ...(r.testCode ? [r.testCode.toLowerCase()] : []),
        ];
        return {
          aliases,
          unitNorm: LabService.normalizeUnit(r.unit ?? undefined),
          low: r.criticalLow != null ? Number(r.criticalLow) : null,
          high: r.criticalHigh != null ? Number(r.criticalHigh) : null,
          label: r.testName ?? r.testCode ?? '검사',
        };
      }).filter((r) => r.aliases.length > 0);
      this.criticalRangeCache = { at: Date.now(), rows: mapped };
      return mapped;
    } catch (e) {
      this.logger.warn(`위급 임계 마스터 로드 실패 — 하드코딩 폴백: ${e instanceof Error ? e.message : e}`);
      return [];
    }
  }

  private async detectCriticalValues(items: Array<{ testName: string; value: string; unit: string; flag: string | null }>) {
    const criticals: Array<{ testName: string; value: string; unit: string; reason: string }> = [];
    for (const item of items) {
      const nameNorm = (item.testName ?? '').toLowerCase();
      const tokens = nameNorm.split(/[^a-z0-9가-힣+]+/).filter(Boolean);
      const unitNorm = LabService.normalizeUnit(item.unit);
      const { num, gt, lt } = LabService.parseValue(item.value);

      // ① 기준치 마스터(ReferenceRange.criticalLow/High) 우선 — 진단검사위가 화면에서 개정하면 즉시 반영.
      //    매칭=검사명 토큰+단위 정규화 일치(스케일 오판 방지). 미등록 검사만 ② 하드코딩 폴백(fail-safe).
      //    🔴 이중 정본 실증: 칼륨 위급 하한이 마스터 2.8 vs 하드코딩 2.5 로 갈라져 있었다(2026-08-04) — 마스터가 정본.
      const rrEntry = (await this.getCriticalRanges()).find((r) =>
        r.aliases.some((a) => (a.includes(' ') ? nameNorm.includes(a) : tokens.includes(a)))
        && (r.unitNorm === '' || r.unitNorm === unitNorm),
      );
      if (rrEntry) {
        if (rrEntry.high !== null && (gt || (num !== null && num > rrEntry.high))) {
          criticals.push({ testName: item.testName, value: item.value, unit: item.unit, reason: `${rrEntry.label} 위급 (>${rrEntry.high}·기준치 마스터)` });
        }
        if (rrEntry.low !== null && (lt || (num !== null && num < rrEntry.low))) {
          criticals.push({ testName: item.testName, value: item.value, unit: item.unit, reason: `${rrEntry.label} 위급 (<${rrEntry.low}·기준치 마스터)` });
        }
        continue; // 마스터 등재 검사는 마스터만 — 하드코딩과 이중 판정 금지
      }

      for (const t of LabService.CRITICAL_THRESHOLDS) {
        const nameMatch = t.aliases.some((a) => (a.includes(' ') ? nameNorm.includes(a) : tokens.includes(a)));
        if (!nameMatch) continue;

        // 적용할 임계 선택 — anyUnit(단위무관) 우선, 아니면 byUnit[단위].
        let thr = t.anyUnit;
        if (!thr && t.byUnit) {
          if (unitNorm && t.byUnit[unitNorm]) {
            thr = t.byUnit[unitNorm];
          } else if (unitNorm) {
            // 단위는 있으나 미등록 — 스케일을 알 수 없어 오판 방지 위해 스킵하되 '조용히'가 아니라 로그.
            this.logger.warn(`위급값 단위 미매칭 스킵: ${item.testName} ${item.value}${item.unit}`);
            continue;
          } else if (t.requireUnit) {
            // 단위 필수(PLT 등)인데 단위 없음 — 스케일 모호 → 스킵.
            continue;
          } else {
            // 단위 없음 — 관례 단위(첫 항목) 임계 적용.
            thr = Object.values(t.byUnit)[0];
          }
        }
        if (!thr) continue;

        if (thr.high !== undefined && (gt || (num !== null && num > thr.high))) {
          criticals.push({ testName: item.testName, value: item.value, unit: item.unit, reason: `${t.reason} (>${thr.high})` });
        }
        if (thr.low !== undefined && (lt || (num !== null && num < thr.low))) {
          criticals.push({ testName: item.testName, value: item.value, unit: item.unit, reason: `${t.reason} (<${thr.low})` });
        }
      }
    }
    return criticals;
  }

  async getResult(orderId: string) {
    const labResult = await this.prisma.labResult.findUnique({
      where: { orderId },
      include: {
        items: true,
        technician: { select: { id: true, familyName: true, givenName: true } },
        patient: { select: { id: true, mrn: true, familyName: true, givenName: true } },
      },
    });

    if (!labResult) throw new NotFoundException('Lab result not found');
    return labResult;
  }

  /**
   * 검증 대기 목록 — 결과 입력 완료(COMPLETED)이나 아직 독립 검증 전인 결과.
   *
   * 🔴 verify EP 는 처음부터 있었는데 **대기 목록 EP·화면이 없어** 검증 단계가 사실상 미운영이었다
   *    (2026-08-03 실측: COMPLETED 256 vs VERIFIED 2 — 결과가 예비 상태로 소비되고 있었다).
   *    기능이 있어도 그 기능으로 가는 목록이 없으면 잠든 기능이다.
   */
  async getPendingVerification() {
    const rows = await this.prisma.labResult.findMany({
      where: { status: LabResultStatus.COMPLETED },
      orderBy: { completedAt: 'asc' }, // 오래 기다린 결과부터 — 최신순이면 묵은 건이 영영 묻힌다
      include: {
        patient: { select: { id: true, familyName: true, givenName: true, mrn: true } },
        technician: { select: { id: true, familyName: true, givenName: true } },
        items: { select: { testName: true, value: true, unit: true, flag: true, normalMin: true, normalMax: true } },
        amendments: { select: { id: true }, take: 1 },
      },
    });
    return rows.map((r) => ({
      id: r.id,
      orderId: r.orderId,
      patient: r.patient,
      technician: r.technician,
      completedAt: r.completedAt,
      notes: r.notes,
      items: r.items,
      // 🔴 flag 는 정상도 'N'/'NORMAL' 로 채워진다 — !!flag 로 세면 정상 1,163건이 이상으로 계수돼
      //    검증 화면의 우선순위 신호가 전 행 붉게 물들었다(2026-08-13 실측 1873/1877). 정본 isAbnormalFlag.
      abnormalCount: r.items.filter((i) => isAbnormalFlag(i.flag)).length,
      // 정정 이력 있는 결과는 재검증 대상 — 화면에서 구분 표시(정정 후 COMPLETED 로 되돌아온다)
      amended: r.amendments.length > 0,
    }));
  }

  /**
   * 검사 결과 독립 검증·확정(COMPLETED→VERIFIED). 결과 입력자(technicianId)와 다른 검사자만 검증 가능
   * (독립 이중검증). 검증 전(COMPLETED)은 예비 결과이므로 임상 확정과 구분된다.
   */
  async verifyResult(orderId: string, verifierId: string) {
    const labResult = await this.prisma.labResult.findUnique({ where: { orderId } });
    if (!labResult) throw new NotFoundException('검사 결과를 찾을 수 없습니다');
    if (labResult.status === LabResultStatus.VERIFIED) {
      throw new ConflictException('이미 검증·확정된 결과입니다');
    }
    if (labResult.status !== LabResultStatus.COMPLETED) {
      throw new ConflictException(`검증은 결과 입력 완료(COMPLETED) 후 가능합니다. 현재: ${labResult.status}`);
    }
    // 독립 검증 — 결과 입력자 본인은 검증 불가.
    if (verifierId === labResult.technicianId) {
      throw new ConflictException('결과 입력자는 본인 결과를 검증할 수 없습니다(독립 검증 필요)');
    }
    // 정정한 사람도 본인 정정을 검증 불가(정정 후 독립 검증 우회 방지).
    const lastAmendment = await this.prisma.labResultAmendment.findFirst({
      where: { labResultId: labResult.id }, orderBy: { createdAt: 'desc' },
    });
    if (lastAmendment && lastAmendment.amendedBy === verifierId) {
      throw new ConflictException('정정한 검사자는 본인 정정 결과를 검증할 수 없습니다(독립 검증 필요)');
    }
    // 원자적 전이 — COMPLETED인 경우에만 VERIFIED로 선점.
    const claimed = await this.prisma.labResult.updateMany({
      where: { id: labResult.id, status: LabResultStatus.COMPLETED },
      data: { status: LabResultStatus.VERIFIED, verifiedBy: verifierId, verifiedAt: new Date() },
    });
    if (claimed.count === 0) throw new ConflictException('이미 검증 중이거나 확정된 결과입니다');

    this.eventEmitter.emit('lab.result.verified', {
      labResultId: labResult.id, orderId, patientId: labResult.patientId, verifiedBy: verifierId,
    });

    const verified = await this.prisma.labResult.findUnique({
      where: { id: labResult.id },
      include: { items: true, technician: { select: { id: true, familyName: true, givenName: true } } },
    });

    // 🔴 환자 앱 푸시 — **검증 완료(VERIFIED) 이후에만**. COMPLETED 는 독립 검증 전 예비 결과라
    //    그 시점에 환자에게 "결과가 나왔습니다"라고 하면 검증 전 값을 임상 확정으로 읽게 만든다.
    //
    // 🔴 위급값(critical)이 포함된 결과는 환자에게 **먼저** 알리지 않는다(CRITICAL_WITHHELD).
    //    근거: 위급값 통보는 IPSG.2 의 read-back 경로(주치의·담당간호사 → CriticalValueAlert)가
    //    정본이고, 그 경로는 사람이 확인 응답을 남겨야 닫힌다. 환자 알림이 그 경로를 앞지르면
    //    ① 임상적 맥락 없이 위급 수치를 먼저 보게 되고 ② 병원이 아직 연락하지 않은 상태에서
    //    환자가 먼저 전화를 걸어 통보 경로가 뒤집힌다. 임상적으로 논쟁적인 영역이라
    //    **안전측(미발송)** 으로 접고, 켤지 여부는 사람 결정으로 남긴다.
    //    (여기서 막히는 것은 '알림'뿐이다 — 결과 자체는 종전대로 포털·앱에서 조회된다.)
    const items = verified?.items ?? [];
    if (items.some((i) => isCriticalFlag(i.flag))) {
      this.logger.warn(
        `검사 결과 환자 알림 보류(위급값 포함) labResult=${labResult.id} — 위급값 통보는 IPSG.2 read-back 경로로 처리한다`,
      );
    } else if (labResult.patientId) {
      this.eventEmitter.emit('lab.patient_result_ready', {
        patientId: labResult.patientId,
        // 🔴 항목이 하나일 때만 검사명을 말한다 — 여러 항목을 한 이름으로 부르면 지어내는 것이다.
        //    미상이면 핸들러의 폴백 문구('검사')가 쓰인다.
        testName: items.length === 1 ? items[0].testName : undefined,
        labResultId: labResult.id,
        orderId,
      });
    }

    return verified;
  }

  /**
   * 검사 결과 정정(amendment) — 입력/확정(COMPLETED/VERIFIED) 후 값 정정.
   * 이전 값 스냅샷을 보존(감사)하고, 상태를 COMPLETED로 되돌려 재검증을 요구하며,
   * 정정 결과가 위급값이면 위급값 감지·통보를 다시 발화(정정된 위급값 재통보).
   */
  async amendResult(
    orderId: string,
    items: Array<{ testName: string; value: string; unit: string; normalMin?: number; normalMax?: number }>,
    reason: string,
    amendedBy: string,
  ) {
    if (!items || items.length === 0) throw new BadRequestException('정정 결과 항목이 필요합니다');
    if (!reason || !reason.trim()) throw new BadRequestException('정정 사유가 필요합니다');
    const labResult = await this.prisma.labResult.findUnique({ where: { orderId }, include: { items: true } });
    if (!labResult) throw new NotFoundException('검사 결과를 찾을 수 없습니다');
    if (labResult.status !== LabResultStatus.COMPLETED && labResult.status !== LabResultStatus.VERIFIED) {
      throw new ConflictException(`정정은 입력 완료(COMPLETED/VERIFIED) 결과에만 가능합니다. 현재: ${labResult.status}`);
    }

    // 정정 시 LOINC/testCode 이월 — 동일 검사명은 동일 코드이므로 기존 항목에서 안전 보존(정정이 LOINC를 잃던 것 방지).
    const codeByName = new Map(labResult.items.map((it: any) => [it.testName, { loincCode: it.loincCode ?? null, testCode: it.testCode ?? null }]));
    const flaggedItems = items.map((item) => {
      const prior = codeByName.get(item.testName);
      return {
        testName: item.testName, value: item.value, unit: item.unit,
        testCode: prior?.testCode ?? undefined, loincCode: prior?.loincCode ?? undefined,
        normalMin: item.normalMin ?? null, normalMax: item.normalMax ?? null,
        labResultId: labResult.id,
        flag:
          item.normalMin != null && item.normalMax != null
            ? Number(item.value) < item.normalMin ? 'L' : Number(item.value) > item.normalMax ? 'H' : 'N'
            : null,
      };
    });

    // 스냅샷 보존 + 항목 교체 + 상태 되돌리기를 하나의 트랜잭션으로(부분 실패 시 항목 유실·불일치 방지).
    await this.prisma.$transaction(async (tx) => {
      await tx.labResultAmendment.create({
        data: {
          labResultId: labResult.id, amendedBy, reason: reason.trim(),
          previousStatus: labResult.status,
          previousItems: labResult.items.map((it: any) => ({
            testName: it.testName, value: it.value, unit: it.unit, flag: it.flag,
            testCode: it.testCode ?? null, loincCode: it.loincCode ?? null,
            normalMin: it.normalMin != null ? Number(it.normalMin) : null,
            normalMax: it.normalMax != null ? Number(it.normalMax) : null,
          })) as unknown as Prisma.InputJsonValue,
        },
      });
      await tx.labResultItem.deleteMany({ where: { labResultId: labResult.id } });
      await tx.labResultItem.createMany({ data: flaggedItems });
      // 정정은 이전 검증을 무효화 — COMPLETED로 되돌리고 verified 정보 제거(재검증 요구).
      await tx.labResult.update({
        where: { id: labResult.id },
        data: { status: LabResultStatus.COMPLETED, verifiedBy: null, verifiedAt: null, completedAt: new Date() },
      });
    });

    // 정정은 위급값 '재통보'만 발행 — lab.result.completed 재발행은 chronic 미러 중복(항목 id 변경)·
    // 청구 재트리거를 부르므로 피하고, 위급값 재감지 시 lab.critical.value만 발행한다.
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { prescription: { select: { encounterId: true, encounter: { select: { patientId: true } } } } },
    });
    const criticalValues = await this.detectCriticalValues(flaggedItems);
    if (criticalValues.length > 0) {
      this.eventEmitter.emit('lab.critical.value', {
        labResultId: labResult.id, orderId,
        patientId: order?.prescription?.encounter?.patientId ?? labResult.patientId,
        encounterId: order?.prescription?.encounterId ?? undefined,
        criticalValues, severity: 'URGENT',
        message: `위급값 정정 통보: ${criticalValues.map((c) => `${c.testName} ${c.value}${c.unit} (${c.reason})`).join(', ')}`,
      });
    }

    return this.prisma.labResult.findUnique({
      where: { id: labResult.id },
      include: { items: true, amendments: { orderBy: { createdAt: 'desc' } } },
    });
  }

  async getPatientResults(patientId: string, windowDays?: number) {
    // 결과는 방문마다 성장(items include 무거움) — 최근 200건 상한 (2026-07 전체검토 D-2)
    // 기간은 결과 시각(완료 전이면 접수 시각) 기준
    const since = windowDays ? new Date(Date.now() - windowDays * 86400_000) : null;
    return this.prisma.labResult.findMany({
      where: since ? { patientId, OR: [{ completedAt: { gte: since } }, { completedAt: null, createdAt: { gte: since } }] } : { patientId },
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: {
        items: true,
        technician: { select: { id: true, familyName: true, givenName: true } },
        order: { include: { prescription: true } },
      },
    });
  }

  async startTesting(labResultId: string) {
    const labResult = await this.prisma.labResult.findUnique({
      where: { id: labResultId },
    });
    if (!labResult) throw new NotFoundException('Lab result not found');

    if (labResult.status !== LabResultStatus.COLLECTED) {
      throw new ConflictException(
        `Cannot start testing for lab order with status ${labResult.status}. Expected: COLLECTED`
      );
    }

    return this.prisma.labResult.update({
      where: { id: labResultId },
      data: { status: LabResultStatus.IN_PROGRESS },
      include: { items: true },
    });
  }

  async cancelTesting(labResultId: string, reason: string) {
    const labResult = await this.prisma.labResult.findUnique({
      where: { id: labResultId },
      include: { order: true },
    });
    if (!labResult) throw new NotFoundException('Lab result not found');

    if (labResult.status === LabResultStatus.COMPLETED) {
      throw new ConflictException('Cannot cancel completed lab result');
    }

    /**
     * 🔴 (2026-09-16 G3) 오더 되돌림·항목 삭제·결과 되돌림은 **한 트랜잭션**이다.
     *    종전엔 항목을 먼저 지우고 결과 되돌림을 따로 커밋했다 — 중간에 실패하면
     *    **항목만 사라지고 결과는 검사 중**으로 남았다(지워진 항목은 되돌릴 수 없다).
     */
    return this.prisma.$transaction(async (tx) => {
      await tx.order.update({
        where: { id: labResult.orderId },
        data: { status: 'RECEIVED', startedAt: null },
      });
      await tx.labResultItem.deleteMany({
        where: { labResultId: labResultId },
      });
      return tx.labResult.update({
        where: { id: labResultId },
        data: {
          status: LabResultStatus.PENDING,
          // 검사 취소는 채취를 되돌리지 않는다 — 검체는 이미 채취됐다(오더의 채취 기록 · 없으면 null)
          collectedAt: labResult.order?.specimenCollectedAt ?? null,
          notes: `${labResult.notes || ''}${reason ? '\n취소사유: ' + reason : ''}`,
        },
      });
    });
  }

  // ── 장비 관리 ──

  async getInstruments() {
    return this.prisma.labInstrument.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
    });
  }

  async createInstrument(data: {
    name: string; manufacturer?: string; model?: string; serialNumber?: string;
    category: string; interfaceType: string; interfaceConfig?: Record<string, unknown>; location?: string;
  }) {
    return this.prisma.labInstrument.create({
      data: { ...data, interfaceConfig: data.interfaceConfig as unknown as Prisma.InputJsonValue },
    });
  }

  async updateInstrument(id: string, data: Partial<{
    name: string; manufacturer: string; model: string; serialNumber: string;
    category: string; interfaceType: string; interfaceConfig: Record<string, unknown>; location: string; isActive: boolean;
  }>) {
    return this.prisma.labInstrument.update({
      where: { id },
      data: { ...data, interfaceConfig: data.interfaceConfig as unknown as Prisma.InputJsonValue },
    });
  }

  async getInstrumentDetail(id: string) {
    const instrument = await this.prisma.labInstrument.findUnique({
      where: { id },
      include: {
        interfaceResults: { orderBy: { receivedAt: 'desc' }, take: 20 },
      },
    });
    if (!instrument) throw new NotFoundException('장비를 찾을 수 없습니다');
    return instrument;
  }

  // ── 파일 수신 (Interface) ──

  async receiveFile(params: {
    instrumentId: string; rawData: Record<string, unknown>; parsedItems?: Record<string, unknown>[];
    sampleBarcode?: string; fileName?: string;
  }) {
    // 바코드로 오더 자동 매칭 시도
    let matchedOrderId: string | undefined;
    let status = 'RECEIVED';

    if (params.sampleBarcode) {
      const order = await this.prisma.order.findFirst({
        where: {
          department: 'LAB',
          status: { in: ['ORDERED', 'RECEIVED', 'IN_PROGRESS'] },
          prescription: {
            encounter: {
              patient: { mrn: { contains: params.sampleBarcode.split('-')[0] } },
            },
          },
        },
      });
      if (order) {
        matchedOrderId = order.id;
        status = 'MATCHED';
      }
    }

    return this.prisma.labInterfaceResult.create({
      data: {
        instrumentId: params.instrumentId,
        rawData: params.rawData as unknown as Prisma.InputJsonValue,
        parsedItems: params.parsedItems as unknown as Prisma.InputJsonValue,
        sampleBarcode: params.sampleBarcode,
        matchedOrderId,
        fileName: params.fileName,
        status,
      },
    });
  }

  async getPendingInterfaceResults(instrumentId?: string) {
    const where: Prisma.LabInterfaceResultWhereInput = { status: { in: ['RECEIVED', 'MATCHED'] } };
    if (instrumentId) where.instrumentId = instrumentId;
    return this.prisma.labInterfaceResult.findMany({
      where,
      include: { instrument: { select: { name: true, category: true } } },
      orderBy: { receivedAt: 'desc' },
      take: 50,
    });
  }

  async matchInterfaceResult(id: string, orderId: string) {
    const result = await this.prisma.labInterfaceResult.findUnique({ where: { id } });
    if (!result) throw new NotFoundException('수신 결과를 찾을 수 없습니다');
    return this.prisma.labInterfaceResult.update({
      where: { id },
      data: { matchedOrderId: orderId, status: 'MATCHED' },
    });
  }

  async applyInterfaceResult(id: string, technicianId: string) {
    const result = await this.prisma.labInterfaceResult.findUnique({ where: { id } });
    if (!result) throw new NotFoundException('수신 결과를 찾을 수 없습니다');
    if (!result.matchedOrderId) throw new BadRequestException('오더가 매칭되지 않았습니다');
    if (result.status === 'APPLIED') throw new ConflictException('이미 적용된 결과입니다');

    const parsedItems = (result.parsedItems as Record<string, unknown>[]) ?? [];
    if (parsedItems.length === 0) throw new BadRequestException('파싱된 결과가 없습니다');

    // LabResult 자동 생성/업데이트
    const order = await this.prisma.order.findUnique({ where: { id: result.matchedOrderId }, include: { prescription: true } });
    if (!order) throw new NotFoundException('오더를 찾을 수 없습니다');

    const patientId = order.prescription?.encounterId
      ? (await this.prisma.encounter.findUnique({ where: { id: order.prescription.encounterId }, select: { patientId: true } }))?.patientId ?? ''
      : '';

    // LOINC 미보유 항목의 코드(testCode)로 마스터 배치 해소 — LIS가 LOINC를 안 보낸 경우 내부 코드마스터에서 보강.
    const loincByCode = await this.resolveLoincByCode(
      parsedItems.filter((i) => !i.loincCode && i.testCode).map((i) => String(i.testCode)),
    );

    // 환자 인구학(성별·나이) — LIS가 범위 미전송 시 기준치 마스터 자동 해소용
    const isoDemo = patientId
      ? await this.prisma.patient.findUnique({ where: { id: patientId }, select: { gender: true, dateOfBirth: true } })
      : null;
    const isoAge = this.ageYearsFrom(isoDemo?.dateOfBirth);
    const isoMonths = this.ageMonthsFrom(isoDemo?.dateOfBirth);
    const isoSex = isoDemo?.gender ?? null;

    // 항목 계산 — testCode·loincCode 보존. LIS 미전송 범위는 기준치 마스터에서 성별·연령 반영 해소(이상치 오정상 방지·LL/HH 위급).
    const flaggedItems: Array<{ testName: string; value: string; unit: string; flag: string | null }> = [];
    const itemRows = await Promise.all(parsedItems.map(async (item) => {
      let normalMin = item.normalMin != null ? parseFloat(String(item.normalMin)) : null;
      let normalMax = item.normalMax != null ? parseFloat(String(item.normalMax)) : null;
      const testCode = item.testCode != null ? String(item.testCode) : null;
      const loincCode = item.loincCode != null ? String(item.loincCode) : (testCode ? loincByCode.get(testCode) ?? null : null);
      let critLow: number | null = null;
      let critHigh: number | null = null;
      let textNormal: string | null = null;
      const itemUnit = String(item.unit ?? '');
      // 위급역치는 정상범위 제공 여부와 무관하게 항상 조회(P0). 단위 일치 시에만 적용(단위불일치 오판정 차단).
      const r = await this.referenceRange.resolve({ testCode, loincCode, sex: isoSex, ageYears: isoAge, ageMonths: isoMonths });
      if (r && this.unitCompatible(itemUnit, r.unit)) {
        if (normalMin == null && normalMax == null) { normalMin = r.low; normalMax = r.high; }
        critLow = r.criticalLow;
        critHigh = r.criticalHigh;
        textNormal = r.textNormal;
      }
      // 🔴판정 불가(정성·기준없음)는 'N' 강제 금지 → 미판정(null)으로 두어 이상치 오정상 방지.
      let flag = this.referenceRange.flagValue(String(item.value), { low: normalMin, high: normalMax, criticalLow: critLow, criticalHigh: critHigh, textNormal });
      // 🔴 정성 위급 fallback — HIS 가 판정 못한 항목(값 없는 배양·항체 등)은 LIS interpretation(HH/LL/AA)을
      //    HIS flag 로 받아 위급을 놓치지 않는다. HIS 자체 판정(정량)이 있으면 그대로 우선.
      if (flag == null && item.interpretation != null) {
        flag = fromFhirInterpretation(String(item.interpretation));
      }
      const row = { testName: String(item.testName ?? item.testCode ?? ''), value: String(item.value), unit: itemUnit, flag };
      flaggedItems.push(row);
      return { ...row, testCode: testCode ?? undefined, loincCode: loincCode ?? undefined, normalMin: normalMin != null ? normalMin : undefined, normalMax: normalMax != null ? normalMax : undefined };
    }));

    // 원자적 적용 — upsert·항목 재생성·오더/스테이징 갱신을 한 트랜잭션으로(부분실패 시 VERIFIED 소실·항목 유실 손상창 제거).
    const matchedOrderId = result.matchedOrderId;
    const labResult = await this.prisma.$transaction(async (tx) => {
      const lr = await tx.labResult.upsert({
        where: { orderId: matchedOrderId },
        create: {
          orderId: matchedOrderId, patientId, technicianId,
          // 장비 수신 순간은 채취가 아니다 — 오더에 기록된 채취 시각만(없으면 null · 2026-10-01)
          status: LabResultStatus.COMPLETED, collectedAt: (await tx.order.findUnique({ where: { id: matchedOrderId }, select: { specimenCollectedAt: true } }))?.specimenCollectedAt ?? null, completedAt: new Date(),
          notes: `장비 자동 수신: ${result.fileName ?? ''}`,
        },
        // 재수신이 기 검증(VERIFIED) 결과를 덮어쓸 때 검증정보를 비워 재검증 요구. technicianId=적용자로 갱신
        // (provenance 보존 + 독립검증 앵커가 stale 기술자로 남아 실제 적용자가 자기검증하던 허점 차단).
        update: { status: LabResultStatus.COMPLETED, technicianId, completedAt: new Date(), verifiedBy: null, verifiedAt: null },
      });
      await tx.labResultItem.deleteMany({ where: { labResultId: lr.id } });
      if (itemRows.length) await tx.labResultItem.createMany({ data: itemRows.map((r) => ({ labResultId: lr.id, ...r })) });
      await tx.order.update({ where: { id: matchedOrderId }, data: { status: 'COMPLETED', completedAt: new Date(), completedById: technicianId } });
      await tx.labInterfaceResult.update({ where: { id }, data: { status: 'APPLIED', matchedLabResultId: lr.id, appliedAt: new Date() } });
      return lr;
    });

    // ── 장비 수신 결과도 수기 입력과 동일하게 위급값 감지 + 완료/위급 이벤트 발행 ──
    // (기존엔 인터페이스 경로가 위급값 감지·통보를 전부 우회 → 분석기 위급값 조용히 방출)
    // patientId 폴백 — 오더에 진료/환자 연결이 없어도 위급값 통보가 유실되지 않도록 labResult.patientId 사용.
    await this.emitLabCompletion(labResult.id, result.matchedOrderId, order.prescription?.id, patientId || labResult.patientId, order.prescription?.encounterId ?? undefined, flaggedItems);

    return labResult;
  }

  /** 검사 완료 이벤트 + 위급값 감지·통보 발행(수기 submitResult·장비 applyInterfaceResult 공용). */
  private async emitLabCompletion(
    labResultId: string, orderId: string, prescriptionId: string | undefined,
    patientId: string | undefined, encounterId: string | undefined,
    flaggedItems: Array<{ testName: string; value: string; unit: string; flag: string | null }>,
  ) {
    const criticalValues = await this.detectCriticalValues(flaggedItems);
    // 기준치 마스터 위급역치(LL/HH)도 위급값에 포함 — 이름기반 임계가 못 잡은 항목 보강(중복 제거)
    for (const it of flaggedItems) {
      if ((isCriticalFlag(it.flag)) && !criticalValues.some((c) => c.testName === it.testName)) {
        criticalValues.push({ testName: it.testName, value: it.value, unit: it.unit, reason: it.flag === 'LL' ? '기준치 위급 저치' : '기준치 위급 고치' });
      }
    }
    const hasCritical = criticalValues.length > 0;
    this.eventEmitter.emit('lab.result.completed', {
      labResultId, orderId, prescriptionId, patientId, encounterId,
      hasAbnormal: flaggedItems.some((i) => isAbnormalFlag(i.flag)),
      hasCritical, criticalValues,
    });
    if (hasCritical) {
      this.eventEmitter.emit('lab.critical.value', {
        labResultId, orderId, patientId, encounterId, criticalValues, severity: 'URGENT',
        message: `위급값 통보: ${criticalValues.map((c) => `${c.testName} ${c.value}${c.unit} (${c.reason})`).join(', ')}`,
      });
    }
  }

  async rejectInterfaceResult(id: string, reason: string) {
    return this.prisma.labInterfaceResult.update({
      where: { id },
      data: { status: 'REJECTED', errorMessage: reason },
    });
  }

  // ── 결과 첨부파일 ──

  async addAttachment(labResultId: string, params: {
    fileName: string; fileUrl: string; fileSize: number;
    mimeType: string; type: string; description?: string;
    uploadedBy: string;
  }) {
    const labResult = await this.prisma.labResult.findUnique({ where: { id: labResultId } });
    if (!labResult) throw new NotFoundException('검사 결과를 찾을 수 없습니다');
    return this.prisma.labResultAttachment.create({
      data: { labResultId, ...params },
    });
  }

  async getAttachments(labResultId: string) {
    return this.prisma.labResultAttachment.findMany({
      where: { labResultId },
      orderBy: { uploadedAt: 'desc' },
    });
  }

  // ── 검사기록지 (Worksheet) ──

  async getWorksheets(date?: string) {
    const where: Prisma.LabWorksheetWhereInput = {};
    if (date) where.date = new Date(date);
    return this.prisma.labWorksheet.findMany({
      where,
      include: {
        instrument: { select: { name: true } },
        technician: { select: { familyName: true, givenName: true } },
        items: { orderBy: { sequence: 'asc' } },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  async createWorksheet(data: {
    name: string; instrumentId?: string; category: string;
    date: string; technicianId: string; notes?: string;
  }) {
    return this.prisma.labWorksheet.create({
      data: {
        name: data.name,
        instrumentId: data.instrumentId || undefined,
        category: data.category,
        date: new Date(data.date),
        technicianId: data.technicianId,
        notes: data.notes,
      },
      include: { instrument: { select: { name: true } }, technician: { select: { familyName: true, givenName: true } } },
    });
  }

  async getWorksheetDetail(id: string) {
    const ws = await this.prisma.labWorksheet.findUnique({
      where: { id },
      include: {
        instrument: { select: { name: true } },
        technician: { select: { familyName: true, givenName: true } },
        items: {
          orderBy: { sequence: 'asc' },
        },
      },
    });
    if (!ws) throw new NotFoundException('워크시트를 찾을 수 없습니다');

    // 각 item에 오더+환자 정보 조인 — 단일 findMany 배치(루프 내 N+1 제거)
    const orderIds = [...new Set(ws.items.map((i) => i.orderId))];
    const orders = await this.prisma.order.findMany({
      where: { id: { in: orderIds } },
      include: {
        prescription: {
          include: {
            procedureCode: { select: { nameKo: true, code: true } },
            encounter: { select: { patient: { select: { familyName: true, givenName: true, mrn: true } } } },
          },
        },
        labResult: { select: { id: true, status: true } },
      },
    });
    const orderMap = new Map(orders.map((o) => [o.id, o]));
    const enrichedItems = ws.items.map((item) => ({ ...item, order: orderMap.get(item.orderId) ?? null }));

    return { ...ws, items: enrichedItems };
  }

  async addWorksheetItem(worksheetId: string, data: { orderId: string; sampleBarcode?: string }) {
    const ws = await this.prisma.labWorksheet.findUnique({ where: { id: worksheetId }, include: { items: true } });
    if (!ws) throw new NotFoundException('워크시트를 찾을 수 없습니다');
    if (ws.status === 'SIGNED') throw new ConflictException('서명 완료된 워크시트입니다');

    /**
     * 🔴 (2026-09-16 H4) 항목 추가와 워크시트 상태 전환은 한 트랜잭션이다. 종전엔 항목을 먼저 커밋하고
     *    상태를 따로 바꿨다 — 뒤가 실패하면 워크시트는 OPEN 인데 항목은 이미 들어가 있어, 같은 검체를
     *    다시 넣으면 **sequence 만 다른 중복 항목**이 쌓인다(지운 항목은 되돌릴 수 없다).
     */
    const sequence = ws.items.length + 1;
    return this.prisma.$transaction(async (tx) => {
      const item = await tx.labWorksheetItem.create({
        data: { worksheetId, orderId: data.orderId, sequence, sampleBarcode: data.sampleBarcode },
      });
      // 워크시트 상태 업데이트
      if (ws.status === 'OPEN') {
        await tx.labWorksheet.update({ where: { id: worksheetId }, data: { status: 'IN_PROGRESS' } });
      }
      return item;
    });
  }

  /**
   * 🔴 (2026-09-16) 경로의 워크시트 id 를 **한 번도 쓰지 않고** 항목 id 만으로 삭제했다 —
   *    다른 워크시트의 검사 항목을 이 경로로 지울 수 있었다. 소속이 다르면 존재를 알려주지 않는다(404).
   */
  async removeWorksheetItem(worksheetId: string, itemId: string) {
    const item = await this.prisma.labWorksheetItem.findFirst({
      where: { id: itemId, worksheetId },
      select: { id: true },
    });
    if (!item) throw new NotFoundException('워크시트 항목을 찾을 수 없습니다');
    return this.prisma.labWorksheetItem.delete({ where: { id: itemId } });
  }

  async signWorksheet(worksheetId: string, signerId: string, blockchainSignature?: {
    certificateId: string;
    signatureValue: string;
    signatureAlgorithm: string;
    documentHash: string;
  }) {
    const ws = await this.prisma.labWorksheet.findUnique({ where: { id: worksheetId } });
    if (!ws) throw new NotFoundException('워크시트를 찾을 수 없습니다');
    if (ws.status === 'SIGNED') throw new ConflictException('이미 서명된 워크시트입니다');

    const result = await this.prisma.labWorksheet.update({
      where: { id: worksheetId },
      data: { status: 'SIGNED', signedBy: signerId, signedAt: new Date() },
    });

    // Blockchain signature (non-blocking)
    if (blockchainSignature) {
      try {
        await recordBlockchainSignature(this.prisma, blockchainSignature, {
          documentType: 'LAB_WORKSHEET',
          documentId: worksheetId,
          signerUserId: signerId,
        });
} catch (e) {
        console.error('Blockchain signature failed (non-blocking):', e);
      }
    }

    return result;
  }

  // ── 바코드 ──

  async generateBarcode(orderId: string, patientId: string) {
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const count = await this.prisma.labWorksheetItem.count({
      where: { sampleBarcode: { startsWith: `S${today}` } },
    });
    const barcode = `S${today}-${String(count + 1).padStart(3, '0')}`;

    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { prescription: { include: { procedureCode: { select: { nameKo: true, code: true } } } } },
    });
    const patient = await this.prisma.patient.findUnique({
      where: { id: patientId },
      select: { familyName: true, givenName: true, mrn: true },
    });

    return {
      barcode,
      orderId,
      patientId,
      patientName: patient ? `${patient.familyName}${patient.givenName}` : '',
      mrn: patient?.mrn ?? '',
      testName: order?.prescription?.procedureCode?.nameKo ?? '',
      testCode: order?.prescription?.procedureCode?.code ?? '',
    };
  }

  async scanBarcode(barcode: string) {
    // 워크시트 항목에서 바코드 검색
    const item = await this.prisma.labWorksheetItem.findFirst({
      where: { sampleBarcode: barcode },
    });

    // 오더에서 검색 (수신 결과 매칭)
    const interfaceResult = await this.prisma.labInterfaceResult.findFirst({
      where: { sampleBarcode: barcode },
      include: { instrument: { select: { name: true } } },
    });

    // 바코드 패턴으로 오더 검색 (직접 매칭)
    const pendingOrders = await this.prisma.order.findMany({
      where: { department: 'LAB', status: { in: ['ORDERED', 'RECEIVED', 'IN_PROGRESS'] } },
      include: {
        prescription: {
          include: {
            procedureCode: { select: { nameKo: true } },
            encounter: { select: { patient: { select: { familyName: true, givenName: true, mrn: true, id: true } } } },
          },
        },
      },
      take: 5,
    });

    return {
      barcode,
      worksheetItem: item,
      interfaceResult,
      suggestedOrders: pendingOrders.map(o => ({
        orderId: o.id,
        patientName: `${o.prescription?.encounter?.patient?.familyName ?? ''}${o.prescription?.encounter?.patient?.givenName ?? ''}`,
        mrn: o.prescription?.encounter?.patient?.mrn ?? '',
        testName: o.prescription?.procedureCode?.nameKo ?? '',
        status: o.status,
      })),
    };
  }

  // ── 위탁검사 (Send-Out) ──

  async getReferenceLabs() {
    return this.prisma.referenceLab.findMany({
      where: { isActive: true },
      include: { _count: { select: { catalog: true, sendOuts: true } } },
      orderBy: { name: 'asc' },
    });
  }

  async createReferenceLab(data: { name: string; code: string; contactInfo?: Record<string, unknown>; apiEndpoint?: string }) {
    return this.prisma.referenceLab.create({
      data: { ...data, contactInfo: data.contactInfo as unknown as Prisma.InputJsonValue },
    });
  }

  async getRefLabCatalog(referenceLabId: string) {
    return this.prisma.labSendOutCatalog.findMany({
      where: { referenceLabId },
      orderBy: { testName: 'asc' },
    });
  }

  async createCatalogItem(data: {
    referenceLabId: string; testCode: string; testName: string;
    turnaroundDays: number; price?: number; sampleType?: string; sampleVolume?: string; category?: string;
  }) {
    return this.prisma.labSendOutCatalog.create({ data: { ...data, price: data.price != null ? data.price : undefined } });
  }

  async getSendOuts(params?: { status?: string; referenceLabId?: string; patientId?: string }) {
    const where: Prisma.LabSendOutWhereInput = {};
    if (params?.status) where.status = params.status;
    if (params?.referenceLabId) where.referenceLabId = params.referenceLabId;
    if (params?.patientId) where.patientId = params.patientId;
    return this.prisma.labSendOut.findMany({
      where,
      include: {
        referenceLab: { select: { name: true, code: true } },
        patient: { select: { familyName: true, givenName: true, mrn: true } },
        requester: { select: { familyName: true, givenName: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  async createSendOut(data: {
    patientId: string; referenceLabId: string; testName: string;
    catalogItemId?: string; sampleType?: string; sampleBarcode?: string;
    clinicalInfo?: string; requestedBy: string; orderId?: string;
  }) {
    // 카탈로그에서 TAT 조회
    let expectedDate: Date | undefined;
    if (data.catalogItemId) {
      const cat = await this.prisma.labSendOutCatalog.findUnique({ where: { id: data.catalogItemId } });
      if (cat) {
        expectedDate = new Date();
        expectedDate.setDate(expectedDate.getDate() + cat.turnaroundDays);
      }
    }

    return this.prisma.labSendOut.create({
      data: {
        ...data,
        expectedDate,
        status: 'ORDERED',
      },
      include: {
        referenceLab: { select: { name: true, code: true } },
        patient: { select: { familyName: true, givenName: true, mrn: true } },
      },
    });
  }

  async updateSendOutStatus(id: string, status: string, extra?: { trackingNumber?: string; resultFileUrl?: string; resultSummary?: string }) {
    const sendOut = await this.prisma.labSendOut.findUnique({ where: { id } });
    if (!sendOut) throw new NotFoundException('위탁검사를 찾을 수 없습니다');

    const data: Prisma.LabSendOutUpdateInput = { status };
    if (status === 'SENT') data.sentAt = new Date();
    if (status === 'RESULT_RECEIVED') data.resultReceivedAt = new Date();
    if (extra?.trackingNumber) data.trackingNumber = extra.trackingNumber;
    if (extra?.resultFileUrl) data.resultFileUrl = extra.resultFileUrl;
    if (extra?.resultSummary) data.resultSummary = extra.resultSummary;

    return this.prisma.labSendOut.update({
      where: { id },
      data,
      include: { referenceLab: { select: { name: true, code: true } }, patient: { select: { familyName: true, givenName: true } } },
    });
  }

  async getSendOutDetail(id: string) {
    const sendOut = await this.prisma.labSendOut.findUnique({
      where: { id },
      include: {
        referenceLab: true,
        patient: { select: { familyName: true, givenName: true, mrn: true, dateOfBirth: true, gender: true } },
        requester: { select: { familyName: true, givenName: true } },
      },
    });
    if (!sendOut) throw new NotFoundException('위탁검사를 찾을 수 없습니다');
    return sendOut;
  }

  // ── 위급검사값(Critical Value) read-back 확인 (IPSG.2) ──

  /**
   * 내 미확인 위급값 목록 — 🔴 담당의 미상(doctorId=null) 경보는 **고아**가 된다.
   *
   * 종전 `where { doctorId: userId }` 는 doctorId 가 NULL 인 경보를 **누구에게도** 보여주지 않았다.
   * 경보 레코드는 `submitResult` 가 `encounter.doctorId ?? null` 로 만들기 때문에(오더에 진료 맥락이
   * 없으면 NULL), 통보 리스너는 `logger.warn` 후 return 하고 목록은 그 행을 영원히 건너뛴다.
   * → 위급값이 기록만 남고 **아무도 보지 못한 채 방치**된다(운영 실측: PENDING 2건 36일째 미확인).
   *
   * 그래서 임상 확인 권한이 있는 직군(DOCTOR·ADMIN)에게는 **담당의 미지정 경보를 함께** 보인다.
   * 목록의 각 건은 `unassigned`/`isMine` 으로 구분되어 화면이 "내 환자"와 "담당의 미지정"을 뒤섞지 않는다.
   * (확인 불가 직군에게까지 띄우면 조치할 수 없는 붉은 배너만 남아 경보 피로가 된다 — 보이는 범위 ≠ 확인 권한.)
   */
  /** 미확인 위급값 목록 한 번에 싣는 최대 건수 — 넘으면 `countPendingCriticalAlerts` 로 총수를 함께 말한다 */
  static readonly PENDING_CRITICAL_LIMIT = 50;

  /**
   * 🔴 (2026-09-30) **상향된(ESCALATED) 경보가 아무에게도 닿지 않았다.** 크론은 허용시간을 넘긴 경보를
   *    ESCALATED 로 표시하는데, 이 목록은 여전히 "담당의 본인 + 담당의 미지정"만 보여줬다 —
   *    담당의가 부재라서 넘긴 경보를 **그 부재한 담당의에게만** 계속 보여준 셈이다. 대리 확인 경로(사유 필수)는
   *    서버에 있었지만, 남의 경보가 화면에 뜨지 않으니 그 경로에 도달할 수 없었다.
   *    → ESCALATED 는 위급값 통보 대상 역할(shared `CRITICAL_VALUE_ACK_ROLES`) **전원**에게 보인다.
   *      원내 알림(푸시)을 새로 만들지는 않는다 — 수신자 라우팅은 승인 게이트다(escalation 서비스 주석).
   */
  private pendingCriticalWhere(doctorId: string, role?: string): Prisma.CriticalValueAlertWhereInput {
    const canAcknowledge = role === 'DOCTOR' || role === 'ADMIN';
    // 🔴 미확인 = PENDING ∪ ESCALATED — 상향 보고된 경보가 목록에서 빠지면 가장 급한 것이 가장 먼저 사라진다
    return canAcknowledge
      ? { status: { in: CRITICAL_ALERT_OPEN_STATUSES }, OR: [{ doctorId }, { doctorId: null }, { status: 'ESCALATED' }] }
      : { status: { in: CRITICAL_ALERT_OPEN_STATUSES }, OR: [{ doctorId }, { status: 'ESCALATED' }] };
  }

  async countPendingCriticalAlerts(doctorId: string, role?: string): Promise<number> {
    return this.prisma.criticalValueAlert.count({ where: this.pendingCriticalWhere(doctorId, role) });
  }

  async getPendingCriticalAlerts(doctorId: string, role?: string) {
    const canAcknowledge = role === 'DOCTOR' || role === 'ADMIN';
    const alerts = await this.prisma.criticalValueAlert.findMany({
      where: this.pendingCriticalWhere(doctorId, role),
      // 🔴 상향(ESCALATED)을 앞에 — 'ESCALATED' < 'PENDING'(사전순). 개수 상한에서 잘릴 때
      //    허용시간을 넘긴 오래된 경보가 먼저 잘리면 안 된다.
      orderBy: [{ status: 'asc' }, { notifiedAt: 'desc' }],
      take: LabService.PENDING_CRITICAL_LIMIT,
    });
    const pids = [...new Set(alerts.map((a) => a.patientId))];
    const patients = pids.length
      ? await this.prisma.patient.findMany({ where: { id: { in: pids } }, select: { id: true, familyName: true, givenName: true, mrn: true } })
      : [];
    const pmap = new Map(patients.map((p) => [p.id, p]));
    // 남의 경보를 보여줄 때는 "누구의 경보인지"를 함께 말한다 — 이름을 모르면 null(지어내지 않는다)
    const otherDoctorIds = [...new Set(alerts.map((a) => a.doctorId).filter((d): d is string => !!d && d !== doctorId))];
    const doctors = otherDoctorIds.length
      ? await this.prisma.user.findMany({ where: { id: { in: otherDoctorIds } }, select: { id: true, familyName: true, givenName: true } })
      : [];
    const dmap = new Map(doctors.map((d) => [d.id, d]));
    return alerts.map((a) => {
      const isMine = a.doctorId === doctorId;
      const unassigned = a.doctorId == null;
      return {
        ...a,
        patient: pmap.get(a.patientId) ?? null,
        unassigned,
        isMine,
        /** 다른 담당의의 경보가 허용시간을 넘겨 상향돼 내 목록에 온 것 — 확인하면 대리 확인(사유 필수) */
        escalatedFromOther: a.status === 'ESCALATED' && !isMine && !unassigned,
        /** 통보 대상 담당의(남의 경보일 때만) */
        assignedDoctor: !isMine && a.doctorId ? (dmap.get(a.doctorId) ?? null) : null,
        /** 이 로그인 역할이 확인(acknowledge) EP 를 부를 수 있는가 — 간호·검사는 보되 확인은 의사·관리자 */
        canAcknowledge,
      };
    });
  }

  /**
   * 복창값 대조 — 수신자가 되읽은 값이 통보값과 같은가.
   * 숫자로 읽히면 숫자로(선행 0·`+`·천단위 콤마·공백 차이는 복창 오류가 아니다),
   * 아니면 대소문자·공백만 무시하고 문자열로 비교한다. 단위는 묻지 않는다(구두 복창은 수치가 핵심).
   */
  private static readBackMatches(spoken: string, notified: string): boolean {
    const norm = (v: string) => v.trim().replace(/,/g, '').replace(/\s+/g, ' ');
    const a = norm(spoken); const b = norm(notified);
    if (!a || !b) return false;
    const na = Number(a); const nb = Number(b);
    if (Number.isFinite(na) && Number.isFinite(nb)) return na === nb;
    return a.toLowerCase() === b.toLowerCase();
  }

  /** 확인 이후 조치 기록(ACTED)을 조치란에 덧붙이는 표식 */
  static readonly ACTION_NOTE_PREFIX = '[조치]';

  /** 대리 확인 사실을 조치란에 남기는 표식 — 화면·검색이 같은 문자열을 본다(정본 1곳). */
  static readonly DELEGATED_ACK_PREFIX = '[대리확인]';

  /**
   * 위급값 확인 (read-back 후 조치 기록) — IPSG.2 / NPSG.02.03.01
   *
   * 🔴 두 가지를 실체화한다.
   *
   * ① **복창은 기본값이 아니다.** 종전 `data.readBack ?? true` 는 본문이 비어도 "복창 확인함"을
   *    법정기록에 적었고, 화면은 체크박스 없이 늘 `true` 를 보냈다 — 즉 아무도 복창하지 않았다.
   *    지금은 `readBack` 이 필수이고, `true` 는 **주장이 아니라 검증 대상**이다:
   *    수신자가 되읽은 값(`readBackValue`)이 통보값과 일치해야 `readBackConfirmed=true` 가 된다.
   *    불일치는 400 으로 되돌린다 — 복창이 틀렸다는 것은 통보가 잘못 전달됐다는 뜻이고,
   *    그때 확인 처리하면 잘못 들은 값으로 조치가 나간다.
   *    `readBack=false`(구두 통화 없이 화면에서 인지)도 정당한 경로이며 그대로 `false` 로 남는다 —
   *    그래야 `lab.readBackMissing` 지표가 0 일 때 그 0 이 진짜 0 이 된다.
   *
   * ② **확인 권한.** 종전엔 `@Roles(DOCTOR, ADMIN)` 만 있어 **아무 의사나 남의 환자 위급값을 종결**했다.
   *    그렇다고 담당의 본인만 허용하면 부재·비번·당직 교대 시 위급값이 방치된다(막는 것도 안전하지 않다).
   *    → **본인 확인은 그대로, 그 외에는 "대리 확인"으로 열되 사유를 필수**로 하고 그 사실을 기록에 남긴다.
   *      · `acknowledgedBy` 는 이미 실제 확인자를 담고 `doctorId` 는 통보 대상 담당의를 유지하므로,
   *        두 값이 다르면 대리 확인이라는 사실 자체가 레코드에서 기계적으로 드러난다(덮어쓰지 않는다).
   *      · 사유는 조치란 머리에 `[대리확인] …` 로 남긴다.
   *        🔴 남길 것: 전용 컬럼(`ackDelegationReason`)이 옳다 — schema 수정 금지 범위라 보고로 넘긴다.
   *      · 담당의 미지정(doctorId=NULL) 경보는 대리가 아니라 **원래 주인이 없는 것**이라 사유를 묻지 않는다.
   */
  async acknowledgeCriticalAlert(
    id: string,
    userId: string,
    data: { responseAction?: string; readBack: boolean; readBackValue?: string; delegationReason?: string },
  ) {
    const alert = await this.prisma.criticalValueAlert.findUnique({ where: { id } });
    if (!alert) throw new NotFoundException('위급값 알림을 찾을 수 없습니다');
    // 이미 확인된 경보(이후 조치·종결 포함)는 종전처럼 그대로 돌려준다 — 이중 클릭이 오류가 되지 않게(확인 사실은 하나)
    if ((CRITICAL_ALERT_ACKNOWLEDGED_STATUSES as string[]).includes(alert.status)) return alert;
    if (!canTransitionCriticalAlert(alert.status, 'ACKNOWLEDGED')) {
      throw new BadRequestException('확인할 수 없는 상태의 위급값 경보입니다');
    }

    // ② 확인 권한 — 본인 / 담당의 미지정 / 대리(사유 필수)
    const isMine = alert.doctorId != null && alert.doctorId === userId;
    const isUnassigned = alert.doctorId == null;
    const reason = data.delegationReason?.trim() ?? '';
    if (!isMine && !isUnassigned && reason.length < 5) {
      throw new ForbiddenException(
        '담당의 본인이 아닙니다. 대리 확인은 사유(당직·부재 등, 5자 이상)를 함께 기록해야 합니다',
      );
    }

    // ① 복창 검증 — true 는 검증을 통과해야만 true 로 기록된다
    let readBackConfirmed = false;
    if (data.readBack === true) {
      const spoken = data.readBackValue?.trim() ?? '';
      if (!spoken) throw new BadRequestException('복창(read-back) 확인은 되읽은 값이 필요합니다');
      if (!LabService.readBackMatches(spoken, alert.value)) {
        throw new BadRequestException(
          `복창값이 통보값과 다릅니다(통보 ${alert.value}${alert.unit}). 통보자와 값을 다시 확인하세요`,
        );
      }
      readBackConfirmed = true;
    }

    const notes = [
      !isMine && !isUnassigned ? `${LabService.DELEGATED_ACK_PREFIX} ${reason}` : null,
      isUnassigned && !isMine ? '[담당의 미지정 경보 확인]' : null,
      data.responseAction?.trim() || null,
    ].filter(Boolean);

    return this.prisma.criticalValueAlert.update({
      where: { id },
      data: {
        status: 'ACKNOWLEDGED',
        acknowledgedBy: userId,
        acknowledgedAt: new Date(),
        readBackConfirmed,
        responseAction: notes.length ? notes.join('\n') : undefined,
      },
    });
  }

  /**
   * 확인 이후 단계 목록 — 확인은 됐지만 조치 기록(ACTED)·종결(CLOSED)이 남은 경보.
   * 🔴 워크리스트가 없으면 "확인했다"에서 루프가 멈춘 채 아무도 모른다(판정 규칙 §9 워크리스트).
   */
  async getCriticalAlertFollowUps(limit = 50) {
    const alerts = await this.prisma.criticalValueAlert.findMany({
      where: { status: { in: ['ACKNOWLEDGED', 'ACTED'] } },
      orderBy: { acknowledgedAt: 'asc' },
      take: Math.min(Math.max(limit, 1), 200),
    });
    const pids = [...new Set(alerts.map((a) => a.patientId))];
    const patients = pids.length
      ? await this.prisma.patient.findMany({ where: { id: { in: pids } }, select: { id: true, familyName: true, givenName: true, mrn: true } })
      : [];
    const pmap = new Map(patients.map((p) => [p.id, p]));
    return alerts.map((a) => ({ ...a, patient: pmap.get(a.patientId) ?? null }));
  }

  /**
   * 상태 전이 공통 — 전이표에 없으면 400, 동시에 다른 사람이 먼저 바꿨으면 409.
   * `updateMany` 의 where 에 **현재 상태를 함께 건다** — 읽고 쓰는 사이에 바뀐 상태를 덮어쓰지 않는다.
   */
  private async transitionCriticalAlert(
    id: string,
    to: CriticalAlertStatus,
    data: Prisma.CriticalValueAlertUpdateManyMutationInput,
  ) {
    const alert = await this.prisma.criticalValueAlert.findUnique({ where: { id } });
    if (!alert) throw new NotFoundException('위급값 알림을 찾을 수 없습니다');
    if (!canTransitionCriticalAlert(alert.status, to)) {
      throw new BadRequestException('현재 상태에서는 이 단계로 진행할 수 없습니다(확인 → 조치 기록 → 종결 순서)');
    }
    const res = await this.prisma.criticalValueAlert.updateMany({ where: { id, status: alert.status }, data: { ...data, status: to } });
    if (res.count !== 1) throw new ConflictException('다른 사용자가 먼저 상태를 바꿨습니다 — 새로고침 후 다시 확인하세요');
    return this.prisma.criticalValueAlert.findUnique({ where: { id } });
  }

  /** ACKNOWLEDGED → ACTED — 확인 이후 실제 조치 기록(조치 내용 필수). 기존 조치란 뒤에 덧붙이고 덮어쓰지 않는다. */
  async recordCriticalAlertAction(id: string, userId: string, data: { action: string }) {
    const action = data.action?.trim() ?? '';
    if (!action) throw new BadRequestException('조치 내용이 필요합니다');
    const current = await this.prisma.criticalValueAlert.findUnique({ where: { id }, select: { responseAction: true } });
    const merged = [current?.responseAction?.trim() || null, `${LabService.ACTION_NOTE_PREFIX} ${action}`].filter(Boolean).join('\n');
    return this.transitionCriticalAlert(id, 'ACTED', { actedBy: userId, actedAt: new Date(), responseAction: merged });
  }

  /** ACTED → CLOSED — 조치가 기록된 경보만 종결한다(조치 없는 종결은 루프를 닫은 것이 아니다). */
  async closeCriticalAlert(id: string, userId: string) {
    return this.transitionCriticalAlert(id, 'CLOSED', { closedBy: userId, closedAt: new Date() });
  }
}
