import { Injectable, Logger, NotImplementedException, UnauthorizedException, BadRequestException, ForbiddenException, OnModuleInit, Optional, ServiceUnavailableException } from '@nestjs/common';
import { UserRole, Prisma } from '@prisma/client';
import { OnEvent } from '@nestjs/event-emitter';
import * as crypto from 'crypto';
import { ConfigRuntimeService } from '../config/config-runtime.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { DocumentService } from '../document/document.service';
import { PdfGenerationService } from '../medical-record-copy/pdf-generation.service';
import { consentReadableSections } from '@hospital-run/shared';
import { RedisService } from '../../infrastructure/redis/redis.service';
import { safeFetch } from '../../common/util/safe-fetch';
import { decryptField } from '../../common/crypto/field-encryption';
import { KeyCustodyService } from '../../common/crypto/key-custody.service';
import { IntegrationOutboxService } from '../integration/integration-outbox.service';

/**
 * sign 봉인 영수증 — 해시체인 항목(entryHash·prevHash)과 TSA 앵커. 위변조 탐지의 근거라
 * 호출부가 원내에 함께 보관한다. `skipped`는 sign 비활성(설정 문제)이라 실패와 구분한다.
 */
export interface SignSealReceipt {
  ok: boolean;
  skipped?: boolean;
  reason?: string;
  entryHash?: string;
  prevHash?: string;
  authMethod?: string;
  anchorHead?: string;
  anchoredAt?: string;
}

/** sign webhook 수신 payload — 멱등 claim(handleWebhook)과 반영(applyWebhook)이 같은 모양을 쓴다 */
export interface SignWebhookEvent {
  eventId?: string; eventType?: string; type?: string; signatureRequestId?: string; status?: string;
  signParticipantId?: string; signCertSerial?: string; signCertSerials?: string[];
  auditCertUri?: string; occurredAt?: string; requestId?: string; externalDocId?: string;
  supersededBy?: string; // C-2 개정 — request.superseded: 새 버전 requestId
  // HSM 기획 Phase 4 — sign 키 수탁 attestation(additive). 미수신 시 폴백(기록 생략).
  keyCustody?: string; signAttestationRef?: string; tsaToken?: string;
  // ⚠️ 봉인(HSM 앵커) 판정은 assuranceLevel='HSM_ANCHORED' 로 — keyCustody='HSM'은 설계상 안 걸림(서명키 SOFT).
  assuranceLevel?: string;
  // #3 sign 회신 — 서명자별 발급 serial 미러(가이드 §5: certSerial). externalSignerRef=직원/환자 ref.
  signatures?: Array<{ externalSignerRef?: string; signerRole?: string; signerType?: string; certSerial?: string; serialNumber?: string; signCertSerial?: string }>;
}

/**
 * 외부 서명서비스(sign) 연동 토글 스캐폴드 (P0) — sign팀 승인분.
 *
 * 설계: `docs/01-plan/features/production-service-integration.plan.md` §서명서비스.
 * - `sign.mode` 토글: SIMULATION(기본·현행 내부 서명 무변경) | EXTERNAL(sign 서비스).
 * - 현재 EXTERNAL 경로는 **스텁(501)**. 실 활성화는 공동 게이트(sign 운영급: 서명코어 CMS/PAdES
 *   일원화 + Prisma-live + HSM/mTLS) 해제 후 P1 파일럿(동의서 1종)부터.
 * - blockchainSignature(74참조)는 deprecate(읽기전용)만 — 삭제·백필 금지(P3 게이트).
 *
 * 합의 필요(B): SIGN_API_KEY·SIGN_WEBHOOK_SECRET·JWKS issuer·documentHash(=HIS 봉인 SHA-256).
 * 시크릿은 config-runtime 슬롯으로만 보관(repo 비저장).
 */
/**
 * `sign.completed` 완료본 URL 을 **발송 시점**에 다시 만든다(outbox 갱신기).
 * 🔴 (2026-09-28 §3 #30) 24시간 토큰을 적재 시점에 만들어, 리허설 보류·FAILED 후 재시도로 늦게 나가면
 *    ERP 가 만료 URL(`invalid download token`)을 받았다. issueNo 가 있을 때만 url·expiresAt 을 갈아 끼운다.
 */
export function refreshSignCompletedDocument(
  payload: Record<string, unknown>,
  mint: (issueNo: string) => { url: string; expiresAt: string },
): Record<string, unknown> {
  const doc = payload.document as Record<string, unknown> | undefined;
  if (!doc || typeof doc !== 'object' || typeof doc.issueNo !== 'string' || !doc.issueNo) return payload;
  return { ...payload, document: { ...doc, ...mint(doc.issueNo) } };
}

@Injectable()
export class SignIntegrationService implements OnModuleInit {
  private readonly logger = new Logger(SignIntegrationService.name);

  constructor(
    private readonly config: ConfigRuntimeService,
    private readonly prisma: PrismaService,
    private readonly documents: DocumentService,
    private readonly redis: RedisService,
    private readonly keyCustody: KeyCustodyService,
    private readonly outbox: IntegrationOutboxService,
    /** 동의서 정본 HTML(동의서 모듈과 같은 생성기) — 동의서 서명 대상 본문을 서버가 동결한다 */
    @Optional() private readonly consentPdf?: PdfGenerationService,
  ) {}

  onModuleInit() {
    this.outbox.registerPayloadRefresher('sign.completed', (p) => refreshSignCompletedDocument(p, (no) => this.documents.downloadUrl(no)));
  }

  /**
   * sign egress SSRF 심층방어 — allowlist를 sign.url 자기참조(hostname 파생)가 아닌 독립
   * config `sign.allowedHosts`(csv·기본 127.0.0.1/localhost/sign.example.org)로 구성.
   * sign.url 하나만 변조해서는 임의 내부주소로 나갈 수 없다(allowedHosts도 함께 변경 필요·키 이원화).
   */
  private async signEgressOpts(url: string): Promise<{ allowPrivate: boolean; allowedHosts: string[] }> {
    const raw = (await this.config.get('sign.allowedHosts').catch(() => null)) as unknown;
    const configured = typeof raw === 'string' && raw.trim()
      ? raw.split(',').map((s) => s.trim()).filter(Boolean)
      : Array.isArray(raw) ? raw.map(String).filter(Boolean) : null;
    const allowedHosts = configured && configured.length ? configured : ['127.0.0.1', 'localhost', 'sign.example.org'];
    let host = '';
    try { host = new URL(url).hostname; } catch { /* 형식 오류는 safeFetch가 거부 */ }
    if (host && !allowedHosts.includes(host)) {
      throw new ForbiddenException(`sign.url 호스트(${host})가 sign.allowedHosts 허용목록에 없습니다`);
    }
    return { allowPrivate: true, allowedHosts };
  }

