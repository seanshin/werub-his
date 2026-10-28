import { Controller, Get, Post, Patch, Param, Body, Query, Res, UseGuards, ParseUUIDPipe, Optional, Logger } from '@nestjs/common';
import { Response } from 'express';
import { Readable } from 'stream';
import { createHash } from 'node:crypto';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiExcludeEndpoint } from '@nestjs/swagger';
import { UserRole, AuditAction } from '@prisma/client';
import { MedicalAiService } from './medical-ai.service';
import { PatientBriefService } from './patient-brief.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { assertBodySize } from '../../common/util/assert-body-size';
import { unfetchableByExternalAi } from './image-url-reachability';
import { AuditService } from '../audit/audit.service';
import { AuditResource, NoAudit, AuditAiRead } from '../audit/no-audit.decorator';
import { UUID_RE, ZERO_UUID } from '../audit/audit-routes';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import {
  AiChatDto,
  AiSummarizeDto,
  AiDiagnoseDto,
  AiDrugInfoDto,
  AiExplainDto,
  AiDraftDto,
  AiTriageDto,
  AiReferenceDto,
  AiFeedbackDto,
  AiFeedbackCreateDto,
  AiRealtimeDdxDto,
  AiAutoSoapDto,
  AiInterpretLabDto,
  AiRecommendDrugsDto,
  AiChartQaDto,
  AiPatientEducationDto,
  AiClinicalQaDto,
  AiClinicalTranslateDto,
  AiDrugInteractionsDto,
  AiKnowledgeIndexDto,
  AiKnowledgeSearchDto,
  AiOrchestratorRunDto,
  AiTriageFollowUpDto,
  // v2.48.0
  AiCliExecuteDto,
  AiCliSuggestDto,
  AiCodeSearchDto,
  AiCodeMappingDto,
  AiReasoningChainDto,
  AiAutoRecordDto,
  AiPredictReadmissionDto,
  AiPredictComplicationDto,
  AiPredictAdverseDrugDto,
  AiVisionAnalyzeDto,
  AiVisionCompareDto,
  IdCardOcrDto,
  AiVisionMedicalAnalyzeDto,
  AiCounselingChatDto,
  AiMeetingAnalyzeDto,
  AiDraftAppliedDto,
  AiDraftOutcomeDto,
} from './dto/medical-ai.dto';
import { EDIT_DISTANCE_CAP, isEditDistanceCapped, levenshteinCapped } from '../../common/util/edit-distance';
import { AiProposalService } from '../ai-proposal/ai-proposal.service';
import type { AiProposalKind, AiProposalSourceValue } from '@hospital-run/shared';
import { WRITING_CRAFT_PROMPT_VERSION } from './medical-ai.service';
import { parseAiChatInput } from '@hospital-run/shared';

/** 감사 resourceId 는 uuid 컬럼 — 비UUID를 넣으면 저장 실패(poison) 하므로 완전일치만 채택 */
const UUID_FULL = new RegExp(`^${UUID_RE}$`, 'i');

/**
 * `writing/craft` 는 **범용 문서 작성 스킬**이다(컨트롤러 설명: 퇴원요약/소견서/의뢰서).
 * 요청에서 문서 종류를 구분하는 필드는 기존 `style` 하나뿐이라 그것을 그대로 판별자로 쓴다.
 *
 * 🔴 **어휘를 지어내지 않는다** — 이 표에 없는 style 은 제안을 만들지 않고 `proposalSkipped:'KIND_UNMAPPED'`
 *    로 그 사실을 말한다. 소견서·의뢰서에 kind 를 붙이는 것은 각 화면이 실제로 그 style 로 부르기 시작할 때
 *    (그리고 대상 자원을 밝힐 수 있을 때) 한다 — 지금 매핑을 넣으면 아무도 만들지 않는 어휘가 원장에 남는다.
 */
export const WRITING_CRAFT_PROPOSAL_KIND: Readonly<Record<string, AiProposalKind>> = Object.freeze({
  medical_discharge: 'DISCHARGE_DRAFT',
});

/**
 * 초안 본문 직렬화 계약(SOAP) — 🔴 **서버 `content` 와 FE `finalText` 가 같은 규칙을 써야** 편집거리가 사실이 된다.
 *    FE 정본: `apps/web/.../AiAssistantPanel.tsx` 적용 버튼 · `encounter/new/page.tsx` onApplySoap.
 *    한쪽만 바꾸면 "고치지 않았는데 편집거리 수백"이 나온다(같은 사실에 규칙이 둘 = P12).
 */
export function serializeSoapDraft(assessment: unknown, plan: unknown): string {
  const a = typeof assessment === 'string' ? assessment : '';
  const p = Array.isArray(plan) ? plan.filter((x) => typeof x === 'string').join('\n') : typeof plan === 'string' ? plan : '';
  return [a, p].filter((s) => s && s.trim()).join('\n');
}

/**
 * 어시스턴트 초안 → 제안 원장 종류(2026-10-02).
 * 🔴 **어휘를 지어내지 않는다** — 원장에 이미 있는 종류에 맞는 것만. `/설명`(환자 설명문)·`/문서`(문서 종류 미상)는
 *    맞는 종류가 없어 `KIND_UNMAPPED` 로 그 사실을 말한다.
 */
export function chatProposalKind(cmd: string | null, arg: string): AiProposalKind | null {
  if (cmd === '/요약' || cmd === '/자동기록') return 'SOAP_DRAFT';
  if (cmd === '/초안') {
    const t = arg.trim().toLowerCase();
    if (!t || t === 'progress_note' || t === 'soap') return 'SOAP_DRAFT';
    if (t === 'discharge_summary' || t === 'discharge') return 'DISCHARGE_DRAFT';
    if (t === 'referral') return 'REFERRAL_DRAFT';
    return null;
  }
  return null;
}

/** 초안 본문(화면 복사본과 같은 규칙 — SOAP 는 `S: …` 줄) — 없으면 빈 문자열(EMPTY_DRAFT) */
export function chatDraftContent(type: string, data: unknown): string {
  const d = data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
  const str = (x: unknown) => (typeof x === 'string' ? x : '');
  const soap = (x: unknown) => {
    if (!x || typeof x !== 'object') return str(x);
    const o = x as Record<string, unknown>;
    return ([['S', o.subjective], ['O', o.objective], ['A', o.assessment], ['P', o.plan]] as const)
      .filter(([, v]) => typeof v === 'string' && v.trim()).map(([k, v]) => `${k}: ${v as string}`).join('\n');
  };
  if (type === 'summarize') return soap(d.summary);
  if (type === 'auto-record') return soap(d.soap);
  if (type === 'draft') return str(d.content) || str(d.draft) || str(d.text);
  return '';
}

/** 어시스턴트 요청 계약 버전 — 프롬프트 본문은 상류에 있다(HIS 가 보내는 명령·맥락의 계약) */
export const AI_CHAT_REQUEST_VERSION = 'ai-chat-request-v1';

/** 스킬 응답에 붙는 제안 결과 — `proposalId:null` 의 **이유를 구분해서** 말한다(실패 ≠ 만들지 않음) */
export interface SkillProposalResult {
  proposalId: string | null;
  /** 만들려다 실패했다(제안 원장에 남지 않았다 — 스킬 응답은 막지 않는다) */
  proposalError?: 'PROPOSAL_CREATE_FAILED';
  /** 애초에 만들지 않았다 — 산출물이 없거나(UNAVAILABLE·빈 초안) 대상·종류를 밝힐 수 없다 */
  proposalSkipped?: 'UNAVAILABLE' | 'EMPTY_DRAFT' | 'KIND_UNMAPPED' | 'TARGET_UNIDENTIFIED' | 'LEDGER_UNAVAILABLE';
}

