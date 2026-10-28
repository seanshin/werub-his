import { JourneyService } from '../journey/journey.service';
import { Injectable, Logger, NotFoundException, BadRequestException, Optional } from '@nestjs/common';
import { createHash } from 'crypto';
import { PATIENT_SENSITIVE_OMIT } from '../../common/patient-select';

import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { MedicalAiService } from '../medical-ai/medical-ai.service';
import { AiProposalService } from '../ai-proposal/ai-proposal.service';

/**
 * MDT 임상요약 초안 프롬프트 세대 — 프롬프트를 고치면 여기도 올린다.
 * 🔴 감독 지표가 프롬프트 세대를 섞어 세면 모델을 잘못 판단한다.
 */
export const MDT_SUMMARY_PROMPT_VERSION = 'mdt-summary-v1';

/** 제안이 가리키는 정본 종류 — `MdtCase` 에 AI 컬럼을 추가하지 않고 `targetId` 로만 잇는다 */
export const MDT_PROPOSAL_TARGET_TYPE = 'MdtCase';

/** 🔴 상류가 돌려준 모델 태그만. `'unknown'` 은 모델 이름이 아니라 "말하지 않았다"는 뜻이다 */
function upstreamModelRef(tag: string | null | undefined): string | null {
  const t = (tag ?? '').trim();
  if (!t || t === 'unknown') return null;
  return t;
}

/** 입력 스냅샷 해시 — 무엇을 보고 썼는가의 지문(본문·PHI 는 담지 않는다) */
function sha256(v: string): string {
  return createHash('sha256').update(v, 'utf8').digest('hex');
}

/**
 * MDT 결정 분류 정본 — 이 목록에 없는 값은 저장하지 않는다.
 *
 * 🔴 종전엔 서버에 검증이 전혀 없었고, 화면 폼이 `OBSERVATION`(경과관찰=무치료)을 **프리필**했다.
 *    의사가 결정문만 적고 저장하면 고르지 않은 '경과관찰'이 임상 결정으로 기록됐다(W7 ① · P15).
 *    → 분류를 정하지 않았으면 비워 두거나(null=미기록) '미분류(UNCLASSIFIED)'를 **명시**한다.
 *    기본값은 서버에도 화면에도 두지 않는다.
 */
export const MDT_DECISION_CATEGORIES = [
  'SURGERY',
  'CHEMO',
  'RADIATION',
  'COMBINED',
  'PALLIATIVE',
  'OBSERVATION',
  /** 논의했으나 분류를 확정하지 않음 — '경과관찰(무치료)'과 다르다 */
  'UNCLASSIFIED',
] as const;
export type MdtDecisionCategory = (typeof MDT_DECISION_CATEGORIES)[number];

/** 결정 분류 한글 라벨 — 여정 타임라인·회의록처럼 사람이 읽는 출력에 쓴다(코드 노출 금지) */
export const MDT_DECISION_CATEGORY_LABEL: Record<string, string> = {
  SURGERY: '수술',
  CHEMO: '항암치료',
  RADIATION: '방사선치료',
  COMBINED: '복합치료',
  PALLIATIVE: '완화치료',
  OBSERVATION: '경과관찰',
  UNCLASSIFIED: '미분류',
};

@Injectable()
export class MdtService {
  private readonly logger = new Logger('Mdt');

  constructor(
    private readonly prisma: PrismaService,
    private readonly medicalAi: MedicalAiService,
    // AI 제안 원장 — 초안이 무엇이었고 사람이 그것을 어떻게 했는지만 남긴다(정본은 MdtCase 가 갖는다)
    private readonly aiProposal: AiProposalService,
    /** 여정 정본 발행기(2026-10-01 P0-6 — 직접 쓰기 이관) */
    @Optional() private readonly journey?: JourneyService,
  ) {}

