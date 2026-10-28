import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../modules/auth/guards/jwt-auth.guard';
import { RolesGuard } from '../modules/auth/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { SentinelReadService } from './sentinel-read.service';
import { SentinelJudgmentService } from './sentinel-judgment.service';
import { SentinelAdvisorService } from './sentinel-advisor.service';
import { audienceOf } from './sentinel-audience';
import { AdviceRequestDto, RecordJudgmentDto } from './sentinel-judgment.dto';
import type { SentinelAxis } from './sentinel.service';

/**
 * 상시 감시자 — **읽기 전용** EP. 스윕은 별도 프로세스가 돌린다.
 * 🔴 여기서 스윕을 트리거하지 않는다. API 요청이 전 테이블 조인을 끌면
 *    그것이 곧 진료 경로의 지연이 된다(별도 프로세스로 뺀 이유가 사라진다).
 */
@ApiTags('Sentinel (상시 감시)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/v1/admin/sentinel')
export class SentinelController {
  constructor(
    private readonly svc: SentinelReadService,
    private readonly judgmentSvc: SentinelJudgmentService,
    private readonly advisor: SentinelAdvisorService,
  ) {}

  @Get('overview')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '축별 요약 — 미판정(null)과 0을 구분해 반환' })
  async overview() {
    return { data: await this.svc.overview() };
  }

  @Get('pulse')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '실시간 축 — 지표별 최근 시계열과 지금 판정(급변·정상·축적 중·변동 없음)' })
  async pulse(@Query('minutes') minutes?: string) {
    const w = Number(minutes);
    return { data: await this.svc.pulses(Number.isFinite(w) && w > 0 && w <= 1440 ? w : 120) };
  }

  @Get('findings')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '발견 목록(기본 미해결만) — 최신 사람 판정을 함께 붙인다' })
  async findings(
    @Query('axis') axis?: string,
    @Query('includeResolved') includeResolved?: string,
  ) {
    const [rows, latest] = await Promise.all([
      this.svc.findings({
        axis: axis as SentinelAxis | undefined,
        includeResolved: includeResolved === 'true',
      }),
      this.judgmentSvc.latestByKey(axis),
    ]);
    return {
      data: rows.map((f) => ({
        ...f,
        // 🔴 소관은 표시 분류이지 권한이 아니다 — 미분류는 null 로 정직하게 나간다
        audience: audienceOf(f.axis, f.checkKey),
        judgment: SentinelJudgmentService.judgmentView(f, latest.get(`${f.axis}:${f.checkKey}`) ?? null),
      })),
    };
  }

  /**
   * 판정 기록 — 🔴 기록 ≠ 적용. 발견은 사라지지 않고, 스윕은 계속 센다.
   * 판정 시점 건수는 서버가 발견 행에서 스냅샷한다(클라이언트 값을 받지 않는다).
   */
  @Post('judgments')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '발견 항목 사람 판정 기록(append-only — 재판정은 새 행)' })
  async recordJudgment(@Body() dto: RecordJudgmentDto, @CurrentUser('id') userId: string) {
    return { data: await this.judgmentSvc.record({ ...dto, userId }) };
  }

  /**
   * AI 판정 보조 — 관계 모드는 **초안/보조**. 🔴 권한 검사(ADMIN 가드)가 AI 호출 앞에서 돈다.
   * 출처는 AI | UNAVAILABLE 둘뿐(FALLBACK 없음) — 확정 판정은 사람이 POST judgments 로 한다.
   */
  @Post('findings/ai-advice')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '발견 항목 AI 판정 초안·확인 방법(보조 — 확정은 사람)' })
  async aiAdvice(@Body() dto: AdviceRequestDto) {
    return { data: await this.advisor.analyze(dto.axis, dto.checkKey) };
  }

  @Get('judgments')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '판정 로그 — append-only 이력(최신순)' })
  async judgments(
    @Query('axis') axis?: string,
    @Query('checkKey') checkKey?: string,
  ) {
    return { data: await this.judgmentSvc.log({ axis, checkKey }) };
  }

  @Get('dashboard')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '감시 운영 지표 — 판정 커버리지·스윕 건강·해결 이력·알림(전부 분모 병기)' })
  async dashboard() {
    const [base, redCoverage] = await Promise.all([
      this.svc.dashboard(),
      this.judgmentSvc.redCoverage(),
    ]);
    return { data: { ...base, redCoverage } };
  }
}
