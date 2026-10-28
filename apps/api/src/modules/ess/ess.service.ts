import { Injectable, Logger, NotFoundException, BadRequestException, Inject, forwardRef } from '@nestjs/common';
import { DocTypeRegistry } from './approval-registry';
import { randomBytes, randomUUID, createCipheriv, createDecipheriv, createHmac } from 'crypto';
import { writeFileSync, readFileSync, existsSync, mkdirSync, unlinkSync } from 'fs';
import { join, extname } from 'path';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { IntegrationOutboxService } from '../integration/integration-outbox.service';
import { ConfigService } from '@nestjs/config';
import { ConfigRuntimeService } from '../config/config-runtime.service';
import { getKeyCustody } from '../../common/crypto/key-custody';
import { IssuanceService } from '../medical-record-issuance/issuance.service';
import { ConsentService } from '../consent/consent.service';
import { PreAuthService } from '../pre-auth/pre-auth.service';
import { ModuleRef } from '@nestjs/core';
import type { DutyScheduleService } from '../duty-schedule/duty-schedule.service';
import { publicBaseUrl } from '../../common/util/public-url';
import { dayRange } from '../../common/day-range';
import { HisModeService } from '../../common/his-mode/his-mode.service';
import { allowsOutboundSend, type HisMode, type ErpReadFailure, type ErpReadUnavailable } from '@hospital-run/shared';

/** 의사 서명이 필요한 동의서 유형 — 정본은 common/consent-types(개정 표면=config consent.doctorSignRequiredTypes·§7 P2) */
import { DOCTOR_SIGN_REQUIRED_CONSENT_TYPES } from '../../common/consent-types';
import { nonEmptyStringArrayOr } from '../../common/qi-targets';

/** B그룹 증명서 유형(의사 작성·서명) — CLINICAL_CERTIFICATE 대상. 그 외 = A그룹 사본(발급 승인) */
const CERTIFICATE_TYPES = ['DIAGNOSIS_CERT', 'OPINION', 'ADMISSION_CERT'];

