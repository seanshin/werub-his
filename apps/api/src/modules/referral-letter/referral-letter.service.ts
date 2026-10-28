import { Injectable, Logger, NotFoundException, ForbiddenException } from '@nestjs/common';
import { createHash } from 'crypto';
import { AiProposalStatus } from '@prisma/client';
import { ageOf, localeDateTimeText } from '@hospital-run/shared';
import { PATIENT_SENSITIVE_OMIT } from '../../common/patient-select';

import { escapeHtml as esc } from '../../common/util/html-escape';
import { ConsultationService } from '../consultation/consultation.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { MedicalAiService } from '../medical-ai/medical-ai.service';
import { AiProposalService } from '../ai-proposal/ai-proposal.service';
import type { ReferralLetterType } from './dto/referral-letter-write.dto';
import { assertStateTransition, stateChangedConflict, TransitionMap } from '../../common/state-transition';

/** 의뢰서 상태 어휘 — 스키마 주석(ReferralLetter.status) 그대로 */
export type ReferralLetterStatus = 'DRAFT' | 'SIGNED' | 'SENT' | 'RECEIVED' | 'REJECTED' | 'VOIDED' | 'EXPIRED' | 'ARCHIVED';

/** 전송 뒤에는 폐기가 아니라 거절이 남는 길이다 — 수신 과가 이미 본 것을 발신자가 지우지 못한다 */
export const REFERRAL_TRANSITIONS: TransitionMap<ReferralLetterStatus> = {
  DRAFT: ['SIGNED', 'SENT', 'VOIDED', 'EXPIRED'],
  SIGNED: ['SENT', 'VOIDED', 'EXPIRED'],
  SENT: ['RECEIVED', 'REJECTED', 'ARCHIVED', 'EXPIRED'],
  RECEIVED: ['REJECTED', 'ARCHIVED'],
  REJECTED: ['ARCHIVED'],
  VOIDED: [],
  EXPIRED: ['ARCHIVED'],
  ARCHIVED: [],
};
export const REFERRAL_TX_CTX = { code: 'REFERRAL_LETTER', message: '지금 상태에서는 할 수 없는 의뢰서 처리입니다' };
import { levenshteinCapped } from '../../common/util/edit-distance';
import { readHospitalConfig, HOSPITAL_UNSET_KO } from '../config/hospital-facts';

type LetterType = ReferralLetterType;

/**
 * 의뢰서 초안 프롬프트 세대 — `buildPrompt()` 를 고치면 여기도 올린다.
 * 🔴 감독 지표(수용률·수정량)가 프롬프트 세대를 섞어 세면 모델을 잘못 판단하게 된다.
 */
export const REFERRAL_DRAFT_PROMPT_VERSION = 'referral-draft-v1';

/** 제안이 가리키는 정본 종류 — 제안↔의뢰서는 `targetId` 로만 잇는다(ReferralLetter 에 컬럼을 추가하지 않는다) */
export const REFERRAL_PROPOSAL_TARGET_TYPE = 'ReferralLetter';

/**
 * 상류가 돌려준 모델 태그만 남긴다 — 🔴 `'unknown'` 은 "모델이 자기 이름을 말하지 않았다"는 뜻이지
 * 모델 이름이 아니다. 그대로 `modelRef` 에 넣으면 감독 화면에 `unknown` 이라는 모델이 생긴다.
 */
function upstreamModelRef(tag: string | null | undefined): string | null {
  const t = (tag ?? '').trim();
  if (!t || t === 'unknown') return null;
  return t;
}

/** 입력 스냅샷 해시 — 본문이 아니라 **무엇을 보고 썼는가**의 지문(PHI 는 담지 않는다) */
function sha256(v: string): string {
  return createHash('sha256').update(v, 'utf8').digest('hex');
}

/** 서명·폐기 시점에 제안 원장에 남긴 결과 — 🔴 실패를 성공처럼 말하지 않는다(recorded=false + 사유) */
export interface ReferralProposalOutcome {
  id: string;
  decision: 'ACCEPTED' | 'EDITED' | 'REJECTED';
  recorded: boolean;
  reason?: string;
}

interface GenerateDto {
  type: LetterType;
  patientId: string;
  encounterId?: string;
  consultationId?: string;
  toDepartment: string;
  toDoctorId?: string;
  urgency?: string;
  additionalNote?: string;
}

@Injectable()
export class ReferralLetterService {
  private readonly logger = new Logger('ReferralLetter');

  constructor(
    private readonly prisma: PrismaService,
    private readonly medicalAi: MedicalAiService,
    // 협진 생성 정본 — 수신자 알림까지 이 서비스가 갖는다(옆에 약한 것을 만들지 않는다)
    private readonly consultation: ConsultationService,
    // AI 제안 원장 정본 — "AI 가 무엇을 냈고 사람이 그것을 어떻게 했는가"만 남긴다(정본은 여기가 쓴다)
    private readonly aiProposal: AiProposalService,
  ) {}