  /**
   * EXTERNAL 서명요청 제출 (P1 스캐폴드 — sign 합의 반영).
   * 게이트: sign.mode=EXTERNAL 아니면 501. 활성화는 P1 파일럿 공동 게이트 후.
   * 합의(sign-to-his-answers): documentHash=최종 PDF 바이트 SHA-256 hex(64) · externalSignerRef=sub(명의도용 차단).
   * 통합 모델 **병행**(사용자 결정): channel=DIRECT(A·HIS 앱 직접 의료진 서명) | PORTAL(B·sign 포털 deep-link 환자 서명).
   * 비대면 본인확인 **보유 CI 재사용**(사용자 결정): PORTAL 시 Patient.ci(암호화 저장) 복호→sign 전달(PASS 재실행 불요).
   */
  async submitSignRequest(params: {
    issueNo: string; signerUserId: string; consentFormId?: string; documentType?: string;
    channel?: 'DIRECT' | 'PORTAL'; patientId?: string; consentType?: string; inPerson?: boolean;
    supersedesRequestId?: string; // C-2 개정 주도(선택) — 원본 signatureRequestId 지정 시 sign이 개정 봉투 생성
    externalSignerRef?: string;   // e-sign #6 — ERP 계약 발의: 직원이 아닌 계약 ref(erpcontract:medical:<id>). 설정 시 직원 cert 단계 생략.
    signers?: unknown[];          // e-sign #6 — 다중봉투 순차 서명자 목록(ERP 제공·sign 라우팅). 그대로 패스스루.
  }) {
    if ((await this.getMode()) !== 'EXTERNAL') {
      throw new NotImplementedException('sign.mode=SIMULATION — EXTERNAL 제출은 P1 게이트 해제 후 활성');
    }
    const url = String((await this.config.get('sign.url')) ?? '');
    const apiKey = String((await this.config.get('sign.apiKey')) ?? '');
    if (!url || !apiKey) throw new ForbiddenException('sign.url/apiKey 미구성');
    const channel = params.channel ?? 'DIRECT';

    // PORTAL인데 환자 특정 불가면 patientSigner 없이 제출돼 sign측 무명 요청/발급 실패가 됨 — 명시 거부.
    // 다중봉투(signers[])·ERP ref(externalSignerRef) 경로는 서명자 정보가 별도 제공되므로 예외.
    if (channel === 'PORTAL' && !params.patientId && !params.externalSignerRef && !(Array.isArray(params.signers) && params.signers.length)) {
      throw new BadRequestException('PORTAL 서명요청에는 patientId가 필요합니다(patientSigner 구성).');
    }

    // #7 동의서 종류별 requiredIdentityLevel 매핑(sign 확정):
    //  의료진(DIRECT)=STAFF_SSO / 대면 태블릿=INPERSON / 고위험(수술·마취·DNR)=APP_STEPUP(서명직전 PASS) / 일반=PASS(보유 CI 재사용)
    let consentType = params.consentType;
    if (!consentType && params.consentFormId) {
      const cf = await this.prisma.consentForm.findUnique({ where: { id: params.consentFormId }, select: { consentType: true } });
      consentType = cf?.consentType ?? undefined;
    }
    // 폴백은 DEFAULTS 참조 우선(§7 P2 수렴·목 호환 옵셔널). 의사 확약 대상(consent.doctorSignRequiredTypes)과는 별개 정책
    const highRisk = ((await this.config.get('sign.highRiskConsentTypes')) as string[] | null)
      ?? ((this.config.getDefault?.('sign.highRiskConsentTypes') as string[] | null) ?? ['SURGERY', 'ANESTHESIA', 'DNR']);
    const requiredIdentityLevel =
      channel === 'DIRECT' ? 'STAFF_SSO'
        : params.inPerson ? 'INPERSON'
          : consentType && highRisk.includes(consentType) ? 'APP_STEPUP'
            : 'PASS';

    // 합의 #3 — 최종 PDF 바이트 SHA-256 hex(64). (기존 JSON snapshot 해시와 별개)
    const pdf = await this.documents.generatePdf(params.issueNo);
    const documentHash = crypto.createHash('sha256').update(pdf).digest('hex');

    // 다중봉투 signers[] — STAFF 원소는 HIS가 certSerial 내부 주입(#2 (a)). PORTAL 원소는 무변경.
    const preparedSigners = Array.isArray(params.signers) && params.signers.length
      ? await this.prepareSigners(params.signers)
      : params.signers;

    // sign-requests 본문(가이드 §4.2): documentType·documentHash·channel·issueNo·requiredIdentityLevel·externalSignerRef
    const body: Record<string, unknown> = {
      documentType: params.documentType ?? 'CONSENT',
      documentHash,
      issueNo: params.issueNo,
      channel, // DIRECT(의료진 앱직접) | PORTAL(환자 deep-link)
      requiredIdentityLevel,
      externalSignerRef: params.externalSignerRef ?? params.signerUserId, // ERP 계약은 계약 ref override
      ...(preparedSigners ? { signers: preparedSigners } : {}), // 다중봉투 순차(ERP 제공·STAFF certSerial 주입됨)
      ...(params.supersedesRequestId ? { supersedesRequestId: params.supersedesRequestId } : {}), // C-2 개정 주도(선택)
    };

    // STAFF/DIRECT(의료진) — certSerial 필수: enroll-once 보장 후 serial 전달(가이드 §4.2).
    // ERP 계약(externalSignerRef override)은 직원 본인 서명이 아니라 sign 라우팅이라 cert 단계 생략.
    if (channel === 'DIRECT' && !params.externalSignerRef) {
      try {
        const r = await this.ensureStaffCert(params.signerUserId);
        if (r.serialNumber) body.certSerial = r.serialNumber;
      } catch (e) {
        this.logger.warn(`ensureStaffCert 실패 user=${params.signerUserId}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    // PORTAL(환자 deep-link) — patientSigner{name,ci,phone}로 환자 인증서 자동발급(별도 enroll 불요).
    if (channel === 'PORTAL' && params.patientId) {
      const patient = await this.prisma.patient.findUnique({
        where: { id: params.patientId },
        select: { ci: true, phone: true, familyName: true, givenName: true },
      });
      if (patient) {
        // 보유 CI 재사용(AES-256-GCM 복호) — 복호 실패(키 회전·손상)는 500 대신 CI 생략(sign이 PASS로 재확인)
        let ci: string | undefined;
        if (patient.ci) {
          try { ci = decryptField(patient.ci) as string; } catch { this.logger.warn(`patient CI 복호 실패 — CI 없이 제출 patient=${params.patientId}`); }
        }
        body.patientSigner = {
          name: `${patient.familyName ?? ''}${patient.givenName ?? ''}`,
          ci,
          phone: patient.phone ?? undefined,
        };
      }
    }

    const res = await safeFetch(`${url.replace(/\/$/, '')}/sign-requests`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
      body: JSON.stringify(body),
    }, await this.signEgressOpts(url)); // sign은 내부(127.0.0.1) — allowPrivate·독립 allowlist

    if (!res.ok) throw new BadRequestException(`sign 제출 실패: ${res.status}`);
    // 🔴 (2026-10-01 .catch 비리터럴 판정) 종전 `.catch(() => ({}))` — 2xx 인데 본문을 못 읽으면 서명 요청 id 없이 성공처럼 돌아갔다.
    //    요청은 상대에 만들어졌을 수 있는데 HIS 에는 id 가 없어 **완료 webhook 이 영영 매칭되지 않는다**(아래 바인딩 실패와 같은 위험).
    const parsed = await res.json().catch(() => null);
    if (parsed === null || typeof parsed !== 'object') {
      this.logger.error(`sign 제출 응답을 읽지 못함 — 요청은 전송됐을 수 있음(완료 webhook 미매칭 위험) issueNo=${params.issueNo}`);
      throw new BadRequestException('sign 제출 응답을 읽지 못했습니다 — 요청이 전송됐을 수 있으니 서명 시스템에서 확인하세요');
    }
    const j = parsed as {
      data?: {
        signatureRequestId?: string; participantId?: string; portalUrl?: string;
        signers?: Array<{ participantId?: string; signOrder?: number; signerRole?: string; channel?: string; externalSignerRef?: string; portalUrl?: string }>;
      };
    };
    const data = j?.data ?? {}; // 응답 래핑 { data: {...} }
    const { signatureRequestId, participantId, portalUrl } = data;
    const signersRelay = this.normalizeSignersRelay(data.signers);

    /**
     * 🔴 (2026-09-16 K1) 외부 제출은 이미 끝났는데 바인딩이 두 번 나눠 쓰였다 — ConsentForm 바인딩이
     *    실패하면 IssuedDocument 바인딩은 **아예 실행되지 않고**(그 아래 best-effort 라 삼켜지기도 한다),
     *    HIS 에는 `signatureRequestId` 가 없다. 완료 webhook 은 이 id 로 매칭하므로 **서명 완료가 영영
     *    돌아오지 않는다**(대외 발신은 되돌릴 수 없다). 두 바인딩을 한 트랜잭션으로 묶고, 그래도 실패하면
     *    제출 사실과 id 를 남겨 사람이 이을 수 있게 한다.
     */
    if (signatureRequestId) {
      try {
        await this.prisma.$transaction(async (tx) => {
          if (params.consentFormId) {
            await tx.consentForm.update({
              where: { id: params.consentFormId },
              data: { signatureRequestId, signParticipantId: participantId ?? undefined, signStatus: 'REQUESTED', signProvider: 'EXTERNAL' },
            });
          }
          // e-sign #6 — IssuedDocument 에도 바인딩(ConsentForm 없는 ERP 계약 등 비동의 문서의 완료 webhook 매칭용)
          await tx.issuedDocument.updateMany({ where: { issueNo: params.issueNo }, data: { signatureRequestId } });
        });
      } catch (e) {
        this.logger.error(`sign 제출 후 바인딩 실패 — 완료 webhook 미매칭 위험 reqId=${signatureRequestId} issueNo=${params.issueNo} consentFormId=${params.consentFormId ?? '-'}: ${e instanceof Error ? e.message : String(e)}`);
        throw new BadRequestException({
          code: 'SIGN_REQUEST_BINDING_FAILED',
          message: '서명 요청은 제출됐지만 문서 연결에 실패했습니다',
          details: { signatureRequestId, issueNo: params.issueNo },
        });
      }
    }

    this.logger.log(`sign 제출[${channel}/${requiredIdentityLevel}]: issueNo=${params.issueNo} reqId=${signatureRequestId} hash=${documentHash.slice(0, 12)}…${signersRelay ? ` signers=${signersRelay.length}` : ''}`);
    return { signatureRequestId, participantId: participantId ?? null, documentHash, channel, requiredIdentityLevel, portalUrl: portalUrl ?? null, signers: signersRelay };
  }

  /**
   * e-sign #6 다자 봉투(Track 1 중계) — sign 응답 `data.signers[]` 를 ERP relay 형태로 정규화.
   * 매칭 키=**externalSignerRef**(인덱스 의존 금지 · sign이 signOrder로 재정렬 · 완료 webhook
   * `signatures[].externalSignerRef` 와 동일 키). STAFF 원소는 portalUrl 없음(정상·발송 제외).
   * 단일 응답(signers 부재)이면 **null** → 기존 단일 portalUrl 경로 무변경(회귀 0). HIS는 발송 안 함(ERP가 발송).
   */
  private normalizeSignersRelay(
    raw: Array<{ participantId?: string; signOrder?: number; signerRole?: string; channel?: string; externalSignerRef?: string; portalUrl?: string }> | undefined,
  ): Array<{ participantId: string | null; signOrder: number | null; signerRole: string | null; channel: string | null; externalSignerRef: string | null; portalUrl: string | null }> | null {
    if (!Array.isArray(raw)) return null;
    return raw.map((s) => ({
      participantId: s?.participantId ?? null,
      signOrder: typeof s?.signOrder === 'number' ? s.signOrder : null,
      signerRole: s?.signerRole ?? null,
      channel: s?.channel ?? null,
      externalSignerRef: s?.externalSignerRef ?? null,
      portalUrl: s?.portalUrl ?? null,
    }));
  }

  /**
   * #2 다중봉투 STAFF 서명자 certSerial 내부 주입(a) — ERP가 준 signers[] 중 STAFF 원소를
   * HIS User 로 해소해 ensureStaffCert(enroll-once) 후 원소에 certSerial 을 채운다.
   * PORTAL 원소·비객체 원소는 무변경. 해소 실패는 best-effort(경고만, 원소 그대로 통과).
   * STAFF 판정: channel=STAFF | signerType=STAFF | requiredIdentityLevel=STAFF_SSO.
   */
  private async prepareSigners(signers: unknown[]): Promise<unknown[]> {
    const out: unknown[] = [];
    for (const s of signers) {
      if (!s || typeof s !== 'object') { out.push(s); continue; }
      const e: Record<string, unknown> = { ...(s as Record<string, unknown>) };
      const isStaff = e.channel === 'STAFF' || e.signerType === 'STAFF' || e.requiredIdentityLevel === 'STAFF_SSO';
      if (isStaff && !e.certSerial) {
        try {
          const uid = await this.resolveSignerUserId(e);
          if (uid) {
            const r = await this.ensureStaffCert(uid);
            if (r.serialNumber) {
              e.certSerial = r.serialNumber;
              if (!e.externalSignerRef) e.externalSignerRef = uid; // #3 완료 미러 키(externalSignerRef=user.id) 정합
            } else {
              this.logger.warn(`STAFF 서명자 certSerial 미발급 user=${uid}`);
            }
          } else {
            this.logger.warn(`STAFF 서명자 HIS User 미해소 — certSerial 미주입(ref=${String(e.externalSignerRef ?? e.email ?? e.userId ?? '?')})`);
          }
        } catch (err) {
          this.logger.warn(`STAFF 서명자 cert 주입 실패: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      out.push(e);
    }
    return out;
  }

  /**
   * ERP/외부 제공 서명자 원소 → HIS User id 해소. 우선순위:
   *   externalSignerRef=`erp:staff:<empId>`(→ Staff.erpEmployeeCode **또는** employeeNumber) → userId(uuid) → email → `staff:<사번>`/사번(Staff.employeeNumber).
   * 매핑 실패 시 null(상위가 certSerial 미주입·경고). ERP 제안 스키마(erp:staff:<empId>) 그대로 수용.
   */
  private async resolveSignerUserId(entry: Record<string, unknown>): Promise<string | null> {
    const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
    const isUuid = (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
    const byUserId = async (id: string) => (await this.prisma.user.findUnique({ where: { id }, select: { id: true } }).catch(() => null))?.id ?? null;
    const byEmail = async (email: string) => (await this.prisma.user.findUnique({ where: { email }, select: { id: true } }).catch(() => null))?.id ?? null;
    const byStaff = async (where: Prisma.StaffWhereInput): Promise<string | null> =>
      (await this.prisma.staff.findFirst({ where, select: { userId: true } }).catch(() => null))?.userId ?? null;

    // 1) 명시 userId
    const uid = str(entry.userId) ?? str((entry as Record<string, unknown>).staffUserId);
    if (uid && isUuid(uid)) { const r = await byUserId(uid); if (r) return r; }

    // 2) externalSignerRef 파싱
    const ref = str(entry.externalSignerRef);
    if (ref) {
      // erp:staff:<empId> — ERP가 보내는 employee_no는 (1) ERP가 회신한 Staff.erpEmployeeCode 이거나
      // (2) ERP가 디렉터리(GET /integration/hr/staff)에서 당겨간 HIS employeeNumber(사번·공유키)일 수 있음.
      // erpEmployeeCode 미동기(운영상 흔함) 시에도 동작하도록 둘 다 매칭.
      const mErp = ref.match(/^erp:staff:(.+)$/i);
      if (mErp) { const r = await byStaff({ OR: [{ erpEmployeeCode: mErp[1] }, { employeeNumber: mErp[1] }] }); if (r) return r; }
      const mStaff = ref.match(/^staff:(.+)$/i);
      const cand = mStaff ? mStaff[1] : ref;
      if (cand.includes('@')) { const r = await byEmail(cand); if (r) return r; }
      else if (isUuid(cand)) { const r = await byUserId(cand); if (r) return r; }
      else { const r = await byStaff({ OR: [{ erpEmployeeCode: cand }, { employeeNumber: cand }] }); if (r) return r; }
    }

    // 3) email
    const email = str(entry.email);
    if (email && email.includes('@')) { const r = await byEmail(email); if (r) return r; }

    return null;
  }

  /**
   * 제네릭 외부서명 배선 — **문서타입 무관**(동의서·계약서 동일 처리). 발급(IssuedDocument)+서명요청 일괄.
   * issueNo 있으면 그대로, 없으면 documentType+sourceId+snapshot 으로 발급 후 submitSignRequest.
   * 계약서(CONTRACT)·동의서(CONSENT)·기타 모두 같은 issueNo 경로 → 동일 트러스트(sign).
   */
  async requestDocumentSign(params: {
    signerUserId?: string; // ERP 계약 발의는 직원 본인 서명 아님 → 생략 가능(externalSignerRef override 사용)
    issueNo?: string;
    documentType?: string;            // CONSENT | CONTRACT | … (없으면 issueNo 필수)
    sourceId?: string;                // 신규 발급 시 원본 식별
    snapshot?: Record<string, unknown>;
    patientId?: string;
    channel?: 'DIRECT' | 'PORTAL';
    consentFormId?: string;
    consentType?: string;
    inPerson?: boolean;
    externalSignerRef?: string;       // e-sign #6 — ERP 계약 ref override
    signers?: unknown[];              // e-sign #6 — 다중봉투 순차 서명자
  }) {
    if ((await this.getMode()) !== 'EXTERNAL') {
      throw new NotImplementedException('sign.mode=SIMULATION — 외부서명은 EXTERNAL 에서만');
    }
    let issueNo = params.issueNo;
    if (!issueNo) {
      if (!params.documentType || !params.sourceId) {
        throw new BadRequestException('issueNo 또는 documentType+sourceId 가 필요합니다.');
      }
      /**
       * 🔴 (2026-10-12) 동의서 서명 대상은 **서버가 동의서 본문을 동결한 것**이다.
       *    종전엔 화면이 보낸 스냅샷(제목·종류·id 뿐)을 발급하고, 서버 PDF 는 동의서 양식이 없어 "로딩 중…"만 찍혔다 —
       *    그 PDF 의 해시가 서명 대상으로 나갔다(환자가 본문 없는 문서에 서명). 화면이 보낸 스냅샷은 쓰지 않는다.
       */
      if (params.documentType === 'CONSENT') {
        if (!params.consentFormId) throw new BadRequestException({ code: 'SIGN_CONSENT_FORM_REQUIRED', message: '동의서 서명 요청에는 동의서 id 가 필요합니다' });
        if (!this.consentPdf) throw new ServiceUnavailableException({ code: 'SIGN_CONSENT_RENDERER_UNAVAILABLE', message: '동의서 본문 생성기를 쓸 수 없어 서명 요청을 만들지 않습니다' });
        const cf = await this.prisma.consentForm.findUnique({ where: { id: params.consentFormId }, select: { id: true, patientId: true, consentType: true, templateName: true, content: true, risks: true, alternatives: true, explanation: true } });
        if (!cf) throw new BadRequestException({ code: 'SIGN_CONSENT_FORM_NOT_FOUND', message: '동의서를 찾을 수 없습니다' });
        // 🔴 본문이 없는 동의서는 서명 대상이 될 수 없다(서명 화면도 서명 대상 문서도 본문 정본 consentReadableSections 를 쓴다)
        if (!consentReadableSections(cf).hasBody) throw new BadRequestException({ code: 'SIGN_CONSENT_NO_CONTENT', message: '본문이 없는 동의서는 서명 요청을 만들 수 없습니다' });
        params = {
          ...params,
          sourceId: cf.id,
          patientId: cf.patientId ?? params.patientId,
          snapshot: { v: 1, consentFormId: cf.id, consentType: cf.consentType ?? null, title: cf.templateName ?? null, html: await this.consentPdf.generateConsentFormPdf(cf.id, undefined, { forSigning: true }) }, // 출력 시각 없음 — 같은 동의서 = 같은 해시(중복 요청 멱등)
        };
      }
      // 멱등 가드 — 동일 (documentType, sourceId, snapshot 해시)의 ORIGINAL 발급본이 있으면 재사용.
      // 더블클릭/재시도가 IssuedDocument·sign-request 고아를 양산하던 결함 봉합. sign측도 issueNo 멱등이라
      // 같은 issueNo 재제출은 동일 요청/portalUrl을 돌려받는다. 스냅샷이 달라지면(개정) 새로 발급.
      const snapHash = crypto.createHash('sha256').update(JSON.stringify(params.snapshot ?? {})).digest('hex');
      const existing = await this.prisma.issuedDocument.findFirst({
        where: { documentType: params.documentType, sourceId: params.sourceId, status: 'ORIGINAL', hash: snapHash },
        orderBy: { issuedAt: 'desc' },
        select: { issueNo: true },
      });
      if (existing) {
        issueNo = existing.issueNo;
        this.logger.log(`requestDocumentSign 멱등 재사용: ${issueNo} (${params.documentType}/${params.sourceId})`);
      } else {
        const issued = await this.documents.issue(
          { documentType: params.documentType as string, sourceId: params.sourceId as string, patientId: params.patientId, snapshot: params.snapshot ?? {} }, // 위에서 둘 다 확인했다
          params.signerUserId,
        );
        issueNo = issued.issueNo;
      }
    }
    const result = await this.submitSignRequest({
      issueNo,
      signerUserId: params.signerUserId ?? '',
      consentFormId: params.consentFormId,
      documentType: params.documentType,
      channel: params.channel,
      patientId: params.patientId,
      consentType: params.consentType,
      inPerson: params.inPerson,
      externalSignerRef: params.externalSignerRef,
      signers: params.signers,
    });
    return { issueNo, ...result };
  }

  /**
   * e-sign #6 — ERP 의료계약 서명 발의(ERP 주도·키 인증 경로 전용). ERP가 계약 생성 후 호출.
   * documentType=ERP_*, sourceId=ERP 계약 PK(echo), snapshot=구조화 계약 JSON(HIS가 PDF 렌더).
   * externalSignerRef=erpcontract:medical:<sourceId>(직원 본인 서명 아님·sign 라우팅). 완료 시 sign.completed(erpContractId) 자동.
   */
  async originateErpContractSign(params: {
    sourceId: string | number; documentType?: string; snapshot?: Record<string, unknown>;
    channel?: 'DIRECT' | 'PORTAL'; signers?: unknown[];
  }) {
    if (params.sourceId === undefined || params.sourceId === null || String(params.sourceId).trim() === '') {
      throw new BadRequestException('sourceId(ERP 계약 PK) 필수');
    }
    const documentType = params.documentType ?? 'ERP_MEDICAL_CONTRACT';
    if (!documentType.startsWith('ERP_')) throw new BadRequestException('documentType 은 ERP_* 이어야 합니다');
    const sourceId = String(params.sourceId);
    return this.requestDocumentSign({
      documentType,
      sourceId,
      snapshot: params.snapshot ?? {},
      channel: params.channel ?? 'DIRECT',
      externalSignerRef: `erpcontract:medical:${sourceId}`,
      signers: params.signers,
    });
  }

  /**
   * #2 STAFF 인증서 enroll(1회) — sign `POST /v1/certificates/enroll`.
   * ⚠️ sign enroll은 **비멱등**(같은 면허 재호출=새 serial) → HIS가 STAFF당 1회만 호출,
   *    serialNumber 를 user.signCertSerial 에 영속 후 재사용(staff-token sign_cert_serial·PACS SSO).
   * 동시호출 레이스: updateMany(signCertSerial=null) 가드 — 1개만 반영, 나머지는 orphan 경고(sign측 폐기 대상).
   */
  async ensureStaffCert(userId: string): Promise<{ serialNumber: string | null; reused: boolean }> {
    if ((await this.getMode()) !== 'EXTERNAL') {
      throw new NotImplementedException('sign.mode=SIMULATION — enroll 은 EXTERNAL 에서만');
    }
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, signCertSerial: true, familyName: true, givenName: true },
    });
    if (!user) throw new BadRequestException('사용자를 찾을 수 없습니다.');
    if (user.signCertSerial) return { serialNumber: user.signCertSerial, reused: true }; // enroll-once 가드

    const url = String((await this.config.get('sign.url')) ?? '');
    const apiKey = String((await this.config.get('sign.apiKey')) ?? '');
    if (!url || !apiKey) throw new ForbiddenException('sign.url/apiKey 미구성');

    const staff = await this.prisma.staff
      .findUnique({ where: { userId }, select: { employeeNumber: true, licenseNumber: true } })
      .catch(() => null);
    const cn = `${user.familyName ?? ''}${user.givenName ?? ''}` || staff?.employeeNumber || userId;
    // sign enroll 계약(가이드 §4.1): ownerType·subjectDn(DN)·licenseNumber·identity.method·ownerRef(=user.id)
    const body = {
      ownerType: 'STAFF',
      subjectDn: `CN=${cn},O=HospitalRUN,C=KR`,
      licenseNumber: staff?.licenseNumber ?? null,
      identity: { method: 'STAFF_SSO' },
      ownerRef: userId, // webhook externalSignerRef 매핑 키
    };

    const res = await safeFetch(`${url.replace(/\/$/, '')}/certificates/enroll`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
      body: JSON.stringify(body),
    }, await this.signEgressOpts(url));
    if (!res.ok) throw new BadRequestException(`sign enroll 실패: ${res.status}`);
    const j = (await res.json().catch(() => ({}))) as { data?: { serialNumber?: string } };
    const serialNumber = j?.data?.serialNumber; // 응답 래핑 { data: { serialNumber } }
    if (!serialNumber) throw new BadRequestException('sign enroll 응답에 serialNumber 없음');

