import { Controller, Get, Query, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { UserRole } from '@prisma/client';
import { AiOversightService } from './ai-oversight.service';
import {
  AiOversightCallsQueryDto,
  AiOversightExportQueryDto,
  AiOversightProposalQueryDto,
  AiOversightSummaryQueryDto,
} from './dto/ai-oversight.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuditAiRead } from '../audit/no-audit.decorator';
import { AuditService } from '../audit/audit.service';

/**
 * AI 감독 관제 EP — 기획서 `docs/01-plan/features/ai-judgment-governance.plan.md` §2.3.
 *
 * 🔴 **역할**: ADMIN(운영)·EXECUTIVE(경영 보고)·DOCTOR(질 관리 근거 열람).
 *    임상 초안 **본문**은 여기서 나가지 않으므로 셋을 함께 둔다 — 본문을 보는 경로는
 *    `/api/v1/ai/proposals/:id`(임상 역할·환자 귀속 감사)로 따로 있다.
 *    내보내기(CSV)만 **ADMIN 전용**이다(대량 반출은 성격이 다르다).
 *
 * 🔴 **응답 규약** `{ data, meta }` — 비율에는 분모(`denominator`)와 분모 이름이 붙고,
 *    표본이 없으면 값은 `null` 이며 `unavailableReason` 이 왜인지 말한다(`0` 은 다른 사실이다).
 */
@ApiTags('Admin · AI Oversight')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/v1/admin/ai-oversight')
export class AiOversightController {
  constructor(
    private readonly service: AiOversightService,
    private readonly audit: AuditService,
  ) {}

  @Get('summary')
  @Roles(UserRole.ADMIN, UserRole.EXECUTIVE, UserRole.DOCTOR)
  @ApiOperation({ summary: 'AI 제안 수용/수정/거부/만료 지표(분모 병기 · 표본 0 = null)' })
  async summary(@Query() q: AiOversightSummaryQueryDto) {
    const [data, quickAccept] = await Promise.all([
      this.service.summary({
        days: q.days,
        kind: q.kind ?? null,
        dept: q.dept ?? null,
        userId: q.userId ?? null,
        modelRef: q.modelRef ?? null,
      }),
      this.service.quickAcceptPolicy(),
    ]);
    return {
      data,
      /**
       * 🔴 임계가 **원내 설정인지 코드 기본값인지**를 meta 가 말한다 — 기본값을 정책인 척하지 않는다.
       */
      meta: { quickAcceptPolicy: quickAccept },
    };
  }

  /**
   * 감독용 제안 목록 — 🔴 본문 없음 · 환자는 가명.
   *
   * 🔴 `@AuditAiRead` 를 붙인 이유와 **그 한계**:
   *    이 GET 은 경로 패턴(`PHI_READ_PATTERNS`)에도 `query.patientId` 에도 걸리지 않아
   *    아무것도 남지 않는 자리다. 붙이면 감사 인터셉터가 열람 1행을 남긴다.
   *    다만 이 목록은 **여러 환자에 걸친 집합**이라 한 환자에 귀속되지 않는다 —
   *    인터셉터는 그것을 `patientBound=false;via=none` 으로 **적는다**(환자를 지어내지 않는다).
   *    즉 이 행은 "환자별 접근이력"에는 잡히지 않는다. 그 사실을 숨기지 않는 것이 규약이다.
   */
  @Get('proposals')
  @Roles(UserRole.ADMIN, UserRole.EXECUTIVE, UserRole.DOCTOR)
  @AuditAiRead('AiOversightProposalList')
  @ApiOperation({ summary: 'AI 제안 목록(본문 없음 · 환자는 HMAC 가명)' })
  async proposals(@Query() q: AiOversightProposalQueryDto) {
    const data = await this.service.proposals({
      days: q.days,
      kind: q.kind ?? null,
      dept: q.dept ?? null,
      userId: q.userId ?? null,
      modelRef: q.modelRef ?? null,
      status: q.status ?? null,
      limit: q.limit,
    });
    return { data, meta: { count: data.items.length, truncated: data.truncated } };
  }

  @Get('calls')
  @Roles(UserRole.ADMIN, UserRole.EXECUTIVE, UserRole.DOCTOR)
  @ApiOperation({ summary: 'AI 호출 분포(정본 call-stats 위임) + 지연 p50/p90' })
  async calls(@Query() q: AiOversightCallsQueryDto) {
    const data = await this.service.calls(q.days ?? 7);
    return { data, meta: { sample: data.distribution.sample } };
  }

  /**
   * 스크라이브 초안 ↔ 서명 진료기록 수정량 분포 — 🔴 **집계만**(환자·진료 식별자·본문 없음).
   *    여러 환자에 걸친 숫자뿐이라 환자 귀속 열람 감사 대상이 아니다(`summary` 와 같은 성격).
   *    표본 0 이면 분포는 null + 사유 — 0% 가 아니다.
   */
  @Get('scribe-edits')
  @Roles(UserRole.ADMIN, UserRole.EXECUTIVE, UserRole.DOCTOR)
  @ApiOperation({ summary: '스크라이브 초안↔확정 수정량 분포(정규화 편집거리 중앙값·p90·무수정 비율 · 분모 병기)' })
  async scribeEdits(@Query() q: AiOversightCallsQueryDto) {
    const data = await this.service.scribeEdits(q.days);
    return { data, meta: { measured: data.funnel.measured, truncated: data.truncated } };
  }

  /**
   * PMS 내보내기 — 🔴 **ADMIN 전용 · PHI 없음**.
   *
   * 🔴 감사행은 **여기서 직접** 남긴다. 감사 인터셉터는 GET 을 기본 감사하지 않고
   *    (`@Res()` 로 직접 응답하면 응답 tap 도 도움이 안 된다), 대량 반출은 남지 않으면
   *    일어나지 않은 것과 같다. `resourceId` 는 요청자(User) — 이 반출은 환자에 귀속되지 않는다
   *    (가명만 나가므로). 그 사실도 `changes` 에 적는다.
   */
  @Get('export.csv')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'AI 제안·전이·호출 CSV 내보내기(PHI 없음 · 감사행 AiOversightExport)' })
  async exportCsv(
    @Res() res: Response,
    @CurrentUser('id') userId: string,
    @Query() q: AiOversightExportQueryDto,
  ) {
    const file = await this.service.exportCsv(q.from ?? null, q.to ?? null);

    await this.audit.log({
      userId,
      action: 'READ',
      resourceType: 'AiOversightExport',
      // 🔴 환자에 귀속되지 않는 반출이다 — 요청자에 귀속하고, 그 사실을 changes 가 말한다
      resourceId: userId,
      changes: {
        export: {
          old: null,
          new:
            `from=${q.from ?? ''};to=${q.to ?? ''};proposals=${file.counts.proposals};` +
            `transitions=${file.counts.transitions};calls=${file.counts.calls};` +
            `truncated=${file.truncated};phi=none;patientId=pseudonymous`,
        },
      },
    });

    res.set({
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${file.filename}"`,
      // 🔴 잘렸으면 헤더로도 말한다(파일만 보고 전건이라 믿지 않게)
      'X-Export-Truncated': String(file.truncated),
      'X-Export-Proposals': String(file.counts.proposals),
      'X-Export-Phi': 'none',
    });
    res.send(file.content);
  }
}
