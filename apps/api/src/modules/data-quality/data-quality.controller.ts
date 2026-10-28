import { Controller, Get, Post, Body, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { DataQualityService } from './data-quality.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { NormalizeApplyDto, OutreachDraftDto } from './dto/data-quality-write.dto';

@ApiTags('Data Quality (데이터 품질)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/v1/data-quality')
export class DataQualityController {
  constructor(private readonly svc: DataQualityService) {}

  // 🔴 B4: 산출주체 역할(간호·검사)도 자기 도메인 지표를 본다 — 서비스가 역할로 필터링
  @Get('summary')
  @Roles(UserRole.ADMIN, UserRole.NURSE, UserRole.LAB_TECH)
  @ApiOperation({ summary: '데이터 품질 지표 요약(도메인별) — 역할별 필터·워크리스트 딥링크' })
  async summary(@Query('domain') domain?: string, @CurrentUser('role') role?: string) {
    return { data: await this.svc.summary(domain, role) };
  }

  @Get('detail')
  @Roles(UserRole.ADMIN, UserRole.NURSE, UserRole.LAB_TECH)
  @ApiOperation({ summary: 'panel 지표 상세 워크리스트(상위 50) — 지표 권한 없으면 403' })
  async detail(@Query('key') key: string, @CurrentUser('role') role?: string) {
    return { data: await this.svc.detail(key, role) };
  }

  @Post('snapshot')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '스냅샷 즉시 실행(매일 06시 자동 — 수동 트리거)' })
  async snapshot() {
    return { data: await this.svc.captureSnapshot() };
  }

  @Get('briefing')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'C1 품질 브리핑 — quality.ai.enabled ON시 AI 요약·OFF/실패시 규칙 폴백(집계 숫자만 전달)' })
  async briefing() {
    return { data: await this.svc.briefing() };
  }

  @Post('duplicates/score')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'C2 중복 의심 AI 판별(상위 그룹·최소 특징만) — 병합은 기존 환자 병합에서 사람이' })
  async scoreDuplicates(@Query('limit') limit?: string) {
    return { data: await this.svc.scoreDuplicates(limit ? Math.min(parseInt(limit, 10) || 10, 20) : 10) };
  }

  @Get('outreach/targets')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'C3 아웃리치 대상 요약(동의 보유/전체 — 자동 발송 없음)' })
  async outreachTargets(@Query('type') type: 'recall' | 'infoUpdate' | 'passportExpiry') {
    return { data: await this.svc.outreachTargets(type ?? 'recall') };
  }

  @Post('outreach/draft')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'C3 메시지 초안 생성({{name}} 토큰·발송은 상담데스크 사람) — 게이트 OFF/ko=정적 템플릿' })
  async outreachDraft(@Body() body: OutreachDraftDto) {
    return { data: await this.svc.outreachDraft(body.type ?? 'recall', body.language ?? 'ko') };
  }

  @Get('normalize/preview')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'C4 전화 정규화 미리보기(결정적 규칙 E.164·상위 100)' })
  async normalizePreview() {
    return { data: await this.svc.normalizePreview() };
  }

  @Post('normalize/apply')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'C4 적용 — 승인한 id만·감사로그 before/after 보존' })
  async normalizeApply(@Body() body: NormalizeApplyDto, @CurrentUser('id') userId: string) {
    return { data: await this.svc.normalizeApply(body.ids, userId) };
  }

  @Get('trend')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '지표 추이(일일 스냅샷)' })
  async trend(@Query('key') key: string, @Query('days') days?: string) {
    return { data: await this.svc.trend(key, days ? parseInt(days, 10) || 30 : 30) };
  }
}