  /* ═══════════════════════════════════════
   *  AI 제안 원장(AiProposal) — 정본은 ReferralLetter, 원장은 제안 테이블
   *
   * 🔴 `ReferralLetter` 에 `aiProposalId` 컬럼을 **추가하지 않는다**. 같은 사실에 정본이 둘이 되고
   *    스키마 변경은 P3(사람 결정 `ai.draftProvenanceSchema`) 뒤다. 잇는 것은 `targetType+targetId` 다.
   * 🔴 제안 기록 실패는 **의뢰서 생성·서명을 막지 않는다**. 대신 조용히 넘어가지 않고 로그+반환값으로 말한다.
   * ═══════════════════════════════════════ */

  /** 초안 저장 직후 제안 1건 생성 — 실패하면 `null`(초안 생성 자체는 성공으로 남는다) */
  private async createDraftProposal(input: {
    letterId: string;
    patientId: string;
    draft: string;
    ctx: unknown;
    aiModel: string;
    source: 'AI' | 'FALLBACK';
    userId: string;
  }): Promise<string | null> {
    try {
      const proposal = await this.aiProposal.create({
        kind: 'REFERRAL_DRAFT',
        targetType: REFERRAL_PROPOSAL_TARGET_TYPE,
        targetId: input.letterId,
        patientId: input.patientId,
        content: input.draft,
        // 🔴 폴백 초안은 모델이 쓴 글이 아니다 — 그때 모델 태그를 달면 규칙 문장이 모델 실적이 된다
        modelRef: input.source === 'AI' ? upstreamModelRef(input.aiModel) : null,
        promptVersion: REFERRAL_DRAFT_PROMPT_VERSION,
        inputSnapshotHash: sha256(JSON.stringify(input.ctx ?? null)),
        source: input.source,
        createdBy: input.userId,
      });
      return proposal.id;
    } catch (e) {
      this.logger.error(`ReferralLetter ${input.letterId}: AI 제안 기록 실패 — ${(e as Error).message}`);
      return null;
    }
  }

  /**
   * 이 의뢰서에 달린 **아직 결정되지 않은** 제안 1건. 🔴 `AiProposalService` 에 대상 조회가 없어
   * 여기서는 **읽기만** prisma 로 한다(그 서비스는 소유 밖 · 결정 쓰기는 반드시 `decide()` 를 지난다).
   */
  private async findOpenProposal(letterId: string): Promise<string | null> {
    try {
      const row = await this.prisma.aiProposal.findFirst({
        where: {
          targetType: REFERRAL_PROPOSAL_TARGET_TYPE,
          targetId: letterId,
          status: { in: [AiProposalStatus.GENERATED, AiProposalStatus.PRESENTED] },
        },
        orderBy: { createdAt: 'desc' },
        select: { id: true },
      });
      return row?.id ?? null;
    } catch (e) {
      this.logger.error(`ReferralLetter ${letterId}: AI 제안 조회 실패 — ${(e as Error).message}`);
      return null;
    }
  }

  /**
   * 서명 = 사람이 이 초안을 정본으로 받아들인 시점. 서명되는 `content` 와 AI 원본 `aiDraftContent` 의
   * **편집거리가 0 이면 ACCEPTED, 아니면 EDITED**.
   *
   * 🔴 여기서 재는 거리는 **분기 판정용**이다. 원장에 남는 수정량은 `decide()` 가 제안 본문(암호문 복호)에서
   *    다시 잰다 — 두 곳에서 잰 값이 갈라지지 않게 최종본(`finalText`)만 넘긴다.
   * 🔴 제안이 없으면 `null` 이다(0 건을 "무수정 수용"으로 세지 않는다).
   */
  private async decideDraftProposal(
    letter: { id: string; content: string; aiDraftContent?: string | null },
    userId: string,
  ): Promise<ReferralProposalOutcome | null> {
    const proposalId = await this.findOpenProposal(letter.id);
    if (!proposalId) return null;

    const finalText = letter.content ?? '';
    const decision = levenshteinCapped(letter.aiDraftContent ?? '', finalText) === 0 ? 'ACCEPTED' : 'EDITED';
    try {
      await this.aiProposal.decide(proposalId, { decision, actorId: userId, finalText });
      return { id: proposalId, decision, recorded: true };
    } catch (e) {
      // 🔴 원장 기록 실패가 서명을 되돌리지 않는다 — 서명은 이미 일어난 사실이다
      this.logger.error(`ReferralLetter ${letter.id}: AI 제안 결정 기록 실패 — ${(e as Error).message}`);
      return { id: proposalId, decision, recorded: false, reason: (e as Error).message };
    }
  }

