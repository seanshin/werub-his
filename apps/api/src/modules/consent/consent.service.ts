import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, NotImplementedException, Optional } from '@nestjs/common';
import { consentTypeText } from '@hospital-run/shared';
import { randomBytes, createHash } from 'crypto';
import { Subject, Observable } from 'rxjs';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ConsentStatus, Prisma, ConsentType } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { MedicalAiService } from '../medical-ai/medical-ai.service';
import { ConsentNotFoundError, ConsentAlreadySignedError, ConsentAlreadyRevokedError } from '../../domain/errors/domain-error';
import { assertEnumParam } from '../../common/enum-param';
import { verifyDocumentSignature } from '../../common/util/signature-verify';
import { certificateOwnershipProblem, alignDocumentHashToFirstSignature } from '../../common/util/blockchain-signature';
import { signedContentHash } from '../document-sign/document-content-hash';
import { AiProposalService } from '../ai-proposal/ai-proposal.service';
import { RegistrationConsentService, CONSENT_TYPES as REGISTRATION_CONSENT_TYPES } from '../registration-consent/registration-consent.service';
import { CONSENT_DETAILS as REGISTRATION_CONSENT_DETAILS } from '../registration-consent/consent-details';

/** 초진 등록 동의 묶음 — ConsentForm.type(2026-10-02) */
export const REGISTRATION_BUNDLE_TYPE = 'REGISTRATION';
/** 첨부 항목 표식 — 이 스캔본이 환자 종이 서명의 증거다(A1 · 지울 수 없다) */
export const PAPER_SIGNATURE_EVIDENCE = 'PATIENT_SIGNATURE_PAPER';
/** 서명 세션 유효 시간 — 대면(태블릿·PC) 5분 · 환자 휴대폰 링크 15분(QR 을 찍고 읽고 서명할 시간) */
const SIGN_SESSION_TTL_MIN: Record<string, number> = { MOBILE: 15 };
import { deriveSurgeryConsentStatus, SURGERY_CONSENT_TYPES, DEFAULT_CONSENT_WINDOW_DAYS } from './surgery-consent-status';

// 라벨 정본은 shared `CONSENT_TYPE_LABEL` — 로컬 재정의 금지(화면과 갈라졌던 이력)

/**
 * 동의서 AI 생성 프롬프트 버전 — 제안 원장(`AiProposal.promptVersion`)이 읽는 상수.
 * 🔴 프롬프트 문안을 고치면 이 값도 올린다. 안 올리면 감독 지표가 서로 다른 프롬프트의 결과를 한 덩어리로 센다.
 */
export const CONSENT_AI_PROMPT_VERSION = 'consent-generate-v1';

/**
 * 동의서 초안 본문 = 위험·대안·설명을 **고정 순서·고정 구분자**로 이은 것.
 *
 * 🔴 이 규칙은 FE(`app/(main)/workstation/consent/page.tsx` `consentDraftText`)와 **한 벌**이다.
 *    한쪽만 바꾸면 편집거리(수정량)가 사람이 고치지 않은 만큼 부풀려진다(P11 — FE↔서버 계약 불일치).
 * 🔴 비어 있는 항목도 자리를 지킨다(`filter(Boolean)` 금지) — 안 그러면 같은 글이 양쪽에서 다르게 이어진다.
 */
export function consentDraftText(s: { risks?: string | null; alternatives?: string | null; explanation?: string | null }): string {
  return [s.risks ?? '', s.alternatives ?? '', s.explanation ?? ''].join('\n\n');
}

/**
 * 상류(WeRU.B)가 **실제로 돌려준** 모델 태그만 꺼낸다 — 없으면 `null`(지어내지 않는다).
 * 스키마 `model_ref` 는 VarChar(64) 라 앞 64자만.
 *
 * 🔴 같은 규칙이 `scribe.service.ts pickAiModelName`·`nursing.service.ts pickUpstreamModelTag` 에도 있다.
 *    서비스 파일을 서로 import 하면 모듈이 통째로 딸려오므로(순환 의존 위험) 여기서는 복제한다 —
 *    공용 유틸로의 수렴은 이 축의 소유 밖이라 이연한다.
 */
export function pickUpstreamModelTag(raw: unknown): string | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const v = o.model_used ?? o.model;
  if (typeof v !== 'string') return null;
  const s = v.trim();
  return s ? s.slice(0, 64) : null;
}

// 서명 요구사항 매핑
const SIGN_REQUIREMENTS: Record<string, string[]> = {
  SURGERY: ['PATIENT', 'DOCTOR', 'WITNESS'],
  ANESTHESIA: ['PATIENT', 'DOCTOR'],
  PROCEDURE: ['PATIENT', 'DOCTOR'],
  TRANSFUSION: ['PATIENT', 'NURSE'],
  RESEARCH: ['PATIENT', 'DOCTOR', 'WITNESS'],
  DNR: ['PATIENT', 'DOCTOR', 'WITNESS'],
  TREATMENT: ['PATIENT'],
  GENERAL: ['PATIENT'],
  // 진료 녹음·AI 문서화 — 법무 초안 A-2(검토 전)의 서명란은 환자(대리 시 보호자)뿐이다. 기본값과 같지만 명시해 둔다(누락≠결정).
  RECORDING: ['PATIENT'],
};