@ApiTags('Medical AI')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/v1/ai')
export class MedicalAiController {
  private readonly logger = new Logger(MedicalAiController.name);

  constructor(
    private readonly aiService: MedicalAiService,
    @Optional() private readonly audit?: AuditService,
    @Optional() private readonly brief?: PatientBriefService,
    /** AI 제안 원장(P1). 미주입이면 제안을 만들지 못했다는 사실을 응답이 말한다(조용히 넘기지 않는다) */
    @Optional() private readonly proposals?: AiProposalService,
    /** 퇴원요약 제안의 환자 귀속 — 입원 화면에는 patientId 가 없어 서버가 admissionId 로 찾는다(추정 아님·조회) */
    @Optional() private readonly prisma?: PrismaService,
  ) {}

  /**
   * 스킬 초안 → 제안 원장 1행(P1 · 기획서 §2.1).
   *
   * 🔴 제안 생성 실패가 **스킬 응답을 막지 않는다** — 초안은 이미 만들어졌고, 못 남긴 것은 기록이다.
   *    대신 `proposalId:null` 과 이유 코드로 **그 사실을 말한다**(성공처럼 말하지 않는다).
   * 🔴 지어내지 않는다 — `confidence`·`modelRef` 는 상류/모델이 보고한 값만 넘긴다(기본값 없음).
   */
  private async createSkillProposal(input: {
    kind: AiProposalKind;
    targetType: string;
    targetId?: string | null;
    targetKey?: string | null;
    patientId?: string | null;
    content: string;
    modelRef?: string | null;
    promptVersion?: string | null;
    inputSnapshotHash?: string | null;
    confidence?: number | null;
    source: AiProposalSourceValue;
    reasonCode?: string | null;
    createdBy?: string | null;
  }): Promise<SkillProposalResult> {
    if (!this.proposals) return { proposalId: null, proposalSkipped: 'LEDGER_UNAVAILABLE' };
    // 🔴 산출물이 없으면 제안이 아니다 — UNAVAILABLE·빈 초안은 만들지 않는다("없음"을 초안으로 저장하지 않는다)
    if (input.source === 'UNAVAILABLE') return { proposalId: null, proposalSkipped: 'UNAVAILABLE' };
    if (!input.content.trim()) return { proposalId: null, proposalSkipped: 'EMPTY_DRAFT' };
    const targetId = input.targetId && UUID_FULL.test(input.targetId) ? input.targetId : undefined;
    if (!targetId && !input.targetKey) return { proposalId: null, proposalSkipped: 'TARGET_UNIDENTIFIED' };
    try {
      const p = await this.proposals.create({
        kind: input.kind,
        targetType: input.targetType,
        ...(targetId ? { targetId } : {}),
        ...(targetId ? {} : { targetKey: input.targetKey ?? null }),
        patientId: input.patientId && UUID_FULL.test(input.patientId) ? input.patientId : null,
        content: input.content,
        modelRef: input.modelRef ?? null,
        promptVersion: input.promptVersion ?? null,
        inputSnapshotHash: input.inputSnapshotHash ?? null,
        confidence: typeof input.confidence === 'number' && Number.isFinite(input.confidence) ? input.confidence : null,
        source: input.source,
        reasonCode: input.reasonCode ?? null,
        createdBy: input.createdBy ?? null,
      });
      return { proposalId: p.id };
    } catch (e) {
      this.logger.warn(`AiProposal 생성 실패(${input.kind}): ${e instanceof Error ? e.message : String(e)}`);
      return { proposalId: null, proposalError: 'PROPOSAL_CREATE_FAILED' };
    }
  }

  /**
   * 🔴 AI 외부전송 감사 정본(W8-R6).
   * 원 결함: 운영 실측 `resource_type='Ai'` 41건이 **전량** `resource_id=00000000-…` 이고
   * changes 는 최상위 필드명뿐이었다 — 예: `{"fields":{"new":"patientId,subjective"}}` 10건.
   * body 에 환자가 들어 있는데도 "누구의" 가 남지 않았고, resourceType 'Ai' 는 "무엇을" 도 말하지 못했다.
   *   → 행위는 `@AuditResource('Ai…')` 로 특정하고, 환자를 아는 건만 resourceId 로 귀속한다.
   *   → **모르는 환자는 추정하지 않는다**(ZERO_UUID 유지 — 빈 값이 틀린 값보다 낫다).
   * 이 헬퍼를 쓰는 라우트는 `@NoAudit()` 로 인터셉터 기본행을 끈다(같은 사실에 감사행이 둘이 되는 것을 막음).
   */
  /** `k=v;k=v` 요약 — 감사 changes.egress.new 의 정본 형태(skillMetrics·draftMetrics 가 이 형태를 판다) */
  private egressSummary(meta: Record<string, string | number | boolean | undefined | null>): string {
    return Object.entries(meta)
      .filter(([, v]) => v !== undefined && v !== null && v !== '')
      .map(([k, v]) => `${k}=${v}`)
      .join(';');
  }

  private auditAiEgress(
    userId: string | undefined,
    resourceType: string,
    patientId: string | undefined,
    meta: Record<string, string | number | boolean | undefined>,
  ) {
    if (!userId) return;
    const summary = this.egressSummary(meta);
    const bound = patientId && UUID_FULL.test(patientId) ? patientId : ZERO_UUID;
    void this.audit
      ?.log({
        userId,
        action: AuditAction.CREATE,
        resourceType,
        resourceId: bound,
        changes: { egress: { old: null, new: summary || '(meta 없음)' } },
      })
      // 🔴 (2026-09-15 U1) 종전 `.catch(() => {})` — AI 로 환자 데이터가 나간 사실의 원장이 조용히 비었다.
      //    전파하지 않는 근거: 호출부가 `void` 로 부르고 AI 호출은 이미 끝났거나 진행 중이라, 여기서 던지면 사용자는
      //    이미 받은 AI 결과를 실패로 받는다(원장 누락은 되돌려지지 않는다). 대신 누락을 로그로 남겨 운영이 원장 공백을 알게 한다.
      .catch((err) =>
        this.logger.warn(`AI egress audit write failed (${resourceType}, patient ${bound}, user ${userId}): ${err instanceof Error ? err.message : String(err)}`),
      );
  }

