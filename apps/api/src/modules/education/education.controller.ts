import { Controller, Get, Post, Param, Body, Query, UseGuards, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { EVERY_STAFF_ROLE } from '@hospital-run/shared';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { EducationService } from './education.service';
import { CreateProgramDto, RecordCompletionDto } from './dto/education.dto';
import { AddCasePresentationDto, AddEpaAssessmentDto, AddLogbookEntryDto, AssignRotationDto } from './dto/education-training.dto';

/**
 * 🔴 역할 목록은 shared 정본 하나 — 여기에 다시 적으면 신설 직군이 따라오지 못한다.
 *    실제로 그랬다(2026-09-02 실측): 손으로 적은 12역할 목록에 CRM_MANAGER·CRM_STAFF 가 빠져
 *    CRM 직원이 자기 근태·급여·결재함에서 상시 403 을 봤다.
 *    READ 만 뺀다 — 외부 연동 **읽기전용 서비스 계정**이라 사람 인사 정보의 대상이 아니다.
 */
const HUMAN_STAFF_ROLES = EVERY_STAFF_ROLE.filter((r) => r !== 'READ').map((r) => r as UserRole);

@ApiTags('Education (직원교육)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/v1/education')
export class EducationController {
  constructor(private readonly service: EducationService) {}

  @Get('programs')
  @Roles(...HUMAN_STAFF_ROLES)
  @ApiOperation({ summary: '교육 프로그램 목록' })
  async getPrograms() { return { data: await this.service.getPrograms() }; }

  @Post('programs')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '교육 프로그램 등록' })
  async create(@Body() dto: CreateProgramDto) { return { data: await this.service.createProgram(dto) }; }

  @Post('completions')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '교육 이수 기록' })
  async record(@Body() dto: RecordCompletionDto) { return { data: await this.service.recordCompletion(dto) }; }

  @Get('completions/:staffId')
  @Roles(...HUMAN_STAFF_ROLES)
  @ApiOperation({ summary: '직원별 이수 현황' })
  async getByStaff(@Param('staffId') staffId: string) { return { data: await this.service.getStaffCompletions(staffId) }; }

  // 🔴 응답은 배열이 아니라 { expired, dueSoon } 이다 — 실효(경과)와 임박(도래 예정)을 섞어 부르면
  //    법정 의무교육의 위반 사실이 '임박'으로 완화 표기된다(2026-08 W7 실측 194/261건).
  @Get('expiring')
  @Roles(...HUMAN_STAFF_ROLES)
  @ApiOperation({ summary: '교육 만료(실효)·만료 임박 현황 (분리·직원명 포함·상한 표식)' })
  async getExpiring(@Query('limit') limit?: string) {
    return { data: await this.service.getExpiringSoon(limit ? Number(limit) : undefined) };
  }

  @Get('coverage')
  @Roles(...HUMAN_STAFF_ROLES)
  @ApiOperation({ summary: '이수 기록 보유 현황 (이수율 아님 — 대상자 모델 부재로 산출 불가)' })
  async getCoverage(@Query('limit') limit?: string) {
    return { data: await this.service.getCompletionCoverage(limit ? Number(limit) : undefined) };
  }

  // ── 수련 로그북 ──

  @Post('logbook/:userId')
  @Roles(UserRole.DOCTOR, UserRole.ADMIN)
  @ApiOperation({ summary: '수련 로그북 항목 추가' })
  async addLogbookEntry(@Param('userId') userId: string, @Body() body: AddLogbookEntryDto) {
    return { data: await this.service.addLogbookEntry(userId, body) };
  }

  @Get('logbook/:userId')
  @Roles(...HUMAN_STAFF_ROLES)
  @ApiOperation({ summary: '수련 로그북 조회 (기간/유형별)' })
  async getLogbook(@Param('userId') userId: string, @Query('period') period?: string) {
    return { data: await this.service.getLogbook(userId, period) };
  }

  // ── EPA 역량 평가 ──

  @Post('epa/:userId')
  @Roles(UserRole.DOCTOR, UserRole.ADMIN)
  @ApiOperation({ summary: 'EPA 역량 평가 등록' })
  async addEpaAssessment(@Param('userId') userId: string, @Body() body: AddEpaAssessmentDto) {
    return { data: await this.service.addEpaAssessment(userId, body) };
  }

  @Get('epa/:userId')
  @Roles(...HUMAN_STAFF_ROLES)
  @ApiOperation({ summary: 'EPA 달성 현황 조회' })
  async getEpaStatus(@Param('userId') userId: string) {
    return { data: await this.service.getEpaStatus(userId) };
  }

  // ── 로테이션 ──

  @Get('rotations')
  @Roles(...HUMAN_STAFF_ROLES)
  @ApiOperation({ summary: '로테이션 일정 조회' })
  async getRotations() {
    return { data: await this.service.getRotations() };
  }

  @Post('rotations')
  @Roles(UserRole.DOCTOR, UserRole.ADMIN)
  @ApiOperation({ summary: '로테이션 배정' })
  async assignRotation(@Body() body: AssignRotationDto) {
    return { data: await this.service.assignRotation(body) };
  }

  // ── 증례 발표 ──

  @Post('case-presentations')
  @Roles(UserRole.DOCTOR, UserRole.ADMIN)
  @ApiOperation({ summary: '증례 발표 등록' })
  async addCasePresentation(@Body() body: AddCasePresentationDto) {
    return { data: await this.service.addCasePresentation(body) };
  }

  @Get('case-presentations')
  @Roles(...HUMAN_STAFF_ROLES)
  @ApiOperation({ summary: '증례 발표 목록 (진료과별)' })
  async getCasePresentations(@Query('dept') dept?: string) {
    return { data: await this.service.getCasePresentations(dept) };
  }

  // ── 수련 통계 ──

  @Get('training-stats/:userId')
  @Roles(UserRole.ADMIN, UserRole.DOCTOR)
  @ApiOperation({ summary: '개인 수련 대시보드 통계' })
  async getTrainingStats(@Param('userId') userId: string) {
    return { data: await this.service.getTrainingStats(userId) };
  }
}
