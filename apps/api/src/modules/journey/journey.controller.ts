import {
  BadRequestException,
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { JOURNEY_EPISODE_OBJECT_TYPES } from '@hospital-run/shared';
import { JourneyService } from './journey.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@ApiTags('Patient Journey')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/v1/journey')
export class JourneyController {
  constructor(private readonly journeyService: JourneyService) {}

  @Get('metrics')
  // 🔴 환자여정 지표는 집계 조회다 — /journey 는 간호사 nav 인데 카드가 상시 403 이었다
  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE)
  @ApiOperation({ summary: '질관리 지표 집계' })
  async getMetrics(
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const result = await this.journeyService.getMetrics({ from, to });
    return { data: result };
  }

  /**
   * (P3-1) 반출 준비도 — 집계만. 🔴 반출 경로가 아니다(사건·환자 데이터를 내보내지 않는다) — 반출 허용은 사람 결정 `journey.exportMode`.
   * 관리자 전용. `:patientId` 경로보다 먼저 선언한다(경로 충돌 방지).
   */
  @Get('export-readiness')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '여정 반출 준비도(집계만) — 시각 미상·매핑 불가·평탄화(결핍/수렴)·출처별 건수 · 반출 경로 없음(결정 대기)' })
  async exportReadiness(
    @Query('caseType') caseType?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return { data: await this.journeyService.exportReadiness({ caseType, from, to }) };
  }

  /**
   * 의료진 관점 여정 — 오더(검사·영상·약제·치료)·처방·위급값의 단계 이력과 질관리 점검(수·분모 · 임계 판정 없음).
   * 환자 지목 조회라 열람 감사 대상(PHI_READ_PATTERNS).
   */
  @Get(':patientId/clinical-lens')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.PHARMACIST, UserRole.ADMIN)
  @ApiOperation({ summary: '의료진 관점 여정 — 오더·처방·위급값 단계 이력 + 질관리 점검(결과 확인·소요 시간·구두 처방 확인·DUR·투약 기록)' })
  async getClinicalLens(
    @Param('patientId', ParseUUIDPipe) patientId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return { data: await this.journeyService.getClinicalLens(patientId, { from, to }) };
  }

  @Get(':patientId/report')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: '환자 여정 기간 보고서 — 입원(admissionId) 또는 from~to 기간의 유형별 건수·간격(양 끝 이벤트가 있을 때만)' })
  async getReport(
    @Param('patientId', ParseUUIDPipe) patientId: string,
    @Query('admissionId', new ParseUUIDPipe({ optional: true })) admissionId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return { data: await this.journeyService.getReport(patientId, { admissionId, from, to }) };
  }

  @Get(':patientId/episodes')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: '환자 방문 묶음(도메인 원장 요약 — 외래·응급·입원·수술·검진)' })
  async getEpisodes(@Param('patientId', ParseUUIDPipe) patientId: string) {
    const r = await this.journeyService.getEpisodes(patientId);
    return { data: r.episodes, meta: { truncatedTypes: r.truncatedTypes, perTypeLimit: r.perTypeLimit } };
  }

  @Get(':patientId/timeline')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: '환자 여정 타임라인' })
  async getTimeline(
    @Param('patientId', ParseUUIDPipe) patientId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('types') types?: string,
    @Query('limit') limit?: string,
    @Query('before') before?: string,
    @Query('episodeType') episodeType?: string,
    @Query('episodeId') episodeId?: string,
  ) {
    // (P3 표시 잔여) 방문 하나로 거르기 — 둘 다 있거나 둘 다 없어야 한다 · 방문 단위 유형만
    if (!!episodeType !== !!episodeId) throw new BadRequestException('episodeType 과 episodeId 는 함께 보냅니다');
    if (episodeType && !(JOURNEY_EPISODE_OBJECT_TYPES as readonly string[]).includes(episodeType)) {
      throw new BadRequestException('episodeType 은 방문 단위 유형(WaitingQueue·EmergencyVisit·Admission·Surgery·CheckupVisit)이어야 합니다');
    }
    if (episodeId && !UUID_RE.test(episodeId)) throw new BadRequestException('episodeId 는 UUID 입니다');
    const r = await this.journeyService.getTimeline(patientId, {
      episode: episodeType && episodeId ? { type: episodeType, id: episodeId } : undefined,
      from,
      to,
      types: types?.split(',').map(t => t.trim()),
      limit: limit ? parseInt(limit, 10) : undefined,
      before,
    });
    // data 는 시간순 배열(종전 모양 유지) · 잘림은 meta 로 말한다(P0-8)
    return { data: r.events, meta: { truncated: r.truncated, olderCursor: r.olderCursor, orderBy: r.orderBy } };
  }
}
