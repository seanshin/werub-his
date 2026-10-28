import { Controller, Post, Body, Req, UseGuards, BadRequestException, ForbiddenException, Logger } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { SmartAuthGuard, FhirScope } from '../smart-auth/smart-auth.guard';
import { SmartAuthService, SmartTokenPayload } from '../smart-auth/smart-auth.service';

/**
 * 디지털 트윈 FHIR write-back (A4-3) — AI 생성 RiskAssessment 저장.
 * 정책: SMART 쓰기 스코프(patient/RiskAssessment.write) + AI-flag 필수 + 동의 게이트 + 온디맨드 + 양측 감사.
 * 자동 write 금지(의료진 "차트 저장" 액션으로 트윈이 호출).
 */
@ApiTags('FHIR R4 (Twin write-back)')
@ApiBearerAuth()
@UseGuards(SmartAuthGuard)
@Controller('fhir/R4')
export class FhirWritebackController {
  private readonly logger = new Logger(FhirWritebackController.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly smartAuth: SmartAuthService,
  ) {}

  @Post('RiskAssessment')
  @FhirScope('RiskAssessment', 'write')
  @ApiOperation({ summary: '트윈 AI RiskAssessment write-back(A4-3) — AI-flag·동의·감사 필수' })
  async createRiskAssessment(@Body() body: Record<string, unknown>, @Req() req: { smartClient?: SmartTokenPayload }) {
    if (body?.resourceType !== 'RiskAssessment') throw new BadRequestException('resourceType must be RiskAssessment');

    // 1) subject(Patient/{id}) 추출
    const subject = (body.subject as { reference?: string })?.reference || '';
    const patientId = subject.replace(/^Patient\//, '');
    if (!patientId) throw new BadRequestException('subject(Patient/{id}) required');
    // 🔴 정본 경유 — 로컬 사본은 토큰에 patient 클레임이 **없으면 대조를 건너뛰어** 환자 문맥 없는
    //    patient/·user/ 쓰기 토큰(client_credentials)이 아무 동의 환자에게 쓸 수 있었다.
    this.smartAuth.assertPatientAccess(req.smartClient, 'RiskAssessment', patientId, 'write');

    // 2) AI-flag 필수 — meta.tag machine-generated + extension twin-ai-generated (비AI write 차단)
    const tags = ((body.meta as { tag?: { code?: string }[] })?.tag) || [];
    const hasMachineTag = tags.some((t) => t.code === 'machine-generated');
    const exts = (body.extension as { url?: string; valueBoolean?: boolean }[]) || [];
    const hasAiExt = exts.some((e) => /twin-ai-generated/.test(e.url || '') && e.valueBoolean === true);
    if (!hasMachineTag || !hasAiExt) {
      throw new BadRequestException('AI-flag 필수: meta.tag(machine-generated) + extension(twin-ai-generated=true)');
    }

    // 3) 동의 게이트 — 미동의/철회 환자는 write-back 차단
    const consent = await this.prisma.patientAiConsent.findUnique({ where: { patientId } });
    if (!(consent && consent.consented && !consent.revokedAt)) {
      throw new ForbiddenException('트윈/AI 활용 동의가 필요합니다');
    }

    // 4) 저장
    const authorFhirUser = (body.performer as { actor?: { reference?: string } }[])?.[0]?.actor?.reference
      || (body._authorFhirUser as string) || null;
    const created = await this.prisma.twinRiskAssessment.create({
      data: {
        patientId,
        status: String(body.status ?? 'final'),
        method: (body.method as { coding?: { code?: string }[]; text?: string })?.coding?.[0]?.code
          || (body.method as { text?: string })?.text || null,
        occurrenceDateTime: body.occurrenceDateTime ? new Date(body.occurrenceDateTime as string) : null,
        basis: (body.basis as object) ?? undefined,
        prediction: (body.prediction as object) ?? undefined,
        note: Array.isArray(body.note) ? (body.note as { text?: string }[]).map((n) => n.text).join('\n') : (body.note as string) ?? null,
        aiGenerated: true,
        authorFhirUser,
        clientId: req.smartClient?.client_id ?? null,
        resourceJson: body as object,
      },
    });

    // 5) 감사(HIS측) — best-effort
    void this.audit.log({
      userId: authorFhirUser?.replace(/^Practitioner\//, '') || 'twin-service',
      action: 'CREATE',
      resourceType: 'TwinRiskAssessment',
      resourceId: patientId,
      changes: { method: { old: null, new: created.method }, client: { old: null, new: created.clientId } },
    }).catch((e) => this.logger.warn(`[twin write-back] RiskAssessment 감사 실패(비차단) patient=${patientId}: ${e instanceof Error ? e.message : e}`));

    // 🔴 FHIR 201 — 서버 할당 id·meta 가 이긴다(종전 `...body` 가 뒤에 와서 서버 meta 를 클라이언트 것으로 덮었다 →
    //    versionId/lastUpdated 소실로 ETag/낙관적 동시성이 깨졌다). meta 는 병합(클라 tag 보존 + 서버 버전).
    return {
      ...body,
      resourceType: 'RiskAssessment',
      id: created.id,
      meta: { ...(body.meta as object ?? {}), versionId: '1', lastUpdated: created.createdAt, tag: tags },
    };
  }

  @Post('DocumentReference')
  @FhirScope('DocumentReference', 'write')
  @ApiOperation({ summary: '트윈 AI DocumentReference(SBAR) write-back(A4-3 2단계) — AI-flag·동의·감사 필수' })
  async createDocumentReference(@Body() body: Record<string, unknown>, @Req() req: { smartClient?: SmartTokenPayload }) {
    if (body?.resourceType !== 'DocumentReference') throw new BadRequestException('resourceType must be DocumentReference');

    // subject(Patient/{id})
    const subject = (body.subject as { reference?: string })?.reference || '';
    const patientId = subject.replace(/^Patient\//, '');
    if (!patientId) throw new BadRequestException('subject(Patient/{id}) required');
    this.smartAuth.assertPatientAccess(req.smartClient, 'DocumentReference', patientId, 'write');

    // AI-flag 필수
    const tags = ((body.meta as { tag?: { code?: string }[] })?.tag) || [];
    const hasMachineTag = tags.some((t) => t.code === 'machine-generated');
    const exts = (body.extension as { url?: string; valueBoolean?: boolean }[]) || [];
    const hasAiExt = exts.some((e) => /twin-ai-generated/.test(e.url || '') && e.valueBoolean === true);
    if (!hasMachineTag || !hasAiExt) {
      throw new BadRequestException('AI-flag 필수: meta.tag(machine-generated) + extension(twin-ai-generated=true)');
    }

    // 동의 게이트
    const consent = await this.prisma.patientAiConsent.findUnique({ where: { patientId } });
    if (!(consent && consent.consented && !consent.revokedAt)) {
      throw new ForbiddenException('트윈/AI 활용 동의가 필요합니다');
    }

    // SBAR 본문 추출(content[].attachment.data base64 또는 .text)
    const content = (body.content as { attachment?: { data?: string; contentType?: string } }[]) || [];
    let contentText: string | null = null;
    const att = content[0]?.attachment;
    if (att?.data) { try { contentText = Buffer.from(att.data, 'base64').toString('utf-8'); } catch { contentText = att.data; } }

    const authorFhirUser = (body.author as { reference?: string }[])?.[0]?.reference
      || (body._authorFhirUser as string) || null;
    const created = await this.prisma.twinDocumentReference.create({
      data: {
        patientId,
        status: String(body.status ?? 'current'),
        docType: (body.type as { coding?: { code?: string }[]; text?: string })?.coding?.[0]?.code
          || (body.type as { text?: string })?.text || 'SBAR',
        description: (body.description as string) ?? null,
        contentText,
        aiGenerated: true,
        authorFhirUser,
        clientId: req.smartClient?.client_id ?? null,
        resourceJson: body as object,
      },
    });

    void this.audit.log({
      userId: authorFhirUser?.replace(/^Practitioner\//, '') || 'twin-service',
      action: 'CREATE',
      resourceType: 'TwinDocumentReference',
      resourceId: patientId,
      changes: { docType: { old: null, new: created.docType }, client: { old: null, new: created.clientId } },
    }).catch((e) => this.logger.warn(`[twin write-back] DocumentReference 감사 실패(비차단) patient=${patientId}: ${e instanceof Error ? e.message : e}`));

    // 🔴 서버 할당 id·meta 가 이긴다(RA 와 동일 — 클로버링 방지·meta 병합)
    return {
      ...body,
      resourceType: 'DocumentReference',
      id: created.id,
      meta: { ...(body.meta as object ?? {}), versionId: '1', lastUpdated: created.createdAt, tag: tags },
    };
  }
}