const STAFF_DOC_DIR = join(process.cwd(), 'uploads', 'staff');
const DOC_MIME: Record<string, string> = { '.pdf': 'application/pdf', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.heic': 'image/heic' };

/** 연차 잔여의 출처 — 같은 사실에 정본이 둘이라 '어느 쪽인지'를 값과 함께 실어보낸다(P12) */
export type LeaveBalanceSourceName = 'ERP' | 'HIS_LEDGER';
export const LEAVE_BALANCE_SOURCE_KO: Record<LeaveBalanceSourceName, string> = {
  ERP: '급여시스템(ERP)',
  HIS_LEDGER: 'HIS 연차원장',
};
export interface LeaveBalanceSourceRow { source: LeaveBalanceSourceName; type: string; granted: number; used: number; remaining: number }
export interface LeaveBalanceItem {
  type: string;
  /** 표시 정본의 출처 */
  source: LeaveBalanceSourceName;
  granted: number; used: number; remaining: number;
  /** 표시 정본이 아닌 나머지 출처(지우지 않고 그대로 노출) */
  alternates: LeaveBalanceSourceRow[];
  /** 출처 간 잔여가 다른가 */
  discrepancy: boolean;
  /** 휴가 초과검증이 실제로 쓰는 잔여(가용 출처 중 최솟값·fail-closed). null = 부여정보 없음 */
  enforceRemaining: number | null;
  enforceSource: LeaveBalanceSourceName | null;
  /** ANNUAL 한정 — 승인된 연차성 신청 일수 합계(원장 used 와 교차확인용, 집행 기준 아님) */
  approvedRequestDays?: number;
}

/**
 * 🔴 **물어보지 못한 출처**. 비어 있으면 모든 출처를 실제로 조회했다는 뜻이다.
 *    ERP 조회가 실패하면 화면은 HIS 원장 하나만 보고도 "출처가 하나뿐"이라 읽어 `discrepancy:false` 를
 *    '두 출처가 일치한다'로 오해한다 — 못 물어봤다는 사실을 항목이 아니라 **응답 meta** 로 싣는다
 *    (항목에 실으면 HIS 원장도 비어 있을 때 실패가 통째로 사라진다 — 빈 배열은 "정보 없음"으로 읽힌다).
 */
export interface LeaveBalanceUnavailableSource { source: LeaveBalanceSourceName; failure: ErpReadFailure; upstreamStatus: number | null }
export interface LeaveBalanceResult { items: LeaveBalanceItem[]; unavailableSources: LeaveBalanceUnavailableSource[] }

interface DependentInput { name?: string; relation?: string; birthDate?: string; isDependent?: boolean; deductionType?: string; note?: string }
interface PayrollIdentityInput { bankName?: string; bankAccount?: string; bankHolder?: string; residentId?: string }

@Injectable()
export class EssService {
  private readonly logger = new Logger(EssService.name);

  /** docType 레지스트리(P3-2) — 문서 타입별 확정 훅·기안자 해소를 선언적으로 등록 */
  private _registry?: DocTypeRegistry;
  private get approvalRegistry(): DocTypeRegistry {
    if (this._registry) return this._registry;
    const r = new DocTypeRegistry();
    r.register({
      docType: 'HR_LEAVE', refModule: 'hr.leave_requests', category: 'HR', updatesRelay: true,
      onDecision: (refId, decision, approverName, relayId) =>
        this.leaveCallback({ ref: { source_module: 'hr.leave_requests', source_ref: refId }, status: decision, approver: approverName, decidedAt: new Date().toISOString(), approvalId: `internal-${relayId}` }),
      resolveDrafter: async (refId) => (await this.prisma.leaveRequest.findUnique({ where: { id: refId }, select: { userId: true } }))?.userId,
    });
    r.register({
      docType: 'HR_LEAVE_CANCEL', refModule: 'hr.leave_requests', category: 'HR', updatesRelay: false,
      onDecision: async (refId, decision, approverName) => { if (decision === 'APPROVED') await this.applyLeaveCancel(refId, approverName); },
      resolveDrafter: async (refId) => (await this.prisma.leaveRequest.findUnique({ where: { id: refId }, select: { userId: true } }))?.userId,
    });
    r.register({
      docType: 'HR_ATTENDANCE_CORRECTION', refModule: 'hr.attendance_corrections', category: 'HR', updatesRelay: false,
      onDecision: (refId, decision, approverName) => this.applyCorrectionDecision(refId, decision, approverName),
      resolveDrafter: async (refId) => (await this.prisma.attendanceCorrectionRequest.findUnique({ where: { id: refId }, select: { userId: true } }))?.userId,
    });
    r.register({
      docType: 'HR_OVERTIME', refModule: 'hr.overtime_requests', category: 'HR', updatesRelay: false,
      onDecision: (refId, decision, approverName) => this.applyOvertimeDecision(refId, decision, approverName),
      resolveDrafter: async (refId) => (await this.prisma.overtimeRequest.findUnique({ where: { id: refId }, select: { userId: true } }))?.userId,
    });
    // 임상 기록지 전자결재(파일럿: 증명서 B그룹) — 간호·행정 기안 → 담당의 확약(승인=서명·발급, 반려=reject).
    // updatesRelay:false → decide가 relay.status 직접 종결(HR_OVERTIME 패턴). 확약 결과는 기안자(draftedBy)에게 통지.
    r.register({
      docType: 'CLINICAL_CERTIFICATE', refModule: 'medical_record_issuance.document_requests', category: 'CLINICAL_RECORD', updatesRelay: false,
      onDecision: (refId, decision, _approverName, _relayId, approverUserId, comment) => this.confirmCertificate(refId, decision, approverUserId, comment),
      resolveDrafter: async (refId) => (await this.prisma.documentRequest.findUnique({ where: { id: refId }, select: { draftedBy: true } }))?.draftedBy ?? undefined,
    });
    // 동의서 의사 확약(P1b) — 간호 기안(requestedBy) → 담당의 결재. 승인=doctorSign(§24-2)+finalize, 반려=revoke. 스키마 변경 0.
    r.register({
      docType: 'CONSENT_DOCTOR_SIGN', refModule: 'consent.consent_forms', category: 'CLINICAL_RECORD', updatesRelay: false,
      onDecision: (refId, decision, _approverName, _relayId, approverUserId, comment) => this.confirmConsent(refId, decision, approverUserId, comment),
      resolveDrafter: async (refId) => (await this.prisma.consentForm.findUnique({ where: { id: refId }, select: { requestedBy: true } }))?.requestedBy ?? undefined,
    });
    // 간호기록 의사 공동서명(P1) — 간호 기안(nurseId) → 담당의 co-sign. 승인=COSIGNED, 반려=REJECTED. 원 기록 불변(append-only).
    r.register({
      docType: 'CLINICAL_NOTE_COSIGN', refModule: 'nursing_note.nursing_notes', category: 'CLINICAL_RECORD', updatesRelay: false,
      onDecision: (refId, decision, _approverName, _relayId, approverUserId) => this.confirmNoteCosign(refId, decision, approverUserId),
      resolveDrafter: async (refId) => (await this.prisma.nursingNote.findUnique({ where: { id: refId }, select: { nurseId: true } }))?.nurseId ?? undefined,
    });
    // 의무기록 사본 발급 승인(P2·A그룹) — 행정 기안 → 담당의 발급 승인. 승인=issue(발급), 반려=reject. §21 대리 자격검증 선행.
    r.register({
      docType: 'MEDICAL_RECORD_COPY_APPROVAL', refModule: 'medical_record_issuance.document_requests', category: 'CLINICAL_RECORD', updatesRelay: false,
      onDecision: (refId, decision, _approverName, _relayId, approverUserId, comment) => this.confirmRecordCopy(refId, decision, approverUserId, comment),
      resolveDrafter: async (refId) => (await this.prisma.documentRequest.findUnique({ where: { id: refId }, select: { draftedBy: true } }))?.draftedBy ?? undefined,
    });
    // 사전승인(고위험 오더 발행 전 결재) — 단일 docType, 세부유형은 PreAuthRequest.type 분기. 승인=발행, 반려=REJECTED.
    r.register({
      docType: 'PRE_AUTH', refModule: 'preauth.pre_auth_requests', category: 'PRE_AUTH', updatesRelay: false,
      onDecision: (refId, decision, _approverName, _relayId, approverUserId, comment) => this.preAuth.confirmPreAuth(refId, decision, approverUserId, comment),
      resolveDrafter: async (refId) => (await this.prisma.preAuthRequest.findUnique({ where: { id: refId }, select: { requestedByUserId: true } }))?.requestedByUserId ?? undefined,
    });
    // 당직 교대(P2) — 상대 직원 승인 → 실제 교환(handleSwap). category=HR(인사·근태).
    r.register({
      docType: 'HR_DUTY_SWAP', refModule: 'duty.swap_requests', category: 'HR', updatesRelay: false,
      onDecision: (refId, decision) => this.confirmDutySwap(refId, decision),
      resolveDrafter: async (refId) => (await this.prisma.dutySwapRequest.findUnique({ where: { id: refId }, select: { requesterId: true } }))?.requesterId ?? undefined,
    });
    this._registry = r;
    return r;
  }
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: IntegrationOutboxService,
    private readonly config: ConfigService,
    private readonly configRuntime: ConfigRuntimeService,
    private readonly issuance: IssuanceService,
    private readonly consent: ConsentService,
    @Inject(forwardRef(() => PreAuthService)) private readonly preAuth: PreAuthService,
    private readonly moduleRef: ModuleRef,
    private readonly hisMode: HisModeService,
  ) {}

  /** 당직 교대 승인 시 실제 교환 — DutyScheduleService 런타임 lazy resolve(순환 방지) */
  private get dutySchedule(): DutyScheduleService {
    const { DutyScheduleService } = require('../duty-schedule/duty-schedule.service');
    return this.moduleRef.get(DutyScheduleService, { strict: false });
  }
  private async confirmDutySwap(refId: string, decision: 'APPROVED' | 'REJECTED') {
    return this.dutySchedule.handleSwap(refId, decision === 'APPROVED');
  }

  private async staffOf(userId: string) {
    return this.prisma.staff.findUnique({ where: { userId }, select: { id: true, employeeNumber: true, clinicUserId: true } });
  }

  /** ESS 대상 토큰(ERP #4) — JWT HS256 {sub: employeeNumber, purpose: 'ess-target', exp} · 건별 발급(폭발반경 최소).
   * ERP가 sub로 조회 대상을 검증 → 단일키 전 직원 열거 차단. 시크릿 없으면 미부착(ERP 관측모드 무중단). */
  private async issueTargetToken(employeeNumber: string): Promise<string | undefined> {
    const secret = (await this.configRuntime.get('ess.targetTokenSecret').catch(() => null)) as string | undefined
      || process.env.ESS_TARGET_TOKEN_SECRET;
    if (!secret || !employeeNumber) return undefined;
    const b64u = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const now = Math.floor(Date.now() / 1000);
    const head = b64u({ alg: 'HS256', typ: 'JWT' });
    const body = b64u({ sub: employeeNumber, purpose: 'ess-target', iat: now, exp: now + 60 }); // 60초 단명
    const sig = createHmac('sha256', secret).update(`${head}.${body}`).digest('base64url');
    return `${head}.${body}.${sig}`;
  }

  /**
   * ERP 읽기 API 공용 호출(급여명세·연차잔여·근무표·증명서 등). `erp.webhookUrl` 베이스 + 공유키 + 대상토큰(#4).
   *
   * 🔴 **실패 사유를 잃지 않는다**. 종전에는 미설정·403·5xx·네트워크 오류가
   *    전부 `null` 한 가지였다 — 화면이 "ERP 미연결"과 "인증 실패"를 구분할 수 없었고, 로그조차 없었다.
   *    어휘는 shared `ERP_READ_FAILURES`(NOT_CONFIGURED·UNAUTHORIZED·UPSTREAM_ERROR·UNREACHABLE·BAD_RESPONSE) 하나 —
   *    화면(`ErpFailureNote`)이 같은 어휘로 분기한다.
   * 🔴 2026-09-23 수렴: 종전 `erpGet`(사유를 버리고 `data|null` 만 주던 얇은 래퍼)은 **지웠다** —
   *    호출부 8곳이 그 `null` 을 `items: []`("0건")·`registered:false`("미등록") 같은 **사실 주장**으로 옮기고 있었다.
   *    사유를 버리는 경로가 남아 있으면 다음 호출부가 또 그 길로 간다.
   */
  private async erpGetDetailed(
    path: string,
    params: Record<string, string | undefined>,
    targetEmployeeNumber?: string,
  ): Promise<{ data: Record<string, unknown> | null; reason: 'OK' | ErpReadFailure; status: number | null }> {
    const base = (await this.configRuntime.get('erp.webhookUrl')) as string;
    const key = (await this.configRuntime.get('erp.integrationKey')) as string;
    if (!base) return { data: null, reason: 'NOT_CONFIGURED', status: null };
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => { if (v) qs.set(k, v); });
    const headers: Record<string, string> = { 'X-Integration-Key': key ?? '' };
    // 대상 토큰 — 명시 대상 또는 params.employeeNumber 기준(급여성 조회의 스코프 증명)
    const targetEmp = targetEmployeeNumber ?? params.employeeNumber;
    if (targetEmp) {
      const tt = await this.issueTargetToken(targetEmp);
      if (tt) headers['X-Target-Token'] = tt;
    }
    let res: globalThis.Response;
    try {
      res = await fetch(`${base.replace(/\/$/, '')}${path}?${qs.toString()}`, { headers, signal: AbortSignal.timeout(5000) });
    } catch (e) {
      this.logger.warn(`ERP 조회 실패 ${path} — 도달하지 못했다: ${(e as Error).message}`);
      return { data: null, reason: 'UNREACHABLE', status: null };
    }
    if (!res.ok) {
      const reason = res.status === 401 || res.status === 403 ? 'UNAUTHORIZED' : 'UPSTREAM_ERROR';
      this.logger.warn(`ERP 조회 실패 ${path} — status=${res.status} reason=${reason}`);
      return { data: null, reason, status: res.status };
    }
    // 🔴 200 인데 JSON 오브젝트가 아닌 것은 "닿지 못함"이 아니다 — 종전에는 json() 예외가 UNREACHABLE 로 새었다
    try {
      const data = (await res.json()) as unknown;
      if (!data || typeof data !== 'object' || Array.isArray(data)) {
        this.logger.warn(`ERP 조회 실패 ${path} — 응답이 JSON 오브젝트가 아니다(status=${res.status})`);
        return { data: null, reason: 'BAD_RESPONSE', status: res.status };
      }
      return { data: data as Record<string, unknown>, reason: 'OK', status: res.status };
    } catch (e) {
      this.logger.warn(`ERP 조회 실패 ${path} — 응답을 해석하지 못했다(status=${res.status}): ${(e as Error).message}`);
      return { data: null, reason: 'BAD_RESPONSE', status: res.status };
    }
  }

  /** 실패 사유를 응답 봉투로 — 굵은 `reason:'ERP_UNAVAILABLE'` 은 하위 호환, 화면 분기는 `failure` 를 읽는다 */
  private erpUnavailable(got: { reason: 'OK' | ErpReadFailure; status: number | null }): ErpReadUnavailable {
    return { available: false, reason: 'ERP_UNAVAILABLE', failure: got.reason === 'OK' ? 'BAD_RESPONSE' : got.reason, upstreamStatus: got.status };
  }

  // R-1 HMAC 시크릿 해석 — ERP 합의: 기존 인바운드 웹훅 시크릿(양측 보유) 재사용. 전용 키 원하면 erp.payrollHmacKey로 오버라이드.
  private async resolvePayrollHmacKey(): Promise<string | undefined> {
    return ((await this.configRuntime.get('erp.payrollHmacKey')) as string | undefined)
      || process.env.INBOUND_WEBHOOK_SECRET
      || ((await this.configRuntime.get('integration.inboundWebhookSecret')) as string | undefined);
  }

  /** ERP 보안 쓰기(R-1) — X-Integration-Key + HMAC 서명. 스킴: X-Signature: sha256=HMAC(`${ts}.${rawBody}`)·X-Timestamp(신선도).
   *
   * 🔴 **리얼 모드가 아니면 나가지 않는다**(2026-09-21 · 형제 프로젝트 인바운드 §3). 운영 모드 게이트
   *    (`allowsOutboundSend` — 정본 shared `his-mode.ts`)는 아웃박스·문자·메일에만 걸려 있었고, ESS→ERP 쓰기는
   *    아웃박스를 거치지 않아 **리허설 설치본의 시험 입력(주민등록번호·계좌번호)이 실 ERP 로 나가던 유일한 예외 경로**였다.
   *    운영 모드 배너가 "대외 발신은 나가지 않습니다"라고 약속하는데(`HIS_MODE_META`) 이 한 경로만 예외였다.
   *    보류는 **실패가 아니다** — `heldByMode` 로 구분해 올려, 호출부가 "실패했습니다"라고 말하지 않게 한다
   *    (§전송을 흉내내지 않는다 · 보내지 않은 것에 전송 시각을 남기지 않는다).
   *    🔴 조회(GET `erpGetDetailed`)는 여기서 막지 않는다 — 성격이 다르다(읽기는 밖으로 무엇도 싣지 않는다).
   */
  private async erpPost(path: string, body: Record<string, unknown>): Promise<{ ok: boolean; status: number; data: unknown; heldByMode?: HisMode }> {
    const mode = await this.hisMode.effective();
    if (!allowsOutboundSend(mode)) {
      this.logger.log(`ESS→ERP 쓰기 보류 — ${mode} 모드에서는 외부로 보내지 않는다 (${path})`);
      return { ok: false, status: 0, data: null, heldByMode: mode };
    }
    const base = (await this.configRuntime.get('erp.webhookUrl')) as string;
    const key = (await this.configRuntime.get('erp.integrationKey')) as string;
    const hmacKey = await this.resolvePayrollHmacKey();
    if (!base) return { ok: false, status: 0, data: null };
    const raw = JSON.stringify(body);
    const headers: Record<string, string> = { 'Content-Type': 'application/json', 'X-Integration-Key': key ?? '' };
    if (hmacKey) {
      // outbox→ERP와 동일 스킴: ts=초·X-Nonce(재생방지)·X-Signature=raw hex(sha256= 접두 없음).
      const ts = Math.floor(Date.now() / 1000).toString();
      headers['X-Timestamp'] = ts;
      headers['X-Nonce'] = randomBytes(16).toString('hex');
      headers['X-Signature'] = createHmac('sha256', hmacKey).update(`${ts}.${raw}`).digest('hex');
    }
    try {
      const res = await fetch(`${base.replace(/\/$/, '')}${path}`, { method: 'POST', headers, body: raw, signal: AbortSignal.timeout(6000) });
      const data = await res.json().catch(() => null);
      return { ok: res.ok, status: res.status, data };
    } catch {
      return { ok: false, status: 0, data: null };
    }
  }

  /** 급여명세(ERP 제공, W3.1 요청2) — 확정분만(issued).
   *  🔴 세 가지 서로 다른 사실을 구분해 실어보낸다(P1): ERP 장애(available=false) ·
   *  해당 월 자료 없음(available=true·payslip 없음) · **미발행**(payslip.issued=false).
   *  구 응답은 미발행도 payslip 객체를 그대로 주었고 화면이 이를 확정분으로 렌더해 "실수령액 0원"이라 단언했다.
   *  또 ERP 가 다른 기간을 반환해도 알 길이 없었으므로 요청 기간을 함께 반환해 대조 가능하게 한다. */
  async getPayslip(userId: string, period?: string) {
    const staff = await this.staffOf(userId);
    if (!staff) throw new BadRequestException('직원(Staff) 정보가 없습니다.');
    const p = period ?? new Date().toISOString().slice(0, 7).replace('-', '');
    const got = await this.erpGetDetailed('/api/v1/integration/hr/payslip', { employeeNumber: staff.employeeNumber, period: p });
    const data = got.data;
    // 🔴 "연결되지 않았다"와 "인증이 거부됐다"는 다른 사실이다 — 화면이 무엇을 확인해야 하는지 달라진다
    if (!data) return { ...this.erpUnavailable(got), requestedPeriod: p };
    const issued = (data as { issued?: boolean }).issued === true;
    const returnedPeriod = (data as { period?: string }).period;
    return {
      available: true,
      requestedPeriod: p,
      issued,
      // ERP 가 요청과 다른 기간을 반환한 경우 — 화면이 요청 기간으로 라벨링하면 남의 달 명세가 된다
      periodMismatch: !!returnedPeriod && returnedPeriod !== p,
      payslip: data,
    };
  }

  private audit(userId: string, action: 'CREATE' | 'READ' | 'UPDATE' | 'DELETE', resourceType: string, resourceId: string, changes?: object) {
    void this.prisma.auditLog.create({ data: { userId, action, resourceType, resourceId, changes: (changes ?? undefined) as never } }).catch(() => undefined);
  }

  // ── 근태(타임클럭) ──
  /** 🔴 P16(하지 않은 인증을 했다고 적음) — 근태는 법정 기록이고 이력이 본인 화면에 그대로 되비친다.
   *  구 코드: clock()의 기본값이 'BIO'이고 ESS 화면이 body 로 method:'BIO' 를 하드코딩해 보냈다.
   *  화면에는 생체 절차가 전혀 없다(운영 실측 method 분포: AUTO 9·PIN 8·MANUAL 1·**BIO 0**
   *  = 그 버튼을 누르는 순간부터 하지 않은 생체인증이 기록될 참이었다).
   *  정리: 클라이언트가 body 로 선언한 수단은 증거가 아니다 → 서버가 확인할 수 있는 것만 남기고
   *  나머지는 실제로 일어난 일(WEB=본인 로그인 세션에서 화면 버튼)로 기록한다.
   *  BIO/PIN/AUTO/MANUAL 은 서버 내부 경로 전용(생체 스텝업·단말 PIN·자동마감·결재 정정). */
  private static readonly CLIENT_DECLARABLE_CLOCK_METHODS = ['WEB', 'QR'] as const;
  /** HTTP body 로 들어온 인증수단 정규화 — 서버가 검증할 수 없는 선언은 채택하지 않는다(무시·경고). */
  private normalizeClientClockMethod(method?: string): string {
    if (!method) return 'WEB';
    if ((EssService.CLIENT_DECLARABLE_CLOCK_METHODS as readonly string[]).includes(method)) return method;
    this.logger.warn(`근태 인증수단 '${method}' 는 서버가 확인할 수 없어 'WEB' 으로 기록합니다(클라이언트 선언 불신)`);
    return 'WEB';
  }

  /** 화면(HTTP)에서 들어오는 출퇴근 — method 는 클라이언트 선언이라 신뢰하지 않는다. */
  async clockFromClient(userId: string, type: string, method?: string, lat?: number, lng?: number) {
    return this.clock(userId, type, this.normalizeClientClockMethod(method), lat, lng);
  }

  /** 서버 내부 경로 전용(단말 PIN·자동마감 등) — 호출자가 실제 수행한 인증을 책임지고 적는다. */
  async clock(userId: string, type: string, method = 'WEB', lat?: number, lng?: number) {
    const staff = await this.staffOf(userId);
    /**
     * 🔴 (2026-09-16 J4) 아웃박스는 **분 단위 멱등키**(`att:<사번>:<분>:<type>`)로 한 벌만 내보내는데
     *    DB 행에는 같은 규칙이 없었다 — 출근 버튼을 두 번 누르면 HIS 에는 근태가 2행, ERP 에는 1건이
     *    남아 **근무시간(급여 근거)이 HIS 와 ERP 에서 갈라진다**. 같은 자연키를 행에도 적용한다.
     *    같은 사람이 같은 종류를 같은 분에 두 번 찍는 일은 실제로 없다(중복 탭이다).
     */
    const minuteStart = new Date();
    minuteStart.setSeconds(0, 0);
    const sameMinute = await this.prisma.attendanceRecord.findFirst({
      where: { userId, type, at: { gte: minuteStart, lt: new Date(minuteStart.getTime() + 60_000) } },
      orderBy: { at: 'asc' },
    });
    if (sameMinute) return sameMinute;
    const rec = await this.prisma.attendanceRecord.create({
      data: { userId, clinicUserId: staff?.clinicUserId ?? null, type, method, lat: lat ?? null, lng: lng ?? null },
    });
    // W3 staff.attendance_recorded (§9.1) — 멱등키 att:{사번}:{분}:{type}
    if (staff?.employeeNumber) {
      const minute = rec.at.toISOString().slice(0, 16).replace(/[-:T]/g, '');
      void this.outbox.enqueue('hr', 'staff.attendance_recorded', `att:${staff.employeeNumber}:${minute}:${type}`, {
        employeeNumber: staff.employeeNumber, clinicUserId: staff.clinicUserId, at: rec.at, type, method,
      });
    }
    this.audit(userId, 'CREATE', 'ATTENDANCE', rec.id, { type, method });
    return rec;
  }

  /** 출근 멱등 — 오늘 CLOCK_IN 이 이미 있으면 재기록하지 않음(로그인/PIN 재발급 시 중복 출근 방지). */
  async clockInOnceDaily(userId: string, method = 'PIN') {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const existing = await this.prisma.attendanceRecord.findFirst({
      where: { userId, type: 'CLOCK_IN', at: { gte: start } },
      orderBy: { at: 'asc' },
    });
    if (existing) return existing; // 오늘 이미 출근
    return this.clock(userId, 'CLOCK_IN', method);
  }

  async attendance(userId: string, from?: string, to?: string) {
    const where: Record<string, unknown> = { userId };
    if (from || to) where.at = { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(to) } : {}) };
    return this.prisma.attendanceRecord.findMany({ where, orderBy: { at: 'desc' }, take: 100 });
  }

  // ── 휴가 ── (신청 → EApprovalRelay(HR_LEAVE) → Clinic/ERP, 콜백으로 확정 §9.6.2)
  /** 영업일 계산 — 주말·HolidayCalendar(isHoliday) 제외 (P0 서버 단일 계산) */
  private async businessDays(from: Date, to: Date): Promise<number> {
    const holidays = await this.prisma.holidayCalendar.findMany({
      where: { date: { gte: from, lte: to }, isHoliday: true },
      select: { date: true },
    });
    const holidaySet = new Set(holidays.map((h) => h.date.toISOString().slice(0, 10)));
    let days = 0;
    for (let t = from.getTime(); t <= to.getTime(); t += 86400_000) {
      const d = new Date(t);
      const dow = d.getUTCDay();
      if (dow === 0 || dow === 6) continue;
      if (holidaySet.has(d.toISOString().slice(0, 10))) continue;
      days++;
    }
    return days;
  }

  private async notifyUser(userId: string, type: string, title: string, message: string, refId?: string) {
    await this.prisma.notification
      .create({ data: { userId, type, title, message, severity: 'INFO', refType: 'LEAVE', refId } })
      .catch(() => undefined);
  }

  async requestLeave(userId: string, dto: { type: string; fromDate: string; toDate: string; days: number; reason?: string; attachmentDocId?: string }) {
    const staff = await this.staffOf(userId);

    // ── P0 서버 검증: 날짜·겹침·영업일 일수·잔여 (클라이언트 days는 참고치) ──
    const from = new Date(dto.fromDate);
    const to = new Date(dto.toDate);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from > to)
      throw new BadRequestException('휴가 기간이 올바르지 않습니다(시작일 ≤ 종료일)');
    // 🔴 HALF는 반드시 당일(적대 리뷰): 구 코드는 HALF를 기간 무관 0.5일 차감 → 장기 기간 신청으로
    // 0.5일만 차감하고 근무표 OFF·겹침 차단을 장기 점유하는 우회가 가능했음
    if (dto.type === 'HALF' && from.getTime() !== to.getTime())
      throw new BadRequestException('반차는 하루만 신청할 수 있습니다(시작일=종료일)');
    const overlap = await this.prisma.leaveRequest.findFirst({
      where: { userId, status: { in: ['REQUESTED', 'APPROVED'] }, fromDate: { lte: to }, toDate: { gte: from } },
      select: { id: true, fromDate: true, toDate: true },
    });
    if (overlap)
      throw new BadRequestException(`동일 기간에 진행 중/승인된 휴가가 있습니다 (${overlap.fromDate.toISOString().slice(0, 10)}~${overlap.toDate.toISOString().slice(0, 10)})`);
    const computedDays = dto.type === 'HALF' ? 0.5 : await this.businessDays(from, to);
    if (computedDays <= 0) throw new BadRequestException('기간 내 영업일이 없습니다(주말·공휴일만 포함)');
    let balanceWarning: string | undefined;
    if (['ANNUAL', 'HALF'].includes(dto.type)) {
      try {
        // 🔴 초과검증은 표시 정본(ERP)이 아니라 **가용 출처 중 최소 잔여**를 기준으로 한다(fail-closed).
        //   구 코드는 ERP remaining(17)만 봤고 HIS 원장(12)은 조회조차 안 해서 13~17일 신청이 통과했다.
        //   enforceRemaining=null 은 '부여 정보 미등록'(진짜 잔여 0과 다름) → 차단 아닌 경고.
        const balances = await this.leaveBalance(userId);
        const annual = balances.find((b) => b.type === 'ANNUAL');
        if (annual?.enforceRemaining != null && computedDays > annual.enforceRemaining)
          throw new BadRequestException(
            `연차 잔여(${annual.enforceRemaining}일 · ${LEAVE_BALANCE_SOURCE_KO[annual.enforceSource!]} 기준)를 초과합니다(신청 ${computedDays}일)`,
          );
        if (!annual || annual.enforceRemaining == null) {
          balanceWarning = '연차 부여 정보가 없어 잔여 검증 없이 진행합니다(인사 데이터 확인 필요)';
        } else if (annual.discrepancy) {
          const all = [{ source: annual.source, remaining: annual.remaining }, ...annual.alternates]
            .map((s) => `${LEAVE_BALANCE_SOURCE_KO[s.source]} ${s.remaining}일`).join(' / ');
          balanceWarning = `연차 잔여가 출처마다 다릅니다(${all}) — 더 적은 ${annual.enforceRemaining}일 기준으로 검증했습니다. 인사팀 확인이 필요합니다`;
        }
      } catch (e) {
        if (e instanceof BadRequestException) throw e;
        balanceWarning = '연차 잔여 조회 실패 — 잔여 검증 없이 진행합니다';
      }
    }

    // 증빙 첨부(P2-1) — 병가/경조 등. 본인 StaffDocument만 연결(민감·열람은 본인+결재선 한정)
    if (dto.attachmentDocId) {
      const myStaff = await this.prisma.staff.findUnique({ where: { userId }, select: { id: true } });
      const doc = await this.prisma.staffDocument.findUnique({ where: { id: dto.attachmentDocId }, select: { staffId: true } });
      if (!doc || doc.staffId !== myStaff?.id) throw new BadRequestException('증빙 서류를 찾을 수 없습니다(본인 서류만 첨부 가능)');
    }
    // 결재 릴레이 레코드 생성(PENDING). 실제 Clinic 상신(erp-eapproval/submit)은 연동 시점에 수행(Clinic C-3).
    //
    // 🔴 (2026-09-16 J1) 종전엔 신청·릴레이·연결이 각각 커밋됐다. 신청만 커밋되고 릴레이가 실패하면
    //    **승인할 결재가 없는 신청**이 REQUESTED 로 남는데, 위 겹침 검사(REQUESTED·APPROVED)가
    //    **같은 기간 재신청을 막는다** — 그 기간의 휴가를 영영 올릴 수 없다. 세 쓰기를 한 트랜잭션에.
    const callbackUrl = `${publicBaseUrl()}/api/v1/ess/leave/eapproval-callback`;
    const { lr, relay } = await this.prisma.$transaction(async (tx) => {
      const created = await tx.leaveRequest.create({
        data: { userId, type: dto.type, fromDate: from, toDate: to, days: computedDays, reason: dto.reason ?? null, attachmentDocId: dto.attachmentDocId ?? null },
      });
      const rel = await tx.eApprovalRelay.create({
        data: {
          docType: 'HR_LEAVE', title: `${dto.type} 신청 (${dto.fromDate}~${dto.toDate})`,
          refModule: 'hr.leave_requests', refId: created.id, drafterClinicUserId: staff?.clinicUserId ?? null, callbackUrl,
        },
      });
      const linked = await tx.leaveRequest.update({ where: { id: created.id }, data: { eApprovalRef: rel.refId } });
      return { lr: linked, relay: rel };
    });
    this.audit(userId, 'CREATE', 'LEAVE_REQUEST', lr.id, { type: dto.type, days: dto.days, from: dto.fromDate, to: dto.toDate });

    const mode = (await this.configRuntime.get('ess.leaveApprovalMode')) ?? 'SIMULATION';

    // INTERNAL — HIS 내부 결재(부서장 수신함). 결재선 = 보고라인 1단계 (P0)
    if (mode === 'INTERNAL') {
      const internal = await this.attachInternalLine(relay.id, userId, '휴가 결재 요청', `${dto.type} 신청 (${dto.fromDate}~${dto.toDate}, ${computedDays}일)`, lr.id);
      return { ...lr, eApprovalRef: relay.refId, mode: 'INTERNAL', approver: internal.approverName, ...(balanceWarning ? { warning: balanceWarning } : {}) };
    }

    // Clinic W.Sign — SIMULATION 모드면 결재 콜백 자동 처리(데모 E2E). 실연동 시 CLINIC으로 전환.
    if (mode === 'SIMULATION') {
      const maxDays = Number((await this.configRuntime.get('ess.leaveSimulationMaxDays')) ?? 5);
      const decision = computedDays <= maxDays ? 'APPROVED' : 'REJECTED'; // 서버 계산값 기준(클라 days 불신)
      await this.leaveCallback({
        ref: { source_module: 'hr.leave_requests', source_ref: lr.id },
        status: decision, approver: 'SIMULATION', approvalId: `sim-${relay.refId}`, decidedAt: new Date().toISOString(),
      }).catch(() => undefined);
      return { ...lr, eApprovalRef: relay.refId, status: decision, simulated: true, ...(balanceWarning ? { warning: balanceWarning } : {}) };
    }
    return { ...lr, eApprovalRef: relay.refId, ...(balanceWarning ? { warning: balanceWarning } : {}) };
  }

  /** INTERNAL 결재선 부여 — 보고라인 1단계(휴직 승계)·결재자 알림 (P0·P1 공용) */
  private async attachInternalLine(relayId: string, drafterUserId: string, notiTitle: string, notiBody: string, refId: string) {
    const me = await this.prisma.staff.findUnique({
      where: { userId: drafterUserId },
      select: { id: true, familyName: true, givenName: true, manager: { select: { id: true, userId: true, familyName: true, givenName: true, status: true, manager: { select: { id: true, userId: true, familyName: true, givenName: true } } } } },
    });
    const approver = me?.manager && me.manager.status !== 'ON_LEAVE' ? me.manager : me?.manager?.manager ?? null;
    if (!approver?.userId) throw new BadRequestException('결재자(보고라인)가 지정되어 있지 않습니다 — 관리자에게 보고라인 등록을 요청하세요');
    await this.prisma.eApprovalRelay.update({
      where: { id: relayId },
      data: { approvalLine: [{ order: 1, staffId: approver.id, userId: approver.userId, role: 'APPROVE' }] as object },
    });
    await this.notifyUser(approver.userId, 'HR_APPROVAL', notiTitle, `${me?.familyName ?? ''}${me?.givenName ?? ''}님 — ${notiBody}`, refId);
    return { approverName: `${approver.familyName}${approver.givenName}` };
  }

  // ── 근태 정정 (P1-1) ──

  async requestAttendanceCorrection(userId: string, dto: { targetRecordId?: string; workDate: string; correctedType: string; correctedAt: string; reason: string }) {
    if (!dto.reason?.trim()) throw new BadRequestException('정정 사유는 필수입니다');
    const correctedAt = new Date(dto.correctedAt);
    if (Number.isNaN(correctedAt.getTime())) throw new BadRequestException('정정 시각이 올바르지 않습니다');
    if (correctedAt > new Date()) throw new BadRequestException('미래 시각으로 정정할 수 없습니다');
    if (dto.targetRecordId) {
      const target = await this.prisma.attendanceRecord.findUnique({ where: { id: dto.targetRecordId } });
      if (!target || target.userId !== userId) throw new BadRequestException('정정 대상 근태 기록을 찾을 수 없습니다');
      if (target.autoClosedAt && dto.reason.trim().length < 10)
        throw new BadRequestException('자동마감(미퇴근) 기록의 정정은 소명 사유를 10자 이상 기재해야 합니다');
    }
    const dup = await this.prisma.attendanceCorrectionRequest.findFirst({
      where: { userId, workDate: new Date(dto.workDate), correctedType: dto.correctedType, status: 'REQUESTED' },
    });
    if (dup) throw new BadRequestException('동일 일자·유형의 정정 신청이 진행 중입니다');

    // 🔴 (2026-09-16 J1) requestLeave 와 같은 가족. 신청만 커밋되고 릴레이가 실패하면 **결재 없는 정정 신청**이
    //    REQUESTED 로 남고, 위 중복 검사(동일 일자·유형 REQUESTED)가 **재신청을 막는다** — 그 날의 근태를
    //    영영 정정할 수 없다(HR 법정 기록). 세 쓰기를 한 트랜잭션에.
    const { acr, relay } = await this.prisma.$transaction(async (tx) => {
      const created = await tx.attendanceCorrectionRequest.create({
        data: {
          userId, targetRecordId: dto.targetRecordId ?? null, workDate: new Date(dto.workDate),
          correctedType: dto.correctedType, correctedAt, reason: dto.reason,
        },
      });
      const rel = await tx.eApprovalRelay.create({
        data: {
          docType: 'HR_ATTENDANCE_CORRECTION',
          title: `근태 정정 (${dto.workDate} ${dto.correctedType === 'CLOCK_IN' ? '출근' : '퇴근'})`,
          refModule: 'hr.attendance_corrections', refId: created.id,
          callbackUrl: `${publicBaseUrl()}/api/v1/ess/leave/eapproval-callback`,
        },
      });
      const linked = await tx.attendanceCorrectionRequest.update({ where: { id: created.id }, data: { eApprovalRef: rel.refId } });
      return { acr: linked, relay: rel };
    });
    this.audit(userId, 'CREATE', 'ATTENDANCE_CORRECTION', acr.id, { workDate: dto.workDate, correctedType: dto.correctedType });

    const mode = (await this.configRuntime.get('ess.leaveApprovalMode')) ?? 'SIMULATION';
    if (mode === 'INTERNAL') {
      const internal = await this.attachInternalLine(relay.id, userId, '근태 정정 결재 요청', `근태 정정 (${dto.workDate}, 사유: ${dto.reason.slice(0, 40)})`, acr.id);
      return { ...acr, mode: 'INTERNAL', approver: internal.approverName };
    }
    if (mode === 'SIMULATION') {
      await this.applyCorrectionDecision(acr.id, 'APPROVED', 'SIMULATION');
      return { ...acr, status: 'APPROVED', simulated: true };
    }
    return acr;
  }

  /** 정정 결재 확정 — 승인 시 원본 불변·correctionOf 신규 레코드 (멱등) */
  private async applyCorrectionDecision(acrId: string, status: 'APPROVED' | 'REJECTED', approver?: string) {
    const acr = await this.prisma.attendanceCorrectionRequest.findUnique({ where: { id: acrId } });
    if (!acr) throw new NotFoundException('정정 신청을 찾을 수 없습니다');
    if (['APPROVED', 'REJECTED', 'WITHDRAWN'].includes(acr.status)) return { idempotent: true, applied: acr.status };
    // 조건부 claim + 원자 트랜잭션 — 동시 콜백 이중 정정 레코드 생성·상태만 종결 후 레코드 유실 방지
    //
    // 🔴 (2026-09-16 I2) 이 주석은 **원자 트랜잭션을 약속하고 있었는데 코드에는 트랜잭션이 없었다.**
    //    claim(상태 APPROVED)이 먼저 커밋되고 근태 기록 생성이 따로 나가, 중간에 실패하면
    //    "정정은 승인됐는데 근태 기록은 없다"가 남는다. 재시도하면 위 멱등 분기(APPROVED)가
    //    먼저 걸려 **그 기록은 영원히 만들어지지 않는다**(상태 검사가 재시도를 막는 영구 잠김).
    const claimed = await this.prisma.$transaction(async (tx) => {
      const c = await tx.attendanceCorrectionRequest.updateMany({
        where: { id: acrId, status: 'REQUESTED' },
        data: { status, decidedAt: new Date() },
      });
      if (c.count === 0) return c;
      if (status === 'APPROVED') {
        await tx.attendanceRecord.create({
          data: {
            userId: acr.userId, type: acr.correctedType, method: 'MANUAL', at: acr.correctedAt,
            correctionOf: acr.targetRecordId,
          },
        });
      }
      return c;
    });
    if (claimed.count === 0) return { idempotent: true, applied: status };
    this.audit(acr.userId, 'UPDATE', 'ATTENDANCE_CORRECTION', acrId, { status, approver });
    return { applied: status };
  }

  async listAttendanceCorrections(userId: string) {
    return this.prisma.attendanceCorrectionRequest.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 50 });
  }

  // ── 초과근무 (P1-2) ──

  async requestOvertime(userId: string, dto: { workDate: string; otType: string; startAt: string; endAt: string; reason: string }) {
    if (!dto.reason?.trim()) throw new BadRequestException('초과근무 사유는 필수입니다');
    const startAt = new Date(dto.startAt);
    const endAt = new Date(dto.endAt);
    if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime()) || startAt >= endAt)
      throw new BadRequestException('초과근무 시간이 올바르지 않습니다(시작 < 종료)');
    const rawHours = (endAt.getTime() - startAt.getTime()) / 3600_000;
    if (rawHours > 16) throw new BadRequestException('초과근무는 1건당 16시간을 넘을 수 없습니다');
    const hours = Math.round(rawHours * 2) / 2; // 0.5h 반올림
    const workDate = new Date(dto.workDate);
    const isPostFacto = workDate < new Date(new Date().toISOString().slice(0, 10));

    // 사후 신청은 실근태와 대조(불일치는 차단 아닌 경고 — 판단은 결재자)
    let attendanceWarning: string | undefined;
    if (isPostFacto) {
      const dayStart = new Date(workDate);
      const dayEnd = new Date(workDate.getTime() + 86400_000);
      const recs = await this.prisma.attendanceRecord.count({ where: { userId, at: { gte: dayStart, lt: dayEnd } } });
      if (recs === 0) attendanceWarning = '해당 일자의 출퇴근 기록이 없습니다 — 결재자 확인 필요';
    }

    const ot = await this.prisma.overtimeRequest.create({
      data: { userId, workDate, otType: dto.otType, startAt, endAt, hours, isPostFacto, reason: dto.reason },
    });
    const relay = await this.prisma.eApprovalRelay.create({
      data: {
        docType: 'HR_OVERTIME',
        title: `초과근무 ${dto.otType} (${dto.workDate}, ${hours}h${isPostFacto ? '·사후' : ''})`,
        refModule: 'hr.overtime_requests', refId: ot.id,
        callbackUrl: `${publicBaseUrl()}/api/v1/ess/leave/eapproval-callback`,
      },
    });
    await this.prisma.overtimeRequest.update({ where: { id: ot.id }, data: { eApprovalRef: relay.refId } });
    this.audit(userId, 'CREATE', 'OVERTIME_REQUEST', ot.id, { workDate: dto.workDate, hours, isPostFacto });

    const mode = (await this.configRuntime.get('ess.leaveApprovalMode')) ?? 'SIMULATION';
    if (mode === 'INTERNAL') {
      const internal = await this.attachInternalLine(relay.id, userId, '초과근무 결재 요청', `초과근무 ${dto.otType} ${dto.workDate} ${hours}h${attendanceWarning ? ` ⚠️${attendanceWarning}` : ''}`, ot.id);
      return { ...ot, hours: Number(ot.hours), mode: 'INTERNAL', approver: internal.approverName, ...(attendanceWarning ? { warning: attendanceWarning } : {}) };
    }
    if (mode === 'SIMULATION') {
      await this.applyOvertimeDecision(ot.id, 'APPROVED', 'SIMULATION');
      return { ...ot, hours: Number(ot.hours), status: 'APPROVED', simulated: true, ...(attendanceWarning ? { warning: attendanceWarning } : {}) };
    }
    return { ...ot, hours: Number(ot.hours), ...(attendanceWarning ? { warning: attendanceWarning } : {}) };
  }

  private async applyOvertimeDecision(otId: string, status: 'APPROVED' | 'REJECTED', approver?: string) {
    const ot = await this.prisma.overtimeRequest.findUnique({ where: { id: otId } });
    if (!ot) throw new NotFoundException('초과근무 신청을 찾을 수 없습니다');
    if (['APPROVED', 'REJECTED', 'WITHDRAWN'].includes(ot.status)) return { idempotent: true, applied: ot.status };
    const claimed = await this.prisma.overtimeRequest.updateMany({
      where: { id: otId, status: 'REQUESTED' },
      data: { status, decidedAt: new Date() },
    });
    if (claimed.count === 0) return { idempotent: true, applied: status };
    this.audit(ot.userId, 'UPDATE', 'OVERTIME_REQUEST', otId, { status, approver });
    return { applied: status };
  }

  async listOvertimes(userId: string) {
    const rows = await this.prisma.overtimeRequest.findMany({ where: { userId }, orderBy: { workDate: 'desc' }, take: 50 });
    return rows.map((r) => ({ ...r, hours: Number(r.hours) }));
  }

  /** 승인된 초과근무 주간 합계(월~일) — 주간 근로시간 집계 반영용(P1-2) */
  async approvedOvertimeHours(userId: string, weekStart: Date, weekEnd: Date): Promise<number> {
    const agg = await this.prisma.overtimeRequest.aggregate({
      where: { userId, status: 'APPROVED', workDate: { gte: weekStart, lte: weekEnd } },
      _sum: { hours: true },
    });
    return Number(agg._sum.hours ?? 0);
  }

  // ── 승인 후 회수 (P2-2) ──

  /** 승인 완료 휴가의 취소(회수) 상신 — 원문서 불변, 새 결재 문서(HR_LEAVE_CANCEL) */
  async requestLeaveCancel(userId: string, leaveId: string, reason: string) {
    if (!reason?.trim()) throw new BadRequestException('취소 사유는 필수입니다');
    const lr = await this.prisma.leaveRequest.findUnique({ where: { id: leaveId } });
    if (!lr || lr.userId !== userId) throw new NotFoundException('휴가 신청을 찾을 수 없습니다');
    if (lr.status !== 'APPROVED') throw new BadRequestException('승인 완료된 휴가만 회수 신청할 수 있습니다');
    const dup = await this.prisma.eApprovalRelay.findFirst({
      where: { docType: 'HR_LEAVE_CANCEL', refId: leaveId, status: 'PENDING' },
    });
    if (dup) throw new BadRequestException('이미 회수 결재가 진행 중입니다');

    const relay = await this.prisma.eApprovalRelay.create({
      data: {
        docType: 'HR_LEAVE_CANCEL',
        title: `휴가 취소 (${lr.type} ${lr.fromDate.toISOString().slice(0, 10)}~${lr.toDate.toISOString().slice(0, 10)}) — ${reason.slice(0, 60)}`,
        refModule: 'hr.leave_requests', refId: leaveId,
        callbackUrl: `${publicBaseUrl()}/api/v1/ess/leave/eapproval-callback`,
      },
    });
    this.audit(userId, 'CREATE', 'LEAVE_CANCEL', leaveId, { reason });
    const mode = (await this.configRuntime.get('ess.leaveApprovalMode')) ?? 'SIMULATION';
    if (mode === 'INTERNAL') {
      const internal = await this.attachInternalLine(relay.id, userId, '휴가 취소 결재 요청', relay.title ?? '휴가 취소', leaveId);
      return { relayId: relay.id, status: 'PENDING', mode: 'INTERNAL', approver: internal.approverName };
    }
    if (mode === 'SIMULATION') {
      await this.applyLeaveCancel(leaveId, 'SIMULATION');
      await this.prisma.eApprovalRelay.update({ where: { id: relay.id }, data: { status: 'APPROVED', result: 'APPROVED', decidedAt: new Date() } });
      return { relayId: relay.id, status: 'APPROVED', simulated: true };
    }
    return { relayId: relay.id, status: 'PENDING' };
  }

  /** 회수 확정 — 차감 복원·근무표 OFF 원복(멱등: WITHDRAWN이면 생략) */
  private async applyLeaveCancel(leaveId: string, approver?: string) {
    const lr = await this.prisma.leaveRequest.findUnique({ where: { id: leaveId } });
    if (!lr) throw new NotFoundException('휴가 신청을 찾을 수 없습니다');
    if (lr.status !== 'APPROVED') return { idempotent: true, applied: lr.status };
    // 조건부 update로 동시 취소 콜백 이중 복원 차단 — APPROVED→WITHDRAWN을 원자적으로 claim
    //
    // 🔴 (2026-09-16 J1) I2 가 승인 경로(연차 차감)를 묶었는데 **취소 경로가 쌍둥이로 남아 있었다.**
    //    종전엔 claim 이 단독 커밋되고 잔여 복원이 별도 트랜잭션이었다 — 사이에 실패하면 휴가는
    //    WITHDRAWN 인데 **쓴 연차가 잔여로 돌아오지 않는다**. 재시도하면 위 멱등 분기(APPROVED 아님)가
    //    먼저 걸려 **복원이 영원히 일어나지 않는다**(HR 법정 기록·금전 가치). 상태·복원을 한 트랜잭션에.
    // 🔴 변수명은 승인 콜백(`claimedCount`)과 구분한다 — `tx-boundary-fixes-i2.spec` 의 추출 표식이
    //    **변수명 문자열**이라 같은 이름을 쓰면 그 가드가 이 블록을 대신 집어 엉뚱한 곳을 검사한다.
    const withdrawnCount = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.leaveRequest.updateMany({
        where: { id: leaveId, status: 'APPROVED' },
        data: { status: 'WITHDRAWN', decidedAt: new Date() },
      });
      if (claimed.count === 0) return 0;
      if (['ANNUAL', 'HALF'].includes(lr.type)) {
        await tx.leaveBalance.updateMany({
          where: { userId: lr.userId, year: lr.fromDate.getFullYear(), type: 'ANNUAL' },
          data: { used: { decrement: lr.days } },
        });
      }
      // 근무표 원복 불요 — OFF는 저장하지 않고 승인 LeaveRequest에서 파생하므로 상태 전이(WITHDRAWN)만으로 즉시 반영(모델 이원화 통합 2026-07-22)
      return claimed.count;
    });
    if (withdrawnCount === 0) return { idempotent: true, applied: 'WITHDRAWN' };
    this.audit(lr.userId, 'UPDATE', 'LEAVE_CANCEL', leaveId, { applied: 'WITHDRAWN', approver });
    return { applied: 'WITHDRAWN' };
  }

  // ── 대결(위임) (P2-4) ──

  async createDelegation(userId: string, dto: { delegateStaffId: string; fromDate: string; toDate: string; reason: string }) {
    const me = await this.prisma.staff.findUnique({ where: { userId }, select: { id: true } });
    if (!me) throw new BadRequestException('직원(Staff) 정보가 없습니다');
    if (!dto.reason?.trim()) throw new BadRequestException('위임 사유는 필수입니다');
    if (dto.delegateStaffId === me.id) throw new BadRequestException('본인에게 위임할 수 없습니다');
    const from = new Date(dto.fromDate);
    const to = new Date(dto.toDate);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from > to) throw new BadRequestException('위임 기간이 올바르지 않습니다');
    const delegate = await this.prisma.staff.findUnique({ where: { id: dto.delegateStaffId }, select: { id: true, status: true, userId: true, familyName: true, givenName: true } });
    if (!delegate || delegate.status !== 'ACTIVE' || !delegate.userId) throw new BadRequestException('수임자를 찾을 수 없습니다(재직·계정 연결 필요)');
    const d = await this.prisma.approvalDelegation.create({
      data: { delegatorStaffId: me.id, delegateStaffId: dto.delegateStaffId, fromDate: from, toDate: to, reason: dto.reason },
    });
    this.audit(userId, 'CREATE', 'APPROVAL_DELEGATION', d.id, { delegate: dto.delegateStaffId, from: dto.fromDate, to: dto.toDate });
    await this.notifyUser(delegate.userId, 'HR_DELEGATION', '결재 대결(위임) 지정', `${dto.fromDate}~${dto.toDate} 기간 결재가 위임되었습니다 — ${dto.reason}`, d.id);
    return d;
  }

  async listDelegations(userId: string) {
    const me = await this.prisma.staff.findUnique({ where: { userId }, select: { id: true } });
    if (!me) return [];
    return this.prisma.approvalDelegation.findMany({
      where: { OR: [{ delegatorStaffId: me.id }, { delegateStaffId: me.id }], revokedAt: null },
      orderBy: { createdAt: 'desc' }, take: 20,
    });
  }

  async revokeDelegation(userId: string, id: string) {
    const me = await this.prisma.staff.findUnique({ where: { userId }, select: { id: true } });
    const d = await this.prisma.approvalDelegation.findUnique({ where: { id } });
    if (!d || d.delegatorStaffId !== me?.id) throw new NotFoundException('위임을 찾을 수 없습니다');
    await this.prisma.approvalDelegation.update({ where: { id }, data: { revokedAt: new Date() } });
    this.audit(userId, 'UPDATE', 'APPROVAL_DELEGATION', id, { revoked: true });
    return { revoked: true };
  }

  /** 내가 대신 결재 가능한 위임자 staffId 목록(오늘 유효) */
  private async activeDelegatorsOf(staffId: string): Promise<string[]> {
    const today = new Date(new Date().toISOString().slice(0, 10));
    const rows = await this.prisma.approvalDelegation.findMany({
      where: { delegateStaffId: staffId, revokedAt: null, fromDate: { lte: today }, toDate: { gte: today } },
      select: { delegatorStaffId: true },
    });
    return rows.map((r) => r.delegatorStaffId);
  }

  // ── 팀 캘린더 (P2-3, 부서장) ──

  async teamCalendar(userId: string, month?: string) {
    const me = await this.prisma.staff.findUnique({ where: { userId }, select: { id: true } });
    if (!me) throw new BadRequestException('직원(Staff) 정보가 없습니다');
    // 🔴 권한(적대 리뷰): 부서장 판정 = 실제 직속 보고자(managerStaffId=me.id) 존재 여부.
    // 구 코드는 department OR 조건으로 평사원·부서 null 계정에 전 부서/전 조직 휴가를 노출했음.
    // 본인은 리포트 목록에 포함(자신의 팀 뷰). 부서 문자열 OR 제거.
    const reports = await this.prisma.staff.findMany({
      where: { managerStaffId: me.id, status: 'ACTIVE' },
      select: { id: true, userId: true, familyName: true, givenName: true, position: true },
    });
    if (reports.length === 0) return { members: [], days: [], warnRatio: null }; // 부서장 아님(직속 보고자 없음)
    const meRow = await this.prisma.staff.findUnique({ where: { id: me.id }, select: { id: true, userId: true, familyName: true, givenName: true, position: true } });
    const members = meRow ? [meRow, ...reports] : reports;
    const ym = month ?? new Date().toISOString().slice(0, 7);
    const from = new Date(`${ym}-01`);
    const to = new Date(new Date(from.getFullYear(), from.getMonth() + 1, 0).toISOString().slice(0, 10));
    const memberUserIds = members.map((m) => m.userId).filter(Boolean) as string[];
    const [leaves, duties] = await Promise.all([
      this.prisma.leaveRequest.findMany({
        where: { userId: { in: memberUserIds }, status: { in: ['REQUESTED', 'APPROVED'] }, fromDate: { lte: to }, toDate: { gte: from } },
        select: { userId: true, type: true, status: true, fromDate: true, toDate: true },
      }),
      this.prisma.dutyEntry.findMany({
        where: { staffId: { in: memberUserIds }, date: { gte: from, lte: to } },
        select: { staffId: true, date: true, shift: true },
      }),
    ]);
    const warnRatio = Number((await this.configRuntime.get('ess.team.leaveWarnRatio').catch(() => null)) ?? 0.3);
    const nameOf = new Map(members.map((m) => [m.userId, `${m.familyName}${m.givenName}`]));
    const days: { date: string; leaves: { name: string; type: string; status: string }[]; duties: { name: string; shift: string }[]; understaffed: boolean }[] = [];
    for (let t = from.getTime(); t <= to.getTime(); t += 86400_000) {
      const d = new Date(t);
      const key = d.toISOString().slice(0, 10);
      const dayLeaves = leaves.filter((l) => l.fromDate <= d && l.toDate >= d).map((l) => ({ name: nameOf.get(l.userId) ?? '-', type: l.type, status: l.status }));
      const dayDuties = duties.filter((x) => x.date.toISOString().slice(0, 10) === key).map((x) => ({ name: nameOf.get(x.staffId) ?? '-', shift: x.shift }));
      days.push({ date: key, leaves: dayLeaves, duties: dayDuties, understaffed: dayLeaves.length >= Math.max(2, Math.ceil(members.length * warnRatio)) });
    }
    return {
      members: members.map((m) => ({ staffId: m.id, name: `${m.familyName}${m.givenName}`, position: m.position })),
      days, warnRatio,
    };
  }

  // ── INTERNAL 결재함 (P0) ──

  /** 수신함 — 내가 결재할 차례인 휴가 문서 */
  async approvalInbox(userId: string) {
    const me = await this.staffOf(userId);
    if (!me) return [];
    const relays = await this.prisma.eApprovalRelay.findMany({
      where: { docType: { in: this.approvalRegistry.docTypes() }, status: 'PENDING' },
      orderBy: { createdAt: 'asc' },
      take: 100,
    });
    // 대결(P2-4): 오늘 유효한 위임자 문서도 수신
    const delegators = await this.activeDelegatorsOf(me.id);
    const mine = relays.filter((r) => {
      const line = (r.approvalLine as { staffId?: string; result?: string }[] | null) ?? [];
      const current = line.find((a) => !a.result);
      return !!current?.staffId && (current.staffId === me.id || delegators.includes(current.staffId));
    });
    const byType = (t: string) => mine.filter((r) => r.docType === t).map((r) => r.refId);
    const [leaves, corrections, overtimes, certReqs, consentForms, nursingNotes, preAuths] = await Promise.all([
      this.prisma.leaveRequest.findMany({ where: { id: { in: [...byType('HR_LEAVE'), ...byType('HR_LEAVE_CANCEL')] } } }),
      this.prisma.attendanceCorrectionRequest.findMany({ where: { id: { in: byType('HR_ATTENDANCE_CORRECTION') } } }),
      this.prisma.overtimeRequest.findMany({ where: { id: { in: byType('HR_OVERTIME') } } }),
      this.prisma.documentRequest.findMany({
        where: { id: { in: [...byType('CLINICAL_CERTIFICATE'), ...byType('MEDICAL_RECORD_COPY_APPROVAL')] } },
        include: { patient: { select: { mrn: true, familyName: true, givenName: true } }, artifacts: { select: { authoredJson: true, signedAt: true, sourceIds: true } } },
      }),
      this.prisma.consentForm.findMany({
        where: { id: { in: byType('CONSENT_DOCTOR_SIGN') } },
        include: { patient: { select: { mrn: true, familyName: true, givenName: true } } },
      }),
      this.prisma.nursingNote.findMany({
        where: { id: { in: byType('CLINICAL_NOTE_COSIGN') } },
        include: { admission: { select: { patient: { select: { mrn: true, familyName: true, givenName: true } } } } },
      }),
      this.prisma.preAuthRequest.findMany({ where: { id: { in: byType('PRE_AUTH') } } }),
    ]);
    // 사전승인 환자명(관계 미설정 모델이라 patientId로 별도 조회)
    const paPatients = preAuths.length
      ? await this.prisma.patient.findMany({ where: { id: { in: preAuths.map((p) => p.patientId) } }, select: { id: true, mrn: true, familyName: true, givenName: true } })
      : [];
    const paPatientMap = new Map(paPatients.map((p) => [p.id, p]));
    const drafterIds = [...leaves.map((l) => l.userId), ...corrections.map((c) => c.userId), ...overtimes.map((o) => o.userId), ...certReqs.map((c) => c.draftedBy).filter((x): x is string => !!x), ...consentForms.map((c) => c.requestedBy).filter((x): x is string => !!x), ...nursingNotes.map((n) => n.nurseId)];
    const users = await this.prisma.user.findMany({
      where: { id: { in: drafterIds } },
      select: { id: true, familyName: true, givenName: true, department: true },
    });
    const userMap = new Map(users.map((u) => [u.id, u]));
    // 승인 컨텍스트(P2-3): 같은 기간 겹치는 타직원 휴가 수(부서 무관 단순 카운트 — 상세는 팀 캘린더)
    const overlapCount = async (lr: { fromDate: Date; toDate: Date; userId: string } | undefined) => {
      if (!lr) return undefined;
      return this.prisma.leaveRequest.count({
        where: { status: { in: ['REQUESTED', 'APPROVED'] }, userId: { not: lr.userId }, fromDate: { lte: lr.toDate }, toDate: { gte: lr.fromDate } },
      });
    };
    const results = [] as unknown[];
    for (const r of mine) {
      const lr = ['HR_LEAVE', 'HR_LEAVE_CANCEL'].includes(r.docType) ? leaves.find((l) => l.id === r.refId) : undefined;
      const acr = r.docType === 'HR_ATTENDANCE_CORRECTION' ? corrections.find((c) => c.id === r.refId) : undefined;
      const ot = r.docType === 'HR_OVERTIME' ? overtimes.find((o) => o.id === r.refId) : undefined;
      const cert = r.docType === 'CLINICAL_CERTIFICATE' ? certReqs.find((c) => c.id === r.refId) : undefined;
      const copy = r.docType === 'MEDICAL_RECORD_COPY_APPROVAL' ? certReqs.find((c) => c.id === r.refId) : undefined;
      const cons = r.docType === 'CONSENT_DOCTOR_SIGN' ? consentForms.find((c) => c.id === r.refId) : undefined;
      const note = r.docType === 'CLINICAL_NOTE_COSIGN' ? nursingNotes.find((n) => n.id === r.refId) : undefined;
      const pre = r.docType === 'PRE_AUTH' ? preAuths.find((p) => p.id === r.refId) : undefined;
      const drafterId = lr?.userId ?? acr?.userId ?? ot?.userId ?? cert?.draftedBy ?? copy?.draftedBy ?? cons?.requestedBy ?? note?.nurseId ?? pre?.requestedByUserId ?? undefined;
      const u = drafterId ? userMap.get(drafterId) : undefined;
      const line = (r.approvalLine as { staffId?: string; result?: string }[] | null) ?? [];
      const current = line.find((a) => !a.result);
      results.push({
        relayId: r.id,
        docType: r.docType,
        category: this.approvalRegistry.categoryOf(r.docType),
        title: r.title,
        createdAt: r.createdAt,
        delegated: !!current?.staffId && current.staffId !== me.id, // 대결 수신 표시
        leave: lr ? { id: lr.id, type: lr.type, fromDate: lr.fromDate, toDate: lr.toDate, days: Number(lr.days), reason: lr.reason, attachmentDocId: lr.attachmentDocId ?? null, sameDayLeaves: r.docType === 'HR_LEAVE' ? await overlapCount(lr) : undefined } : null,
        correction: acr ? { id: acr.id, workDate: acr.workDate, correctedType: acr.correctedType, correctedAt: acr.correctedAt, reason: acr.reason } : null,
        overtime: ot ? { id: ot.id, workDate: ot.workDate, otType: ot.otType, hours: Number(ot.hours), isPostFacto: ot.isPostFacto, reason: ot.reason } : null,
        certificate: cert ? { id: cert.id, type: cert.type, label: this.certLabel(cert.type), patientName: `${cert.patient.familyName ?? ''}${cert.patient.givenName ?? ''}`.trim(), mrn: cert.patient.mrn, purpose: cert.purpose, authored: !!cert.artifacts[0]?.authoredJson, signed: !!cert.artifacts[0]?.signedAt } : null,
        consent: cons ? { id: cons.id, consentType: cons.consentType, templateName: cons.templateName, patientName: `${cons.patient.familyName ?? ''}${cons.patient.givenName ?? ''}`.trim(), mrn: cons.patient.mrn, patientSigned: !!cons.patientSignedAt, doctorSigned: !!cons.doctorSignedAt } : null,
        nursingNote: note ? { id: note.id, noteType: note.noteType, focus: note.focus, recordedAt: note.recordedAt, patientName: `${note.admission.patient.familyName ?? ''}${note.admission.patient.givenName ?? ''}`.trim(), mrn: note.admission.patient.mrn, cosignStatus: note.cosignStatus } : null,
        recordCopy: copy ? { id: copy.id, type: copy.type, patientName: `${copy.patient.familyName ?? ''}${copy.patient.givenName ?? ''}`.trim(), mrn: copy.patient.mrn, purpose: copy.purpose, recordTypes: copy.recordTypes, requesterType: copy.requesterType, snapshotCount: copy.artifacts.reduce((n, a) => n + (Array.isArray(a.sourceIds) ? (a.sourceIds as unknown[]).length : 0), 0) } : null,
        preAuth: pre ? { id: pre.id, category: pre.category, type: pre.type, status: pre.status, patientName: (() => { const p = paPatientMap.get(pre.patientId); return p ? `${p.familyName ?? ''}${p.givenName ?? ''}`.trim() : ''; })(), mrn: paPatientMap.get(pre.patientId)?.mrn, payload: pre.payload } : null,
        drafter: u ? { name: `${u.familyName}${u.givenName}`, department: u.department } : null,
      });
    }
    return results;
  }

  /**
   * 결재 관리 대시보드 — 카테고리(HR·CLINICAL_RECORD·PRE_AUTH)별 결재 현황 집계.
   * 관리 목적: 카테고리별 총계·상태분포·docType 세부 + 사전승인 유형별·사후승인(POST_FACTO_PENDING) 미결.
   */
  async approvalDashboard(filter?: { from?: string; to?: string }) {
    const reg = this.approvalRegistry;
    // 🔴 W8 — date-only(`YYYY-MM-DD`)를 `new Date()` 로 파싱하면 **항상 UTC 자정**이라
    //    같은 날짜를 넣으면 폭 0 구간이 되고, 상한이 `lte: 자정`이라 끝나는 날이 통째로 빠졌다.
    //    (W7 에서 감사 대시보드는 고쳤는데 결재 대시보드에 같은 결함이 남아 있었다.)
    //    정본: common/day-range 의 dayRange — 로컬(KST) 자정 ~ 다음 날 자정 미만.
    const range = dayRange(filter?.from, filter?.to);
    const where: Record<string, unknown> = { docType: { in: reg.docTypes() } };
    if (range) where.createdAt = range;
    const groups = await this.prisma.eApprovalRelay.groupBy({ by: ['docType', 'status'], where, _count: { _all: true } });

    type Cat = { category: string; total: number; pending: number; approved: number; rejected: number; other: number; byDocType: Record<string, number> };
    const cats: Record<string, Cat> = {};
    for (const c of ['HR', 'CLINICAL_RECORD', 'PRE_AUTH'] as const) cats[c] = { category: c, total: 0, pending: 0, approved: 0, rejected: 0, other: 0, byDocType: {} };
    for (const g of groups) {
      const cat = cats[reg.categoryOf(g.docType)];
      const n = g._count._all;
      cat.total += n;
      if (g.status === 'PENDING' || g.status === 'PROCESSING') cat.pending += n;
      else if (g.status === 'APPROVED') cat.approved += n;
      else if (g.status === 'REJECTED') cat.rejected += n;
      else cat.other += n;
      cat.byDocType[g.docType] = (cat.byDocType[g.docType] ?? 0) + n;
    }

    // 사전승인 세부(유형별·사후승인 미결) — PreAuthRequest 자체 집계
    const paWhere: Record<string, unknown> = {};
    if (range) paWhere.createdAt = range; // 같은 구간 정본(dayRange) — 카드와 세부의 분모를 일치시킨다
    const [paByType, postFactoPending] = await Promise.all([
      this.prisma.preAuthRequest.groupBy({ by: ['type', 'status'], where: paWhere, _count: { _all: true } }),
      this.prisma.preAuthRequest.count({ where: { status: 'POST_FACTO_PENDING' } }),
    ]);
    const preAuthByType: Record<string, Record<string, number>> = {};
    for (const g of paByType) {
      (preAuthByType[g.type] ??= {})[g.status] = g._count._all;
    }

    return {
      categories: Object.values(cats),
      preAuth: { byType: preAuthByType, postFactoPending },
      period: { from: filter?.from ?? null, to: filter?.to ?? null },
    };
  }

  /** 상신함 — 내 문서 진행상태(결재선 타임라인) */
  async approvalOutbox(userId: string) {
    const leaves = await this.prisma.leaveRequest.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 50 });
    const relays = await this.prisma.eApprovalRelay.findMany({
      where: { refModule: 'hr.leave_requests', refId: { in: leaves.map((l) => l.id) } },
    });
    const relayMap = new Map(relays.map((r) => [r.refId, r]));
    return leaves.map((lr) => {
      const r = relayMap.get(lr.id);
      return {
        id: lr.id, type: lr.type, fromDate: lr.fromDate, toDate: lr.toDate, days: Number(lr.days),
        status: lr.status, decidedAt: lr.decidedAt, createdAt: lr.createdAt,
        approvalLine: (r?.approvalLine as object[] | null) ?? [], relayStatus: r?.status ?? null,
      };
    });
  }

  /** 결재자 증빙 열람(P2-1) — 결재선 참여자(위임 포함)만·감사로그 */
  async readApprovalAttachment(relayId: string, userId: string): Promise<{ buffer: Buffer; contentType: string; fileName: string }> {
    const me = await this.prisma.staff.findUnique({ where: { userId }, select: { id: true } });
    if (!me) throw new BadRequestException('직원(Staff) 정보가 없습니다');
    const relay = await this.prisma.eApprovalRelay.findUnique({ where: { id: relayId } });
    if (!relay || !['HR_LEAVE', 'HR_LEAVE_CANCEL'].includes(relay.docType)) throw new NotFoundException('결재 문서를 찾을 수 없습니다');
    const line = (relay.approvalLine as { staffId?: string }[] | null) ?? [];
    const delegators = await this.activeDelegatorsOf(me.id);
    const inLine = line.some((a) => a.staffId === me.id || (a.staffId && delegators.includes(a.staffId)));
    if (!inLine) throw new BadRequestException('결재선 참여자만 증빙을 열람할 수 있습니다');
    const lr = await this.prisma.leaveRequest.findUnique({ where: { id: relay.refId }, select: { attachmentDocId: true, userId: true } });
    if (!lr?.attachmentDocId) throw new NotFoundException('첨부된 증빙이 없습니다');
    const doc = await this.prisma.staffDocument.findUnique({ where: { id: lr.attachmentDocId } });
    if (!doc) throw new NotFoundException('증빙 서류를 찾을 수 없습니다');
    this.audit(userId, 'READ', 'LEAVE_ATTACHMENT', lr.attachmentDocId, { relayId, drafter: lr.userId }); // 민감 열람 감사
    const { join } = await import('path');
    const { readFileSync, existsSync } = await import('fs');
    const { createDecipheriv } = await import('crypto');
    const path = join(STAFF_DOC_DIR, doc.fileKey);
    if (!existsSync(path)) throw new NotFoundException('파일이 없습니다.');
    const blob = readFileSync(path);
    const decipher = createDecipheriv('aes-256-gcm', this.staffFileKey(), blob.subarray(0, 16));
    decipher.setAuthTag(blob.subarray(16, 32));
    const buffer = Buffer.concat([decipher.update(blob.subarray(32)), decipher.final()]);
    return { buffer, contentType: doc.mimeType ?? 'application/octet-stream', fileName: doc.fileName };
  }

  /** 결재 — 승인/반려(반려 사유 필수). 최종 단계면 leaveCallback으로 종결(멱등 재사용) */
  async decideApproval(relayId: string, userId: string, decision: 'APPROVED' | 'REJECTED', comment?: string) {
    if (decision === 'REJECTED' && !comment?.trim()) throw new BadRequestException('반려 사유는 필수입니다');
    const me = await this.prisma.staff.findUnique({ where: { userId }, select: { id: true, familyName: true, givenName: true } });
    if (!me) throw new BadRequestException('직원(Staff) 정보가 없습니다');
    const relay = await this.prisma.eApprovalRelay.findUnique({ where: { id: relayId } });
    if (!relay || !this.approvalRegistry.has(relay.docType)) throw new NotFoundException('결재 문서를 찾을 수 없습니다');
    if (relay.status !== 'PENDING') throw new BadRequestException(`이미 처리된 문서입니다(${relay.status})`);
    // 임상 증명서 — 승인은 작성(author) 선행 필수. §17 검증은 author 시점에 강제되므로 여기선 작성 여부만 확인.
    if (relay.docType === 'CLINICAL_CERTIFICATE' && decision === 'APPROVED') {
      const art = await this.prisma.issuanceArtifact.findFirst({ where: { requestId: relay.refId }, select: { authoredJson: true, createdBy: true } });
      if (!art?.authoredJson || !art.createdBy) throw new BadRequestException('증명서 내용이 작성되지 않았습니다 — 담당의가 먼저 작성해야 승인할 수 있습니다');
    }
    const line = ((relay.approvalLine as { order: number; staffId: string; userId?: string; role?: string; result?: string; actedAt?: string; comment?: string; actedByStaffId?: string; delegated?: boolean }[] | null) ?? []).slice();
    const idx = line.findIndex((a) => !a.result);
    const delegators = idx >= 0 ? await this.activeDelegatorsOf(me.id) : [];
    const isOwn = idx >= 0 && line[idx].staffId === me.id;
    const isDelegate = idx >= 0 && delegators.includes(line[idx].staffId);
    if (idx < 0 || (!isOwn && !isDelegate)) throw new BadRequestException('현재 결재 차례가 아닙니다');
    // MED-3 — 임상 카테고리(비HR: 기록지·사전승인)는 대결자도 의사여야 확약 가능(비의사 대결 확약·서명명의 오류 차단)
    if (isDelegate && this.approvalRegistry.categoryOf(relay.docType) !== 'HR') {
      const actor = await this.prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
      if (actor?.role !== 'DOCTOR') throw new BadRequestException('임상 결재(기록지·사전승인)는 의사만 확약할 수 있습니다 — 대결자도 의사 자격이 필요합니다');
    }
    const originalEntry = { ...line[idx] };
    const resultedEntry = { ...line[idx], result: decision, actedAt: new Date().toISOString(), actedByStaffId: me.id, ...(isDelegate ? { delegated: true } : {}), ...(comment ? { comment } : {}) };
    // 이번 결재로 모든 단계가 채워지면 최종(중간 단계는 다음 결재자로 넘김)
    const isFinal = decision === 'REJECTED' || line.every((a, i) => i === idx || !!a.result);
    const approverName = `${me.familyName}${me.givenName}`;
    const def = this.approvalRegistry.get(relay.docType)!;

    const notifyResult = async () => {
      const drafterUserId = await def.resolveDrafter(relay.refId);
      if (drafterUserId) {
        await this.notifyUser(
          drafterUserId, 'HR_APPROVAL_RESULT',
          decision === 'APPROVED' ? '결재가 승인되었습니다' : '결재가 반려되었습니다',
          `${relay.title} — ${decision === 'APPROVED' ? '승인' : `반려 (사유: ${comment})`}`, relay.refId,
        );
      }
    };

    // 최종 확정 + updatesRelay=false(임상 기록지·근태정정·초과·회수) — 원자 claim(HIGH-2 이중발급 차단) +
    //   발행(onDecision) 성공 후 종결, 실패 시 PENDING·미결로 롤백(HIGH-1 고착 복구).
    if (isFinal && !def.updatesRelay) {
      const claimed = await this.prisma.eApprovalRelay.updateMany({ where: { id: relayId, status: 'PENDING' }, data: { status: 'PROCESSING' } });
      if (claimed.count === 0) throw new BadRequestException('이미 처리 중이거나 처리된 문서입니다');
      line[idx] = resultedEntry;
      await this.prisma.eApprovalRelay.update({ where: { id: relayId }, data: { approvalLine: line as object } });
      try {
        await def.onDecision(relay.refId, decision, approverName, relay.id, userId, comment);
        await this.prisma.eApprovalRelay.update({ where: { id: relayId }, data: { status: decision, result: decision, decidedAt: new Date() } });
      } catch (e) {
        // 발행/도메인 반영 실패 — 결재선·상태를 원복해 재결재 가능하게(영구 고착 방지)
        line[idx] = originalEntry;
        await this.prisma.eApprovalRelay.update({ where: { id: relayId }, data: { status: 'PENDING', approvalLine: line as object } }).catch(() => undefined);
        throw e;
      }
      await notifyResult();
    } else {
      // 중간 단계(다음 결재자로) 또는 HR_LEAVE(updatesRelay=true — leaveCallback 자체 원자 claim)
      line[idx] = resultedEntry;
      await this.prisma.eApprovalRelay.update({ where: { id: relayId }, data: { approvalLine: line as object } });
      if (isFinal) {
        await def.onDecision(relay.refId, decision, approverName, relay.id, userId, comment);
        await notifyResult();
      }
    }
    return { relayId, decision, final: isFinal };
  }

  // ── 임상 기록지 전자결재 (파일럿: 증명서 B그룹) ──

  /** 증명서 라벨 */
  private certLabel(type: string): string {
    return ({ DIAGNOSIS_CERT: '진단서', OPINION: '소견서', ADMISSION_CERT: '입퇴원확인서' } as Record<string, string>)[type] ?? '증명서';
  }

  /**
   * 기안(간호·행정) → 담당의 전자결재 상신. 결재 정본은 백본(EApprovalRelay), 확약은 의료진.
   * 확약자(담당의) = 지정 없으면 근거 진료(encounter.doctorId §17)에서 자동 해소.
   * 게이트 approval.clinicalCertificate.enabled(기본 OFF). 기존 환자포털 요청·의사 수동 서명 경로는 그대로.
   *
   * 🔴 (2026-09-17 L2) 게이트 4곳(`clinicalCertificate`·`consent`·`clinicalNote`·`recordCopy`)의
   *    `.catch(() => false)` 를 걷었다 — `config.get()` 은 미설정 키에 `null` 을 돌려주고 **DB 실패에만 던지므로**
   *    그 catch 는 오직 실패만 삼켜, 화면에 "…비활성화되어 있습니다(키 이름)" 라고 **설정을 단정**하게 했다.
   *    관리자가 끈 것과 설정을 못 읽은 것은 다른 사실이다(§부분실패).
   */
  async submitClinicalApproval(userId: string, dto: { requestId: string; approverUserId?: string }) {
    if (String(await this.configRuntime.get('approval.clinicalCertificate.enabled')) !== 'true')
      throw new BadRequestException('기록지 전자결재 확약 경로가 비활성화되어 있습니다(approval.clinicalCertificate.enabled)');
    const req = await this.prisma.documentRequest.findUnique({ where: { id: dto.requestId } });
    if (!req) throw new NotFoundException('서류 요청을 찾을 수 없습니다');
    // 파일럿 = B그룹(증명서: 진단서·소견서·입퇴원확인서)
    if (!CERTIFICATE_TYPES.includes(req.type))
      throw new BadRequestException('증명서(진단서·소견서·입퇴원확인서)만 전자결재 확약 대상입니다');
    if (req.issuedDocumentId) throw new BadRequestException('이미 발급된 요청입니다');
    const dup = await this.prisma.eApprovalRelay.findFirst({ where: { docType: 'CLINICAL_CERTIFICATE', refId: dto.requestId, status: 'PENDING' } });
    if (dup) throw new BadRequestException('이미 전자결재가 진행 중입니다');

    // 확약 담당의 해소 — 지정 우선, 없으면 근거 진료의(§17)
    let approverUserId = dto.approverUserId;
    if (!approverUserId && req.encounterId) {
      approverUserId = (await this.prisma.encounter.findUnique({ where: { id: req.encounterId }, select: { doctorId: true } }))?.doctorId ?? undefined;
    }
    if (!approverUserId) throw new BadRequestException('확약할 담당 의사를 지정하세요(근거 진료가 없으면 필수)');
    const approver = await this.prisma.user.findUnique({ where: { id: approverUserId }, select: { role: true } });
    if (approver?.role !== 'DOCTOR') throw new BadRequestException('확약자는 의사여야 합니다');

    const callbackUrl = `${publicBaseUrl()}/api/v1/ess/leave/eapproval-callback`;
    const relay = await this.prisma.eApprovalRelay.create({
      data: {
        docType: 'CLINICAL_CERTIFICATE', title: `${this.certLabel(req.type)} 전자결재 확약 요청`,
        refModule: 'medical_record_issuance.document_requests', refId: dto.requestId, callbackUrl,
      },
    });
    // 기안자 기록 — 의사 author가 덮어쓰는 processedBy와 분리
    await this.prisma.documentRequest.update({ where: { id: dto.requestId }, data: { draftedBy: userId } });
    await this.attachApproverLine(relay.id, approverUserId, `${this.certLabel(req.type)} 확약 요청`, relay.title ?? '증명서 확약', dto.requestId);
    this.audit(userId, 'CREATE', 'CLINICAL_APPROVAL', relay.id, { requestId: dto.requestId, docType: req.type });
    return { relayId: relay.id, status: 'PENDING', approverUserId };
  }

  /** 확약 의사 1인을 결재선에 세우고 알림(HR attachInternalLine의 임상 형제 — manager 대신 지정 의사) */
  private async attachApproverLine(relayId: string, approverUserId: string, notiTitle: string, notiBody: string, refId: string) {
    const staff = await this.prisma.staff.findUnique({ where: { userId: approverUserId }, select: { id: true, familyName: true, givenName: true } });
    if (!staff) {
      // MED-4 — 결재선 없는 orphan relay가 남아 재상신을 영구 차단하는 것 방지(dup 판정에 걸림). 방금 만든 relay 정리.
      await this.prisma.eApprovalRelay.delete({ where: { id: relayId } }).catch(() => undefined);
      throw new BadRequestException('확약 의사의 직원(Staff) 정보가 없습니다');
    }
    await this.prisma.eApprovalRelay.update({
      where: { id: relayId },
      data: { approvalLine: [{ order: 1, staffId: staff.id, userId: approverUserId, role: 'APPROVE' }] as object },
    });
    await this.prisma.notification
      .create({ data: { userId: approverUserId, type: 'CLINICAL_APPROVAL', title: notiTitle, message: notiBody, severity: 'INFO', refType: 'DOCUMENT_REQUEST', refId } })
      .catch(() => undefined);
    return { approverName: `${staff.familyName ?? ''}${staff.givenName ?? ''}` };
  }

  /**
   * 확약 확정 훅 — 승인=작성 담당의 서명(§17)+발급, 반려=reject. 멱등(발급/서명 기존 가드가 흡수).
   * 서명자는 결재자가 아니라 작성 담당의(art.createdBy) — 의료법상 서명 주체 보존(대결이어도 서명은 작성의).
   */
  private async confirmCertificate(refId: string, decision: 'APPROVED' | 'REJECTED', approverUserId?: string, comment?: string) {
    if (decision === 'APPROVED') {
      const art = await this.prisma.issuanceArtifact.findFirst({ where: { requestId: refId }, select: { createdBy: true, authoredJson: true } });
      if (!art?.authoredJson || !art.createdBy) throw new BadRequestException('작성된 증명서가 없습니다');
      await this.issuance.signCertificate(refId, art.createdBy); // 작성 담당의 서명(멱등: sigRef 재기록)
      return this.issuance.issue(refId, art.createdBy);           // 발급(멱등: 이미 발급이면 alreadyIssued)
    }
    // 반려 — reject 사유는 REJECT_REASONS 화이트리스트라 OTHER + 상세(comment)
    return this.issuance.reject(refId, 'OTHER', comment ?? '전자결재 반려', approverUserId ?? refId);
  }

  // ── 동의서 의사 확약 (P1b) ──

  /**
   * 간호 기안(requestedBy) → 담당의 전자결재 확약 상신. 대상=의사 서명 필요 동의서(SURGERY 등).
   * 담당의 미지정 시 consentForm.doctorId 사용. 게이트 approval.consent.enabled(기본 OFF).
   */
  async submitConsentApproval(userId: string, dto: { consentId: string; approverUserId?: string }) {
    if (String(await this.configRuntime.get('approval.consent.enabled')) !== 'true')
      throw new BadRequestException('동의서 전자결재 확약 경로가 비활성화되어 있습니다(approval.consent.enabled)');
    const c = await this.prisma.consentForm.findUnique({ where: { id: dto.consentId }, select: { status: true, doctorSignedAt: true, doctorId: true, consentType: true } });
    if (!c) throw new NotFoundException('동의서를 찾을 수 없습니다');
    const doctorTypes = nonEmptyStringArrayOr(
      await this.configRuntime.get('consent.doctorSignRequiredTypes').catch(() => null),
      DOCTOR_SIGN_REQUIRED_CONSENT_TYPES,
    );
    if (!doctorTypes.includes((c.consentType as string) ?? ''))
      throw new BadRequestException('의사 서명이 필요한 동의서(수술·마취·시술·연구·연명의료 등 기관 지정 유형)만 전자결재 확약 대상입니다');
    if (c.status === 'SIGNED') throw new BadRequestException('이미 서명 완료된 동의서입니다');
    if (c.status === 'REVOKED') throw new BadRequestException('철회된 동의서입니다');
    if (c.doctorSignedAt) throw new BadRequestException('이미 의사 서명이 완료되었습니다');
    const dup = await this.prisma.eApprovalRelay.findFirst({ where: { docType: 'CONSENT_DOCTOR_SIGN', refId: dto.consentId, status: 'PENDING' } });
    if (dup) throw new BadRequestException('이미 전자결재가 진행 중입니다');

    const approverUserId = dto.approverUserId ?? c.doctorId ?? undefined;
    if (!approverUserId) throw new BadRequestException('확약할 담당 의사를 지정하세요');
    const approver = await this.prisma.user.findUnique({ where: { id: approverUserId }, select: { role: true } });
    if (approver?.role !== 'DOCTOR') throw new BadRequestException('확약자는 의사여야 합니다');

    const label = ({ SURGERY: '수술', ANESTHESIA: '마취', PROCEDURE: '시술', RESEARCH: '연구', DNR: '연명의료' } as Record<string, string>)[(c.consentType as string) ?? ''] ?? '동의서';
    const callbackUrl = `${publicBaseUrl()}/api/v1/ess/leave/eapproval-callback`;
    // 🔴 (2026-09-16 J1) 종전엔 relay 생성·동의서 연결·결재선 부여가 각각 커밋됐다. relay 만 커밋되고
    //    결재선 부여가 실패하면 **아무 수신함에도 뜨지 않는 PENDING relay** 가 남는데, 위 dup 검사가
    //    **재상신을 막는다** — 수술·마취 동의서의 의사 확약이 영영 올라가지 않는다.
    //    `attachApproverLine` 은 staff 부재만 보상 삭제(MED-4)했고 그 뒤 쓰기 실패는 보상이 없었다.
    //    결재자 조회는 트랜잭션 밖, 상신 3쓰기는 안으로. 알림은 밖(실패가 상신을 되돌리면 안 된다 — pre-auth 선례).
    const approverStaff = await this.prisma.staff.findUnique({ where: { userId: approverUserId }, select: { id: true, familyName: true, givenName: true } });
    if (!approverStaff) throw new BadRequestException('확약 의사의 직원(Staff) 정보가 없습니다');
    const relayTitle = `${label} 동의서 의사 확약 요청`;
    const relay = await this.prisma.$transaction(async (tx) => {
      const rel = await tx.eApprovalRelay.create({
        data: {
          docType: 'CONSENT_DOCTOR_SIGN', title: relayTitle,
          refModule: 'consent.consent_forms', refId: dto.consentId, callbackUrl,
          approvalLine: [{ order: 1, staffId: approverStaff.id, userId: approverUserId, role: 'APPROVE' }] as object,
        },
      });
      // 기안자(requestedBy) 기록 + 담당의 확정(confirmConsent 서명 주체)
      await tx.consentForm.update({ where: { id: dto.consentId }, data: { requestedBy: userId, ...(c.doctorId ? {} : { doctorId: approverUserId }) } });
      return rel;
    });
    await this.prisma.notification
      .create({ data: { userId: approverUserId, type: 'CLINICAL_APPROVAL', title: `${label} 동의서 확약 요청`, message: relayTitle, severity: 'INFO', refType: 'DOCUMENT_REQUEST', refId: dto.consentId } })
      .catch(() => undefined);
    this.audit(userId, 'CREATE', 'CONSENT_APPROVAL', relay.id, { consentId: dto.consentId, consentType: c.consentType });
    return { relayId: relay.id, status: 'PENDING', approverUserId };
  }

  /** 확약 확정 훅 — 승인=담당의 doctorSign(멱등: 이미 서명이면 스킵), 반려=동의서 revoke. */
  private async confirmConsent(refId: string, decision: 'APPROVED' | 'REJECTED', approverUserId?: string, comment?: string) {
    const c = await this.prisma.consentForm.findUnique({ where: { id: refId }, select: { status: true, doctorSignedAt: true, doctorId: true } });
    if (!c) return { notFound: true };
    if (decision === 'APPROVED') {
      if (c.status === 'SIGNED' || c.doctorSignedAt) return { idempotent: true }; // 이미 의사 서명/완료
      const signer = c.doctorId ?? approverUserId;
      if (!signer) throw new BadRequestException('서명할 담당 의사를 확인할 수 없습니다');
      return this.consent.doctorSign(refId, signer);
    }
    if (c.status === 'REVOKED') return { idempotent: true };
    return this.consent.revoke(refId, comment ?? '전자결재 반려');
  }

  // ── 간호기록 의사 공동서명(co-sign) (P1) ──

  /**
   * 간호 기안(nurseId) → 담당의 co-sign 확약 상신. 서명 완료(SIGNED/AMENDED) 간호기록만 대상.
   * 담당의 미지정 시 입원의 담당의(attending ?? admitting)로 해소. 게이트 approval.clinicalNote.enabled(기본 OFF).
   * 원 간호기록은 불변(append-only) — co-sign은 별도 필드로만 부가.
   */
  async submitNoteCosign(userId: string, dto: { noteId: string; approverUserId?: string }) {
    if (String(await this.configRuntime.get('approval.clinicalNote.enabled')) !== 'true')
      throw new BadRequestException('간호기록 공동서명 전자결재 경로가 비활성화되어 있습니다(approval.clinicalNote.enabled)');
    const note = await this.prisma.nursingNote.findUnique({ where: { id: dto.noteId }, select: { status: true, cosignStatus: true, admissionId: true } });
    if (!note) throw new NotFoundException('간호기록을 찾을 수 없습니다');
    if (!['SIGNED', 'AMENDED'].includes(note.status)) throw new BadRequestException('서명 완료된 간호기록만 공동서명을 상신할 수 있습니다');
    if (note.cosignStatus === 'COSIGNED') throw new BadRequestException('이미 의사 공동서명이 완료되었습니다');
    const dup = await this.prisma.eApprovalRelay.findFirst({ where: { docType: 'CLINICAL_NOTE_COSIGN', refId: dto.noteId, status: 'PENDING' } });
    if (dup) throw new BadRequestException('이미 전자결재가 진행 중입니다');

    let approverUserId = dto.approverUserId;
    if (!approverUserId) {
      const adm = await this.prisma.admission.findUnique({ where: { id: note.admissionId }, select: { attendingDoctorId: true, admittingDoctorId: true } });
      approverUserId = adm?.attendingDoctorId ?? adm?.admittingDoctorId ?? undefined;
    }
    if (!approverUserId) throw new BadRequestException('확약할 담당 의사를 지정하세요');
    const approver = await this.prisma.user.findUnique({ where: { id: approverUserId }, select: { role: true } });
    if (approver?.role !== 'DOCTOR') throw new BadRequestException('확약자는 의사여야 합니다');

    const callbackUrl = `${publicBaseUrl()}/api/v1/ess/leave/eapproval-callback`;
    const relay = await this.prisma.eApprovalRelay.create({
      data: {
        docType: 'CLINICAL_NOTE_COSIGN', title: '간호기록 의사 공동서명 요청',
        refModule: 'nursing_note.nursing_notes', refId: dto.noteId, callbackUrl,
      },
    });
    await this.prisma.nursingNote.update({ where: { id: dto.noteId }, data: { cosignStatus: 'PENDING' } });
    await this.attachApproverLine(relay.id, approverUserId, '간호기록 공동서명 요청', relay.title ?? '간호기록 공동서명', dto.noteId);
    this.audit(userId, 'CREATE', 'CLINICAL_NOTE_COSIGN', relay.id, { noteId: dto.noteId });
    return { relayId: relay.id, status: 'PENDING', approverUserId };
  }

  /** 확약 확정 훅 — 승인=COSIGNED, 반려=REJECTED. 원 기록 불변(별도 필드만 갱신·멱등). */
  private async confirmNoteCosign(refId: string, decision: 'APPROVED' | 'REJECTED', approverUserId?: string) {
    const note = await this.prisma.nursingNote.findUnique({ where: { id: refId }, select: { cosignStatus: true } });
    if (!note) return { notFound: true };
    if (note.cosignStatus === 'COSIGNED') return { idempotent: true };
    const status = decision === 'APPROVED' ? 'COSIGNED' : 'REJECTED';
    await this.prisma.nursingNote.update({ where: { id: refId }, data: { cosignStatus: status, cosignedBy: approverUserId ?? null, cosignedAt: new Date() } });
    return { cosignStatus: status };
  }

  // ── 의무기록 사본 발급 승인 (P2·A그룹) ──

  /**
   * 행정 기안 → 담당의 발급 승인 상신. 대상=A그룹 사본(증명서 아닌 DocumentRequest).
   * 스냅샷 동결(IN_REVIEW) 후 상신. §21 대리(PROXY)는 자격검증(VERIFIED) 선행. 게이트 approval.recordCopy.enabled(기본 OFF).
   */
  async submitRecordCopyApproval(userId: string, dto: { requestId: string; approverUserId: string }) {
    if (String(await this.configRuntime.get('approval.recordCopy.enabled')) !== 'true')
      throw new BadRequestException('의무기록 사본 발급 승인 전자결재 경로가 비활성화되어 있습니다(approval.recordCopy.enabled)');
    const req = await this.prisma.documentRequest.findUnique({ where: { id: dto.requestId }, select: { type: true, status: true, issuedDocumentId: true, requesterType: true, proxyVerifyStatus: true } });
    if (!req) throw new NotFoundException('서류 요청을 찾을 수 없습니다');
    if (CERTIFICATE_TYPES.includes(req.type)) throw new BadRequestException('증명서는 clinical-approvals 경로를 사용하세요(사본 승인 대상 아님)');
    if (req.issuedDocumentId) throw new BadRequestException('이미 발급된 요청입니다');
    if (req.status !== 'IN_REVIEW') throw new BadRequestException('기록 스냅샷 동결(IN_REVIEW) 후 발급 승인을 상신하세요');
    // §21 대리인 자격검증 선행
    if (req.requesterType === 'PROXY' && req.proxyVerifyStatus !== 'VERIFIED')
      throw new BadRequestException('대리인 자격 검증(VERIFIED) 후 발급 승인을 상신할 수 있습니다');
    const dup = await this.prisma.eApprovalRelay.findFirst({ where: { docType: 'MEDICAL_RECORD_COPY_APPROVAL', refId: dto.requestId, status: 'PENDING' } });
    if (dup) throw new BadRequestException('이미 전자결재가 진행 중입니다');

    // A그룹 사본은 단일 담당의가 없으므로 승인 의사 지정 필수
    if (!dto.approverUserId) throw new BadRequestException('발급을 승인할 담당 의사를 지정하세요');
    const approver = await this.prisma.user.findUnique({ where: { id: dto.approverUserId }, select: { role: true } });
    if (approver?.role !== 'DOCTOR') throw new BadRequestException('승인자는 의사여야 합니다');

    const callbackUrl = `${publicBaseUrl()}/api/v1/ess/leave/eapproval-callback`;
    const relay = await this.prisma.eApprovalRelay.create({
      data: {
        docType: 'MEDICAL_RECORD_COPY_APPROVAL', title: '의무기록 사본 발급 승인 요청',
        refModule: 'medical_record_issuance.document_requests', refId: dto.requestId, callbackUrl,
      },
    });
    await this.prisma.documentRequest.update({ where: { id: dto.requestId }, data: { draftedBy: userId } });
    await this.attachApproverLine(relay.id, dto.approverUserId, '의무기록 사본 발급 승인 요청', relay.title ?? '사본 발급 승인', dto.requestId);
    this.audit(userId, 'CREATE', 'RECORD_COPY_APPROVAL', relay.id, { requestId: dto.requestId, type: req.type });
    return { relayId: relay.id, status: 'PENDING', approverUserId: dto.approverUserId };
  }

  /** 확약 확정 훅 — 승인=발급(issue, A그룹·멱등), 반려=reject. */
  private async confirmRecordCopy(refId: string, decision: 'APPROVED' | 'REJECTED', approverUserId?: string, comment?: string) {
    const req = await this.prisma.documentRequest.findUnique({ where: { id: refId }, select: { issuedDocumentId: true } });
    if (!req) return { notFound: true };
    if (req.issuedDocumentId) return { idempotent: true, issued: req.issuedDocumentId };
    if (decision === 'APPROVED') return this.issuance.issue(refId, approverUserId ?? refId);
    return this.issuance.reject(refId, 'OTHER', comment ?? '전자결재 반려', approverUserId ?? refId);
  }

  async listLeaves(userId: string) {
    return this.prisma.leaveRequest.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 100 });
  }

  /** 연차 잔여 — 🔴 P12(같은 사실에 정본이 둘).
   *  구 코드는 ERP 응답이 있으면 그것만 반환하고 HIS `leave_balances` 를 조회조차 하지 않았다.
   *  실측(EMP-2020-001·2026): ERP granted17/used0/remaining17 · HIS 원장 granted15/used3/remaining12
   *  = 화면은 "연차 잔여 17일" 하나만 말하고, 5일 차이는 어디에도 드러나지 않았다.
   *  더 나쁜 것은 휴가 초과검증(requestLeave)도 같은 17을 써서 **HIS 기준 12일을 넘는 신청이 통과**했다.
   *  정리(어느 쪽도 지우지 않는다 — 과거 기록 변조 금지):
   *   · 표시 정본 = ERP(인사 부여 확정처). 화면은 반드시 출처를 함께 말한다(`source`).
   *   · 다른 출처는 `alternates` 로 그대로 노출하고 값이 다르면 `discrepancy=true`.
   *   · 초과검증 기준 = 부여정보가 있는 출처 중 **최소 잔여**(`enforceRemaining`·fail-closed).
   *   · 승인된 연차 신청 합계(`approvedRequestDays`)는 원장 `used` 와의 교차확인 값(집행 기준 아님). */
  async leaveBalance(userId: string, year?: number): Promise<LeaveBalanceItem[]> {
    return (await this.leaveBalanceDetailed(userId, year)).items;
  }

  /** 연차 잔여 + **못 물어본 출처**. 컨트롤러는 `items` 를 data 로, `unavailableSources` 를 meta 로 싣는다. */
  async leaveBalanceDetailed(userId: string, year?: number): Promise<LeaveBalanceResult> {
    const y = year ?? new Date().getFullYear();
    const staff = await this.staffOf(userId);

    // 출처 1 — ERP(부여 확정처)
    let erpItems: LeaveBalanceSourceRow[] | null = null;
    const unavailableSources: LeaveBalanceUnavailableSource[] = [];
    if (staff?.employeeNumber) {
      const erp = await this.erpGetDetailed('/api/v1/integration/hr/leave-balance', { employeeNumber: staff.employeeNumber, year: String(y) });
      // 🔴 ERP 를 못 물어본 사실을 결과에 싣는다 — 조용히 HIS 원장 하나만 쓰면 "출처 일치"로 읽힌다
      if (!erp.data) unavailableSources.push({ source: 'ERP', failure: this.erpUnavailable(erp).failure, upstreamStatus: erp.status });
      const items = erp.data?.items as { type?: string; granted?: number; used?: number; remaining?: number }[] | undefined;
      if (Array.isArray(items)) {
        erpItems = items
          .filter((i) => typeof i?.type === 'string')
          .map((i) => this.toBalanceRow('ERP', i.type as string, i.granted, i.used, i.remaining));
      }
    }

    // 출처 2 — HIS 원장(leave_balances). 승인 차감(leaveCallback)이 실제로 반영되는 곳.
    const rows = await this.prisma.leaveBalance.findMany({ where: { userId, year: y } });
    const hisItems = rows.map((r) => this.toBalanceRow('HIS_LEDGER', r.type, r.granted, r.used));

    // 교차확인 — 올해 승인된 연차성(ANNUAL·HALF) 신청 일수 합계
    const approvedAgg = await this.prisma.leaveRequest.aggregate({
      where: {
        userId, status: 'APPROVED', type: { in: ['ANNUAL', 'HALF'] },
        fromDate: { gte: new Date(Date.UTC(y, 0, 1)), lt: new Date(Date.UTC(y + 1, 0, 1)) },
      },
      _sum: { days: true },
    });
    const approvedRequestDays = Number(approvedAgg._sum.days ?? 0);

    const types = [...new Set([...(erpItems ?? []).map((i) => i.type), ...hisItems.map((i) => i.type)])];
    const items = types.map((type) => {
      const candidates = [erpItems?.find((i) => i.type === type), hisItems.find((i) => i.type === type)]
        .filter((c): c is LeaveBalanceSourceRow => !!c); // ERP 우선 순서 유지
      const [primary, ...alternates] = candidates;
      const discrepancy = candidates.length > 1 && new Set(candidates.map((c) => c.remaining)).size > 1;
      // granted=0 = '부여 정보 미등록'(ERP 미이관 등) — 진짜 잔여 0과 구분해 집행 기준에서 제외
      const enforceable = candidates.filter((c) => c.granted > 0);
      const enforce = enforceable.length
        ? enforceable.reduce((a, b) => (a.remaining <= b.remaining ? a : b))
        : null;
      return {
        type,
        source: primary.source, granted: primary.granted, used: primary.used, remaining: primary.remaining,
        alternates,
        discrepancy,
        enforceRemaining: enforce?.remaining ?? null,
        enforceSource: enforce?.source ?? null,
        ...(type === 'ANNUAL' ? { approvedRequestDays } : {}),
      };
    });
    return { items, unavailableSources };
  }

  /** 출처별 잔여 1행 정규화 — remaining 은 보고값이 있으면 존중하되 없으면 granted-used 로 산출 */
  private toBalanceRow(source: LeaveBalanceSourceName, type: string, granted?: number, used?: number, remaining?: number): LeaveBalanceSourceRow {
    const g = Number(granted ?? 0);
    const u = Number(used ?? 0);
    return { source, type, granted: g, used: u, remaining: Number.isFinite(Number(remaining)) ? Number(remaining) : g - u };
  }

  async withdrawLeave(userId: string, id: string) {
    const lr = await this.prisma.leaveRequest.findFirst({ where: { id, userId } });
    if (!lr) throw new NotFoundException('휴가 신청을 찾을 수 없습니다.');
    if (lr.status !== 'REQUESTED') throw new BadRequestException('이미 처리된 신청은 철회할 수 없습니다.');
    return this.prisma.leaveRequest.update({ where: { id }, data: { status: 'WITHDRAWN', decidedAt: new Date() } });
  }

  /**
   * 결재 릴레이 종결 — **원문서에 실제로 적용된 결정**으로만, **아직 종결되지 않은 릴레이에만** 적는다.
   *
   * 🔴 (2026-09-16 E1) 종전엔 `updateMany({ where: { refModule, refId } })` 로 조건 없이 `dto.status` 를 썼다.
   *    원문서(정정·초과근무 신청)는 조건부 claim 으로 멱등이라 첫 결정을 지키는데, 릴레이만 나중 콜백을 따라
   *    뒤집혔다 — 신청은 APPROVED 인데 결재 문서는 REJECTED 로 보이는 **서로 모순된 두 기록**이 남았다
   *    (외부 Clinic 콜백은 재시도가 없어 중복·역순 도착이 실제로 일어난다).
   */
  private async closeRelay(refModule: string, refId: string, applied: string, approvalId: string) {
    const common = { status: applied, decidedAt: new Date(), callbackDelivered: true };
    // approvalId 는 unique — 이미 매핑된 행에만 유지하고, 미매핑 행에는 상태만 종결한다(HR_LEAVE 패턴)
    await this.prisma.eApprovalRelay.updateMany({
      where: { refModule, refId, approvalId, status: { notIn: ['APPROVED', 'REJECTED'] } },
      data: common,
    });
    await this.prisma.eApprovalRelay.updateMany({
      where: { refModule, refId, approvalId: null, status: { notIn: ['APPROVED', 'REJECTED'] } },
      data: { ...common, approvalId },
    });
  }

  // 결재 결과 콜백(§9.6.2) — 멱등. Clinic 콜백 무재시도 대비.
  async leaveCallback(dto: { ref: { source_module: string; source_ref: string }; status: string; approver?: string; decidedAt?: string; approvalId?: string }) {
    // P1 — HR 결재 콜백 일반화: ref.source_module로 문서 타입 분기(외부 CLINIC 콜백 대응)
    if (dto.ref?.source_module === 'hr.attendance_corrections') {
      const r = await this.applyCorrectionDecision(dto.ref.source_ref, dto.status as 'APPROVED' | 'REJECTED', dto.approver);
      if (dto.approvalId) await this.closeRelay(dto.ref.source_module, dto.ref.source_ref, r.applied, dto.approvalId);
      return { ok: true, ...r };
    }
    if (dto.ref?.source_module === 'hr.overtime_requests') {
      const r = await this.applyOvertimeDecision(dto.ref.source_ref, dto.status as 'APPROVED' | 'REJECTED', dto.approver);
      if (dto.approvalId) await this.closeRelay(dto.ref.source_module, dto.ref.source_ref, r.applied, dto.approvalId);
      return { ok: true, ...r };
    }
    // 반려 자동취소 정책(2026-07-22) — leave 외 refModule은 relay의 docType으로 레지스트리 훅에 위임.
    // 종전엔 임상/사전승인/교대 docType이 외부(W.Sign) 채널로 반려되면 relay만 REJECTED 되고
    // 연계 기록(동의서·사본·사전승인 발행분 등)이 원상태로 방치되던 latent 갭 봉합.
    const srcModule = dto.ref?.source_module;
    if (srcModule && srcModule !== 'hr.leave_requests') {
      const relay = await this.prisma.eApprovalRelay.findFirst({
        where: { refModule: srcModule, refId: dto.ref.source_ref },
        orderBy: { createdAt: 'desc' }, select: { id: true, docType: true, status: true },
      });
      const def = relay ? this.approvalRegistry.get(relay.docType) : undefined;
      if (!def) throw new NotFoundException(`콜백 대상 결재를 찾을 수 없습니다(${srcModule})`);
      if (['APPROVED', 'REJECTED'].includes(relay!.status)) {
        return { ok: true, docType: relay!.docType, idempotent: true }; // 멱등
      }
      const r = await def.onDecision(dto.ref.source_ref, dto.status as 'APPROVED' | 'REJECTED', dto.approver, relay!.id, undefined, undefined);
      // relay 종결 — approvalId는 unique라 이미 매핑된 행에만 유지(HR_LEAVE 패턴)
      if (dto.approvalId) {
        await this.prisma.eApprovalRelay.updateMany({ where: { refModule: srcModule, refId: dto.ref.source_ref, approvalId: dto.approvalId }, data: { status: dto.status, decidedAt: new Date(), callbackDelivered: true } });
      }
      await this.prisma.eApprovalRelay.updateMany({ where: { refModule: srcModule, refId: dto.ref.source_ref, approvalId: null }, data: { status: dto.status, decidedAt: new Date(), callbackDelivered: true } });
      return { ok: true, docType: relay!.docType, ...(typeof r === 'object' && r ? r : {}) };
    }
    const leaveId = dto.ref?.source_ref;
    const lr = await this.prisma.leaveRequest.findUnique({ where: { id: leaveId } });
    if (!lr) throw new NotFoundException('해당 휴가 신청 없음');
    if (['APPROVED', 'REJECTED', 'WITHDRAWN'].includes(lr.status)) {
      return { ok: true, leaveRequestId: leaveId, applied: lr.status, idempotent: true }; // 멱등(빠른 경로)
    }
    // 🔴 원자성+동시성(적대 리뷰): 상태 전이를 조건부 update(where status=REQUESTED)로 게이트 —
    // 동시 콜백 2건이 read-then-write TOCTOU로 둘 다 통과해 차감이 이중 적용되던 결함 방지.
    // count=0이면 이미 다른 콜백이 종결시킨 것 → 멱등 반환(차감·부수효과 미실행).
    //
    // 🔴 (2026-09-16 I2) 종전엔 이 claim 이 **단독으로 먼저 커밋**되고 릴레이 종결·연차 차감이
    //    별도 트랜잭션으로 나갔다. 그 사이에 실패하면 휴가는 APPROVED 인데 **연차 잔여가 줄지 않는다**.
    //    재시도하면 위 멱등 분기(APPROVED)가 먼저 걸려 **차감이 영원히 일어나지 않는다** —
    //    쓴 연차가 잔여에 안 잡히는 쪽으로 굳는다(HR 법정 기록·금전 가치). 상태·릴레이·차감을 한 트랜잭션에.
    const claimedCount = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.leaveRequest.updateMany({
        where: { id: leaveId, status: 'REQUESTED' },
        data: { status: dto.status, decidedAt: dto.decidedAt ? new Date(dto.decidedAt) : new Date() },
      });
      if (claimed.count === 0) return 0;
      if (dto.approvalId) {
        // 동일 lr에 릴레이 2행 가능(ESS 생성분 + 외부 상신분) — approvalId는 unique라 이미 매핑된 행에만 유지, 나머지는 상태만 종결
        await tx.eApprovalRelay.updateMany({
          where: { refModule: 'hr.leave_requests', refId: leaveId, approvalId: dto.approvalId },
          data: { status: dto.status, decidedAt: new Date(), callbackDelivered: true },
        });
        await tx.eApprovalRelay.updateMany({
          where: { refModule: 'hr.leave_requests', refId: leaveId, approvalId: null },
          data: { status: dto.status, decidedAt: new Date(), callbackDelivered: true },
        });
      }
      // 승인 시 차감(P2-1 정밀화) — 연차성(ANNUAL·HALF)만 ANNUAL 잔여 차감. 병가/경조/외출은 미차감(별도 법정)
      if (dto.status === 'APPROVED' && ['ANNUAL', 'HALF'].includes(lr.type)) {
        const y = lr.fromDate.getFullYear();
        await tx.leaveBalance.updateMany({ where: { userId: lr.userId, year: y, type: 'ANNUAL' }, data: { used: { increment: lr.days } } });
      }
      return claimed.count;
    });
    if (claimedCount === 0) {
      return { ok: true, leaveRequestId: leaveId, applied: dto.status, idempotent: true };
    }
    // 승인 시 당직 겹침 경고 (P0-5) — OFF는 별도 저장하지 않음(승인 LeaveRequest가 정본, 통합뷰가 병합 — 모델 이원화 통합 2026-07-22).
    // 당직(DutyEntry) 겹침은 삭제하지 않고 경고 알림.
    if (dto.status === 'APPROVED') {
      try {
        const staffRow = await this.prisma.staff.findUnique({ where: { userId: lr.userId }, select: { id: true, familyName: true, givenName: true, manager: { select: { userId: true } } } });
        if (staffRow) {
          const dutyClash = await this.prisma.dutyEntry.count({
            where: { staffId: lr.userId, date: { gte: lr.fromDate, lte: lr.toDate } },
          });
          if (dutyClash > 0 && staffRow.manager?.userId) {
            await this.notifyUser(
              staffRow.manager.userId,
              'HR_DUTY_CLASH',
              '승인된 휴가와 당직 일정 겹침',
              `${staffRow.familyName}${staffRow.givenName}님의 승인 휴가 기간에 당직 ${dutyClash}건이 배정되어 있습니다 — 당직표 조정이 필요합니다`,
              lr.id,
            );
          }
        }
      } catch (e) {
        this.logger.warn(`휴가 승인 근무표 반영 실패(비차단): ${e instanceof Error ? e.message : e}`);
      }
    }
    this.audit(lr.userId, 'UPDATE', 'LEAVE_REQUEST', leaveId, { event: 'EAPPROVAL_CALLBACK', status: dto.status, approver: dto.approver });
    return { ok: true, leaveRequestId: leaveId, applied: dto.status };
  }

  // ── 증명서 ──
  async issueCertificate(userId: string, kind: string) {
    const staff = await this.staffOf(userId);
    if (!staff) throw new BadRequestException('직원(Staff) 정보가 없습니다.');
    const verifyCode = randomBytes(8).toString('hex');
    const cert = await this.prisma.employmentCertificate.create({
      data: { userId, kind, pdfKey: '', verifyCode },
    });
    this.audit(userId, 'CREATE', 'EMPLOYMENT_CERTIFICATE', cert.id, { kind });
    return cert;
  }

  async listCertificates(userId: string) {
    return this.prisma.employmentCertificate.findMany({ where: { userId }, orderBy: { issuedAt: 'desc' }, take: 50 });
  }

  async verifyCertificate(code: string) {
    const cert = await this.prisma.employmentCertificate.findUnique({ where: { verifyCode: code } });
    if (!cert) return { valid: false };
    return { valid: !cert.revoked, kind: cert.kind, issuedAt: cert.issuedAt };
  }

  // ── 자격·교육 (staff-qualification 데이터 재사용, 본인 스코프 — FR-D4) ──
  async qualifications(userId: string) {
    const [credentials, educations] = await Promise.all([
      this.prisma.staffCredential.findMany({ where: { userId }, orderBy: [{ expiresAt: 'asc' }], take: 100 }),
      this.prisma.staffEducation.findMany({ where: { userId }, orderBy: [{ completedAt: 'desc' }], take: 100 }),
    ]);
    return { credentials, educations };
  }

  // ── 환영·회사소개 재열람 (온보딩과 동일 콘텐츠, 읽기 전용 — §4-W.2) ──
  async getWelcome() {
    const content = await this.configRuntime.get('onboarding.welcome');
    return content ?? { version: 0, locales: ['ko'], sections: [] };
  }

  // ══ 급여 기초정보(ESS 셀프서비스) ══
  private async requireStaff(userId: string) {
    const s = await this.staffOf(userId);
    if (!s) throw new BadRequestException('직원(Staff) 정보가 없습니다.');
    return s;
  }
  private staffFileKey(): Buffer {
    const secret = this.config.get<string>('ENCRYPTION_KEY');
    if (!secret) throw new BadRequestException('ENCRYPTION_KEY 미설정 — 암호화 불가');
    return getKeyCustody().getSymmetricKey(secret);
  }

  // ── 부양가족(인적공제 기초) ── HIS 구조화 저장. 주민번호는 미저장.
  async listDependents(userId: string) {
    const s = await this.requireStaff(userId);
    return this.prisma.staffDependent.findMany({ where: { staffId: s.id }, orderBy: { createdAt: 'asc' } });
  }
  async addDependent(userId: string, dto: DependentInput) {
    const s = await this.requireStaff(userId);
    if (!dto.name || !dto.relation) throw new BadRequestException('이름·관계는 필수입니다.');
    return this.prisma.staffDependent.create({
      data: { staffId: s.id, name: dto.name, relation: dto.relation, birthDate: dto.birthDate ? new Date(dto.birthDate) : undefined, isDependent: dto.isDependent ?? true, deductionType: dto.deductionType ?? null, note: dto.note ?? null },
    });
  }
  async updateDependent(userId: string, id: string, dto: DependentInput) {
    const s = await this.requireStaff(userId);
    const dep = await this.prisma.staffDependent.findUnique({ where: { id }, select: { staffId: true } });
    if (!dep || dep.staffId !== s.id) throw new NotFoundException('부양가족을 찾을 수 없습니다.');
    return this.prisma.staffDependent.update({
      where: { id },
      data: { name: dto.name, relation: dto.relation, birthDate: dto.birthDate ? new Date(dto.birthDate) : undefined, isDependent: dto.isDependent, deductionType: dto.deductionType, note: dto.note },
    });
  }
  async removeDependent(userId: string, id: string) {
    const s = await this.requireStaff(userId);
    const dep = await this.prisma.staffDependent.findUnique({ where: { id }, select: { staffId: true } });
    if (!dep || dep.staffId !== s.id) throw new NotFoundException('부양가족을 찾을 수 없습니다.');
    await this.prisma.staffDependent.delete({ where: { id } });
    return { deleted: true };
  }

  // ── 입사/급여 서류(암호화 저장·본인 스코프) ──
  async listStaffDocuments(userId: string) {
    const s = await this.requireStaff(userId);
    return this.prisma.staffDocument.findMany({ where: { staffId: s.id }, orderBy: { createdAt: 'desc' }, select: { id: true, category: true, fileName: true, mimeType: true, sizeBytes: true, status: true, createdAt: true } });
  }
  async uploadStaffDocument(userId: string, category: string, originalName: string, buffer: Buffer, mime?: string) {
    const s = await this.requireStaff(userId);
    if (!buffer?.length) throw new BadRequestException('파일이 비어 있습니다.');
    mkdirSync(STAFF_DOC_DIR, { recursive: true });
    const iv = randomBytes(16);
    const cipher = createCipheriv('aes-256-gcm', this.staffFileKey(), iv);
    const enc = Buffer.concat([cipher.update(buffer), cipher.final()]);
    const blob = Buffer.concat([iv, cipher.getAuthTag(), enc]);
    const storedKey = `${randomUUID()}${extname(originalName).toLowerCase()}.enc`;
    writeFileSync(join(STAFF_DOC_DIR, storedKey), blob, { mode: 0o600 });
    return this.prisma.staffDocument.create({ data: { staffId: s.id, category: category || 'OTHER', fileName: originalName, fileKey: storedKey, mimeType: mime ?? null, sizeBytes: buffer.length, sensitive: true } });
  }
  async readStaffDocument(userId: string, docId: string): Promise<{ buffer: Buffer; contentType: string; fileName: string }> {
    const s = await this.requireStaff(userId);
    const doc = await this.prisma.staffDocument.findUnique({ where: { id: docId } });
    if (!doc || doc.staffId !== s.id) throw new NotFoundException('서류를 찾을 수 없습니다.');
    const path = join(STAFF_DOC_DIR, doc.fileKey);
    if (!existsSync(path)) throw new NotFoundException('파일이 없습니다.');
    const blob = readFileSync(path);
    const decipher = createDecipheriv('aes-256-gcm', this.staffFileKey(), blob.subarray(0, 16));
    decipher.setAuthTag(blob.subarray(16, 32));
    const buffer = Buffer.concat([decipher.update(blob.subarray(32)), decipher.final()]);
    return { buffer, contentType: doc.mimeType ?? DOC_MIME[extname(doc.fileName).toLowerCase()] ?? 'application/octet-stream', fileName: doc.fileName };
  }
  async deleteStaffDocument(userId: string, docId: string) {
    const s = await this.requireStaff(userId);
    const doc = await this.prisma.staffDocument.findUnique({ where: { id: docId } });
    if (!doc || doc.staffId !== s.id) throw new NotFoundException('서류를 찾을 수 없습니다.');
    await this.prisma.staffDocument.delete({ where: { id: docId } });
    try { const p = join(STAFF_DOC_DIR, doc.fileKey); if (existsSync(p)) unlinkSync(p); } catch { /* 파일 없음 무시 */ }
    return { deleted: true };
  }

  // ── ERP 급여 read 연동(기존 키로 즉시 소비·R-4/R-5/원천징수) ──
  /** 인적공제 코드(ERP·R-5) — 부양가족 폼 공제구분 셀렉트용 */
  async getDeductionCodes() {
    const got = await this.erpGetDetailed('/api/v1/integration/hr/deduction-codes', {});
    // 🔴 조회 실패를 '항목 0건'으로 번역하지 않는다 — 빈 셀렉트는 "공제구분이 없는 회사"로 읽힌다. 산출 불가 = null
    if (!got.data) return { items: null, ...this.erpUnavailable(got) };
    const items = (got.data as { items?: unknown[] }).items;
    return { items: Array.isArray(items) ? items : [], available: true as const };
  }
  /** ERP에 등록된 본인 급여기초(마스킹·R-4) — HIS 저장분과 대사용 */
  async getErpPayrollIdentity(userId: string) {
    const staff = await this.requireStaff(userId);
    const got = await this.erpGetDetailed(`/api/v1/integration/hr/payroll-identity/${encodeURIComponent(staff.employeeNumber)}`, {}, staff.employeeNumber);
    // 🔴 `registered:false` 는 "ERP 에 등록이 안 됐다"는 **사실 주장**이다 — 못 물어본 것을 그렇게 말하지 않는다(null)
    if (!got.data) return { registered: null, unavailable: true, ...this.erpUnavailable(got) };
    return { ...got.data, unavailable: false, available: true as const };
  }
  /** 원천징수영수증(연말정산·ERP) 조회.
   *  🔴 ERP 가 요청 연도와 다른 귀속연도를 반환할 수 있다(실측: year=2026 요청에 2025 응답 사례).
   *  구 응답은 요청 연도를 되돌려주지 않아 화면이 요청 연도로 라벨링했고, 2025 발급분이
   *  "2026년 귀속"으로 표시될 수 있었다 → 요청/응답 연도를 모두 실어보내 화면이 대조하게 한다. */
  async getWithholdingReceipt(userId: string, year?: string) {
    const staff = await this.requireStaff(userId);
    const y = year ?? String(new Date().getFullYear() - 1);
    const got = await this.erpGetDetailed('/api/v1/integration/hr/withholding-receipt', { employeeNumber: staff.employeeNumber, year: y });
    const data = got.data;
    if (!data) return { ...this.erpUnavailable(got), requestedYear: y };
    const returnedYear = (data as { year?: number | string }).year;
    return {
      available: true,
      requestedYear: y,
      returnedYear: returnedYear != null ? String(returnedYear) : null,
      yearMismatch: returnedYear != null && String(returnedYear) !== y,
      receipt: data,
    };
  }

  // ── ERP 개인포털 확장(R-8/R-9/R-11) ──
  /** 당직/근무표(ERP·R-8) */
  async getDuties(userId: string, from?: string, to?: string) {
    const staff = await this.requireStaff(userId);
    const got = await this.erpGetDetailed('/api/v1/integration/hr/duties', { employeeNumber: staff.employeeNumber, from, to });
    // 🔴 조회 실패는 '근무 없음'이 아니다 — 빈 목록만 내면 화면이 "근무표가 비었다"고 말한다. 산출 불가 = null
    if (!got.data) return { items: null, ...this.erpUnavailable(got) };
    return { ...got.data, available: true as const };
  }
  /** 성과급 실적 상세(ERP·R-9) */
  async getPerformance(userId: string, period?: string) {
    const staff = await this.requireStaff(userId);
    const p = period ?? new Date().toISOString().slice(0, 7).replace('-', '');
    const got = await this.erpGetDetailed('/api/v1/integration/hr/performance', { employeeNumber: staff.employeeNumber, period: p });
    // 🔴 실패를 '해당 없음'으로 읽히게 두지 않는다 — 사유를 싣는다
    if (!got.data) return { ...this.erpUnavailable(got), requestedPeriod: p };
    return { ...got.data, available: true as const };
  }
  /** 퇴직금 추정(ERP·R-11) */
  async getSeverance(userId: string, asOf?: string) {
    const staff = await this.requireStaff(userId);
    const got = await this.erpGetDetailed('/api/v1/integration/hr/severance', { employeeNumber: staff.employeeNumber, as_of: asOf });
    if (!got.data) return this.erpUnavailable(got);
    return { ...got.data, available: true as const };
  }
  /** 재직/경력 증명서 목록(ERP 정본·R-10) */
  async getErpCertificates(userId: string): Promise<{ items: unknown[] | null; available: boolean; failure?: ErpReadFailure; upstreamStatus?: number | null }> {
    const staff = await this.requireStaff(userId);
    const got = await this.erpGetDetailed('/api/v1/integration/hr/certificates', { employeeNumber: staff.employeeNumber });
    // 🔴 실패를 '증명서 0건'으로 말하지 않는다 — 아래 PDF 프록시가 이 목록으로 fail-closed 판정을 한다
    if (!got.data) return { items: null, ...this.erpUnavailable(got) };
    const items = (got.data as { items?: unknown[] }).items;
    return { items: Array.isArray(items) ? items : [], available: true };
  }
  /** 증명서 PDF 다운로드(ERP·본인 스코프) — 바이너리 프록시.
   *  🔴 구 코드는 employeeNumber 를 쿼리로 넘기기만 하고 ERP 가 그 직원 것을 돌려줬는지 검증하지 않았다
   *  (ERP 측 강제 여부 미확인 = 우리 쪽에서 fail-closed 해야 하는 자리). id 가 본인 증명서 목록에
   *  실제로 있는지 먼저 확인하고, 대상 토큰(#4)도 붙여 ERP 가 스코프를 강제할 수 있게 한다. */
  async getErpCertificatePdf(userId: string, id: string): Promise<{ buffer: Buffer; contentType: string } | null> {
    const staff = await this.requireStaff(userId);
    const base = (await this.configRuntime.get('erp.webhookUrl')) as string;
    const key = (await this.configRuntime.get('erp.integrationKey')) as string;
    if (!base) return null;
    // 본인 증명서 목록에 없는 id 는 내려주지 않는다(목록 조회 실패=불확실 → 거부, fail-closed)
    const mine = await this.getErpCertificates(userId);
    const owned = (mine.items ?? []).some((c) => String((c as { id?: unknown }).id) === id);
    if (!owned) {
      // 🔴 fail-closed 는 유지하되 **왜 닫혔는지**를 남긴다 — 목록 조회 실패와 '내 것이 아님'은 다른 사실이다
      const why = mine.items === null ? '본인 목록을 확인하지 못함' : '본인 목록에 없는 id';
      this.logger.warn(`ESS 증명서 PDF 요청 거부 — ${why}(${mine.failure ?? '-'} · 사번 ${staff.employeeNumber})`);
      return null;
    }
    const url = `${base.replace(/\/$/, '')}/api/v1/integration/hr/certificates/${encodeURIComponent(id)}/pdf?employeeNumber=${encodeURIComponent(staff.employeeNumber)}`;
    const headers: Record<string, string> = { 'X-Integration-Key': key ?? '' };
    const tt = await this.issueTargetToken(staff.employeeNumber);
    if (tt) headers['X-Target-Token'] = tt;
    try {
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(8000) });
      if (!res.ok) return null;
      return { buffer: Buffer.from(await res.arrayBuffer()), contentType: res.headers.get('content-type') ?? 'application/pdf' };
    } catch {
      return null;
    }
  }

  // ── 급여 신원(계좌·주민번호) — HIS 전체값 미보관, ERP 릴레이(게이트: ess.payrollRelay.enabled) ──
  async getPayrollRelayStatus(userId: string) {
    const s = await this.requireStaff(userId);
    const rec = await this.prisma.staffPayrollRelay.findUnique({ where: { staffId: s.id } });
    const relayEnabled = (await this.configRuntime.get('ess.payrollRelay.enabled')) === true;
    return {
      relayEnabled,
      bankName: rec?.bankName ?? null, bankAccountMask: rec?.bankAccountMask ?? null, bankHolder: rec?.bankHolder ?? null, bankRelayedAt: rec?.bankRelayedAt ?? null,
      residentIdMask: rec?.residentIdMask ?? null, residentRelayedAt: rec?.residentRelayedAt ?? null,
    };
  }
  async relayPayrollIdentity(userId: string, dto: PayrollIdentityInput) {
    const s = await this.requireStaff(userId);
    const relayEnabled = (await this.configRuntime.get('ess.payrollRelay.enabled')) === true;
    if (!relayEnabled) throw new BadRequestException('ERP 급여정보 보안 연동이 아직 활성화되지 않았습니다. 통장사본·신분증을 서류로 제출해 주세요.');
    const hmacKey = await this.resolvePayrollHmacKey();
    if (!hmacKey) throw new BadRequestException('ERP 보안 릴레이 시크릿(HMAC)이 구성되지 않았습니다. 관리자에게 문의하세요.');
    if (!dto.bankAccount && !dto.residentId) throw new BadRequestException('계좌 또는 주민등록번호 중 하나는 입력해야 합니다.');
    const now = new Date();
    const store: { bankName?: string | null; bankHolder?: string | null; bankAccountMask?: string; bankRelayedAt?: Date; residentIdMask?: string; residentRelayedAt?: Date } = {};
    // ERP 보안채널로 실값 송출(HMAC 서명·본인만·HIS 미보관). ERP가 저장, HIS는 마스킹+시각만.
    const payload: Record<string, unknown> = { employeeNumber: s.employeeNumber };
    if (dto.bankAccount) {
      const digits = dto.bankAccount.replace(/[^0-9]/g, '');
      if (digits.length < 6 || digits.length > 20) throw new BadRequestException('계좌번호 형식 오류');
      payload.bankName = dto.bankName ?? null; payload.holder = dto.bankHolder ?? null; payload.accountNumber = digits;
      store.bankName = dto.bankName ?? null; store.bankHolder = dto.bankHolder ?? null; store.bankAccountMask = `***${digits.slice(-4)}`; store.bankRelayedAt = now;
    }
    if (dto.residentId) {
      const rrn = dto.residentId.replace(/[^0-9]/g, '');
      if (rrn.length !== 13) throw new BadRequestException('주민등록번호 형식 오류');
      payload.residentId = rrn;
      store.residentIdMask = `${rrn.slice(0, 6)}-${rrn.slice(6, 7)}******`; store.residentRelayedAt = now;
    }
    payload.dependents = await this.prisma.staffDependent.count({ where: { staffId: s.id } }); // ERP 선택 필드(인적공제 참고)
    const resp = await this.erpPost('/api/v1/integration/hr/payroll-identity', payload);
    // 🔴 보류는 "실패"가 아니다 — 보내지 않았다는 사실 그대로(200). 마스킹·전송 시각도 남기지 않는다(보낸 적이 없다).
    //    문장은 화면이 조립한다(`heldByMode` 값만 싣는다 — 서버가 한국어 문장을 만들지 않는다).
    if (resp.heldByMode) return { relayed: false as const, heldByMode: resp.heldByMode, ...(await this.getPayrollRelayStatus(userId)) };
    const accepted = !resp.data || (resp.data as { accepted?: boolean }).accepted !== false;
    if (!resp.ok || !accepted) throw new BadRequestException(`ERP 전송에 실패했습니다 (상태 ${resp.status || 'network'}). 잠시 후 다시 시도하거나 인사팀에 문의하세요.`);
    await this.prisma.staffPayrollRelay.upsert({ where: { staffId: s.id }, create: { staffId: s.id, ...store }, update: store });
    return { relayed: true as const, ...(await this.getPayrollRelayStatus(userId)) };
  }
}