    // enroll-once 영속(레이스 가드: null 일 때만)
    const upd = await this.prisma.user.updateMany({ where: { id: userId, signCertSerial: null }, data: { signCertSerial: serialNumber } });
    if (upd.count === 0) {
      const cur = await this.prisma.user.findUnique({ where: { id: userId }, select: { signCertSerial: true } });
      this.logger.warn(`sign enroll 레이스 — user=${userId} 기존 serial=${cur?.signCertSerial} 유지, 신규 serial=${serialNumber} orphan(sign 폐기 필요)`);
      return { serialNumber: cur?.signCertSerial ?? null, reused: true };
    }
    this.logger.log(`sign enroll: user=${userId} serial=${serialNumber}`);
    return { serialNumber, reused: false };
  }

  /**
   * 환자 인증서 enroll(1회) — sign `POST /v1/certificates/enroll`(ownerType=PATIENT).
   * 가이드 §4.1: PATIENT 는 identity.method(PASS) 필수 + ci 권장(바인딩). publicKey 불요(키 생성=sign).
   * enroll-once: patient.signCertSerial null 일 때만, serial 영속. (서명 시 facade 자동발급도 가능)
   */
  async ensurePatientCert(patientId: string): Promise<{ serialNumber: string | null; reused: boolean }> {
    if ((await this.getMode()) !== 'EXTERNAL') {
      throw new NotImplementedException('sign.mode=SIMULATION — enroll 은 EXTERNAL 에서만');
    }
    const patient = await this.prisma.patient.findUnique({
      where: { id: patientId },
      select: { id: true, signCertSerial: true, familyName: true, givenName: true, mrn: true, ci: true },
    });
    if (!patient) throw new BadRequestException('환자를 찾을 수 없습니다.');
    if (patient.signCertSerial) return { serialNumber: patient.signCertSerial, reused: true };

    const url = String((await this.config.get('sign.url')) ?? '');
    const apiKey = String((await this.config.get('sign.apiKey')) ?? '');
    if (!url || !apiKey) throw new ForbiddenException('sign.url/apiKey 미구성');

    const cn = `${patient.familyName ?? ''}${patient.givenName ?? ''}` || patient.mrn || patientId;
    const identity: Record<string, unknown> = { method: 'PASS' }; // PATIENT 필수
    if (patient.ci) { try { identity.ci = decryptField(patient.ci); } catch { /* CI 복호 실패 — method 만 */ } }
    const body = {
      ownerType: 'PATIENT',
      subjectDn: `CN=${cn},O=HospitalRUN,C=KR`,
      identity,
      ownerRef: patientId, // EMR ID(webhook externalSignerRef 매핑 키)
    };

    const res = await safeFetch(`${url.replace(/\/$/, '')}/certificates/enroll`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
      body: JSON.stringify(body),
    }, await this.signEgressOpts(url));
    if (!res.ok) throw new BadRequestException(`sign 환자 enroll 실패: ${res.status}`);
    const j = (await res.json().catch(() => ({}))) as { data?: { serialNumber?: string } };
    const serialNumber = j?.data?.serialNumber;
    if (!serialNumber) throw new BadRequestException('sign enroll 응답에 serialNumber 없음');

    const upd = await this.prisma.patient.updateMany({ where: { id: patientId, signCertSerial: null }, data: { signCertSerial: serialNumber } });
    if (upd.count === 0) {
      const cur = await this.prisma.patient.findUnique({ where: { id: patientId }, select: { signCertSerial: true } });
      return { serialNumber: cur?.signCertSerial ?? null, reused: true };
    }
    this.logger.log(`sign 환자 enroll: patient=${patientId} serial=${serialNumber}`);
    return { serialNumber, reused: false };
  }

  /** 포털 계정 보유 환자 일괄 enroll(테스트/셋업) — 미발급자만 sign enroll. */
  async enrollPortalPatients(): Promise<{ total: number; enrolled: number; reused: number; failed: number; results: Array<{ patientId: string; serial?: string | null; reused?: boolean; error?: string }> }> {
    const accounts = await this.prisma.patientAccount.findMany({ select: { patientId: true } });
    const ids = [...new Set(accounts.map((a) => a.patientId).filter((x): x is string => !!x))];
    let enrolled = 0, reused = 0, failed = 0;
    const results: Array<{ patientId: string; serial?: string | null; reused?: boolean; error?: string }> = [];
    for (const pid of ids) {
      try {
        const r = await this.ensurePatientCert(pid);
        if (r.reused) reused++; else enrolled++;
        results.push({ patientId: pid, serial: r.serialNumber, reused: r.reused });
      } catch (e) {
        failed++;
        results.push({ patientId: pid, error: e instanceof Error ? e.message : String(e) });
      }
    }
    this.logger.log(`포털 환자 일괄 enroll: total=${ids.length} enrolled=${enrolled} reused=${reused} failed=${failed}`);
    return { total: ids.length, enrolled, reused, failed, results };
  }

  /** 활성 의료진 sign 인증서 일괄 enroll(미발급자만 — enroll-once 가드). 기본 DOCTOR. */
  async enrollAllStaff(roles: UserRole[] = [UserRole.DOCTOR]): Promise<{ total: number; enrolled: number; reused: number; failed: number; results: Array<{ userId: string; name?: string; serial?: string | null; reused?: boolean; error?: string }> }> {
    const users = await this.prisma.user.findMany({
      where: { role: { in: roles }, isActive: true },
      select: { id: true, familyName: true, givenName: true },
    });
    let enrolled = 0, reused = 0, failed = 0;
    const results: Array<{ userId: string; name?: string; serial?: string | null; reused?: boolean; error?: string }> = [];
    for (const u of users) {
      const name = `${u.familyName ?? ''}${u.givenName ?? ''}`;
      try {
        const r = await this.ensureStaffCert(u.id);
        if (r.reused) reused++; else enrolled++;
        results.push({ userId: u.id, name, serial: r.serialNumber, reused: r.reused });
      } catch (e) {
        failed++;
        results.push({ userId: u.id, name, error: e instanceof Error ? e.message : String(e) });
      }
    }
    this.logger.log(`의료진 일괄 sign enroll: total=${users.length} enrolled=${enrolled} reused=${reused} failed=${failed}`);
    return { total: users.length, enrolled, reused, failed, results };
  }

  /**
   * sign 블록체인 감사 이벤트 봉인(가이드 §6-1) — 의료진 PIN 승인 등 행위를 sign 해시체인에 기록.
   * staff-token(aud=sign) 동봉 시 sign이 JWKS로 의료진 본인 검증 후 신원·인증서 serial 봉인(authMethod:SSO).
   * **best-effort·비차단**: 실패해도 원 승인 흐름 무영향. EXTERNAL + sign 구성 시에만 발화.
   */
  async recordSignAuditEvent(params: {
    userId: string;
    action: string;
    targetType?: string;
    targetRef?: string;
    anchor?: boolean;
    /** 로그 스트림 분리(기본 clinical-events) — 오더는 his-orders 로 따로 쌓는다 */
    stream?: string;
    /** 부가 메타(PHI 원본 금지 — 식별자·코드까지만) */
    data?: Record<string, unknown>;
    actorRole?: string;
    occurredAt?: string;
  }): Promise<SignSealReceipt> {
    try {
      if ((await this.getMode()) !== 'EXTERNAL') return { ok: false, skipped: true, reason: 'sign.mode!=EXTERNAL' };
      const url = String((await this.config.get('sign.url')) ?? '');
      const apiKey = String((await this.config.get('sign.apiKey')) ?? '');
      if (!url || !apiKey) return { ok: false, skipped: true, reason: 'sign.url/apiKey 미설정' };

      // 의료진 본인 SSO 봉인 — staff-token(aud=sign). 실패 시 API_KEY 모드(시스템 주장)로 폴백.
      // 행위자가 시스템(system:*)이면 애초에 발급 대상이 아니므로 시도하지 않는다.
      let staffToken: string | null = null;
      if (!params.userId.startsWith('system:')) {
        try { staffToken = (await this.issueStaffToken(params.userId, 'sign')).token; } catch { staffToken = null; }
      }

      const headers: Record<string, string> = { 'Content-Type': 'application/json', 'x-api-key': apiKey };
      if (staffToken) headers['Authorization'] = `Bearer ${staffToken}`;

      const res = await safeFetch(`${url.replace(/\/$/, '')}/audit-events`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          action: params.action,
          actor: params.userId,
          actorRole: params.actorRole,
          targetType: params.targetType ?? 'TERMINAL_APPROVAL',
          targetRef: params.targetRef,
          stream: params.stream,
          data: params.data,
          occurredAt: params.occurredAt,
          anchor: params.anchor ?? true,
        }),
      }, await this.signEgressOpts(url));
      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        this.logger.warn(`sign audit-event 실패 ${res.status} action=${params.action}`);
        return { ok: false, reason: `HTTP ${res.status} ${detail.slice(0, 200)}` };
      }
      this.logger.log(`sign audit-event 봉인: action=${params.action} actor=${params.userId} (${staffToken ? 'SSO' : 'API_KEY'})`);
      // 인증 영수증 — entryHash/prevHash 가 위변조 탐지의 근거라 호출부가 보관한다.
      const body = (await res.json().catch(() => null)) as { data?: Record<string, unknown> } | null;
      // 🔴 (2026-09-14) 봉인 응답은 2xx 인데 본문을 못 읽으면 영수증(entryHash) 없이 ok 가 나간다 — 그 사실을 남긴다
      if (!body?.data) this.logger.warn(`sign audit-event sealed but receipt body unreadable: action=${params.action}`);
      const d = body?.data ?? {};
      const anchorInfo = d.anchor as { headHash?: string; tsGenTime?: string } | undefined;
      return {
        ok: true,
        entryHash: typeof d.entryHash === 'string' ? d.entryHash : undefined,
        prevHash: typeof d.prevHash === 'string' ? d.prevHash : undefined,
        authMethod: typeof d.authMethod === 'string' ? d.authMethod : undefined,
        anchorHead: anchorInfo?.headHash,
        anchoredAt: anchorInfo?.tsGenTime,
      };
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      this.logger.warn(`sign audit-event 비차단 실패: ${reason}`);
      return { ok: false, reason };
    }
  }

  /** sign 오더 스트림 조회 — 원내 로그와 대조 검증에 쓴다(원장이 정본). */
  async listSignAuditEvents(query: { stream: string; from?: string; to?: string; eventType?: string; q?: string; limit?: number; offset?: number }) {
    if ((await this.getMode()) !== 'EXTERNAL') return null;
    const url = String((await this.config.get('sign.url')) ?? '');
    const apiKey = String((await this.config.get('sign.apiKey')) ?? '');
    if (!url || !apiKey) return null;
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) if (v !== undefined) qs.set(k, String(v));
    const res = await safeFetch(`${url.replace(/\/$/, '')}/audit-events?${qs.toString()}`, {
      headers: { 'x-api-key': apiKey },
    }, await this.signEgressOpts(url));
    if (!res.ok) throw new Error(`sign audit-events 조회 실패 ${res.status}`);
    return (await res.json()) as { data: Array<Record<string, unknown>>; page?: { total: number } };
  }

  /** sign 체인 무결성·앵커 검증 — 위변조 탐지 결과를 그대로 돌려준다. */
  async verifySignAuditChain(stream: string) {
    if ((await this.getMode()) !== 'EXTERNAL') return null;
    const url = String((await this.config.get('sign.url')) ?? '');
    const apiKey = String((await this.config.get('sign.apiKey')) ?? '');
    if (!url || !apiKey) return null;
    const res = await safeFetch(`${url.replace(/\/$/, '')}/audit-events/verify?stream=${encodeURIComponent(stream)}`, {
      headers: { 'x-api-key': apiKey },
    }, await this.signEgressOpts(url));
    if (!res.ok) throw new Error(`sign 체인 검증 실패 ${res.status}`);
    return ((await res.json()) as { data: unknown }).data;
  }

  /** Tier1 데일리 PIN 승인 → sign 블록체인 감사 봉인(비차단). DailyPinGuard 가 발화. */
  @OnEvent('terminal.pin_approved')
  async onPinApproved(p: { userId: string; action: string; targetType?: string; targetRef?: string }): Promise<void> {
    await this.recordSignAuditEvent({ userId: p.userId, action: p.action, targetType: p.targetType, targetRef: p.targetRef, anchor: true });
  }

  /**
   * 수치 정책 변경 봉인(numeric-format-policy.plan.md §3.7) — ui.precision.* 변경을 sign 해시체인에
   * append-only 로 봉인한다. 정책 변경은 청구·임상 표시에 영향하므로 변조 불가 기록으로 남긴다.
   * best-effort(sign 미구성 시 skip) — 원 변경 흐름 무영향.
   */
  @OnEvent('numericPolicy.changed')
  async onNumericPolicyChanged(p: { domain: string; key: string; prevValue: unknown; newValue: unknown; updatedBy?: string }): Promise<void> {
    await this.recordSignAuditEvent({
      userId: p.updatedBy ?? 'system:config',
      action: 'NUMERIC_POLICY_CHANGE',
      targetType: 'numeric-policy',
      targetRef: p.domain,
      anchor: true,
      data: { domain: p.domain, key: p.key, prev: p.prevValue, next: p.newValue },
    });
  }

  /** 현재 서명 모드 — SIMULATION(기본) | EXTERNAL. */
  async getMode(): Promise<'SIMULATION' | 'EXTERNAL'> {
    const mode = String((await this.config.get('sign.mode')) ?? 'SIMULATION').toUpperCase();
    return mode === 'EXTERNAL' ? 'EXTERNAL' : 'SIMULATION';
  }

  /** 연동 상태(콘솔/헬스용) — 모드 + 시크릿 슬롯 구성 여부(값 미노출). */
  async status(): Promise<{ mode: 'SIMULATION' | 'EXTERNAL'; externalReady: boolean; configured: Record<string, boolean> }> {
    const mode = await this.getMode();
    const apiKey = await this.config.get('sign.apiKey');
    const webhookSecret = await this.config.get('sign.webhookSecret');
    const jwksIssuer = await this.config.get('sign.jwksIssuer');
    const signUrl = await this.config.get('sign.url');
    const configured = {
      'sign.url': !!signUrl,
      'sign.apiKey': !!apiKey,
      'sign.webhookSecret': !!webhookSecret,
      'sign.jwksIssuer': !!jwksIssuer,
    };
    const externalReady = mode === 'EXTERNAL' && Object.values(configured).every(Boolean);
    return { mode, externalReady, configured };
  }

  /**
   * 서명요청 생성 — EXTERNAL 스텁(P0). 실 구현은 게이트 해제 후.
   * SIMULATION에서는 기존 내부 서명(document-sign/consent) 흐름을 그대로 사용(이 메서드 미경유).
   */
  async createSignatureRequest(_consentFormId: string): Promise<never> {
    const mode = await this.getMode();
    this.logger.warn(`sign EXTERNAL createSignatureRequest 호출(mode=${mode}) — 스텁(미구현). 공동 게이트 후 활성화.`);
    throw new NotImplementedException({
      error: 'SIGN_EXTERNAL_NOT_READY',
      message: '외부 서명서비스 EXTERNAL 모드는 아직 활성화되지 않았습니다(P0 스캐폴드). SIMULATION을 사용하세요.',
    });
  }

  // ── OIDC(JWKS + 서명 JWT) — sign이 HIS 의료진 신원을 RS256으로 검증 (병행 P0) ──
  // 키 라이프사이클·서명은 KeyCustodyService(keyRef='sign.jwks')에 위임 — HSM 기획 Phase 1.
  // config 키(sign.jwksKid/PrivateSecret/PublicJwk)는 동일 → 기존 생성 키 재사용(무중단).

  private static readonly JWKS_KEYREF = 'sign.jwks';

  /** 공개 JWKS — sign이 HIS 발급 JWT 서명 검증용. (.well-known 대용 공개 EP) */
  async jwks(): Promise<{ keys: Array<Record<string, unknown>> }> {
    return this.keyCustody.publicJwks(SignIntegrationService.JWKS_KEYREF);
  }

  /** 서명 키 무중단 회전(ADMIN) — 새 키 발급+직전 키 JWKS 병행 게시. HSM 기획 Phase 2. */
  async rotateSigningKey() {
    return this.keyCustody.rotateRs256(SignIntegrationService.JWKS_KEYREF);
  }

  /** 회전 윈도우 종료(ADMIN) — 직전 키 JWKS 제거. 구 staff-token(10분) 만료 후 호출. */
  async dropPreviousSigningKey() {
    return this.keyCustody.dropPreviousRs256(SignIntegrationService.JWKS_KEYREF);
  }

  private b64url(buf: Buffer | string): string {
    return Buffer.from(buf).toString('base64url');
  }

  // staff-token 수용 가능한 audience(대상 서비스) allowlist. 기본 'sign'(하위호환).
  //  'pacs' = OpenPACS SSO(PACS가 JWKS로 검증, aud=pacs 만 수용 — 토큰 혼동 방지).
  private static readonly STAFF_TOKEN_AUDIENCES = ['sign', 'pacs', 'edu'] as const;

  /** 의료진 서명 JWT 발급(RS256) — sign/PACS 등 신뢰 서비스가 신원 바인딩에 사용.
   *  audience 로 대상 서비스를 분리(aud claim) — 미지정 시 'sign'(하위호환). */
  async issueStaffToken(userId?: string, audience?: string): Promise<{ token: string; issuer: string; expiresAt: string; kid: string; audience: string }> {
    if (!userId) throw new UnauthorizedException('인증 정보가 없습니다.');
    const aud = audience ?? 'sign';
    if (!(SignIntegrationService.STAFF_TOKEN_AUDIENCES as readonly string[]).includes(aud)) {
      throw new BadRequestException({ error: 'INVALID_AUDIENCE', message: `aud 는 ${SignIntegrationService.STAFF_TOKEN_AUDIENCES.join('|')} 만 허용` });
    }
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, familyName: true, givenName: true, role: true, signCertSerial: true },
    });
    if (!user) throw new UnauthorizedException('사용자를 찾을 수 없습니다.');
    const staff = await this.prisma.staff.findUnique({ where: { userId }, select: { employeeNumber: true } }).catch(() => null);

    return this.signJwt(aud, {
      sub: user.id,
      name: `${user.familyName ?? ''}${user.givenName ?? ''}`,
      role: user.role,
      employee_number: staff?.employeeNumber ?? null,
      sign_cert_serial: user.signCertSerial ?? null,
    });
  }

  /**
   * 🔴 (2026-10-19) 사람이 아닌 HIS 연동 주체의 서명 JWT(aud=pacs) — 환자 포털의 영상 조회·업로드처럼 직원 신원이 없는 호출용.
   *    종전엔 OpenPACS 에 **비밀번호로 로그인하는 서비스 계정**을 썼는데, HIS 운영 설정에 자격이 없어 저장소의 개발 자격으로
   *    버텼고 OpenPACS 재구성 뒤 그 자격이 거부돼 포털 영상 조회가 전부 끊겼다(사용자 신고).
   *    OpenPACS 는 HIS JWKS(RS256 · iss=hospitalrun · aud=pacs)를 이미 믿는다 — 비밀번호 없이 같은 키로 서명한다.
   *    역할은 용도별 최소 권한이다(OpenPACS 역할 표: NURSE→physician 읽기 · LAB_TECH→technologist 업로드).
   *    sub 는 사람 id 와 섞이지 않는 `his-service:<용도>` 이고, OpenPACS 감사에는 그 이름(email 앞부분)으로 남는다.
   */
  static readonly SERVICE_IDENTITIES = {
    'pacs-read': { role: 'NURSE', name: 'HIS 환자 포털 연동(조회)', email: 'his-portal-read@his.local' },
    'pacs-upload': { role: 'LAB_TECH', name: 'HIS 환자 포털 연동(업로드)', email: 'his-portal-upload@his.local' },
  } as const;

  async issueServiceToken(identity: keyof typeof SignIntegrationService.SERVICE_IDENTITIES) {
    const id = SignIntegrationService.SERVICE_IDENTITIES[identity];
    return this.signJwt('pacs', { sub: `his-service:${identity}`, name: id.name, email: id.email, role: id.role, service: true });
  }

  private async signJwt(aud: string, claims: Record<string, unknown>): Promise<{ token: string; issuer: string; expiresAt: string; kid: string; audience: string }> {
    const issuer = String((await this.config.get('sign.jwksIssuer')) ?? 'hospitalrun');
    const kid = await this.keyCustody.kid(SignIntegrationService.JWKS_KEYREF);
    const nowSec = Math.floor(Date.now() / 1000);
    const exp = nowSec + 600; // 10분
    const header = this.b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid }));
    const payload = this.b64url(JSON.stringify({ iss: issuer, aud, ...claims, iat: nowSec, exp }));
    const signingInput = `${header}.${payload}`;
    const sig = this.b64url(await this.keyCustody.signRs256(SignIntegrationService.JWKS_KEYREF, Buffer.from(signingInput)));
    return { token: `${signingInput}.${sig}`, issuer, expiresAt: new Date(exp * 1000).toISOString(), kid, audience: aud };
  }

  // ── Webhook 수신(sign→HIS) — HMAC 검증 + eventId 멱등 + ConsentForm 반영 ──

  /**
   * X-Sign-Signature(HMAC-SHA256 of raw body) 검증. timingSafe.
   * **무중단 시크릿 회전**: 현 시크릿 + 직전 시크릿(`sign.webhookSecretPrev`) 양쪽 수용.
   * 회전 절차: ① HIS new 생성·dual 수용(webhookSecret=new, webhookSecretPrev=old)
   *           ② sign config new로 교체 ③ HIS webhookSecretPrev 폐기.
   */
  async verifyWebhook(rawBody: Buffer | undefined, signature: string | undefined): Promise<boolean> {
    const cur = (await this.config.get('sign.webhookSecret')) as string | undefined;
    const prev = (await this.config.get('sign.webhookSecretPrev')) as string | undefined;
    const secrets = [cur, prev].filter((s): s is string => typeof s === 'string' && s.length > 0);
    if (secrets.length === 0) throw new UnauthorizedException({ error: 'SIGN_WEBHOOK_SECRET_MISSING', message: 'sign.webhookSecret 미구성' });
    if (!rawBody || !signature) return false;
    const a = Buffer.from(signature);
    // 현/직전 시크릿 중 하나라도 일치하면 수용(회전 윈도우 무중단)
    return secrets.some((s) => {
      const b = Buffer.from(crypto.createHmac('sha256', s).update(rawBody).digest('hex'));
      return a.length === b.length && crypto.timingSafeEqual(a, b);
    });
  }

  /**
   * sign 서명 이벤트 반영 — signatureRequestId로 ConsentForm 갱신. eventId 멱등.
   * event: { eventId, type, signatureRequestId, status, signParticipantId?, signCertSerial?, auditCertUri? }
   */
  async handleWebhook(event: SignWebhookEvent): Promise<{ ok: boolean; matched: boolean; idempotent?: boolean }> {
    if (!event?.signatureRequestId) throw new BadRequestException('signatureRequestId 누락');

    // H-1: eventId 멱등 — 동일 eventId 재수신(replay) 차단(SET NX, 7일 보존). eventId 없으면 멱등 보장 불가 경고.
    const key = event.eventId ? `sign:webhook:evt:${event.eventId}` : null;
    if (key) {
      const fresh = await this.redis.set(key, '1', 'EX', 7 * 24 * 3600, 'NX');
      if (fresh === null) {
        this.logger.warn(`sign webhook: 중복 eventId 무시(replay 방지) ${event.eventId}`);
        return { ok: true, matched: true, idempotent: true };
      }
    } else {
      this.logger.warn('sign webhook: eventId 누락 — replay 멱등 보장 불가');
    }

    /**
     * 🔴 (2026-09-17 L1) 멱등 표식을 **DB 반영 전에** 소비하고 있었다. 반영이 실패하면 예외가 나가
     *    sign 이 같은 eventId 로 재전송하는데, 그때는 이 표식에 걸려 `idempotent:true` 로 **ack** 된다 —
     *    서명은 외부에서 완료됐는데 동의서는 영영 이전 상태로 남는다(대외 발신은 되돌릴 수 없다).
     *    실패하면 표식을 되돌려 재전송이 다시 처리되게 한다(성공했을 때만 소비가 유지된다).
     */
    try {
      return await this.applyWebhook(event);
    } catch (e) {
      if (key) {
        try {
          await this.redis.del(key);
        } catch (delErr) {
          // 되돌리기까지 실패하면 재전송이 막힌다 — 조용히 두지 않고 식별자와 함께 남긴다
          // 🔴 로그 문장은 `logger.` 와 **같은 줄**에 둔다(J1·K1 이 같은 자리에서 조립 문장 기준선을 넘겼다)
          this.logger.error(`SIGN_WEBHOOK_IDEMPOTENCY_RELEASE_FAILED eventId=${event.eventId} reqId=${event.signatureRequestId} err=${(delErr as Error).message}`);
        }
      }
      throw e;
    }
  }

  private async applyWebhook(event: SignWebhookEvent): Promise<{ ok: boolean; matched: boolean; idempotent?: boolean }> {
    const form = await this.prisma.consentForm.findFirst({
      where: { signatureRequestId: event.signatureRequestId },
      select: { id: true, signStatus: true, patientId: true, type: true, consentType: true },
    });
    // e-sign #6 — 비동의 문서(ERP 계약 등)도 완료 매칭: signatureRequestId 로 IssuedDocument 역조회.
    const issuedDoc = await this.prisma.issuedDocument.findFirst({
      where: { signatureRequestId: event.signatureRequestId },
      orderBy: { issuedAt: 'desc' },
      select: { issueNo: true, documentType: true, sourceId: true },
    });
    if (!form && !issuedDoc) {
      this.logger.warn(`sign webhook: signatureRequestId 매칭 문서 없음(${event.signatureRequestId})`);
      return { ok: true, matched: false };
    }
    // C-2 동의서 개정(재동의) — request.superseded: 원본을 현행 아님으로 표시 + supersededBy 연결.
    // 원본 서명상태/감사/시리얼은 보존(signStatus 미변경). 종결상태 가드보다 먼저 처리(완료본도 개정 대상). 동의서 전용(ERP 계약 무관).
    if ((event.eventType ?? event.type) === 'request.superseded') {
      if (form) {
        await this.prisma.consentForm.update({
          where: { id: form.id },
          data: { supersededBy: event.supersededBy ?? null, supersededAt: event.occurredAt ? new Date(event.occurredAt) : new Date(), isValid: false },
        });
        this.logger.log(`sign webhook: 동의서 개정(superseded) consent=${form.id} → supersededBy=${event.supersededBy ?? '?'}`);
      }
      return { ok: true, matched: true };
    }
    // eventType→status 파생. sign 실제 키=`eventType`(`type`은 하위호환 폴백).
    // sign은 `signed` 미발행 — 완료=request.completed(sign 회신 확정).
    const TYPE_STATUS: Record<string, string> = {
      'request.completed': 'COMPLETED', // 서명 완료(=최종)
      'request.withdrawn': 'WITHDRAWN',
      'request.expired': 'EXPIRED',
    };
    const evType = event.eventType ?? event.type;
    const status = (evType ? TYPE_STATUS[evType] : undefined) ?? event.status;
    if (!status) {
      this.logger.warn(`sign webhook: status/type 미상(type=${event.type}) — 무시`);
      return { ok: true, matched: true };
    }
    // ── ConsentForm 반영(동의서일 때만) — ERP 계약 등 비동의 문서는 form=null 이라 건너뜀 ──
    if (form && form.signStatus !== status) {
      // H-1: 상태 전이 가드 — 종결 상태(COMPLETED/WITHDRAWN/EXPIRED/REJECTED)는 비가역(역행 덮어쓰기 차단)
      const TERMINAL = ['COMPLETED', 'WITHDRAWN', 'EXPIRED', 'REJECTED'];
      if (form.signStatus && TERMINAL.includes(form.signStatus)) {
        this.logger.warn(`sign webhook: 종결상태(${form.signStatus}) 역행 차단(→${status}) consent=${form.id}`);
        return { ok: true, matched: true, idempotent: true };
      }
      await this.prisma.consentForm.update({
        where: { id: form.id },
        data: {
          signStatus: status,
          signParticipantId: event.signParticipantId ?? undefined,
          signCertSerial: event.signCertSerial ?? event.signCertSerials?.[0] ?? undefined, // 단일 또는 배열 첫 시리얼
          auditCertUri: event.auditCertUri ?? undefined,
          // HSM Phase 4 — sign 키 수탁 attestation 기록(있을 때만). 미수신 시 기존값 유지.
          signKeyCustody: event.keyCustody ?? undefined,
          signAssuranceLevel: event.assuranceLevel ?? undefined, // 봉인 판정 권위 필드(HSM_ANCHORED 등)
          signAttestationRef: event.signAttestationRef ?? undefined,
          signTsaToken: event.tsaToken ?? undefined,
        },
      });
      // #3 서명자별 발급 serial 미러 — 직원(externalSignerRef=user.id)은 user.signCertSerial 에 영속(enroll-once 백스톱).
      //  환자(signerRole=PATIENT)는 consentForm.signCertSerial 이 이미 위에서 반영됨(개별 매핑 생략).
      for (const sig of event.signatures ?? []) {
        const ref = sig.externalSignerRef;
        const serial = sig.certSerial ?? sig.serialNumber ?? sig.signCertSerial; // 가이드 §5: certSerial
        if (!ref || !serial) continue;
        const isPatient = (sig.signerRole ?? '').toUpperCase() === 'PATIENT' || (sig.signerType ?? '').toUpperCase() === 'PATIENT';
        if (isPatient) {
          // 환자: patient.signCertSerial 미러(null 일 때만). consentForm.signCertSerial 은 위에서 별도 반영.
          const updP = await this.prisma.patient.updateMany({ where: { id: ref, signCertSerial: null }, data: { signCertSerial: serial } });
          if (updP.count > 0) this.logger.log(`sign webhook serial 미러(환자): patient=${ref} serial=${serial}`);
          continue;
        }
        // 직원: null 일 때만 기록(enroll 이 채웠으면 유지·idempotent). ref 미매칭 user면 count=0(무영향).
        const upd = await this.prisma.user.updateMany({ where: { id: ref, signCertSerial: null }, data: { signCertSerial: serial } });
        if (upd.count > 0) this.logger.log(`sign webhook serial 미러: user=${ref} serial=${serial} (role=${sig.signerRole ?? '-'})`);
      }
      this.logger.log(`sign webhook 반영: consent=${form.id} status=${status} eventType=${evType ?? '-'} (event=${event.eventId})`);
    }

    // ERP e-sign #6 — 완료 시 `sign.completed` ERP 인박스 통지(동의서/ERP 계약 공통·완료본 URL+토큰 동봉).
    // outbox 가 erp.webhookEnabled 게이팅·전송보장·(domain,ref) 멱등. 실패해도 webhook ack 유지(best-effort).
    if (status === 'COMPLETED') {
      await this.emitSignCompleted(event, issuedDoc, form);
    }
    return { ok: true, matched: true };
  }

  /** sign.completed ERP 발행 — 동의서/ERP 계약 공통. ERP 계약(documentType ERP_*)은 erpContractId(=sourceId) 동봉(미러 매핑키). */
  private async emitSignCompleted(
    event: { signatureRequestId?: string; occurredAt?: string; signCertSerial?: string; signCertSerials?: string[]; auditCertUri?: string; assuranceLevel?: string; tsaToken?: string },
    issuedDoc: { issueNo: string; documentType: string; sourceId: string } | null,
    form: { id: string; patientId: string; type: string; consentType: string | null } | null,
  ): Promise<void> {
    try {
      const documentType = issuedDoc?.documentType ?? form?.consentType ?? form?.type ?? null;
      const isErpContract = typeof documentType === 'string' && documentType.startsWith('ERP_');
      const erpContractId = isErpContract ? (issuedDoc?.sourceId ?? null) : null;
      const document = issuedDoc?.issueNo
        ? { issueNo: issuedDoc.issueNo, contentType: 'application/pdf', ...this.documents.downloadUrl(issuedDoc.issueNo) }
        : null;
      await this.outbox.enqueue('sign', 'sign.completed', `signcomplete:${event.signatureRequestId}`, {
        signatureRequestId: event.signatureRequestId,
        consentFormId: form?.id ?? null,
        erpContractId, // ERP 미러 매핑키(ERP 계약일 때만)
        externalSignerRef: erpContractId ? `erpcontract:medical:${erpContractId}` : null, // ERP 제안 컨벤션 병행 제공
        patientId: form?.patientId ?? null,
        documentType,
        status: 'COMPLETED',
        completedAt: event.occurredAt ?? new Date().toISOString(),
        certSerial: event.signCertSerial ?? event.signCertSerials?.[0] ?? null, // 블록체인 앵커 증적
        auditCertUri: event.auditCertUri ?? null,
        assuranceLevel: event.assuranceLevel ?? null, // HSM_ANCHORED 등 봉인 판정
        tsaToken: event.tsaToken ?? null,
        ...(document ? { document } : {}), // 완료본 Attachment(없으면 생략 → ERP는 auditCertUri로 회수)
      });
      this.logger.log(`sign.completed ERP 발행: reqId=${event.signatureRequestId} issueNo=${issuedDoc?.issueNo ?? '-'} erpContractId=${erpContractId ?? '-'}`);
    } catch (e) {
      this.logger.warn(`sign.completed 발행 실패(무시): ${(e as Error).message}`);
    }
  }
}
