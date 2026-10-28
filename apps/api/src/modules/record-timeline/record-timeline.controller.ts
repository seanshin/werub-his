import { BadRequestException, Body, Controller, Get, Param, Post, Query, UseGuards, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { RecordTimelineService } from './record-timeline.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { NoAudit } from '../audit/no-audit.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('진료·간호 통합 시계열')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE)
@Controller('api/v1/patients/:patientId/record-timeline')
export class RecordTimelineController {
  constructor(private readonly svc: RecordTimelineService) {}

  @Get()
  @ApiOperation({ summary: '임상 기록 통합 시계열 — 진료·간호·검사·영상·처방·활력·수술·입퇴원(유형·기간·입원·상한)' })
  async timeline(
    @Param('patientId', ParseUUIDPipe) patientId: string,
    @Query('types') types?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('admissionId') admissionId?: string,
    @Query('limit') limit?: string,
    @Query('before') before?: string,
  ) {
    return {
      data: await this.svc.getPatientTimeline(patientId, {
        types: types ? types.split(',').map((t) => t.trim()).filter(Boolean) : undefined,
        from: from ? new Date(from) : undefined,
        to: to ? new Date(to) : undefined,
        admissionId: admissionId || undefined,
        limit: limit ? Number(limit) : undefined,
        before, // `<ISO>|<id>` 복합 커서(서비스가 파싱) — 시각만 넘기던 구형도 호환
      }),
    };
  }

  @Post('summary')
  // 변이가 아니라 **열람**(요약 생성·저장 없음) → 기본 변이 감사(CREATE) 오분류를 면제하고
  // 서비스에서 PHI READ 로 명시 기록한다(무엇을 요약했는지: 모드·기간·건수).
  @NoAudit()
  @ApiOperation({ summary: '시계열 AI 정리 — 규칙 요약 항상 + AI 문장 부가(진단·처방 권고 금지)' })
  async summary(
    @Param('patientId', ParseUUIDPipe) patientId: string,
    @Body() body: { mode?: 'all' | 'chart' | 'rx'; types?: string; from?: string; to?: string; ai?: boolean },
    @CurrentUser('id') userId: string,
  ) {
    return {
      data: await this.svc.summarize(patientId, {
        types: body?.types ? body.types.split(',').map((t) => t.trim()).filter(Boolean) : undefined,
        from: body?.from ? new Date(body.from) : undefined,
        to: body?.to ? new Date(body.to) : undefined,
      }, body?.mode ?? 'all', body?.ai !== false, userId),
    };
  }

  @Get('analytics')
  // 열람 — 서비스에서 PHI READ 로 명시 기록
  @NoAudit()
  @ApiOperation({ summary: '시계열 분석 — 검사·활력 추이(처음→최근·변화·범위 안 비율·기울기)·처방 기간·처방 시작 전후 평균(관련성 판단 아님)' })
  async analytics(
    @Param('patientId', ParseUUIDPipe) patientId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @CurrentUser('id') userId?: string,
  ) {
    const f = from ? new Date(from) : undefined;
    const t = to ? new Date(to) : undefined;
    if ((f && Number.isNaN(f.getTime())) || (t && Number.isNaN(t.getTime()))) throw new BadRequestException('from/to must be dates');
    return { data: await this.svc.analytics(patientId, { from: f, to: t }, userId) };
  }

  @Get('insights')
  // 열람(재배치 결과 생성·저장 없음) — 서비스에서 PHI READ 로 명시 기록
  @NoAudit()
  @ApiOperation({ summary: '의미찾기 — 확인필요·마무리·진단·약물·추세·에피소드로 자동 배치' })
  async insights(
    @Param('patientId', ParseUUIDPipe) patientId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('admissionId') admissionId?: string,
    @CurrentUser('id') userId?: string,
  ) {
    return {
      data: await this.svc.insights(patientId, {
        from: from ? new Date(from) : undefined,
        to: to ? new Date(to) : undefined,
        admissionId,
      }, userId),
    };
  }

  @Get(':type/:id')
  @ApiOperation({ summary: '시계열 단건 상세 — 그 기록만(차트 전체 목록 대신 초점 열람)' })
  async detail(
    @Param('patientId', ParseUUIDPipe) patientId: string,
    @Param('type') type: string,
    @Param('id') id: string,
  ) {
    return { data: await this.svc.getRecordDetail(patientId, type.toUpperCase(), id) };
  }
}
