import { Injectable, NotFoundException, BadRequestException, ForbiddenException, Logger, Optional } from '@nestjs/common';
import { joinPatientName } from '@hospital-run/shared';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AuditAction } from '@prisma/client';
import { createHash } from 'crypto';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { DocumentService } from '../document/document.service';
import { AuditService } from '../audit/audit.service';
import { ChronicService } from '../chronic/chronic.service';
import { DOC_MAX_COPIES, FeeRule, computeFeeWith, FeeBreakdown, loadFeeRules } from './fee-rules';
import { ConfigRuntimeService } from '../config/config-runtime.service';
import { BillingService } from '../billing/billing.service';

/** 작성본 해시 기반 서명 ref(SIMULATION) */
function createHashRef(s: string): string {
  return createHash('sha256').update(s).digest('hex').slice(0, 24);
}

/** P0 의무기록 사본(A그룹) 발급 — 환자요청→의료진 스냅샷 동결→발급→다운로드 */
export const ISSUANCE_RECORD_TYPES = ['ENCOUNTER', 'PROGRESS', 'NURSING', 'DISCHARGE', 'PRESCRIPTION', 'CHRONIC'] as const;
export type IssuanceRecordType = (typeof ISSUANCE_RECORD_TYPES)[number];

const REJECT_REASONS = ['NOT_ELIGIBLE', 'INSUFFICIENT_DOC', 'NO_RECORD', 'DUPLICATE', 'OTHER'] as const;
const ISSUE_DOCTYPE = 'MEDICAL_RECORD_COPY';

// B그룹(의사 작성 증명서): 요청 type → (artifact record_type, IssuedDocument documentType)
const B_GROUP: Record<string, { recordType: string; docType: string }> = {
  DIAGNOSIS_CERT: { recordType: 'CERTIFICATE', docType: 'CERTIFICATE' },
  OPINION: { recordType: 'OPINION', docType: 'OPINION' },
  ADMISSION_CERT: { recordType: 'ADMISSION_CERT', docType: 'ADMISSION_CERT' },
  // N-W1(2026-09-06) — 사망진단서·출생증명서. 원천 정본은 Patient.death*·DeliveryRecord/NewbornRecord.
  DEATH_CERT: { recordType: 'DEATH_CERT', docType: 'DEATH_CERT' },
  BIRTH_CERT: { recordType: 'BIRTH_CERT', docType: 'BIRTH_CERT' },
};

/** 사망진단서/시체검안서 판정 보조 — 최종 진료 후 48시간(의료법 §17). 🔴 제안만 한다(확정은 의사). */
const DEATH_CERT_WINDOW_MS = 48 * 3600_000;
/** 발급대장 한 번에 싣는 상한 */
const LEDGER_CAP = 200;
/** 리포트가 처리 시간·수령 방법을 세는 발급 건 상한 */
const REPORT_CAP = 2000;
const isBGroup = (type: string) => !!B_GROUP[type];

/**
 * 처리 중으로 볼 수 있는 상태 — 동결·작성·반려는 여기서만.
 * 🔴 (2026-10-10) 종전엔 발급번호만 보고 상태는 보지 않아 **반려된 요청에 동결·작성하면 IN_REVIEW 로 되살아났고**,
 *    이미 반려된 요청을 다시 반려하면 사유가 덮어써졌다(일어난 판정을 고쳐 쓴다).
 */
const OPEN_STATUSES: readonly string[] = ['REQUESTED', 'PROCESSING', 'IN_REVIEW'];
function assertOpen(req: { status: string }) {
  if (!OPEN_STATUSES.includes(req.status)) {
    throw new BadRequestException({ code: 'REQUEST_NOT_OPEN', message: '처리 중인 요청이 아닙니다(반려·발급·수령된 요청은 다시 처리하지 않습니다 — 새로 접수하세요).', details: { status: req.status } });
  }
}

/** 팩스 번호 — 숫자·하이픈 7~20자 */
const FAX_RE = /^[0-9][0-9-]{6,19}$/;
/** 접수번호 — 요청 id 앞 8자리(대문자) · 창구·처리 화면·대기 목록 찾기가 같은 값을 쓴다 */
export function receiptNumberOf(id: string): string { return id.replace(/-/g, '').slice(0, 8).toUpperCase(); }

/**
 * 서류 수수료 ↔ 수납 연결(2026-10-10 · 결정 `documents.fee.billingLink`).
 *  - null(미정) = 현행 — 수수료는 표시만, 수납 원장에 아무것도 만들지 않는다.
 *  - 'BILLING_ITEM' = **발급 완료 때**(매수·부수로 금액이 확정되는 시점) 그 서류의 진료(`encounterId`) 미납 수납에 비급여 한 줄.
 *  🔴 수납 원장은 진료 단위다(`Billing.encounterId` 필수·유니크) — 진료가 없는 서류(사본 등)는 담을 자리가 없고, 수납을 지어내지 않는다.
 *  🔴 상태는 저장하지 않고 **수납 원장에서 파생**한다(정본 하나) — 라인이 있으면 그 수납 상태, 없으면 이유.
 */
export const DOC_FEE_BILLING_CONFIG_KEY = 'documents.fee.billingLink';
export const DOC_FEE_CODE_TYPE = 'DOCUMENT_FEE';
export type DocFeeBillingState =
  | 'OFF' // 설정 미정 — 연결하지 않음
  | 'AWAITING_ISSUE' // 켜짐 · 발급 전(금액 미확정)
  | 'NO_FEE' // 수수료 0원
  | 'NO_ENCOUNTER' // 진료 연결 없는 서류 — 수납 원장에 담을 자리 없음
  | 'NOT_LINKED' // 발급됐는데 라인 없음(그 진료 수납이 없거나 이미 납부 진행 · 재시도 가능)
  | 'UNPAID' | 'PAID' | 'PARTIAL' | 'CANCELLED' | 'OTHER';
export interface DocFeeBillingLink { mode: 'OFF' | 'BILLING_ITEM'; state: DocFeeBillingState; billingId: string | null; billingStatus: string | null }

const ISSUED_STATUSES = ['READY', 'DELIVERED'];
/** 상태 파생 — 라인이 있으면 그 수납 상태(설정과 무관하게 사실), 없으면 이유 */
export function deriveFeeBillingLink(
  mode: 'OFF' | 'BILLING_ITEM',
  r: { status: string; fee: number | null; encounterId: string | null },
  line: { billingId: string; billing: { status: string } } | null,
): DocFeeBillingLink {
  // 라인이 있으면 설정과 무관하게 사실을 말한다(설정을 끈 뒤에도 이미 올린 수납은 남아 있다)
  if (line) return { mode, state: billingStateOf(line.billing.status), billingId: line.billingId, billingStatus: line.billing.status };
  let state: DocFeeBillingState;
  if (mode === 'OFF') state = 'OFF';
  else if (!r.encounterId) state = 'NO_ENCOUNTER'; // 접수 때부터 안다 — 접수증이 창구 수납이라고 미리 말한다
  else if (!ISSUED_STATUSES.includes(r.status)) state = 'AWAITING_ISSUE';
  else if (!r.fee) state = 'NO_FEE';
  else state = 'NOT_LINKED';
  return { mode, state, billingId: null, billingStatus: null };
}

function billingStateOf(status: string): DocFeeBillingState {
  if (status === 'PENDING' || status === 'DEFERRED') return 'UNPAID';
  if (status === 'PAID') return 'PAID';
  if (status === 'PARTIAL' || status === 'INSTALLMENT') return 'PARTIAL';
  if (status === 'CANCELLED' || status === 'REFUNDED') return 'CANCELLED';
  return 'OTHER';
}