  /**
   * 🔴 초안≠확정 — AI 초안이 폼에 적용된 사실을 감사 원장에 남긴다(§7.6-b 프로비넌스 이전).
   * Encounter.aiScribed 는 스크라이브 전용이라 진료 AI 보조·퇴원요약 초안은 적용 후 흔적이 없었다.
   * 스키마 일반화 전까지 이 행이 유일한 흔적이다 — 실패해도 업무는 막지 않는다(FE 는 fire-and-forget).
   * resourceId 규약: 환자를 알면 patientId, 모르면 ZERO_UUID(추정 금지).
   */
  @Post('draft-applied')
  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE, UserRole.PHARMACIST, UserRole.RECEPTIONIST, UserRole.ADMIN_STAFF, UserRole.CRM_MANAGER, UserRole.CRM_STAFF)
  @NoAudit()
  @ApiOperation({ summary: 'AI 초안 적용 프로비넌스 기록(감사 원장)' })
  async draftApplied(@Body() dto: AiDraftAppliedDto, @CurrentUser('id') userId: string) {
    const bound = dto.patientId && UUID_FULL.test(dto.patientId) ? dto.patientId : ZERO_UUID;
    let recorded = false;
    try {
      await this.audit?.log({
        userId,
        action: AuditAction.UPDATE,
        resourceType: 'AiDraftApply',
        resourceId: bound,
        changes: {
          aiDraftApply: {
            old: null,
            new: {
              resourceType: dto.resourceType, source: dto.source, resourceId: dto.resourceId ?? null,
              field: dto.field ?? null, model: dto.model ?? null, promptVersion: dto.promptVersion ?? null, textLength: dto.textLength,
            },
          },
        },
      });
      recorded = !!this.audit;
    } catch { recorded = false; }
    // 🔴 기록 여부를 정직하게 돌려준다 — 화면은 "감사기록에 남았습니다"를 recorded 가 true 일 때만 말한다
    return { data: { recorded } };
  }

  /**
   * 🔴 무수정 승인율(human_edit_ratio) — 기획서 §4.5·§4.6. 스키마 없이 **감사 원장**으로 센다.
   *
   * 규약(어겼다가 걸린 것들을 그대로 막는다):
   *   · 본문(draftText·finalText)은 **계산에만** 쓴다 — 응답에도 감사행에도 글자는 한 자도 싣지 않는다(PHI).
   *   · 초안이 비어 있으면 편집거리는 `0` 이 아니라 **`null` + reason NO_DRAFT** 다. 0 은 "손대지 않았다"라는
   *     다른 사실이고, 그걸로 무수정 승인율을 부풀리는 것이 이 지표에서 가장 흔한 거짓말이다.
   *   · 캡(앞 1500자)에 걸리면 거리는 **하한**이다 — `capped:true` 와 감사 meta 의 note 로 그렇게 말한다.
   *     캡에 걸렸는데 앞부분만 같은 경우 `unchanged` 로 접지 않는다(전문 동일성까지 확인한다).
   *   · 기록 실패는 `recorded:false` 로 정직하게 돌려준다(계산값은 그대로 준다 — 화면은 "미기록"이라 말한다).
   */
  @Post('draft-outcome')
  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE, UserRole.PHARMACIST, UserRole.RECEPTIONIST, UserRole.ADMIN_STAFF, UserRole.CRM_MANAGER, UserRole.CRM_STAFF)
  @NoAudit()
  @ApiOperation({ summary: 'AI 초안 무수정 승인율 계측(편집 거리만 · 본문 미저장)' })
  async draftOutcome(@Body() dto: AiDraftOutcomeDto, @CurrentUser('id') userId: string) {
    const draftText = dto.draftText ?? '';
    const finalText = dto.finalText ?? '';
    const draftLen = draftText.length;
    const finalLen = finalText.length;
    const noDraft = draftText.trim().length === 0;
    const capped = !noDraft && isEditDistanceCapped(draftText, finalText);
    const editDistance = noDraft ? null : levenshteinCapped(draftText, finalText);
    // 🔴 캡에 걸린 경우 앞 1500자만 같아도 거리는 0 이 된다 — 전문이 같을 때만 '무수정'이라 말한다
    const unchanged = editDistance === 0 && draftText === finalText;

    const bound = dto.patientId && UUID_FULL.test(dto.patientId) ? dto.patientId : ZERO_UUID;
    let recorded = false;
    try {
      if (this.audit && userId) {
        await this.audit.log({
          userId,
          action: AuditAction.CREATE,
          resourceType: 'AiDraftOutcome',
          resourceId: bound,
          changes: {
            egress: {
              old: null,
              new: this.egressSummary({
                resourceType: dto.resourceType,
                source: dto.source,
                field: dto.field,
                editDistance: editDistance ?? undefined,
                draftLen,
                finalLen,
                unchanged,
                capped,
                reason: noDraft ? 'NO_DRAFT' : undefined,
                note: capped ? `편집거리 하한(앞 ${EDIT_DISTANCE_CAP}자만 비교)` : undefined,
              }),
            },
          },
        });
        recorded = true;
      }
    } catch { recorded = false; }

    return {
      data: {
        recorded,
        editDistance,
        draftLen,
        finalLen,
        unchanged,
        capped,
        ...(noDraft ? { reason: 'NO_DRAFT' as const } : {}),
      },
    };
  }

  /**
   * 무수정 승인율 관제 — `AiDraftApply`(적용) · `AiDraftOutcome`(확정 시 편집거리) 감사행을 센다.
   * 🔴 분모: `unchanged` 는 **outcomes** 로 나눈다(applied 가 아니다 — 적용만 하고 확정 계측이 안 온 건이 있다).
   *    outcomes 가 0이면 중앙값은 `null` 이고 화면은 '산출 불가'로 그린다(0 을 만들어 내지 않는다).
   */
  @Get('draft-metrics')
  @Roles(UserRole.ADMIN, UserRole.EXECUTIVE)
  @ApiOperation({ summary: 'AI 초안 적용·무수정 승인율 계측(감사 원장 기준)' })
  async draftMetrics(@Query('days') days?: string) {
    const d = Math.min(Math.max(Number(days) || 30, 1), 180);
    return { data: await this.aiService.draftMetrics(d) };
  }

  /** 스킬 봉투(출력 계약)에서 감사·계측용 결과 메타를 뽑는다 — source·latency·검증 실패 규칙 */
  private outcomeMeta(r: unknown): Record<string, string | number | boolean | undefined> {
    const e = (r ?? {}) as { source?: string; reason?: string; latencyMs?: number; verify?: { failed?: string[] } };
    return { source: e.source, reason: e.reason, latencyMs: e.latencyMs, verifyFailed: e.verify?.failed?.length ? e.verify.failed.join('|') : undefined };
  }

  /**
   * 환자 AI 브리핑(하이브리드 배치 A · 결정론 · LLM 없음) — 캐시가 없으면 lazy 계산. `refresh=1` 강제 재계산.
   * 열람은 환자 지목 조회라 감사 대상(인터셉터 READ · resourceId=patientId).
   */
  @AuditAiRead('AiPatientBrief')
  @Get('brief/:patientId')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.PHARMACIST, UserRole.ADMIN)
  @ApiOperation({ summary: '환자 AI 브리핑(배치 사전계산·결정론)' })
  async patientBrief(@Param('patientId', ParseUUIDPipe) patientId: string, @Query('refresh') refresh?: string) {
    if (!this.brief) return { data: null, meta: { unavailable: 'PatientBriefService 미주입' } };
    return { data: await this.brief.get(patientId, { refresh: refresh === '1' }) };
  }

  @Get('skill-metrics')
  @Roles(UserRole.ADMIN, UserRole.EXECUTIVE)
  @ApiOperation({ summary: '진료 보조 스킬 계측(호출 N·source 3상태·지연 p50/p95·검증 폐기 사유)' })
  async skillMetrics(@Query('days') days?: string) {
    const d = Math.min(Math.max(Number(days) || 30, 1), 180);
    return { data: await this.aiService.skillMetrics(d) };
  }

  /**
   * 🔴 스킬 품질 임계 판정(기획서 §6-1 사람 게이트를 화면으로 내린 것) — 관제와 **진료 보조 패널이 같은 값을 읽는다**.
   *    그래서 DOCTOR 도 읽을 수 있어야 한다(진료부가 근거를 못 보면 임계를 정할 수 없다).
   *    임계·조치 기본은 미설정·전부 OFF — 이 EP 는 실측(호출 N·AI 통과 N)과 분모를 보여줄 뿐 스스로 판정하지 않는다.
   */
  @Get('skill-quality')
  @Roles(UserRole.ADMIN, UserRole.EXECUTIVE, UserRole.DOCTOR)
  @ApiOperation({ summary: 'AI 스킬 품질 임계 판정(실측 통과율+분모 · 조치 OFF/WARN/BLOCK · 표본 부족은 판정 보류)' })
  async skillQuality(@Query('days') days?: string) {
    const d = Math.min(Math.max(Number(days) || 30, 1), 180);
    return { data: await this.aiService.skillQuality(d) };
  }

  @Get('status')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'AI 서버 상태 확인' })
  async getStatus() {
    const stats = await this.aiService.getStatus();
    return { data: stats };
  }

  @Post('chat')
  @Roles(UserRole.DOCTOR, UserRole.NURSE)
  @NoAudit() // 사유: 아래 auditAiEgress 로 대체(환자 귀속·명령·출처 기록) — 인터셉터 기본행과 이중 기록 방지
  @ApiOperation({ summary: 'AI 어시스턴트 (슬래시 명령 — 정본 shared AI_CHAT_COMMANDS)' })
  async chat(@Body() dto: AiChatDto, @CurrentUser() user?: { id?: string; role?: string }) {
    /**
     * 🔴 (2026-10-02) 종전엔 사용자도 환자도 몰랐다 — 감사가 필드명(`message,context`)뿐이라 어떤 환자의 기록 문장이
     *    외부 AI 로 나갔는지 원장이 말하지 못했다. 이제 명령·환자·출처를 남긴다(본문은 남기지 않는다 · 글자 수만).
     */
    const parsed = parseAiChatInput(dto.message);
    const patientId = dto.context?.patientId;
    this.auditAiEgress(user?.id, 'AiChat', patientId, {
      cmd: parsed.cmd?.cmd ?? (parsed.token ? 'UNKNOWN' : 'CHAT'),
      argChars: parsed.arg.length,
      hasSoap: !!dto.context?.soap,
    });
    const result = await this.aiService.processCommand(dto.message, dto.context, { role: user?.role });
    /**
     * 초안 명령의 산출물 → 제안 원장(2026-10-02). 🔴 종전엔 어시스턴트 초안이 **어디에도 남지 않았다** —
     * 같은 SOAP 초안이 진료 화면(`auto-soap`)에서 나오면 원장에 남고 어시스턴트에서 나오면 사라졌다.
     * 대상: 진료가 있으면 그 Encounter, 없으면 "이 환자의 미확정 진료"(auto-soap 과 같은 규약) · 환자도 모르면 TARGET_UNIDENTIFIED.
     * 퇴원요약은 입원을 모르므로 남기지 않는다(대상을 지어내지 않는다) · 생성 실패는 응답을 막지 않고 코드로 말한다.
     */
    let proposal: SkillProposalResult | undefined;
    if (result.draft && result.source !== null) {
      const kind = chatProposalKind(result.cmd, parsed.arg);
      if (!kind) {
        proposal = { proposalId: null, proposalSkipped: 'KIND_UNMAPPED' };
      } else {
        const d = (result.data && typeof result.data === 'object' ? result.data : {}) as Record<string, unknown>;
        const encounterTarget = kind !== 'DISCHARGE_DRAFT';
        proposal = await this.createSkillProposal({
          kind,
          targetType: encounterTarget ? 'Encounter' : 'Admission',
          targetId: encounterTarget ? dto.context?.encounterId ?? null : null,
          targetKey: encounterTarget && patientId ? `encounter-pending:patient:${patientId}` : null,
          patientId: patientId ?? null,
          content: chatDraftContent(result.type, result.data),
          // 🔴 상류가 보고한 모델만 — 없으면 null(미보고)
          modelRef: typeof d.model_used === 'string' ? d.model_used : typeof d.model === 'string' ? d.model : null,
          promptVersion: AI_CHAT_REQUEST_VERSION,
          // 입력 스냅샷 = 실제로 나간 명령문 + 작성 중 SOAP(있으면) 의 sha256
          inputSnapshotHash: createHash('sha256').update(`${dto.message}\n${dto.context?.soap ? JSON.stringify(dto.context.soap) : ''}`).digest('hex'),
          confidence: typeof d.confidence === 'number' ? d.confidence : null,
          source: result.source,
          reasonCode: result.detail ?? null,
          createdBy: user?.id ?? null,
        });
      }
    }
    this.auditAiEgress(user?.id, 'AiChatOutcome', patientId, {
      cmd: result.cmd ?? 'CHAT',
      source: result.source ?? 'NOT_CALLED',
      reason: result.reason,
      ...(proposal ? { proposal: proposal.proposalId ? 'CREATED' : proposal.proposalError ?? proposal.proposalSkipped } : {}),
    });
    return { data: proposal ? { ...result, proposal } : result };
  }

  @Post('id-ocr')
  // 🔴 (2026-09-16 K3) 신분증 스캔은 **접수 데스크의 행위**인데 원무가 빠져 있었다 — 부르는 화면은
  //    `/reception`(nav 에 RECEPTIONIST 포함)이다. 동의 게이트(CONSENT_REQUIRED)는 그대로 둔다.
  @Roles(UserRole.ADMIN, UserRole.NURSE, UserRole.RECEPTIONIST)
  @AuditResource('AiIdCardOcr')
  @ApiOperation({ summary: '신분증 OCR(이름/주민번호/주소) — 이미지 비저장, 동의 필수' })
  async idOcr(@Body() dto: IdCardOcrDto) {
    if (!dto.consent) {
      return { error: { code: 'CONSENT_REQUIRED', message: '신분증 OCR 처리 동의가 필요합니다.' } };
    }
    const data = await this.aiService.idCardOcr(dto.image, dto.docType ?? 'RRN_CARD');
    return { data }; // ⚠️ 이미지는 저장하지 않음(메모리 처리 후 폐기)
  }

  @Post('summarize')
  @Roles(UserRole.DOCTOR, UserRole.ADMIN, UserRole.NURSE)
  @ApiOperation({ summary: 'SOAP 자동 구조화' })
  async summarize(@Body() dto: AiSummarizeDto) {
    return { data: await this.aiService.summarize(dto.text, dto.specialty) };
  }

  @Post('diagnose')
  @Roles(UserRole.DOCTOR, UserRole.ADMIN, UserRole.NURSE)
  @ApiOperation({ summary: '감별진단 제안' })
  async diagnose(@Body() dto: AiDiagnoseDto) {
    return { data: await this.aiService.analyze(dto) };
  }

  // ── WeRU.B 약가/DUR/e약은요 passthrough (제네릭 보류건·표준코드 close-loop 지원) ──

  @Get('drug-substitution/:code')
  @Roles(UserRole.DOCTOR, UserRole.PHARMACIST, UserRole.ADMIN)
  @ApiOperation({ summary: '생동성 대체조제·동일성분 저가약(제네릭 보류건 대체품 탐색)' })
  async drugSubstitution(@Param('code') code: string) {
    return { data: await this.aiService.drugSubstitution(code) };
  }

  @Get('drug-master/:code')
  @Roles(UserRole.DOCTOR, UserRole.PHARMACIST, UserRole.ADMIN)
  @ApiOperation({ summary: '약가마스터 코드 해석(제품코드↔ATC↔표준코드) — 보험코드 표준화' })
  async drugMaster(@Param('code') code: string) {
    return { data: await this.aiService.drugMaster(code) };
  }

  @Post('dur/check')
  @Roles(UserRole.DOCTOR, UserRole.PHARMACIST, UserRole.NURSE)
  @ApiOperation({ summary: 'DUR 정밀 점검(병용금기·임부·연령·노인·효능군중복·서방정분할)' })
  async durCheck(@Body() body: { drugs: unknown[]; age?: number; pregnant?: boolean }) {
    return { data: await this.aiService.durCheck(body) };
  }

  @Post('explain')
  @Roles(UserRole.DOCTOR, UserRole.ADMIN, UserRole.NURSE)
  @ApiOperation({ summary: '환자 설명문 생성' })
  async explain(@Body() dto: AiExplainDto) {
    return { data: await this.aiService.explain(dto.diagnosis, dto.treatmentPlan, dto.patientLevel) };
  }

  /**
   * 🔴 (2026-09-16 I3 실로그인 프로브) 트리아지 3EP 가 ADMIN·DOCTOR·NURSE 뿐이라 **원무(RECEPTIONIST)가 403** 이었다.
   *    `/reception` nav 는 ADMIN·NURSE·RECEPTIONIST 이고, 워크인 접수 탭(`WalkInTab`)이 증상 입력 → 진료과 추천으로
   *    접수를 만든다 — 원무가 그 화면의 주 사용자인데 버튼을 누르면 토스트로 실패했다(dead-button).
   *    다루는 값은 증상 문자열→진료과 추천이고 환자 식별·임상 기록이 아니다. 같은 컨트롤러의 AI 프로비넌스
   *    EP(`draft-applied`·`draft-outcome`)는 이미 RECEPTIONIST 를 받는다 — 그 집합에 맞춘다.
   */
  @Post('triage')
  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE, UserRole.RECEPTIONIST)
  @ApiOperation({ summary: '증상 → 진료과 추천 (AI 트리아지)' })
  async triage(@Body() dto: AiTriageDto) {
    // 🔴 나이·성별을 그대로 넘긴다 — 서비스는 처음부터 받도록 돼 있었는데 컨트롤러가 버리고 있었다.
    //    (모르는 값은 화면이 보내지 않는다 — 여기서 기본값을 지어내지 않는다.)
    return { data: await this.aiService.triage(dto.symptom, { age: dto.age, sex: dto.sex }) };
  }

  @Post('reference')
  @Roles(UserRole.DOCTOR, UserRole.ADMIN, UserRole.NURSE)
  @ApiOperation({ summary: '의학 참고 (RAG 벡터 검색)' })
  async reference(@Body() dto: AiReferenceDto) {
    return { data: await this.aiService.reference(dto.question, dto.category) };
  }

  @Post('feedback')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: 'AI 진료보조 피드백 생성(탭별 👍/👎)' })
  async createFeedback(@Body() dto: AiFeedbackCreateDto) {
    return { data: await this.aiService.createFeedback(dto) };
  }

  @Get('feedback/stats')
  @Roles(UserRole.ADMIN, UserRole.EXECUTIVE)
  @ApiOperation({ summary: 'AI 피드백 대시보드(A-9) — 기능별 👍/👎 집계·부정 코멘트' })
  async feedbackStats(@Query('days') days?: string) {
    return { data: await this.aiService.feedbackStats(days ? parseInt(days, 10) : 30) };
  }

  // ── AI 진료 보조 Phase 1 ──

  @Get('patient-context/:patientId')
  @Roles(UserRole.DOCTOR, UserRole.ADMIN, UserRole.NURSE)
  @ApiOperation({ summary: '환자 구조화 안전 컨텍스트(알레르기·활성약물·문제) — AI 주입용' })
  async patientContext(@Param('patientId', ParseUUIDPipe) patientId: string, @CurrentUser('id') userId?: string) {
    const data = await this.aiService.getPatientContext(patientId);
    // PHI 집약 반환 — AI 사용 감사(twin.controller auditPhi 패턴: 비동기·실패 무시·요청 비차단)
    // 🔴 (2026-09-15 U1) 실패 무시(`.catch(() => {})`)가 PHI 집약 열람의 감사 누락을 숨겼다 — 요청은 막지 않되 누락은 warn.
    if (userId) void this.audit?.log({ userId, action: 'READ', resourceType: 'AiPatientContext', resourceId: patientId }).catch((err) =>
      this.logger.warn(`AI patient-context read audit failed (patient ${patientId}, user ${userId}): ${err instanceof Error ? err.message : String(err)}`),
    );
    return { data };
  }

  // 🔴 아래 4개는 body 에 patientId 를 담아 환자 임상정보를 외부 AI 로 보내는 경로다.
  //    실측 감사행은 resource_id=ZERO·changes="patientId,subjective"(필드명만) 였다 → 환자 귀속으로 교정.
  //    @NoAudit 사유: auditAiEgress 가 같은 사실을 더 정확히 1행으로 남긴다(이중 기록 방지).

  @Post('realtime-ddx')
  @Roles(UserRole.DOCTOR, UserRole.ADMIN, UserRole.NURSE)
  @NoAudit()
  @ApiOperation({ summary: '실시간 감별진단 (S/O 입력 시 자동)' })
  async realtimeDdx(@Body() dto: AiRealtimeDdxDto, @CurrentUser('id') userId?: string) {
    this.auditAiEgress(userId, 'AiRealtimeDdx', dto.patientId, {
      subjectiveChars: dto.subjective?.length ?? 0,
      hasObjective: !!dto.objective,
    });
    const r = await this.aiService.realtimeDdx(dto);
    this.auditAiEgress(userId, 'AiRealtimeDdxOutcome', dto.patientId, this.outcomeMeta(r));
    return { data: r };
  }

  @Post('auto-soap')
  @Roles(UserRole.DOCTOR, UserRole.ADMIN, UserRole.NURSE)
  @NoAudit()
  @ApiOperation({ summary: 'SOAP Assessment/Plan 자동 초안 (제안 원장 SOAP_DRAFT 1행 · proposalId 동봉)' })
  async autoSoap(@Body() dto: AiAutoSoapDto, @CurrentUser('id') userId?: string) {
    this.auditAiEgress(userId, 'AiAutoSoap', dto.patientId, { subjectiveChars: dto.subjective?.length ?? 0 });
    const r = await this.aiService.autoSoap(dto);
    this.auditAiEgress(userId, 'AiAutoSoapOutcome', dto.patientId, this.outcomeMeta(r));
    /**
     * P1 — 초안을 **제안 원장의 일급 레코드**로 남긴다(기획서 §2.1).
     * 🔴 `UNAVAILABLE` 은 만들지 않는다(산출물이 없다) · 생성 실패는 응답을 막지 않고 코드로 말한다.
     * 🔴 대상: 진료가 이미 있으면 그 Encounter, 신규 진료 화면은 아직 없으므로 `targetKey` 로
     *    "이 환자의 미확정 진료"임을 밝힌다 — 대상을 추정하거나 다른 진료에 붙이지 않는다.
     * 🔴 **제안 수 ≠ 모델 호출 수**: 스킬 캐시(`withSkillCache` · TTL 600s)에 맞은 응답도 사람에게 새로
     *    보여지는 초안이므로 제안 1행을 만든다(안 만들면 그 사람의 결정이 어디에도 안 남는다).
     *    감독 화면(P2)이 "몇 번 호출했나"를 세려면 `AiCallLog` 를 봐야 한다 — 이 원장이 아니다.
     */
    const env = r as unknown as Record<string, unknown>;
    const proposal = await this.createSkillProposal({
      kind: 'SOAP_DRAFT',
      targetType: 'Encounter',
      targetId: dto.encounterId ?? null,
      // targetId 가 UUID 가 아니면(신규 진료·클라 오류) 대상을 버리지 않고 "이 환자의 미확정 진료"로 밝힌다
      targetKey: `encounter-pending:patient:${dto.patientId}`,
      patientId: dto.patientId,
      content: serializeSoapDraft(env.assessment, env.plan),
      modelRef: typeof env.modelRef === 'string' ? env.modelRef : null,
      // 🔴 스킬이 버전을 말하지 않으면 null 이다 — 여기서 "아마 이 버전"을 채우지 않는다
      promptVersion: typeof env.promptVersion === 'string' ? env.promptVersion : null,
      inputSnapshotHash: typeof env.inputSnapshotHash === 'string' ? env.inputSnapshotHash : null,
      confidence: typeof env.confidence === 'number' ? env.confidence : null,
      source: (env.source as AiProposalSourceValue) ?? 'FALLBACK',
      reasonCode: typeof env.reason === 'string' ? env.reason : null,
      createdBy: userId ?? null,
    });
    return { data: { ...r, ...proposal } };
  }

  @Post('interpret-lab')
  @Roles(UserRole.DOCTOR, UserRole.NURSE)
  @NoAudit()
  @ApiOperation({ summary: '검사 결과 AI 해석' })
  async interpretLab(@Body() dto: AiInterpretLabDto, @CurrentUser('id') userId?: string) {
    this.auditAiEgress(userId, 'AiInterpretLab', dto.patientId, { resultCount: dto.results?.length ?? 0 });
    const r = await this.aiService.interpretLab(dto);
    this.auditAiEgress(userId, 'AiInterpretLabOutcome', dto.patientId, this.outcomeMeta(r));
    return { data: r };
  }

  @Post('recommend-drugs')
  @Roles(UserRole.DOCTOR, UserRole.ADMIN, UserRole.NURSE)
  @NoAudit()
  @ApiOperation({ summary: '가이드라인 기반 약물 추천 (orderSetSuggested=실 ACTIVE 코드 강제·orderSet 동봉)' })
  async recommendDrugs(@Body() dto: AiRecommendDrugsDto, @CurrentUser('id') userId?: string) {
    this.auditAiEgress(userId, 'AiRecommendDrugs', dto.patientId, { diagnosis: dto.diagnosis });
    const r = await this.aiService.recommendDrugs(dto);
    this.auditAiEgress(userId, 'AiRecommendDrugsOutcome', dto.patientId, this.outcomeMeta(r));
    return { data: r };
  }

  @Post('order-set-draft')
  @Roles(UserRole.ADMIN, UserRole.DOCTOR)
  @ApiOperation({ summary: 'AI 약속처방 초안 생성 — DRAFT·미해석으로만 저장(해석 콘솔→승인 절차 필수)' })
  async orderSetDraft(
    @Body() body: { diagnosis: string; diagnosisCode?: string; department?: string },
    @CurrentUser('id') userId: string,
  ) {
    return { data: await this.aiService.draftOrderSet(body, userId) };
  }

  // ── AI 진료 보조 Phase 2 ──

  @Post('chart-qa')
  @Roles(UserRole.DOCTOR, UserRole.ADMIN, UserRole.NURSE)
  @ApiOperation({ summary: '의무기록 품질검사 (서명 전)' })
  async chartQa(@Body() dto: AiChartQaDto) {
    return { data: await this.aiService.chartQa(dto) };
  }

  // ── AI 진료 보조 Phase 3 ──

  @Post('patient-education')
  @Roles(UserRole.DOCTOR, UserRole.NURSE)
  @ApiOperation({ summary: '환자 설명문 생성' })
  async patientEducation(@Body() dto: AiPatientEducationDto) {
    return { data: await this.aiService.patientEducation(dto) };
  }

  @Post('clinical-qa')
  @Roles(UserRole.DOCTOR, UserRole.ADMIN, UserRole.NURSE)
  @ApiOperation({ summary: '임상 질문 답변 (근거 기반)' })
  async clinicalQa(@Body() dto: AiClinicalQaDto) {
    return { data: await this.aiService.clinicalQa(dto) };
  }

  // ── WeRU.B Medical AI v2.39.2 추가 API ──

  @Post('summarize/stream')
  @Roles(UserRole.DOCTOR, UserRole.ADMIN, UserRole.NURSE)
  @ApiOperation({ summary: 'SOAP 구조화 스트리밍 (NDJSON)' })
  async summarizeStream(@Body() dto: AiSummarizeDto, @Res() res: Response) {
    const upstream = await this.aiService.summarizeStream(dto.text, dto.specialty);
    res.set({ 'Content-Type': 'application/x-ndjson', 'Transfer-Encoding': 'chunked' });
    const body = upstream.body;
    if (body) {
      Readable.fromWeb(body as any).pipe(res);
    } else {
      res.end();
    }
  }

  @Post('drug-interactions')
  @Roles(UserRole.DOCTOR, UserRole.PHARMACIST)
  @ApiOperation({ summary: '약물 상호작용 확인' })
  async drugInteractions(@Body() dto: AiDrugInteractionsDto) {
    return { data: await this.aiService.drugInteractions(dto.drugs) };
  }

  @Post('knowledge/search')
  @Roles(UserRole.DOCTOR, UserRole.NURSE)
  @ApiOperation({ summary: '지식 검색' })
  async knowledgeSearch(@Body() dto: AiKnowledgeSearchDto) {
    return { data: await this.aiService.knowledgeSearch(dto) };
  }

  /** 같은 워크인 접수 흐름의 후속 질문 — ADMIN 도 빠져 있어 `/reception` 을 여는 세 역할 모두 받게 맞춘다 */
  @Post('triage/follow-up')
  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE, UserRole.RECEPTIONIST)
  @ApiOperation({ summary: '트리아지 후속 질문' })
  async triageFollowUpSimple(@Body() dto: AiTriageFollowUpDto) {
    return { data: await this.aiService.triageFollowUpSimple(dto.symptom) };
  }

  @Get('triage/common-symptoms')
  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE, UserRole.RECEPTIONIST)
  @ApiOperation({ summary: '흔한 증상 목록 (트리아지용)' })
  async triageCommonSymptoms() {
    return { data: await this.aiService.triageCommonSymptoms() };
  }

  // ══════════════════════════════════════════════
  // v2.48.0 신규 엔드포인트
  // ══════════════════════════════════════════════

  // ── Medical CLI ──

  @Post('cli/execute')
  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE)
  @ApiOperation({ summary: 'CLI 명령 실행 (역할별 업무 자동화)' })
  async cliExecute(@Body() dto: AiCliExecuteDto) {
    return { data: await this.aiService.cliExecute(dto.role, dto.command) };
  }

  // ── Reasoning Chain ──

  @Post('reasoning/chain')
  @Roles(UserRole.DOCTOR, UserRole.ADMIN, UserRole.NURSE)
  @ApiOperation({ summary: '5단계 임상 추론 체인' })
  async reasoningChain(@Body() dto: AiReasoningChainDto) {
    return { data: await this.aiService.reasoningChain(dto) };
  }

  // ── Auto Record ──

  @Post('auto-record')
  @Roles(UserRole.DOCTOR, UserRole.ADMIN, UserRole.NURSE)
  @AuditResource('AiAutoRecord') // 진료 대화 원문이 외부로 나가는 경로 — 환자 식별자는 DTO 에 없어 귀속 불가(추정 금지)
  @ApiOperation({ summary: '진료 대화 → SOAP + ICD-10 + 처방 자동' })
  async autoRecord(@Body() dto: AiAutoRecordDto) {
    return { data: await this.aiService.autoRecord(dto) };
  }

  // ── Predict ──

  @Post('predict/readmission')
  @Roles(UserRole.DOCTOR, UserRole.NURSE)
  @ApiOperation({ summary: '30일 재입원 위험도 예측' })
  async predictReadmission(@Body() dto: AiPredictReadmissionDto) {
    return { data: await this.aiService.predictReadmission(dto) };
  }

  @Post('predict/complication')
  @Roles(UserRole.DOCTOR, UserRole.NURSE)
  @ApiOperation({ summary: '합병증 위험도 예측' })
  async predictComplication(@Body() dto: AiPredictComplicationDto) {
    return { data: await this.aiService.predictComplication(dto) };
  }

  @Post('predict/adverse-drug')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.PHARMACIST)
  @ApiOperation({ summary: '약물 부작용 예측 + DB 검증' })
  async predictAdverseDrug(@Body() dto: AiPredictAdverseDrugDto) {
    return { data: await this.aiService.predictAdverseDrug(dto) };
  }

  // ── Vision Medical ──

  @Post('vision/analyze')
  @Roles(UserRole.DOCTOR, UserRole.ADMIN, UserRole.NURSE)
  @NoAudit() // 사유: 아래 auditAiEgress 로 대체(환자 귀속·전송 메타 기록) — 인터셉터 기본행과 이중 기록 방지
  @ApiOperation({ summary: '의료 영상 AI 분석 (MedGemma) — 외부에서 인증 없이 가져갈 수 있는 URL 만 · 동의 필수' })
  async visionAnalyze(@Body() dto: AiVisionAnalyzeDto, @CurrentUser('id') userId?: string) {
    // 🔴 이 경로는 URL 을 **WeRU.B 가 스스로 가져간다**. 그래서 HIS 내부 경로를 주면 AI 서버는
    //    401/HTML 을 받아들고, 그 결과가 "판독 소견"으로 화면에 렌더된다(보지 않은 영상의 소견).
    //    실제로 판독 워크스테이션이 상대경로 `/api/v1/pacs/wado?...` 를 넘기고 있었다(2026-08-18 적발).
    //    → 상대경로·HIS 인증 경로는 여기서 막고, 바이트 전송 경로(`vision/medical/analyze`)로 보낸다.
    const bad = unfetchableByExternalAi(dto.imageUrl);
    if (bad) {
      return {
        error: {
          code: 'IMAGE_URL_NOT_FETCHABLE',
          message: `${bad} 외부 AI 서버가 가져갈 수 없는 URL 입니다 — 바이트를 직접 보내는 POST /api/v1/ai/vision/medical/analyze 를 사용하십시오.`,
        },
      };
    }
    // 🔴 바이트 경로(`vision/medical/analyze`)에는 동의 게이트가 있는데 **이 URL 경로에는 없었다**.
    //    같은 데이터(의료영상+임상정보)가 같은 외부 서버로 나가는데 입구 하나만 잠근 것은 잠근 게 아니다.
    if (!dto.consent) {
      return { error: { code: 'CONSENT_REQUIRED', message: '의료영상 외부 AI 전송 동의가 필요합니다.' } };
    }
    this.auditAiEgress(userId, 'AiVisionEgress', dto.patientId, {
      modality: dto.modality,
      bodyPart: dto.bodyPart,
      clinicalInfoChars: dto.clinicalInfo?.length ?? 0, // 본문은 기록하지 않는다(감사로그 자기위반 방지)
      consent: true,
    });
    return { data: await this.aiService.visionAnalyze(dto.imageUrl, dto.modality, dto.bodyPart, dto.clinicalInfo) };
  }

  // ── FHIR R4 ──

  // ── Enhanced Chat + Writing Craft ──

  @Post('writing/craft')
  @Roles(UserRole.DOCTOR, UserRole.NURSE)
  @ApiOperation({ summary: '고품질 글쓰기 — 3모델 파이프라인 (퇴원요약/소견서/의뢰서 · style 이 매핑된 종류만 제안 원장에 남는다)' })
  async writingCraft(
    /**
     * 🔴 인라인 @Body 라 ValidationPipe 가 통째로 스킵된다(기존 사실 · 인라인 @Body 동결 백로그).
     *    그래서 아래에서 `admissionId`·`patientId` 를 **직접 UUID 검사**한 뒤에만 원장에 쓴다.
     */
    @Body() body: { text: string; style?: string; admissionId?: string; patientId?: string },
    @CurrentUser('id') userId?: string,
  ) {
    assertBodySize(body);
    const crafted = await this.aiService.writingCraft(body.text, body.style);
    // 상류 응답이 객체가 아니면 결과를 읽을 수 없다 — 제안도 만들지 않고 응답 모양도 바꾸지 않는다
    if (!crafted || typeof crafted !== 'object' || Array.isArray(crafted)) return { data: crafted };

    const out = crafted as Record<string, unknown>;
    const kind = body.style ? WRITING_CRAFT_PROPOSAL_KIND[body.style] : undefined;
    if (!kind) return { data: { ...out, proposalId: null, proposalSkipped: 'KIND_UNMAPPED' as const } };

    // 🔴 입원 퇴원요약 화면(inpatient/[admissionId]/discharge-summary)에는 patientId 가 없다 — 입원 행에서 찾는다.
    //    조회 실패는 null 로 두고 `patientResolve` 로 말한다(환자별 제안 목록에서 빠지는 사실을 숨기지 않는다).
    let patientId: string | null = body.patientId && UUID_FULL.test(body.patientId) ? body.patientId : null;
    let patientResolve: 'BODY' | 'ADMISSION' | 'LOOKUP_FAILED' | 'UNRESOLVED' = patientId ? 'BODY' : 'UNRESOLVED';
    if (!patientId && body.admissionId && UUID_FULL.test(body.admissionId) && this.prisma) {
      try {
        const adm = await this.prisma.admission.findUnique({ where: { id: body.admissionId }, select: { patientId: true } });
        if (adm?.patientId) { patientId = adm.patientId; patientResolve = 'ADMISSION'; }
      } catch {
        patientResolve = 'LOOKUP_FAILED';
      }
    }
    const proposal = await this.createSkillProposal({
      kind,
      targetType: 'Admission', // 현재 매핑된 유일한 종류(DISCHARGE_DRAFT)의 정본 대상
      targetId: body.admissionId ?? null,
      targetKey: null, // 🔴 입원을 모르면 대상을 지어내지 않는다 → TARGET_UNIDENTIFIED 로 말한다
      patientId,
      content: typeof out.result === 'string' ? out.result : '',
      // 🔴 상류가 보고한 모델만. craft 응답 계약에 모델 필드가 없으면 null(미보고)이다.
      modelRef: typeof out.model_used === 'string' ? out.model_used : typeof out.model === 'string' ? out.model : null,
      promptVersion: WRITING_CRAFT_PROMPT_VERSION,
      /**
       * 🔴 craft 의 프롬프트 본문은 **화면이 조립해 보낸 `text`** 다(서버가 조립하지 않는다).
       *    그래서 입력 스냅샷은 그 text 전문의 sha256 — 실제로 상류로 나간 입력 그대로다.
       */
      inputSnapshotHash: createHash('sha256').update(typeof body.text === 'string' ? body.text : '').digest('hex'),
      // craft 응답에는 모델 자기보고 신뢰도가 없다 — null(0.7 같은 기본값 금지)
      confidence: null,
      /**
       * 🔴 craft 는 3상태 봉투(SkillEnvelope)를 쓰지 않는다 — 상류가 본문을 돌려주면 `AI`,
       *    실패는 예외로 올라가 여기 도달하지 않는다(200 + 빈 result 는 EMPTY_DRAFT 로 걸러진다).
       */
      source: 'AI',
      createdBy: userId ?? null,
    });
    return { data: { ...out, ...proposal, patientResolve } };
  }

  // ============================================================
  // Medical Law (v2.53.0)
  // ============================================================

  @Post('law/ask')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: '의료법 질의응답 (RAG 조문 검색 + LLM)' })
  async medicalLawAsk(@Body() body: { question: string }) {
    assertBodySize(body);
    return { data: await this.aiService.medicalLawAsk(body.question) };
  }

  @Post('law/check/record')
  @Roles(UserRole.DOCTOR, UserRole.NURSE)
  @ApiOperation({ summary: '의무기록 기재사항 검사 (의료법 제22조)' })
  async medicalLawCheckRecord(@Body() body: { record: string }) {
    assertBodySize(body);
    return { data: await this.aiService.medicalLawCheckRecord(body.record) };
  }

  @Post('law/check/report')
  @Roles(UserRole.DOCTOR, UserRole.NURSE)
  @ApiOperation({ summary: '감염병 신고 의무 확인' })
  async medicalLawCheckReport(@Body() body: { diagnoses: { diagnosis_ko: string; icd10: string }[] }) {
    assertBodySize(body);
    return { data: await this.aiService.medicalLawCheckReport(body.diagnoses) };
  }

  @Post('law/auto-check')
  @Roles(UserRole.DOCTOR, UserRole.NURSE)
  @ApiOperation({ summary: '통합 법적 검사 (기록+감염병+동의서 일괄)' })
  async medicalLawAutoCheck(@Body() body: { record: string; diagnoses?: { diagnosis_ko: string; icd10: string }[]; procedures?: string[] }) {
    assertBodySize(body);
    return { data: await this.aiService.medicalLawAutoCheck(body) };
  }

  @Post('law/guide/informed-consent')
  @Roles(UserRole.DOCTOR, UserRole.NURSE)
  @ApiOperation({ summary: '인폼드 컨센트 가이드 (시술별 위험/대안)' })
  async medicalLawInformedConsent(@Body() body: { procedure: string }) {
    assertBodySize(body);
    return { data: await this.aiService.medicalLawInformedConsent(body.procedure) };
  }

  @Post('law/guide/advertisement')
  @Roles(UserRole.ADMIN, UserRole.CRM_MANAGER)
  @ApiOperation({ summary: '의료 광고 적법성 검토 (CRM 캠페인용)' })
  async medicalLawAdCheck(@Body() body: { content: string }) {
    assertBodySize(body);
    return { data: await this.aiService.medicalLawAdCheck(body.content) };
  }

  // ============================================================
  // Meeting Analysis (v2.63.0)
  // ============================================================

  /**
   * 🔴 이 3개 EP 는 WeRU.B 의 **테넌트 공용 작업 큐**를 다룬다(병원 회의 전용 큐가 아니다).
   * 서비스 계층에서 ①제출 시 출처 각인 ②조회 시 우리 출처만 반환/허용 ③전사 전문·화자분절 제거를 수행한다.
   * 진료 녹취 전문은 이 경로로 열 수 없다 — scribe 모듈(진료건 바인딩·녹음 동의·감사)이 유일한 정본 경로.
   */
  @Post('meeting/analyze')
  @Roles(UserRole.DOCTOR, UserRole.ADMIN)
  @AuditResource('AiMeetingAnalyze')
  @ApiOperation({ summary: '화상회의 녹화 AI 분석 (STT+요약+액션아이템)' })
  async meetingAnalyze(@Body() dto: AiMeetingAnalyzeDto) {
    assertBodySize(dto);
    return { data: await this.aiService.meetingAnalyze(dto) };
  }

  @Get('meeting/job/:id')
  @Roles(UserRole.DOCTOR, UserRole.ADMIN)
  @ApiOperation({ summary: '분석 작업 상태/결과 조회 (병원 회의 작업만·전사 전문 미포함)' })
  async meetingJobStatus(@Param('id') id: string) {
    return { data: await this.aiService.meetingJobStatus(id) };
  }

  @Get('meeting/jobs')
  @Roles(UserRole.DOCTOR, UserRole.ADMIN)
  @ApiOperation({ summary: '분석 작업 목록 (병원 회의 작업만 — 타 출처는 개수만 보고)' })
  async meetingJobs(@Query('status') status?: string) {
    return { data: await this.aiService.meetingJobs(status) };
  }

  // ============================================================
  // Counseling (v2.62.0)
  // ============================================================

  @Post('counseling/chat')
  @Roles(UserRole.DOCTOR, UserRole.NURSE)
  @AuditResource('AiCounselingChat')
  @ApiOperation({ summary: 'AI 상담 (mindwell + qwen 오케스트레이션, 위기 감지)' })
  async counselingChat(@Body() dto: AiCounselingChatDto) {
    assertBodySize(dto);
    // 응답은 `crisis_assessed` 를 동봉한다 — false 면 화면은 "위기 없음"이 아니라 "판단 불가"를 말해야 한다.
    return { data: await this.aiService.counselingChat(dto.message, dto.session_id) };
  }

  // ============================================================
  // Vision Medical
  // ============================================================

  @Post('vision/medical/analyze')
  @Roles(UserRole.DOCTOR)
  @NoAudit() // 사유: 아래 auditAiEgress 로 대체(환자 귀속·전송 메타 기록) — 인터셉터 기본행과 이중 기록 방지
  @ApiOperation({ summary: '의료 영상 AI 분석 (MedGemma 4B) — 외부 전송 동의 필수' })
  async visionMedicalAnalyze(@Body() dto: AiVisionMedicalAnalyzeDto, @CurrentUser('id') userId?: string) {
    assertBodySize(dto, 15_000_000); // 의료영상 base64 — 이미지 정당 대용량 허용(~11MB), 폭주만 차단
    // 🔴 같은 컨트롤러의 id-ocr 에는 CONSENT_REQUIRED 게이트가 있는데 이 경로에는 없었다(C).
    //    의료영상(최대 15MB)이 동의 확인 없이 외부 AI 서버로 나가던 유일한 경로 — 동일 게이트를 적용한다.
    if (!dto.consent) {
      return { error: { code: 'CONSENT_REQUIRED', message: '의료영상 외부 AI 전송 동의가 필요합니다.' } };
    }
    this.auditAiEgress(userId, 'AiVisionEgress', dto.patientId, {
      modality: dto.modality,
      bodyPart: dto.bodyPart,
      imageBytes: Math.floor((dto.imageBase64?.length ?? 0) * 0.75),
      hasClinicalInfo: !!dto.clinicalInfo,
      consent: true,
    });
    return {
      data: await this.aiService.visionMedicalAnalyze({
        imageBase64: dto.imageBase64,
        modality: dto.modality,
        bodyPart: dto.bodyPart,
        clinicalInfo: dto.clinicalInfo,
      }),
    };
  }

  // ============================================================
  // Writing / Translate (v2.55.0)
  // ============================================================

  @Post('translate')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN, UserRole.CRM_MANAGER, UserRole.CRM_STAFF)
  @ApiOperation({ summary: '텍스트 번역 (7개 언어: en/ja/zh/es/fr/de/ko)' })
  async translate(@Body() body: { text: string; target: string; tone?: string }) {
    return { data: await this.aiService.translate(body.text, body.target, body.tone) };
  }

  // ============================================================
  // Tool Calling (v2.64.0)
  // ============================================================
}
