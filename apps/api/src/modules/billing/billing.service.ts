import { JourneyService } from '../journey/journey.service';
import { billingOutstanding, ALL_CONSULTATION_FEE_CODES, REFUND_LEDGER_METHOD, receiptClassOf, roundBy } from '@hospital-run/shared';
import { consultationCodeFor } from './consultation-code';
import { TierPriceService } from './tier-price.service';
import { USABLE_ELIGIBILITY_WHERE, isUsableEligibility } from '../eligibility/eligibility.service';
import { Injectable, Logger, NotFoundException, BadRequestException, HttpStatus, Optional } from '@nestjs/common';
import { dateOnlyValue, dayRange, localDateKey, todayDateOnly } from '../../common/day-range';
import { ageOf, type StayPriceBasis } from '@hospital-run/shared';
import { createHash } from 'crypto';
import { Cron, CronExpression } from '@nestjs/schedule';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { BillingStatus, InsuranceType, Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { CacheService } from '../../infrastructure/redis/cache.service';
import { DomainException } from '../../common/errors/domain.exception';
import * as E from '../../common/errors/domain-error-codes';
import { MedicalAiService } from '../medical-ai/medical-ai.service';
import { IntegrationOutboxService } from '../integration/integration-outbox.service';
import { ConfigRuntimeService } from '../config/config-runtime.service';
import { copayCapState, applyCopayCap } from './copay-cap';
import { EligibilityService } from '../eligibility/eligibility.service';
import { DocumentService } from '../document/document.service';
import { VoucherService } from '../voucher/voucher.service';
import { publicBaseUrl } from '../../common/util/public-url';
// 🔴 '미수납' 집합의 정본은 하나다 — /journey-console·/executive 가 쓰는 그 상수를 그대로 부른다.
//    여기서 새 계산식을 만들면 같은 라벨이 화면마다 다른 수를 말하게 된다(P12).
import { UNPAID_STATUS } from '../journey-console/flow-canon';
import { paymentEventsInRange } from './payment-events';
import { promptList } from '../medical-ai/ai-grounding';
import { firstPatientPushResult } from '../notification/patient-push.contract';
import { isReducedCopay } from '../eligibility/eligibility.service';
import { decryptLegacyPid } from '../../common/crypto/legacy-pid-crypto';
import { assertEnumParam } from '../../common/enum-param';
import { DriftRecorderService } from '../../sentinel/drift-recorder.service';

/**
 * 🔴 W8 R3 C3 — 여기 있던 정적표 `COPAY_RATES: Record<InsuranceType, number>` 는 **삭제**됐다.
 *
 * 무엇이 잘못이었나: 수납 계산기(`calculateBilling`)가 이 표를 직접 읽어 보험유형만으로 요율을 정했다.
 * 자격조회(copayCategory)를 보지 않으므로
 *   · 의료급여 2종 외래 15% → 0%   · 차상위 14% → 0%
 *   · 산정특례 10% → 30%           · 자격상실(EXPIRED/NOT_FOUND) 100% → 30%/0%
 * 로 어긋났고, 실청구(createFromEncounter)와 **같은 환자·같은 진료에서 다른 금액**을 말했다(P12 정본이 둘).
 * 이 저장소에는 이미 telehealth `copayRate=0.3` 하드코딩 과다청구 사고 이력이 있고 이것이 두 번째였다.
 *
 * 정본은 `EligibilityService.resolveCopayRate`(자격 우선·보험유형 폴백) **하나**다.
 * 계산기·실청구 모두 그 함수를 통해 요율을 얻는다. 새 요율표를 이 파일에 다시 만들지 말 것.
 */


// ERP 진료라인 인터페이스(D-6). coverage 는 원 enum 그대로 송신(ERP가 매핑 책임, response2 ①).
// HIS codeType → ERP codeType(TARIFF|DRUG|MATERIAL)
function erpCodeType(hisCodeType: string): string {
  if (hisCodeType === 'MEDICATION') return 'DRUG';
  if (hisCodeType === 'MATERIAL') return 'MATERIAL';
  return 'TARIFF'; // PROCEDURE/LAB/IMAGING/INJECTION/ANESTHESIA/... = 수가
}

// BillingItem.codeType(저장된 법정 카테고리) → ERP 급여 분류(itemCategory).
// 백필/전체청구(buildLines)는 원 rx.type이 없으므로 저장 codeType 기준으로 매핑(webhook accrual과 동일 enum 산출).
function erpItemCategoryFromCodeType(codeType: string): string {
  switch (codeType) {
    case 'MEDICATION':
    case 'INJECTION': return 'MEDICATION';   // 투약·주사(약제 투여)
    case 'LAB': return 'EXAMINATION';         // 검사
    case 'IMAGING': return 'IMAGING';         // 영상
    case 'PHYSICAL_THERAPY':
    case 'PSYCHIATRIC_THERAPY':
    case 'ANESTHESIA':
    case 'BLOOD':
    case 'PROCEDURE': return 'TREATMENT';     // 처치·수술·마취·요법·수혈
    case 'ADMISSION': return 'PROCEDURE';     // 입원료·관리료
    default: return 'ETC';                    // MATERIAL·CONSULTATION·기타
  }
}

// 청구 라인(BillingItem) 빌드 중간표현 — createFromEncounter·recalcFromEncounter 공용.
interface BillingLineItem {
  codeType: string;
  codeId: string;
  codeName: string;
  quantity: number;
  unitPrice: number;
  amount: number;
  copayRate: number;
  fullCopay: boolean; // 급여 100/100 전액본인부담 마킹(법정 영수증 일부/전액 분리)
  insuranceCategory: string; // COVERED | NON_COVERED — HIRA 비급여 보고·비급여 내역서·ERP coverage·EDI 급여구분 소스
  sourcePrescriptionId?: string; // 발생-정산 ref 정합(progressive billing)
}

// HIS 처방 type → ERP 급여 분류(itemCategory). 미상은 ETC(ERP 폴백).
function erpItemCategory(rxType: string, isMed: boolean): string {
  if (isMed) return 'MEDICATION';            // 투약
  switch (rxType) {
    case 'LAB': return 'EXAMINATION';        // 검사
    case 'IMAGING': return 'IMAGING';        // 영상
    case 'THERAPY': return 'TREATMENT';      // 처치
    case 'NURSING': return 'NURSING';        // 처치/간호
    case 'ACTIVITY': return 'PROCEDURE';     // 행위(입원료·관리료 포함)
    default: return 'ETC';
  }
}

/** 분납을 만들고 회차를 받을 수 있는 수납 상태(P1-2) — 닫힌 상태(PAID·CANCELLED·REFUNDED)는 아니다 */
const INSTALLMENT_OPEN_STATUSES: BillingStatus[] = ['PENDING', 'PARTIAL', 'DEFERRED'];

/** 입원료 본인부담 — 퇴원 입원료 청구와 중간정산이 같은 반올림을 쓴다(2026-10-22 · 한 곳) */
export const stayCopayOf = (amount: number, rate: number) => Math.round(amount * rate);

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly medicalAi: MedicalAiService,
    private readonly outbox: IntegrationOutboxService,
    private readonly configRuntime: ConfigRuntimeService,
    private readonly eligibility: EligibilityService,
    private readonly document: DocumentService,
    private readonly voucherService: VoucherService,
    @Optional() private readonly cache?: CacheService,
    @Optional() private readonly drift?: DriftRecorderService,
    // 환자 앱 "수납 대기" 푸시 발행용. @Optional — 미주입 환경(단위 테스트)에서는 발행하지 않고
    // 결과가 `NO_LISTENER` 가 된다(아무 일도 안 일어난 것을 성공으로 접지 않는다).
    @Optional() private readonly events?: EventEmitter2,
    /** 여정 정본 발행기(2026-10-01 P0-6 — 직접 쓰기 이관) */
    @Optional() private readonly journey?: JourneyService,
    /** 청구 단가 = 고시 종별 단가(종별 명시 설정 때만 · 2026-10-20) — 미주입이면 종전대로 수가 마스터 */
    @Optional() private readonly tierPrice?: TierPriceService,
  ) {}

  /** 수가 마스터 행 단가를 설정 종별의 고시 단가로(제자리) — 종별 미설정·미주입이면 그대로 */
  private async applyTierPrices(rows: ({ code: string; unitPrice: number | null } | null | undefined)[]): Promise<void> {
    if (this.tierPrice) await this.tierPrice.apply(rows);
  }

  /**
   * 본인부담률 해소 — 우선순위: 자격조회(copayCategory, config 기반) > 정적 COPAY_RATES(폴백).
   * 자격상실(EXPIRED)·미발견(NOT_FOUND) = 전액 본인부담. ERP 동봉용 자격 컨텍스트도 함께 반환.
   */
  private async resolveCopay(
    patientId: string,
    insuranceType: InsuranceType,
    visitType: 'OUTPATIENT' | 'INPATIENT',
    encounterId?: string,
  ): Promise<{ rate: number; copayCategory: string; medicalAidClass: string | null; specialCaseType: string | null; eligibilityStatus: string | null; eligibilityCheckId: string | null }> {
    // 자격 스냅샷 일관성: encounter에 고정된 자격이 있으면 그것을, 없으면 최신을 쓰되 encounter에 고정(이후 라인 동일).
    let elig = null as Awaited<ReturnType<typeof this.prisma.eligibilityCheck.findFirst>> | null;
    if (encounterId) {
      // 🔴 자격 조회 실패를 "자격 없음"으로 번역하지 않는다(위 eligibility.service 와 같은 이유 —
      //    실패가 30% 폴백이 되어 산정특례·차상위가 과다청구된다). 기록 부재(null)만 폴백으로 간다.
      const enc = await this.prisma.encounter.findUnique({ where: { id: encounterId }, select: { eligibilityCheckId: true } });
      if (enc?.eligibilityCheckId) {
        elig = await this.prisma.eligibilityCheck.findUnique({ where: { id: enc.eligibilityCheckId } });
        if (elig && !isUsableEligibility(elig)) elig = null; // (P1-4) 조회 실패 기록은 자격이 아니다
      }
      if (!elig) {
        elig = await this.prisma.eligibilityCheck.findFirst({ where: { patientId, ...USABLE_ELIGIBILITY_WHERE }, orderBy: { queriedAt: 'desc' } });
        // 스냅샷 고정은 best-effort(실패해도 청구는 진행) — 다만 실패를 자격 판정에 섞지 않는다.
        if (elig) await this.prisma.encounter.update({ where: { id: encounterId }, data: { eligibilityCheckId: elig.id } }).catch(() => undefined);
      }
    } else {
      elig = await this.prisma.eligibilityCheck.findFirst({ where: { patientId, ...USABLE_ELIGIBILITY_WHERE }, orderBy: { queriedAt: 'desc' } });
    }
    if (!elig) {
      // 🔴 C3 — 정적표를 직접 읽지 않는다. 자격 부재 폴백도 정본(resolveCopayRate) 한 곳에서만 나온다.
      const fb = await this.eligibility.resolveCopayRate(patientId, insuranceType, visitType, encounterId);
      return { rate: fb.rate, copayCategory: fb.copayCategory, medicalAidClass: null, specialCaseType: null, eligibilityStatus: null, eligibilityCheckId: null };
    }
    if (elig.status === 'EXPIRED' || elig.status === 'NOT_FOUND') {
      return { rate: 1.0, copayCategory: elig.copayCategory, medicalAidClass: null, specialCaseType: null, eligibilityStatus: elig.status, eligibilityCheckId: elig.id };
    }
    const rate = await this.eligibility.copayRateFor(elig.copayCategory, visitType);
    const medicalAidClass = elig.copayCategory === 'MA_TYPE1' ? '1' : elig.copayCategory === 'MA_TYPE2' ? '2' : null;
    return { rate, copayCategory: elig.copayCategory, medicalAidClass, specialCaseType: elig.specialExemption ?? null, eligibilityStatus: elig.status, eligibilityCheckId: elig.id };
  }

  /**
   * ERP 진료비 계산결과 조회(D-6 요청2, B안 pull) — HIS 수납 화면용.
   * HIS가 ERP invoice API를 프록시 조회(연동키 서버측 보관). ERP 미가동 시 graceful.
   */
  async getErpInvoice(params: { encounterId?: string; chartNo?: string; interim?: boolean }) {
    const base = (await this.configRuntime.get('erp.webhookUrl')) as string;
    const key = (await this.configRuntime.get('erp.integrationKey')) as string;
    if (!base) return { available: false, reason: 'ERP_NOT_CONFIGURED' };
    const qs = new URLSearchParams();
    if (params.encounterId) qs.set('encounterId', params.encounterId);
    if (params.chartNo) qs.set('chartNo', params.chartNo);
    if (params.interim) qs.set('interim', 'true');
    const url = `${base.replace(/\/$/, '')}/api/v1/integration/billing/invoice?${qs.toString()}`;
    try {
      const res = await fetch(url, { headers: { 'X-Integration-Key': key ?? '' }, signal: AbortSignal.timeout(5000) });
      if (!res.ok) return { available: false, reason: `ERP_${res.status}` };
      const raw = (await res.json()) as Record<string, unknown>;
      if (raw.available === false) return { available: false, reason: (raw.reason as string) ?? 'NO_LINES' };
      // ERP 응답은 snake_case → 수납 화면용 camelCase 매핑
      // 🔴 관측점(axis C): 200 인데 금액 키가 전부 없으면 계약이 어긋난 것 — 수납 화면이 금액 없는 청구서를 본다
      if (raw.total === undefined && raw.balance_due === undefined && raw.patient_share === undefined) {
        this.drift?.record({
          kind: 'KEY_MISSING',
          producer: 'erp.billing-invoice',
          consumer: 'billing.getErpInvoice',
          detail: `응답에 금액 키(total/balance_due/patient_share)가 없음 · 실제 키: ${Object.keys(raw).join(', ').slice(0, 300)}`,
        });
      }
      const pr = (raw.pre_review ?? {}) as Record<string, unknown>;
      return {
        available: true,
        invoice: {
          chartNo: raw.chart_no, asOf: raw.as_of,
          total: raw.total, insurerShare: raw.insurer_share, patientShare: raw.patient_share,
          nonCovered: raw.non_covered, prepaid: raw.prepaid, balanceDue: raw.balance_due,
          preReview: { blocked: pr.blocked ?? false, findings: pr.findings ?? [] },
          lines: raw.lines,
        },
      };
    } catch {
      return { available: false, reason: 'ERP_UNREACHABLE' };
    }
  }

  /** AI EDI 수가코드 자동 매핑 제안 */
  async suggestEdiCodes(encounterId: string) {
    const encounter = await this.prisma.encounter.findUnique({
      where: { id: encounterId },
      include: { diagnoses: { include: { diagnosisCode: true } } },
    });
    if (!encounter) throw new NotFoundException('진료 기록을 찾을 수 없습니다');

    try {
      // 🔴 종전에는 진단 1건의 조회 실패가 `.catch(() => null)` 로 접혀 목록에서 사라지고,
      //    응답은 여전히 `source:'AI'` 였다 — **"이 진단에는 제안이 없다"와 "물어보지 못했다"가
      //    구분되지 않았다.** 실패한 진단을 따로 실어 보내고 출처를 3상태로 말한다.
      const per = await Promise.all(
        encounter.diagnoses.map(async (d) => {
          const name = d.diagnosisCode?.nameKo ?? d.diagnosisCode?.code ?? '';
          if (!name) return null;
          try {
            const result = await this.medicalAi.searchEdi(name);
            return result ? { diagnosis: name, ediSuggestions: result } : null; // 조회는 됐고 매칭이 없다
          } catch (e) {
            this.logger.warn(`AI EDI 매핑 실패(${name}): ${e}`);
            return { diagnosis: name, failed: true as const };
          }
        }),
      );
      const asked = per.filter((x): x is NonNullable<typeof x> => x != null);
      const unavailable = asked.filter((x) => 'failed' in x).map((x) => x.diagnosis);
      const suggestions = asked.filter((x): x is { diagnosis: string; ediSuggestions: unknown } => !('failed' in x));
      const source = unavailable.length === 0 ? 'AI' : suggestions.length ? 'PARTIAL' : 'UNAVAILABLE';
      return { encounterId, patientId: encounter.patientId, suggestions, unavailable, askedCount: asked.length, source };
    } catch (e) {
      this.logger.warn(`AI EDI 매핑 실패: ${e}`);
      return { encounterId, patientId: encounter.patientId, suggestions: [], unavailable: [], askedCount: 0, source: 'FALLBACK' };
    }
  }

  /**
   * 수납 생성 (진료 완료 후 자동 금액 산정)
   */
  /** AI 청구 오류 사전 감지 — 거절 가능성 예측 */
  async detectBillingAnomaly(encounterId: string) {
    const encounter = await this.prisma.encounter.findUnique({
      where: { id: encounterId },
      include: {
        diagnoses: { include: { diagnosisCode: true } },
        prescriptions: { include: { medicationCode: true } },
        billing: true,
      },
    });
    if (!encounter) throw new NotFoundException('진료 기록을 찾을 수 없습니다');
    try {
      const diagNames = encounter.diagnoses.map(d => d.diagnosisCode?.nameKo ?? d.diagnosisCode?.code).filter(Boolean);
      const rxNames = encounter.prescriptions.map(p => p.medicationCode?.nameKo).filter(Boolean);
      const result = await this.medicalAi.clinicalQa({
        question: `다음 진료 기록의 청구 오류 가능성을 분석해주세요. 진단-처방 불일치, 과잉청구, 누락 항목이 있는지 확인하세요.\n\n진단: ${promptList(diagNames)}\n처방: ${promptList(rxNames)}\n수납금액: ${encounter.billing?.totalAmount ?? '미산정'}원`,
      });
      return { encounterId, patientId: encounter.patientId, analysis: result, source: 'AI' };
    } catch (e) {
      this.logger.warn(`AI 청구 오류 감지 실패: ${e}`);
      return { encounterId, patientId: encounter.patientId, analysis: null, source: 'FALLBACK' };
    }
  }

  /**
   * 처방 1건 → 청구 라인(BillingLineItem) 매핑. createFromEncounter·recalcFromEncounter 공용(로직 분기 방지).
   * 약(MEDICATION+medicationCode)·행위(procedureCode)만 청구 라인화, 그 외 null.
   */
  private buildPrescriptionLineItem(
    rx: {
      id: string;
      type: string;
      medicationCodeId: string | null;
      procedureCodeId: string | null;
      quantity: number | null;
      medicationCode?: { nameKo: string; unitPrice: number | null; insuranceCode?: string | null } | null;
      procedureCode?: { nameKo: string; unitPrice: number | null; copayRate: Prisma.Decimal | null; insuranceCovered?: boolean } | null;
    },
    copayRate: number,
    /**
     * 🔴 자격 구분 — **감면 자격이면 코드별 특례율을 쓰지 않는다.**
     *    없으면(undefined) 종전대로 코드 특례가 우선한다(일반 건보 가정).
     */
    copayCategory?: string | null,
  ): BillingLineItem | null {
    if (rx.type === 'MEDICATION' && rx.medicationCode) {
      const unitPrice = rx.medicationCode.unitPrice ?? 0;
      const quantity = rx.quantity ?? 1;
      // 약: 보험 제품코드(insuranceCode) 등재 여부 = 급여 등재약 대리 신호
      const isCovered = !!rx.medicationCode.insuranceCode;
      // 🔴 §2 봉합: 비급여는 전액 본인부담(copayRate=1) — 종전 eligibility 율 유지로 보험 과다청구되던 것 차단
      const effCopayRate = isCovered ? copayRate : 1;
      return {
        codeType: 'MEDICATION',
        codeId: rx.medicationCodeId!,
        codeName: rx.medicationCode.nameKo,
        quantity,
        unitPrice,
        amount: unitPrice * quantity,
        copayRate: effCopayRate,
        fullCopay: effCopayRate >= 1,
        insuranceCategory: isCovered ? 'COVERED' : 'NON_COVERED',
        sourcePrescriptionId: rx.id,
      };
    }
    if (rx.procedureCode) {
      const unitPrice = rx.procedureCode.unitPrice ?? 0;
      // 🔴 §2 봉합: 비급여(insuranceCovered=false)는 전액 본인부담. 급여는 마스터 copayRate 우선·eligibility 폴백
      const isNonCovered = rx.procedureCode.insuranceCovered === false;
      /**
       * 🔴 우선순위: **비급여(전액) > 감면 자격 > 코드별 특례 > 자격 기본율**
       *
       *    종전에는 코드 오버라이드가 자격을 **무조건** 이겼다. 그 결과 운영 시드에서
       *    산정특례 3건이 10%가 아닌 **30%**, 차상위 1건이 14%가 아닌 **30%** 로 청구됐다.
       *    산재·보훈·자보(본인부담 0)에 그 코드가 쓰였으면 0원이어야 할 것이 청구됐을 것이다.
       *    🔴 수치 비교(낮은 쪽)로 풀지 않는다 — 일반 건보에는 MRI 80% 같은 고시 특례가
       *       이겨야 하고, 낮은 쪽을 고르면 그쪽이 30%로 깎여 또 틀린다. **자격의 성격**으로 가른다.
       */
      const codeRate = rx.procedureCode.copayRate ? Number(rx.procedureCode.copayRate) : null;
      const itemCopayRate = isNonCovered
        ? 1
        : isReducedCopay(copayCategory) || codeRate === null
          ? copayRate
          : codeRate;
      // 처방 타입을 법정 13개 카테고리에 매핑
      const typeMap: Record<string, string> = {
        'LAB': 'LAB', 'IMAGING': 'IMAGING',
        'THERAPY': 'PROCEDURE', 'SURGERY': 'PROCEDURE', 'PROCEDURE': 'PROCEDURE',
        'INJECTION': 'INJECTION', 'ANESTHESIA': 'ANESTHESIA',
        'PHYSICAL_THERAPY': 'PHYSICAL_THERAPY', 'REHAB': 'PHYSICAL_THERAPY',
        'PSYCHIATRIC_THERAPY': 'PSYCHIATRIC_THERAPY',
        'BLOOD': 'BLOOD', 'TRANSFUSION': 'BLOOD',
        'ADMISSION': 'ADMISSION', 'MATERIAL': 'MATERIAL',
      };
      return {
        codeType: typeMap[rx.type] ?? 'PROCEDURE',
        codeId: rx.procedureCodeId!,
        codeName: rx.procedureCode.nameKo,
        quantity: 1,
        unitPrice,
        amount: unitPrice,
        copayRate: itemCopayRate,
        fullCopay: itemCopayRate >= 1,
        // 행위: 수가마스터 insuranceCovered가 SoT(전액본인부담 100/100은 급여이므로 fullCopay로만 구분)
        insuranceCategory: isNonCovered ? 'NON_COVERED' : 'COVERED',
        sourcePrescriptionId: rx.id,
      };
    }
    return null;
  }

  /**
   * 본인부담금 산정 — 라인별 율 합산 + 의료급여 외래 정액 본인부담(1·2종, 율 산정이 정액보다 낮으면 정액).
   * createFromEncounter(전체)·recalcFromEncounter(증분 후 전체 재산정) 공용.
   */
  private async computePatientCopay(
    items: { amount: number; copayRate: number }[],
    visitTypeForCopay: 'OUTPATIENT' | 'INPATIENT',
    copayCategory: string,
    totalAmount: number,
    /** 종별 계산기(2026-10-20)가 설정과 다른 종별로 셀 때만 — 비우면 설정 종별 */
    gradeOverride?: string,
  ): Promise<number> {
    let patientCopay = Math.round(items.reduce((sum, i) => sum + Math.round(i.amount * i.copayRate), 0));
    if (visitTypeForCopay === 'OUTPATIENT' && (copayCategory === 'MA_TYPE1' || copayCategory === 'MA_TYPE2') && totalAmount > 0) {
      const grade = String(gradeOverride ?? (await this.configRuntime.get('billing.institution.grade')) ?? 'CLINIC').toLowerCase(); // clinic|hospital|general|tertiary
      let flat = 0;
      if (copayCategory === 'MA_TYPE1') {
        flat = Number((await this.configRuntime.get(`billing.copay.ma1.flat.${grade}`)) ?? 1000);
      } else if (grade === 'clinic') {
        // 2종 의원만 정액, 병원급↑은 율(이미 라인 copayRate 반영)
        flat = Number((await this.configRuntime.get('billing.copay.ma2.flat.clinic')) ?? 1000);
      }
      if (flat > 0) patientCopay = Math.max(patientCopay, Math.min(flat, totalAmount));
    }
    return patientCopay;
  }

  /**
   * 본인부담 — 실청구와 같은 함수를 **지정한 종별로**(종별 계산기 · 2026-10-20). 라인별 율 합산 + 의료급여 외래 정액(종별별).
   * 실청구 경로는 이것을 부르지 않는다(설정 종별 그대로 computePatientCopay).
   */
  async patientCopayForGrade(items: { amount: number; copayRate: number }[], copayCategory: string, totalAmount: number, grade: string): Promise<number> {
    return this.computePatientCopay(items, 'OUTPATIENT', copayCategory, totalAmount, grade);
  }

  /**
   * 정정(AMENDED) 후 추가된 처방의 자동 청구 재계산(백로그 #2). **옵트인** — 리스너가 config
   * `billing.autoRecalcOnAmend` 게이트로 호출. 안전 원칙:
   *  - **PENDING(미납) 청구만** 자동 갱신. 납부 진행(PAID/PARTIAL/…) 청구는 변경 금지 → 수동 검토.
   *  - **추가만**(기존 라인 수정·삭제 안 함). sourcePrescriptionId 멱등 → 미청구 ACTIVE 처방만 라인 추가.
   *  - 재서명 반복돼도 새 라인 없으면 no-op(이중청구 0).
   * ERP 라인은 신규 처방분만 emitAccrualLine(ref bline:enc:rx:id·ERP 멱등 upsert).
   */
  /**
   * 진료 외 비급여 라인 한 줄을 그 진료의 **미납(PENDING) 수납**에 덧붙인다(2026-10-10 · 서류 발급 수수료 ↔ 수납 연결).
   *  - 멱등: 같은 (codeType, codeId) 라인이 어느 수납에든 이미 있으면 그대로(`ALREADY`).
   *  - 🔴 수납을 **새로 만들지 않는다** — `Billing.encounterId` 유니크라 여기서 만들면 그 진료의 정규 청구 생성이 막힌다.
   *  - 🔴 납부가 진행된 수납(PAID·PARTIAL·…)은 바꾸지 않는다(일어난 수납은 소급하지 않는다 — recalcFromEncounter 와 같은 원칙).
   *  - 합계·본인부담은 전체 라인으로 다시 센다(정본 computePatientCopay).
   */
  async addNonCoveredLine(
    encounterId: string,
    line: { codeType: string; codeId: string; codeName: string; unitPrice: number; quantity: number },
  ): Promise<{ status: 'ADDED' | 'ALREADY' | 'NO_BILLING' | 'BILLING_NOT_OPEN'; billingId: string | null; billingStatus: string | null }> {
    const existing = await this.prisma.billingItem.findFirst({
      where: { codeType: line.codeType, codeId: line.codeId },
      select: { billingId: true, billing: { select: { status: true } } },
    });
    if (existing) return { status: 'ALREADY', billingId: existing.billingId, billingStatus: existing.billing.status };
    const billing = await this.prisma.billing.findUnique({
      where: { encounterId },
      select: { id: true, status: true, copayCategory: true, encounter: { select: { visitType: true } } },
    });
    if (!billing) return { status: 'NO_BILLING', billingId: null, billingStatus: null };
    if (billing.status !== 'PENDING') return { status: 'BILLING_NOT_OPEN', billingId: billing.id, billingStatus: billing.status };
    const amount = line.unitPrice * line.quantity;
    const visitTypeForCopay = billing.encounter?.visitType === 'INPATIENT' ? 'INPATIENT' : 'OUTPATIENT';
    await this.prisma.$transaction(async (tx) => {
      await tx.billingItem.create({
        data: {
          billingId: billing.id, codeType: line.codeType, codeId: line.codeId, codeName: line.codeName.slice(0, 500),
          quantity: line.quantity, unitPrice: line.unitPrice, amount, copayRate: 1, insuranceCategory: 'NON_COVERED',
        },
      });
      const all = await tx.billingItem.findMany({ where: { billingId: billing.id }, select: { amount: true, copayRate: true } });
      const totalAmount = all.reduce((sum, i) => sum + i.amount, 0);
      const patientCopay = await this.computePatientCopay(
        all.map((i) => ({ amount: i.amount, copayRate: Number(i.copayRate) })),
        visitTypeForCopay,
        billing.copayCategory ?? '',
        totalAmount,
      );
      await tx.billing.update({ where: { id: billing.id }, data: { totalAmount, patientCopay, insuranceCovered: totalAmount - patientCopay } });
    });
    return { status: 'ADDED', billingId: billing.id, billingStatus: 'PENDING' };
  }

  async recalcFromEncounter(encounterId: string): Promise<{ status: 'created' | 'recalculated' | 'skipped'; addedLines?: number; reason?: string }> {
    const billing = await this.prisma.billing.findUnique({
      where: { encounterId },
      include: { items: { select: { sourcePrescriptionId: true } } },
    });
    if (!billing) {
      // 청구 자체가 아직 없으면 정규 생성 경로
      await this.createFromEncounter(encounterId);
      return { status: 'created' };
    }
    if (billing.status !== 'PENDING') {
      return { status: 'skipped', reason: `청구 상태 ${billing.status}(납부 진행) — 자동 변경 불가, 수동 검토` };
    }

    const billedRx = new Set(
      billing.items.map((i) => i.sourcePrescriptionId).filter((x): x is string => !!x),
    );
    const encounter = await this.prisma.encounter.findUnique({
      where: { id: encounterId },
      include: {
        patient: { select: { id: true, insuranceType: true } },
        prescriptions: {
          where: { status: 'ACTIVE' },
          include: {
            medicationCode: { select: { code: true, nameKo: true, unitPrice: true, insuranceCode: true } },
            procedureCode: { select: { code: true, nameKo: true, unitPrice: true, copayRate: true, insuranceCovered: true } },
          },
        },
      },
    });
    if (!encounter) throw new NotFoundException('Encounter not found');
    await this.applyTierPrices(encounter.prescriptions.map((rx) => rx.procedureCode)); // 청구 단가 = 고시 종별 단가(종별 명시 설정 때만)

    const newRx = encounter.prescriptions.filter((rx) => !billedRx.has(rx.id));
    if (newRx.length === 0) return { status: 'skipped', reason: '추가 처방 없음' };

    const visitTypeForCopay = encounter.visitType === 'INPATIENT' ? 'INPATIENT' : 'OUTPATIENT';
    const elig = await this.resolveCopay(encounter.patient.id, encounter.patient.insuranceType, visitTypeForCopay, encounterId);
    const newItems = newRx
      .map((rx) => this.buildPrescriptionLineItem(rx, elig.rate, elig.copayCategory))
      .filter((x): x is BillingLineItem => !!x);
    if (newItems.length === 0) return { status: 'skipped', reason: '청구 가능한 신규 라인 없음' };

    await this.prisma.$transaction(async (tx) => {
      await tx.billingItem.createMany({
        data: newItems.map((i) => ({
          billingId: billing.id,
          codeType: i.codeType,
          codeId: i.codeId,
          codeName: i.codeName,
          quantity: i.quantity,
          unitPrice: i.unitPrice,
          amount: i.amount,
          copayRate: i.copayRate,
          fullCopay: i.fullCopay,
          insuranceCategory: i.insuranceCategory,
          sourcePrescriptionId: i.sourcePrescriptionId ?? null,
        })),
      });
      // 증분 후 전체 라인으로 합계·본인부담 재산정(MA 정액 등 전체 기준 정확)
      const all = await tx.billingItem.findMany({ where: { billingId: billing.id }, select: { amount: true, copayRate: true } });
      const totalAmount = all.reduce((sum, i) => sum + i.amount, 0);
      const patientCopay = await this.computePatientCopay(
        all.map((i) => ({ amount: i.amount, copayRate: Number(i.copayRate) })),
        visitTypeForCopay,
        elig.copayCategory,
        totalAmount,
      );
      await tx.billing.update({
        where: { id: billing.id },
        data: { totalAmount, patientCopay, insuranceCovered: totalAmount - patientCopay },
      });
    });

    // ERP 라인: 신규 처방분만 발행(시행 전이라도 정산 정합). ref 멱등이라 시행 accrual과 중복 무해.
    for (const it of newItems) {
      if (it.sourcePrescriptionId) {
        void this.emitAccrualLine(it.sourcePrescriptionId).catch((e) =>
          this.logger.warn(`recalc accrual 실패 rx ${it.sourcePrescriptionId}: ${(e as Error).message}`),
        );
      }
    }
    this.logger.log(`청구 재계산 enc ${encounterId}: +${newItems.length} 라인`);
    return { status: 'recalculated', addedLines: newItems.length };
  }

  /**
   * 청구 검토 대기 큐(백로그 #7 응급청구실패 · #2 정정검토) — 수납/원무 가시화.
   * 저니 이벤트(ER_BILLING_FAILED·BILLING_AMEND_REVIEW)를 최근 N일 통합 조회.
   * 알림 피드(append-only)라 해소 추적은 안 함 — 최근 항목을 수동 보정 신호로 노출.
   */
  /**
   * 청구 검토 대기 큐.
   *
   * 🔴 원 결함(W8 이연·2026-08-14 회수): `take: 50` 으로 **말없이 잘라놓고** `count = items.length`
   *    를 총계라고 내보냈다. 50건을 넘는 순간 화면은 영원히 "50건"이라 말하고, 51번째 미검토 청구는
   *    아무 데도 드러나지 않는다 — **과소 보고**다. W8 규약: **자르면 잘랐다고 말한다.**
   *    총계·분류 집계는 잘리지 않은 전수(count/groupBy)로 세고, 목록만 상한을 둔다.
   */
  private static readonly REVIEW_QUEUE_LIMIT = 50;

  /**
   * 이 큐가 담는 사건의 어휘 정본.
   * 🔴 새 사건을 만들면서 여기에 넣지 않으면 **그 사건은 어느 화면에도 뜨지 않는다**(발행만 하고 끝난다).
   *    라벨도 여기서 나온다 — 종전에는 `kind === 'ER_BILLING_FAILED' ? '응급청구 실패' : '정정 검토'`
   *    라는 **이진 삼항**이라, 세 번째 종류를 추가하는 순간 그것이 '정정 검토'로 표시된다(P10).
   */
  private static readonly REVIEW_QUEUE_KINDS: Record<string, string> = {
    ER_BILLING_FAILED: '응급청구 실패',
    BILLING_AMEND_REVIEW: '정정 검토',
    BILLING_CREATE_FAILED: '청구 생성 실패',
  };

  async getReviewQueue(days = 7) {
    const since = new Date(Date.now() - days * 86400000);
    const where = {
      eventType: { in: Object.keys(BillingService.REVIEW_QUEUE_KINDS) },
      eventAt: { gte: since },
    };
    const limit = BillingService.REVIEW_QUEUE_LIMIT;
    const [events, total, byKind] = await Promise.all([
      this.prisma.patientJourneyEvent.findMany({
        where,
        orderBy: { eventAt: 'desc' },
        take: limit,
        include: { patient: { select: { familyName: true, givenName: true, mrn: true } } },
      }),
      // 🔴 총계는 잘리기 **전** 전수로 센다 — items.length 는 상한값이지 사실이 아니다
      this.prisma.patientJourneyEvent.count({ where }),
      this.prisma.patientJourneyEvent.groupBy({ by: ['eventType'], where, _count: { _all: true } }),
    ]);
    const kindCount = (t: string) => byKind.find((b) => b.eventType === t)?._count._all ?? 0;
    const items = events.map((e) => ({
      id: e.id,
      kind: e.eventType,
      kindLabel: BillingService.REVIEW_QUEUE_KINDS[e.eventType] ?? e.eventType,
      patientName: `${e.patient.familyName ?? ''}${e.patient.givenName ?? ''}`.trim() || '-',
      mrn: e.patient.mrn,
      title: e.title,
      description: e.description,
      at: e.eventAt,
      refType: e.refType,
      refId: e.refId,
    }));
    return {
      data: {
        windowDays: days,
        /** 🔴 창 안의 **전수**(목록 상한과 무관) — 종전엔 items.length(=최대 50)였다 */
        count: total,
        emergencyFailed: kindCount('ER_BILLING_FAILED'),
        amendReview: kindCount('BILLING_AMEND_REVIEW'),
        /** 자동 청구 생성이 3회 재시도 후 실패한 건 — 진료는 끝났는데 청구가 없다 */
        createFailed: kindCount('BILLING_CREATE_FAILED'),
        /** 종류별 전수(새 종류를 추가해도 화면이 스스로 따라온다) */
        byKind: Object.fromEntries(Object.keys(BillingService.REVIEW_QUEUE_KINDS).map((k) => [k, kindCount(k)])),
        /** 목록에 실제로 담긴 건수 */
        returned: items.length,
        limit,
        /** 🔴 true 면 목록이 잘렸다 — 화면은 "N건 중 M건 표시"라고 말해야 한다 */
        truncated: total > items.length,
        items,
      },
    };
  }

  /**
   * 진료 기반 수납(청구) 생성.
   * @param opts.notifyPatient 🔴 환자 앱 "수납 대기" 푸시 명시 옵트인. 원무가 화면에서 체크한 값이다.
   *        `encounter.signed` 자동 경로(billing.listener)는 누를 사람이 없으므로 넘기지 않는다 →
   *        그 경로는 항상 `NOT_REQUESTED`(푸시 없음). 자동 발송으로 바꿀지는 사람 결정이다.
   */
  /**
   * 진찰료 코드·수가 — 초진/재진: 예약 있으면 예약 타입, 없으면(walk-in/응급) 환자의 기존 서명 진료 유무(첫 진료 = 초진).
   * 🔴 (P4-2) 실청구(createFromEncounter)와 수납 화면 계산 패널(calculateBilling)이 같은 판정을 쓴다 —
   *    종전 패널은 늘 재진 AA261·설정값 11,690 이라 정상 청구에도 "N원 차이"를 말했다.
   */
  private async resolveConsultProcedure(patientId: string, encounterId: string | null, appointmentType: string | null) {
    let isInitial: boolean;
    if (appointmentType) {
      isInitial = appointmentType === 'INITIAL';
    } else {
      // encounterId 가 없으면(진료 전 예상 — B6) 지난 서명 진료 전부를 센다
      const priorCount = await this.prisma.encounter.count({
        where: { patientId, ...(encounterId ? { id: { not: encounterId } } : {}), status: { in: ['SIGNED', 'AMENDED'] } },
      });
      isInitial = priorCount === 0;
    }
    // 🔴 (2026-10-20) 종별 정본을 따른다 — 종전 상급종합 코드 고정(AA157/AA257)이라 운영에서 초진 누락·재진 0원이었다
    const consultCode = consultationCodeFor(await this.configRuntime.get('billing.institution.grade'), isInitial);
    if (!consultCode) return { consultCode: null, consultProc: null, isInitial };
    const asOf = new Date();
    const consultProc = await this.prisma.procedureCode.findFirst({
      where: { code: consultCode, validFrom: { lte: asOf }, OR: [{ validTo: null }, { validTo: { gte: asOf } }] },
      orderBy: { validFrom: 'desc' },
    });
    await this.applyTierPrices([consultProc]); // 진찰료 단가도 고시 종별 단가(병원급 기본 코드는 마스터에 0)
    return { consultCode, consultProc, isInitial };
  }

  async createFromEncounter(encounterId: string, opts?: { notifyPatient?: boolean }) {
    const encounter = await this.prisma.encounter.findUnique({
      where: { id: encounterId },
      include: {
        patient: { select: { id: true, insuranceType: true } },
        appointment: { select: { type: true } },
        prescriptions: {
          where: { status: 'ACTIVE' },
          include: {
            medicationCode: { select: { code: true, nameKo: true, unitPrice: true, insuranceCode: true } },
            procedureCode: { select: { code: true, nameKo: true, unitPrice: true, copayRate: true, insuranceCovered: true } },
          },
        },
      },
    });

    if (!encounter) throw new NotFoundException('Encounter not found');
    await this.applyTierPrices(encounter.prescriptions.map((rx) => rx.procedureCode)); // 청구 단가 = 고시 종별 단가(종별 명시 설정 때만)

    // 이미 수납이 있는지 확인
    const existing = await this.prisma.billing.findUnique({ where: { encounterId } });
    if (existing) throw new BadRequestException('Billing already exists for this encounter');

    // 본인부담률 = 수진자 자격조회 기반(의료급여 종별·산정특례·차상위·자격상실), 미조회 시 정적 폴백
    const visitTypeForCopay = encounter.visitType === 'INPATIENT' ? 'INPATIENT' : 'OUTPATIENT';
    const elig = await this.resolveCopay(encounter.patient.id, encounter.patient.insuranceType, visitTypeForCopay, encounterId);
    const copayRate = elig.rate;
    const items: BillingLineItem[] = [];

    // 1. 진찰료 — 외래/응급만. 입원(INPATIENT·INPATIENT_CONSULT)은 입원료 체계라 외래 진찰료 미부과(오청구 차단).
    const isInpatient = encounter.visitType === 'INPATIENT' || encounter.visitType === 'INPATIENT_CONSULT';
    if (!isInpatient) {
      const { consultCode, consultProc } = await this.resolveConsultProcedure(encounter.patient.id, encounterId, encounter.appointment?.type ?? null);
      if (consultProc) {
        const amount = consultProc.unitPrice ?? 0;
        items.push({
          codeType: 'PROCEDURE',
          codeId: consultProc.id,
          codeName: consultProc.nameKo,
          quantity: 1,
          unitPrice: amount,
          amount,
          copayRate,
          fullCopay: copayRate >= 1, // 자격상실/100분의100 → 전액본인부담
          insuranceCategory: 'COVERED', // 진찰료(종별 초진·재진 코드)는 급여 고정
        });
        if ((consultProc.unitPrice ?? 0) === 0) {
          // 🔴 코드는 있는데 단가가 0 — 라인은 생기지만 0원이라 청구가 비어 보인다(실측 7건).
          //    조용히 지나가면 "진찰료를 안 받은 것"과 "마스터가 비었다"를 구분할 수 없다.
          this.logger.warn(`진찰료 단가 0원 — 수가 마스터 확인 필요 (code=${consultCode}, encounter=${encounterId})`);
        }
      } else {
        // 🔴 **진찰료 코드가 마스터에 없다**(2026-09-03 실측: 상급종합 초진 AA157 부재) — 또는 종별 설정값이 표 밖이라 코드를 못 골랐다(code=null).
        //    종전엔 `if (consultProc)` 만 있어 라인이 **경고 없이 통째로 빠졌다** — 청구가
        //    라인 0개(32번 불변식) 또는 진찰료 누락으로 나갔다. billing.create_failed 와 같은 급으로 남긴다.
        this.logger.error(`진찰료 코드 미등재 — 청구에서 진찰료가 누락됩니다 (code=${consultCode}, encounter=${encounterId})`);
        this.events?.emit('billing.consult_code_missing', { encounterId, code: consultCode });
      }
    }

    // 2. 처방별 금액
    // 🔴 (2026-10-14 수납·청구 결함 발굴 P5-1) 약가·수가 미등재(단가 null)는 라인이 **0원 급여**로 들어간다(계산 패널은 '모름'으로 뺀다).
    //    어떻게 할지(0원 라인 유지·청구 보류·라인 제외)는 사람 결정 `billing.unpricedLinePolicy` — 정하기 전엔 현행대로 두되
    //    조용히 넘기지 않는다: 경고를 남기고 응답에 미등재 라인을 싣는다(화면이 말한다).
    const unpricedLines: { code: string | null; name: string }[] = [];
    for (const rx of encounter.prescriptions) {
      const item = this.buildPrescriptionLineItem(rx, copayRate, elig.copayCategory);
      if (item) items.push(item);
      const priced = rx.type === 'MEDICATION' ? rx.medicationCode?.unitPrice != null : rx.procedureCode ? rx.procedureCode.unitPrice != null : true;
      if (item && !priced) unpricedLines.push({ code: (rx.type === 'MEDICATION' ? rx.medicationCode?.code : rx.procedureCode?.code) ?? null, name: item.codeName });
    }
    if (unpricedLines.length) {
      this.logger.warn(`약가·수가 미등재 ${unpricedLines.length}건이 0원 라인으로 청구됨 (encounter=${encounterId}): ${unpricedLines.map((l) => l.code ?? l.name).join(', ')}`);
    }

    // 3. 합산 + 본인부담상한제 사전급여(초과분 NHIS부담)
    const totalAmount = items.reduce((sum, i) => sum + i.amount, 0);
    const rawCopay = await this.computePatientCopay(items, visitTypeForCopay, elig.copayCategory, totalAmount);
    const { patientCopay, capExcess } = await this.applyCopayCap(encounter.patient.id, rawCopay);
    const insuranceCovered = totalAmount - patientCopay; // 초과분은 여기 흡수(사전급여)

    // 4. DB 저장
    const created = await this.prisma.billing.create({
      data: {
        encounterId,
        patientId: encounter.patient.id,
        totalAmount,
        insuranceCovered,
        patientCopay,
        copayCapExcess: capExcess || null,
        // 청구 시점 자격 스냅샷(영수증 본인부담 구분·자격상실 표시)
        copayCategory: elig.copayCategory,
        eligibilityStatus: elig.eligibilityStatus,
        eligibilityCheckId: elig.eligibilityCheckId,
        specialExemption: elig.specialCaseType,
        items: {
          create: items.map((i) => ({
            codeType: i.codeType,
            codeId: i.codeId,
            codeName: i.codeName,
            quantity: i.quantity,
            unitPrice: i.unitPrice,
            amount: i.amount,
            copayRate: i.copayRate,
            fullCopay: i.fullCopay,
            insuranceCategory: i.insuranceCategory,
            sourcePrescriptionId: i.sourcePrescriptionId ?? null,
          })),
        },
      },
      include: { items: true },
    });
    // ERP 진료라인 피드(D-6) — 라인별 billing.line_recorded
    void this.emitBillingLines(created.id, false);

    // 🔴 환자 앱 푸시 — 청구(PENDING)가 **실제로 만들어진 뒤**가 "수납 대기"가 사실이 되는 순간이다.
    //    금액은 실제 본인부담금(patientCopay)만 넘긴다 — 없으면 핸들러가 금액 없는 문구를 쓴다(날조 금지).
    const patientPush = firstPatientPushResult(
      this.events
        ? await this.events.emitAsync('billing.patient_pending', {
            patientId: encounter.patient.id,
            billingId: created.id,
            amount: patientCopay,
            notifyPatient: opts?.notifyPatient === true,
          })
        : [],
    );

    return { ...created, patientPush, unpricedLines };
  }

  /**
   * 입원료 Billing 생성 (입원 EDI 청구 P1 — inpatient-edi-claim.plan.md 결정 #2·#4·#5).
   * 퇴원 시 입원 건의 마지막(퇴원) encounter에 귀속되는 입원료 라인(병상등급 수가코드 × 재원일수)을
   * 생성/증분해 기존 청구 파이프라인(경로A/B·billing.line_recorded)에 합류시킨다.
   * - 수가코드: config `inpatient.bedRateCodes`({bedClass: code}) → `inpatient.stayBilling.defaultCode` 폴백(마스터 temporal 최신판 해석)
   * - 단가: procedureCode.unitPrice(>0) 우선 → config inpatient.bedRates[bedClass] → inpatient.dailyRate → ₩50,000
   * - 급여율: eligibility(resolveCopay INPATIENT) — 하드코딩 없음
   * - 멱등: 대상 Billing에 동일 codeId 입원료 라인 존재 시 스킵
   * - InterimBilling 기수납은 승계하지 않음 — 퇴원정산이 기납부(interimPaid)를 차감하므로 이중 차감 방지(기획 §P1 노트 조정)
   */
  async createInpatientStayBilling(admissionId: string): Promise<
    { created: true; billingId: string; code: string; days: number; amount: number }
    | { created: false; reason: string }
  > {
    const admission = await this.prisma.admission.findUnique({
      where: { id: admissionId },
      include: { bed: { select: { bedClass: true } }, patient: { select: { id: true, insuranceType: true } } },
    });
    if (!admission) throw new NotFoundException('입원 기록을 찾을 수 없습니다');

    // 귀속 encounter = 입원 건의 마지막 encounter(퇴원 encounter). 부재 시 스킵(전원 등 — 경고만)
    const targetEnc = await this.prisma.encounter.findFirst({
      where: { admissionId },
      orderBy: { createdAt: 'desc' },
      select: { id: true, patientId: true },
    });
    if (!targetEnc) {
      this.logger.warn(`입원료 Billing 스킵 — encounter 부재 admission=${admissionId}`);
      return { created: false, reason: 'NO_ENCOUNTER' };
    }

    // 수가코드·일당 — 정본 stayPricing(중간정산 quoteInpatientStay 와 같은 함수)
    const pricing = await this.stayPricing(admission.bed?.bedClass ?? null);
    if (!pricing.ok) {
      this.logger.warn(`입원료 Billing 스킵 — 수가코드 미해소 code=${pricing.code} admission=${admissionId}`);
      return { created: false, reason: `CODE_NOT_FOUND:${pricing.code}` };
    }
    const { proc, dailyRate } = pricing;
    const code = proc.code;

    // 재원일수 × 일당(코드 단가 우선·config 폴백)
    const endRef = admission.dischargeDate ?? new Date();
    const days = Math.max(1, Math.ceil((endRef.getTime() - new Date(admission.admitDate).getTime()) / 86400_000));
    const amount = days * dailyRate;

    // 급여율 — eligibility 경로(INPATIENT)
    const elig = await this.resolveCopay(admission.patient.id, admission.patient.insuranceType, 'INPATIENT', targetEnc.id);
    const itemCopay = stayCopayOf(amount, elig.rate);

    const itemData = {
      codeType: 'PROCEDURE',
      codeId: proc.id,
      codeName: `${proc.nameKo} (${days}일)`,
      quantity: days,
      unitPrice: dailyRate,
      amount,
      copayRate: elig.rate,
      fullCopay: elig.rate >= 1,
      insuranceCategory: 'COVERED',
    };

    /**
     * 🔴 (2026-09-16 K2) 멱등이 **check-then-act** 였다 — `findUnique` 로 "입원료 라인이 없다"를 읽고
     *    그 뒤에 만들었다. 두 요청이 동시에 오면(퇴원 흐름 + 관리자 '재시도' 버튼, 더블클릭) 둘 다
     *    "없다"를 읽고 **둘 다 만든다** — 입원료가 두 벌 청구되고 총액·본인부담도 두 번 증분된다(금전).
     *    없는 경우는 `Billing.encounterId` 유니크가 심판이지만, **이미 Billing 이 있는 경우**
     *    (처방 청구가 먼저 선 입원 건 — 흔한 경로)는 `billing_items` 에 (billingId, codeId) 유니크가 없어
     *    아무것도 막지 못했다. 스키마를 바꾸지 않고, 저장소 관례대로 **행을 잠그고 다시 읽는다**
     *    (`controlled-substance-stock`·`obgyn`·`nursing` 과 같은 `SELECT … FOR UPDATE`).
     */
    const result = await this.prisma
      .$transaction(async (tx) => {
        const head = await tx.billing.findUnique({ where: { encounterId: targetEnc.id }, select: { id: true } });
        if (head) {
          // 🔴 잠근 **뒤에** 라인을 읽는다 — 잠그기 전에 읽으면 경합 상대가 그 사이에 넣은 라인을 못 본다
          await tx.$queryRaw`SELECT id FROM billings WHERE id = ${head.id}::uuid FOR UPDATE`;
          const dup = await tx.billingItem.count({ where: { billingId: head.id, codeId: proc.id } });
          if (dup > 0) return { created: false as const, reason: 'ALREADY_BILLED' };
          // 🔴 (2026-10-14 수납·청구 결함 발굴 P5-4) 납부가 시작됐거나 끝난(PAID·취소·환불) 청구에는 입원료를 더하지 않는다 —
          //    종전엔 상태를 보지 않고 증분해 완납 청구가 '완납인데 금액이 늘어난' 상태가 됐고 어느 미수 집계에도 안 떴다.
          //    같은 파일의 recalcFromEncounter·addNonCoveredLine 과 같은 원칙(미납 PENDING 만 자동 변경 · 나머지는 사람 검토).
          const st = await tx.billing.findUnique({ where: { id: head.id }, select: { status: true } });
          if (st?.status !== 'PENDING') return { created: false as const, reason: `BILLING_NOT_OPEN:${st?.status ?? 'UNKNOWN'}` };
          // 기존(처방) Billing에 입원료 증분 — 총액/보험/본인부담 증분 갱신
          await tx.billingItem.create({ data: { ...itemData, billingId: head.id } });
          await tx.billing.update({
            where: { id: head.id },
            data: {
              totalAmount: { increment: amount },
              patientCopay: { increment: itemCopay },
              insuranceCovered: { increment: amount - itemCopay },
            },
          });
          return { created: true as const, billingId: head.id, incremental: true };
        }
        const created = await tx.billing.create({
          data: {
            encounterId: targetEnc.id,
            patientId: admission.patient.id,
            totalAmount: amount,
            insuranceCovered: amount - itemCopay,
            patientCopay: itemCopay,
            copayCategory: elig.copayCategory,
            eligibilityStatus: elig.eligibilityStatus,
            eligibilityCheckId: elig.eligibilityCheckId,
            specialExemption: elig.specialCaseType,
            items: { create: [itemData] },
          },
        });
        return { created: true as const, billingId: created.id, incremental: false };
      })
      .catch((e: unknown) => {
        // 동시 생성의 패자 — `encounterId` 유니크가 막았다. 500 이 아니라 **이미 청구됨**이 사실이다.
        if ((e as { code?: string })?.code === 'P2002') return { created: false as const, reason: 'ALREADY_BILLED' };
        throw e;
      });

    if (!result.created) return result;

    // ERP 진료라인 피드(D-6) — 라인 멱등 ref라 기존 라인 재발행은 인박스 UNIQUE로 무시됨
    void this.emitBillingLines(result.billingId, false);
    this.logger.log(`입원료 Billing ${result.incremental ? '증분' : '생성'} — admission=${admissionId} code=${code} ${days}일 × ${dailyRate} = ${amount}`);
    return { created: true, billingId: result.billingId, code, days, amount };
  }

  /**
   * ERP 진료라인 페이로드 빌드(D-6) — billing.line_recorded / 백필 공용.
   * coverage 는 **원 enum 그대로 송신**(ERP가 매핑 책임, response2 ①). 라인 NON_COVERED 우선.
   * 코드는 EDI 코드(codeId→마스터 해석, ERP fee_master와 동일체계 ②). copayRate 대사용 동봉.
   */
  private async buildLines(billingId: string, cancelled: boolean): Promise<Record<string, unknown>[]> {
    const billing = await this.prisma.billing.findUnique({
      where: { id: billingId },
      include: {
        items: true,
        patient: { select: { mrn: true, dateOfBirth: true, gender: true, insuranceType: true } },
        encounter: { select: { id: true, visitType: true, doctorId: true, admissionId: true, signedAt: true, createdAt: true, pregnancyStatus: true } },
      },
    });
    if (!billing || !billing.encounter) return [];

    // 코드 해석: codeType 라우팅에 의존하지 않고 codeId 를 수가/약가 마스터에서 union 조회(견고).
    const allIds = billing.items.map((i) => i.codeId);
    const [procs, meds] = await Promise.all([
      allIds.length ? this.prisma.procedureCode.findMany({ where: { id: { in: allIds } }, select: { id: true, code: true } }) : Promise.resolve([]),
      allIds.length ? this.prisma.medicationCode.findMany({ where: { id: { in: allIds } }, select: { id: true, code: true, insuranceCode: true, nameKo: true, ingredient: true, ingredientCode: true } }) : Promise.resolve([]),
    ]);
    const codeMap = new Map<string, string>([...procs, ...meds].map((c) => [c.id, c.code]));
    const medInfo = new Map(meds.map((m) => [m.id, m]));
    // 자격 스냅샷(청구 시점 — Billing에 동결) → ERP payload 정밀화. webhook accrual과 동일 필드 동봉(백필 정합).
    const medicalAidClass = billing.copayCategory === 'MA_TYPE1' ? '1' : billing.copayCategory === 'MA_TYPE2' ? '2' : null;
    // 보훈(국가유공자) → ERP coverage=PATRIOT 발송(국비 면제 자동 적용). 환자 insuranceType이 아닌 자격구분 기반.
    const coverageOverride = billing.copayCategory === 'PATRIOT' ? 'PATRIOT' : null;

    const staff = await this.prisma.staff.findUnique({ where: { userId: billing.encounter.doctorId }, select: { employeeNumber: true, department: true } });
    let admittedOn: string | null = null;
    if (billing.encounter.admissionId) {
      // 🔴 (2026-09-15) 조회 실패를 입원일 미상(null)으로 ERP 에 보내지 않는다 — 전파
      const adm = await this.prisma.admission.findUnique({ where: { id: billing.encounter.admissionId }, select: { admitDate: true } });
      admittedOn = adm?.admitDate ? adm.admitDate.toISOString().slice(0, 10) : null;
    }
    // 상병코드 동봉(ERP 의학적 심사·AI 요청) — 주상병(PRIMARY) 먼저·rank 순, 코드만(자유서술 진단명 제외=PII 게이트).
    // 에피소드 단위: 같은 encounterId 모든 라인에 동일 목록 반복(ERP가 중복 제거). 없으면 생략(에러 아님).
    const diags = await this.prisma.encounterDiagnosis.findMany({
      where: { encounterId: billing.encounter.id },
      select: { type: true, rank: true, certainty: true, diagnosisCode: { select: { code: true } } },
    });
    const sortedDiags = diags
      .sort((a, b) => (a.type === 'PRIMARY' ? 0 : 1) - (b.type === 'PRIMARY' ? 0 : 1) || a.rank - b.rank)
      .filter((d) => !!d.diagnosisCode?.code);
    // 상병 상세(주/부·확실도) — 의증(PROVISIONAL)·R/O·배제(EXCLUDED) 표기·삭감관리용
    const diagnosisDetails = sortedDiags.map((d) => ({ code: d.diagnosisCode!.code, type: d.type, certainty: d.certainty ?? 'CONFIRMED', rank: d.rank }));
    // 청구 상병코드: 배제(EXCLUDED)·감별(DIFFERENTIAL)은 청구 대상 아님(주/부·확진·의증·R/O만).
    // type(주/부/감별)↔certainty(확진/의증/R-O/배제) 직교 — 청구 포함은 type≠감별 & certainty≠배제.
    const diagnosisCodes = sortedDiags
      .filter((d) => d.certainty !== 'EXCLUDED' && d.type !== 'DIFFERENTIAL')
      .map((d) => d.diagnosisCode!.code);

    const dob = billing.patient.dateOfBirth;
    const treatedAt = (billing.encounter.signedAt ?? billing.encounter.createdAt).toISOString();
    const age = dob ? ageOf(dob) : null;
    const rawCoverage = billing.patient.insuranceType; // 원 enum (NHI/MEDICAID/INDUSTRIAL/AUTO/SELF_PAY) — ERP가 매핑
    const institutionGrade = String((await this.configRuntime.get('billing.institution.grade')) ?? 'CLINIC'); // 종별가산 분해(#4)

    return billing.items.map((it) => ({
      chartNo: billing.patient.mrn,
      encounterId: billing.encounterId,
      encounterType: billing.encounter!.visitType === 'INPATIENT' ? 'INPATIENT' : 'OUTPATIENT',
      admittedOn,
      deptCode: staff?.department ?? null,
      doctorStaffNo: staff?.employeeNumber ?? null,
      lineId: it.sourcePrescriptionId ?? it.id, // ERP lineId 치환 upsert 정합 — 발생(rx.id)과 동일 lineId
      sourcePrescriptionId: it.sourcePrescriptionId ?? null, // 발생-정산 ref 정합(progressive)
      code: codeMap.get(it.codeId) ?? it.codeId,
      codeType: erpCodeType(it.codeType),
      count: it.quantity,
      unitPrice: it.unitPrice,           // HIS 단가(대사용 + ERP 0단가/비급여 폴백, 제안B)
      amount: it.amount,                 // HIS 산정 금액(수량×단가)
      priceBasis: 'BASE_CATALOG',        // HIS 금액=기본수가(종별가산 미적용) — ERP가 가산 적용(#4)
      institutionGrade,                  // 요양기관 종별 — ERP 가산율 산정(#4)
      treatedOn: treatedAt.slice(0, 10),
      treatedAt,
      patientAge: age,
      patientSex: billing.patient.gender === 'MALE' ? 'M' : billing.patient.gender === 'FEMALE' ? 'F' : 'U',
      coverage: it.insuranceCategory === 'NON_COVERED' ? 'NONCOVERED' : (coverageOverride ?? rawCoverage),
      copayRate: Number(it.copayRate),
      // webhook accrual(emitAccrualLine)과 동일 자격 필드 동봉 — 백필 재pull 시 자격 정밀화 보존(ERP P1 요청)
      insuranceProductCode: medInfo.get(it.codeId)?.insuranceCode ?? null, // 보험 제품코드 9자리(채워지면 ERP price_source=MASTER)
      drugName: medInfo.get(it.codeId)?.nameKo ?? null,
      ingredient: medInfo.get(it.codeId)?.ingredient ?? null,
      ingredientCode: medInfo.get(it.codeId)?.ingredientCode ?? null, // DUR 동일성분·병용금기(#2)
      pregnancyStatus: billing.encounter!.pregnancyStatus ?? null,     // DUR 임부금기 라인레벨(#3)
      itemCategory: erpItemCategoryFromCodeType(it.codeType),  // 급여 분류(투약·검사·처치 등)
      copayCategory: billing.copayCategory ?? null,            // 자격구분(NEAR_POOR 차상위 등 — ERP SoT 분기 신호)
      medicalAidClass,                                         // 의료급여 1/2종(null=해당없음)
      specialCaseType: billing.specialExemption ?? null,       // 산정특례 코드(V027 등, null=없음)
      eligibilityStatus: billing.eligibilityStatus ?? null,    // VERIFIED|EXPIRED|NOT_FOUND(자격상실=전액)
      fullCopay: it.fullCopay,                                 // 급여 100/100 전액본인부담 라인
      ...(diagnosisCodes.length ? { diagnosisCodes, principalDiagnosisCode: diagnosisCodes[0], diagnosisDetails } : {}),  // 상병코드(주상병 먼저)+명시 주상병+상세(확실도)
      cancelled,
    }));
  }

  /**
   * 라인별 billing.line_recorded 발행(생성/취소).
   * ref = bline:{encounterId}:rx:{prescriptionId}(progressive 발생과 정합) | bline:{encounterId}:{lineId}(하위호환).
   */
  async emitBillingLines(billingId: string, cancelled = false) {
    const lines = await this.buildLines(billingId, cancelled);
    for (const ln of lines) {
      const refKey = ln.sourcePrescriptionId ? `rx:${ln.sourcePrescriptionId}` : ln.lineId;
      // 🔴 §3 봉합: 취소 발행은 원 발행과 다른 ref(:cancel) — 동일 ref면 skipDuplicates가 취소를 폐기해 ERP가 못 받음
      void this.outbox.enqueue('billing', 'billing.line_recorded', `bline:${ln.encounterId}:${refKey}${cancelled ? ':cancel' : ''}`, ln);
    }
  }

  /**
   * 진료비 단계적 발생(progressive) — Prescription(오더) 1건 시행 시 라인 1건 발행.
   * ref=bline:{encounterId}:rx:{prescriptionId} (정산 시 동일 ref 재발행 → ERP 멱등). 취소=cancelled.
   * 정산(emitBillingLines)과 동일 페이로드 스키마.
   */
  async emitAccrualLine(prescriptionId: string, cancelled = false, treatedOnOverride?: string) {
    const rx = await this.prisma.prescription.findUnique({
      where: { id: prescriptionId },
      include: {
        medicationCode: { select: { code: true, unitPrice: true, insuranceCode: true, nameKo: true, ingredient: true, ingredientCode: true } },
        procedureCode: { select: { code: true, nameKo: true, unitPrice: true, copayRate: true, insuranceCovered: true } },
        encounter: {
          select: {
            id: true, visitType: true, doctorId: true, admissionId: true, signedAt: true, createdAt: true, pregnancyStatus: true,
            patient: { select: { id: true, mrn: true, dateOfBirth: true, gender: true, insuranceType: true } },
          },
        },
      },
    });
    if (!rx || !rx.encounter) return null;
    await this.applyTierPrices([rx.procedureCode]); // ERP 발생 라인 단가 = 청구와 같은 종별 단가
    const enc = rx.encounter;
    const isMed = rx.type === 'MEDICATION';
    const code = isMed ? rx.medicationCode?.code : rx.procedureCode?.code;
    if (!code) return null; // 코드 미해석 시 미발행(시행 데이터 부정합)

    const visitTypeForCopay = enc.visitType === 'INPATIENT' ? 'INPATIENT' : 'OUTPATIENT';
    const elig = await this.resolveCopay(enc.patient.id, enc.patient.insuranceType, visitTypeForCopay, enc.id);
    // 🔴 (2026-10-14 수납·청구 결함 발굴 P5-2) 발생 라인은 정산 라인과 **같은 함수**(buildPrescriptionLineItem)로 만든다.
    //    종전엔 본인부담률을 옛 우선순위(코드 특례 > 감면 자격 · 비급여 판정 없음)로, 수량을 처방 수량으로 따로 계산했는데
    //    두 라인이 같은 ref(bline:enc:rx:id)라 아웃박스 `skipDuplicates` 로 **먼저 적재된 발생 라인만 남고 정산 라인이 버려졌다**.
    //    단가·수량·율·급여구분이 정산과 같아야 어느 쪽이 남아도 같은 사실이다.
    const built = this.buildPrescriptionLineItem(rx, elig.rate, elig.copayCategory);
    if (!built) return null;
    // 제안B: HIS 단가 동봉 → ERP가 마스터(>0) 우선·HIS 폴백. 마스터 무가격 코드(입원료 등) 0원 처리 방지.
    const unitPrice = built.unitPrice;
    const quantity = built.quantity;
    const copayRate = built.copayRate;
    const insuranceCategory = built.insuranceCategory;
    const staff = await this.prisma.staff.findUnique({ where: { userId: enc.doctorId }, select: { employeeNumber: true, department: true } });
    let admittedOn: string | null = null;
    if (enc.admissionId) {
      // 🔴 (2026-09-15) 조회 실패를 입원일 미상(null)으로 ERP 에 보내지 않는다 — 전파
      const adm = await this.prisma.admission.findUnique({ where: { id: enc.admissionId }, select: { admitDate: true } });
      admittedOn = adm?.admitDate ? adm.admitDate.toISOString().slice(0, 10) : null;
    }
    const dob = enc.patient.dateOfBirth;
    // 시행 시점 — 기본 현재. backfill·일별 입원료 등은 treatedOnOverride(YYYY-MM-DD)로 백데이트.
    const treatedAt = treatedOnOverride ? new Date(`${treatedOnOverride}T12:00:00+09:00`).toISOString() : new Date().toISOString();
    // 상병코드 동봉 — 정산 경로(buildLines)와 동일 스키마. 주상병(PRIMARY) 먼저·rank 순, 코드만(PII 게이트), 없으면 생략.
    const diags = await this.prisma.encounterDiagnosis.findMany({
      where: { encounterId: enc.id },
      select: { type: true, rank: true, certainty: true, diagnosisCode: { select: { code: true } } },
    });
    const sortedDiags = diags
      .sort((a, b) => (a.type === 'PRIMARY' ? 0 : 1) - (b.type === 'PRIMARY' ? 0 : 1) || a.rank - b.rank)
      .filter((d) => !!d.diagnosisCode?.code);
    // 상병 상세(주/부·확실도) — 의증(PROVISIONAL)·R/O·배제(EXCLUDED) 표기·삭감관리용
    const diagnosisDetails = sortedDiags.map((d) => ({ code: d.diagnosisCode!.code, type: d.type, certainty: d.certainty ?? 'CONFIRMED', rank: d.rank }));
    // 청구 상병코드: 배제(EXCLUDED)·감별(DIFFERENTIAL)은 청구 대상 아님(주/부·확진·의증·R/O만).
    // type(주/부/감별)↔certainty(확진/의증/R-O/배제) 직교 — 청구 포함은 type≠감별 & certainty≠배제.
    const diagnosisCodes = sortedDiags
      .filter((d) => d.certainty !== 'EXCLUDED' && d.type !== 'DIFFERENTIAL')
      .map((d) => d.diagnosisCode!.code);
    // 종별가산 분해(#4): HIS unitPrice=기본수가(카탈로그·가산 미적용). ERP가 종별가산율 적용. 기관등급 동봉.
    const institutionGrade = String((await this.configRuntime.get('billing.institution.grade')) ?? 'CLINIC');
    const line = {
      chartNo: enc.patient.mrn,
      encounterId: enc.id,
      encounterType: enc.visitType === 'INPATIENT' ? 'INPATIENT' : 'OUTPATIENT',
      admittedOn,
      deptCode: staff?.department ?? null,
      doctorStaffNo: staff?.employeeNumber ?? null,
      lineId: rx.id,
      sourcePrescriptionId: rx.id,
      code,
      codeType: erpCodeType(isMed ? 'MEDICATION' : 'PROCEDURE'),
      count: quantity,
      unitPrice,
      amount: built.amount,
      priceBasis: 'BASE_CATALOG',     // HIS 금액=기본수가(종별가산 미적용) — ERP가 가산 적용(#4)
      institutionGrade,               // 요양기관 종별(CLINIC|HOSPITAL|GENERAL|TERTIARY) — ERP 가산율 산정
      treatedOn: treatedAt.slice(0, 10),
      treatedAt,
      patientAge: dob ? ageOf(dob) : null,
      patientSex: enc.patient.gender === 'MALE' ? 'M' : enc.patient.gender === 'FEMALE' ? 'F' : 'U',
      coverage: insuranceCategory === 'NON_COVERED' ? 'NONCOVERED' : enc.patient.insuranceType, // 정산 라인(buildLines)과 동일 분기
      insuranceCategory, // COVERED | NON_COVERED 원값 명시(ERP 소비 선택)
      copayRate,
      // ERP 약가 마스터 매칭용(보험 제품코드 우선, 미채움 시 명칭/성분으로 매칭) — ERP 표준코드 요청 반영
      insuranceProductCode: isMed ? (rx.medicationCode?.insuranceCode ?? null) : null, // 보험 제품코드 9자리(채워지면 price_source=MASTER 자동전환)
      drugName: isMed ? (rx.medicationCode?.nameKo ?? null) : null,
      ingredient: isMed ? (rx.medicationCode?.ingredient ?? null) : null,
      ingredientCode: isMed ? (rx.medicationCode?.ingredientCode ?? null) : null, // DUR 동일성분·병용금기(#2)
      pregnancyStatus: enc.pregnancyStatus ?? null,                                  // DUR 임부금기 라인레벨(#3)
      // ERP payload 정밀화(자격조회 기반) — 미동봉 시 ERP 폴백, 역호환 안전
      itemCategory: erpItemCategory(rx.type, isMed),         // 급여 분류(투약·주사·처치·검사 등)
      copayCategory: elig.copayCategory ?? null,             // 자격구분(NEAR_POOR 차상위 등 — ERP SoT 분기 신호)
      medicalAidClass: elig.medicalAidClass,                 // 의료급여 1/2종(null=해당없음)
      specialCaseType: elig.specialCaseType,                 // 산정특례 코드(V027 등, null=없음)
      eligibilityStatus: elig.eligibilityStatus,             // VERIFIED|EXPIRED|NOT_FOUND(자격상실=전액)
      ...(diagnosisCodes.length ? { diagnosisCodes } : {}),  // 상병코드(KCD/ICD·주상병 먼저, 없으면 생략)
      cancelled,
      accrual: true, // 발생(시행) 발행분 표식
    };
    // 🔴 §3 봉합: 취소 발행은 :cancel 접미로 원 발행과 ref 분리(skipDuplicates 폐기 방지)
    const ref = `bline:${enc.id}:rx:${rx.id}${cancelled ? ':cancel' : ''}`;
    void this.outbox.enqueue('billing', 'billing.line_recorded', ref, line);
    return { ref, lineId: line.lineId, code, count: quantity, unitPrice, amount: line.amount, cancelled };
  }

  /** 일별 0시 재원환자수(P2) — 간호등급 산정용(고시 기준). ERP가 등급 산정에 사용. */
  async getDailyCensus(from: string, to: string) {
    const rows = await this.prisma.$queryRaw<{ census_date: string; census: number }[]>`
      SELECT to_char(d, 'YYYY-MM-DD') AS census_date,
             (SELECT count(*)::int FROM admissions a
              WHERE a.admit_date <= d AND (a.discharge_date IS NULL OR a.discharge_date > d)) AS census
      FROM generate_series(${from}::timestamptz, ${to}::timestamptz, interval '1 day') d
      ORDER BY d`;
    return rows.map((r) => ({ date: r.census_date, inpatientCensus: Number(r.census) }));
  }

  /**
   * 미청구 진행분(ERP 진행기준 수익 B-1) — 기준일(asOf)까지 이행됐으나 미청구·미수납인 진행분.
   *
   * 진행률 산정(합의):
   *  - 입원 행위별수가(FFS): incurred = 시행 완료 처방 라인 누적액(ACTUAL_LINES, emitAccrualLine과 동일 산식, 추정 아님).
   *  - 외래·응급: 당일 종결 → incurred = 발생 라인 합계(SAME_DAY), 미청구분 = incurred − billed.
   *  - 입원 정액(DRG/포괄): HIS는 정액 금액을 산정하지 않음 → daysAdmitted/standardDays만 제공(LOS_RATIO, ERP 환산). 현재 임상경로 미연결로 standardDays=null.
   *
   * billed = 생성된 청구액(Billing.totalAmount, CANCELLED 제외), paid = 수납액(Billing.paidAmount).
   * PII 게이트: chartNo(MRN) 미동봉 — admissionId/encounterId(UUID)만 제공. ERP는 집계 후 식별자 폐기.
   */
  async getUnbilledProgress(asOfStr?: string) {
    const asOf = asOfStr ? new Date(`${asOfStr}T23:59:59+09:00`) : new Date();
    if (isNaN(asOf.getTime())) throw new Error('as_of 형식이 올바르지 않습니다(YYYY-MM-DD)');
    const asOfDate = asOf.toISOString().slice(0, 10);
    const unpaid = ['PENDING', 'PARTIAL', 'DEFERRED', 'INSTALLMENT'] as const;
    const OUT_CAP = 10000; // 외래 미청구 안전 상한(초과 시 truncated 표기 — 무성 절단 금지)

    const lineAmt = (p: { type: string; quantity: number | null; medicationCode: { unitPrice: unknown } | null; procedureCode: { unitPrice: unknown } | null }) => {
      const up = Number((p.type === 'MEDICATION' ? p.medicationCode?.unitPrice : p.procedureCode?.unitPrice) ?? 0);
      return (isNaN(up) ? 0 : up) * (p.quantity ?? 1);
    };
    const rxSelect = { quantity: true, type: true, medicationCode: { select: { unitPrice: true } }, procedureCode: { select: { unitPrice: true } } };
    const rxWhere = { status: { not: 'CANCELLED' as const }, createdAt: { lte: asOf } };

    // ── 입원(admission 단위): 기준일 재원중 또는 퇴원·미정산 ──
    const admissions = await this.prisma.admission.findMany({
      where: {
        admitDate: { lte: asOf },
        status: { not: 'CANCELLED' },
        OR: [
          { status: 'ADMITTED' },
          { dischargeDate: { gt: asOf } }, // 기준일 시점엔 재원중(이후 퇴원)
          { encounters: { some: { OR: [{ billing: { is: null } }, { billing: { status: { in: [...unpaid] } } }] } } }, // 퇴원·미정산 후보(JS에서 unbilled로 확정)
        ],
      },
      select: {
        id: true, admitDate: true, dischargeDate: true, status: true, attendingDoctorId: true,
        encounters: {
          select: {
            id: true, doctorId: true,
            prescriptions: { where: rxWhere, select: rxSelect },
            billing: { select: { totalAmount: true, paidAmount: true, status: true, createdAt: true } },
          },
        },
      },
    });

    // 진료과: 담당의/주치의 staff.department 배치 조회
    const doctorIds = [...new Set(admissions.flatMap((a) => [a.attendingDoctorId, ...a.encounters.map((e) => e.doctorId)]).filter((x): x is string => !!x))];
    const deptByUser = new Map<string, string | null>();

    // 임상경로(DRG/포괄) 표준재원일 — 입원 encounter의 PathwayAssignment → pathway.totalDays(#5, LOS_RATIO 환산용)
    const allEncIds = admissions.flatMap((a) => a.encounters.map((e) => e.id));
    const stdDaysByEnc = new Map<string, number>();
    if (allEncIds.length) {
      const assigns = await this.prisma.pathwayAssignment.findMany({ where: { encounterId: { in: allEncIds }, status: 'ACTIVE' }, select: { encounterId: true, pathway: { select: { totalDays: true } } } });
      for (const as of assigns) if (as.pathway?.totalDays != null) stdDaysByEnc.set(as.encounterId, as.pathway.totalDays);
    }

    const items: Record<string, unknown>[] = [];
    for (const a of admissions) {
      let incurred = 0, billed = 0, paid = 0;
      for (const e of a.encounters) {
        for (const p of e.prescriptions) incurred += lineAmt(p);
        if (e.billing && e.billing.status !== 'CANCELLED' && e.billing.createdAt <= asOf) {
          billed += e.billing.totalAmount;
          paid += e.billing.paidAmount ?? 0;
        }
      }
      if (incurred <= 0) continue;
      const dischargedByAsOf = !!a.dischargeDate && a.dischargeDate <= asOf;
      const isInProgress = a.status === 'ADMITTED' && !dischargedByAsOf;
      const unbilled = Math.max(0, incurred - billed);
      if (!isInProgress && unbilled <= 0) continue; // 퇴원·정산완료분 제외(이미 인식)
      const endRef = dischargedByAsOf ? a.dischargeDate! : asOf;
      const daysAdmitted = Math.max(1, Math.ceil((endRef.getTime() - a.admitDate.getTime()) / 86400000));
      // 임상경로 배정 시 표준재원일 제공(DRG LOS_RATIO 환산 입력, #5)
      let standardDays: number | null = null;
      for (const e of a.encounters) { const d = stdDaysByEnc.get(e.id); if (d != null) { standardDays = d; break; } }
      items.push({
        encounterType: 'INPATIENT',
        admissionId: a.id,
        deptCode: a.attendingDoctorId ?? a.encounters[0]?.doctorId ?? null, // 아래서 staff.department로 치환
        admissionOn: a.admitDate.toISOString().slice(0, 10),
        asOf: asOfDate,
        progressBasis: standardDays != null ? 'LOS_RATIO' : 'ACTUAL_LINES',
        daysAdmitted,
        standardDays, // 임상경로 배정 시 totalDays, 미배정 null(FFS=ACTUAL_LINES)
        incurredAmount: incurred,
        billedAmount: billed,
        paidAmount: paid,
        unbilledAmount: unbilled,
        status: isInProgress ? 'IN_PROGRESS' : 'DISCHARGED_UNBILLED',
      });
    }

    // ── 외래·응급(admission 없음, 미청구·미수납분) ──
    const outEnc = await this.prisma.encounter.findMany({
      where: {
        admissionId: null,
        createdAt: { lte: asOf },
        prescriptions: { some: rxWhere },
        OR: [{ billing: { is: null } }, { billing: { status: { in: [...unpaid] } } }],
      },
      select: {
        id: true, doctorId: true,
        prescriptions: { where: rxWhere, select: rxSelect },
        billing: { select: { totalAmount: true, paidAmount: true, status: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: OUT_CAP + 1,
    });
    const truncated = outEnc.length > OUT_CAP;
    const outRows = truncated ? outEnc.slice(0, OUT_CAP) : outEnc;
    for (const e of outRows) {
      let incurred = 0;
      for (const p of e.prescriptions) incurred += lineAmt(p);
      const billed = e.billing && e.billing.status !== 'CANCELLED' ? e.billing.totalAmount : 0;
      const paid = e.billing?.paidAmount ?? 0;
      const unbilled = Math.max(0, incurred - billed);
      if (incurred <= 0 || unbilled <= 0) continue;
      if (e.doctorId) doctorIds.push(e.doctorId);
      items.push({
        encounterType: 'OUTPATIENT',
        encounterId: e.id,
        deptCode: e.doctorId ?? null,
        admissionOn: null,
        asOf: asOfDate,
        progressBasis: 'SAME_DAY',
        daysAdmitted: null,
        standardDays: null,
        incurredAmount: incurred,
        billedAmount: billed,
        paidAmount: paid,
        unbilledAmount: unbilled,
        status: 'DISCHARGED_UNBILLED',
      });
    }

    // deptCode(현재 doctorId 보유) → staff.department 치환
    const uniqDoctors = [...new Set(doctorIds.filter((x): x is string => !!x))];
    if (uniqDoctors.length) {
      const staffs = await this.prisma.staff.findMany({ where: { userId: { in: uniqDoctors } }, select: { userId: true, department: true } });
      for (const s of staffs) { if (s.userId) deptByUser.set(s.userId, s.department ?? null); }
    }
    for (const it of items) {
      const d = it.deptCode as string | null;
      it.deptCode = d && deptByUser.has(d) ? deptByUser.get(d) ?? null : null;
    }
    if (truncated) this.logger.warn(`unbilled-progress 외래 ${OUT_CAP}건 상한 도달 — 일부 절단(truncated=true)`);

    return {
      asOf: asOfDate,
      basis: { inpatient: 'ACTUAL_LINES', outpatient: 'SAME_DAY', drg: 'LOS_RATIO(미적용·임상경로 미연결)' },
      count: items.length,
      truncated,
      items,
    };
  }

  /** 재료 품목(P2-2) — ERP 무매핑 등록용. code=HIS InventoryItem.code 그대로(SoT=HIS). */
  async listMaterialsForErp() {
    const items = await this.prisma.inventoryItem.findMany({ orderBy: { code: 'asc' } });
    return items.map((it) => ({
      code: it.code,                               // ERP가 이 코드 그대로 scm.items 등록(무매핑)
      erpItemCode: it.erpItemCode ?? it.code,      // 미매핑 시 HIS code 권장
      name: it.name, category: it.category, unit: it.unit,
      specification: it.specification ?? null, barcode: it.barcode ?? null,
      manufacturer: it.manufacturer ?? null,
      unitPrice: it.unitPrice ?? null, lastPurchasePrice: it.lastPurchasePrice ?? null,
    }));
  }

  /** 비급여 가격표(P1) — ERP 비급여 SoT 동기화용. 활성 항목만. */
  async listNonCoveredForErp() {
    const items = await this.prisma.nonCoveredItem.findMany({ where: { isActive: true }, orderBy: [{ category: 'asc' }, { code: 'asc' }] });
    return items.map((it) => ({
      code: it.code, name: it.name, category: it.category, price: it.price,
      description: it.description ?? null, requiresConsent: it.requiresConsent,
    }));
  }

  /** 백필(요청3) — ERP puller가 호출. 기간 내 Billing 라인 일괄 반환. */
  /**
   * HIRA 약가마스터(DrugStandardCode) 매칭 — HIS 약품 → 보험 제품코드 후보(성분·규격·업체 복합).
   * apply=true 시 HIGH 신뢰도(업체+규격 일치·단일후보)만 자동 채움. 모호분은 후보 반환(수동 확정).
   */
  async matchDrugStandardCodes(apply = false): Promise<{ total: number; applied: number; results: unknown[] }> {
    const meds = await this.prisma.medicationCode.findMany({
      where: { insuranceCode: null, isActive: true },
      select: { id: true, code: true, nameKo: true, ingredient: true, manufacturer: true, dosageForm: true },
    });
    const norm = (s?: string | null) => (s ?? '').replace(/\((주|유|재)\)|주식회사|\s/g, '');
    // 함량 숫자+단위 추출(단위 불일치 오매칭 방지: 100단위 vs 100mg)
    const parseStrength = (s?: string | null): { num: number | null; unit: string | null } => {
      const mt = (s ?? '').match(/(\d+(?:\.\d+)?)\s*(mg|밀리그램|밀리그람|iu|단위|unit|mcg|µg|㎍|g|그램|그람|%|ml|밀리리터)/i);
      if (!mt) return { num: null, unit: null };
      const u = mt[2].toLowerCase();
      const unit = /밀리그|^mg$/.test(u) ? 'mg' : /iu|단위|unit/.test(u) ? 'iu' : /mcg|µg|㎍/.test(u) ? 'mcg' : /그램|그람|^g$/.test(u) ? 'g' : /ml|밀리리터/.test(u) ? 'ml' : u;
      return { num: Number(mt[1]), unit };
    };
    const FORM = (s?: string | null) => /정|tab/i.test(s ?? '') ? '정' : /캡|cap/i.test(s ?? '') ? '캡슐' : /주|inj/i.test(s ?? '') ? '주사' : /시럽|액|syr/i.test(s ?? '') ? '액' : (s ?? '');
    const results: unknown[] = [];
    let applied = 0;
    for (const m of meds) {
      const ing = (m.ingredient ?? '').split(/[/,]/)[0].trim();
      const hisStr = parseStrength(m.nameKo);
      const hisForm = FORM(m.dosageForm ?? m.nameKo);
      const firstTok = m.nameKo.split(/\s+/)[0];
      const keys = [ing, firstTok].filter((k) => k && k.length >= 2);
      if (!keys.length) { results.push({ hisCode: m.code, name: m.nameKo, confidence: 'NONE', best: null, candidateCount: 0, applied: false }); continue; }
      const cands = await this.prisma.drugStandardCode.findMany({
        where: { OR: keys.map((k) => ({ productName: { contains: k } })) },
        take: 50,
        select: { insuranceCode: true, productName: true, manufacturer: true, spec: true, standardCode: true, atcCode: true, dosageForm: true },
      });
      const hisMaker = norm(m.manufacturer);
      const scored = cands.map((c) => {
        let score = 1;
        const cStr = parseStrength(c.spec);
        // 함량: 숫자 AND 단위 모두 일치해야 specMatch(단위 다르면 불일치)
        const specMatch = hisStr.num != null && cStr.num != null && hisStr.num === cStr.num && (hisStr.unit == null || cStr.unit == null || hisStr.unit === cStr.unit);
        const cMaker = norm(c.manufacturer);
        const makerMatch = !!(hisMaker && cMaker && (cMaker.includes(hisMaker.slice(0, 3)) || hisMaker.includes(cMaker.slice(0, 3))));
        const formMatch = FORM(c.dosageForm ?? c.productName) === hisForm;
        if (specMatch) score += 2;
        if (makerMatch) score += 2;
        if (formMatch) score += 1;
        return { ...c, score, specMatch, makerMatch, formMatch };
      }).sort((a, b) => b.score - a.score);
      const top = scored[0];
      const topTies = top ? scored.filter((s) => s.score === top.score).length : 0;
      // HIGH(자동적용 후보) = 함량(숫자+단위)·업체·제형 모두 일치 + 단일후보. 그 외는 사람 확정.
      const confidence = !top ? 'NONE'
        : top.specMatch && top.makerMatch && top.formMatch && topTies === 1 ? 'HIGH'
        : top.score >= 3 ? 'MEDIUM' : 'LOW';
      let didApply = false;
      if (apply && confidence === 'HIGH' && top) {
        await this.prisma.medicationCode.update({ where: { id: m.id }, data: { insuranceCode: top.insuranceCode } }).catch(() => undefined);
        didApply = true; applied++;
      }
      results.push({
        hisCode: m.code, name: m.nameKo, confidence,
        best: top ? { insuranceCode: top.insuranceCode, productName: top.productName, manufacturer: top.manufacturer, spec: top.spec, specMatch: top.specMatch, makerMatch: top.makerMatch } : null,
        candidates: scored.slice(0, 5).map((s) => ({ insuranceCode: s.insuranceCode, productName: s.productName, manufacturer: s.manufacturer, spec: s.spec, score: s.score })),
        applied: didApply,
      });
    }
    return { total: meds.length, applied, results };
  }

  /** 단건 확정 — 수동 선택한 보험코드를 HIS 약품에 적용(형식 검증). */
  async confirmDrugCode(hisCode: string, insuranceCode: string): Promise<{ ok: boolean; reason?: string }> {
    const ins = String(insuranceCode ?? '').trim();
    if (!/^[0-9]{8,13}$/.test(ins)) return { ok: false, reason: 'INVALID_INSURANCE_CODE' };
    const r = await this.prisma.medicationCode.updateMany({ where: { code: hisCode }, data: { insuranceCode: ins } });
    return { ok: r.count > 0 };
  }

  /**
   * close-loop(PULL) — ERP 확정코드 EP를 당겨와 insuranceCode 백필. 관리자 트리거 + 일일 cron.
   *
   * 🔴 (2026-09-23 · 생태계 인바운드 §23 회수) 종전 응답은 `backfillInsuranceCodes` 가 낸
   *    **`rejected`(형식 검증에서 거부된 매핑)를 구조분해에서 버렸다** — `pulled 3 = updated 1 + notFound 1 + (보고 안 된 1)`.
   *    운영자는 "3건 당겼는데 1건 반영"만 보고 나머지가 어디로 갔는지 알 길이 없었다.
   *    또 코드·보험코드 중 하나가 빈 행은 `filter` 에서 조용히 사라져 `pulled` 에도 안 잡혔다.
   *    → 받은 수(`received`)·처리한 수(`pulled`)·반영(`updated`)·형식 거부(`rejected`)·키 누락(`malformed`)·
   *      HIS 미존재(`notFound`)를 **전부 따로** 돌려준다(분모 병기 — 화면이 갈라 그린다).
   *    항목 표기는 `code:insuranceCode`(`backfillInsuranceCodes` 의 `rejected` 와 같은 꼴) · 빈 자리는 `?` — 값이지 문장이 아니다.
   */
  async pullConfirmedDrugCodes(): Promise<{
    received: number;
    pulled: number;
    updated: number;
    notFound: string[];
    rejected: string[];
    malformed: string[];
    reason?: string;
  }> {
    const empty = { received: 0, pulled: 0, updated: 0, notFound: [] as string[], rejected: [] as string[], malformed: [] as string[] };
    const base = (await this.configRuntime.get('erp.webhookUrl')) as string;
    const key = (await this.configRuntime.get('erp.integrationKey')) as string;
    if (!base) return { ...empty, reason: 'ERP_NOT_CONFIGURED' };
    const rows: { code: string; insuranceCode: string }[] = [];
    const malformed: string[] = [];
    let received = 0;
    try {
      const res = await fetch(`${base.replace(/\/$/, '')}/api/v1/integration/regulatory/drug-map/confirmed`, {
        headers: { 'X-Integration-Key': key ?? '' }, signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) return { ...empty, reason: `ERP_${res.status}` };
      const body = (await res.json()) as { items?: unknown; data?: unknown; confirmed?: unknown };
      // ERP 응답: { count, items: [{ his_code, insurance_code, ... }] } (snake_case)
      const list = (Array.isArray(body) ? body : (body.items ?? body.data ?? body.confirmed ?? [])) as Record<string, unknown>[];
      received = list.length;
      for (const r of list) {
        const code = String(r.his_code ?? r.code ?? r.hisCode ?? '');
        const insuranceCode = String(r.insurance_code ?? r.insuranceCode ?? r.insuranceProductCode ?? '');
        if (code && insuranceCode) rows.push({ code, insuranceCode });
        else malformed.push(`${code || '?'}:${insuranceCode || '?'}`);
      }
    } catch (e) {
      return { ...empty, reason: (e as Error).message };
    }
    const { updated, notFound, rejected } = await this.backfillInsuranceCodes(rows);
    return { received, pulled: rows.length, updated, notFound, rejected, malformed };
  }

  /** 일일 확정코드 동기화(close-loop 자동) */
  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async cronPullConfirmedDrugCodes() {
    const enabled = await this.configRuntime.get('erp.webhookEnabled');
    if (!enabled) return;
    // 🔴 (2026-09-14) 종전 `.catch(() => null)` — 크론 실패가 로그 한 줄 없이 사라졌다(갱신 0 과 구분 불가)
    const r = await this.pullConfirmedDrugCodes().catch((e) => {
      this.logger.error(`[cron] drug-map confirmed pull failed: ${e instanceof Error ? e.message : String(e)}`);
      return null;
    });
    if (!r) return;
    if (r.reason) { this.logger.warn(`[cron] drug-map confirmed pull: not pulled reason=${r.reason}`); return; }
    if (r.updated > 0) this.logger.log(`[cron] drug-map confirmed pull: updated=${r.updated}/${r.pulled} received=${r.received}`);
    // 🔴 (§23) 종전엔 `updated>0` 한 줄뿐 — 거부·누락·미존재는 크론이 삼켰다(성공 개수만 남기면 미반영 건은 영원히 안 보인다)
    const unapplied = r.rejected.length + r.malformed.length + r.notFound.length;
    if (unapplied > 0) {
      this.logger.warn(
        `[cron] drug-map confirmed pull: unapplied=${unapplied}/${r.received} rejected=${r.rejected.length}(${r.rejected.slice(0, 5).join(',')}) malformed=${r.malformed.length}(${r.malformed.slice(0, 5).join(',')}) notFound=${r.notFound.length}(${r.notFound.slice(0, 5).join(',')})`,
      );
    }
  }

  /** close-loop(PUSH) — ERP 약제팀 확정 보험 제품코드를 MedicationCode.insuranceCode에 채움(이후 라인 자동 MASTER). */
  async backfillInsuranceCodes(mappings: { code: string; insuranceCode: string }[]): Promise<{ updated: number; notFound: string[]; rejected: string[] }> {
    let updated = 0;
    const notFound: string[] = [];
    const rejected: string[] = [];
    for (const m of mappings) {
      if (!m?.code || !m?.insuranceCode) continue;
      const ins = String(m.insuranceCode).trim();
      // 보험 제품코드 형식 검증(8~13자리 숫자) — 외부/ERP 응답 무검증 덮어쓰기 방지
      if (!/^[0-9]{8,13}$/.test(ins)) { rejected.push(`${m.code}:${ins}`); continue; }
      // where 값도 문자열로 고정 — 객체가 들어오면 Prisma 가 필터 연산자로 해석해
      // 마스터 전체가 한 번에 덮어써진다(이중 방어. 1차는 DTO 검증).
      const code = String(m.code);
      // 🔴 (2026-09-23 §23) 종전 `.catch(() => ({ count: 0 }))` — DB 갱신 **실패**가 "HIS 에 그 코드가 없다"(notFound)로
      //    번역됐다. 실패는 전파한다(크론은 error 로그·관리자 호출은 500) — 없음과 실패는 다른 사실이다.
      const r = await this.prisma.medicationCode.updateMany({ where: { code }, data: { insuranceCode: ins } });
      if (r.count > 0) updated += r.count;
      else notFound.push(m.code);
    }
    this.logger.log(`drug-mapping backfill: updated=${updated}, notFound=${notFound.length}, rejected=${rejected.length}`);
    return { updated, notFound, rejected };
  }

  /** ① 공식 주성분코드 백필(식약처/ERP close-loop) — code→ingredientCode. 8~20자 영숫자. */
  async backfillIngredientCodes(mappings: { code: string; ingredientCode: string }[]): Promise<{ updated: number; notFound: string[]; rejected: string[] }> {
    let updated = 0; const notFound: string[] = []; const rejected: string[] = [];
    for (const m of mappings) {
      if (!m?.code || !m?.ingredientCode) continue;
      const ic = String(m.ingredientCode).trim().toUpperCase();
      if (!/^[A-Z0-9]{4,20}$/.test(ic)) { rejected.push(`${m.code}:${ic}`); continue; }
      const code = String(m.code); // where 값 고정 — 연산자 주입 이중 방어
      // 🔴 (2026-09-27) 종전 `.catch(() => ({ count: 0 }))` — 09-23 §23 에서 **보험코드 쌍둥이만** 고치고
      //    7줄 아래 이 성분코드 쌍둥이를 잊었다(형제 쿼리 하나만 막고 옆을 잊는 함정). DB 실패가
      //    "HIS 에 그 코드가 없다"(notFound)로 번역되던 자리 — 실패는 전파한다.
      const r = await this.prisma.medicationCode.updateMany({ where: { code }, data: { ingredientCode: ic } });
      if (r.count > 0) updated += r.count; else notFound.push(m.code);
    }
    this.logger.log(`ingredient-code backfill(official): updated=${updated}, notFound=${notFound.length}, rejected=${rejected.length}`);
    return { updated, notFound, rejected };
  }

  /**
   * ② HIS 정규화 성분키 파생(중간 — 식약처 공식코드 부재 시 동일성분 매칭용).
   * ingredient 텍스트 → 염/수화물 접미 제거·복합제 분해·정렬 → 'KR'+sha256 8hex.
   * 공식코드(접두 비-KR)는 보존(미덮어씀). 동일성분=동일 KR키.
   */
  async deriveIngredientKeys(overwrite = false): Promise<{ updated: number; skipped: number; failed: number; total: number }> {
    const meds = await this.prisma.medicationCode.findMany({ where: { ingredient: { not: null }, ...(overwrite ? {} : { ingredientCode: null }) }, select: { id: true, ingredient: true } });
    let updated = 0, skipped = 0, failed = 0;
    for (const m of meds) {
      const key = BillingService.ingredientKey(m.ingredient ?? '');
      if (!key) { skipped++; continue; }
      /**
       * 🔴 (2026-09-27) 종전 `.catch(() => { skipped++; })` 뒤에 `updated++` 가 **그대로 실행**됐다 —
       *    쓰지도 않은 행이 "갱신"으로 세어지고(P16 실행하지 않고 성공 상태만 기록) 같은 건이 skipped 로도
       *    한 번 더 세어져 `updated + skipped > total` 이 됐다. 게다가 실패는 로그 한 줄 없이 사라져
       *    "키를 만들 수 없는 행"(의도적 건너뜀)과 구분되지 않았다. 세 갈래를 갈라 분모와 함께 돌려준다.
       */
      try {
        await this.prisma.medicationCode.update({ where: { id: m.id }, data: { ingredientCode: key } });
        updated++;
      } catch (e) {
        failed++;
        this.logger.error(`ingredient-key derive 실패 id=${m.id}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    this.logger.log(`ingredient-key derive: updated=${updated}, skipped=${skipped}, failed=${failed} / total=${meds.length}`);
    return { updated, skipped, failed, total: meds.length };
  }

  /** 주성분 텍스트 → 정규화 동일성분 키('KR'+8hex). 동일 주성분(염/수화물·복합 순서 무관)=동일 키. */
  static ingredientKey(ingredient: string): string | null {
    if (!ingredient) return null;
    const SALT = /(염산염|황산염|인산염|질산염|말레산염|푸마르산염|구연산염|주석산염|호박산염|아세트산염|벤조산염|수화물|무수물|칼륨|나트륨|칼슘|마그네슘|에스테르|이수화물|일수화물)/g;
    const norm = (s: string) => s.replace(SALT, '').replace(/\([^)]*\)/g, '').replace(/\s+/g, '').trim();
    const parts = ingredient.split(/[/+,]/).map((p) => norm(p)).filter(Boolean).sort();
    if (!parts.length) return null;
    return 'KR' + createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 8).toUpperCase();
  }

  /**
   * ERP 청구 라인 백필(기간) — `GET /api/v1/integration/billing/lines?from&to`.
   *
   * 🔴 (2026-09-23 · 생태계 인바운드 §24 회수) 종전 `lte: new Date(to)` 는 두 가지를 동시에 틀렸다:
   *    ① `new Date('YYYY-MM-DD')` 는 TZ 와 무관하게 **UTC 자정**(KST 09:00) — 하루 밀림 계열 함정
   *    ② date-only 상한을 `lte: <그날 자정>` 으로 두면 **그날 수납이 통째로 빠진다** — ERP 가 `to=오늘` 로 당기면
   *       오늘 수납이 라인으로 안 들어갔다.
   *    ③ 형식이 틀린 날짜는 Invalid Date 가 Prisma 로 새어 500 이거나, 조건에 따라 **조용히 전건**이 됐다.
   *    → 날짜 구간 정본 `dayRange` 하나로 수렴(로컬 자정 `gte` · 다음 날 자정 미만 `lt` · 오타는 그 자리에서 400).
   */
  async backfillLines(from?: string, to?: string): Promise<Record<string, unknown>[]> {
    const where: Prisma.BillingWhereInput = {};
    const range = dayRange(from, to);
    if (range) where.createdAt = range;
    const billings = await this.prisma.billing.findMany({ where, select: { id: true, status: true }, orderBy: { createdAt: 'asc' }, take: 2000 });
    const out: Record<string, unknown>[] = [];
    for (const b of billings) {
      const lines = await this.buildLines(b.id, b.status === 'CANCELLED');
      out.push(...lines);
    }
    return out;
  }

  /**
   * 수납 목록
   */
  async findAll(filters: { status?: string; patientId?: string; page?: number; limit?: number }) {
    const page = filters.page ?? 1;
    const limit = filters.limit ?? 20;
    const where: Prisma.BillingWhereInput = {};
    if (filters.status) { assertEnumParam(filters.status, BillingStatus, '상태'); where.status = filters.status as BillingStatus; }
    // 🔴 patientId 를 무시하면 환자 차트 수납 탭에 **타 환자 수납 내역**이 렌더됨(PHI 교차 노출).
    if (filters.patientId) where.patientId = filters.patientId;

    const [data, total] = await Promise.all([
      this.prisma.billing.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          patient: { select: { id: true, mrn: true, familyName: true, givenName: true, insuranceType: true } },
        },
      }),
      this.prisma.billing.count({ where }),
    ]);

    return { data, pagination: { total, page, limit, hasMore: page * limit < total } };
  }

  /**
   * 수납 상세
   */
  async findById(id: string) {
    const billing = await this.prisma.billing.findUnique({
      where: { id },
      include: {
        patient: { select: { id: true, mrn: true, familyName: true, givenName: true, insuranceType: true } },
        encounter: {
          select: {
            id: true,
            visitType: true,
            signedAt: true,
            createdAt: true,
            doctor: { select: { familyName: true, givenName: true, department: true } },
            diagnoses: { include: { diagnosisCode: { select: { code: true, nameKo: true } } } },
          },
        },
        items: true,
      },
    });
    if (!billing) throw new NotFoundException('Billing not found');

    // 🔴 (P2-1) 법정 항목 분류는 서버가 정한다 — 진찰료·입원료 라인은 `PROCEDURE` 로 저장되므로
    //    codeType 만 보면 ⑨ 처치·수술료로 간다. 서버가 고른 코드(진찰료 AA157·AA257 · 입원료 병상 등급 코드)와
    //    수가 분류 칸(이름이 서식 항목과 정확히 같을 때만)으로 정한다. 정본 shared `receiptClassOf`.
    const classOf = await this.receiptClassResolver(billing.items);
    // DB 필드 → 프론트 필드 매핑 (codeType→type, codeName→name 등)
    const mappedItems = billing.items.map((item: typeof billing.items[number]) => ({
      ...item,
      receiptClass: classOf(item),
      type: item.codeType,
      category: item.codeType,
      name: item.codeName,
      code: item.codeId,
      totalPrice: item.amount,
      insuranceType: item.insuranceCategory ?? 'COVERED',
      fullCopay: item.fullCopay, // 급여 전액본인부담(100/100) 라인 마킹
    }));

    return { ...billing, items: mappedItems };
  }

  /**
   * 의료비 납입확인서(원무) — 환자 한 명·한 해의 월별 외래/입원 낸 돈.
   * 🔴 (2026-10-14 수납·청구 결함 발굴 P4-5) 종전 직원 화면은 환자 포털 EP(`/portal/medical-expenses`)를 직원 계정으로 불러
   *    늘 401 이었고, 응답 모양(`{month,count,paid}`)도 서식이 읽는 칸(외래 횟수·금액·입원 일수·금액)과 달라 칸이 0 이었다.
   *    낸 돈은 포털 연말정산과 같은 정본(`paymentEventsInRange`). 🔴 입원 **일수**는 이 원장으로 알 수 없어 null(지어내지 않음).
   */
  async getAnnualPaymentStatement(patientId: string, year: number) {
    if (!Number.isInteger(year) || year < 2000 || year > 2100) throw new BadRequestException('year 형식이 올바르지 않습니다');
    const start = new Date(`${year}-01-01T00:00:00+09:00`);
    const end = new Date(`${year + 1}-01-01T00:00:00+09:00`);
    const { events, billings } = await paymentEventsInRange(this.prisma, patientId, start, end);
    const inpatient = new Set(billings.filter((b) => b.encounter?.visitType === 'INPATIENT' || b.encounter?.visitType === 'INPATIENT_CONSULT').map((b) => b.id));
    const monthly = Array.from({ length: 12 }, (_, i) => {
      const m = events.filter((e) => e.at.getMonth() === i);
      const opd = m.filter((e) => !inpatient.has(e.billingId));
      const ipd = m.filter((e) => inpatient.has(e.billingId));
      return {
        month: i + 1,
        outpatientCount: new Set(opd.map((e) => e.billingId)).size,
        outpatientAmount: opd.reduce((t, e) => t + e.amount, 0),
        inpatientDays: null as number | null,
        inpatientCount: new Set(ipd.map((e) => e.billingId)).size,
        inpatientAmount: ipd.reduce((t, e) => t + e.amount, 0),
      };
    });
    return { year, patientId, monthly, total: events.reduce((t, e) => t + e.amount, 0), inpatientDaysKnown: false };
  }

  /** 입원료 수가 코드 설정 — 입원료 청구 생성과 영수증 분류가 같은 값을 읽는다 */
  /**
   * 입원료 수가코드·일당 정본(2026-10-22) — 퇴원 입원료 청구(createInpatientStayBilling)와 중간정산(quoteInpatientStay)이 같은 함수를 쓴다.
   * 🔴 종전 중간정산은 설정 일당(없으면 50,000)·건보 80% 상수로 따로 계산했다 — 같은 입원료에 산식이 둘이라
   *    중간에 받은 돈과 퇴원 청구 본인부담이 어긋났다(과납·미납이 퇴원 때 드러남).
   * 단가 출처를 함께 돌려준다 — DEFAULT_CONSTANT(설정이 하나도 없어 상수 50,000)는 근거 없는 단가라 화면이 그렇다고 말한다.
   */
  private async stayPricing(bedClass: string | null): Promise<
    | { ok: true; proc: { id: string; code: string; nameKo: string }; dailyRate: number; priceBasis: StayPriceBasis }
    | { ok: false; code: string }
  > {
    const { codesCfg, defaultCode } = await this.stayFeeCodeConfig();
    const code = (codesCfg && bedClass && codesCfg[bedClass]) || defaultCode;
    const asOf = new Date();
    const proc = await this.prisma.procedureCode.findFirst({
      where: { code, isActive: true, validFrom: { lte: asOf }, OR: [{ validTo: null }, { validTo: { gte: asOf } }] },
      orderBy: { validFrom: 'desc' },
    });
    if (!proc) return { ok: false, code };
    await this.applyTierPrices([proc]); // 입원료 단가도 고시 종별 단가(종별 명시 설정 때만)
    const codePrice = Number(proc.unitPrice ?? 0);
    if (codePrice > 0) return { ok: true, proc, dailyRate: codePrice, priceBasis: 'CODE' };
    // 🔴 설정 조회 실패는 삼키지 않는다 — 삼키면 "설정 없음 → 상수 50,000(DEFAULT_CONSTANT)"으로 읽혀 실패가 근거 없는 단가가 된다
    const rates = (await this.configRuntime?.get('inpatient.bedRates')) as Record<string, unknown> | null;
    const byClass = rates && bedClass ? Number(rates[bedClass]) : NaN;
    if (Number.isFinite(byClass) && byClass > 0) return { ok: true, proc, dailyRate: byClass, priceBasis: 'CONFIG_BED_CLASS' };
    const base = Number(await this.configRuntime?.get('inpatient.dailyRate'));
    if (Number.isFinite(base) && base > 0) return { ok: true, proc, dailyRate: base, priceBasis: 'CONFIG_DAILY' };
    return { ok: true, proc, dailyRate: 50000, priceBasis: 'DEFAULT_CONSTANT' };
  }

  /**
   * 입원료 견적(2026-10-22 중간정산) — 퇴원 입원료 청구와 **같은** 코드·일당(stayPricing)·급여율(resolveCopay INPATIENT).
   * 진료에 자격을 고정하지 않는다(encounterId 없이 부른다 — 견적이 원장을 바꾸지 않는다).
   * 수가코드를 못 찾으면 null 과 이유 — 금액을 지어내지 않는다.
   */
  async quoteInpatientStay(admissionId: string, days: number): Promise<
    | { ok: true; stayCode: string; stayName: string; days: number; dailyRate: number; priceBasis: StayPriceBasis; totalAmount: number; copayRate: number; copayAmount: number; insuranceAmount: number }
    | { ok: false; reason: string }
  > {
    const admission = await this.prisma.admission.findUnique({
      where: { id: admissionId },
      include: { bed: { select: { bedClass: true } }, patient: { select: { id: true, insuranceType: true } } },
    });
    if (!admission) throw new NotFoundException('입원 기록을 찾을 수 없습니다');
    const pricing = await this.stayPricing(admission.bed?.bedClass ?? null);
    if (!pricing.ok) return { ok: false, reason: `CODE_NOT_FOUND:${pricing.code}` };
    const totalAmount = days * pricing.dailyRate;
    const elig = await this.resolveCopay(admission.patient.id, admission.patient.insuranceType, 'INPATIENT');
    const copayAmount = stayCopayOf(totalAmount, elig.rate);
    return {
      ok: true, stayCode: pricing.proc.code, stayName: pricing.proc.nameKo, days, dailyRate: pricing.dailyRate, priceBasis: pricing.priceBasis,
      totalAmount, copayRate: elig.rate, copayAmount, insuranceAmount: totalAmount - copayAmount,
    };
  }

  private async stayFeeCodeConfig() {
    const codesCfg = (await this.configRuntime?.get('inpatient.bedRateCodes').catch(() => null)) as Record<string, string> | null;
    const defaultCode = String((await this.configRuntime?.get('inpatient.stayBilling.defaultCode').catch(() => null)) ?? 'AB1A0100');
    return { codesCfg, defaultCode };
  }

  /** 청구 라인 → 법정 항목(shared `receiptClassOf`) · 수가 코드는 한 번에 읽는다 */
  private async receiptClassResolver(items: { codeType: string; codeId: string }[]) {
    const procIds = [...new Set(items.filter((i) => i.codeType === 'PROCEDURE').map((i) => i.codeId))];
    const procs = procIds.length
      ? await this.prisma.procedureCode.findMany({ where: { id: { in: procIds } }, select: { id: true, code: true, category: true } })
      : [];
    const byId = new Map(procs.map((p) => [p.id, p]));
    // 입원료 코드 = 입원료 청구가 쓰는 같은 설정(병상 등급 매핑 + 기본 코드)
    const stayCodes = new Set<string>();
    if (procs.length) {
      const { codesCfg, defaultCode } = await this.stayFeeCodeConfig();
      for (const c of Object.values(codesCfg ?? {})) if (typeof c === 'string') stayCodes.add(c);
      stayCodes.add(defaultCode);
    }
    const consult = ALL_CONSULTATION_FEE_CODES; // 종별과 무관하게 진찰료 코드 전부(옛 청구의 AA157·AA257 포함)
    return (item: { codeType: string; codeId: string }) => {
      const proc = item.codeType === 'PROCEDURE' ? byId.get(item.codeId) : undefined;
      const role = proc ? (consult.has(proc.code) ? 'CONSULTATION_FEE' : stayCodes.has(proc.code) ? 'STAY_FEE' : null) : null;
      return receiptClassOf({ codeType: item.codeType, procedureCategory: proc?.category ?? null, role });
    };
  }

  /**
   * 영수증용 데이터 (법정 13개 항목 포함)
   */
  async getReceipt(id: string) {
    const billing = await this.findById(id);
    // 🔴 수납 원장 라인 동봉 — 복합결제(`paymentMethod='MIXED'`)일 때 영수증이 수단별 금액을
    //    말할 수 있는 유일한 근거다. 종전에는 영수증에 `MIXED` 만 찍혀 카드 얼마·현금 얼마인지
    //    환자도 원무도 그 종이에서 확인할 수 없었다.
    const payments = await this.prisma.billingPayment.findMany({
      where: { billingId: id },
      select: { method: true, amount: true, cardApprovalNo: true, cardCompany: true, installment: true, cashReceiptNo: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    });
    return {
      ...billing,
      encounterType: billing.encounter?.visitType ?? 'OUTPATIENT',
      payments,
    };
  }

  /**
   * 영수증 진위확인 발급 — IssuedDocument(RECEIPT)로 동결 + 진위 QR.
   * 멱등: 동일 billing의 기존 ORIGINAL 발급이 있으면 재사용(매 조회마다 신규 채번 방지).
   */
  async issueReceipt(id: string, issuedBy?: string) {
    const billing = await this.prisma.billing.findUnique({
      where: { id },
      include: { patient: { select: { id: true, mrn: true } } },
    });
    if (!billing) throw new NotFoundException('Billing not found');

    const existing = await this.prisma.issuedDocument.findFirst({
      where: { documentType: 'RECEIPT', sourceId: id, status: 'ORIGINAL' },
      orderBy: { issuedAt: 'desc' },
    });
    if (existing) {
      const base = publicBaseUrl();
      const qrUrl = `${base}/verify/document/${existing.issueNo}`;
      return { issueNo: existing.issueNo, status: existing.status, issuedAt: existing.issuedAt, hash: existing.hash, qrUrl };
    }

    // 발급 시점 동결 스냅샷(영수증 합계·자격구분 — PHI 최소화: MRN만, 성명 제외)
    const snapshot = {
      billingId: billing.id,
      mrn: billing.patient.mrn,
      totalAmount: billing.totalAmount,
      insuranceCovered: billing.insuranceCovered,
      patientCopay: billing.patientCopay,
      discountAmount: billing.discountAmount,
      paidAmount: billing.paidAmount,
      receiptNo: billing.receiptNo,
      copayCategory: billing.copayCategory,
      eligibilityStatus: billing.eligibilityStatus,
      issuedAtKst: new Date().toISOString(),
    };
    return this.document.issue(
      { documentType: 'RECEIPT', sourceId: id, patientId: billing.patientId, snapshot, formVersion: 'v1' },
      issuedBy,
    );
  }

  /**
   * 수납 처리 (결제)
   */
  async pay(
    id: string,
    dto: {
      amount: number;
      paymentMethod: string;
      voucherSerial?: string;
      cardApprovalNo?: string;
      cardCompany?: string;
      installment?: number;
      cashReceiptType?: string;
      cashReceiptNo?: string;
      discountAmount?: number;
      discountReason?: string;
      processedBy?: string;
    },
  ) {
    const billing = await this.prisma.billing.findUnique({
      where: { id },
      include: { encounter: { select: { id: true, prescriptions: { where: { status: 'ACTIVE' }, select: { id: true } } } } },
    });
    if (!billing) throw new DomainException(E.BILLING_NOT_FOUND, '수납 내역을 찾을 수 없습니다.', HttpStatus.NOT_FOUND);
    if (billing.status === 'PAID') throw new DomainException(E.BILLING_ALREADY_PAID, '이미 수납 완료된 건입니다.');
    if (billing.status === 'CANCELLED') throw new DomainException(E.BILLING_ALREADY_CANCELLED, '취소된 수납 건입니다.');
    // §4 봉합: 환불된 건 재수납 차단(환불 후 재결제로 원장 왜곡 방지)
    if (billing.status === 'REFUNDED') throw new BadRequestException('환불된 수납 건은 재수납할 수 없습니다(신규 청구 생성 필요).');

    // 감면: 최초 적용분 유지(누적결제 중 재적용 방지). 납부할금액 = 본인부담 - 감면
    const discountAmount = billing.discountAmount && billing.discountAmount > 0
      ? billing.discountAmount
      : Math.max(0, Math.min(dto.discountAmount ?? 0, billing.patientCopay));
    const payable = billing.patientCopay - discountAmount;
    const alreadyPaid = billing.paidAmount ?? 0;
    const remaining = payable - alreadyPaid;
    // 🔴 (2026-10-14 결함 발굴 수납 P1-1) 이미 받은 돈이 감면 뒤 납부할 금액보다 많으면 받지 않는다 — 환불로 정리할 일이다
    if (remaining < 0) {
      throw new DomainException(E.BILLING_PAYMENT_INVALID, '감면을 적용하면 이미 받은 금액이 납부할 금액보다 많습니다 — 수납이 아니라 환불로 정리하세요.', HttpStatus.CONFLICT, { alreadyPaid, payable });
    }

    // 결제수단별 라인 금액 산정 — 검진권은 redeem으로 충당(잔액·잔여부담 한도)
    let lineAmount: number;
    let voucherSerial: string | null = null;
    let voucherRedemptionId: string | null = null;
    const depositUses: { id: string; use: number }[] = []; // DEPOSIT 결제 시 예치금별 차감액(FIFO)
    if (dto.paymentMethod === 'VOUCHER') {
      if (!dto.voucherSerial) throw new DomainException(E.BILLING_PAYMENT_INVALID, '검진권 시리얼이 필요합니다.');
      const v = await this.prisma.checkupVoucher.findUnique({ where: { serial: dto.voucherSerial }, select: { status: true, balance: true, boundPatientId: true } });
      if (!v) throw new DomainException(E.BILLING_PAYMENT_INVALID, '검진권을 찾을 수 없습니다.', HttpStatus.NOT_FOUND);
      if (v.status !== 'ACTIVE') throw new DomainException(E.BILLING_PAYMENT_INVALID, `사용 불가 검진권 상태: ${v.status}`);
      if (v.boundPatientId !== billing.patientId) throw new DomainException(E.BILLING_PAYMENT_INVALID, '본인(환자) 검진권이 아닙니다.', HttpStatus.FORBIDDEN);
      const desiredUse = Math.min(v.balance, remaining); // 잔액·잔여부담 한도 → topup 미발생
      if (desiredUse <= 0) throw new DomainException(E.BILLING_PAYMENT_INVALID, '충당할 잔여 결제액 또는 검진권 잔액이 없습니다.');
      const r = await this.voucherService.redeem(dto.voucherSerial, { billingId: id, actualPrice: desiredUse, idempotencyKey: `billing:${id}:${dto.voucherSerial}` });
      lineAmount = r.amountUsed;
      voucherSerial = dto.voucherSerial;
      voucherRedemptionId = r.redemptionId;
    } else if (dto.paymentMethod === 'DEPOSIT') {
      // 선수금 충당 — 활성 예치금(FIFO) 잔액·잔여부담 한도. 실제 차감은 아래 tx에서 원자 수행.
      const deposits = await this.prisma.deposit.findMany({
        where: { patientId: billing.patientId, refundedAt: null, balance: { gt: 0 } },
        orderBy: { depositedAt: 'asc' },
        select: { id: true, balance: true },
      });
      const totalBalance = deposits.reduce((s, d) => s + d.balance, 0);
      const requested = dto.amount > 0 ? dto.amount : remaining;
      const desiredUse = Math.min(requested, remaining, totalBalance);
      if (desiredUse <= 0) {
        throw new DomainException(E.BILLING_PAYMENT_INVALID, `사용 가능한 선수금이 없습니다. (잔액 ${totalBalance.toLocaleString()}원·잔여부담 ${remaining.toLocaleString()}원)`);
      }
      let left = desiredUse;
      for (const d of deposits) {
        if (left <= 0) break;
        const use = Math.min(d.balance, left);
        depositUses.push({ id: d.id, use });
        left -= use;
      }
      lineAmount = desiredUse;
    } else {
      lineAmount = dto.amount;
      if (lineAmount <= 0) throw new DomainException(E.BILLING_PAYMENT_INVALID, '결제 금액이 올바르지 않습니다.');
      // 🔴 (2026-10-14 결함 발굴 수납 P1-1) 종전엔 카드·현금·이체만 남은 금액과 비교하지 않아, 부분 납부·감면·검진권 뒤
      //    빈 칸으로 수납하면 본인부담 전액이 또 결제로 기록되고 PAID 가 됐다(과다징수 · 넘친 돈을 기록하는 곳 없음).
      //    조용히 깎지 않는다 — 단말기에서 그 금액이 이미 승인됐을 수 있다. 남은 금액을 말하고 거부한다.
      if (remaining <= 0) {
        throw new DomainException(E.BILLING_PAYMENT_INVALID, '남은 납부 금액이 없습니다.', HttpStatus.CONFLICT, { remaining });
      }
      if (lineAmount > remaining) {
        throw new DomainException(E.BILLING_PAYMENT_INVALID, '결제 금액이 남은 납부 금액보다 많습니다.', HttpStatus.BAD_REQUEST, { amount: lineAmount, remaining });
      }
    }

    const newPaid = alreadyPaid + lineAmount;
    const status = newPaid >= payable ? 'PAID' : 'PARTIAL';
    // 결제수단 요약 라벨: 기존과 다른 수단이 섞이면 MIXED
    const methodLabel = alreadyPaid > 0 && billing.paymentMethod && billing.paymentMethod !== dto.paymentMethod ? 'MIXED' : dto.paymentMethod;

    // 분할라인 기록+수납 갱신+선수금 차감 — 단일 tx(부분 기록/차감 누락 방지)
    const updated = await this.prisma.$transaction(async (tx) => {
      // 선수금 차감(DEPOSIT) — 조건부 감산(잔액 부족 레이스 시 전체 롤백)
      for (const u of depositUses) {
        const r = await tx.deposit.updateMany({
          where: { id: u.id, refundedAt: null, balance: { gte: u.use } },
          data: { balance: { decrement: u.use } },
        });
        if (r.count !== 1) {
          throw new DomainException(E.BILLING_PAYMENT_INVALID, '선수금 잔액이 변경되었습니다. 다시 시도해주세요.', HttpStatus.CONFLICT);
        }
      }

      await tx.billingPayment.create({
        data: {
          billingId: id, method: dto.paymentMethod, amount: lineAmount,
          voucherSerial, voucherRedemptionId,
          cardApprovalNo: dto.cardApprovalNo ?? null, cashReceiptNo: dto.cashReceiptNo ?? null,
          // 카드사·할부는 **결제 라인**에 남긴다 — 복합결제(MIXED)면 카드 라인마다 다를 수 있어
          // 청구(Billing) 한 행에 요약해 담으면 어느 전표의 값인지 알 수 없다.
          cardCompany: dto.cardCompany ?? null,
          installment: dto.installment ?? null,
          processedBy: dto.processedBy ?? null,
        },
      });

      // 🔴 §6 봉합: lost-update 방지 — 읽은 paidAmount가 tx 커밋까지 불변일 때만 세팅(낙관적 락).
      // 동시 2결제 시 두 번째는 paidAmount 불일치로 0건→충돌 재시도(종전 무조건 세팅으로 한 결제 유실).
      const r = await tx.billing.updateMany({
        where: { id, paidAmount: billing.paidAmount, status: billing.status },
        data: {
          status,
          paidAt: new Date(),
          paidAmount: newPaid,
          paymentMethod: methodLabel,
          cardApprovalNo: dto.cardApprovalNo ?? billing.cardApprovalNo,
          cashReceiptType: dto.cashReceiptType ?? billing.cashReceiptType,
          cashReceiptNo: dto.cashReceiptNo ?? billing.cashReceiptNo,
          discountAmount,
          discountReason: discountAmount > 0 ? (dto.discountReason ?? billing.discountReason ?? null) : null,
          processedBy: dto.processedBy,
        },
      });
      if (r.count !== 1) {
        throw new DomainException(E.BILLING_PAYMENT_INVALID, '수납 정보가 변경되었습니다. 다시 시도해주세요.', HttpStatus.CONFLICT);
      }
      // 재조회 없이 알고 있는 최종값으로 조합(encounter는 진입 시 include) — findUnique 1회
      return {
        ...billing,
        status,
        paidAt: new Date(),
        paidAmount: newPaid,
        paymentMethod: methodLabel,
        cardApprovalNo: dto.cardApprovalNo ?? billing.cardApprovalNo,
        cashReceiptType: dto.cashReceiptType ?? billing.cashReceiptType,
        cashReceiptNo: dto.cashReceiptNo ?? billing.cashReceiptNo,
        discountAmount,
        discountReason: discountAmount > 0 ? (dto.discountReason ?? billing.discountReason ?? null) : null,
        processedBy: dto.processedBy,
      };
    });

    // 수납 완료 시 WaitingQueue 상태 + 여정 이벤트
    if (status === 'PAID') {
      const hasPrescriptions = (updated.encounter?.prescriptions?.length ?? 0) > 0;
      const nextStatus = hasPrescriptions ? 'PHARMACY_WAITING' : 'VISIT_COMPLETED';

      await this.prisma.waitingQueue.updateMany({
        where: { encounterId: billing.encounterId, status: 'CASHIER_WAITING' },
        data: { status: nextStatus },
      });

      // 여정 이벤트 발행
      try {
        this.journey?.emit({
            patientId: billing.patientId,
            eventType: 'BILLING_PAID', refType: 'Billing', refId: billing.id, // 여정 P0-5
            title: '수납 완료',
            description: hasPrescriptions ? '약국에서 처방약을 수령하세요' : '진료가 완료되었습니다',
          });
      } catch { /* 여정 이벤트 실패해도 수납 완료는 유지 */ }
    }

    return updated;
  }

  /** 수납 결제 옵션 — 잔여 부담액 + 환자 보유 활성 검진권(적용가능액) */
  async getPaymentOptions(id: string) {
    const billing = await this.prisma.billing.findUnique({ where: { id }, select: { id: true, patientId: true, patientCopay: true, discountAmount: true, paidAmount: true, status: true } });
    if (!billing) throw new DomainException(E.BILLING_NOT_FOUND, '수납 내역을 찾을 수 없습니다.', HttpStatus.NOT_FOUND);
    const payable = billing.patientCopay - (billing.discountAmount ?? 0);
    const remaining = Math.max(0, payable - (billing.paidAmount ?? 0));
    const [vouchers, depositAgg] = await Promise.all([
      this.prisma.checkupVoucher.findMany({
        where: { boundPatientId: billing.patientId, status: 'ACTIVE', balance: { gt: 0 } },
        select: { serial: true, form: true, programId: true, faceValue: true, balance: true, expiresAt: true },
        orderBy: { expiresAt: 'asc' }, take: 50,
      }),
      this.prisma.deposit.aggregate({
        where: { patientId: billing.patientId, refundedAt: null, balance: { gt: 0 } },
        _sum: { balance: true },
      }),
    ]);
    const depositBalance = depositAgg._sum.balance ?? 0;
    return {
      billingId: billing.id, payable, remaining, status: billing.status,
      paymentMethods: ['CARD', 'CASH', 'TRANSFER', 'DEPOSIT', ...(vouchers.length ? ['VOUCHER'] : [])],
      vouchers: vouchers.map((v) => ({ ...v, applicable: Math.min(v.balance, remaining) })),
      depositBalance, // 환자 활성 선수금 잔액 합(DEPOSIT 적용가능액 = min(잔액, remaining))
      depositApplicable: Math.min(depositBalance, remaining),
    };
  }

  /**
   * 수납 대기 목록 (원무과 큐)
   */
  async getCashierQueue() {
    const data = await this.prisma.billing.findMany({
      where: { status: 'PENDING' },
      orderBy: { createdAt: 'asc' },
      include: {
        patient: {
          select: { id: true, mrn: true, familyName: true, givenName: true, insuranceType: true },
        },
        encounter: {
          select: {
            id: true,
            doctor: { select: { id: true, familyName: true, givenName: true, department: true } },
          },
        },
      },
    });
    return { data };
  }

  /**
   * 오늘의 수납 통계
   */
  async getCashierStats() {
    if (this.cache) {
      return this.cache.getOrSet('billing:cashier-stats', 15, () => this._getCashierStats());
    }
    return this._getCashierStats();
  }

  /**
   * 오늘의 수납 통계.
   *
   * 🔴 원 결함(W8 이연·2026-08-14 회수): 이 EP 에는 '미수납' 정본이 없어서 화면이 제각각 만들었다 —
   *    `/billing` 수납 화면은 `deferredCount`(DEFERRED 만)를 "미수납"이라 부르고,
   *    대시보드 위젯은 `pendingCount`(PENDING 만)를 "미수납"이라 불렀는데,
   *    경영 정본 `/executive overview.unpaid` 는 **PENDING+PARTIAL+DEFERRED** 다.
   *    같은 병원의 같은 순간에 '미수납'이 세 가지 수로 말해졌다(P12).
   *
   *    회수: 집합 정본 `UNPAID_STATUS`(journey-console/flow-canon)를 **그대로 불러** `unpaidCount`
   *    를 낸다. 새 계산식을 만들지 않는다. `pendingCount`/`deferredCount` 는 지우지 않되
   *    **상태별 내역**이라는 원래 뜻으로 남긴다(수납 대기열 = PENDING · 후불 = DEFERRED).
   *
   *    🔴 금액은 여기서 내지 않는다 — 미수납 **금액** 정본은 `/executive overview.unpaid.amount`
   *    (patientCopay − paidAmount) 하나다. 여기서 또 만들면 금액이 두 벌이 된다.
   */
  private async _getCashierStats() {
    const todayStart = this.getTodayStart();
    const todayEnd = new Date(todayStart);
    todayEnd.setDate(todayEnd.getDate() + 1);

    const [pending, completed, deferred, unpaid, revenueResult] = await Promise.all([
      this.prisma.billing.count({ where: { status: 'PENDING' } }),
      this.prisma.billing.count({
        where: { status: 'PAID', paidAt: { gte: todayStart, lt: todayEnd } },
      }),
      this.prisma.billing.count({ where: { status: 'DEFERRED' } }),
      // 🔴 미수납 정본 — /executive·/journey-console 과 **같은 집합**
      this.prisma.billing.count({ where: { status: { in: UNPAID_STATUS } } }),
      this.prisma.billing.aggregate({
        _sum: { paidAmount: true },
        where: { paidAt: { gte: todayStart, lt: todayEnd }, status: { in: ['PAID', 'PARTIAL'] } },
      }),
    ]);

    return {
      data: {
        /** 수납 대기(PENDING) — '미수납'이 아니다. 미수납은 `unpaidCount` */
        pendingCount: pending,
        completedCount: completed,
        /** 후불 보류(DEFERRED) — '미수납' 전체가 아니다 */
        deferredCount: deferred,

        // ── 미수납 정본(전 기간·PENDING+PARTIAL+DEFERRED) ──
        unpaidCount: unpaid,
        unpaidStatuses: UNPAID_STATUS,
        unpaidScope: 'ALL_TIME',
        unpaidBasis: '전 기간 미수납(PENDING·PARTIAL·DEFERRED) 건수 — /executive overview.unpaid 와 같은 집합. 금액 정본은 /executive overview.unpaid.amount',

        totalRevenue: revenueResult._sum.paidAmount ?? 0,
      },
    };
  }

  /**
   * billing.adjusted 정정 체인(ERP #2 — correctionOf 버전 방식).
   * 같은 billing의 직전 조정 이벤트를 correctionOf로 참조하고 revision을 증가시켜,
   * ERP가 정정본을 원본에 연결(과거 DEAD 적재 해소). 첫 정정이면 원 청구 ref를 참조.
   */
  private async billingCorrection(billingId: string): Promise<{ correctionOf: string; revision: number }> {
    const prior = await this.prisma.integrationOutbox.findMany({
      where: { event: 'billing.adjusted', payload: { path: ['billingId'], equals: billingId } },
      orderBy: { createdAt: 'desc' },
      select: { ref: true },
    }).catch(() => [] as { ref: string }[]);
    const lastRef = prior[0]?.ref?.split('::wh:')[0];
    return { correctionOf: lastRef ?? `billing:${billingId}`, revision: prior.length + 1 };
  }

  /**
   * 수납 취소
   */
  async cancel(id: string, reason: string, processedBy?: string) {
    const billing = await this.prisma.billing.findUnique({ where: { id } });
    if (!billing) throw new NotFoundException('Billing not found');
    if (!['PENDING', 'PARTIAL'].includes(billing.status)) {
      throw new BadRequestException('PENDING 또는 PARTIAL 상태만 취소 가능합니다.');
    }

    // PARTIAL 취소 시 이미 수납한 현금/카드(paidAmount)를 환급으로 기록 — 받은 돈이 시스템상 반환 흔적 없이
    // CANCELLED 되던 회계 누락 방지(일일정산 환불금액에 반영).
    const alreadyPaid = billing.status === 'PARTIAL' ? (billing.paidAmount ?? 0) : 0;
    // 🔴 (2026-10-14 결함 발굴 수납 P1-5) 읽은 상태·납부액 그대로일 때만 — 종전엔 무조건 갱신이라 취소와 수납이 겹치면
    //    낡은 paidAmount 로 환급액을 적어 방금 받은 돈이 환급 기록에서 빠졌다
    const now = new Date();
    const cancelled = await this.prisma.billing.updateMany({
      where: { id, status: billing.status, paidAmount: billing.paidAmount },
      data: {
        status: 'CANCELLED',
        cashierNote: reason,
        ...(processedBy ? { processedBy } : {}),
        ...(alreadyPaid > 0 ? { refundAmount: alreadyPaid, refundedAt: now, refundReason: `취소 환급: ${reason}` } : {}),
      },
    });
    if (cancelled.count !== 1) throw new DomainException(E.BILLING_PAYMENT_INVALID, '수납 정보가 변경되었습니다. 다시 시도해주세요.', HttpStatus.CONFLICT);
    const updated = { ...billing, status: 'CANCELLED' as const, cashierNote: reason, ...(alreadyPaid > 0 ? { refundAmount: alreadyPaid, refundedAt: now } : {}) };
    // ERP 회계 정정(실시간) — 역분개 트리거 + 정정 체인(#2)
    const cxlCorr = await this.billingCorrection(id);
    void this.outbox.enqueue('billing', 'billing.adjusted', `billing:cancel:${id}`, {
      billingId: id, type: 'CANCEL', amount: updated.paidAmount ?? updated.totalAmount ?? 0,
      // 🔴 (P5-6) `amount` 는 결제 전 취소면 **청구 총액**(보험자 부담 포함)이다 — 돌려준 돈과 다르다. 의미를 갈라 함께 싣는다
      //    (ERP 계약 변경 없이 덧붙임 · ERP 가 어느 쪽을 쓸지는 ERP 몫): cashReversal = 환자에게 돌려준 돈 · billedTotal = 청구 총액
      cashReversal: alreadyPaid, billedTotal: billing.totalAmount,
      paymentMethod: billing.paymentMethod ?? null, // ERP 역분개 계정 분류(CARD/CASH/TRANSFER) — 카드환불이 현금시재 깎던 오분류 방지
      correctionOf: cxlCorr.correctionOf, revision: cxlCorr.revision, // ERP #2 — 원본 참조·버전
      reason, at: new Date().toISOString(),
    });
    // ERP 진료라인 피드 — 취소: 라인별 cancelled=true 재송신(ERP가 중간계산에서 치환)
    void this.emitBillingLines(id, true);
    // 검진권 결제분 역상환(PARTIAL 취소 시·A2)
    const rev = await this.voucherService.reverseRedemption(id, reason || '수납 취소');
    if (rev.count > 0) (updated as Record<string, unknown>).voucherReversed = rev.reversed;
    // (P1-5) 환급 원장 — 환자에게 돌려준 돈(검진권으로 되돌린 몫 제외)을 그 날짜로 남긴다
    if (alreadyPaid > 0) await this.recordRefundLine(id, alreadyPaid - (rev.totalRestored ?? 0), processedBy ?? null);
    return { ...updated, claimReview: await this.claimReviewFor(id) };
  }

  /**
   * 🔴 (2026-10-14 수납·청구 결함 발굴 P5-5) 환불·취소한 수납에 이미 보험 청구가 있으면 그 사실을 돌려준다.
   *    종전엔 전액 환불해도 청구가 그대로 남아 보험자 부담분이 계속 청구됐다. 청구 정정·취하는 원무 판단이라
   *    (일어난 사실은 소급하지 않는다) 자동으로 바꾸지 않고, 검토할 청구를 응답에 실어 화면이 말하게 한다.
   */
  private async claimReviewFor(billingId: string) {
    const claims = await this.prisma.claim.findMany({ where: { billingId, status: { not: 'REJECTED' } }, select: { id: true, status: true, claimNumber: true } });
    if (!claims.length) return null;
    this.logger.warn(`환불·취소된 수납 ${billingId} 에 보험 청구 ${claims.length}건 — 청구 정정 검토 필요 (${claims.map((c) => `${c.id}:${c.status}`).join(', ')})`);
    return { needed: true, claims };
  }

  /**
   * 환불 원장 라인(P1-5) — `billing_payments` 에 **음수** 금액·method `REFUND` 로, 환불한 그 시각에.
   * 🔴 종전엔 누적 refundAmount 를 마지막 refundedAt 날짜로 세어, 1일 10,000·2일 5,000 이면 1일 환불이 사라지고 2일에 15,000 이었다.
   *    검진권으로 되돌린 몫은 환자에게 돌려준 돈이 아니다(그 몫까지 세면 같은 금액이 두 번 환불로 남았다).
   */
  private async recordRefundLine(billingId: string, amountToPatient: number, processedBy: string | null) {
    if (amountToPatient <= 0) return;
    await this.prisma.billingPayment.create({ data: { billingId, method: REFUND_LEDGER_METHOD, amount: -amountToPatient, processedBy } });
  }

  /**
   * 환불 처리
   */
  async refund(
    id: string,
    dto: { amount: number; reason: string; processedBy?: string },
  ) {
    const billing = await this.prisma.billing.findUnique({ where: { id } });
    if (!billing) throw new NotFoundException('Billing not found');
    if (billing.status !== 'PAID') {
      throw new BadRequestException('PAID 상태만 환불 가능합니다.');
    }
    if (dto.amount <= 0) {
      throw new BadRequestException('환불 금액은 0보다 커야 합니다.');
    }
    // §4 봉합: 기환불분 차감 후 잔여로 가드(refundAmount 덮어쓰기→누적으로 변경). 반복 부분환불 초과 방지
    const alreadyRefunded = billing.refundAmount ?? 0;
    const refundableRemaining = (billing.paidAmount ?? 0) - alreadyRefunded;
    if (dto.amount > refundableRemaining) {
      throw new DomainException(E.BILLING_REFUND_EXCEEDS, `환불 가능액(${refundableRemaining.toLocaleString()}원·기환불 차감) 초과입니다.`);
    }
    const totalRefunded = alreadyRefunded + dto.amount;
    const isFullRefund = totalRefunded >= (billing.paidAmount ?? 0);

    // 🔴 (P1-5) 읽은 누적 환불액 그대로일 때만 — 동시 부분환불 둘이 둘 다 가드를 통과해 마지막 값으로 덮이고
    //    ERP 환불 이벤트는 2건 나가던 것 · 0건이면 재시도하게 한다
    const refundedAt = new Date();
    const claimed = await this.prisma.billing.updateMany({
      where: { id, status: 'PAID', refundAmount: billing.refundAmount },
      data: {
        status: isFullRefund ? 'REFUNDED' : 'PAID',
        refundAmount: totalRefunded, // 누적 총 환불액(덮어쓰기 아님)
        refundedAt,
        refundReason: dto.reason,
        processedBy: dto.processedBy,
      },
    });
    if (claimed.count !== 1) throw new DomainException(E.BILLING_PAYMENT_INVALID, '수납 정보가 변경되었습니다. 다시 시도해주세요.', HttpStatus.CONFLICT);
    const updated = { ...billing, status: isFullRefund ? 'REFUNDED' as const : 'PAID' as const, refundAmount: totalRefunded, refundedAt, refundReason: dto.reason, processedBy: dto.processedBy ?? billing.processedBy };
    const rfdCorr = await this.billingCorrection(id);
    void this.outbox.enqueue('billing', 'billing.adjusted', `billing:refund:${id}:${Date.now()}`, {
      billingId: id, type: 'REFUND', amount: dto.amount, fullRefund: isFullRefund,
      paymentMethod: billing.paymentMethod ?? null, // ERP 역분개 계정 분류 — 원결제수단으로 환불
      correctionOf: rfdCorr.correctionOf, revision: rfdCorr.revision, // ERP #2 — 원본 참조·버전
      reason: dto.reason, at: new Date().toISOString(),
    });
    // 검진권 결제분 역상환(A2) — 전액=전체 / 부분=결제비중 비례
    const rev = isFullRefund
      ? await this.voucherService.reverseRedemption(id, dto.reason || '수납 환불', dto.processedBy ?? null)
      : await this.voucherService.reverseRedemption(id, dto.reason || '수납 부분환불', dto.processedBy ?? null, { refundAmount: dto.amount, totalPaid: billing.paidAmount ?? 0 });
    if (rev.count > 0) (updated as Record<string, unknown>).voucherReversed = rev.reversed;
    await this.recordRefundLine(id, dto.amount - (rev.totalRestored ?? 0), dto.processedBy ?? null);
    // 🔴 (P1-5 남은 것 · 2026-10-14 P5) 선수금(예치금)으로 낸 몫 — 환불을 예치금으로 돌릴지 현금으로 줄지는 사람 결정
    //    `billing.depositRefundRestore`. 정하기 전에는 예치금을 자동으로 되살리지 않고, 그 몫을 응답이 밝힌다(창구가 안다).
    const depositPaid = (await this.prisma.billingPayment.aggregate({ where: { billingId: id, method: 'DEPOSIT' }, _sum: { amount: true } }))._sum.amount ?? 0;
    const depositPortion = depositPaid > 0 && (billing.paidAmount ?? 0) > 0
      ? (isFullRefund ? depositPaid : Math.min(depositPaid, roundBy((dto.amount * depositPaid) / (billing.paidAmount as number), 'money') ?? 0))
      : 0;
    return { ...updated, depositPortion, claimReview: await this.claimReviewFor(id) };
  }

  /**
   * 수납 보류 (미수 처리)
   */
  async defer(id: string, dto: { reason: string; processedBy?: string }) {
    const billing = await this.prisma.billing.findUnique({ where: { id } });
    if (!billing) throw new NotFoundException('Billing not found');
    if (billing.status !== 'PENDING') {
      throw new BadRequestException('PENDING 상태만 보류 가능합니다.');
    }

    return this.prisma.billing.update({
      where: { id },
      data: {
        status: 'DEFERRED',
        deferredReason: dto.reason,
        processedBy: dto.processedBy,
      },
    });
  }

  /**
   * 일마감 → ERP 전표 통보(billing.settled). 합의: 일마감 단위 집계 전송.
   */
  async dailyClose(date?: string) {
    // 🔴 getTodayStart()=KST 자정인데 `.toISOString().slice(0,10)` 은 UTC 날짜(전날)를 준다 →
    //    getDailySummary 가 KST 로 해석하는 것과 어긋나 "오늘 일마감"이 어제 전표를 ERP 로 보냈다.
    //    정본 localDateKey(KST 날짜)로 정합한다(화면 '오늘 매출'과 같은 날).
    const targetDate = date ?? localDateKey(this.getTodayStart());
    const summary = await this.getDailySummary(targetDate);
    await this.outbox.enqueue('billing', 'billing.settled', `billing:settled:${targetDate}`, {
      date: targetDate, summary,
    });
    return { date: targetDate, sent: true, summary };
  }

  /**
   * 일일 정산 요약
   */
  async getDailySummary(date?: string) {
    // 🔴 `new Date('2026-06-10')` 은 **UTC 자정 = KST 09:00** 이다. 그래서 하루가 09:00~익일 09:00 으로
    //    밀려 **오전 9시 이전 수납이 전날 매출로** 계상됐다(실측 6/10 집계에 KST 6/11 08:01 수납
    //    115,551원이 포함). 같은 화면의 '오늘 매출'(getTodayStart = 로컬 자정)과도 창이 달랐다(P12).
    //    날짜 문자열은 **로컬(KST) 자정**으로 해석한다.
    const targetDate = date ? new Date(`${date}T00:00:00`) : this.getTodayStart();
    const nextDate = new Date(targetDate);
    nextDate.setDate(nextDate.getDate() + 1);

    const dateFilter = { gte: targetDate, lt: nextDate };

    const [byPaymentMethod, unledgeredAgg, billingSumAgg, byInsuranceType, refundAgg, cancelCount, deferredAgg] =
      await Promise.all([
        // 🔴 결제 수단별 집계는 **수납 원장(billing_payments)** 을 읽는다.
        //    종전에는 `Billing.paymentMethod` 로 group by 했는데 그것은 수단이 아니라 **요약 라벨**이라
        //    복합결제가 `MIXED` 한 줄로 뭉쳤다(실측: 카드 18,535 + 현금 18,535 인 수납 1건이
        //    `mixed 37,070` 으로만 보여 **카드사 대사·현금 시재 양쪽에서 그 금액이 사라졌다**).
        //    수단별 사실은 원장에만 있고, 그 원장을 읽는 코드가 저장소에 하나도 없었다.
        //    창 기준도 원장이 옳다 — 라인의 createdAt 이 **그 돈이 실제로 들어온 날**이다
        //    (분할수납이면 Billing.paidAt 은 마지막 결제일로 덮여 어제 받은 돈이 오늘로 딸려온다).
        //    🔴 모집단은 총계와 맞춘다 — 취소된 수납의 라인까지 세면 수단별 합이 총계를 넘고
        //       그 차이가 "분할수납" 으로 잘못 읽힌다(배포 후 실측에서 나왔다: 취소건 1,000원).
        this.prisma.billingPayment.groupBy({
          by: ['method'],
          where: { createdAt: dateFilter, method: { not: REFUND_LEDGER_METHOD }, billing: { status: { in: ['PAID', 'PARTIAL'] } } },
          _sum: { amount: true },
          _count: true,
        }),
        // 원장 라인이 하나도 없는 수납 — 수단을 **모른다**. 0원도 현금도 아니라 '미기록'으로 밝힌다
        this.prisma.billing.aggregate({
          where: { paidAt: dateFilter, status: { in: ['PAID', 'PARTIAL'] }, payments: { none: {} } },
          _count: true,
          _sum: { paidAmount: true },
        }),
        // 대사용 — 수납 기준 합계(원장 합과 어긋나면 그 사실을 화면이 말한다)
        this.prisma.billing.aggregate({
          where: { paidAt: dateFilter, status: { in: ['PAID', 'PARTIAL'] } },
          _count: true,
          _sum: { paidAmount: true },
        }),
        // 보험 유형별 집계 (환자 보험 타입 기준)
        this.prisma.billing.findMany({
          where: { paidAt: dateFilter, status: { in: ['PAID', 'PARTIAL'] } },
          select: {
            paidAmount: true,
            patient: { select: { insuranceType: true } },
          },
        }),
        // 환불 건수·금액 — 🔴 (P1-5) 환불 원장 라인(그 날 돌려준 돈) + 원장 이전 환불(라인 없는 수납의 누적값 · 종전 정의)
        Promise.all([
          this.prisma.billingPayment.aggregate({ where: { createdAt: dateFilter, method: REFUND_LEDGER_METHOD }, _count: true, _sum: { amount: true } }),
          this.prisma.billing.aggregate({ where: { refundedAt: dateFilter, payments: { none: { method: REFUND_LEDGER_METHOD } } }, _count: true, _sum: { refundAmount: true } }),
        ]),
        // 취소 건수
        this.prisma.billing.count({
          where: { status: 'CANCELLED', updatedAt: dateFilter },
        }),
        // 보류 건수·금액
        this.prisma.billing.aggregate({
          where: { status: 'DEFERRED', updatedAt: dateFilter }, _count: true, _sum: { patientCopay: true },
        }),
      ]);

    // 보험 유형별 합산 — byInsurance({count,amount}·FE) + byInsuranceType({count,totalAmount}·레거시 병행)
    const byInsurance: Record<string, { count: number; amount: number }> = {};
    const byInsuranceType_legacy: Record<string, { count: number; totalAmount: number }> = {};
    for (const b of byInsuranceType) {
      const type = b.patient.insuranceType;
      if (!byInsurance[type]) { byInsurance[type] = { count: 0, amount: 0 }; byInsuranceType_legacy[type] = { count: 0, totalAmount: 0 }; }
      byInsurance[type].count++;
      byInsurance[type].amount += b.paidAmount ?? 0;
      byInsuranceType_legacy[type].count++;
      byInsuranceType_legacy[type].totalAmount += b.paidAmount ?? 0;
    }

    // 결제수단별 금액 → 소문자 키 record(FE 기대). 원장 라인 기준
    const pmMap: Record<string, number> = {};
    let ledgerSum = 0, ledgerCount = 0;
    for (const g of byPaymentMethod) {
      const amt = g._sum.amount ?? 0;
      const key = (g.method ?? 'UNKNOWN').toLowerCase();
      pmMap[key] = (pmMap[key] ?? 0) + amt;
      ledgerSum += amt;
      ledgerCount += g._count;
    }
    // 원장에 라인이 없는 수납분 — 수단 미기록으로 **금액과 건수를 함께** 드러낸다(숨기면 총계만 안 맞는다)
    const unledgeredAmount = unledgeredAgg._sum.paidAmount ?? 0;
    const unledgeredCount = unledgeredAgg._count;
    if (unledgeredCount > 0) pmMap.unknown = (pmMap.unknown ?? 0) + unledgeredAmount;

    // 🔴 총계는 종전 정의(수납 기준 Σ paidAmount)를 유지한다 — 매출 총액의 정본을 조용히 바꾸지 않는다.
    //    대신 원장 합과 어긋나면 그 차이를 함께 내보내 **대사 가능한 사실**로 만든다.
    const billingSum = billingSumAgg._sum.paidAmount ?? 0;
    const totalRevenue = billingSum;
    const totalCount = billingSumAgg._count;
    const ledgerDifference = billingSum - (ledgerSum + unledgeredAmount);

    // 🔴 (2026-10-22) 입원 중간정산 수납 — 별도 표(interim_billings)라 종전엔 이 집계에 **어디에도** 없었다.
    //    그 날 창구에 들어온 돈인데 시재·카드 대사에서 보이지 않았다. 총계(totalRevenue)에는 섞지 않는다 —
    //    ERP 합의 (가)안: 중간수납 현금은 `billing.interim_paid` 로 따로 전표가 된다(여기 합치면 두 번 잡힌다).
    const [interimByMethod, interimUnledgered, interimRefundByMethod] = await Promise.all([
      this.prisma.interimBillingPayment.groupBy({ by: ['method'], where: { createdAt: dateFilter }, _sum: { amount: true }, _count: true }),
      // 원장 줄 이전(2026-10-22 전) 수납 — 수단을 모른다(지어내지 않는다)
      this.prisma.interimBilling.aggregate({ where: { status: 'PAID', paidAt: dateFilter, payments: { none: {} } }, _count: true, _sum: { paidAmount: true } }),
      // 그 날 돌려준 중간정산 환불(ERP R5 · 전표는 billing.interim_refunded) — 수납 합에서 빼지 않고 따로 말한다
      this.prisma.interimBillingRefund.groupBy({ by: ['method'], where: { refundedAt: dateFilter }, _sum: { amount: true }, _count: true }),
    ]);
    const interimPayments = {
      settledExcluded: true as const, // 일마감 전표(billing.settled) 합계에 포함하지 않는다 — 전표는 billing.interim_paid
      count: interimByMethod.reduce((n, g) => n + g._count, 0) + interimUnledgered._count,
      amount: interimByMethod.reduce((n, g) => n + (g._sum.amount ?? 0), 0) + Number(interimUnledgered._sum.paidAmount ?? 0),
      byMethod: Object.fromEntries(interimByMethod.map((g) => [g.method.toLowerCase(), g._sum.amount ?? 0])) as Record<string, number>,
      unledgeredCount: interimUnledgered._count,
      unledgeredAmount: Number(interimUnledgered._sum.paidAmount ?? 0),
      refundCount: interimRefundByMethod.reduce((n, g) => n + g._count, 0),
      refundAmount: interimRefundByMethod.reduce((n, g) => n + (g._sum.amount ?? 0), 0),
      refundByMethod: Object.fromEntries(interimRefundByMethod.map((g) => [g.method.toLowerCase(), g._sum.amount ?? 0])) as Record<string, number>,
    };

    return {
      data: {
        // 로컬(KST) 자정 기준이므로 toISOString 으로 되돌리면 하루 밀린다 — 로컬 달력 날짜로 돌려준다
        date: `${targetDate.getFullYear()}-${String(targetDate.getMonth() + 1).padStart(2, '0')}-${String(targetDate.getDate()).padStart(2, '0')}`,
        totalCount,
        totalRevenue,
        byPaymentMethod: pmMap,
        byInsurance,
        byInsuranceType: byInsuranceType_legacy, // 하위호환({count,totalAmount})
        // 수납 원장 대사 — 수단별 막대가 총계와 어긋나는 이유를 화면이 말할 수 있게
        ledger: {
          ledgerSum,                 // 그 날 원장에 기록된 수단별 합
          ledgerCount,               // 원장 라인 수(수납 건수가 아니다 — 복합결제는 한 수납에 여러 라인)
          unledgeredCount,           // 수납됐는데 원장 라인이 없는 건수
          unledgeredAmount,
          billingSum,                // 수납(Billing.paidAmount) 기준 합 = totalRevenue
          difference: ledgerDifference, // 0이 아니면 분할수납이 날짜를 걸쳤다는 뜻(어느 쪽도 틀린 값은 아니다)
        },
        refundCount: refundAgg[0]._count + refundAgg[1]._count,
        refundAmount: -(refundAgg[0]._sum.amount ?? 0) + (refundAgg[1]._sum.refundAmount ?? 0),
        cancelCount,
        deferredCount: deferredAgg._count,
        deferredAmount: deferredAgg._sum.patientCopay ?? 0,
        interimPayments,
      },
    };
  }

  /**
   * 보류(미수) 목록
   */
  async getDeferred() {
    const data = await this.prisma.billing.findMany({
      where: { status: 'DEFERRED' },
      orderBy: { createdAt: 'asc' },
      include: {
        patient: {
          select: { id: true, mrn: true, familyName: true, givenName: true, insuranceType: true },
        },
      },
    });
    return { data };
  }

  /**
   * 🔴 W8 R3 C3 — 계산기 본인부담률 해소. **정본은 `EligibilityService.resolveCopayRate` 하나**다.
   * 자격 정보가 아예 없을 때 0% 로 단정하지 않는다:
   *  - 의료급여(MEDICAID)는 1종(0%)·2종(외래 15%) 구분이 자격조회에만 있으므로 **산출 불가**로 말한다.
   *  - 그 밖의 보험유형은 폴백값을 쓰되 `confirmed:false`(가정치)임을 화면에 넘긴다
   *    (산정특례 10%·차상위 14%·자격상실 100% 는 자격조회 없이는 알 수 없다).
   */
  private async resolveCalculatorCopay(
    patientId: string | undefined,
    insuranceType: InsuranceType,
    visitType: 'OUTPATIENT' | 'INPATIENT',
    encounterId: string | undefined,
    hasEligibility: boolean,
  ): Promise<{ rate: number | null; copayCategory: string | null; basis: 'ELIGIBILITY' | 'INSURANCE_TYPE_FALLBACK' | 'UNKNOWN'; confirmed: boolean; note: string | null }> {
    if (!patientId) {
      return { rate: null, copayCategory: null, basis: 'UNKNOWN', confirmed: false, note: '환자 정보가 없어 본인부담률을 산출할 수 없습니다' };
    }
    const { rate, copayCategory } = await this.eligibility.resolveCopayRate(patientId, insuranceType, visitType, encounterId);
    if (hasEligibility) {
      return { rate, copayCategory, basis: 'ELIGIBILITY', confirmed: true, note: null };
    }
    if (insuranceType === 'MEDICAID') {
      return {
        rate: null,
        copayCategory: null,
        basis: 'UNKNOWN',
        confirmed: false,
        note: '자격 미확인 — 의료급여 1종(0%)·2종(외래 15%) 구분을 알 수 없어 본인부담을 산출할 수 없습니다. 수진자 자격조회 후 재계산하십시오',
      };
    }
    return {
      rate,
      copayCategory: copayCategory ?? insuranceType,
      basis: 'INSURANCE_TYPE_FALLBACK',
      confirmed: false,
      note: `자격 미확인 — 보험유형(${insuranceType}) 기준 가정치입니다. 산정특례(10%)·차상위(14%)·자격상실(100%)은 반영되지 않았습니다`,
    };
  }

  /**
   * 예약 진료 예상 본인부담(2026-10-20 포털 P3 B6 · 결정 `portal.costEstimate` = SHOW_AS_ESTIMATE).
   *  · 진찰료만 실청구와 **같은 함수**로 센다 — 진찰료 코드(resolveConsultProcedure) · 자격 요율(resolveCalculatorCopay) ·
   *    본인부담(computePatientCopay — 의료급여 외래 정액 포함). 검사·처방·비급여는 진료 뒤에 정해져 넣지 않는다(화면이 밝힌다)
   *  · 🔴 단가 미등재·0원은 모름(null) — 운영 재진 진찰료 단가가 0원이라 "0원"을 예상액으로 말할 뻔했다
   *  · 최근 같은 진료과 청구의 본인부담(감면 뒤) 범위 — 취소·환불 청구 제외 · 표본 수 병기 · 0건이면 null
   */
  async estimateVisitCopay(patientId: string, appt: { type: string | null; department: string | null }, recentSample: number) {
    const patient = await this.prisma.patient.findUnique({ where: { id: patientId }, select: { insuranceType: true } });
    if (!patient) throw new NotFoundException('Patient not found');
    const insuranceType = (patient.insuranceType ?? 'NHI') as InsuranceType;
    const [{ consultCode, consultProc, isInitial }, eligibility] = await Promise.all([
      this.resolveConsultProcedure(patientId, null, appt.type),
      this.prisma.eligibilityCheck.findFirst({ where: { patientId, ...USABLE_ELIGIBILITY_WHERE }, orderBy: { queriedAt: 'desc' }, select: { id: true } }),
    ]);
    const copay = await this.resolveCalculatorCopay(patientId, insuranceType, 'OUTPATIENT', undefined, eligibility != null);
    const unitPrice = consultProc?.unitPrice ?? null;
    const priced = unitPrice != null && unitPrice > 0;
    const unknownReason = !consultCode ? 'INSTITUTION_GRADE_UNKNOWN'
      : !consultProc ? 'CONSULT_CODE_UNREGISTERED'
      : !priced ? 'CONSULT_PRICE_UNKNOWN'
      : copay.rate == null ? 'COPAY_RATE_UNKNOWN'
      : null;
    const patientCopay = unknownReason == null
      ? await this.computePatientCopay([{ amount: unitPrice!, copayRate: copay.rate! }], 'OUTPATIENT', copay.copayCategory ?? insuranceType, unitPrice!)
      : null;

    const recentRows = appt.department
      ? await this.prisma.billing.findMany({
          where: { patientId, status: { notIn: ['CANCELLED', 'REFUNDED'] }, encounter: { doctor: { department: appt.department } } },
          orderBy: { createdAt: 'desc' },
          take: recentSample,
          select: { patientCopay: true, discountAmount: true },
        })
      : [];
    const charged = recentRows.map((b) => Math.max(0, Number(b.patientCopay) - Number(b.discountAmount ?? 0)));
    return {
      consultation: {
        code: consultCode,
        name: consultProc?.nameKo ?? null,
        visitKind: isInitial ? 'INITIAL' as const : 'FOLLOW_UP' as const,
        totalAmount: priced ? unitPrice : null,
        patientCopay,
        basis: copay.basis,
        unknownReason,
      },
      recent: {
        department: appt.department,
        sampleSize: charged.length,
        min: charged.length ? Math.min(...charged) : null,
        max: charged.length ? Math.max(...charged) : null,
      },
    };
  }

  /**
   * 수납 자동 계산 — encounter의 처방 데이터에서 진료비 산출
   */
  async calculateBilling(encounterId: string) {
    // 1. encounter + prescriptions + medicationCode/procedureCode 조회
    const encounter = await this.prisma.encounter.findUnique({
      where: { id: encounterId },
      include: {
        patient: { select: { id: true, insuranceType: true } },
        doctor: { select: { department: true } },
        appointment: { select: { type: true } },
        prescriptions: {
          where: { status: 'ACTIVE' },
          include: {
            medicationCode: { select: { code: true, nameKo: true, unitPrice: true, insuranceCode: true, dosageForm: true } },
            procedureCode: { select: { code: true, nameKo: true, unitPrice: true, insuranceCovered: true, copayRate: true } },
          },
        },
        diagnoses: {
          include: { diagnosisCode: { select: { code: true, nameKo: true } } },
        },
      },
    });

    if (!encounter) throw new NotFoundException('Encounter not found');
    await this.applyTierPrices(encounter.prescriptions.map((rx) => rx.procedureCode)); // 청구 단가 = 고시 종별 단가(종별 명시 설정 때만)

    // 2. 수가 설정 조회 (SystemConfig)
    const configs = await this.prisma.systemConfig.findMany({
      where: { category: 'billing' },
    });
    const cfgMap: Record<string, unknown> = {};
    configs.forEach(c => { cfgMap[c.key] = c.value; });

    const grade = (cfgMap['billing.institution.grade'] ?? 'CLINIC') as string;

    // 🔴 C3 — 정적 요율표 제거. 실청구와 **같은 함수**(EligibilityService.resolveCopayRate)로 요율을 얻는다.
    const insuranceType = (encounter.patient?.insuranceType ?? 'NHI') as InsuranceType;
    const visitTypeForCopay: 'OUTPATIENT' | 'INPATIENT' =
      encounter.visitType === 'INPATIENT' || encounter.visitType === 'INPATIENT_CONSULT' ? 'INPATIENT' : 'OUTPATIENT';
    const hasEligibility = encounter.eligibilityCheckId != null
      || (await this.prisma.eligibilityCheck.findFirst({
        where: { patientId: encounter.patient?.id ?? '', ...USABLE_ELIGIBILITY_WHERE }, orderBy: { queriedAt: 'desc' }, select: { id: true },
      })) != null; // 🔴 (2026-09-15) 조회 실패를 "자격조회 없음"으로 접어 본인부담 계산을 바꾸지 않는다 — 전파
    const copay = await this.resolveCalculatorCopay(
      encounter.patient?.id, insuranceType, visitTypeForCopay, encounterId, hasEligibility,
    );
    const copayRate = copay.rate;

    // 3. 항목별 계산
    // 🔴 C5 — `priceKnown:false` 는 **0원이 아니라 모르는 값**이다. totalPrice 를 null 로 두어
    //         합계에서 제외하고, 화면이 '약가 미등재'라고 말하게 한다(P1).
    const items: Array<{
      category: string;
      code: string;
      name: string;
      unitPrice: number | null;
      quantity: number;
      totalPrice: number | null;
      insuranceType: 'COVERED' | 'NON_COVERED' | 'UNKNOWN';
      priceKnown: boolean;
      note?: string;
    }> = [];

    // 🔴 (2026-10-14 수납·청구 결함 발굴 P4-2) 종전 패널은 실청구와 다른 공식이었다 — 진찰료 늘 재진 AA261·설정값 11,690 ·
    //    실청구에 없는 원내 조제료 AC200 4,500 · 약 수량 = 투약일수 · 코드별 본인부담 특례 무시 · 의료급여 정액 빠짐 · 원 단위 절사.
    //    그래서 정상 청구에도 "N원 차이"를 말했다. 이제 실청구와 **같은 함수**로 만든다:
    //    진찰료 = resolveConsultProcedure · 처방 라인 = buildPrescriptionLineItem · 본인부담 = computePatientCopay(절사 없음).
    //    다른 점은 하나 — 단가 미등재는 실청구가 0원으로 싣지만(P5-1 남음) 이 패널은 '모름'으로 합계에서 뺀다.
    //    본인부담상한제 사전급여(설정 ON 일 때만)는 이 패널이 반영하지 않는다(경고로 밝힌다).
    const lineRate = copayRate ?? 0; // 요율을 모르면 금액만 세고 본인부담은 null
    const lineCategory = copay.copayCategory ?? insuranceType;
    const isInpatientVisit = encounter.visitType === 'INPATIENT' || encounter.visitType === 'INPATIENT_CONSULT';
    const lines: { line: BillingLineItem; code: string; category: string; priceKnown: boolean }[] = [];
    if (!isInpatientVisit && encounter.patient?.id) {
      const { consultCode, consultProc } = await this.resolveConsultProcedure(encounter.patient.id, encounterId, encounter.appointment?.type ?? null);
      if (consultProc) {
        const amount = consultProc.unitPrice ?? 0;
        lines.push({
          line: { codeType: 'PROCEDURE', codeId: consultProc.id, codeName: consultProc.nameKo, quantity: 1, unitPrice: amount, amount, copayRate: lineRate, fullCopay: lineRate >= 1, insuranceCategory: 'COVERED' },
          code: consultCode, category: 'CONSULTATION', priceKnown: consultProc.unitPrice != null,
        });
      } else {
        items.push(consultCode
          ? { category: 'CONSULTATION', code: consultCode, name: '진찰료(수가 마스터 미등재)', unitPrice: null, quantity: 1, totalPrice: null, insuranceType: 'UNKNOWN', priceKnown: false, note: '진찰료 코드가 수가 마스터에 없다 — 실청구에서도 진찰료가 빠진다' }
          : { category: 'CONSULTATION', code: '', name: '진찰료(요양기관 종별 미확인)', unitPrice: null, quantity: 1, totalPrice: null, insuranceType: 'UNKNOWN', priceKnown: false, note: '요양기관 종별 설정값을 알 수 없어 진찰료 코드를 고르지 못했다 — 실청구에서도 진찰료가 빠진다(billing.institution.grade 확인)' });
      }
    }
    for (const rx of encounter.prescriptions) {
      const line = this.buildPrescriptionLineItem(rx, lineRate, lineCategory);
      if (!line) continue;
      const code = rx.type === 'MEDICATION' ? rx.medicationCode?.code ?? '' : rx.procedureCode?.code ?? '';
      const known = rx.type === 'MEDICATION' ? rx.medicationCode?.unitPrice != null : rx.procedureCode?.unitPrice != null;
      lines.push({ line, code, category: line.codeType === 'MEDICATION' ? 'MEDICATION' : line.codeType, priceKnown: known });
    }
    for (const l of lines) {
      items.push({
        category: l.category,
        code: l.code,
        name: l.line.codeName,
        unitPrice: l.priceKnown ? l.line.unitPrice : null,
        quantity: l.line.quantity,
        totalPrice: l.priceKnown ? l.line.amount : null,
        insuranceType: l.priceKnown ? (l.line.insuranceCategory === 'NON_COVERED' ? 'NON_COVERED' : 'COVERED') : 'UNKNOWN',
        priceKnown: l.priceKnown,
        ...(l.priceKnown ? {} : { note: `${l.line.codeType === 'MEDICATION' ? '약가' : '수가'} 미등재 — 금액 산출 불가(실청구는 0원으로 싣는다)` }),
      });
    }

    // 4. 합계 계산
    // 🔴 C5 — 가격을 모르는 항목은 합계에 0 으로 섞지 않는다. 별도로 세어 화면이 '불완전'을 말하게 한다.
    const unpricedItems = items.filter(i => !i.priceKnown);
    const pricedLines = lines.filter((l) => l.priceKnown).map((l) => l.line);
    const coveredTotal = pricedLines.filter((l) => l.insuranceCategory !== 'NON_COVERED').reduce((s, l) => s + l.amount, 0);
    const nonCoveredTotal = pricedLines.filter((l) => l.insuranceCategory === 'NON_COVERED').reduce((s, l) => s + l.amount, 0);
    const totalAmount = coveredTotal + nonCoveredTotal;

    // 🔴 C3 — 요율을 모르면(자격 미확인 의료급여 등) 금액을 지어내지 않는다. null = '산출 불가'.
    const rateKnown = copayRate != null;
    const patientCopay = rateKnown
      ? await this.computePatientCopay(pricedLines, isInpatientVisit ? 'INPATIENT' : 'OUTPATIENT', lineCategory, totalAmount)
      : null;
    const insuranceCovered = patientCopay != null ? totalAmount - patientCopay : null;

    const warnings: string[] = [];
    if (copay.note) warnings.push(copay.note);
    if (String((await this.configRuntime.get('billing.copayCap.preCoverageEnabled')) ?? 'false') === 'true') {
      warnings.push('본인부담상한제 사전급여가 켜져 있습니다 — 이 계산은 상한 초과분을 반영하지 않아 실청구보다 클 수 있습니다');
    }
    if (unpricedItems.length > 0) {
      warnings.push(`약가·수가 미등재 ${unpricedItems.length}건은 금액을 알 수 없어 합계에서 제외했습니다(0원 아님): ${unpricedItems.map(i => i.name).join(', ')}`);
    }

    return {
      encounterId,
      patientId: encounter.patient?.id,
      insuranceType,
      grade,
      copayRate,                            // null = 산출 불가
      copayCategory: copay.copayCategory,
      copayBasis: copay.basis,              // ELIGIBILITY | INSURANCE_TYPE_FALLBACK | UNKNOWN
      copayRateConfirmed: copay.confirmed,  // 🔴 false = 자격 미확인(가정치 또는 산출 불가)
      items,
      summary: {
        coveredTotal,
        nonCoveredTotal,
        totalAmount,
        insuranceCovered,
        patientCopay,
        /** 🔴 합계가 완전한가 — 미등재 항목이 있거나 요율을 모르면 false */
        complete: unpricedItems.length === 0 && rateKnown,
        unpricedItemCount: unpricedItems.length,
      },
      warnings,
      diagnoses: encounter.diagnoses?.map(d => ({
        code: d.diagnosisCode?.code,
        name: d.diagnosisCode?.nameKo,
        type: d.type,
      })),
    };
  }

  /**
   * DUR 규칙 체크 — 표준 DB 기반 (AI 보완)
   */
  async checkDUR(patientId: string, newDrugAtc: string, newDrugName: string) {
    // 1. 환자의 현재 활성 처방 조회
    const activeRx = await this.prisma.prescription.findMany({
      where: {
        encounter: { patientId },
        status: 'ACTIVE',
      },
      include: {
        medicationCode: { select: { insuranceCode: true, nameKo: true } },
      },
    });

    // 2. DUR 규칙 조회
    const durRules = await this.prisma.systemConfig.findMany({
      where: { category: 'dur' },
    });

    const warnings: Array<{
      severity: string;
      type: string;
      description: string;
      recommendation: string;
      drug1: string;
      drug2?: string;
    }> = [];

    for (const config of durRules) {
      const rule = config.value as Record<string, string> | null;
      if (!rule || !rule.drug1) continue;

      // 신규 약물이 규칙의 drug1과 매칭?
      if (rule.drug1 === newDrugAtc) {
        if (rule.type === 'INTERACTION' && rule.drug2) {
          // 기존 처방에 drug2가 있는지 확인
          const hasConflict = activeRx.some(
            rx => rx.medicationCode?.insuranceCode === rule.drug2,
          );
          if (hasConflict) {
            warnings.push({
              severity: rule.severity,
              type: rule.type,
              description: rule.description,
              recommendation: rule.recommendation,
              drug1: newDrugName,
              drug2: rule.drug2Name,
            });
          }
        } else if (rule.type === 'DUPLICATE') {
          const hasDuplicate = activeRx.some(
            rx =>
              rx.medicationCode?.insuranceCode === rule.drug1 ||
              rx.medicationCode?.insuranceCode === rule.drug2,
          );
          if (hasDuplicate) {
            warnings.push({
              severity: rule.severity,
              type: rule.type,
              description: rule.description,
              recommendation: rule.recommendation,
              drug1: newDrugName,
            });
          }
        } else if (
          rule.type === 'DOSE' ||
          rule.type === 'PREGNANCY' ||
          rule.type === 'AGE'
        ) {
          // 이 타입들은 프론트에서 추가 조건 체크 필요
          warnings.push({
            severity: rule.severity,
            type: rule.type,
            description: rule.description,
            recommendation: rule.recommendation,
            drug1: newDrugName,
          });
        }
      }

      // 반대 방향도 체크 (drug2 === newDrugAtc)
      if (rule.drug2 === newDrugAtc && rule.type === 'INTERACTION') {
        const hasConflict = activeRx.some(
          rx => rx.medicationCode?.insuranceCode === rule.drug1,
        );
        if (hasConflict) {
          warnings.push({
            severity: rule.severity,
            type: rule.type,
            description: rule.description,
            recommendation: rule.recommendation,
            drug1: rule.drug1Name,
            drug2: newDrugName,
          });
        }
      }
    }

    return { warnings, checkedAgainst: activeRx.length };
  }

  /**
   * 본인부담상한제 계산 — 소득분위별 연간 상한액 (건강보험법 제44조)
   * 2026년 기준: 1분위 80만원 ~ 10분위 780만원
   */
  /** 환자 연간 본인부담 상한 상태(YTD·상한·잔여). explicitDecile=소득분위가 명시 설정됐는지 */
  private async getCopayCapState(patientId: string, year?: number): Promise<{
    incomeDecile: number; annualCap: number; totalCopayYTD: number; remaining: number; explicitDecile: boolean;
  }> {
    const targetYear = year ?? new Date().getFullYear();
    // 소득분위 소스: Patient.incomeDecile(정규 필드·NHIS 자격조회) 우선 → SystemConfig(레거시) 폴백 → 기본 5
    const patient = await this.prisma.patient.findUnique({ where: { id: patientId }, select: { incomeDecile: true } });
    const decileConfig = patient?.incomeDecile == null
      ? await this.prisma.systemConfig.findFirst({ where: { category: 'patient', key: `income_decile.${patientId}` } })
      : null;
    const explicit = patient?.incomeDecile != null || !!decileConfig;
    const decile = patient?.incomeDecile ?? (decileConfig ? Number(decileConfig.value) : 5);
    const result = await this.prisma.billing.aggregate({
      _sum: { patientCopay: true },
      where: { patientId, status: { in: ['PAID', 'PARTIAL'] }, paidAt: { gte: new Date(targetYear, 0, 1), lt: new Date(targetYear + 1, 0, 1) } },
    });
    const totalCopayYTD = result._sum.patientCopay ?? 0;
    return { incomeDecile: decile, ...copayCapState(decile, totalCopayYTD), explicitDecile: explicit };
  }

  /**
   * 본인부담상한제 사전급여 — 청구 생성 시 연간 상한 초과분을 본인부담에서 제외(NHIS부담).
   * 안전: config `billing.copayCap.preCoverageEnabled` 게이트(기본 OFF) + 소득분위 명시 설정 환자만
   * (추정분위로 잘못 캡 방지). 초과분(capExcess)은 insuranceCovered로 흡수(총액 불변)·별도 기록.
   */
  private async applyCopayCap(patientId: string, patientCopay: number): Promise<{ patientCopay: number; capExcess: number }> {
    if (patientCopay <= 0) return { patientCopay, capExcess: 0 };
    const enabled = String((await this.configRuntime.get('billing.copayCap.preCoverageEnabled')) ?? 'false') === 'true';
    if (!enabled) return { patientCopay, capExcess: 0 };
    const state = await this.getCopayCapState(patientId);
    if (!state.explicitDecile) return { patientCopay, capExcess: 0 }; // 추정분위면 미적용
    return applyCopayCap(patientCopay, state.remaining);
  }

  async calculateCopaymentCap(patientId: string, year?: number): Promise<{
    incomeDecile: number;
    annualCap: number;
    totalCopayYTD: number;
    exceeds: boolean;
    refundAmount: number;
  }> {
    const patient = await this.prisma.patient.findUnique({ where: { id: patientId }, select: { id: true } });
    if (!patient) throw new NotFoundException('환자를 찾을 수 없습니다.');
    const state = await this.getCopayCapState(patientId, year);
    const exceeds = state.totalCopayYTD > state.annualCap;
    return {
      incomeDecile: state.incomeDecile, annualCap: state.annualCap, totalCopayYTD: state.totalCopayYTD,
      exceeds, refundAmount: exceeds ? state.totalCopayYTD - state.annualCap : 0,
    };
  }

  /**
   * 미수납 알림 — 7일 이상 미수납 건 감지 후 알림 생성 (매일 09:00)
   */
  /** 미수납 알림 기준(일) — 미설정·비정상 값이면 종전 동작(7일)을 지킨다 */
  private async unpaidAlertDays(): Promise<number> {
    const v = await this.configRuntime?.get('billing.unpaidAlertDays').catch(() => null);
    const n = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 7;
  }

  @Cron('0 9 * * *')
  async checkUnpaidBillings(): Promise<void> {
    try {
      // 🔴 종전엔 상수 7 이었고 설정 `billing.unpaidAlertDays`(표시 7)는 **아무도 읽지 않았다** —
      //    기본값이 같아 화면에서 바꿔도 티가 나지 않았다. 이제 그 키가 실제 기준이다.
      const alertDays = await this.unpaidAlertDays();
      const threshold = new Date();
      threshold.setDate(threshold.getDate() - alertDays);

      const unpaidBillings = await this.prisma.billing.findMany({
        where: {
          status: { in: ['PENDING', 'DEFERRED'] },
          createdAt: { lte: threshold },
        },
        include: {
          patient: { select: { id: true, mrn: true, familyName: true, givenName: true } },
        },
        take: 100,
      });

      if (unpaidBillings.length === 0) return;

      this.logger.warn(`미수납 ${unpaidBillings.length}건 감지 (${alertDays}일 초과)`);

      // 관리자 대상 알림 생성 (notification 테이블에 직접 기록)
      const adminUsers = await this.prisma.user.findMany({
        where: { role: 'ADMIN', isActive: true },
        select: { id: true }, // 스카우트: take:10 상한으로 일부 관리자 누락 → 전원
      });

      for (const admin of adminUsers) {
        // 일일 누적 방지: 이미 읽지 않은 미수납 알림이 있으면 새로 만들지 않음(중복 표시 방지)
        const existingUnread = await this.prisma.notification.findFirst({
          where: { userId: admin.id, type: 'BILLING_UNPAID_ALERT', isRead: false },
          select: { id: true },
        });
        if (existingUnread) continue;
        await this.prisma.notification.create({
          data: {
            userId: admin.id,
            type: 'BILLING_UNPAID_ALERT',
            title: `미수납 ${unpaidBillings.length}건 알림`,
            message: `${alertDays}일 이상 미수납 건이 ${unpaidBillings.length}건 있습니다. 확인이 필요합니다.`,
            severity: 'WARNING',
            refType: 'Billing',
          },
        });
      }
    } catch (error) {
      this.logger.error(`미수납 알림 실패: ${(error as Error).message}`);
    }
  }

  private getTodayStart(): Date {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }

  // ══════════════════════════════════════════════
  // HIRA 비급여 보고 + 본인부담 상한 초과 환자
  // ══════════════════════════════════════════════

  /** HIRA 비급여 진료비 보고 데이터 생성 (연 1회 보고용) */
  async generateHiraNonCoveredReport(year: number) {
    const yearStart = new Date(year, 0, 1);
    const yearEnd = new Date(year + 1, 0, 1);

    // 비급여 항목별 건수 + 금액 집계
    const items = await this.prisma.billingItem.groupBy({
      by: ['codeName', 'codeType', 'insuranceCategory'],
      where: {
        billing: { paidAt: { gte: yearStart, lt: yearEnd }, status: { in: ['PAID', 'PARTIAL'] } },
        insuranceCategory: 'NON_COVERED',
      },
      _count: true,
      _sum: { amount: true },
      _avg: { unitPrice: true },
    });

    const report = items.map((item) => ({
      itemName: item.codeName,
      codeType: item.codeType,
      count: item._count,
      totalAmount: item._sum.amount ?? 0,
      // 🔴 (2026-09-21 H) 종전 `?? 0` — 그 항목의 `unitPrice` 가 **한 건도 기록되지 않았을 때**
      //    (Prisma `_avg` = null) 비급여 보고서가 "평균 단가 0원"이라고 말했다. 0원은 미기록이
      //    아니라 **무료**로 읽힌다(대외 제출 서식에 실리는 값이다). 표본 없음은 `null`.
      averagePrice: item._avg.unitPrice != null ? Math.round(Number(item._avg.unitPrice)) : null,
    }));

    // 전체 통계
    const totalNonCovered = report.reduce((sum, r) => sum + r.totalAmount, 0);
    const totalCases = report.reduce((sum, r) => sum + r.count, 0);

    // 전체 수납 대비 비급여 비율
    const totalRevenue = await this.prisma.billing.aggregate({
      _sum: { totalAmount: true },
      where: { paidAt: { gte: yearStart, lt: yearEnd }, status: { in: ['PAID', 'PARTIAL'] } },
    });
    // 🔴 표본(그 해 수납)이 없으면 Prisma `_sum` 은 `null` 이다 — 0원과 다른 사실이라 그대로 들고 간다.
    const revenueTotal = totalRevenue._sum.totalAmount != null ? Number(totalRevenue._sum.totalAmount) : null;

    return {
      year,
      reportDate: new Date().toISOString(),
      summary: {
        totalNonCoveredAmount: totalNonCovered,
        totalCases,
        // 🔴 (2026-09-21 H) 종전 `: 0` — 그 해 수납이 **한 건도 없으면** "비급여 비율 0%" 라고 말했다.
        //    분모 0 에서 0% 는 값이 아니라 **산출 불가**다. 화면(`/claims/stats`)은 이 두 결함
        //    (분모 미동봉 + 분모 0에 0)을 이유로 이 값을 **그리기를 거부하고 있었다** — 둘 다 고친다.
        totalRevenueAmount: revenueTotal,
        nonCoveredRatio: revenueTotal != null && revenueTotal > 0
          ? Math.round((totalNonCovered / revenueTotal) * 100 * 10) / 10
          : null,
        nonCoveredRatioUnavailableReason: revenueTotal != null && revenueTotal > 0 ? null : 'NO_REVENUE_SAMPLE',
        itemCount: report.length,
      },
      items: report.sort((a, b) => b.totalAmount - a.totalAmount),
    };
  }

  /** 비급여 항목별 매출 요약 */
  async getNonCoveredSummary(from?: string, to?: string) {
    const fromDate = from ? new Date(from) : new Date(new Date().getFullYear(), 0, 1);
    const toDate = to ? new Date(to) : new Date();
    toDate.setDate(toDate.getDate() + 1);

    const items = await this.prisma.billingItem.groupBy({
      by: ['codeName', 'codeType'],
      where: {
        billing: { paidAt: { gte: fromDate, lt: toDate }, status: { in: ['PAID', 'PARTIAL'] } },
        insuranceCategory: 'NON_COVERED',
      },
      _count: true,
      _sum: { amount: true },
      _avg: { unitPrice: true },
    });

    return items
      .map((item) => ({
        itemName: item.codeName,
        codeType: item.codeType,
        count: item._count,
        totalAmount: item._sum.amount ?? 0,
        // 🔴 위와 같은 이유 — 단가 미기록(`_avg` null)을 0원으로 번역하지 않는다.
        averagePrice: item._avg.unitPrice != null ? Math.round(Number(item._avg.unitPrice)) : null,
      }))
      .sort((a, b) => b.totalAmount - a.totalAmount);
  }

  /**
   * 🔴 W8 R3 C4 — 비급여 정본이 둘이라는 사실을 **읽는 쪽에서 드러낸다**.
   *
   * 무엇이 잘못이었나: 환자에게 고지하는 가격표(`non_covered_items`, 의료법 §45의2)와 실제로 청구되는
   * 가격(`procedure_codes.insuranceCovered=false`)이 서로 다른 표에 따로 산다. 운영 실측(2026-08-14):
   *   · non_covered_items 16건 중 procedure_codes 와 **코드가 일치하는 것 0건**
   *   · 도수치료(30분): 고지가 100,000원(TH-PT-001) ↔ 실청구 52,800원(MM201)
   * 어느 화면도 이 불일치를 말하지 않아, 원무는 고지가로 안내하고 시스템은 다른 값을 청구했다.
   *
   * 원칙: **저장값을 코드로 고치지 않는다.** 어느 쪽이 실청구가인지 밝히고 불일치를 화면에 드러낼 뿐이며,
   * 일괄 교정은 원무·보험 판단 영역이다(릴리즈 보고서에 목록으로 남긴다).
   */
  async getNonCoveredReconciliation() {
    const norm = (s: string) => s.replace(/[\s·・]/g, '').toLowerCase();
    const baseName = (s: string) => norm(s).replace(/\(.*?\)/g, '');

    const [notices, claimCodes] = await Promise.all([
      this.prisma.nonCoveredItem.findMany({ orderBy: [{ category: 'asc' }, { name: 'asc' }] }),
      this.prisma.procedureCode.findMany({
        where: { insuranceCovered: false, isActive: true },
        select: { code: true, nameKo: true, unitPrice: true, validFrom: true },
        orderBy: { code: 'asc' },
      }),
    ]);

    // 고지 코드가 수가마스터(급여 포함)에 존재하는지도 본다 — 코드 체계 자체가 다른지 판별용
    const noticeCodes = notices.map((n) => n.code);
    const codeHits = noticeCodes.length
      ? await this.prisma.procedureCode.findMany({
          where: { code: { in: noticeCodes } },
          select: { code: true, nameKo: true, unitPrice: true, insuranceCovered: true },
        })
      : [];
    const byCode = new Map(codeHits.map((c) => [c.code, c]));
    const byName = new Map(claimCodes.map((c) => [norm(c.nameKo), c]));
    const byBaseName = new Map(claimCodes.map((c) => [baseName(c.nameKo), c]));

    const matchedClaimCodes = new Set<string>();
    const items = notices.map((n) => {
      const hitCode = byCode.get(n.code) ?? null;
      const hitName = byName.get(norm(n.name)) ?? byBaseName.get(baseName(n.name)) ?? null;
      const claim = hitCode
        ? { code: hitCode.code, name: hitCode.nameKo, unitPrice: hitCode.unitPrice, matchedBy: 'CODE' as const }
        : hitName
          ? { code: hitName.code, name: hitName.nameKo, unitPrice: hitName.unitPrice, matchedBy: 'NAME' as const }
          : null;
      if (claim) matchedClaimCodes.add(claim.code);

      if (!claim) {
        return {
          noticeCode: n.code, name: n.name, category: n.category, noticePrice: n.price, isActive: n.isActive,
          claim: null, priceDiff: null,
          status: 'NO_CLAIM_CODE' as const,
          note: '고지 항목에 대응하는 수가마스터 코드가 없습니다 — 이 항목은 현재 시스템으로 청구되지 않습니다(수납 시 수기 처리 여부 확인 필요)',
        };
      }
      const diff = claim.unitPrice == null ? null : n.price - claim.unitPrice;
      return {
        noticeCode: n.code, name: n.name, category: n.category, noticePrice: n.price, isActive: n.isActive,
        claim, priceDiff: diff,
        status: (diff === 0 ? 'MATCHED' : 'PRICE_MISMATCH') as 'MATCHED' | 'PRICE_MISMATCH',
        note: diff === 0
          ? null
          : `🔴 고지가 ${n.price.toLocaleString('ko-KR')}원 ↔ 실청구가 ${(claim.unitPrice ?? 0).toLocaleString('ko-KR')}원(${claim.code}) — **실제 청구되는 금액은 수가마스터 값**입니다. 원무·보험 판단으로 어느 쪽을 정본으로 삼을지 결정하십시오`,
      };
    });

    // 역방향: 실제로 비급여 청구되는데 고지 가격표에 없는 코드(의료법 §45의2 고지 누락 후보)
    const unnoticed = claimCodes
      .filter((c) => !matchedClaimCodes.has(c.code))
      .map((c) => ({
        claimCode: c.code, name: c.nameKo, unitPrice: c.unitPrice,
        note: '비급여로 청구되지만 고지 가격표(non_covered_items)에 없습니다 — 의료법 제45조의2 고지 대상인지 확인 필요',
      }));

    return {
      canonicalNote:
        '🔴 비급여 정본이 둘입니다. 환자 고지가 = non_covered_items(관리 화면), 실제 청구가 = procedure_codes(수가마스터, insuranceCovered=false). '
        + '수납·영수증에 찍히는 금액은 **수가마스터**이며, 아래 불일치는 코드로 교정하지 않고 원무·보험 판단으로 정리합니다.',
      summary: {
        noticeCount: notices.length,
        claimCodeCount: claimCodes.length,
        matched: items.filter((i) => i.status === 'MATCHED').length,
        priceMismatch: items.filter((i) => i.status === 'PRICE_MISMATCH').length,
        noClaimCode: items.filter((i) => i.status === 'NO_CLAIM_CODE').length,
        unnoticedClaimCodes: unnoticed.length,
      },
      items,
      unnoticed,
    };
  }

  /**
   * 🔴 W8 R3 C5 — 약가·수가가 등재되지 않은 청구 대상 코드 목록.
   * 종전 계산·청구 경로가 `unitPrice ?? 0` 으로 이들을 **'급여 0원'** 으로 처리했다(운영 실측 약품 2,041건).
   * 약가 미등재는 **모르는 것**이지 0원이 아니므로, 여기서 목록으로 드러내 약제·원무가 등재하게 한다.
   */
  async getUnpricedBillableCodes(limit = 200) {
    const [medTotal, medCovered, meds, procTotal, procs] = await Promise.all([
      this.prisma.medicationCode.count({ where: { unitPrice: null } }),
      this.prisma.medicationCode.count({ where: { unitPrice: null, insuranceCode: { not: null } } }),
      this.prisma.medicationCode.findMany({
        where: { unitPrice: null },
        select: { code: true, nameKo: true, insuranceCode: true, isActive: true },
        orderBy: { code: 'asc' },
        take: Math.min(1000, Math.max(1, limit)),
      }),
      this.prisma.procedureCode.count({ where: { unitPrice: null } }),
      this.prisma.procedureCode.findMany({
        where: { unitPrice: null },
        select: { code: true, nameKo: true, insuranceCovered: true, isActive: true },
        orderBy: { code: 'asc' },
        take: Math.min(1000, Math.max(1, limit)),
      }),
    ]);

    return {
      note: '🔴 약가·수가 미등재 = 금액을 **모르는** 상태입니다. 0원으로 청구하거나 "급여 0원"으로 표시하지 마십시오.',
      summary: {
        medicationsWithoutPrice: medTotal,
        medicationsWithoutPriceButInsuranceListed: medCovered, // 급여코드는 있는데 약가가 없는 것 = 0원 청구 위험
        proceduresWithoutPrice: procTotal,
        truncated: medTotal > meds.length || procTotal > procs.length,
      },
      medications: meds,
      procedures: procs,
    };
  }

  /** 본인부담 상한 초과 환자 목록 */
  async getCopaymentCapExceedPatients(year: number) {
    const yearStart = new Date(year, 0, 1);
    const yearEnd = new Date(year + 1, 0, 1);

    // 환자별 연간 본인부담금 합계
    const patientCopays = await this.prisma.billing.groupBy({
      by: ['patientId'],
      where: {
        status: { in: ['PAID', 'PARTIAL'] },
        paidAt: { gte: yearStart, lt: yearEnd },
      },
      _sum: { patientCopay: true },
      having: { patientCopay: { _sum: { gt: 800_000 } } }, // 최소 1분위 상한(80만원) 이상
    });

    if (patientCopays.length === 0) return [];

    // 환자 정보 조회
    const patientIds = patientCopays.map((p) => p.patientId);
    const patients = await this.prisma.patient.findMany({
      where: { id: { in: patientIds } },
      select: { id: true, mrn: true, familyName: true, givenName: true, insuranceType: true },
    });

    const patientMap = new Map(patients.map((p) => [p.id, p]));

    return patientCopays
      .map((pc) => {
        const patient = patientMap.get(pc.patientId);
        return {
          patientId: pc.patientId,
          mrn: patient?.mrn,
          name: patient ? `${patient.familyName}${patient.givenName}` : '알 수 없음',
          insuranceType: patient?.insuranceType,
          totalCopay: pc._sum.patientCopay ?? 0,
        };
      })
      .sort((a, b) => b.totalCopay - a.totalCopay);
  }

  // ── 분할 납부 ──

  /**
   * 분납 계획을 만들 수 있는가 — 두 생성 경로(수납 화면 · installment 모듈)의 **공통 정본**(2026-10-14 결함 발굴 수납 P1-2).
   * 🔴 종전: 상태(PAID·CANCELLED·REFUNDED)·이미 낸 돈·감면·기존 계획을 보지 않아, 40,000 낸 100,000 건이 100,000 짜리 계획이 되어
   *    회차를 다 내면 140,000 을 받았다. 계획 금액 = **남은 납부 금액**(본인부담 − 감면 − 이미 낸 돈).
   */
  async prepareInstallment(billingId: string): Promise<{ billing: { id: string; status: BillingStatus }; amount: number }> {
    const billing = await this.prisma.billing.findUnique({ where: { id: billingId }, select: { id: true, status: true, patientCopay: true, discountAmount: true, paidAmount: true } });
    if (!billing) throw new DomainException(E.BILLING_NOT_FOUND, '수납 건을 찾을 수 없습니다.', HttpStatus.NOT_FOUND);
    if (!INSTALLMENT_OPEN_STATUSES.includes(billing.status)) {
      throw new DomainException(E.BILLING_PAYMENT_INVALID, '미납·부분 납부·보류 상태의 수납만 분납할 수 있습니다.', HttpStatus.CONFLICT, { status: billing.status });
    }
    const amount = billing.patientCopay - (billing.discountAmount ?? 0) - (billing.paidAmount ?? 0);
    if (amount <= 0) throw new DomainException(E.BILLING_PAYMENT_INVALID, '남은 납부 금액이 없습니다.', HttpStatus.CONFLICT, { remaining: amount });
    const active = await this.prisma.installmentPlan.count({ where: { billingId, status: 'ACTIVE' } });
    if (active > 0) throw new DomainException(E.BILLING_PAYMENT_INVALID, '이미 진행 중인 분납 계획이 있습니다.', HttpStatus.CONFLICT);
    return { billing, amount };
  }

  async createInstallmentPlan(billingId: string, totalInstallments: number, intervalDays: number) {
    const { billing, amount } = await this.prepareInstallment(billingId);
    const perInstallment = Math.ceil(amount / totalInstallments);

    // 분납 계획 생성 + 원 수납건 상태(PARTIAL) 전환을 원자적으로 — 부분 실패 시 금액상태 손상 방지
    return this.prisma.$transaction(async (tx) => {
      const plan = await tx.installmentPlan.create({
        data: {
          billingId,
          totalAmount: amount,
          installments: totalInstallments,
          nextDueDate: new Date(),
          status: 'ACTIVE',
          payments: {
            create: Array.from({ length: totalInstallments }, (_, i) => {
              const dueDate = new Date();
              dueDate.setDate(dueDate.getDate() + intervalDays * i);
              return {
                seqNo: i + 1,
                amount: i === totalInstallments - 1 ? amount - perInstallment * (totalInstallments - 1) : perInstallment,
                dueDate,
                status: 'PENDING',
              };
            }),
          },
        },
        include: { payments: { orderBy: { seqNo: 'asc' } } },
      });

      // 읽은 상태 그대로일 때만 — 그 사이 수납·취소됐으면 계획을 만들지 않는다(전체 롤백)
      const r = await tx.billing.updateMany({ where: { id: billingId, status: billing.status }, data: { status: 'PARTIAL' } });
      if (r.count !== 1) throw new DomainException(E.BILLING_PAYMENT_INVALID, '수납 정보가 변경되었습니다. 다시 시도해주세요.', HttpStatus.CONFLICT);

      return plan;
    });
  }

  /**
   * 분할 납부 계획 조회 — 🔴 (2026-09-14) 회차 합계·잔액·예정일 경과를 **서버가** 계산해 싣는다.
   *    화면이 금액을 다시 더하거나 오늘 날짜를 브라우저 시계로 비교하면 정본이 둘이 된다(money 도메인 잠금·KST 달력).
   *    - `remainingAmount` = 계획 총액 − 납부 완료 회차 금액 합(원 단위 정수 — 반올림 없음)
   *    - `scheduleMismatch` = 회차 금액 합 ≠ 계획 총액 — 고치지 않고(소급 금지·원무 판단) 사실만 알린다
   *    - `dueDatePassed` = 미납 회차의 예정일이 오늘(KST)보다 이전 — 연체 판정 기준은 정본에 없어 '연체'라 부르지 않는다
   */
  async getInstallmentPlan(billingId: string, now: Date = new Date()) {
    // 진행 중 계획 우선 · 없으면 가장 최근(종전: 정렬 없는 findFirst — 계획이 둘이면 어느 쪽이 보일지 정해지지 않았다)
    const plan = await this.prisma.installmentPlan.findFirst({
      where: { billingId },
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      include: { payments: { orderBy: { seqNo: 'asc' } } },
    });
    if (!plan) return null;
    const today = todayDateOnly(now).getTime();
    let paidAmount = 0;
    let scheduledTotal = 0;
    let dueDatePassedCount = 0;
    const payments = plan.payments.map((p) => {
      scheduledTotal += p.amount;
      const paid = p.status === 'PAID';
      if (paid) paidAmount += p.amount;
      const dueDatePassed = !paid && p.dueDate != null && dateOnlyValue(p.dueDate)!.getTime() < today;
      if (dueDatePassed) dueDatePassedCount += 1;
      return { ...p, dueDatePassed };
    });
    return {
      ...plan,
      payments,
      summary: {
        paidAmount,
        remainingAmount: plan.totalAmount - paidAmount,
        scheduledTotal,
        scheduleMismatch: scheduledTotal !== plan.totalAmount,
        dueDatePassedCount,
        asOf: localDateKey(now),
      },
    };
  }

  /**
   * 분할 납부 1회차 수납 — **분납 회차 납부의 정본**(installment 모듈이 이 메서드로 위임한다).
   *
   * 🔴 종전에는 회차 금액이 수납 원장(`billing_payments`)에 남지 않아 **일마감 수단별 집계에서
   *    통째로 빠졌다.** 받은 `method` 는 반환값에만 쓰이고 어디에도 저장되지 않았다.
   *    수단을 모르면 지어내지 않고 `UNKNOWN` 라인으로 남긴다 — 화면은 '수단 미기록'으로 말한다.
   */
  async payInstallment(installmentId: string, method?: string, note?: string) {
    // installmentId is the payment id
    const payment = await this.prisma.installmentPayment.findUnique({
      where: { id: installmentId },
      include: { plan: true },
    });
    if (!payment) throw new Error('납부 건을 찾을 수 없습니다.');
    if (payment.status === 'PAID') throw new Error('이미 납부된 회차입니다.');
    // 🔴 (P1-2) 계획이 끝났거나 청구가 닫혔으면(취소·환불·완납) 회차를 받지 않는다 — 종전엔 취소된 청구가 PAID 로 되살아났고
    //    일반 수납으로 완납된 뒤에도 회차가 초과 수납으로 쌓였다
    if (payment.plan.status !== 'ACTIVE') throw new DomainException(E.BILLING_PAYMENT_INVALID, '진행 중인 분납 계획이 아닙니다.', HttpStatus.CONFLICT, { planStatus: payment.plan.status });

    // 회차 납부(3쓰기: 납부 PAID·계획 paidCount·완납 시 수납 PAID)를 원자적으로 —
    // 부분 실패 시 "납부됐는데 paidCount 미반영" 등 금액상태 손상 방지.
    return this.prisma.$transaction(async (tx) => {
      // 원자적 선점: PAID가 아닌 경우만 PAID로 — 동시 이중납부 차단
      const claimed = await tx.installmentPayment.updateMany({
        where: { id: installmentId, status: { not: 'PAID' } },
        data: { status: 'PAID', paidAt: new Date() },
      });
      if (claimed.count === 0) throw new Error('이미 납부된 회차입니다.');

      // 🔴 (P1-2) 납부 횟수는 원자 증가 뒤 **증가된 값**으로 판정 — 종전엔 트랜잭션 밖에서 읽은 값 +1 로 덮어,
      //    동시 회차 둘이면 한 번만 늘어 영영 완납에 도달하지 못했다
      const counted = await tx.installmentPlan.update({
        where: { id: payment.planId },
        data: { paidCount: { increment: 1 } },
        select: { paidCount: true, installments: true },
      });
      const allPaid = counted.paidCount >= counted.installments;
      if (allPaid) await tx.installmentPlan.update({ where: { id: payment.planId }, data: { status: 'COMPLETED' } });

      // 회차 납부액을 Billing.paidAmount에 반영 — 매출·정산 집계(paidAmount 합산) 누락 방지.
      // 🔴 (P1-2) 청구가 열려 있을 때만(취소·환불·완납이면 0건 → 전체 롤백)
      const opened = await tx.billing.updateMany({
        where: { id: payment.plan.billingId, status: { in: INSTALLMENT_OPEN_STATUSES } },
        data: {
          paidAmount: { increment: payment.amount },
          ...(allPaid ? { status: 'PAID', paidAt: new Date() } : {}),
        },
      });
      if (opened.count !== 1) throw new DomainException(E.BILLING_PAYMENT_INVALID, '수납이 이미 닫혔습니다(취소·환불·완납) — 회차를 받지 않습니다.', HttpStatus.CONFLICT);

      // 🔴 수납 원장 라인 — 이것이 있어야 그 돈이 **들어온 날짜와 수단**으로 집계된다.
      //    Billing.paidAt 은 완납 시에만 갱신되므로 중간 회차는 원장이 유일한 기록이다.
      const ledgerMethod = (method ?? '').trim().toUpperCase() || 'UNKNOWN';
      await tx.billingPayment.create({
        data: {
          billingId: payment.plan.billingId,
          method: ledgerMethod,
          amount: payment.amount,
        },
      });

      return { paymentId: installmentId, seq: payment.seqNo, status: 'PAID', allPaid, method: ledgerMethod, amount: payment.amount, note: note ?? null };
    });
  }

  // ── 미수금 현황 ──

  async getOutstandingBillings(page: number = 1, limit: number = 50, patientId?: string) {
    const skip = (page - 1) * limit;
    // patientId 지정 시 해당 환자 미납만(접수 데스크 미납 안내)
    const where: Prisma.BillingWhereInput = {
      status: { in: UNPAID_STATUS },
      ...(patientId ? { patientId } : {}),
    };

    const [billings, total] = await Promise.all([
      this.prisma.billing.findMany({
        where,
        include: {
          encounter: {
            include: { patient: { select: { id: true, mrn: true, familyName: true, givenName: true, phone: true } } },
          },
          installmentPlans: { take: 1 },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.billing.count({ where }),
    ]);

    // 🔴 (2026-10-14 수납·청구 결함 발굴 P4-1) 종전 합계 = Σ본인부담 — 이미 낸 돈·감면을 빼지 않았다(부분 납부 청구가 전액 미수로).
    //    정본 shared `billingOutstanding`(본인부담 − 감면 − 이미 낸 돈 · 음수는 0)로 행마다 센다.
    const outstandingRows = await this.prisma.billing.findMany({ where, select: { patientCopay: true, discountAmount: true, paidAmount: true } });
    const totalOutstandingAmount = outstandingRows.reduce((s, b) => s + (billingOutstanding(b) ?? 0), 0);

    return {
      items: billings.map(b => ({
        id: b.id,
        patient: b.encounter?.patient,
        status: b.status,
        totalAmount: b.totalAmount,
        patientCopay: b.patientCopay,
        discountAmount: b.discountAmount,
        paidAmount: b.paidAmount,
        outstanding: billingOutstanding(b),
        createdAt: b.createdAt,
        deferReason: b.deferredReason,
        hasInstallment: b.installmentPlans.length > 0,
      })),
      total,
      totalOutstandingAmount,
      page,
      limit,
    };
  }

  /**
   * 영수증 영문 변환 (외국인 환자용).
   * 🔴 기관명은 정본 `hospital.name`/`hospital.nameEn` 에서 읽는다 — 종전엔 `'Hospital RUN Medical Center'`
   *    (영문명)·`'Hospital RUN'`(국문 폴백 — billing 에는 hospitalName 필드가 없어 **항상** 폴백)이 하드코딩이었다.
   *    출처 3상태로 가른다: DB 행(`db`)만 사실이다. `default` 는 개발 플레이스홀더(국문 'Hospital RUN 병원'·영문 '')라
   *    기관명으로 내보내지 않고, `unset` 과 함께 `null` + `hospitalIdentityUnset` 에 키를 밝힌다(지어내지 않는다).
   */
  async translateReceiptToEnglish(receipt: any) {
    if (!receipt) return null;

    const [nameCfg, nameEnCfg] = await Promise.all([
      this.configRuntime.getWithSource('hospital.name'),
      this.configRuntime.getWithSource('hospital.nameEn'),
    ]);
    const fromDb = (c: { value: unknown; source: string }) =>
      c.source === 'db' && typeof c.value === 'string' && c.value.trim() ? c.value.trim() : null;
    const hospitalName = fromDb(nameCfg);
    const hospitalNameEn = fromDb(nameEnCfg);
    const hospitalIdentityUnset = [
      ...(hospitalName ? [] : ['hospital.name']),
      ...(hospitalNameEn ? [] : ['hospital.nameEn']),
    ];

    const categoryMap: Record<string, string> = {
      '진찰료': 'Consultation Fee', '입원료': 'Hospitalization Fee',
      '투약 및 조제료': 'Medication & Dispensing', '주사료': 'Injection Fee',
      '마취료': 'Anesthesia Fee', '이학요법료': 'Physical Therapy Fee',
      '정신요법료': 'Psychotherapy Fee', '처치 및 수술료': 'Procedure & Surgery Fee',
      '검사료': 'Laboratory Fee', '영상진단료': 'Imaging & Diagnosis Fee',
      '방사선치료료': 'Radiation Therapy Fee', '혈액투석료': 'Hemodialysis Fee',
      '치과교정료': 'Orthodontic Fee', '재활치료료': 'Rehabilitation Fee',
      '수혈료': 'Transfusion Fee', '식대': 'Meal Fee',
    };

    const statusMap: Record<string, string> = {
      PENDING: 'Pending', PAID: 'Paid', PARTIAL: 'Partial Payment',
      CANCELLED: 'Cancelled', REFUNDED: 'Refunded', DEFERRED: 'Deferred',
    };

    return {
      receiptType: 'ENGLISH_RECEIPT',
      hospitalName,
      hospitalNameEn,
      // 비어 있지 않으면 화면·인쇄가 "기관명 미설정"을 말해야 한다(null 을 빈 칸으로 그리지 않게)
      hospitalIdentityUnset,
      receiptNumber: receipt.receiptNumber ?? receipt.id,
      issueDate: receipt.receiptDate ?? new Date().toISOString().slice(0, 10),
      patient: {
        name: receipt.patient?.nameEn ?? `${receipt.patient?.familyName ?? ''}${receipt.patient?.givenName ?? ''}`,
        mrn: receipt.patient?.mrn,
        nationality: receipt.patient?.nationality,
        passportNumber: receipt.patient?.passportNumber ? decryptLegacyPid(receipt.patient.passportNumber) : receipt.patient?.passportNumber,
      },
      items: (receipt.items ?? []).map((item: any) => ({
        category: categoryMap[item.category] ?? item.category,
        categoryKo: item.category,
        description: item.description ?? item.name ?? '',
        insuranceCovered: item.insuranceCovered ?? 0,
        patientCopay: item.patientCopay ?? item.amount ?? 0,
        nonCovered: item.nonCoveredAmount ?? 0,
      })),
      summary: {
        totalAmount: receipt.totalAmount ?? 0,
        insuranceCovered: receipt.insuranceCovered ?? 0,
        patientCopay: receipt.patientCopay ?? 0,
        amountPaid: receipt.amountPaid ?? receipt.paidAmount ?? 0,
        balance: receipt.balance ?? 0,
        currency: 'KRW',
        paymentStatus: statusMap[receipt.status] ?? receipt.status,
      },
      notice: 'This receipt is issued for medical service payment. For insurance claim purposes, please request an official medical certificate.',
      disclaimer: 'Exchange rate and tax-related matters should be confirmed with your embassy or insurance provider.',
    };
  }
}