@Injectable()
export class IssuanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly documents: DocumentService,
    private readonly audit: AuditService,
    private readonly events: EventEmitter2,
    private readonly chronic: ChronicService,
    @Optional() private readonly config?: ConfigRuntimeService,
    @Optional() private readonly billing?: BillingService,
  ) {}

  private readonly logger = new Logger(IssuanceService.name);

  /** 결정 값 — 'BILLING_ITEM' 이 아니면 전부 OFF(미정·모르는 값은 연결하지 않는 쪽) · 조회 실패는 전파한다 */
  private async feeBillingMode(): Promise<'OFF' | 'BILLING_ITEM'> {
    if (!this.config) return 'OFF';
    return (await this.config.get(DOC_FEE_BILLING_CONFIG_KEY)) === 'BILLING_ITEM' ? 'BILLING_ITEM' : 'OFF';
  }

  /** 수납 연결 상태 — 수납 원장에서 파생(요청 여러 건 한 번에) */
  async feeBillingLinks(reqs: { id: string; status: string; fee: number | null; encounterId: string | null }[]): Promise<Map<string, DocFeeBillingLink>> {
    const mode = await this.feeBillingMode();
    const items = reqs.length
      ? await this.prisma.billingItem.findMany({
        where: { codeType: DOC_FEE_CODE_TYPE, codeId: { in: reqs.map((r) => r.id) } },
        select: { codeId: true, billingId: true, billing: { select: { status: true } } },
      })
      : [];
    const byReq = new Map(items.map((i) => [i.codeId, i]));
    const out = new Map<string, DocFeeBillingLink>();
    for (const r of reqs) out.set(r.id, deriveFeeBillingLink(mode, r, byReq.get(r.id) ?? null));
    return out;
  }

  /**
   * 발급된 서류의 수수료를 그 진료의 미납 수납에 올린다 — 발급 직후 자동, 또는 창구 재시도.
   * 🔴 발급은 이미 끝났으므로 여기 실패가 발급을 되돌리지 않는다 — 대신 삼키지 않고 결과로 말한다(상태는 파생이라 화면이 "올리지 못함"을 본다).
   */
  async linkFeeToBilling(id: string): Promise<{ attempted: boolean; result: string; billingId: string | null }> {
    const req = await this.prisma.documentRequest.findUnique({ where: { id }, select: { id: true, type: true, status: true, fee: true, encounterId: true } });
    if (!req) throw new NotFoundException('서류 요청을 찾을 수 없습니다.');
    if ((await this.feeBillingMode()) !== 'BILLING_ITEM') return { attempted: false, result: 'OFF', billingId: null };
    if (!ISSUED_STATUSES.includes(req.status)) return { attempted: false, result: 'AWAITING_ISSUE', billingId: null };
    if (!req.fee) return { attempted: false, result: 'NO_FEE', billingId: null };
    if (!req.encounterId) return { attempted: false, result: 'NO_ENCOUNTER', billingId: null };
    if (!this.billing) return { attempted: false, result: 'BILLING_UNAVAILABLE', billingId: null };
    const { rules } = await this.getFeeRules();
    const r = await this.billing.addNonCoveredLine(req.encounterId, {
      codeType: DOC_FEE_CODE_TYPE, codeId: req.id,
      codeName: ['제증명 수수료', rules[req.type]?.label ?? req.type, receiptNumberOf(req.id)].join(' · '),
      unitPrice: req.fee, quantity: 1,
    });
    return { attempted: true, result: r.status, billingId: r.billingId };
  }

  /** 발급 직후 자동 연결 — 실패는 발급 응답에 싣고 로그로 남긴다(발급은 되돌리지 않는다) */
  private async autoLinkFee(id: string): Promise<{ attempted: boolean; result: string; billingId: string | null }> {
    try {
      return await this.linkFeeToBilling(id);
    } catch (e) {
      this.logger.warn(`서류 수수료 수납 연결 실패 req=${id}: ${(e as Error).message}`);
      return { attempted: true, result: 'FAILED', billingId: null };
    }
  }

  /** 대리인 발급 기능 게이트 — env OFF 기본(법무 확정 후 활성) */
  static proxyEnabled(): boolean {
    return process.env.MEDICAL_RECORD_PROXY_ENABLED === 'true';
  }

  /**
   * P1 대리인 자격 검증 — 의료진이 구비서류·관계를 검토 후 VERIFIED/REJECTED 결정.
   * (자동 법적기준은 법무 확정 후 보강. 현재는 게이트 + 명시 검증 결정만 강제.)
   */
  async verifyProxy(
    id: string,
    dto: { decision: 'VERIFIED' | 'REJECTED'; relation?: string; legalBasis?: string; note?: string },
    userId: string,
  ) {
    if (!IssuanceService.proxyEnabled())
      throw new BadRequestException({ code: 'PROXY_DISABLED', message: '대리인 발급 기능이 비활성화 상태입니다(법무 확정 대기).' });
    const req = await this.prisma.documentRequest.findUnique({ where: { id } });
    if (!req) throw new NotFoundException('서류 요청을 찾을 수 없습니다.');
    if (req.requesterType !== 'PROXY') throw new BadRequestException({ code: 'NOT_PROXY', message: '대리 신청 건이 아닙니다.' });
    const status = dto.decision === 'VERIFIED' ? 'VERIFIED' : 'REJECTED';
    await this.prisma.documentRequest.update({
      where: { id },
      data: {
        proxyVerifyStatus: status, proxyVerifiedBy: userId, proxyVerifiedAt: new Date(),
        requesterRelation: dto.relation ?? req.requesterRelation,
        legalBasis: dto.legalBasis ?? req.legalBasis,
        ...(status === 'REJECTED' ? { status: 'REJECTED', rejectReason: (dto.note ?? 'NOT_ELIGIBLE').slice(0, 300) } : {}),
      },
    });
    await this.audit.safeLog({ userId, action: AuditAction.UPDATE, resourceType: 'DocumentRequest', resourceId: id,
      changes: { proxyVerifyStatus: { old: req.proxyVerifyStatus, new: status } } });
    return { ok: true, proxyVerifyStatus: status };
  }

  /**
   * 창구(원무) 접수 — N-W1. 포털 신청이 성립하지 않는 서류(사망진단서 — 사망자 본인 계정 불가·유족 대면 신청)의
   * 접수 경로. 🔴 신청인 신분·관계 확인은 창구의 대면 책임이다 — 시스템은 검증하지 않으며 그 사실을 기록한다
   * (자동 검증(P1 대리인)은 법무 확정 대기 — proxyEnabled 게이트와 별개 경로).
   * 수수료는 규칙엔진 정본(getFeeRules→computeFeeWith)으로 산정한다 — TYPE_FEES 중복표를 늘리지 않는다.
   */
  async staffCreateRequest(
    dto: { patientId: string; type: string; purpose?: string; copies?: number; deliveryMethod?: string; deliveryDestination?: string; note?: string; requesterRelation?: string; legalBasis?: string; identityChecked?: boolean },
    userId: string,
  ) {
    const patient = await this.prisma.patient.findUnique({ where: { id: dto.patientId }, select: { id: true, mrn: true, familyName: true, givenName: true } });
    if (!patient) throw new NotFoundException('환자를 찾을 수 없습니다.');
    // 보낼 곳(2026-10-10) — 우편은 주소, 팩스는 번호가 있어야 보낼 수 있다 · 방문·포털은 받지 않는다(남기지 않는다)
    const method = dto.deliveryMethod ?? 'VISIT';
    const dest = dto.deliveryDestination?.trim() || null;
    if (method === 'MAIL' && (!dest || dest.length < 5)) throw new BadRequestException({ code: 'DELIVERY_ADDRESS_REQUIRED', message: '우편 수령은 주소가 필요합니다.' });
    if (method === 'FAX' && (!dest || !FAX_RE.test(dest))) throw new BadRequestException({ code: 'DELIVERY_FAX_INVALID', message: '팩스 수령은 팩스 번호(숫자·하이픈 7~20자)가 필요합니다.' });
    // 대리 신청 — 창구 대면 확인을 했으면 확인자·시각을 남긴다(진위 검증 아님) · 안 했으면 확인 대기
    const isProxy = !!dto.legalBasis && dto.legalBasis !== 'SELF';
    const { rules, source } = await this.getFeeRules();
    if (!rules[dto.type]) throw new BadRequestException({ code: 'UNKNOWN_DOC_TYPE', message: `지원하지 않는 서류 종류입니다: ${dto.type}` });
    const copies = Math.max(1, Math.min(DOC_MAX_COPIES, dto.copies ?? 1));
    const breakdown = computeFeeWith(rules, source, dto.type, isBGroup(dto.type) ? 1 : 0, copies);
    const created = await this.prisma.documentRequest.create({
      data: {
        patientId: dto.patientId, type: dto.type, purpose: dto.purpose?.slice(0, 200),
        copies, deliveryMethod: method,
        deliveryDestination: method === 'MAIL' || method === 'FAX' ? dest!.slice(0, 300) : null,
        note: dto.note?.slice(0, 500),
        requesterType: 'STAFF', // 창구 접수 — 대면 확인은 창구 책임(시스템 미검증)
        requesterRelation: dto.requesterRelation?.slice(0, 30),
        legalBasis: dto.legalBasis?.slice(0, 20),
        ...(isProxy ? (dto.identityChecked
          ? { proxyVerifyStatus: 'VERIFIED', proxyVerifiedBy: userId, proxyVerifiedAt: new Date() }
          : { proxyVerifyStatus: 'PENDING' }) : {}),
        fee: breakdown.total, feeBreakdown: breakdown as unknown as object,
        slaDueAt: new Date(Date.now() + 3 * 86400000),
      },
    });
    await this.audit.safeLog({ userId, action: AuditAction.CREATE, resourceType: 'DocumentRequest', resourceId: created.id,
      changes: { staffIntake: { old: null, new: dto.type } } });
    // 접수증 — 접수번호는 요청 id 앞 8자리(대조용) · 수수료는 견적(발급 때 장수·부수로 다시 센다)
    return {
      ...created,
      patient: { mrn: patient.mrn, name: joinPatientName(patient.familyName, patient.givenName) },
      receipt: { number: receiptNumberOf(created.id), feeIsEstimate: true },
      // 접수증에 "수납 연결" — 발급 때 수납에 올리는지(설정) · 진료 연결이 없으면 창구 수납
      // 막 만든 요청엔 수납 라인이 있을 수 없다 — 원장을 읽지 않고 설정·진료 연결만으로 말한다
      feeBilling: deriveFeeBillingLink(await this.feeBillingMode(), created, null),
    };
  }

  // ─────────────────────────── 의료진: 큐 / 상세
  async staffQueue(filter: { status?: string; type?: string; q?: string }) {
    const where: any = {};
    if (filter.status) where.status = filter.status;
    if (filter.type) where.type = filter.type;
    // 찾기(2026-10-10) — 등록번호·이름(성+이름 붙여 쓰기 포함)·접수번호(요청 id 앞자리)
    const q = filter.q?.trim();
    if (q) {
      const or: any[] = [{ patient: { mrn: { contains: q, mode: 'insensitive' } } }, { patient: { familyName: { contains: q } } }, { patient: { givenName: { contains: q } } }];
      if (q.length >= 2) or.push({ patient: { familyName: { startsWith: q.slice(0, 1) }, givenName: { startsWith: q.slice(1) } } });
      if (/^[0-9a-f-]{4,36}$/i.test(q)) or.push({ id: { startsWith: q.toLowerCase() } });
      where.OR = or;
    }
    const rows = await this.prisma.documentRequest.findMany({
      where,
      orderBy: { createdAt: 'asc' },
      take: 100,
      include: { patient: { select: { mrn: true, familyName: true, givenName: true } } },
    });
    const [counts, total, links] = await Promise.all([
      this.prisma.documentRequest.groupBy({ by: ['status'], _count: { id: true } }),
      this.prisma.documentRequest.count({ where }),
      this.feeBillingLinks(rows),
    ]);
    return {
      // 자르면 잘랐다고(2026-10-10) — 오래된 순 100건
      total, truncated: total > rows.length,
      items: rows.map((r) => ({
        id: r.id, receiptNumber: receiptNumberOf(r.id), type: r.type, status: r.status, copies: r.copies, fee: r.fee,
        purpose: r.purpose, recordTypes: r.recordTypes, deliveryMethod: r.deliveryMethod, deliveryDestination: r.deliveryDestination,
        requesterType: r.requesterType, legalBasis: r.legalBasis, proxyVerifyStatus: r.proxyVerifyStatus,
        periodFrom: r.periodFrom, periodTo: r.periodTo, createdAt: r.createdAt, slaDueAt: r.slaDueAt,
        feeBilling: links.get(r.id) ?? null,
        patient: { mrn: r.patient.mrn, name: `${r.patient.familyName ?? ''}${r.patient.givenName ?? ''}`.trim() },
      })),
      stats: Object.fromEntries(counts.map((c) => [c.status, c._count.id])),
    };
  }

  async staffDetail(id: string) {
    const req = await this.prisma.documentRequest.findUnique({
      where: { id },
      include: {
        patient: { select: { id: true, mrn: true, familyName: true, givenName: true, dateOfBirth: true } },
        artifacts: { select: { id: true, recordType: true, pageCount: true, sourceIds: true, issuedDocumentId: true, createdAt: true, authoredJson: true, signedAt: true, signedBy: true } },
      },
    });
    if (!req) throw new NotFoundException('서류 요청을 찾을 수 없습니다.');
    const available = await this.availableRecordCounts(req.patientId, req.periodFrom, req.periodTo);
    const { rules, source } = await this.getFeeRules();
    const estimatedFee = computeFeeWith(rules, source, req.type, this.pagesOf(req as unknown as { type: string; artifacts: { sourceIds: unknown }[] }), req.copies);
    const feeBilling = (await this.feeBillingLinks([req])).get(req.id) ?? null;
    return { request: req, available, estimatedFee, feeBilling };
  }

  /** 기간 내 환자별 동결 가능한 SIGNED 기록 건수(의료진 범위 선택 보조) */
  private async availableRecordCounts(patientId: string, from: Date | null, to: Date | null) {
    const admissionIds = (await this.prisma.admission.findMany({ where: { patientId }, select: { id: true } })).map((a) => a.id);
    const encWhere: any = { patientId, status: 'SIGNED' };
    if (from || to) encWhere.createdAt = this.range(from, to);
    const admScope = (dateField: string) => {
      const w: any = { admissionId: { in: admissionIds } };
      if (from || to) w[dateField] = this.range(from, to);
      return w;
    };
    const [enc, prog, nurse, uniNurse, disch, chronic] = await Promise.all([
      this.prisma.encounter.count({ where: encWhere }),
      admissionIds.length ? this.prisma.progressNote.count({ where: admScope('noteDate') }) : Promise.resolve(0),
      admissionIds.length ? this.prisma.nursingNote.count({ where: { ...admScope('recordedAt'), status: 'SIGNED' } }) : Promise.resolve(0),
      // 🔴 간호기록은 정본이 둘로 갈려 있다(입원=NursingNote · 외래·응급·PACU·수술=UniversalNursingNote).
      //    입원분만 세면 **외래 간호기록이 사본 발급에서 통째로 빠진다** — 법정 기록 누락이다(의료법 §21).
      this.prisma.universalNursingNote.count({
        where: { patientId, ...((from || to) ? { recordedAt: this.range(from, to) } : {}) },
      }),
      admissionIds.length ? this.prisma.dischargeSummary.count({ where: { admissionId: { in: admissionIds }, status: 'SIGNED' } }) : Promise.resolve(0),
      this.prisma.chronicObservation.count({ where: { patientId, context: 'CHRONIC', ...((from || to) ? { measuredAt: this.range(from, to) } : {}) } }),
    ]);
    return { ENCOUNTER: enc, PROGRESS: prog, NURSING: nurse + uniNurse, DISCHARGE: disch, PRESCRIPTION: enc > 0 ? -1 : 0, CHRONIC: chronic };
  }

  private range(from: Date | null, to: Date | null) {
    const r: any = {};
    if (from) r.gte = from;
    if (to) r.lte = this.endOfDay(to); // 종료일 당일 23:59:59 포함(date→timestamptz 경계 누락 방지)
    return r;
  }

  /** 날짜의 당일 끝(로컬 자정 직전) — 기간 종료일이 같은 날 기록을 빠뜨리지 않도록 */
  private endOfDay(d: Date): Date {
    const e = new Date(d);
    e.setHours(23, 59, 59, 999);
    return e;
  }

  // ─────────────────────────── 스냅샷 동결
  async createSnapshot(
    id: string,
    dto: { recordTypes: string[]; periodFrom?: string; periodTo?: string },
    userId: string,
  ) {
    const req = await this.prisma.documentRequest.findUnique({ where: { id } });
    if (!req) throw new NotFoundException('서류 요청을 찾을 수 없습니다.');
    if (req.issuedDocumentId) throw new BadRequestException({ code: 'ALREADY_ISSUED', message: '이미 발급된 요청입니다.' });
    assertOpen(req);
    // P1 대리인 자격 게이트 — 대리 신청은 자격 검증(VERIFIED) 후에만 처리 가능
    if (req.requesterType === 'PROXY' && req.proxyVerifyStatus !== 'VERIFIED')
      throw new BadRequestException({ code: 'PROXY_NOT_VERIFIED', message: '대리인 자격 검증 후 처리할 수 있습니다.' });
    const types = (dto.recordTypes ?? []).filter((t): t is IssuanceRecordType => (ISSUANCE_RECORD_TYPES as readonly string[]).includes(t));
    if (!types.length) throw new BadRequestException({ code: 'NO_RECORD_TYPE', message: '발급할 기록 유형을 1개 이상 선택하세요.' });
    const from = dto.periodFrom ? new Date(dto.periodFrom) : null;
    const to = dto.periodTo ? new Date(dto.periodTo) : null;

    // 동결 데이터 빌드(읽기) 후, 삭제·생성·상태전이를 단일 트랜잭션으로 원자 처리
    const artifacts: { recordType: string; sourceIds: string[]; snapshot: unknown }[] = [];
    for (const t of types) {
      const { sourceIds, snapshot } = await this.buildSnapshot(t, req.patientId, from, to);
      artifacts.push({ recordType: t, sourceIds, snapshot });
    }
    await this.prisma.$transaction([
      this.prisma.issuanceArtifact.deleteMany({ where: { requestId: id } }),
      ...artifacts.filter((a) => a.sourceIds.length).map((a) =>
        this.prisma.issuanceArtifact.create({
          data: { requestId: id, recordType: a.recordType, sourceIds: a.sourceIds, snapshotJson: a.snapshot as object, createdBy: userId },
        })),
      this.prisma.documentRequest.update({
        where: { id },
        data: { status: 'IN_REVIEW', recordTypes: types, processedBy: userId, processedAt: new Date(),
          periodFrom: from ?? req.periodFrom, periodTo: to ?? req.periodTo },
      }),
    ]);
    const built = artifacts.map((a) => ({ recordType: a.recordType, count: a.sourceIds.length }));
    await this.audit.safeLog({ userId, action: AuditAction.UPDATE, resourceType: 'DocumentRequest', resourceId: id,
      changes: { status: { old: req.status, new: 'IN_REVIEW' }, recordTypes: { old: req.recordTypes, new: types } } });
    return { ok: true, artifacts: built };
  }

  /** record_type별 SIGNED 원천 동결 — 모델 실제 스키마에 맞춘 필터(C-4 반영) */
  private async buildSnapshot(type: IssuanceRecordType, patientId: string, from: Date | null, to: Date | null) {
    const admissionIds = (await this.prisma.admission.findMany({ where: { patientId }, select: { id: true } })).map((a) => a.id);
    const dr = (this.range(from, to)) as { gte?: Date; lte?: Date };
    const hasRange = from || to;

    if (type === 'ENCOUNTER') {
      const rows = await this.prisma.encounter.findMany({
        where: { patientId, status: 'SIGNED', ...(hasRange ? { createdAt: dr } : {}) },
        orderBy: { createdAt: 'asc' },
        include: { doctor: { select: { familyName: true, givenName: true } }, diagnoses: { include: { diagnosisCode: { select: { code: true, nameKo: true } } } } },
      });
      return {
        sourceIds: rows.map((r) => r.id),
        snapshot: rows.map((r) => ({
          id: r.id, date: r.createdAt, signedAt: r.signedAt, visitType: r.visitType,
          doctor: `${r.doctor?.familyName ?? ''}${r.doctor?.givenName ?? ''}`.trim(),
          chiefComplaint: r.chiefComplaint, soap: { S: r.subjective, O: r.objective, A: r.assessment, P: r.plan },
          diagnoses: r.diagnoses.map((d) => ({ type: d.type, certainty: d.certainty, code: d.diagnosisCode?.code, name: d.diagnosisCode?.nameKo })),
        })),
      };
    }
    if (type === 'PROGRESS') {
      if (!admissionIds.length) return { sourceIds: [], snapshot: [] };
      const rows = await this.prisma.progressNote.findMany({
        where: { admissionId: { in: admissionIds }, ...(hasRange ? { noteDate: dr } : {}) },
        orderBy: { noteDate: 'asc' },
      });
      return { sourceIds: rows.map((r) => r.id), snapshot: rows.map((r) => ({ id: r.id, date: r.noteDate, content: r.content, vitalSigns: r.vitalSigns })) };
    }
    if (type === 'NURSING') {
      // 🔴 간호기록 정본은 **컨텍스트로 갈린다** — 입원=NursingNote(서명 정본) · 그 밖=UniversalNursingNote.
      //    종전엔 입원분만 동결해 **외래·응급 간호기록이 사본에서 통째로 빠졌다**(입원 이력이 없는
      //    환자는 '간호기록 0건'). 법정 사본이므로 두 정본을 모두 동결하되,
      //    서명 체계가 **없는** 범용 기록은 서명된 척하지 않는다(`signed:false`·`signatureModel:'NONE'`).
      const [wardRows, uniRows] = await Promise.all([
        admissionIds.length
          ? this.prisma.nursingNote.findMany({
              where: { admissionId: { in: admissionIds }, status: 'SIGNED', ...(hasRange ? { recordedAt: dr } : {}) },
              orderBy: { recordedAt: 'asc' },
            })
          : Promise.resolve([]),
        this.prisma.universalNursingNote.findMany({
          where: { patientId, ...(hasRange ? { recordedAt: dr } : {}) },
          orderBy: { recordedAt: 'asc' },
        }),
      ]);
      const ward = wardRows.map((r) => ({
        id: r.id, source: 'ADMISSION' as const, context: 'INPATIENT', date: r.recordedAt, focus: r.focus,
        dar: { D: r.data, A: r.action, R: r.response, E: r.education },
        soap: { S: r.subjective, O: r.objective, A: r.assessment, P: r.plan },
        content: r.content, signed: true, signatureModel: 'SIGNED' as const,
      }));
      const uni = uniRows.map((r) => ({
        id: r.id, source: 'UNIVERSAL' as const, context: r.contextType, date: r.recordedAt, focus: null,
        dar: null,
        sbar: { S: r.situation, B: r.background, A: r.assessment, R: r.recommendation },
        content: r.content, noteType: r.noteType, severity: r.severity,
        signed: false, signatureModel: 'NONE' as const,
      }));
      const snapshot = [...ward, ...uni].sort(
        (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
      );
      return { sourceIds: snapshot.map((r) => r.id), snapshot };
    }
    if (type === 'DISCHARGE') {
      if (!admissionIds.length) return { sourceIds: [], snapshot: [] };
      const rows = await this.prisma.dischargeSummary.findMany({
        where: { admissionId: { in: admissionIds }, status: 'SIGNED' },
        orderBy: { dischargeDate: 'asc' },
      });
      return {
        sourceIds: rows.map((r) => r.id),
        snapshot: rows.map((r) => ({ id: r.id, admitDate: r.admitDate, dischargeDate: r.dischargeDate,
          admitDiagnosis: r.admitDiagnosis, dischargeDiagnosis: r.dischargeDiagnosis, hospitalCourse: r.hospitalCourse,
          procedures: r.procedures, conditionAtDischarge: r.conditionAtDischarge, followUpPlan: r.followUpPlan })),
      };
    }
    if (type === 'CHRONIC') {
      // 만성질환 측정 추이(P3c) — ChronicObservation(만성 맥락) 동결. 환자 "수치 추이" 사본(의료법 §21)
      const rows = await this.prisma.chronicObservation.findMany({
        where: { patientId, context: 'CHRONIC', ...(hasRange ? { measuredAt: dr } : {}) },
        orderBy: { measuredAt: 'asc' },
        select: { id: true, code: true, value: true, unit: true, measuredAt: true, flag: true, source: true },
      });
      return {
        sourceIds: rows.map((r) => r.id),
        snapshot: rows.map((r) => ({ id: r.id, code: r.code, value: Number(r.value), unit: r.unit, measuredAt: r.measuredAt, flag: r.flag, source: r.source })),
      };
    }
    // PRESCRIPTION — 환자의 SIGNED encounter 처방
    const encs = await this.prisma.encounter.findMany({
      where: { patientId, status: 'SIGNED', ...(hasRange ? { createdAt: dr } : {}) },
      select: { id: true },
    });
    const encIds = encs.map((e) => e.id);
    if (!encIds.length) return { sourceIds: [], snapshot: [] };
    const rows = await this.prisma.prescription.findMany({
      where: { encounterId: { in: encIds }, status: { not: 'CANCELLED' } }, // 취소 처방 제외(C-2)
      orderBy: { createdAt: 'asc' },
      include: { medicationCode: { select: { code: true, nameKo: true } } },
    });
    return {
      sourceIds: rows.map((r) => r.id),
      snapshot: rows.map((r) => ({ id: r.id, date: r.createdAt, type: r.type, status: r.status,
        medication: r.medicationCode ? { code: r.medicationCode.code, name: r.medicationCode.nameKo } : null,
        dosage: r.dosage, frequency: r.frequency, duration: r.duration, quantity: r.quantity, route: r.route })),
    };
  }

  // ═══════════════ B그룹: 진단서·소견서·입퇴원확인서 (작성·서명·발급) ═══════════════

  /** 작성 초안 — 진료기록 기반 자동 채움(진단명·발병일·담당의) */
  async certificateDraft(id: string, encounterId: string | undefined, userId: string) {
    const req = await this.prisma.documentRequest.findUnique({ where: { id } });
    if (!req) throw new NotFoundException('서류 요청을 찾을 수 없습니다.');
    if (!isBGroup(req.type)) throw new BadRequestException({ code: 'NOT_CERTIFICATE', message: '증명서 요청이 아닙니다.' });
    if (req.type === 'DEATH_CERT') return this.deathCertDraft(req.patientId, userId);
    if (req.type === 'BIRTH_CERT') return this.birthCertDraft(req.patientId, userId);
    // 🔴 (2026-10-13 결함 발굴 B7) 입퇴원확인서는 입원을 고른다 — 종전 양식·스냅샷에 입원일·퇴원일이 없었다
    const admissions = req.type === 'ADMISSION_CERT'
      ? (await this.prisma.admission.findMany({ where: { patientId: req.patientId }, orderBy: { admitDate: 'desc' }, take: 20, select: { id: true, admitDate: true, dischargeDate: true, status: true } }))
      : undefined;
    // 대상 encounter — 인자 지정 > 환자가 포털서 선택한 request.encounterId > 가장 최근 SIGNED
    const targetEnc = encounterId ?? req.encounterId ?? undefined;
    const enc = await this.prisma.encounter.findFirst({
      where: { patientId: req.patientId, status: 'SIGNED', ...(targetEnc ? { id: targetEnc } : {}) },
      orderBy: { createdAt: 'desc' },
      include: { doctor: { select: { id: true, familyName: true, givenName: true } }, diagnoses: { include: { diagnosisCode: { select: { code: true, nameKo: true } } } } },
    });
    // P2b — 만성질환 경과 자동채움(SoT 파생). 작성 의사가 검토·수정해 본문에 반영.
    const chronicSummary = await this.chronic.getProblemNarrative(req.patientId);
    return {
      encounterId: enc?.id ?? null,
      isAttending: enc?.doctor?.id === userId,
      attendingDoctorId: enc?.doctor?.id ?? null,
      draft: enc ? {
        diagnoses: enc.diagnoses.map((d) => ({ kcdCode: d.diagnosisCode?.code, name: d.diagnosisCode?.nameKo, type: d.type, certainty: d.certainty })),
        onsetDate: enc.diagnoses.find((d) => d.onsetDate)?.onsetDate ?? null,
        diagnosedDate: enc.createdAt,
        treatmentOpinion: enc.plan ?? '',
        purpose: req.purpose ?? '',
      } : null,
      chronicSummary: chronicSummary.text ? chronicSummary : null, // 만성 진단 없으면 null
      ...(admissions ? { admissions } : {}),
    };
  }

  /**
   * 사망진단서 초안 — 정본은 Patient.death*(사인체인 가~라·일시·장소·종류, 2026-08-26 영속화).
   * 🔴 서식 종류(사망진단서/시체검안서)는 최종 진료~사망 48시간 규칙으로 **제안만** 한다 — 확정은 의사.
   * 작성 자격 = 사망 확인 의사 본인 또는 그 환자를 직접 진찰(SIGNED)한 의사.
   */
  private async deathCertDraft(patientId: string, userId: string) {
    const patient = await this.prisma.patient.findUnique({
      where: { id: patientId },
      select: { isDeceased: true, deathDate: true, deathLocation: true, deathType: true, deathCauseChain: true, deathConfirmedBy: true },
    });
    const lastEnc = await this.prisma.encounter.findFirst({
      where: { patientId, status: 'SIGNED' }, orderBy: { createdAt: 'desc' },
      select: { id: true, createdAt: true, doctorId: true },
    });
    const treated = await this.prisma.encounter.findFirst({ where: { patientId, doctorId: userId, status: 'SIGNED' }, select: { id: true } });
    const hasDeath = !!(patient?.isDeceased && patient.deathDate);
    // 48시간 규칙 — 최종 진료 기록이 없으면 판정 불가(지어내지 않는다)
    const suggestedKind = hasDeath && lastEnc
      ? (patient!.deathDate!.getTime() - lastEnc.createdAt.getTime() <= DEATH_CERT_WINDOW_MS ? 'DEATH_CERT' : 'POSTMORTEM')
      : null;
    const chain = (patient?.deathCauseChain ?? null) as { a?: string; b?: string; c?: string; d?: string } | null;
    return {
      encounterId: lastEnc?.id ?? null,
      isAttending: !!treated || (patient?.deathConfirmedBy != null && patient.deathConfirmedBy === userId),
      attendingDoctorId: lastEnc?.doctorId ?? null,
      draft: hasDeath ? {
        death: {
          deathDate: patient!.deathDate, deathLocation: patient!.deathLocation, deathType: patient!.deathType,
          causeChain: { a: chain?.a ?? '', b: chain?.b ?? '', c: chain?.c ?? '', d: chain?.d ?? '' },
          certKind: suggestedKind, // 제안값 — 의사가 바꿀 수 있다
        },
        purpose: '',
      } : null,
      suggestedKind, // null = 최종 진료 기록 부재로 판정 불가(사람이 정한다)
      lastSignedEncounterAt: lastEnc?.createdAt ?? null,
      chronicSummary: null,
    };
  }

  /**
   * 출생증명서 초안 — 정본은 DeliveryRecord/NewbornRecord(분만 기록).
   * 작성 자격 = 분만 의사(deliveredBy) 본인 또는 산모를 직접 진찰(SIGNED)한 의사.
   */
  private async birthCertDraft(patientId: string, userId: string) {
    // relation 없음(plain FK) — 수동 조회가 규약(obgyn.service 동일)
    const delivery = await this.prisma.deliveryRecord.findFirst({
      where: { patientId, status: { in: ['DELIVERED', 'POSTPARTUM', 'CLOSED'] } },
      orderBy: { createdAt: 'desc' },
      include: { newborns: { orderBy: { birthOrder: 'asc' } } },
    });
    const treated = await this.prisma.encounter.findFirst({ where: { patientId, doctorId: userId, status: 'SIGNED' }, select: { id: true } });
    return {
      encounterId: null,
      isAttending: !!treated || (delivery?.deliveredBy != null && delivery.deliveredBy === userId),
      attendingDoctorId: delivery?.deliveredBy ?? null,
      draft: delivery ? {
        birth: {
          deliveryId: delivery.id,
          deliveredAt: delivery.deliveredAt, deliveryType: delivery.deliveryType,
          gestationalWeeks: delivery.gestationalWeeks, // "39+2" 문자열 그대로(파싱 변조 금지)
          newborns: delivery.newborns.map((n) => ({
            birthOrder: n.birthOrder, sex: n.sex, birthAt: n.birthAt,
            weightG: n.weightG, lengthCm: n.lengthCm != null ? Number(n.lengthCm) : null,
          })),
        },
        purpose: '',
      } : null,
      chronicSummary: null,
    };
  }

  /** 작성/임시저장 — 담당의(직접 진찰) 검증 후 단일 artifact 에 동결+작성본 저장 */
  async authorCertificate(
    id: string,
    dto: {
      encounterId?: string; diagnoses?: { kcdCode?: string; name?: string }[]; onsetDate?: string; diagnosedDate?: string; treatmentOpinion?: string; purpose?: string; content?: string;
      /** B7 입퇴원확인서 — 대상 입원(환자의 입원이 하나뿐이면 생략 가능) */
      admissionId?: string;
      /** N-W1 사망진단서 — 사인체인·일시·장소·종류. certKind 는 의사가 확정(서버는 제안만) */
      death?: { deathDate?: string; deathLocation?: string; deathType?: string; causeChain?: { a?: string; b?: string; c?: string; d?: string }; certKind?: 'DEATH_CERT' | 'POSTMORTEM' };
      /** N-W1 출생증명서 — 대상 신생아 순번(다태아)·분만 기록 스냅샷 */
      birth?: { deliveryId?: string; birthOrder?: number };
    },
    userId: string,
  ) {
    const req = await this.prisma.documentRequest.findUnique({ where: { id } });
    if (!req) throw new NotFoundException('서류 요청을 찾을 수 없습니다.');
    if (!isBGroup(req.type)) throw new BadRequestException({ code: 'NOT_CERTIFICATE', message: '증명서 요청이 아닙니다.' });
    if (req.issuedDocumentId) throw new BadRequestException({ code: 'ALREADY_ISSUED', message: '이미 발급된 요청입니다.' });
    assertOpen(req);

    const me = await this.prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
    if (me?.role !== 'DOCTOR') throw new ForbiddenException({ code: 'DOCTOR_ONLY', message: '증명서 작성은 의사만 가능합니다.' });

    // 의료법 §17 — 진단서는 직접 진찰한 의사(해당 진료의)만
    let sourceIds: string[] = [];
    const encId = dto.encounterId ?? req.encounterId ?? undefined; // 환자 포털 선택 진료 fallback
    if (req.type === 'DIAGNOSIS_CERT') {
      if (!encId) throw new BadRequestException({ code: 'ENCOUNTER_REQUIRED', message: '진단서는 근거 진료(encounter)가 필요합니다.' });
      const enc = await this.prisma.encounter.findUnique({ where: { id: encId }, select: { patientId: true, doctorId: true } });
      if (!enc || enc.patientId !== req.patientId) throw new BadRequestException({ code: 'ENCOUNTER_INVALID', message: '해당 환자의 진료가 아닙니다.' });
      if (enc.doctorId !== userId) throw new ForbiddenException({ code: 'NOT_ATTENDING', message: '직접 진찰한 의사만 진단서를 작성할 수 있습니다(의료법 §17).' });
      sourceIds = [encId];
    }

    // 🔴 §17 게이트는 type 별로 근거가 다르다 — DIAGNOSIS_CERT=근거 진료, DEATH_CERT=사망 사실,
    //    BIRTH_CERT=분만 기록. (OPINION·ADMISSION_CERT 는 종전대로 DOCTOR 만 — 기존 동작 불변)
    let deathAuthored: Record<string, unknown> | null = null;
    let birthAuthored: Record<string, unknown> | null = null;
    if (req.type === 'DEATH_CERT') {
      const patient = await this.prisma.patient.findUnique({
        where: { id: req.patientId },
        select: { isDeceased: true, deathDate: true, deathLocation: true, deathType: true, deathCauseChain: true, deathConfirmedBy: true },
      });
      if (!patient?.isDeceased || !patient.deathDate)
        throw new BadRequestException({ code: 'DEATH_RECORD_REQUIRED', message: '사망 기록(사망 처리)이 없는 환자입니다 — 환자 차트에서 사망 처리를 먼저 하세요.' });
      const treated = await this.prisma.encounter.findFirst({ where: { patientId: req.patientId, doctorId: userId, status: 'SIGNED' }, select: { id: true } });
      if (!treated && patient.deathConfirmedBy !== userId)
        throw new ForbiddenException({ code: 'NOT_ATTENDING_DEATH', message: '직접 진찰(진료 이력)했거나 사망을 확인한 의사만 작성할 수 있습니다(의료법 §17).' });
      const chain = (patient.deathCauseChain ?? null) as { a?: string; b?: string; c?: string; d?: string } | null;
      const d = dto.death ?? {};
      const causeChain = d.causeChain ?? { a: chain?.a ?? '', b: chain?.b ?? '', c: chain?.c ?? '', d: chain?.d ?? '' };
      if (!causeChain.a?.trim())
        throw new BadRequestException({ code: 'CAUSE_A_REQUIRED', message: '직접 사인(가)은 필수입니다.' });
      if (d.certKind && !['DEATH_CERT', 'POSTMORTEM'].includes(d.certKind))
        throw new BadRequestException({ code: 'INVALID_CERT_KIND', message: '서식 종류는 사망진단서/시체검안서 중 하나입니다.' });
      deathAuthored = {
        deathDate: d.deathDate ?? patient.deathDate.toISOString(),
        deathLocation: d.deathLocation ?? patient.deathLocation ?? null,
        deathType: d.deathType ?? patient.deathType ?? null,
        causeChain,
        certKind: d.certKind ?? 'DEATH_CERT',
      };
    }
    if (req.type === 'BIRTH_CERT') {
      const delivery = await this.prisma.deliveryRecord.findFirst({
        where: { patientId: req.patientId, ...(dto.birth?.deliveryId ? { id: dto.birth.deliveryId } : {}), status: { in: ['DELIVERED', 'POSTPARTUM', 'CLOSED'] } },
        orderBy: { createdAt: 'desc' },
        include: { newborns: { orderBy: { birthOrder: 'asc' } } },
      });
      if (!delivery)
        throw new BadRequestException({ code: 'DELIVERY_RECORD_REQUIRED', message: '분만 기록이 없는 환자입니다 — 분만 기록(산과)이 먼저 필요합니다.' });
      const treated = await this.prisma.encounter.findFirst({ where: { patientId: req.patientId, doctorId: userId, status: 'SIGNED' }, select: { id: true } });
      if (!treated && delivery.deliveredBy !== userId)
        throw new ForbiddenException({ code: 'NOT_ATTENDING_BIRTH', message: '분만에 관여했거나 직접 진찰한 의사만 작성할 수 있습니다(의료법 §17).' });
      const order = dto.birth?.birthOrder ?? (delivery.newborns.length === 1 ? delivery.newborns[0].birthOrder : undefined);
      const newborn = delivery.newborns.find((n) => n.birthOrder === order);
      if (!newborn)
        throw new BadRequestException({ code: 'NEWBORN_REQUIRED', message: '대상 신생아(출생 순번)를 지정하세요 — 다태아는 순번별로 각각 발급합니다.' });
      birthAuthored = {
        deliveryId: delivery.id, birthOrder: newborn.birthOrder,
        birthAt: newborn.birthAt.toISOString(), sex: newborn.sex,
        weightG: newborn.weightG, lengthCm: newborn.lengthCm != null ? Number(newborn.lengthCm) : null,
        deliveryType: delivery.deliveryType, gestationalWeeks: delivery.gestationalWeeks,
        totalNewborns: delivery.newborns.length,
      };
      sourceIds = [delivery.id];
    }

    // 🔴 (B7) 입퇴원확인서 — 입원·퇴원 일자는 원장에서(작성자가 적지 않는다) · 입원이 여럿이면 골라야 한다(지어 고르지 않는다)
    let admissionAuthored: { admissionId: string; admitDate: Date; dischargeDate: Date | null } | null = null;
    if (req.type === 'ADMISSION_CERT') {
      const rows = await this.prisma.admission.findMany({
        where: { patientId: req.patientId, ...(dto.admissionId ? { id: dto.admissionId } : {}) },
        select: { id: true, admitDate: true, dischargeDate: true }, take: 2,
      });
      if (dto.admissionId && rows.length === 0) throw new BadRequestException({ code: 'ADMISSION_INVALID', message: '해당 환자의 입원이 아닙니다.' });
      if (rows.length !== 1) throw new BadRequestException({ code: 'ADMISSION_REQUIRED', message: rows.length === 0 ? '이 환자의 입원 기록이 없습니다.' : '입원이 여럿입니다 — 확인서에 쓸 입원을 고르세요.' });
      admissionAuthored = { admissionId: rows[0].id, admitDate: rows[0].admitDate, dischargeDate: rows[0].dischargeDate };
      sourceIds = [rows[0].id];
    }

    const authored = {
      ...(admissionAuthored ? { admission: admissionAuthored } : {}),
      diagnoses: dto.diagnoses ?? [], onsetDate: dto.onsetDate ?? null, diagnosedDate: dto.diagnosedDate ?? null,
      treatmentOpinion: dto.treatmentOpinion ?? '', purpose: dto.purpose ?? req.purpose ?? '', content: dto.content ?? null,
      ...(deathAuthored ? { death: deathAuthored } : {}),
      ...(birthAuthored ? { birth: birthAuthored } : {}),
    };
    const recordType = B_GROUP[req.type].recordType;
    // 단일 artifact upsert(재작성 허용 — 서명 전까지)
    const existing = await this.prisma.issuanceArtifact.findFirst({ where: { requestId: id } });
    if (existing?.signedAt) throw new BadRequestException({ code: 'ALREADY_SIGNED', message: '이미 서명된 증명서는 수정할 수 없습니다. 반려 후 재요청하세요.' });
    // 🔴 (2026-09-16 I2) 증명서 본문(artifact)과 요청 상태를 한 트랜잭션에서 쓴다. 종전엔 본문이
    //    먼저 커밋되고 상태 갱신이 따로 나가, 중간 실패 시 **작성된 증명서가 검토 목록에 뜨지 않는다**
    //    (법정 서식 — 작성자는 냈다고 알고 원무는 안 온 것으로 본다).
    await this.prisma.$transaction(async (tx) => {
      if (existing) {
        await tx.issuanceArtifact.update({ where: { id: existing.id }, data: { recordType, sourceIds, authoredJson: authored as object, snapshotJson: authored as object, createdBy: userId } });
      } else {
        await tx.issuanceArtifact.create({ data: { requestId: id, recordType, sourceIds, authoredJson: authored as object, snapshotJson: authored as object, createdBy: userId } });
      }
      await tx.documentRequest.update({ where: { id }, data: { status: 'IN_REVIEW', processedBy: userId, processedAt: new Date() } });
    });
    await this.audit.safeLog({ userId, action: AuditAction.UPDATE, resourceType: 'DocumentRequest', resourceId: id, changes: { authored: { old: null, new: recordType } } });
    return { ok: true };
  }

  /** 전자서명 — 작성 의사 본인이 서명(SIMULATION 내부 기록). 서명 후 발급 가능 */
  async signCertificate(id: string, userId: string) {
    const req = await this.prisma.documentRequest.findUnique({ where: { id }, include: { artifacts: true } });
    if (!req) throw new NotFoundException('서류 요청을 찾을 수 없습니다.');
    if (!isBGroup(req.type)) throw new BadRequestException({ code: 'NOT_CERTIFICATE', message: '증명서 요청이 아닙니다.' });
    if (req.issuedDocumentId) throw new BadRequestException({ code: 'ALREADY_ISSUED', message: '이미 발급된 요청입니다.' });
    const art = req.artifacts[0];
    if (!art || !art.authoredJson) throw new BadRequestException({ code: 'NOT_AUTHORED', message: '작성된 내용이 없습니다. 먼저 작성하세요.' });
    if (art.createdBy !== userId) throw new ForbiddenException({ code: 'NOT_AUTHOR', message: '작성한 의사 본인만 서명할 수 있습니다.' });
    const sigRef = `SIM-${createHashRef(JSON.stringify(art.authoredJson))}`;
    await this.prisma.issuanceArtifact.update({ where: { id: art.id }, data: { signedBy: userId, signedAt: new Date(), signatureRef: sigRef } });
    await this.audit.safeLog({ userId, action: AuditAction.UPDATE, resourceType: 'IssuanceArtifact', resourceId: art.id, changes: { signed: { old: null, new: sigRef } } });
    return { ok: true, signatureRef: sigRef };
  }

  /** B그룹 발급 — 서명(SIGNED) 게이트 + 담당의 면허 표기 + CertificateData snapshot */
  private async issueBGroup(req: { id: string; type: string; patientId: string; purpose: string | null; status: string; artifacts: any[] }, userId: string) {
    const art = req.artifacts[0];
    if (!art || !art.authoredJson) throw new BadRequestException({ code: 'NOT_AUTHORED', message: '작성된 내용이 없습니다.' });
    if (!art.signedAt) throw new BadRequestException({ code: 'SIGN_REQUIRED', message: '전자서명 후 발급할 수 있습니다.' });
    const signerId = art.signedBy ?? userId;
    const [patient, doctor, staff] = await Promise.all([
      this.prisma.patient.findUnique({ where: { id: req.patientId }, select: { mrn: true, familyName: true, givenName: true, dateOfBirth: true, gender: true } }),
      this.prisma.user.findUnique({ where: { id: signerId }, select: { familyName: true, givenName: true } }),
      this.prisma.staff.findUnique({ where: { userId: signerId }, select: { licenseNumber: true } }),
    ]);
    const a = art.authoredJson as any;
    const snapshot = {
      patient: { name: `${patient?.familyName ?? ''}${patient?.givenName ?? ''}`.trim(), mrn: patient?.mrn, sex: patient?.gender, birth: patient?.dateOfBirth },
      diagnoses: a.diagnoses ?? [], onsetDate: a.onsetDate, diagnosedDate: a.diagnosedDate,
      treatmentOpinion: a.treatmentOpinion, content: a.content, purpose: a.purpose,
      ...(a.death ? { death: a.death } : {}),
      ...(a.birth ? { birth: a.birth } : {}),
      ...(a.admission ? { admission: a.admission } : {}),
      doctor: { name: `${doctor?.familyName ?? ''}${doctor?.givenName ?? ''}`.trim(), license: staff?.licenseNumber },
    };
    const docType = B_GROUP[req.type].docType;
    // 🔴 수수료를 먼저 센다 — 발급 문서(발급번호)를 만든 뒤 수수료 조회가 실패하면 요청은 발급되지 않은 채 발급번호만 남는다
    const { fee, breakdown } = await this.resolveFee({ id: req.id, type: req.type, copies: (req as any).copies ?? 1, fee: (req as any).fee ?? null });
    const issued = await this.documents.issue(
      { documentType: docType, sourceId: req.id, patientId: req.patientId, formVersion: 'v1', snapshot: snapshot as Record<string, unknown> },
      userId,
      { preSigned: { signerUserId: signerId } }, // 의사가 작성·서명한 판 — 발급자(원무·의무기록)와 서명 의사는 다르다
    );
    await this.prisma.$transaction([
      this.prisma.documentRequest.update({ where: { id: req.id }, data: { status: 'READY', issuedDocumentId: issued.issueNo, completedAt: new Date(), fee, feeBreakdown: breakdown as object } }),
      this.prisma.issuanceArtifact.updateMany({ where: { requestId: req.id }, data: { issuedDocumentId: issued.issueNo } }),
    ]);
    await this.audit.safeLog({ userId, action: AuditAction.CREATE, resourceType: 'IssuedDocument', resourceId: req.patientId, changes: { issueNo: { old: null, new: issued.issueNo }, documentRequestId: { old: null, new: req.id }, signedBy: { old: null, new: art.signedBy } } });
    this.events.emit('document.ready', { requestId: req.id, patientId: req.patientId, issueNo: issued.issueNo });
    const feeBilling = await this.autoLinkFee(req.id);
    return { issueNo: issued.issueNo, qrUrl: (issued as any).qrUrl, alreadyIssued: false, feeBilling };
  }

  // ─────────────────────────── 발급 (멱등)
  async issue(id: string, userId: string) {
    const req = await this.prisma.documentRequest.findUnique({ where: { id }, include: { artifacts: true } });
    if (!req) throw new NotFoundException('서류 요청을 찾을 수 없습니다.');
    if (req.issuedDocumentId) return { issueNo: req.issuedDocumentId, alreadyIssued: true }; // 멱등
    assertOpen(req); // 🔴 반려된 증명서를 서명본이 남아 있다는 이유로 발급하지 않는다
    if (isBGroup(req.type)) return this.issueBGroup(req as any, userId);
    if (req.status !== 'IN_REVIEW') throw new BadRequestException({ code: 'NOT_IN_REVIEW', message: '스냅샷 검토(IN_REVIEW) 상태에서만 발급할 수 있습니다.' });
    const nonEmpty = req.artifacts.filter((a) => Array.isArray(a.sourceIds) && (a.sourceIds as unknown[]).length > 0);
    if (!nonEmpty.length) throw new BadRequestException({ code: 'EMPTY_SNAPSHOT', message: '동결된 기록이 없습니다. 기록 범위를 다시 선택하세요.' });

    const patient = await this.prisma.patient.findUnique({ where: { id: req.patientId }, select: { mrn: true, familyName: true, givenName: true, dateOfBirth: true } });
    const bundle = {
      kind: 'MEDICAL_RECORD_COPY',
      patient: { mrn: patient?.mrn, name: `${patient?.familyName ?? ''}${patient?.givenName ?? ''}`.trim(), dateOfBirth: patient?.dateOfBirth },
      purpose: req.purpose, period: { from: req.periodFrom, to: req.periodTo },
      sections: nonEmpty.map((a) => ({ recordType: a.recordType, records: a.snapshotJson })),
    };
    // 🔴 수수료를 먼저 센다(발급번호만 남는 반쪽 발급 방지)
    const { fee, breakdown } = await this.resolveFee({ id: req.id, type: req.type, copies: req.copies, fee: req.fee, artifacts: nonEmpty });
    const issued = await this.documents.issue(
      { documentType: ISSUE_DOCTYPE, sourceId: req.id, patientId: req.patientId, formVersion: 'v1', snapshot: bundle as Record<string, unknown> },
      userId,
    );
    await this.prisma.$transaction([
      this.prisma.documentRequest.update({ where: { id }, data: { status: 'READY', issuedDocumentId: issued.issueNo, completedAt: new Date(), fee, feeBreakdown: breakdown as object } }),
      this.prisma.issuanceArtifact.updateMany({ where: { requestId: id }, data: { issuedDocumentId: issued.issueNo } }),
    ]);
    await this.audit.safeLog({ userId, action: AuditAction.CREATE, resourceType: 'IssuedDocument', resourceId: req.patientId,
      changes: { issueNo: { old: null, new: issued.issueNo }, documentRequestId: { old: null, new: id } } });
    this.events.emit('document.ready', { requestId: id, patientId: req.patientId, issueNo: issued.issueNo });
    const feeBilling = await this.autoLinkFee(id);
    return { issueNo: issued.issueNo, qrUrl: (issued as any).qrUrl, alreadyIssued: false, feeBilling };
  }

  // ─────────────────────────── 반려
  async reject(id: string, reason: string, detail: string | undefined, userId: string) {
    if (!(REJECT_REASONS as readonly string[]).includes(reason)) {
      throw new BadRequestException({ code: 'INVALID_REASON', message: '허용되지 않는 반려 사유입니다.' });
    }
    const req = await this.prisma.documentRequest.findUnique({ where: { id } });
    if (!req) throw new NotFoundException('서류 요청을 찾을 수 없습니다.');
    if (req.issuedDocumentId) throw new BadRequestException({ code: 'ALREADY_ISSUED', message: '이미 발급되어 반려할 수 없습니다.' });
    assertOpen(req);
    const rejectReason = `${reason}${detail ? `: ${detail.slice(0, 250)}` : ''}`;
    await this.prisma.documentRequest.update({ where: { id }, data: { status: 'REJECTED', rejectReason, processedBy: userId, processedAt: new Date() } });
    await this.audit.safeLog({ userId, action: AuditAction.UPDATE, resourceType: 'DocumentRequest', resourceId: id,
      changes: { status: { old: req.status, new: 'REJECTED' }, rejectReason: { old: req.rejectReason, new: rejectReason } } });
    this.events.emit('document.rejected', { requestId: id, patientId: req.patientId, reason: rejectReason });
    return { ok: true };
  }

  // ─────────────────────────── 발급대장(P0 최소)
  async ledger(filter: { from?: string; to?: string; type?: string }) {
    const where: any = { status: { in: ['READY', 'DELIVERED'] }, issuedDocumentId: { not: null } };
    if (filter.type) where.type = filter.type;
    if (filter.from || filter.to) where.completedAt = this.range(filter.from ? new Date(filter.from) : null, filter.to ? new Date(filter.to) : null);
    const [rows, total] = await Promise.all([
      this.prisma.documentRequest.findMany({
        where, orderBy: { completedAt: 'desc' }, take: LEDGER_CAP,
        include: { patient: { select: { mrn: true, familyName: true, givenName: true } } },
      }),
      this.prisma.documentRequest.count({ where }),
    ]);
    // 🔴 (2026-10-10) 법정 발급대장이 200건에서 말없이 잘렸다 — 잘림을 말한다
    return { total, truncated: total > rows.length, items: rows.map((r) => ({
      id: r.id, issueNo: r.issuedDocumentId, type: r.type, copies: r.copies, fee: r.fee,
      issuedAt: r.completedAt, processedBy: r.processedBy,
      patient: { mrn: r.patient.mrn, name: `${r.patient.familyName ?? ''}${r.patient.givenName ?? ''}`.trim() },
    })) };
  }

  // ═══════════════ P3-1 수수료 규칙엔진 ═══════════════

  /** 수수료 규칙 — 기본값 + SystemConfig('medical_record.fee_rules') 오버라이드 병합 */
  private async getFeeRules(): Promise<{ rules: Record<string, FeeRule>; source: 'CONFIG' | 'DEFAULT' }> {
    return loadFeeRules(this.prisma);
  }

  /** 요청의 발급 매수(pages) — 사본은 동결 원천 건수 합, 증명서는 1 */
  private pagesOf(req: { type: string; artifacts?: { sourceIds: unknown }[] }): number {
    if (isBGroup(req.type)) return 1;
    return (req.artifacts ?? []).reduce((n, a) => n + (Array.isArray(a.sourceIds) ? (a.sourceIds as unknown[]).length : 0), 0);
  }

  /** 수수료 견적(발급 전 미리보기) */
  async feeEstimate(id: string): Promise<FeeBreakdown> {
    const req = await this.prisma.documentRequest.findUnique({ where: { id }, include: { artifacts: { select: { sourceIds: true } } } });
    if (!req) throw new NotFoundException('서류 요청을 찾을 수 없습니다.');
    const { rules, source } = await this.getFeeRules();
    return computeFeeWith(rules, source, req.type, this.pagesOf(req), req.copies);
  }

  /**
   * 발급 시 수수료 산정 — **발급 시점 규칙·매수·부수로 다시 센다**.
   * 🔴 (2026-10-10) 종전엔 "이미 지정돼 있으면 보존"이었는데, 지정하는 곳은 신청 시점 견적뿐이었다(매수를 모르는 때) —
   *    그래서 사본의 매수 누진이 발급 금액에 **한 번도 반영되지 않았고**(창구·포털 신청은 늘 신청 때 금액),
   *    breakdown 과 fee 가 서로 다른 금액을 말했다. 수수료를 손으로 고치는 경로는 없다(있으면 별도 원장으로).
   */
  private async resolveFee(req: { id: string; type: string; copies: number; fee: number | null; artifacts?: { sourceIds: unknown }[] }): Promise<{ fee: number; breakdown: FeeBreakdown }> {
    const { rules, source } = await this.getFeeRules();
    const breakdown = computeFeeWith(rules, source, req.type, this.pagesOf(req), req.copies);
    return { fee: breakdown.total, breakdown };
  }

  // ═══════════════ P3-2 수령(delivery) 처리 ═══════════════

  /** 수령 완료 — 방문/우편(송장)/팩스. READY(발급완료) 상태에서만. */
  async markDelivered(id: string, dto: { ref?: string }, userId: string) {
    const req = await this.prisma.documentRequest.findUnique({ where: { id } });
    if (!req) throw new NotFoundException('서류 요청을 찾을 수 없습니다.');
    if (!req.issuedDocumentId || (req.status !== 'READY' && req.status !== 'DELIVERED'))
      throw new BadRequestException({ code: 'NOT_READY', message: '발급 완료(READY) 상태에서만 수령 처리할 수 있습니다.' });
    if (req.status === 'DELIVERED') return { ok: true, alreadyDelivered: true };
    // 우편/팩스는 송장/수신번호(ref) 필수 — 추적성 확보
    if ((req.deliveryMethod === 'MAIL' || req.deliveryMethod === 'FAX') && !dto.ref?.trim())
      throw new BadRequestException({ code: 'REF_REQUIRED', message: `${req.deliveryMethod === 'MAIL' ? '우편 송장번호' : '팩스 수신번호'}를 입력하세요.` });
    await this.prisma.documentRequest.update({
      where: { id },
      data: { status: 'DELIVERED', deliveredAt: new Date(), deliveredBy: userId, deliveryRef: dto.ref?.slice(0, 120) ?? null },
    });
    await this.audit.safeLog({ userId, action: AuditAction.UPDATE, resourceType: 'DocumentRequest', resourceId: id,
      changes: { status: { old: req.status, new: 'DELIVERED' }, deliveryMethod: { old: null, new: req.deliveryMethod } } });
    this.events.emit('document.delivered', { requestId: id, patientId: req.patientId, method: req.deliveryMethod });
    return { ok: true };
  }

  // ═══════════════ P3-3 발급 리포트 ═══════════════

  /** 기간별 발급 통계 — 타입/상태/수령방법 집계 + 수수료 합계 + 평균 처리시간 + SLA 위반 */
  async report(filter: { from?: string; to?: string }) {
    const from = filter.from ? new Date(filter.from) : null;
    const to = filter.to ? new Date(filter.to) : null;
    const createdWhere = (from || to) ? { createdAt: this.range(from, to) } : {};
    const issuedWhere: any = { issuedDocumentId: { not: null } };
    if (from || to) issuedWhere.completedAt = this.range(from, to);

    const [byStatus, byType, issuedRows, issuedTotal] = await Promise.all([
      this.prisma.documentRequest.groupBy({ by: ['status'], where: createdWhere, _count: { id: true } }),
      this.prisma.documentRequest.groupBy({ by: ['type'], where: issuedWhere, _count: { id: true }, _sum: { fee: true } }),
      this.prisma.documentRequest.findMany({ where: issuedWhere, select: { deliveryMethod: true, status: true, createdAt: true, completedAt: true, slaDueAt: true, fee: true }, take: REPORT_CAP }),
      this.prisma.documentRequest.count({ where: issuedWhere }),
    ]);

    const byDelivery: Record<string, number> = {};
    let procSum = 0, procCount = 0, slaBreaches = 0, feeSum = 0, delivered = 0;
    for (const r of issuedRows) {
      byDelivery[r.deliveryMethod] = (byDelivery[r.deliveryMethod] ?? 0) + 1;
      feeSum += r.fee ?? 0;
      if (r.status === 'DELIVERED') delivered++;
      if (r.completedAt) { procSum += r.completedAt.getTime() - r.createdAt.getTime(); procCount++; if (r.slaDueAt && r.completedAt > r.slaDueAt) slaBreaches++; }
    }
    return {
      period: { from, to },
      totals: { requested: byStatus.reduce((n, s) => n + s._count.id, 0), issued: issuedRows.length, delivered, feeSum, rejected: byStatus.find((s) => s.status === 'REJECTED')?._count.id ?? 0 },
      byStatus: Object.fromEntries(byStatus.map((s) => [s.status, s._count.id])),
      byType: byType.map((t) => ({ type: t.type, count: t._count.id, feeSum: t._sum.fee ?? 0 })),
      byDelivery,
      processing: { avgHours: procCount ? Math.round((procSum / procCount) / 3600000 * 10) / 10 : null, slaBreaches, measured: procCount },
      // 🔴 (2026-10-10) 처리 시간·수령 방법·수수료 합은 발급 건 상한(REPORT_CAP)까지만 센다 — 넘으면 말한다
      sample: { counted: issuedRows.length, total: issuedTotal, truncated: issuedTotal > issuedRows.length },
    };
  }

  // ─────────────────────────── 환자 다운로드(본인검증 → PDF)
  async patientDownloadIssueNo(patientId: string, id: string): Promise<string> {
    const req = await this.prisma.documentRequest.findFirst({ where: { id, patientId } });
    if (!req) throw new NotFoundException('서류 신청을 찾을 수 없습니다.');
    if (req.status !== 'READY' && req.status !== 'DELIVERED') throw new BadRequestException({ code: 'NOT_READY', message: '아직 발급 완료되지 않았습니다.' });
    if (!req.issuedDocumentId) throw new BadRequestException({ code: 'NO_DOCUMENT', message: '발급 문서가 없습니다.' });
    // 본인 발급 문서인지 교차검증
    const doc = await this.prisma.issuedDocument.findUnique({ where: { issueNo: req.issuedDocumentId }, select: { patientId: true } });
    if (doc?.patientId && doc.patientId !== patientId) throw new ForbiddenException('본인 문서가 아닙니다.');
    // 🔴 (2026-10-10) 종전엔 수령 방법과 무관하게 내려받기만 하면 DELIVERED(수령 시각 없이)로 바꿨다 —
    //    우편·팩스 신청은 송장·수신번호 없이 '수령 완료'가 되고, 방문 수령 대상은 창구에 오기 전에 '수령 완료'로 보였다.
    //    포털 수령(PORTAL)일 때만 내려받기가 곧 수령이다(시각 함께). 그 밖은 창구가 수령 처리한다.
    if (req.status === 'READY' && req.deliveryMethod === 'PORTAL') {
      await this.prisma.documentRequest.update({ where: { id }, data: { status: 'DELIVERED', deliveredAt: new Date() } });
      this.events.emit('document.delivered', { requestId: id, patientId, method: 'PORTAL' });
    }
    return req.issuedDocumentId;
  }
}
