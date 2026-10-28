import {
  Controller, Get, Post, Put, Patch, Delete, Param, Body, Query,
  UseGuards, ParseUUIDPipe,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { EncounterService } from './encounter.service';
import { DraftChartReminderCron } from './draft-chart-reminder.cron';
import { CreateEncounterDto } from './dto/create-encounter.dto';
import { UpdateEncounterDto } from './dto/update-encounter.dto';
import { AttachEncounterDto } from './dto/attach-encounter.dto';
import { PurgeEmptyDraftsDto } from './dto/purge-empty-drafts.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { GatedStepUpGuard } from '../auth/step-up/gated-step-up.guard';
import { RequireStepUp } from '../auth/step-up/require-step-up.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('Encounters')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/v1/encounters')
export class EncounterController {
  constructor(
    private readonly encounterService: EncounterService,
    private readonly draftReminder: DraftChartReminderCron,
  ) {}

  // 데이터 위생 — 버려진 빈 임시저장 정리(ADMIN 전용·기본 dryRun·자식 전무·24h 경과). 실삭제는 confirm=true.
  @Post('purge-empty-drafts')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '빈 임시저장 진료기록 정리(기본 dry-run, confirm=true 시 삭제)' })
  async purgeEmptyDrafts(@Body() body: PurgeEmptyDraftsDto) {
    const dryRun = body?.confirm === true ? false : true;
    return { data: await this.encounterService.purgeEmptyDrafts({ dryRun, cutoffHours: body?.cutoffHours }) };
  }

  @Post('draft-reminders/run')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '미서명 차트 회수 알림 즉시 실행 — config encounter.draftReminder.afterHours 기준(0=OFF·매일 08시 자동)' })
  async runDraftReminders() {
    return { data: await this.draftReminder.remindDraftCharts() };
  }

  @Get()
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: '진료기록 목록' })
  async findAll(
    @CurrentUser('id') userId: string,
    @Query('patientId') patientId?: string,
    @Query('doctorId') doctorId?: string,
    @Query('status') status?: string,
    @Query('mine') mine?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    // 🔴 `mine=true` 는 **호출자 본인으로 고정**한다(넘어온 doctorId 를 덮는다) —
    //    "내 것"을 남의 것으로 바꿔 볼 수 있는 통로를 만들지 않는다.
    return this.encounterService.findAll({
      patientId,
      doctorId: mine === 'true' ? userId : doctorId,
      status,
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Post()
  @Roles(UserRole.DOCTOR, UserRole.ADMIN)
  @ApiOperation({ summary: '진료 시작 (SOAP 생성)' })
  async create(
    @Body() dto: CreateEncounterDto,
    @CurrentUser('id') doctorId: string,
  ) {
    const encounter = await this.encounterService.create(dto, doctorId);
    return { data: encounter };
  }

  @Get(':id')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN, UserRole.PHARMACIST)
  @ApiOperation({ summary: '진료기록 상세 (처방, 진단 포함)' })
  async findOne(@Param('id', ParseUUIDPipe) id: string) {
    const encounter = await this.encounterService.findDetail(id);
    return { data: encounter };
  }

  @Put(':id')
  @Roles(UserRole.DOCTOR, UserRole.ADMIN)
  @ApiOperation({ summary: 'SOAP 노트 수정' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateEncounterDto,
    @CurrentUser('id') userId: string,
  ) {
    const encounter = await this.encounterService.update(id, dto, userId);
    return { data: encounter };
  }

  @Patch(':id/sign')
  @Roles(UserRole.DOCTOR, UserRole.ADMIN)
  @UseGuards(GatedStepUpGuard) // method-level — JwtAuthGuard(클래스) 이후 실행, req.user 보장
  @RequireStepUp('ENCOUNTER_SIGN') // config terminal.stepUpActions+Pilot 등록 시에만 강제(기본 OFF·무중단)
  @ApiOperation({ summary: '진료 서명 (DRAFT → SIGNED) — 스마트폰 생체승인 step-up 게이트(opt-in)' })
  async sign(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') userId: string,
    @Body() body?: {
      blockchainSignature?: {
        certificateId: string;
        signatureValue: string;
        signatureAlgorithm: string;
        documentHash: string;
      };
    },
  ) {
    const encounter = await this.encounterService.sign(
      id,
      userId,
      body?.blockchainSignature,
    );
    return { data: encounter };
  }

  // ── 진료 첨부(타블렛 펜 스케치·도해) ──
  @Post(':id/attachments')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: '진료 첨부 추가 (펜 스케치 등 base64 dataURL)' })
  async addAttachment(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AttachEncounterDto,
    @CurrentUser('id') userId: string,
  ) {
    return { data: await this.encounterService.addAttachment(id, dto, userId) };
  }

  @Get(':id/attachments')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN, UserRole.PHARMACIST)
  @ApiOperation({ summary: '진료 첨부 목록' })
  async listAttachments(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.encounterService.listAttachments(id) };
  }

  @Delete(':id/attachments/:attId')
  @Roles(UserRole.DOCTOR, UserRole.ADMIN)
  @ApiOperation({ summary: '진료 첨부 삭제' })
  async removeAttachment(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('attId', ParseUUIDPipe) attId: string,
  ) {
    return { data: await this.encounterService.removeAttachment(id, attId) };
  }
}

// 환자별 진료 이력 (PatientModule에서 접근하지만 여기서 라우팅)
@ApiTags('Encounters')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/v1/patients')
export class PatientEncounterController {
  constructor(private readonly encounterService: EncounterService) {}

  @Get(':patientId/encounters')
  @Roles(UserRole.DOCTOR, UserRole.NURSE)
  @ApiOperation({ summary: '환자별 진료 이력' })
  async getPatientEncounters(@Param('patientId', ParseUUIDPipe) patientId: string) {
    const encounters = await this.encounterService.findByPatient(patientId);
    return { data: encounters };
  }
}