@Injectable()
export class ConsentService {
  private readonly logger = new Logger(ConsentService.name);
  // 동의서 워크스테이션 실시간 스트림 (SSE)
  private readonly wsStream = new Subject<{ data: { type: string; consentId?: string } }>();

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly eventEmitter?: EventEmitter2,
    @Optional() private readonly medicalAi?: MedicalAiService,
    /** AI 제안 원장(기획서 §2.1) — 미주입이면 초안은 나가되 `proposalId:null` 로 그 사실을 말한다 */
    @Optional() private readonly aiProposal?: AiProposalService,
    /** 초진 동의 묶음 서명 → 등록 동의 원장(10종) — 미주입이면 묶음 서명을 **받지 않는다**(기록 없는 서명 완료를 만들지 않는다) */
    @Optional() private readonly registration?: RegistrationConsentService,
  ) {}

  /**
   * AI 동의서 내용 생성 — 시술/유형 기반 위험·대안·설명 자동 작성.
   * 🔴 생성 결과는 **제안(review-pending)** 이지 정본이 아니다. 동의서 행은 사람이 저장할 때 만들어진다.
   */
  async aiGenerate(data: { consentType?: string; procedureName: string; patientId?: string }, actorId?: string | null) {
    if (!this.medicalAi) throw new BadRequestException('AI 서비스를 사용할 수 없습니다');
    // 프롬프트 인젝션 완화 — 제어문자·줄바꿈 제거 + 길이 제한(M-2)
    const procedure = (data.procedureName ?? '').replace(/[\r\n\t]+/g, ' ').replace(/[<>[\]{}]/g, '').trim().slice(0, 200);
    if (!procedure) throw new BadRequestException('시술/수술명이 필요합니다');

    const typeLabel = consentTypeText(data.consentType ?? 'GENERAL');

    const prompt = `당신은 한국 대학병원의 의료진입니다. 아래 ${typeLabel} 동의서 작성을 돕습니다.
대상: ${procedure}

다음 세 항목을 한국어로, 환자가 이해하기 쉽고 의학적으로 정확하게 작성하세요.
각 항목은 반드시 지정된 머리말로 시작하고, 항목 사이에 빈 줄을 넣으세요. 표나 마크다운 기호는 쓰지 마세요.

[위험]
(이 ${typeLabel}의 주요 위험과 합병증을 항목별로)

[대안]
(대체 가능한 치료법 또는 시행하지 않을 경우의 경과)

[설명]
(목적·방법·예상 효과를 환자에게 설명하는 요지)`;

    let text = '';
    let upstream: unknown = null;
    try {
      const res = await this.medicalAi.enhancedChat(prompt, 'medical');
      upstream = res;
      text = ((res?.answer ?? res?.response ?? '') as string).trim();
    } catch {
      throw new BadRequestException('AI 생성에 실패했습니다. 잠시 후 다시 시도하세요.');
    }
    const sections = this.parseConsentSections(text);
    const proposalId = await this.createConsentProposal({
      consentType: data.consentType ?? 'GENERAL',
      procedure,
      patientId: data.patientId ?? null,
      sections,
      // 🔴 상류가 실제로 돌려준 모델 태그만(`enhancedChat` 은 `model_used` 를 준다). 없으면 null.
      modelRef: pickUpstreamModelTag(upstream),
      actorId: actorId ?? null,
    });
    // 🔴 `proposalId: null` 은 "제안 원장에 남지 않았다"는 사실이다 — 화면은 이 값이 있을 때만 노출·결정을 보고한다
    return { ...sections, proposalId };
  }

  /**
   * 동의서 초안 제안 생성 — 🔴 실패해도 초안은 그대로 나간다(원장 실패로 진료를 세우지 않는다).
   *
   * 🔴 대상(`ConsentForm`)이 **아직 없다.** 생성 시점에 존재하지 않는 행의 id 를 지어내지 않고
   *    `targetKey` 로 "무엇에 대한 초안인지"만 밝힌다. 어느 동의서가 됐는지는 결정 전이의
   *    `clientContext`(FE 가 `consent-form:<id>` 로 보고)에 남는다.
   */
  private async createConsentProposal(input: {
    consentType: string;
    procedure: string;
    patientId: string | null;
    sections: { risks: string; alternatives: string; explanation: string };
    modelRef: string | null;
    actorId: string | null;
  }): Promise<string | null> {
    if (!this.aiProposal) {
      this.logger.warn('동의서 초안 제안 미기록 — AiProposalService 미주입');
      return null;
    }
    const content = consentDraftText(input.sections);
    // 빈 초안은 제안이 아니다 — 원장에 빈 행을 만들어 "AI 가 초안을 냈다"고 세게 하지 않는다
    if (!content.trim()) return null;
    const inputSnapshotHash = createHash('sha256')
      .update(JSON.stringify({ consentType: input.consentType, procedure: input.procedure, patientId: input.patientId }), 'utf8')
      .digest('hex');
    try {
      const proposal = await this.aiProposal.create({
        kind: 'CONSENT_DRAFT',
        targetType: 'ConsentForm',
        targetKey: `pending:${input.consentType}:${input.procedure}`.slice(0, 120), // 스키마 VarChar(120)
        patientId: input.patientId,
        content,
        modelRef: input.modelRef,
        promptVersion: CONSENT_AI_PROMPT_VERSION,
        inputSnapshotHash,
        // 🔴 상류가 신뢰도를 보고하지 않는다(`enhancedChat`) → 생략(0.7 같은 기본값 금지)
        source: 'AI',
        createdBy: input.actorId,
      });
      return proposal.id;
    } catch (e) {
      this.logger.warn(`동의서 초안 제안 생성 실패(초안은 그대로 반환): ${e instanceof Error ? e.message : String(e)}`);
      return null;
    }
  }

  private parseConsentSections(text: string) {
    const grab = (label: string, next: string[]) => {
      const re = new RegExp(`\\[${label}\\]([\\s\\S]*?)(?=${next.map((n) => `\\[${n}\\]`).join('|') || '$'}|$)`, 'i');
      const m = text.match(re);
      return m ? m[1].replace(/^[\s:·\-]+/, '').trim() : '';
    };
    const risks = grab('위험', ['대안', '설명']);
    const alternatives = grab('대안', ['설명']);
    const explanation = grab('설명', []);
    // 파싱 실패 시 전체를 설명에 넣음
    if (!risks && !alternatives && !explanation) return { risks: '', alternatives: '', explanation: text };
    return { risks, alternatives, explanation };
  }

  getWorkstationStream(): Observable<{ data: { type: string; consentId?: string } }> {
    return this.wsStream.asObservable();
  }
  private emitWs(type: string, consentId?: string) {
    try { this.wsStream.next({ data: { type, consentId } }); } catch { /* noop */ }
  }
  /** 기기 모듈 등 외부에서 워크스테이션 SSE를 깨우기 위한 공개 핸들 */
  emitWorkstation(type: string, consentId?: string) { this.emitWs(type, consentId); }

  /** 필수 서명자(역할)가 모두 서명되었는지 — 순서 무관 (의료법 §24-2: 순서 강제 없음) */
  private requiredRolesSigned(c: { consentType: ConsentType | null; patientSignedAt: Date | null; doctorSignedAt: Date | null; witnessSignedAt: Date | null; nurseCheckedAt: Date | null }): boolean {
    const req = SIGN_REQUIREMENTS[(c.consentType as string) ?? 'GENERAL'] ?? ['PATIENT'];
    return req.every((role) => {
      if (role === 'PATIENT') return !!c.patientSignedAt;
      if (role === 'DOCTOR') return !!c.doctorSignedAt;
      if (role === 'WITNESS') return !!c.witnessSignedAt;
      if (role === 'NURSE') return !!c.nurseCheckedAt || !!c.witnessSignedAt;
      return true;
    });
  }

  /** 모든 필수 서명 완료 시 SIGNED 확정 (어느 순서든) */
  private async finalizeIfComplete(id: string, signedBy?: string) {
    const c = await this.prisma.consentForm.findUnique({ where: { id } });
    if (!c || c.status === 'SIGNED') return null;
    if (!this.requiredRolesSigned(c)) return null;
    const r = await this.prisma.consentForm.update({
      where: { id },
      data: { status: 'SIGNED', signedAt: new Date(), signedBy: signedBy ?? c.patientSignedBy ?? c.doctorId ?? undefined, isValid: true },
      include: this.defaultInclude(),
    });
    this.eventEmitter?.emit('consent.completed', { consentId: id, patientId: c.patientId });
    this.emitWs('completed', id);
    return r;
  }

  /** 간호사 사전 확인 (의료진 사전 체크) */
  async nurseCheck(id: string, nurseId: string) {
    const consent = await this.prisma.consentForm.findUnique({ where: { id } });
    if (!consent) throw new ConsentNotFoundError(id);
    const img = await this.staffSignatureImage(nurseId);
    await this.prisma.consentForm.update({ where: { id }, data: { nurseId, nurseCheckedAt: new Date(), nurseCheckedBy: nurseId, nurseSignatureImage: img } });
    await this.anchorConsentSignature(id, consent.patientId, 'NURSE', nurseId);
    this.emitWs('nurse_checked', id);
    return (await this.finalizeIfComplete(id, nurseId)) ?? this.findById(id);
  }

  /** 직원 등록 서명 이미지 조회 */
  private async staffSignatureImage(userId: string): Promise<string | undefined> {
    const u = await this.prisma.user.findUnique({ where: { id: userId }, select: { signatureImage: true } }).catch(() => null);
    return u?.signatureImage ?? undefined;
  }

  /**
   * 동의서 서명을 블록체인(내부 체인)에 기록 — SignedDocument + DocumentSignature(인증서 있을 때) + BlockchainAnchor.
   * 모든 서명자 이벤트마다 호출. 해시는 SHA-256, txHash는 내부 발급(기존 internal 앵커 방식과 일치).
   */
  private async anchorConsentSignature(consentId: string, patientId: string | null, role: 'PATIENT' | 'DOCTOR' | 'NURSE' | 'WITNESS', signerUserId?: string, signerPatientId?: string) {
    try {
      const ts = new Date();
      // 🔴 (2026-10-13 결함 발굴 B3) 종전 앵커는 `누가·언제`만 해시했다 — 환자가 본 문안(위험·대안·설명)이 앵커에 없었다.
      //    동의서 **내용 해시**(전자서명과 같은 서버 정본 · A2)를 서명 사건에 묶는다. 서명 문서의 해시도 그 내용 해시로 시작한다.
      const content = await signedContentHash(this.prisma, 'CONSENT', consentId);
      if (!content) throw new Error(`CONSENT_CONTENT_NOT_FOUND ${consentId}`);
      const payload = `CONSENT|${consentId}|${role}|${signerUserId ?? signerPatientId ?? '-'}|${ts.toISOString()}|content=${content.hash}`;
      const hash = createHash('sha256').update(payload).digest('hex');
      const txHash = `internal-${randomBytes(16).toString('hex')}`;

      // 문서 단위 서명 기록(동의서당 1개)
      const reqSigners = await this.prisma.consentForm.findUnique({ where: { id: consentId }, select: { consentType: true } });
      const required = (SIGN_REQUIREMENTS[(reqSigners?.consentType as string) ?? 'GENERAL'] ?? ['PATIENT']).length;
      /**
       * 🔴 (2026-09-16 K1) 서명 카운트 증가·완료 전이·앵커 기록이 따로 커밋됐다 — 증가만 커밋되고
       *    앵커가 실패하면 **그 서명 이벤트의 원장만 영영 없다**(카운트는 이미 올라가 재시도해도 다시 세지 않는다).
       *    셋은 한 사건의 원장이다 — 한 트랜잭션으로 묶는다(전체가 비차단인 것은 종전과 같다).
       */
      await this.prisma.$transaction(async (tx) => {
        let doc = await tx.signedDocument.findFirst({ where: { documentType: 'CONSENT', documentId: consentId } });
        if (!doc) {
          doc = await tx.signedDocument.create({ data: { documentType: 'CONSENT', documentId: consentId, patientId: patientId ?? undefined, documentHash: content.hash, requiredSigners: required, completedSigners: 0, status: 'PENDING' } });
        }
        // 원자적 증가(동시 서명 경쟁조건 방지, M-3)
        const updated = await tx.signedDocument.update({
          where: { id: doc.id },
          data: { completedSigners: { increment: 1 } },
        });
        const allDone = updated.completedSigners >= updated.requiredSigners;
        if (allDone && updated.status !== 'COMPLETED') {
          await tx.signedDocument.update({
            where: { id: doc.id },
            data: { status: 'COMPLETED', merkleRoot: hash, blockchainTxId: txHash, blockchainAnchoredAt: ts },
          });
        }

        // 블록체인 앵커(서명 이벤트 단위)
        await tx.blockchainAnchor.create({
          data: { anchorType: 'CONSENT_SIGNATURE', referenceId: consentId, dataHash: hash, chainType: 'internal', txHash, status: 'ANCHORED', anchoredAt: ts },
        });
      });
    } catch (e) {
      console.error('Consent blockchain anchor failed (non-blocking):', e);
    }
  }

  /** 동의서 블록체인/서명 기록 조회 */
  async getConsentBlockchainLog(consentId: string) {
    const doc = await this.prisma.signedDocument.findFirst({
      where: { documentType: 'CONSENT', documentId: consentId },
      include: { signatures: { orderBy: { signedAt: 'asc' } } },
    });
    const anchors = await this.prisma.blockchainAnchor.findMany({ where: { anchorType: 'CONSENT_SIGNATURE', referenceId: consentId }, orderBy: { createdAt: 'asc' } });
    return { document: doc, anchors };
  }

  /**
   * 수술 전 필수 동의서(수술·마취·수혈) 상태 — 규칙은 `surgery-consent-status.ts` 머리 주석이 정본.
   * 🔴 조회 실패를 "없음"으로 바꾸지 않는다(예외는 그대로 전파 → 화면이 '조회 실패').
   */
  async getSurgeryConsentStatus(q: { patientId: string; surgeryId?: string; windowDays?: number }) {
    const windowDays = Math.min(Math.max(Math.trunc(q.windowDays ?? DEFAULT_CONSENT_WINDOW_DAYS), 1), 365);
    const now = new Date();
    const since = new Date(now.getTime() - windowDays * 86400000);
    const orConds: Prisma.ConsentFormWhereInput[] = [{ createdAt: { gte: since } }];
    if (q.surgeryId) orConds.push({ surgeryId: q.surgeryId });
    const rows = await this.prisma.consentForm.findMany({
      where: { patientId: q.patientId, consentType: { in: [...SURGERY_CONSENT_TYPES] }, OR: orConds },
      orderBy: { createdAt: 'desc' },
      take: 200,
      select: {
        id: true, consentType: true, status: true, signedAt: true, surgeryId: true, createdAt: true,
        isValid: true, revokedAt: true, supersededAt: true, expiresAt: true,
      },
    });
    return {
      rule: q.surgeryId ? 'SURGERY_ID_THEN_PATIENT_WINDOW' : 'PATIENT_WINDOW',
      windowDays,
      since,
      items: deriveSurgeryConsentStatus(rows, { surgeryId: q.surgeryId ?? null, since, now }),
    };
  }

  async create(data: {
    patientId: string;
    type: string;
    templateName: string;
    content: any;
    witnessId?: string;
    templateId?: string;
    consentType?: ConsentType;
    encounterId?: string;
    surgeryId?: string;
    risks?: string;
    alternatives?: string;
    doctorId?: string;
    nurseId?: string;
    requestedBy?: string;
    explanation?: string;
  }) {
    const consent = await this.prisma.consentForm.create({
      data: {
        patientId: data.patientId,
        type: data.type,
        templateName: data.templateName,
        content: data.content as unknown as Prisma.InputJsonValue,
        witnessId: data.witnessId,
        templateId: data.templateId,
        consentType: data.consentType,
        encounterId: data.encounterId,
        surgeryId: data.surgeryId,
        risks: data.risks,
        alternatives: data.alternatives,
        doctorId: data.doctorId,
        nurseId: data.nurseId,
        requestedBy: data.requestedBy,
        explanation: data.explanation,
        status: 'PENDING',
      },
      include: this.defaultInclude(),
    });

    // 이벤트 발행 → 환자 알림 + 여정 이벤트
    this.eventEmitter?.emit('consent.created', {
      consentId: consent.id,
      patientId: data.patientId,
      doctorId: data.doctorId,
      consentType: data.consentType ?? data.type,
      templateName: data.templateName,
    });
    this.emitWs('created', consent.id);

    return consent;
  }

  /**
   * @param actor 호출한 로그인 직원 — 🔴 (M1) 전자서명의 직원 서명자는 **본문이 아니라 여기서** 온다.
   *   종전엔 `signerUserId ?? cert.userId` 로 기록해, 직원이 남의 인증서 id 를 넘기면 서명이 **인증서 주인 이름**으로 남았다.
   */
  async sign(id: string, data: {
    patientSignature?: string;
    patientSignedBy?: string;
    /** PAD(기본) = 서명패드 이미지 필수 · PAPER = 종이에 받은 서명 — 스캔본 첨부(인덱스) 필수 */
    signMode?: 'PAD' | 'PAPER';
    paperScanIndex?: number;
    signerType?: 'STAFF' | 'PATIENT';
    blockchainSignature?: {
      certificateId: string;
      signatureValue: string;
      signatureAlgorithm: string;
      documentHash: string;
    };
  }, actor?: { userId?: string | null }) {
    const consent = await this.prisma.consentForm.findUnique({ where: { id } });
    if (!consent) throw new ConsentNotFoundError(id);
    if (consent.status === 'SIGNED') throw new ConsentAlreadySignedError();

    const reqSigners = SIGN_REQUIREMENTS[consent.consentType ?? 'GENERAL'] ?? ['PATIENT'];
    const needsMoreSigners = reqSigners.length > 1;

    // 🔴 (2026-10-13 결함 발굴 A1) 종전엔 직원이 이름 하나(prompt)만 넣어도 patientSignedAt 이 찍혀
    //    SIGNED·isValid:true 가 됐다 — 환자가 서명했다는 증거가 하나도 없는 "서명 완료" 동의서.
    //    이제 환자 서명의 증거를 요구한다: 서명패드 이미지(태블릿 경로와 같은 검사) 또는 종이 서명 스캔본.
    const signedBy = typeof data.patientSignedBy === 'string' ? data.patientSignedBy.trim() : '';
    if (!signedBy) throw new BadRequestException({ code: 'CONSENT_SIGNER_REQUIRED', message: '서명한 사람(환자 또는 대리인) 이름이 필요합니다' });
    const evidence = await this.patientSignatureEvidence(consent, data);

    // 환자 서명만 기록 — 완결 여부는 모든 필수 서명자 기준으로 finalize (순서 무관)
    await this.prisma.consentForm.update({
      where: { id },
      data: {
        patientSignature: evidence.patientSignature,
        patientSignedAt: new Date(),
        patientSignedBy: signedBy,
        signMode: evidence.signMode,
        ...(evidence.attachments ? { attachments: evidence.attachments } : {}),
      },
    });
    await this.anchorConsentSignature(id, consent.patientId, 'PATIENT', undefined, consent.patientId);
    const result = (await this.finalizeIfComplete(id, signedBy)) ?? (await this.prisma.consentForm.findUnique({ where: { id }, include: this.defaultInclude() }))!;

    // 이벤트 발행 → 의사에게 알림
    this.eventEmitter?.emit('consent.patient_signed', {
      consentId: id,
      patientId: consent.patientId,
      doctorId: consent.doctorId,
      needsMoreSigners,
    });

    // Blockchain signature (non-blocking)
    if (data.blockchainSignature) {
      try {
        const cert = await this.prisma.blockchainCertificate.findUnique({
          where: { id: data.blockchainSignature.certificateId },
        });
        // 🔴 (2026-09-15 N2) 공개키로 검증되지 않는 서명은 기록하지 않는다 — 정본 signature-verify
        const verification = cert ? verifyDocumentSignature({
          publicKey: cert.publicKey, certAlgorithm: cert.algorithm,
          signatureAlgorithm: data.blockchainSignature.signatureAlgorithm,
          signatureValue: data.blockchainSignature.signatureValue,
          documentHash: data.blockchainSignature.documentHash,
        }) : null;
        if (verification?.state === 'FAILED') {
          this.logger.warn(`동의서 ${id} 전자서명 검증 실패(${verification.reason}) — 서명을 기록하지 않았습니다`);
        }
        // 🔴 (A2) 서명한 해시가 이 동의서 내용의 해시가 아니면 기록하지 않는다(정본 document-content-hash)
        const content = await signedContentHash(this.prisma, 'CONSENT', id);
        const contentOk = !!content && content.hash === data.blockchainSignature.documentHash;
        if (!contentOk) this.logger.warn(`CONSENT_SIGNATURE_REJECTED reason=SIGN_HASH_NOT_CONTENT consent=${id}`);
        // 🔴 (M1) 인증서 소유 대조 — 직원 인증서는 호출한 직원 본인 것, 환자 인증서는 이 동의서 환자 것만
        const signerType: 'STAFF' | 'PATIENT' = cert?.ownerType === 'PATIENT' ? 'PATIENT' : 'STAFF';
        const ownership = cert ? certificateOwnershipProblem(cert, {
          signerType, signerUserId: actor?.userId ?? null, signerPatientId: consent.patientId,
        }) : null;
        if (ownership) {
          this.logger.warn(`동의서 ${id} 전자서명 거부(${ownership}) — 서명자 소유 인증서가 아닙니다. 서명을 기록하지 않았습니다`);
        }
        if (cert && contentOk && !ownership && cert.status === 'ACTIVE' && cert.expiresAt > new Date() && verification?.state !== 'FAILED') {
          let signedDoc = await this.prisma.signedDocument.findFirst({
            where: { documentType: 'CONSENT', documentId: id },
          });
          if (!signedDoc) {
            signedDoc = await this.prisma.signedDocument.create({
              data: {
                documentType: 'CONSENT',
                documentId: id,
                patientId: consent.patientId,
                documentHash: data.blockchainSignature.documentHash,
                status: 'SIGNED',
              },
            });
          } else {
            // 🔴 (P1) 위 anchorConsentSignature 가 앵커 페이로드 해시로 먼저 만든 문서 — 서명 0건이면 실서명 해시로 맞춘다
            await alignDocumentHashToFirstSignature(this.prisma, signedDoc, data.blockchainSignature.documentHash);
          }

          // 같은 서명이 이미 있으면(서명 모달이 document-sign EP 로 먼저 기록) 이중 행·이중 카운트를 만들지 않는다
          const dup = await this.prisma.documentSignature.findFirst({
            where: { signedDocumentId: signedDoc.id, certificateId: data.blockchainSignature.certificateId, signatureValue: data.blockchainSignature.signatureValue },
            select: { id: true },
          });
          if (!dup) {
          /**
           * 🔴 (2026-09-16 G3) 서명 행 생성과 완료 카운트는 **한 트랜잭션**이다.
           *    종전엔 둘을 따로 커밋해, 카운트 갱신이 실패하면 **서명은 있는데 문서는 미완결**로 남았다.
           *    게다가 바로 위 중복 검사가 재시도 때 이 서명을 "이미 있음"으로 보고 건너뛰므로
           *    카운트는 **영원히 어긋난 채로** 남는다(되돌릴 경로가 없다).
           */
          await this.prisma.$transaction(async (tx) => {
            await tx.documentSignature.create({
              data: {
                signedDocumentId: signedDoc!.id,
                certificateId: data.blockchainSignature!.certificateId,
                signatureValue: data.blockchainSignature!.signatureValue,
                signatureAlgorithm: data.blockchainSignature!.signatureAlgorithm,
                signedAt: new Date(),
                signerRole: 'PRIMARY',
                signerType,
                signerUserId: signerType === 'STAFF' ? actor?.userId ?? undefined : undefined,
                signerPatientId: signerType === 'PATIENT' ? consent.patientId ?? undefined : undefined,
                verifiedAt: verification?.state === 'VERIFIED' ? new Date() : null,
              },
            });
            // (U1) 동의서 서명 수·완료는 서명 사건 원장(anchorConsentSignature)이 센다 — 전자서명은 붙이기만 한다
          });
          }
        }
      } catch (e) {
        console.error('Blockchain signature failed (non-blocking):', e);
      }
    }

    return result;
  }

  async findAll(filters: { status?: string; type?: string; patientId?: string }) {
    const where: Prisma.ConsentFormWhereInput = {};
    if (filters.status) { assertEnumParam(filters.status, ConsentStatus, '상태'); where.status = filters.status as ConsentStatus; }
    if (filters.type) { assertEnumParam(filters.type, ConsentType, '유형'); where.consentType = filters.type as ConsentType; }
    if (filters.patientId) where.patientId = filters.patientId;
    return this.prisma.consentForm.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: {
        ...this.defaultInclude(),
        patient: { select: { id: true, familyName: true, givenName: true, mrn: true } },
      },
    });
  }

  async findById(id: string) {
    const consent = await this.prisma.consentForm.findUnique({
      where: { id },
      include: {
        ...this.defaultInclude(),
        patient: { select: { id: true, familyName: true, givenName: true, mrn: true, dateOfBirth: true, gender: true } },
      },
    });
    if (!consent) throw new ConsentNotFoundError(id);
    return consent;
  }

  async getByPatient(patientId: string) {
    return this.prisma.consentForm.findMany({
      where: { patientId },
      orderBy: { createdAt: 'desc' },
      include: this.defaultInclude(),
    });
  }

  /** 의사 서명 — 의료법 §24-2 설명의사. 순서 무관(환자 전/후 모두 가능, 사전 설명·서명 허용) */
  async doctorSign(id: string, doctorId: string) {
    const consent = await this.prisma.consentForm.findUnique({ where: { id } });
    if (!consent) throw new ConsentNotFoundError(id);
    if (consent.status === 'SIGNED') throw new ConsentAlreadySignedError();
    if (consent.doctorSignedAt) throw new BadRequestException('이미 의사 서명이 완료되었습니다');

    const docImg = await this.staffSignatureImage(doctorId);
    await this.prisma.consentForm.update({
      where: { id },
      data: { doctorId, doctorSignedAt: new Date(), doctorSignatureImage: docImg },
    });
    await this.anchorConsentSignature(id, consent.patientId, 'DOCTOR', doctorId);
    const reqSigners = SIGN_REQUIREMENTS[consent.consentType ?? 'GENERAL'] ?? ['PATIENT'];
    const result = (await this.finalizeIfComplete(id, doctorId)) ?? (await this.prisma.consentForm.findUnique({ where: { id }, include: this.defaultInclude() }))!;

    this.eventEmitter?.emit('consent.doctor_signed', { consentId: id, patientId: consent.patientId, needsWitness: reqSigners.includes('WITNESS') });
    this.emitWs('doctor_signed', id);
    return result;
  }

  /** 증인 서명 — 순서 무관 */
  async witnessSign(id: string, witnessId: string) {
    const consent = await this.prisma.consentForm.findUnique({ where: { id } });
    if (!consent) throw new ConsentNotFoundError(id);
    if (consent.status === 'SIGNED') throw new ConsentAlreadySignedError();
    if (consent.witnessSignedAt) throw new BadRequestException('이미 증인 서명이 완료되었습니다');

    const witImg = await this.staffSignatureImage(witnessId);
    await this.prisma.consentForm.update({
      where: { id },
      data: { witnessId, witnessSignedAt: new Date(), witnessSignatureImage: witImg },
    });
    await this.anchorConsentSignature(id, consent.patientId, 'WITNESS', witnessId);
    const result = (await this.finalizeIfComplete(id, witnessId)) ?? (await this.prisma.consentForm.findUnique({ where: { id }, include: this.defaultInclude() }))!;

    this.emitWs('witness_signed', id);
    return result;
  }

  /** 서명 현황 조회 */
  async getSignatureStatus(id: string) {
    const consent = await this.prisma.consentForm.findUnique({
      where: { id },
      select: {
        id: true, status: true, consentType: true,
        patientSignedAt: true, patientSignedBy: true,
        doctorId: true, doctorSignedAt: true,
        witnessId: true, witnessSignedAt: true,
        doctor: { select: { familyName: true, givenName: true } },
      },
    });
    if (!consent) throw new ConsentNotFoundError(id);

    const reqSigners = SIGN_REQUIREMENTS[consent.consentType ?? 'GENERAL'] ?? ['PATIENT'];
    return {
      ...consent,
      requiredSigners: reqSigners,
      signatures: {
        patient: { required: true, signed: !!consent.patientSignedAt, at: consent.patientSignedAt, by: consent.patientSignedBy },
        doctor: { required: reqSigners.includes('DOCTOR') || reqSigners.includes('NURSE'), signed: !!consent.doctorSignedAt, at: consent.doctorSignedAt },
        witness: { required: reqSigners.includes('WITNESS'), signed: !!consent.witnessSignedAt, at: consent.witnessSignedAt },
      },
      isComplete: consent.status === 'SIGNED',
    };
  }

  /**
   * 서명 요청 재전송.
   *
   * 🔴 종전에는 `consent.created` 를 재발행하고 **리스너 결과를 보지 않은 채**
   *    `{ success:true, '서명 요청이 재전송되었습니다' }` 를 돌려줬다(2026-08-14 W8).
   *    리스너(`notification.listener.handleConsentCreated`)는 실재하지만
   *    ① 포털 계정이 없으면 알림을 하나도 만들지 않고 ② 내부 예외를 모두 삼킨다(warn 후 void).
   *    즉 아무것도 도달하지 않아도 화면은 항상 "재전송됨"이었다.
   *
   *    리스너를 다시 만들지 않는다(정본은 하나다). 대신
   *    ① 수신처 유무를 **미리 확인**하고 — 받을 곳이 없으면 발행하지 않는다
   *       (발행하면 여정에 '동의서 요청'만 거짓으로 쌓인다),
   *    ② `emitAsync` 로 리스너 완료를 기다린 뒤 **알림 행이 실제로 생겼는지 확인**한다.
   *    리스너가 void 를 반환하므로 결과값 자체는 관측 불가 — 산출물(PatientNotification)로 판정한다.
   */
  async resendNotification(id: string) {
    const consent = await this.prisma.consentForm.findUnique({ where: { id } });
    if (!consent) throw new ConsentNotFoundError(id);
    if (consent.status !== 'PENDING') throw new BadRequestException('PENDING 상태에서만 재전송 가능');

    const account = await this.prisma.patientAccount.findFirst({
      where: { patientId: consent.patientId },
      select: { id: true },
    });
    if (!account) {
      // 받을 곳이 없다 — 발행조차 하지 않는다(정본: crm-channel.sendPortal NO_PORTAL_ACCOUNT).
      return {
        success: false,
        delivered: false,
        channel: 'PORTAL',
        reason: 'NO_PORTAL_ACCOUNT',
        message: '환자 포털 계정이 없어 서명 요청이 재전송되지 않았습니다 — 태블릿 현장 서명으로 진행하십시오',
      };
    }

    const payload = {
      consentId: id,
      patientId: consent.patientId,
      doctorId: consent.doctorId,
      consentType: consent.consentType ?? consent.type,
      templateName: consent.templateName,
    };

    const since = new Date();
    // 리스너 완료를 기다린다(emitAsync 미지원 환경에서는 동기 emit 로 폴백).
    if (typeof this.eventEmitter?.emitAsync === 'function') {
      await this.eventEmitter.emitAsync('consent.created', payload);
    } else {
      this.eventEmitter?.emit('consent.created', payload);
    }

    // 산출물 확인 — 리스너가 만들었어야 할 환자 알림이 실제로 있는가.
    const created = await this.prisma.patientNotification.findFirst({
      where: { accountId: account.id, type: 'CONSENT', createdAt: { gte: since } },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });

    if (!created) {
      return {
        success: false,
        delivered: false,
        channel: 'PORTAL',
        reason: 'NOTIFICATION_NOT_CREATED',
        message: '서명 요청 알림이 생성되지 않았습니다 — 전송되지 않았습니다(서버 로그 확인 후 다시 시도하십시오)',
      };
    }

    return {
      success: true,
      delivered: true,
      channel: 'PORTAL',
      notificationId: created.id,
      message: '서명 요청이 재전송되었습니다',
    };
  }

  async revoke(id: string, reason?: string) {
    const consent = await this.prisma.consentForm.findUnique({ where: { id } });
    if (!consent) throw new ConsentNotFoundError(id);
    if (consent.status === 'REVOKED') throw new ConsentAlreadyRevokedError();

    const revoked = await this.prisma.consentForm.update({
      where: { id },
      data: {
        isValid: false,
        status: 'REVOKED',
        revokedAt: new Date(),
        revokedReason: reason,
      },
      include: this.defaultInclude(),
    });
    // 여정(CONSENT_REVOKED) — 서명은 여정에 남는데 철회는 남지 않아 타임라인이 "유효한 동의"로 읽혔다.
    // 커밋 뒤 발행(발행 실패가 철회를 되돌리지 않는다). 사유는 넘기지 않는다 — 여정은 환자 포털에 그대로 나간다.
    this.eventEmitter?.emit('consent.revoked', { consentId: id, patientId: consent.patientId, templateName: consent.templateName });
    return revoked;
  }

  /** 동의서 다국어 번역 (AI) */
  /* ── 첨부파일 — 인쇄 별첨(설명자료·스캔본). attachments Json 배열에 append ── */

  async addAttachment(
    id: string,
    file: { url: string; fileName: string; mimeType: string; size: number },
    userId: string,
  ) {
    const consent = await this.prisma.consentForm.findUnique({ where: { id }, select: { attachments: true } });
    if (!consent) throw new NotFoundException('동의서를 찾을 수 없습니다');
    const list = Array.isArray(consent.attachments) ? (consent.attachments as unknown[]) : [];
    if (list.length >= 20) throw new BadRequestException('첨부는 최대 20개까지 가능합니다');
    const entry = { ...file, uploadedBy: userId, uploadedAt: new Date().toISOString() };
    return this.prisma.consentForm.update({
      where: { id },
      data: { attachments: [...list, entry] as Prisma.InputJsonValue },
      select: { id: true, attachments: true },
    });
  }

  async removeAttachment(id: string, index: number) {
    const consent = await this.prisma.consentForm.findUnique({ where: { id }, select: { attachments: true } });
    if (!consent) throw new NotFoundException('동의서를 찾을 수 없습니다');
    const list = Array.isArray(consent.attachments) ? (consent.attachments as unknown[]) : [];
    if (index < 0 || index >= list.length) throw new BadRequestException('잘못된 첨부 인덱스입니다');
    // 🔴 종이 서명의 증거인 스캔본은 지우지 못한다 — 지우면 "서명됨"만 남고 증거가 사라진다(A1)
    const target = list[index] as { evidence?: unknown } | null;
    if (target && typeof target === 'object' && target.evidence === PAPER_SIGNATURE_EVIDENCE) {
      throw new ConflictException({ code: 'CONSENT_SIGNATURE_EVIDENCE', message: '환자 종이 서명의 스캔본이라 지울 수 없습니다' });
    }
    return this.prisma.consentForm.update({
      where: { id },
      data: { attachments: list.filter((_, i) => i !== index) as Prisma.InputJsonValue },
      select: { id: true, attachments: true },
    });
  }

  /**
   * 동의서 다국어 번역 — 🔴 **구현하지 않는다.** 종전 구현은 번역을 하지 않으면서
   *    번역한 것처럼 답했다: `translatedTitle` 은 원문 앞에 `[English]` 를 붙인 것이고
   *    `content` 는 한국어 원문 그대로였다. `vi`·`ru` 는 라벨 사전조차 없어 서명란이
   *    **"환자 서명"(한국어)** 으로 나갔는데 응답 필드는 `signatureLabels`·`translatedAt` 이었다.
   *    호출부가 0이라 피해는 없었으나, **배선하는 순간 거짓말이 된다.**
   *
   * 🔴 **정본은 이미 있다** — `ConsentTemplateService.cloneWithTranslation()` 이
   *    실제 번역 엔진(`modules/i18n`)을 쓰고, 폴백 건수를 `aiDraftFallbacks` 로 원장에 남기며,
   *    법적 문서라 **`isActive=false` 로 생성해 사람이 검토·활성화**한다.
   *
   * 🔴 여기에 엔진을 바로 붙이지 않는 이유: 이 EP 는 **개별 동의서**를 즉석 번역해
   *    환자에게 보여주는 경로다. 검토를 거치지 않은 법적 문서 번역을 환자에게 내보내는 것은
   *    언어판 검토 규율을 우회한다. 제공 여부는 **사람이 정할 정책**이다.
   */
  async translateConsent(consentId: string, targetLanguage: string): Promise<never> {
    void consentId; void targetLanguage;
    throw new NotImplementedException({
      code: 'CONSENT_TRANSLATE_NOT_IMPLEMENTED',
      message: '개별 동의서 즉석 번역은 제공하지 않습니다 — 동의서 템플릿의 언어판(검토 후 활성화)을 사용하세요.',
    });
  }

  private defaultInclude() {
    return {
      template: { select: { id: true, name: true, type: true, version: true, components: true, variables: true, description: true } },
      doctor: { select: { id: true, familyName: true, givenName: true } },
    };
  }

  // ════════════════════════════════════════════════════════
  //  동의서 워크스테이션 (Consent Workstation)
  // ════════════════════════════════════════════════════════

  /** 워크스테이션 큐 — 진행 중/최근 동의서 (환자명 포함) */
  async getWorkstationQueue(filters: { status?: string; consentType?: string }) {
    const where: Prisma.ConsentFormWhereInput = {};
    if (filters.status) { assertEnumParam(filters.status, ConsentStatus, '상태'); where.status = filters.status as ConsentStatus; }
    else where.status = { in: ['PENDING', 'SIGNED'] };
    if (filters.consentType) { assertEnumParam(filters.consentType, ConsentType, '동의 유형'); where.consentType = filters.consentType as ConsentType; }

    const rows = await this.prisma.consentForm.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 80,
      include: {
        ...this.defaultInclude(),
        patient: { select: { id: true, familyName: true, givenName: true, mrn: true } },
        signSessions: { where: { status: 'OPEN' }, select: { token: true, expiresAt: true } },
      },
    });
    return rows.map((c) => {
      const reqSigners = SIGN_REQUIREMENTS[(c.consentType as string) ?? 'GENERAL'] ?? ['PATIENT'];
      const patientSigned = !!c.patientSignedAt;
      const doctorSigned = !!c.doctorSignedAt;
      const witnessSigned = !!c.witnessSignedAt;
      const nurseChecked = !!c.nurseCheckedAt;
      // 의료법 §24-2: 설명(의사) → 동의(환자) 절차 → 의료진 사전 확인을 먼저 노출
      const stage = c.status === 'SIGNED' ? 'COMPLETED'
        : reqSigners.includes('DOCTOR') && !doctorSigned ? 'AWAIT_DOCTOR'
        : reqSigners.includes('NURSE') && !nurseChecked && !witnessSigned ? 'AWAIT_NURSE'
        : !patientSigned ? 'AWAIT_PATIENT'
        : reqSigners.includes('WITNESS') && !witnessSigned ? 'AWAIT_WITNESS'
        : 'AWAIT_FINALIZE';
      return { ...c, stage, reqSigners, doctorSigned, nurseChecked, openSession: c.signSessions[0] ?? null };
    });
  }

  /** 워크스테이션 통계 (오늘) */
  async getWorkstationStats() {
    const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
    const [requested, pending, completed, expired] = await Promise.all([
      this.prisma.consentForm.count({ where: { createdAt: { gte: dayStart } } }),
      this.prisma.consentForm.count({ where: { status: 'PENDING' } }),
      this.prisma.consentForm.count({ where: { status: 'SIGNED', signedAt: { gte: dayStart } } }),
      this.prisma.consentForm.count({ where: { status: 'EXPIRED' } }),
    ]);
    return { requested, pending, completed, expired };
  }

  /** 태블릿/PC 대면 서명 세션 생성 (1회용 토큰, 5분 TTL) */
  async createSignSession(consentId: string, createdBy: string, data: { signMode?: string; signerType?: string }) {
    const consent = await this.prisma.consentForm.findUnique({ where: { id: consentId } });
    if (!consent) throw new ConsentNotFoundError(consentId);
    if (consent.status === 'SIGNED') throw new ConsentAlreadySignedError();
    // 기존 OPEN 세션 만료 처리
    await this.prisma.consentSignSession.updateMany({ where: { consentId, status: 'OPEN' }, data: { status: 'EXPIRED' } });
    const token = randomBytes(24).toString('hex');
    const ttlMin = SIGN_SESSION_TTL_MIN[data.signMode ?? 'TABLET'] ?? 5;
    const session = await this.prisma.consentSignSession.create({
      data: {
        consentId, token,
        signMode: data.signMode ?? 'TABLET',
        signerType: data.signerType ?? 'PATIENT',
        createdBy,
        expiresAt: new Date(Date.now() + ttlMin * 60000),
      },
    });
    return { token: session.token, expiresAt: session.expiresAt, signMode: session.signMode, signerType: session.signerType };
  }

  /** 서명 화면용 동의서 조회 (공개 — 토큰 검증) */
  async getSignSession(token: string) {
    const session = await this.prisma.consentSignSession.findUnique({ where: { token } });
    if (!session) throw new BadRequestException('유효하지 않은 서명 세션입니다');
    if (session.status !== 'OPEN') throw new BadRequestException('이미 사용되었거나 만료된 서명 세션입니다');
    if (session.expiresAt < new Date()) {
      await this.prisma.consentSignSession.update({ where: { token }, data: { status: 'EXPIRED' } });
      throw new BadRequestException('서명 세션이 만료되었습니다 — 직원에게 다시 요청해주세요');
    }
    const consent = await this.prisma.consentForm.findUnique({
      where: { id: session.consentId },
      include: {
        ...this.defaultInclude(),
        patient: { select: { familyName: true, givenName: true, mrn: true, dateOfBirth: true } },
      },
    });
    // 초진 동의 묶음 — 항목 정의·전문은 서버 정본에서(화면이 문안을 갖지 않는다)
    const registrationItems = consent?.type === REGISTRATION_BUNDLE_TYPE
      ? Object.entries(REGISTRATION_CONSENT_TYPES).map(([type, m]) => ({ type, label: m.label, required: m.required, law: m.law, detail: REGISTRATION_CONSENT_DETAILS[type] ?? null }))
      : undefined;
    return { session: { signMode: session.signMode, signerType: session.signerType, expiresAt: session.expiresAt }, consent, ...(registrationItems ? { registrationItems } : {}) };
  }

  /** 서명 제출 (공개 — 토큰, 서명패드 이미지) */
  async submitSignSession(token: string, data: {
    signatureImage: string; signedBy: string; signerType?: string;
    guardianName?: string; guardianRelation?: string; guardianLegalBasis?: string;
    choices?: Record<string, unknown>;
  }, meta: { ipAddress?: string | null } = {}) {
    const session = await this.prisma.consentSignSession.findUnique({ where: { token } });
    if (!session) throw new BadRequestException('유효하지 않은 서명 세션입니다');
    if (session.status !== 'OPEN') throw new BadRequestException('이미 처리된 서명 세션입니다');
    if (session.expiresAt < new Date()) {
      await this.prisma.consentSignSession.update({ where: { token }, data: { status: 'EXPIRED' } });
      throw new BadRequestException('서명 세션이 만료되었습니다');
    }
    if (!data.signatureImage) throw new BadRequestException('서명이 필요합니다');
    this.validateSignatureImage(data.signatureImage);

    // 초진 동의 묶음 — 항목별 선택이 없으면 받지 않는다(서명만 있고 무엇에 동의했는지 모르는 기록을 만들지 않는다)
    const target = await this.prisma.consentForm.findUnique({ where: { id: session.consentId }, select: { type: true, patientId: true, content: true } });
    const isBundle = target?.type === REGISTRATION_BUNDLE_TYPE;
    let choices: Record<string, boolean> | null = null;
    if (isBundle) {
      if (!this.registration) throw new BadRequestException('등록 동의 원장을 쓸 수 없어 서명을 받지 않았습니다 — 직원에게 알려주세요');
      const raw = data.choices;
      if (!raw || typeof raw !== 'object') throw new BadRequestException('항목별 동의 여부를 선택해주세요');
      choices = {};
      for (const type of Object.keys(REGISTRATION_CONSENT_TYPES)) {
        const v = (raw as Record<string, unknown>)[type];
        if (typeof v !== 'boolean') throw new BadRequestException('모든 항목에 동의 또는 미동의를 선택해주세요');
        choices[type] = v;
      }
    }

    /**
     * 🔴 (2026-09-16 K1) 세션 소비가 **맨 끝**이었다 — 서명이 기록된 뒤 세션 갱신이 실패하면 세션은 OPEN 으로
     *    남고, 같은 토큰으로 **다른 서명을 한 번 더** 제출할 수 있었다(다인 서명 서식은 상태가 PENDING 이라
     *    `sign` 이 막지도 않는다). 태블릿 토큰은 한 번 쓰는 것이다 — 먼저 조건부로 선점하고,
     *    선점에 진 요청은 이미 처리된 세션으로 돌려보낸다.
     */
    const claimed = await this.prisma.consentSignSession.updateMany({
      where: { token, status: 'OPEN' },
      data: { status: 'SIGNED', signedAt: new Date() },
    });
    if (claimed.count !== 1) throw new BadRequestException('이미 처리된 서명 세션입니다');

    // 서명자 유형은 세션 생성(직원 디스패치) 시점 값을 신뢰 — body의 signerType은 무시(위장 방지, H-4)
    const isGuardian = session.signerType === 'GUARDIAN';
    const signMethod: 'TABLET' | 'MOBILE' = session.signMode === 'MOBILE' ? 'MOBILE' : 'TABLET';
    /**
     * 🔴 (2026-10-03) 초진 묶음은 환자가 고른 항목을 **서명과 같은 행에** 남긴다. 종전엔 선택이 요청 본문에만 있어
     *    서명 저장 뒤 원장 기록이 실패하면 무엇에 동의했는지가 사라졌다(서명본만 남음 → 환자에게 다시 받아야 함).
     *    이제 원장이 실패해도 서명본의 선택대로 원장을 다시 쓸 수 있다(재수집 목록 → '서명본대로 기록').
     */
    const patientChoices = isBundle && choices ? {
      choices,
      signMethod,
      signedBy: data.signedBy, // 길이는 공개 서명 DTO(MaxLength)가 막는다 — 여기서 조용히 자르지 않는다
      guardianName: isGuardian ? (data.guardianName ?? null) : null,
      guardianRelation: isGuardian ? (data.guardianRelation ?? null) : null,
      collectedBy: session.createdBy,
      ipAddress: meta.ipAddress ?? null,
    } : null;
    await this.prisma.consentForm.update({
      where: { id: session.consentId },
      data: {
        signMode: session.signMode,
        signerType: session.signerType,
        ...(patientChoices ? { content: { ...((target?.content && typeof target.content === 'object' && !Array.isArray(target.content)) ? target.content as Record<string, unknown> : {}), patientChoices } as Prisma.InputJsonValue } : {}),
        ...(isGuardian ? {
          guardianName: (data.guardianName ?? '').slice(0, 100),
          guardianRelation: (data.guardianRelation ?? '').slice(0, 30),
          guardianLegalBasis: (data.guardianLegalBasis ?? '').slice(0, 50),
        } : {}),
      },
    });

    // 환자/보호자 서명 기록 (기존 sign 로직 재사용 — 서명패드 이미지 = patientSignature)
    const result = await this.sign(session.consentId, {
      patientSignature: data.signatureImage,
      patientSignedBy: data.signedBy,
      signerType: 'PATIENT',
    });

    // 초진 동의 묶음 → 등록 동의 원장 10종(환자가 고른 대로 · 증빙 = 이 묶음)
    let registration: { requiredComplete: boolean; missingRequired: string[] } | undefined;
    if (isBundle && choices && target) {
      // 🔴 서명은 이미 저장됐다 — 원장 기록이 실패하면 "완료"로 말하지 않는다(현황 화면은 미수집으로 보여 다시 받게 된다)
      registration = await this.registration!.recordFromEvidence(target.patientId, {
        choices,
        signMethod,
        signedBy: data.signedBy,
        guardianName: isGuardian ? (data.guardianName ?? null) : null,
        guardianRelation: isGuardian ? (data.guardianRelation ?? null) : null,
        collectedBy: session.createdBy,
        evidenceConsentFormId: session.consentId,
        ipAddress: meta.ipAddress ?? null,
      }).catch((e: unknown) => {
        this.logger.error(`초진 동의 원장 기록 실패 — 묶음 ${session.consentId} 서명은 저장됨: ${e instanceof Error ? e.message : String(e)}`);
        throw new BadRequestException('서명은 저장됐지만 항목별 동의 기록에 실패했습니다 — 직원에게 알려주세요(서명본의 선택은 남아 있습니다)');
      });
    }

    this.emitWs('patient_signed', session.consentId);
    return { signed: true, status: result.status, ...(registration ? { registration: { requiredComplete: registration.requiredComplete, missingRequired: registration.missingRequired } } : {}) };
  }

  /**
   * 환자 서명의 증거(A1) — PAD: 서명패드 이미지 필수 · PAPER: 이 동의서에 이미 올린 스캔본 하나를 지목.
   *  · 종이 경로는 스캔본 항목에 표식(evidence)을 남기고 이미지는 저장하지 않는다(종이가 원본).
   *  · 🔴 증거가 없으면 기록하지 않는다 — "서명자 이름"은 증거가 아니다.
   */
  private async patientSignatureEvidence(
    consent: { attachments: Prisma.JsonValue | null },
    data: { patientSignature?: string; signMode?: 'PAD' | 'PAPER'; paperScanIndex?: number },
  ): Promise<{ patientSignature: string | null; signMode: 'PC' | 'PAPER'; attachments?: Prisma.InputJsonValue }> {
    if (data.signMode === 'PAPER') {
      const list = Array.isArray(consent.attachments) ? (consent.attachments as Array<Record<string, unknown>>) : [];
      const i = data.paperScanIndex;
      if (typeof i !== 'number' || !Number.isInteger(i) || i < 0 || i >= list.length || !list[i] || typeof list[i] !== 'object') {
        throw new BadRequestException({ code: 'CONSENT_PAPER_SCAN_REQUIRED', message: '종이 서명은 서명된 종이의 스캔본을 먼저 첨부하고 그 파일을 골라야 합니다' });
      }
      const marked = list.map((a, k) => (k === i ? { ...a, evidence: PAPER_SIGNATURE_EVIDENCE } : a));
      return { patientSignature: null, signMode: 'PAPER', attachments: marked as Prisma.InputJsonValue };
    }
    if (!data.patientSignature) {
      throw new BadRequestException({ code: 'CONSENT_SIGNATURE_REQUIRED', message: '환자 서명이 필요합니다 — 서명패드로 받거나, 종이에 받았다면 스캔본을 첨부하세요' });
    }
    this.validateSignatureImage(data.patientSignature);
    return { patientSignature: data.patientSignature, signMode: 'PC' };
  }

  /** 서명패드 이미지 검증 — data URL(png/jpeg)·크기 제한 (DoS·SVG XSS 방지) */
  private validateSignatureImage(img: string) {
    if (typeof img !== 'string' || img.length > 3_000_000) throw new BadRequestException('서명 이미지가 너무 크거나 올바르지 않습니다');
    if (!/^data:image\/(png|jpe?g);base64,[A-Za-z0-9+/=\s]+$/.test(img)) throw new BadRequestException('유효하지 않은 서명 이미지 형식입니다 (PNG/JPEG만 허용)');
  }

  /** 서명 세션 취소 */
  async cancelSignSession(token: string) {
    await this.prisma.consentSignSession.updateMany({ where: { token, status: 'OPEN' }, data: { status: 'CANCELLED' } });
    return { cancelled: true };
  }
}