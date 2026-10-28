import { Controller, Post, Get, Put, Delete, Param, Body, Query, UseGuards, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { CdssService } from './cdss.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CdssCheckDto, CheckOrderSetDto, CreateCdssRuleDto, UpdateCdssRuleDto } from './dto/cdss.dto';

@ApiTags('CDSS (임상 의사결정 지원)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/v1/cdss')
export class CdssController {
  constructor(private readonly service: CdssService) {}

  @Post('check')
  // 간호사 구두처방 대리입력에도 알레르기·상호작용 사전 점검을 보인다(읽기 전용 계산 · 2026-09-29) — 종전엔 403 을 화면이 조용히 삼켜 점검 없이 입력했다
  @Roles(UserRole.DOCTOR, UserRole.ADMIN, UserRole.NURSE)
  @ApiOperation({ summary: '실시간 처방 검증 (7개 영역)' })
  async check(@Body() body: CdssCheckDto) {
    return { data: await this.service.check(body) };
  }

  @Post('check-order-set')
  @Roles(UserRole.DOCTOR, UserRole.ADMIN)
  @ApiOperation({ summary: '처방세트(템플릿) 검증 — 환자 비의존 검사만(병용금기·동일성분 중복)' })
  async checkOrderSet(@Body() body: CheckOrderSetDto) {
    return { data: await this.service.checkOrderSet(body.medications) };
  }

  @Get('suggest-orderset')
  @Roles(UserRole.DOCTOR, UserRole.ADMIN)
  @ApiOperation({ summary: '진단 기반 처방세트 추천' })
  async suggestOrderSet(
    @Query('diagnosisCode') diagnosisCode: string,
    @Query('patientId') patientId: string,
  ) {
    return { data: await this.service.suggestOrderSet(diagnosisCode, patientId) };
  }

  // ── 규칙 관리 CRUD ──

  @Get('rules')
  @Roles(UserRole.ADMIN, UserRole.DOCTOR)
  @ApiOperation({ summary: 'CDSS 규칙 목록' })
  async getRules(@Query('category') category?: string) {
    return { data: await this.service.getRules(category) };
  }

  @Post('rules')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'CDSS 규칙 추가' })
  async createRule(@Body() dto: CreateCdssRuleDto) {
    return { data: await this.service.createRule(dto) };
  }

  @Put('rules/:id')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'CDSS 규칙 수정' })
  async updateRule(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCdssRuleDto) {
    return { data: await this.service.updateRule(id, dto) };
  }

  @Delete('rules/:id')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'CDSS 규칙 삭제' })
  async deleteRule(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.service.deleteRule(id) };
  }

  @Get('rules/stats')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'CDSS 규칙 적용 통계' })
  async getRuleStats() {
    return { data: await this.service.getRuleStats() };
  }

  @Get('logs')
  @Roles(UserRole.ADMIN, UserRole.DOCTOR)
  @ApiOperation({ summary: 'CDSS 검증 이력 조회' })
  async getLogs(@Query('patientId') patientId?: string, @Query('level') level?: string) {
    return { data: await this.service.getLogs(patientId, level) };
  }

  @Get('logs/encounter/:encounterId')
  @Roles(UserRole.ADMIN, UserRole.DOCTOR)
  @ApiOperation({ summary: '진료별 CDSS 검증 이력' })
  async getLogsByEncounter(@Param('encounterId', ParseUUIDPipe) encounterId: string) {
    return { data: await this.service.getLogsByEncounter(encounterId) };
  }
}
