import { Body, Controller, Get, Headers, Param, Post, Query, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { I18nReviewService, type ActorLike } from './i18n-review.service';
import {
  DecisionDto,
  OverrideIdParamDto,
  OverridesQueryDto,
  ProposeDto,
  RejectKeyDto,
  ReviewExportQueryDto,
  ReviewQueryDto,
  ReviewStatsQueryDto,
} from './dto/i18n-review.dto';

/**
 * 언어팩 사람 검수 EP — 정본 `docs/01-plan/features/i18n-human-review.plan.md`.
 *
 * 🔴 **일괄 승인 EP 를 만들지 않는다**(§2.3). 이 저장소에서 무확인 일괄 적용은 이미 사고를 냈다
 *    (코드 매핑 `autoConfirm`). 승인은 건별이고, 제안자=승인자면 **막지 않고 그 사실을 응답에 싣는다**.
 * 🔴 **권한이 없으면 숨기지 않는다** — 읽기는 로그인한 직원에게 열려 있고, 쓰기는 403 + 사유다.
 *    목록·통계 응답의 `meta.permission.reason` 이 "왜 못 하는지"를 그대로 말한다(숨김 ≠ 권한 회수).
 * 🔴 `/overrides` 는 **모든 로그인 사용자**가 부른다 — 화면 크롬 번역이라 역할로 가르지 않는다.
 *    담기는 것은 UI 문구뿐이고 PHI 가 아니다.
 */
@ApiTags('i18n · 사람 검수')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('api/v1/i18n')
export class I18nReviewController {
  constructor(private readonly svc: I18nReviewService) {}

  /* ── 런타임 ────────────────────────────────────────────────────────────── */

  /**
   * 🔴 **승인분만 나간다.** 상태를 고르는 파라미터를 두지 않는다 — 열어 두면 소비처가 그것을
   *    부르는 순간 미승인 번역이 화면에 나간다(기획서 §2.2 · 가드 `overlay-approved-only`).
   */
  @Get('overrides')
  @ApiOperation({ summary: '승인된 검수 오버레이(런타임 반영용) — APPROVED 만·ETag' })
  async overrides(
    @Query() q: OverridesQueryDto,
    @Headers('if-none-match') ifNoneMatch: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const r = await this.svc.listOverrides(q.locale);
    res.setHeader('ETag', r.etag);
    res.setHeader('Cache-Control', 'private, max-age=60');
    if (ifNoneMatch && ifNoneMatch === r.etag) {
      res.status(304);
      return;
    }
    return {
      data: { locale: r.locale, status: r.status, entries: r.entries, count: r.count },
      meta: {
        etag: r.etag,
        latestAt: r.latestAt,
        // 🔴 `PROPOSED`/`REJECTED` 는 이 경로로 나가지 않는다 — 소비처가 그 규약을 응답에서 읽는다
        runtimeApplicable: true,
      },
    };
  }

  /* ── 검수 화면 ─────────────────────────────────────────────────────────── */

  @Get('review')
  @ApiOperation({ summary: '검수 워크리스트(코드 초안값 + 오버레이 + 상태 + 안전 키 + 쓰이는 곳)' })
  async review(@CurrentUser() user: ActorLike, @Query() q: ReviewQueryDto) {
    const r = await this.svc.review(user, q);
    return { data: r.rows, meta: r.meta };
  }

  @Get('review/stats')
  @ApiOperation({ summary: '검수 통계 — 분모 병기 · 표본 0 은 null + 산출 불가' })
  async stats(@CurrentUser() user: ActorLike, @Query() q: ReviewStatsQueryDto) {
    const [data, permission] = await Promise.all([this.svc.stats(q.locale), this.svc.permissionFor(user, q.locale)]);
    return { data, meta: { permission } };
  }

  @Get('review/export')
  @ApiOperation({ summary: '승인분 내보내기 — 카탈로그 파일 형식 텍스트(자동 커밋 없음)' })
  async exportText(@Query() q: ReviewExportQueryDto) {
    const r = await this.svc.exportText(q.locale, q.area);
    return { data: r, meta: { note: '🔴 이 텍스트는 코드가 아닙니다 — 사람이 카탈로그 파일에 반영·커밋해야 정본이 됩니다.' } };
  }

  @Post('review')
  @ApiOperation({ summary: '교정 제안(PROPOSED) — 🔴 기록 ≠ 적용(승인 전에는 화면에 나가지 않는다)' })
  async propose(@CurrentUser() user: ActorLike, @Body() dto: ProposeDto) {
    return { data: await this.svc.propose(user, dto) };
  }

  /**
   * 🔴 **"이 키는 번역하지 않는다"** — 제안 없이 **키 하나**로 반려한다(기획서 §2.4).
   *    이 EP 가 없으면 §2.4 는 실행 불가였다: 반려하려면 오버레이 행이 있어야 하고, 행을 만들려면
   *    검수자가 쓰지도 않은 `draftValue` 를 지어내야 했다(안전 키 KTAS·MAR 선례가 막혀 있었다).
   * 🔴 **여전히 건별이다** — `key` 하나만 받는다. 배열을 받는 순간 일괄 반려가 된다.
   */
  @Post('review/reject-key')
  @ApiOperation({ summary: '키만으로 반려(번역하지 않음) — 사유 필수 · 🔴 기록 ≠ 적용(코드 초안은 남는다)' })
  async rejectKey(@CurrentUser() user: ActorLike, @Body() dto: RejectKeyDto) {
    return { data: await this.svc.rejectKey(user, dto) };
  }

  /**
   * 🔴 **건별 승인**이다. `:id` 하나만 받는다 — 배열·`ids`·`all` 을 받는 순간 일괄 승인이 된다.
   */
  @Post('review/:id/approve')
  @ApiOperation({ summary: '승인(건별) — 제안자=승인자면 막지 않고 응답에 그 사실을 싣는다' })
  async approve(@CurrentUser() user: ActorLike, @Param() p: OverrideIdParamDto, @Body() dto: DecisionDto) {
    return { data: await this.svc.decide(user, p.id, 'APPROVED', dto.reason) };
  }

  @Post('review/:id/reject')
  @ApiOperation({ summary: '반려(건별) — 🔴 "번역하지 않고 원문+티로 둔다"도 정답인 선택이다' })
  async reject(@CurrentUser() user: ActorLike, @Param() p: OverrideIdParamDto, @Body() dto: DecisionDto) {
    return { data: await this.svc.decide(user, p.id, 'REJECTED', dto.reason) };
  }

  @Post('review/:id/merged')
  @ApiOperation({ summary: '코드 반영 표시(ADMIN) — 코드가 실제로 같은지도 함께 답한다' })
  async merged(@CurrentUser() user: ActorLike, @Param() p: OverrideIdParamDto, @Body() dto: DecisionDto) {
    return { data: await this.svc.markMerged(user, p.id, dto.reason) };
  }
}