  /**
   * 🔴 사람 승인 게이트 = 서명. 서명하는 그 시점에 협진 정본(Consultation)을 만든다.
   *
   * 종전엔 AI 초안 생성 단계에서 만들어져, 서명하지 않은 초안이 타과 협진 목록에 `REQUESTED` 로 떠 있었다.
   * 여기로 옮기면서 생성 경로도 `prisma.consultation.create` 직접 호출에서 **정본 `ConsultationService.create`**
   * 로 바꿨다 — 종전 직접 생성분은 수신 의료진 알림이 한 번도 나가지 않았다.
   *
   * 만들지 못하는 경우(진료 미연결 등)는 지어내지 않는다. 의뢰서 서명·전송은 그대로 진행하고
   * `consultationId` 는 `null` 로 남는다(소비처는 전부 null 을 견딘다).
   */
  private async ensureConsultation(
    letter: { id: string; type: string; consultationId: string | null; encounterId: string | null; toDepartment: string; toDoctorId: string | null; urgency: string; content: string; fromDoctorId: string },
  ): Promise<string | null> {
    if (letter.type !== 'CONSULTATION_REQUEST') return letter.consultationId;
    if (letter.consultationId) {
      // 이미 붙어 있는 협진이면 본문만 동기화(일어난 사실은 소급하지 않는다 — reason 만)
      await this.prisma.consultation
        .update({ where: { id: letter.consultationId }, data: { reason: letter.content } })
        .catch((e) => this.logger.warn(`Consultation ${letter.consultationId} reason 동기화 실패: ${(e as Error).message}`));
      return letter.consultationId;
    }
    if (!letter.encounterId) {
      this.logger.warn(`ReferralLetter ${letter.id}: 진료(Encounter) 미연결이라 협진을 생성하지 않았다(consultationId=null)`);
      return null;
    }
    try {
      const consult = await this.consultation.create({
        encounterId: letter.encounterId,
        requestingDoctorId: letter.fromDoctorId,
        toDepartment: letter.toDepartment,
        toDoctorId: letter.toDoctorId ?? undefined,
        reason: letter.content,
        urgency: letter.urgency,
      });
      await this.prisma.referralLetter.update({ where: { id: letter.id }, data: { consultationId: consult.id } });
      this.logger.log(`ReferralLetter ${letter.id} 서명 → Consultation ${consult.id} 생성`);
      return consult.id;
    } catch (e) {
      // 협진 생성 실패가 서명을 되돌리지는 않는다 — 대신 조용히 "없음"으로 만들지 않고 남긴다
      this.logger.error(`ReferralLetter ${letter.id}: 협진 생성 실패 — ${(e as Error).message}`);
      return null;
    }
  }

  // ═══════════════════════════════════════
  //  AI 초안 생성
  // ═══════════════════════════════════════

  async generateDraft(dto: GenerateDto, userId: string) {
    // 1. 환자 컨텍스트 자동 수집
    const ctx = await this.buildContext(dto.patientId, dto.encounterId, dto.consultationId);

    // 2. 문서유형별 프롬프트 — PHI 비식별(보수안): 성명·MRN 미전송(연령·성별·임상정보만).
    //    LLM에는 '[환자명]' 플레이스홀더 표기를 지시하고, 초안 수신 후 서버가 실명으로 후치환(문서 품질 유지).
    const realPatientName: string = ctx?.patient?.name ?? '';
    const promptCtx = ctx ? { ...ctx, patient: { ...ctx.patient, name: '[환자명]', mrn: undefined } } : ctx;
    const prompt = this.buildPrompt(dto.type, dto.toDepartment, dto.urgency, dto.additionalNote, promptCtx);

    // 3. Enhanced Chat (의료 도메인 멀티모델)
    let draftContent = '';
    let aiModel = '';
    // 🔴 출처는 3상태 어휘 그대로 — 모델이 쓴 글(AI)과 규칙 서식(FALLBACK)을 섞어 세지 않는다
    let draftSource: 'AI' | 'FALLBACK' = 'AI';
    try {
      const result = await this.medicalAi.enhancedChat(prompt, 'medical');
      draftContent = (result?.answer ?? result?.response ?? '').trim();
      aiModel = result?.model_used ?? result?.stages?.[0]?.model ?? 'unknown';
      // [환자명] 플레이스홀더 → 실명 후치환(서버 측 — LLM에는 실명 미전송)
      if (realPatientName) draftContent = draftContent.split('[환자명]').join(realPatientName);
      // 태그 제거
      draftContent = draftContent.replace(/\[(?:TRIAGE_NEEDED|REFERENCE_NEEDED|DOCTORS_NEEDED|SCHEDULE_NEEDED)[^\]]*\]/g, '').trim();
      // 외국어 줄 제거
      draftContent = draftContent.split('\n').filter(line => {
        const t = line.trim();
        if (!t) return true;
        const koreanCount = (t.match(/[\uAC00-\uD7AF]/g) || []).length;
        const cjkCount = (t.match(/[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF]/g) || []).length;
        if (cjkCount > 0 && cjkCount >= koreanCount) return false;
        return true;
      }).join('\n').trim();
    } catch (e) {
      this.logger.warn(`AI draft generation failed: ${(e as Error).message}`);
    }

    if (!draftContent || draftContent.length < 20) {
      draftContent = this.buildFallbackDraft(dto.type, dto.toDepartment, ctx);
      draftSource = 'FALLBACK';
    }

    // 4. 문서번호 채번
    const letterNumber = await this.generateLetterNumber(dto.type);

