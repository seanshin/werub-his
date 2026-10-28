import { Controller, Get, Post, Patch, Param, Body, Query, UseGuards, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { HospiceService } from './hospice.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CreateAdvanceDirectiveDto, RevokeAdvanceDirectiveDto, CreateHospiceAssessmentDto, CreateHospiceConferenceDto, PrescribeHospiceOpioidDto, RegisterHospiceDto, UpdateHospiceStatusDto } from './dto/hospice.dto';

@ApiTags('Hospice (호스피스/완화의료)')
@ApiBearerAuth()
// 연명의료·사전의향서·ESAS는 민감 임상정보 — 전 스태프 열람 방지. 임상 역할(의사/간호사/관리자)로 제한.
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN)
@Controller('api/v1/hospice')
export class HospiceController {
  constructor(private readonly service: HospiceService) {}

  // ── 등록 ──
  @Post('register')
  @ApiOperation({ summary: '호스피스 등록' })
  async register(@Body() body: RegisterHospiceDto, @CurrentUser('id') userId: string) {
    return { data: await this.service.register({ ...body, registeredBy: userId }) };
  }

  @Post('registrations/:id/opioid')
  @Roles(UserRole.DOCTOR, UserRole.ADMIN)
  @ApiOperation({ summary: '완화의료 마약류(오피오이드) 처방 발행 — 마약류 관리대장 연동' })
  async prescribeOpioid(@Param('id', ParseUUIDPipe) id: string, @Body() body: PrescribeHospiceOpioidDto, @CurrentUser('id') userId: string) {
    return { data: await this.service.prescribeOpioid(id, body, userId) };
  }

  @Get('registrations')
  @ApiOperation({ summary: '호스피스 등록 목록' })
  async getRegistrations(@Query('status') status?: string) {
    return { data: await this.service.getRegistrations(status) };
  }

  @Get('registrations/:id')
  @ApiOperation({ summary: '호스피스 등록 상세' })
  async getRegistration(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.service.getRegistration(id) };
  }

  @Patch('registrations/:id/status')
  @ApiOperation({ summary: '호스피스 상태 변경' })
  async updateStatus(@Param('id', ParseUUIDPipe) id: string, @Body() body: UpdateHospiceStatusDto) {
    return { data: await this.service.updateStatus(id, body.status, body.occurredAt) };
  }

  @Get('stats')
  @ApiOperation({ summary: '호스피스 통계' })
  async getStats() { return { data: await this.service.getStats() }; }

  // ── ESAS 증상 평가 ──
  @Post('assessments')
  @ApiOperation({ summary: 'ESAS 증상 평가' })
  async createAssessment(@Body() body: CreateHospiceAssessmentDto, @CurrentUser('id') userId: string) {
    return { data: await this.service.createAssessment({ ...body, assessorId: userId }) };
  }

  @Get('assessments/:registrationId')
  @ApiOperation({ summary: '증상 평가 이력' })
  async getAssessments(@Param('registrationId', ParseUUIDPipe) registrationId: string) {
    return { data: await this.service.getAssessments(registrationId) };
  }

  // ── 사전의료의향서 ──
  @Post('directives')
  @ApiOperation({ summary: '사전의료의향서 등록' })
  async createDirective(@Body() body: CreateAdvanceDirectiveDto, @CurrentUser() user: { id: string; role?: string }) {
    return { data: await this.service.createDirective(body, user) };
  }

  @Get('directives/:patientId')
  @ApiOperation({ summary: '환자 사전의향서 조회' })
  async getDirectives(@Param('patientId', ParseUUIDPipe) patientId: string, @Query('includeRevoked') includeRevoked?: string) {
    return { data: await this.service.getDirectives(patientId, includeRevoked === '1' || includeRevoked === 'true') };
  }

  @Patch('directives/:id/revoke')
  @ApiOperation({ summary: '사전의향서 철회(사유 필수 · 기록자 = 로그인한 사람)' })
  async revokeDirective(@Param('id', ParseUUIDPipe) id: string, @Body() body: RevokeAdvanceDirectiveDto, @CurrentUser() user: { id: string }) {
    return { data: await this.service.revokeDirective(id, body.reason, user.id) };
  }

  // ── 돌봄 회의 ──
  @Post('conferences')
  @ApiOperation({ summary: '돌봄 회의 기록' })
  async createConference(@Body() body: CreateHospiceConferenceDto, @CurrentUser('id') userId: string) {
    return { data: await this.service.createConference({ ...body, facilitatorId: userId }) };
  }

  @Get('conferences/:registrationId')
  @ApiOperation({ summary: '돌봄 회의 이력' })
  async getConferences(@Param('registrationId', ParseUUIDPipe) registrationId: string) {
    return { data: await this.service.getConferences(registrationId) };
  }
}