  /**
   * 참석자·의장 이름 해석 정본 — MdtAttendee 는 User 관계가 없어(userId 만 보관)
   * 화면이 그대로 렌더하면 UUID 가 보인다(W7 ③④).
   * 회의록 생성(generateMinutes)과 상세 조회(findOne)가 **같은 함수**를 쓴다(정본이 둘이면 갈라진다).
   */
  private async resolveUserNames(userIds: string[]): Promise<Map<string, string>> {
    const ids = [...new Set(userIds.filter(Boolean))];
    if (ids.length === 0) return new Map();
    const users = await this.prisma.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, familyName: true, givenName: true },
    });
    return new Map(users.map((u) => [u.id, `${u.familyName ?? ''}${u.givenName ?? ''}`.trim()]));
  }

  /** MDT 컨퍼런스 목록 (케이스 수 + 참석자 수 포함) */
  async findAll(dept?: string, status?: string) {
    const where: Record<string, unknown> = {};
    if (dept) where.department = dept;
    if (status) where.status = status;

    return this.prisma.mdtConference.findMany({
      where,
      include: {
        _count: { select: { cases: true, attendees: true } },
      },
      orderBy: { scheduledAt: 'desc' },
    });
  }

  /** MDT 컨퍼런스 생성 */
  async create(data: Record<string, unknown>, userId: string) {
    return this.prisma.mdtConference.create({
      data: {
        title: data.title as string,
        conferenceType: data.conferenceType as string,
        department: data.department as string,
        scheduledAt: new Date(data.scheduledAt as string),
        location: (data.location as string) || null,
        chairpersonId: userId,
        notes: (data.notes as string) || null,
      },
    });
  }

  /** MDT 컨퍼런스 상세 (케이스 + 참석자) — 참석자/의장은 이름까지 해석해 내려준다 */
  async findOne(id: string) {
    const conference = await this.prisma.mdtConference.findUnique({
      where: { id },
      include: {
        cases: {
          include: { patient: { omit: PATIENT_SENSITIVE_OMIT } },
          orderBy: { sortOrder: 'asc' },
        },
        attendees: true,
      },
    });
    if (!conference) throw new NotFoundException('MDT 컨퍼런스를 찾을 수 없습니다');

    // 🔴 종전엔 attendees 를 그대로 내려 화면에 참석자 이름 대신 UUID 가 찍혔다(W7 ④).
    //    같은 서버의 회의록 생성은 이름을 정확히 해석하고 있었다 = 정본이 둘(P12).
    const nameOf = await this.resolveUserNames([
      ...conference.attendees.map((a) => a.userId),
      conference.chairpersonId,
    ]);
    return {
      ...conference,
      chairpersonName: nameOf.get(conference.chairpersonId) || null,
      attendees: conference.attendees.map((a) => ({
        ...a,
        // 이름을 못 찾으면 UUID 로 때우지 않는다 — 화면이 '기록 없음'을 말하게 null
        userName: nameOf.get(a.userId) || null,
      })),
    };
  }

  /** 존재 확인용 경량 조회 — 변이 경로는 케이스/참석자/이름까지 끌고 올 필요가 없다 */
  private async ensureConference(id: string) {
    const conference = await this.prisma.mdtConference.findUnique({ where: { id } });
    if (!conference) throw new NotFoundException('MDT 컨퍼런스를 찾을 수 없습니다');
    return conference;
  }

  /** MDT 컨퍼런스 수정 */
  async update(id: string, data: Record<string, unknown>) {
    await this.ensureConference(id);
    const updateData: Record<string, unknown> = {};
    if (data.title) updateData.title = data.title;
    if (data.conferenceType) updateData.conferenceType = data.conferenceType;
    if (data.department) updateData.department = data.department;
    if (data.scheduledAt) updateData.scheduledAt = new Date(data.scheduledAt as string);
    if (data.location !== undefined) updateData.location = data.location;
    if (data.notes !== undefined) updateData.notes = data.notes;
    if (data.recordingUrl !== undefined) updateData.recordingUrl = data.recordingUrl;
    return this.prisma.mdtConference.update({ where: { id }, data: updateData });
  }

  /** 컨퍼런스 시작 (SCHEDULED -> IN_PROGRESS) */
  async start(id: string) {
    const conference = await this.ensureConference(id);
    if (conference.status !== 'SCHEDULED') {
      throw new BadRequestException('SCHEDULED 상태의 컨퍼런스만 시작할 수 있습니다');
    }
    return this.prisma.mdtConference.update({
      where: { id },
      data: { status: 'IN_PROGRESS' },
    });
  }

  /** 컨퍼런스 완료 (IN_PROGRESS -> COMPLETED) */
  async complete(id: string) {
    const conference = await this.ensureConference(id);
    if (conference.status !== 'IN_PROGRESS') {
      throw new BadRequestException('IN_PROGRESS 상태의 컨퍼런스만 완료할 수 있습니다');
    }
    return this.prisma.mdtConference.update({
      where: { id },
      data: { status: 'COMPLETED' },
    });
  }

  /**
   * 환자 케이스 추가
   *
   * 🔴 presenterId 는 NOT NULL 인데 화면 폼에는 발표자 칸이 없어, 케이스 추가가 항상
   *    Prisma 단계에서 실패했다("케이스 추가에 실패했습니다"만 뜨고 이유는 없었다).
   *    지정이 없으면 **등록하는 사람 = 발표자**로 본다(누가 올렸는지는 기록돼야 한다).
   */
  async addCase(conferenceId: string, data: Record<string, unknown>, userId?: string) {
    await this.ensureConference(conferenceId);
    if (!data.patientId) throw new BadRequestException('환자를 지정해야 합니다');
    const presenterId = (data.presenterId as string) || userId;
    if (!presenterId) throw new BadRequestException('발표자를 확인할 수 없습니다');

    const maxOrder = await this.prisma.mdtCase.aggregate({
      where: { conferenceId },
      _max: { sortOrder: true },
    });

    return this.prisma.mdtCase.create({
      data: {
        conferenceId,
        patientId: data.patientId as string,
        presenterId,
        primaryDiag: data.primaryDiag as string,
        tnmStage: (data.tnmStage as string) || null,
        clinicalSummary: (data.clinicalSummary as string) || null,
        imagingSummary: (data.imagingSummary as string) || null,
        pathologySummary: (data.pathologySummary as string) || null,
        labSummary: (data.labSummary as string) || null,
        proposedPlan: (data.proposedPlan as string) || null,
        sortOrder: (maxOrder._max.sortOrder ?? -1) + 1,
      },
    });
  }

  /** 케이스 수정 (결정 기록 등) */
  async updateCase(id: string, data: Record<string, unknown>) {
    const existing = await this.prisma.mdtCase.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('MDT 케이스를 찾을 수 없습니다');

    const updateData: Record<string, unknown> = {};
    if (data.primaryDiag) updateData.primaryDiag = data.primaryDiag;
    if (data.tnmStage !== undefined) updateData.tnmStage = data.tnmStage;
    if (data.clinicalSummary !== undefined) updateData.clinicalSummary = data.clinicalSummary;
    if (data.imagingSummary !== undefined) updateData.imagingSummary = data.imagingSummary;
    if (data.pathologySummary !== undefined) updateData.pathologySummary = data.pathologySummary;
    if (data.labSummary !== undefined) updateData.labSummary = data.labSummary;
    if (data.proposedPlan !== undefined) updateData.proposedPlan = data.proposedPlan;
    if (data.decision !== undefined) updateData.decision = data.decision;
    // 🔴 종전엔 무엇이든 그대로 저장했다(enum 검증 없음). 화면 폼의 프리필 'OBSERVATION' 이
    //    의사의 선택 없이 무치료 결정으로 남았다(W7 ① · P15). 이제 정본 목록만 받는다.
    //    빈 문자열/null = 아직 분류하지 않음(미기록) — 임의 분류로 채우지 않는다.
    if (data.decisionCategory !== undefined) {
      const raw = data.decisionCategory;
      if (raw === null || raw === '') {
        updateData.decisionCategory = null;
      } else if (
        typeof raw === 'string' &&
        (MDT_DECISION_CATEGORIES as readonly string[]).includes(raw)
      ) {
        updateData.decisionCategory = raw;
      } else {
        throw new BadRequestException(
          `결정 분류는 ${MDT_DECISION_CATEGORIES.join(', ')} 중 하나여야 합니다`,
        );
      }
    }
    if (data.followUp !== undefined) updateData.followUp = data.followUp;
    if (data.sortOrder !== undefined) updateData.sortOrder = data.sortOrder;
    const updated = await this.prisma.mdtCase.update({ where: { id }, data: updateData });

    // 결정이 최초 기록되면 환자 여정 타임라인에 연계(치료팀 가시화)
    const decisionNewlySet = data.decision && String(data.decision).trim() && !(existing as { decision?: string }).decision;
    if (decisionNewlySet) {
      const conf = await this.prisma.mdtConference.findUnique({ where: { id: existing.conferenceId }, select: { department: true, title: true } });
      const cat = (updateData.decisionCategory ?? (existing as { decisionCategory?: string }).decisionCategory) as string | undefined;
      // 여정 타임라인은 환자·타과가 읽는다 — 코드(SURGERY)가 아니라 한글 라벨로
      const catLabel = cat ? (MDT_DECISION_CATEGORY_LABEL[cat] ?? cat) : null;
      this.journey?.emit({
          patientId: existing.patientId,
          eventType: 'MDT_DECISION',
          title: `다학제(MDT) 결정${catLabel ? `: ${catLabel}` : ''}`,
          description: [String(data.decision).trim(), updateData.proposedPlan ?? (existing as { proposedPlan?: string }).proposedPlan].filter(Boolean).join('\n방침: '),
          department: conf?.department ?? '다학제',
          refType: 'MDT_CASE',
          refId: id,
          navUrl: '/mdt',
          severity: 'INFO',
        });
    }
    return updated;
  }

  /** 케이스 삭제 */
  async deleteCase(id: string) {
    const existing = await this.prisma.mdtCase.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('MDT 케이스를 찾을 수 없습니다');
    return this.prisma.mdtCase.delete({ where: { id } });
  }

  /** AI 임상 요약 자동 생성 */
  /** 회의록 자동생성 — 회의 정보·참석자·케이스별 논의/결정을 구조화 회의록으로 */
  async generateMinutes(conferenceId: string) {
    const conf = await this.prisma.mdtConference.findUnique({
      where: { id: conferenceId },
      include: {
        cases: { include: { patient: { select: { familyName: true, givenName: true, mrn: true } } }, orderBy: { sortOrder: 'asc' } },
        attendees: true,
      },
    });
    if (!conf) throw new NotFoundException('컨퍼런스를 찾을 수 없습니다');

    // 참석자·의장 이름 해석 — 상세 조회와 같은 정본 함수
    const nameOf = await this.resolveUserNames([...conf.attendees.map((a) => a.userId), conf.chairpersonId]);
    const chair = nameOf.get(conf.chairpersonId) || '기록 없음';

    const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

    const lines: string[] = [];
    lines.push(`# ${conf.title} 다학제 회의록`);
    lines.push('');
    lines.push(`- 일시: ${fmt(new Date(conf.scheduledAt))}`);
    lines.push(`- 장소: ${conf.location ?? '-'} · 진료과: ${conf.department} · 유형: ${conf.conferenceType}`);
    lines.push(`- 의장: ${chair}`);
    lines.push(`- 참석자(${conf.attendees.length}): ${conf.attendees.map((a) => `${nameOf.get(a.userId) || '기록 없음'}(${a.department}·${a.role})`).join(', ') || '기록 없음'}`);
    lines.push('');
    lines.push(`## 논의 증례 (${conf.cases.length}건)`);
    conf.cases.forEach((c, i) => {
      const pn = `${c.patient.familyName}${c.patient.givenName}`;
      lines.push('');
      lines.push(`### ${i + 1}. ${pn} (${c.patient.mrn})`);
      lines.push(`- 진단: ${c.primaryDiag}${c.tnmStage ? ` · 병기 ${c.tnmStage}` : ''}`);
      if (c.clinicalSummary) lines.push(`- 임상요약: ${c.clinicalSummary}`);
      if (c.imagingSummary) lines.push(`- 영상: ${c.imagingSummary}`);
      if (c.pathologySummary) lines.push(`- 병리: ${c.pathologySummary}`);
      if (c.proposedPlan) lines.push(`- 제안 방침: ${c.proposedPlan}`);
      lines.push(`- **결정**: ${c.decision ?? '(미기록)'}${c.decisionCategory ? ` [${MDT_DECISION_CATEGORY_LABEL[c.decisionCategory] ?? c.decisionCategory}]` : ' [분류 미기록]'}`);
    });
    lines.push('');
    lines.push(`_본 회의록은 ${fmt(new Date())} 자동 생성되었습니다._`);

    const minutes = lines.join('\n');
    return this.prisma.mdtConference.update({ where: { id: conferenceId }, data: { minutes, minutesGeneratedAt: new Date() } });
  }

  /**
   * AI 임상 요약 **초안** — 정본(`MdtCase.clinicalSummary`)에 쓰지 않고 응답으로만 돌려준다.
   *
   * 🔴 종전엔 LLM 응답을 그대로 `mdtCase.update({ clinicalSummary })` 로 **즉시 저장**했다.
   *    버튼 한 번에 AI 글자가 임상 정본이 됐고, 저장 뒤 화면에는 사람이 쓴 요약과 구분되지 않았다
   *    (초안≠확정 위반 · AI-AND-HIS §2.2 R2). `MdtCase` 에는 AI 프로비넌스 컬럼이 없어
   *    "이 요약은 AI 초안에서 출발했다"를 되짚을 방법도 없었다.
   *    → 초안은 응답으로만 나가고, 정본 쓰기는 사람이 `PATCH /api/v1/mdt/cases/:id` 의
   *      `clinicalSummary` 로 **검토·수정한 뒤** 저장한다(적용 사실은 FE 가 `POST /ai/draft-applied`).
   *
   * 출처 3상태 규약 — 여기엔 **`FALLBACK` 이 없다**. 임상 요약을 규칙으로 지어내면 그건 폴백이 아니라
   * 날조다(P15). AI 가 닿지 않거나 응답을 해석할 수 없으면 `UNAVAILABLE` + 사유이고, 초안은 `null` 이다.
   */
  async autoSummary(caseId: string, userId?: string): Promise<{
    caseId: string;
    patientId: string;
    draft: string | null;
    source: 'AI' | 'UNAVAILABLE';
    reason: string | null;
    model: string | null;
    disclaimer: string;
    /** 🔴 제안 원장 id. 초안이 없으면(UNAVAILABLE) 제안도 없다 — null 은 "만들지 않았다"는 사실이다 */
    proposalId: string | null;
  }> {
    const mdtCase = await this.prisma.mdtCase.findUnique({
      where: { id: caseId },
      include: { patient: { omit: PATIENT_SENSITIVE_OMIT } },
    });
    if (!mdtCase) throw new NotFoundException('MDT 케이스를 찾을 수 없습니다');

    const disclaimer = await this.medicalAi.getDisclaimer();
    const base = { caseId, patientId: mdtCase.patientId, disclaimer, proposalId: null as string | null };

    const prompt = `환자의 임상 정보를 요약해주세요: 진단: ${mdtCase.primaryDiag}, 병기: ${mdtCase.tnmStage || '미상'}`;

    let aiResult: unknown;
    try {
      aiResult = await this.medicalAi.reference(prompt, 'clinical-summary');
    } catch (e) {
      // 실패를 "없음"으로 번역하지 않는다 — 사유를 그대로 화면에 올린다
      return {
        ...base,
        draft: null,
        source: 'UNAVAILABLE',
        reason: `AI 서버 호출 실패: ${e instanceof Error ? e.message : String(e)}`,
        model: null,
      };
    }

    const answer =
      typeof aiResult === 'string'
        ? aiResult
        : typeof (aiResult as Record<string, unknown> | null)?.answer === 'string'
          ? ((aiResult as Record<string, unknown>).answer as string)
          : null;
    const modelRaw = (aiResult as Record<string, unknown> | null)?.model_used ?? (aiResult as Record<string, unknown> | null)?.model;
    const model = typeof modelRaw === 'string' ? modelRaw : null;

    // 🔴 종전엔 해석 못 한 응답을 `JSON.stringify(aiResult)` 로 임상요약에 밀어넣었다.
    //    형태를 모르는 응답은 요약이 아니다 — 초안 없음으로 말한다.
    if (answer === null) {
      return { ...base, draft: null, source: 'UNAVAILABLE', reason: 'AI 응답 형식을 해석할 수 없습니다', model };
    }
    if (!answer.trim()) {
      return { ...base, draft: null, source: 'UNAVAILABLE', reason: 'AI 가 빈 응답을 돌려주었습니다', model };
    }

    const draft = answer.trim();
    // 초안이 실제로 나온 경우에만 제안 원장에 남긴다(산출 불가에는 제안이 없다 — 빈 제안을 만들지 않는다)
    const proposalId = await this.createSummaryProposal({
      caseId,
      patientId: mdtCase.patientId,
      draft,
      prompt,
      model,
      userId,
    });
    return { ...base, draft, source: 'AI', reason: null, model, proposalId };
  }

  /**
   * 임상요약 초안 1건을 제안 원장에 남긴다 — 🔴 **정본은 쓰지 않는다**(사람이 `updateCase` 로 저장한다).
   * 기록 실패는 초안 제공을 막지 않는다. 대신 `null` 로 돌려 화면이 "원장에 남지 않았다"를 말하게 한다.
   */
  private async createSummaryProposal(input: {
    caseId: string;
    patientId: string;
    draft: string;
    prompt: string;
    model: string | null;
    userId?: string;
  }): Promise<string | null> {
    try {
      const proposal = await this.aiProposal.create({
        kind: 'MDT_SUMMARY',
        targetType: MDT_PROPOSAL_TARGET_TYPE,
        targetId: input.caseId,
        patientId: input.patientId,
        content: input.draft,
        modelRef: upstreamModelRef(input.model),
        promptVersion: MDT_SUMMARY_PROMPT_VERSION,
        inputSnapshotHash: sha256(input.prompt),
        source: 'AI',
        createdBy: input.userId ?? null,
      });
      return proposal.id;
    } catch (e) {
      this.logger.error(`MdtCase ${input.caseId}: AI 제안 기록 실패 — ${(e as Error).message}`);
      return null;
    }
  }

  /** 참석자 추가 */
  async addAttendee(conferenceId: string, data: Record<string, unknown>) {
    await this.ensureConference(conferenceId);
    return this.prisma.mdtAttendee.create({
      data: {
        conferenceId,
        userId: data.userId as string,
        department: data.department as string,
        role: data.role as string,
        attended: (data.attended as boolean) ?? false,
      },
    });
  }

  /** 참석 여부 수정 */
  async updateAttendee(id: string, data: Record<string, unknown>) {
    const existing = await this.prisma.mdtAttendee.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('MDT 참석자를 찾을 수 없습니다');

    return this.prisma.mdtAttendee.update({
      where: { id },
      data: {
        ...(data.role ? { role: data.role as string } : {}),
        ...(data.attended !== undefined ? { attended: data.attended as boolean } : {}),
      },
    });
  }

  /** 환자의 MDT 이력 */
  async getPatientHistory(patientId: string) {
    const cases = await this.prisma.mdtCase.findMany({
      where: { patientId },
      include: {
        conference: {
          select: {
            id: true,
            title: true,
            conferenceType: true,
            department: true,
            scheduledAt: true,
            status: true,
          },
        },
      },
      orderBy: { conference: { scheduledAt: 'desc' } },
    });
    // FE(PatientMdtRecord)는 평면 구조 기대 → 중첩 conference 평탄화
    return cases.map((c) => ({
      ...c,
      conferenceId: c.conference?.id,
      conferenceTitle: c.conference?.title,
      conferenceDate: c.conference?.scheduledAt,
      conferenceType: c.conference?.conferenceType,
      conferenceStatus: c.conference?.status,
    }));
  }

  /**
   * MDT 통계
   *
   * 응답 계약: `byStatus`/`byDecisionCategory` 는 **객체 맵**(코드 → 건수)이다.
   * 🔴 화면이 배열로 알고 `.map()` 을 부르다 통계 탭이 통째 크래시했다(W7 ② · P11).
   *    형태를 바꾸면 화면이 죽는다 — 계약 테스트로 고정한다.
   *
   * `overdueScheduled`/`completedWithoutRecord` 는 화면이 사실을 말하기 위한 값이다(W7 ⑧):
   * 예정일이 지났는데 아직 '예정'인 회의, 완료로 표시됐지만 케이스·참석자 기록이 하나도 없는 회의.
   */
  async getStats(dept?: string) {
    const where: Record<string, unknown> = {};
    if (dept) where.department = dept;
    const caseWhere = dept ? { conference: { department: dept } } : {};
    const now = new Date();

    const [totalConferences, statusCounts, decisionCounts, overdueScheduled, completedWithoutRecord, totalCases] =
      await Promise.all([
        this.prisma.mdtConference.count({ where }),
        this.prisma.mdtConference.groupBy({
          by: ['status'],
          where,
          _count: true,
        }),
        this.prisma.mdtCase.groupBy({
          by: ['decisionCategory'],
          where: caseWhere,
          _count: true,
        }),
        this.prisma.mdtConference.count({
          where: { ...where, status: 'SCHEDULED', scheduledAt: { lt: now } },
        }),
        this.prisma.mdtConference.count({
          where: { ...where, status: 'COMPLETED', cases: { none: {} }, attendees: { none: {} } },
        }),
        this.prisma.mdtCase.count({ where: caseWhere }),
      ]);

    return {
      totalConferences,
      totalCases,
      /** 예정일이 지났는데 시작되지 않은 회의 — '예정'으로 두면 미개최 사실이 가려진다(P1ⓓ) */
      overdueScheduled,
      /** 완료 처리됐으나 케이스·참석자 기록이 0건인 회의 — 완료가 곧 기록은 아니다 */
      completedWithoutRecord,
      asOf: now.toISOString(),
      byStatus: statusCounts.reduce((acc, s) => {
        acc[s.status] = s._count;
        return acc;
      }, {} as Record<string, number>),
      byDecisionCategory: decisionCounts.reduce((acc, d) => {
        // 분류를 기록하지 않은 케이스는 'UNRECORDED' — 'OBSERVATION(경과관찰)'로 뭉개지 않는다
        acc[d.decisionCategory ?? 'UNRECORDED'] = d._count;
        return acc;
      }, {} as Record<string, number>),
    };
  }
}