    // 5. 의사 정보
    const fromDoctor = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { department: true },
    });

    // 5.5. 🔴 초안 단계에서는 **협진 정본을 만들지 않는다**(초안≠확정 · AI-AND-HIS §2.2 R2).
    //     종전엔 여기서 `consultation.create({ reason: <LLM 초안>, status: 'REQUESTED' })` 를 불러
    //     의사가 초안 버튼을 누른 것만으로 타과에 협진이 **접수**돼 있었다(사람 승인 게이트 없음).
    //     협진 생성은 의사가 서명하는 단계(sign·signAndSend)로 옮겼다 — `ensureConsultation()`.
    //     dto.consultationId 는 "이미 있는 협진에 붙여 쓰는" 경로라 그대로 통과시킨다.
    const consultationId = dto.consultationId ?? null;

    // 6. 저장
    const letter = await this.prisma.referralLetter.create({
      data: {
        type: dto.type,
        patientId: dto.patientId,
        encounterId: dto.encounterId,
        consultationId,
        fromDepartment: fromDoctor?.department ?? '',
        fromDoctorId: userId,
        toDepartment: dto.toDepartment,
        toDoctorId: dto.toDoctorId,
        urgency: dto.urgency ?? 'ROUTINE',
        content: draftContent,
        aiDraftContent: draftContent,
        aiModel,
        patientSnapshot: ctx as any,
        letterNumber,
        status: 'DRAFT',
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
      include: { patient: { omit: PATIENT_SENSITIVE_OMIT }, fromDoctor: true, toDoctor: true },
    });

    // 7. AI 제안 원장 — 의뢰서가 먼저 있어야 `targetId` 로 이을 수 있다(그래서 저장 뒤다).
    //    실패하면 `proposalId: null` 이고 화면은 "원장에 남지 않았다"를 말할 수 있다(성공처럼 말하지 않는다).
    const proposalId = await this.createDraftProposal({
      letterId: letter.id,
      patientId: dto.patientId,
      draft: draftContent,
      ctx,
      aiModel,
      source: draftSource,
      userId,
    });

    this.logger.log(`Draft generated: ${letter.id} (${dto.type}) by ${userId}`);
    return { ...letter, proposalId };
  }

  // ═══════════════════════════════════════
  //  CRUD
  // ═══════════════════════════════════════

  async findAll(limit = 50) {
    return this.prisma.referralLetter.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: { patient: { select: { familyName: true, givenName: true, mrn: true } }, fromDoctor: { select: { familyName: true, givenName: true, department: true } }, toDoctor: { select: { familyName: true, givenName: true } } },
    });
  }

  async findOne(id: string) {
    const letter = await this.prisma.referralLetter.findUnique({
      where: { id },
      include: { patient: { omit: PATIENT_SENSITIVE_OMIT }, fromDoctor: true, toDoctor: true },
    });
    if (!letter) throw new NotFoundException('의뢰서를 찾을 수 없습니다');
    return letter;
  }

  async findByPatient(patientId: string) {
    return this.prisma.referralLetter.findMany({
      where: { patientId },
      include: { fromDoctor: true, toDoctor: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findPending(department: string) {
    return this.prisma.referralLetter.findMany({
      where: { toDepartment: department, status: { in: ['SENT', 'RECEIVED'] } },
      include: { patient: { omit: PATIENT_SENSITIVE_OMIT }, fromDoctor: true },
      orderBy: [{ urgency: 'desc' }, { createdAt: 'asc' }],
    });
  }

  async update(id: string, content: string, userId: string) {
    const letter = await this.findOne(id);
    if (letter.status !== 'DRAFT') throw new ForbiddenException('서명 전 DRAFT 상태에서만 수정 가능합니다');
    if (letter.fromDoctorId !== userId) throw new ForbiddenException('작성자만 수정할 수 있습니다');

    return this.prisma.referralLetter.update({
      where: { id },
      data: { content, editedByDoctor: true, updatedAt: new Date() },
      include: { patient: { omit: PATIENT_SENSITIVE_OMIT }, fromDoctor: true, toDoctor: true },
    });
  }

  async sign(id: string, userId: string) {
    const letter = await this.findOne(id);
    if (letter.status !== 'DRAFT') throw new ForbiddenException('DRAFT 상태에서만 서명 가능합니다');
    if (letter.fromDoctorId !== userId) throw new ForbiddenException('작성자만 서명할 수 있습니다');

    const updated = await this.prisma.referralLetter.update({
      where: { id },
      data: { status: 'SIGNED', signedAt: new Date(), signedBy: userId },
      include: { patient: { omit: PATIENT_SENSITIVE_OMIT }, fromDoctor: true, toDoctor: true },
    });

    // 감사 로그
    await this.prisma.auditLog.create({
      data: { userId, action: 'UPDATE', resourceType: 'REFERRAL_LETTER', resourceId: id, changes: { action: 'SIGN' } },
    });

    // 협진 정본 생성/동기화 — 사람이 서명한 이 시점이 승인 게이트다(초안 생성 단계 아님)
    const consultationId = await this.ensureConsultation(letter);
    // 같은 시점이 제안의 결정 시점이다 — 서명된 본문과 AI 원본의 차이로 ACCEPTED/EDITED 가 갈린다
    const aiProposal = await this.decideDraftProposal(letter, userId);

    return { ...updated, consultationId, aiProposal };
  }

  async send(id: string, userId: string) {
    const letter = await this.findOne(id);
    if (letter.status !== 'SIGNED') throw new ForbiddenException('서명 후에만 전송 가능합니다');

    // 🔴 (2026-09-16 J1) 종전엔 상태만 커밋되고 알림은 `.catch(() => {})` 로 **조용히** 삼켜졌다.
    //    수신과 의사에게 의뢰서가 왔다는 신호는 이 알림 하나뿐인데, 위 상태 검사(SIGNED 에서만 전송)가
    //    **재전송을 막아** 의뢰서는 '전송됨'인데 수신과는 영영 모른다(E4 가 고친 자동 노쇼와 같은 모양).
    //    상태 전이와 알림을 한 트랜잭션에 — 알림이 실패하면 전송도 되돌려 다시 누를 수 있게 한다.
    const updated = await this.prisma.$transaction(async (tx) => {
      const sent = await tx.referralLetter.update({
        where: { id },
        data: { status: 'SENT' },
      });
      // 알림 (수신과 의사에게)
      if (letter.toDoctorId) {
        await tx.notification.create({
          data: {
            userId: letter.toDoctorId,
            type: 'REFERRAL',
            title: `${letter.fromDepartment} 협진 의뢰`,
            message: `${(letter.patient as any)?.familyName}${(letter.patient as any)?.givenName}님 의뢰서가 도착했습니다.`,
            refType: 'REFERRAL', refId: letter.id, // 스카우트: ref 누락 → 딥링크 가능하게
          },
        });
      }
      return sent;
    });

    await this.prisma.auditLog.create({
      data: { userId, action: 'UPDATE', resourceType: 'REFERRAL_LETTER', resourceId: id, changes: { action: 'SEND', toDepartment: letter.toDepartment } },
    });

    return updated;
  }

  async signAndSend(id: string, userId: string) {
    const letter = await this.findOne(id);
    if (letter.status !== 'DRAFT') throw new ForbiddenException('DRAFT 상태에서만 서명+전송 가능합니다');
    if (letter.fromDoctorId !== userId) throw new ForbiddenException('작성자만 서명할 수 있습니다');

    // 🔴 (2026-09-16 J1) `send` 와 같은 쌍둥이 — 서명·전송 상태만 커밋되고 수신과 알림은 조용히 삼켜졌다.
    //    위 상태 검사(DRAFT 에서만)가 재시도를 막아 **의뢰서는 전송됐는데 수신과는 모른다**.
    //    상태 전이와 알림을 한 트랜잭션에. 협진 정본 생성(ensureConsultation)은 밖에 둔다 —
    //    실패해도 서명을 되돌리지 않는다는 그 함수의 선언(그리고 응답이 consultationId=null 로 사실을 말함)을 지킨다.
    const updated = await this.prisma.$transaction(async (tx) => {
      const sent = await tx.referralLetter.update({
        where: { id },
        data: { status: 'SENT', signedAt: new Date(), signedBy: userId },
        include: { patient: { omit: PATIENT_SENSITIVE_OMIT }, fromDoctor: true, toDoctor: true },
      });
      if (letter.toDoctorId) {
        await tx.notification.create({
          data: {
            userId: letter.toDoctorId,
            type: 'REFERRAL',
            title: `${letter.fromDepartment} 협진 의뢰`,
            message: `${(letter.patient as any)?.familyName}${(letter.patient as any)?.givenName}님 의뢰서가 도착했습니다.`,
            refType: 'REFERRAL', refId: letter.id, // 스카우트: ref 누락 → 딥링크 가능하게
          },
        });
      }
      return sent;
    });

    // 협진 정본 생성/동기화 — 서명이 승인 게이트(초안 생성 단계가 아니다)
    const consultationId = await this.ensureConsultation(letter);
    const aiProposal = await this.decideDraftProposal(letter, userId);

    await this.prisma.auditLog.create({
      data: { userId, action: 'UPDATE', resourceType: 'REFERRAL_LETTER', resourceId: id, changes: { action: 'SIGN_AND_SEND' } },
    });

    return { ...updated, consultationId, aiProposal };
  }

  async reject(id: string, userId: string, reason: string) {
    const letter = await this.findOne(id);
    if (letter.status !== 'SENT') throw new ForbiddenException('SENT 상태에서만 거절 가능합니다');

    // 동시 처리(두 수신자가 동시에 거절/수신 처리)는 조건부 갱신으로 DB 가 판정한다
    const res = await this.prisma.referralLetter.updateMany({
      where: { id, status: 'SENT' },
      data: { status: 'REJECTED', rejectionReason: reason },
    });
    if (res.count === 0) stateChangedConflict(REFERRAL_TX_CTX, letter.status);
    const updated = await this.prisma.referralLetter.findUnique({ where: { id } });

    // 의뢰의에게 알림 — 🔴 사유는 선택이다(강제하면 거짓 사유가 쌓인다). 없으면 붙이지 않는다(종전 "…: undefined")
    const reasonSuffix = reason?.trim() ? `: ${reason.trim()}` : '';
    await this.prisma.notification.create({
      data: {
        userId: letter.fromDoctorId,
        type: 'REFERRAL',
        title: `협진 의뢰 거절`,
        message: `${letter.toDepartment}에서 의뢰를 거절했습니다${reasonSuffix}`,
        refType: 'REFERRAL', refId: letter.id,
      },
    }).catch(() => {});

    return updated;
  }

  /**
   * 의뢰서 폐기 = 그 초안을 쓰지 않기로 한 것. 🔴 제안 원장에는 `REJECTED` 로 남는다 —
   * 결정 없이 두면 나중에 `EXPIRED` 가 되어 "사람이 안 봤다"로 읽힌다(거부와 만료는 다른 사실이다).
   * 사유는 강제하지 않는다(필수로 강제하면 거짓 사유가 쌓인다) — 폐기 사유가 있으면 함께 남긴다.
   */
  async voidLetter(id: string, userId: string, reason: string) {
    const letter = await this.findOne(id);
    // 🔴 (2026-09-15 D1) 종전엔 상태도 작성자도 보지 않았다 — **이미 전송된 의뢰서**(수신 과가 보고 있는 것)를
    //    아무 의사·관리자가 폐기할 수 있었고, 거절·폐기된 것을 다시 폐기해 사유·시각이 덮어써졌다.
    //    폐기는 "그 초안을 쓰지 않기로 한 것"이라 전송 전(DRAFT·SIGNED)에만 성립한다.
    if (letter.status === 'VOIDED') return { ...letter, aiProposal: null };
    assertStateTransition(REFERRAL_TRANSITIONS, letter.status as ReferralLetterStatus, 'VOIDED', REFERRAL_TX_CTX);
    if (letter.fromDoctorId !== userId) {
      const me = await this.prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
      if (me?.role !== 'ADMIN') throw new ForbiddenException('작성자 본인 또는 관리자만 폐기할 수 있습니다');
    }
    const res = await this.prisma.referralLetter.updateMany({
      where: { id, status: letter.status },
      data: { status: 'VOIDED', rejectionReason: reason },
    });
    if (res.count === 0) stateChangedConflict(REFERRAL_TX_CTX, letter.status);
    const updated = await this.prisma.referralLetter.findUnique({ where: { id } });

    const proposalId = await this.findOpenProposal(id);
    let aiProposal: ReferralProposalOutcome | null = null;
    if (proposalId) {
      const rejectReason = reason ? `LETTER_DISCARDED · ${reason}` : 'LETTER_DISCARDED';
      try {
        await this.aiProposal.decide(proposalId, { decision: 'REJECTED', actorId: userId, reason: rejectReason });
        aiProposal = { id: proposalId, decision: 'REJECTED', recorded: true };
      } catch (e) {
        this.logger.error(`ReferralLetter ${id}: AI 제안 거부 기록 실패 — ${(e as Error).message}`);
        aiProposal = { id: proposalId, decision: 'REJECTED', recorded: false, reason: (e as Error).message };
      }
    }

    return { ...updated, aiProposal };
  }

  // ═══════════════════════════════════════
  //  PDF 생성 (HTML 기반)
  // ═══════════════════════════════════════

  async generateHtml(id: string): Promise<string> {
    const letter = await this.prisma.referralLetter.findUnique({
      where: { id },
      include: {
        patient: { select: { familyName: true, givenName: true, mrn: true, dateOfBirth: true, gender: true } },
        fromDoctor: { select: { familyName: true, givenName: true, department: true } },
        toDoctor: { select: { familyName: true, givenName: true, department: true } },
      },
    });
    if (!letter) throw new NotFoundException('의뢰서를 찾을 수 없습니다');

    const typeLabel: Record<string, string> = {
      CONSULTATION_REQUEST: '협 진 의 뢰 서',
      CONSULTATION_REPLY: '협 진 회 신 서',
      TRANSFER: '전 원 의 뢰 서',
      LAB_ORDER: '검 사 의 뢰 서',
      CHECKUP_REFERRAL: '외 래 의 뢰 서',
      MEDICAL_OPINION: '진 료 소 견 서',
    };
    const urgencyLabel: Record<string, string> = { ROUTINE: '일반', URGENT: '긴급', EMERGENT: '응급' };
    const age = letter.patient?.dateOfBirth ? ageOf(letter.patient.dateOfBirth) : '';
    const genderLabel = letter.patient?.gender === 'MALE' ? '남' : letter.patient?.gender === 'FEMALE' ? '여' : '';
    // XSS 방어: 사용자/DB 유래 필드는 HTML 컨텍스트로 보간되기 전 이스케이프(환자명·과명·문서번호 등).
    // 반환 HTML은 FE에서 sanitize 없이 dangerouslySetInnerHTML·인쇄(document.write)로 렌더되므로 서버가 유일 방어선.
    const patientName = `${esc(letter.patient?.familyName)}${esc(letter.patient?.givenName)}`;
    const fromDoctorName = `${esc(letter.fromDoctor?.familyName)}${esc(letter.fromDoctor?.givenName)}`;
    const toDoctorName = letter.toDoctor ? ` ${esc(letter.toDoctor.familyName)}${esc(letter.toDoctor.givenName)}` : '';
    const contentHtml = esc(letter.content).replace(/\n/g, '<br/>');
    const signedInfo = letter.signedAt ? `${fromDoctorName} (${esc(localeDateTimeText(new Date(letter.signedAt), 'ko-KR'))})` : '(미서명)';
    // 🔴 기관 정체는 정본 system_configs `hospital.*`(DB 행만). 종전엔 병원명·주소·대표전화가 이 HTML 에 **상수 사본**으로
    //    박혀 있어 설정을 바꿔도 따라오지 않았다(P12). 다른 기관에 건네는 문서라 미설정은 지어내지 않고 **미설정이라고** 찍는다.
    //    조회 실패는 삼키지 않는다(전파).
    const inst = await readHospitalConfig(this.prisma, ['hospital.name', 'hospital.address', 'hospital.phone'] as const);
    const instName = esc(inst['hospital.name'] ?? HOSPITAL_UNSET_KO['hospital.name']);
    const instAddress = esc(inst['hospital.address'] ?? HOSPITAL_UNSET_KO['hospital.address']);
    const instPhone = esc(inst['hospital.phone'] ?? HOSPITAL_UNSET_KO['hospital.phone']);

    return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
body { font-family: 'Malgun Gothic', sans-serif; max-width: 700px; margin: 0 auto; padding: 30px; font-size: 13px; color: #333; }
h1 { text-align: center; font-size: 20px; letter-spacing: 8px; margin: 10px 0 5px; }
.hospital { text-align: center; font-size: 14px; color: #1a56db; margin-bottom: 20px; }
table { width: 100%; border-collapse: collapse; margin: 10px 0; }
td, th { border: 1px solid #ccc; padding: 6px 10px; }
th { background: #f5f5f5; width: 100px; text-align: left; font-weight: 600; }
.content { min-height: 200px; padding: 15px; border: 1px solid #ccc; margin: 10px 0; line-height: 1.8; white-space: pre-wrap; }
.sign { text-align: right; margin-top: 30px; font-size: 12px; }
.footer { text-align: center; margin-top: 30px; font-size: 11px; color: #888; border-top: 1px solid #ddd; padding-top: 10px; }
.urgency-EMERGENT { color: #dc2626; font-weight: bold; }
.urgency-URGENT { color: #ea580c; font-weight: bold; }
.number { text-align: right; font-size: 11px; color: #666; }
</style></head><body>
<div class="hospital">${instName}</div>
<h1>${typeLabel[letter.type] ?? '의 뢰 서'}</h1>
<div class="number">문서번호: ${esc(letter.letterNumber ?? '-')}</div>
<table>
<tr><th>환자 성명</th><td>${patientName}</td><th>등록번호</th><td>${esc(letter.patient?.mrn)}</td></tr>
<tr><th>성별/나이</th><td>${genderLabel}/${age}세</td><th>생년월일</th><td>${letter.patient?.dateOfBirth ? new Date(letter.patient.dateOfBirth).toLocaleDateString('ko-KR') : '-'}</td></tr>
<tr><th>의뢰과</th><td>${esc(letter.fromDepartment)} ${fromDoctorName}</td><th>수신과</th><td>${esc(letter.toDepartment)}${toDoctorName}</td></tr>
<tr><th>긴급도</th><td class="urgency-${esc(letter.urgency)}" colspan="3">${urgencyLabel[letter.urgency] ?? esc(letter.urgency)}</td></tr>
</table>
<div class="content">${contentHtml}</div>
<div class="sign">작성일: ${new Date(letter.createdAt).toLocaleDateString('ko-KR')}<br/>서명: ${signedInfo}</div>
<div class="footer">${instName} | ${instAddress} | ${instPhone}<br/>본 문서는 전자의무기록 시스템에서 생성되었습니다.</div>
</body></html>`;
  }

  // ═══════════════════════════════════════
  //  Private Helpers
  // ═══════════════════════════════════════

  private async buildContext(patientId: string, encounterId?: string, consultationId?: string) {
    const [patient, encounter, diagnoses, labs, meds, vitals, admission, problems] = await Promise.all([
      this.prisma.patient.findUnique({
        where: { id: patientId },
        select: { familyName: true, givenName: true, mrn: true, dateOfBirth: true, gender: true },
      }),
      encounterId ? this.prisma.encounter.findUnique({
        where: { id: encounterId },
        select: { subjective: true, objective: true, assessment: true, plan: true, createdAt: true, doctor: { select: { familyName: true, givenName: true, department: true } } },
      }) : null,
      this.prisma.encounterDiagnosis.findMany({
        where: { encounter: { patientId } },
        include: { diagnosisCode: { select: { code: true, nameKo: true } } },
        orderBy: { encounter: { createdAt: 'desc' } },
        take: 5,
      }),
      this.prisma.labResult.findMany({
        where: { patientId },
        include: { items: { select: { testName: true, value: true, unit: true, flag: true }, where: { flag: { not: 'N' } } } },
        orderBy: { createdAt: 'desc' },
        take: 3,
      }),
      this.prisma.prescription.findMany({
        where: { encounter: { patientId }, type: 'MEDICATION', status: 'ACTIVE' },
        select: { dosage: true, frequency: true, medicationCode: { select: { nameKo: true } } },
        take: 10,
      }),
      this.prisma.preVisitVitals.findFirst({
        where: { patientId },
        orderBy: { measuredAt: 'desc' },
        select: { systolicBp: true, diastolicBp: true, heartRate: true, temperature: true, spo2: true, measuredAt: true },
      }),
      this.prisma.admission.findFirst({
        where: { patientId, status: 'ADMITTED' },
        include: { bed: { include: { ward: { select: { name: true } } } } },
      }),
      this.prisma.problemList.findMany({
        where: { patientId, status: { in: ['ACTIVE', 'CHRONIC'] } },
        select: { description: true },
        take: 10,
      }),
    ]);

    const allergies = await this.prisma.allergy.findMany({
      where: { patientId, isActive: true },
      select: { allergen: true, severity: true },
    });

    return {
      patient: {
        name: patient ? `${patient.familyName}${patient.givenName}` : '',
        mrn: patient?.mrn,
        age: patient?.dateOfBirth ? ageOf(patient.dateOfBirth) : null,
        gender: patient?.gender,
        allergies: allergies.map(a => `${a.allergen}(${a.severity})`),
      },
      currentEncounter: encounter ? {
        date: encounter.createdAt,
        department: encounter.doctor?.department,
        doctor: `${encounter.doctor?.familyName}${encounter.doctor?.givenName}`,
        subjective: encounter.subjective,
        objective: encounter.objective,
        assessment: encounter.assessment,
        plan: encounter.plan,
      } : null,
      diagnoses: diagnoses.map(d => ({ code: d.diagnosisCode?.code, name: d.diagnosisCode?.nameKo })),
      labResults: labs.flatMap(l => l.items.map(i => ({ testName: i.testName, value: i.value, flag: i.flag }))),
      medications: meds.map(m => ({ name: m.medicationCode?.nameKo, dosage: m.dosage, frequency: m.frequency })),
      vitals: vitals ? { bp: `${vitals.systolicBp}/${vitals.diastolicBp}`, hr: vitals.heartRate, temp: vitals.temperature, spo2: vitals.spo2 } : null,
      admission: admission ? { ward: (admission.bed as any)?.ward?.name, room: (admission.bed as any)?.roomNumber, bed: (admission.bed as any)?.bedNumber } : null,
      problemList: problems.map(p => p.description),
    };
  }

  private buildPrompt(type: LetterType, toDept: string, urgency?: string, additionalNote?: string, ctx?: any): string {
    const typeInstructions: Record<string, string> = {
      CONSULTATION_REQUEST: '의뢰 사유, 현재까지의 경과, 타과에 묻고 싶은 임상 질문을 명확히 기술하세요. [의뢰 사유]와 [임상 질문] 섹션으로 나누세요.',
      CONSULTATION_REPLY: '의뢰 내용에 대한 소견, 권고 사항, 추가 검사 필요 여부를 기술하세요. [소견]과 [권고 사항] 섹션으로 나누세요.',
      TRANSFER: '전원 사유, 환자 상태 요약, 이송 시 주의사항을 기술하세요.',
      LAB_ORDER: '검사 목적, 임상 의심 진단, 환자 주의사항(알레르기/금식 등)을 기술하세요.',
      CHECKUP_REFERRAL: '검진 이상 소견, 추가 검사 필요 여부, 의뢰 사유를 기술하세요.',
      MEDICAL_OPINION: '진단, 치료 경과, 현재 상태, 향후 치료 계획을 기술하세요.',
    };

    const contextStr = ctx ? `\n[환자 데이터]\n${JSON.stringify(ctx, null, 0).slice(0, 1500)}` : '';

    return `당신은 한국 병원의 의무기록 작성 보조 AI입니다. 반드시 한국어로만 작성하세요.

[작성 규칙]
- 한국어 의학 용어 사용 (영어 병명은 괄호 안에 병기)
- 간결하고 객관적인 의무기록 문체
- 주관적 판단 배제, 사실 기반 기술
- 300~500자 이내
- 환자 이름이 필요한 자리는 반드시 [환자명] 그대로 표기 (임의 이름 창작 금지)
- ${typeInstructions[type] ?? '의뢰 내용을 기술하세요.'}

[수신과] ${toDept}
[긴급도] ${urgency ?? 'ROUTINE'}
${additionalNote ? `[추가 참고] ${additionalNote}` : ''}
${contextStr}

의뢰서 초안:`;
  }

  private buildFallbackDraft(type: LetterType, toDept: string, ctx: any): string {
    const patientInfo = ctx?.patient ? `환자: ${ctx.patient.name} (${ctx.patient.mrn}), ${ctx.patient.age}세 ${ctx.patient.gender === 'MALE' ? '남' : ctx.patient.gender === 'FEMALE' ? '여' : '성별 미상'}` : '';
    const dxInfo = ctx?.diagnoses?.length ? `\n진단: ${ctx.diagnoses.map((d: any) => `${d.name}(${d.code})`).join(', ')}` : '';
    const medInfo = ctx?.medications?.length ? `\n투약: ${ctx.medications.map((m: any) => m.name).join(', ')}` : '';
    const allergyInfo = ctx?.patient?.allergies?.length ? `\n알레르기: ${ctx.patient.allergies.join(', ')}` : '';

    return `[의뢰 사유]\n${toDept} 진료 의뢰합니다.\n\n[환자 정보]\n${patientInfo}${dxInfo}${medInfo}${allergyInfo}\n\n[임상 질문]\n(작성해주세요)`;
  }

  private async generateLetterNumber(type: string): Promise<string> {
    const prefix = type === 'CONSULTATION_REQUEST' ? 'CON' : type === 'TRANSFER' ? 'TRF' : type === 'CONSULTATION_REPLY' ? 'RPL' : 'REF';
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const count = await this.prisma.referralLetter.count({
      where: { createdAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) } },
    });
    return `${prefix}-${today}-${String(count + 1).padStart(3, '0')}`;
  }
}
