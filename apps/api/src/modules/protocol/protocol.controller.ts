import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { ProtocolService } from './protocol.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UpdateDraftDto, SimulateDto, SimulateInstanceDto } from './dto/protocol-editor.dto';

type EditStep = Parameters<ProtocolService['simulate']>[0][number];

@ApiTags('Protocol (환자여정 프로토콜)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/v1/protocols')
export class ProtocolController {
  constructor(private readonly svc: ProtocolService) {}

  @Get('active')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: '활성 프로토콜 목록(전 도메인, 보드 진입)' })
  async active() {
    return { data: await this.svc.getActive() };
  }

  @Get('templates')
  @Roles(UserRole.ADMIN, UserRole.DOCTOR)
  @ApiOperation({ summary: 'P2 관리: 프로토콜 템플릿 + 발행 검증' })
  async templates() {
    return { data: await this.svc.getTemplates() };
  }

  @Get('monitor')
  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE)
  @ApiOperation({ summary: 'P2 관리: 인스턴스 모니터(진행·게이트차단·경과)' })
  async monitor() {
    return { data: await this.svc.getMonitor() };
  }

  // ── P2b 편집기 ──
  @Get('predicates')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'P2b 편집기: 게이트 술어·역할·액션·차트뷰 카탈로그' })
  predicates() {
    return { data: this.svc.getPredicateCatalog() };
  }

  @Get('history')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'P2b 편집기: 버전 히스토리(RETIRED 포함)' })
  async history(@Query('code') code: string) {
    return { data: await this.svc.getHistory(code) };
  }

  @Post('templates/:id/clone')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'P2b 편집기: 템플릿을 새 DRAFT 버전으로 클론(롤백 포함)' })
  async clone(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.svc.cloneToDraft(id) };
  }

  @Put('drafts/:id')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'P2b 편집기: DRAFT 단계/본문 저장' })
  async updateDraft(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateDraftDto) {
    return { data: await this.svc.updateDraft(id, { name: dto.name, description: dto.description, steps: dto.steps as EditStep[] }) };
  }

  @Post('drafts/:id/publish')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'P2b 편집기: DRAFT 발행(검증 통과 시 ACTIVE 전환)' })
  async publishDraft(@Param('id', ParseUUIDPipe) id: string, @CurrentUser('id') userId: string) {
    return { data: await this.svc.publishDraft(id, userId) };
  }

  @Delete('drafts/:id')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'P2b 편집기: DRAFT 폐기' })
  async discardDraft(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.svc.discardDraft(id) };
  }

  @Post('simulate')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'P2b 편집기: what-if 경로 시뮬레이션(DB 미변경)' })
  simulate(@Body() dto: SimulateDto) {
    return { data: this.svc.simulate(dto.steps as EditStep[], dto.sampleFlags ?? {}) };
  }

  @Post('simulate-instance')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'P2b 편집기: 실데이터 what-if(실제 인스턴스 게이트 평가, DB 미변경)' })
  async simulateInstance(@Body() dto: SimulateInstanceDto) {
    return { data: await this.svc.simulateWithInstance(dto.steps as EditStep[], dto.instanceId) };
  }

  @Get('instance/:id')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN, UserRole.PHARMACIST)
  @ApiOperation({ summary: '프로토콜 인스턴스 현황(단계·게이트)' })
  async getInstance(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.svc.getBoardByInstanceId(id) };
  }

  @Get('instance/:id/next-steps')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: '역할별 다음단계(인스턴스)' })
  async nextByInstance(@Param('id', ParseUUIDPipe) id: string, @CurrentUser('role') role: string) {
    return { data: await this.svc.nextStepsByInstance(id, role) };
  }

  @Post('admission/:admissionId/instance')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: '입원(IPD) 프로토콜 인스턴스 생성/보장' })
  async ensureAdmission(@Param('admissionId', ParseUUIDPipe) admissionId: string) {
    const b = await this.svc.ensureInstanceForAdmission(admissionId);
    return { data: await this.svc.getBoardByInstanceId(b.id) };
  }

  @Get('resolve')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: '환자 → 최신 수술 인스턴스 해석(QR 스캔)' })
  async resolve(@Query('patientId', ParseUUIDPipe) patientId: string) {
    return { data: await this.svc.resolveByPatient(patientId) };
  }

  @Post('surgery/:surgeryId/instance')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: '수술 프로토콜 인스턴스 생성/보장(스캔 진입)' })
  async ensureSurgery(@Param('surgeryId', ParseUUIDPipe) surgeryId: string) {
    await this.svc.ensureInstanceForSurgery(surgeryId);
    return { data: await this.svc.getBySurgery(surgeryId) };
  }

  @Get('surgery/:surgeryId')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN, UserRole.PHARMACIST)
  @ApiOperation({ summary: '수술 프로토콜 현황(단계·게이트)' })
  async getSurgery(@Param('surgeryId', ParseUUIDPipe) surgeryId: string) {
    return { data: await this.svc.getBySurgery(surgeryId) };
  }

  @Get('surgery/:surgeryId/next-steps')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: '역할별 다음단계(due-now/upcoming/blocked)' })
  async nextSteps(@Param('surgeryId', ParseUUIDPipe) surgeryId: string, @CurrentUser('role') role: string) {
    return { data: await this.svc.nextSteps(surgeryId, role) };
  }

  @Post('instances/:id/steps/:stepKey/complete')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: '단계 완료(게이트 검증 후 전이)' })
  async complete(@Param('id', ParseUUIDPipe) id: string, @Param('stepKey') stepKey: string, @CurrentUser('id') userId: string) {
    return { data: await this.svc.completeStep(id, stepKey, userId) };
  }
}
