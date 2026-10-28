import { Controller, Get, Post, Patch, Param, Body, Query, UseGuards, ParseUUIDPipe, ForbiddenException } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { SurgeryService } from './surgery.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CreateSurgeryDto, CompleteSurgeryDto } from './dto/surgery.dto';
import { AuditAiRead } from '../audit/no-audit.decorator';

@ApiTags('Surgery')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.DOCTOR, UserRole.ADMIN)
@Controller('api/v1/surgery')
export class SurgeryController {
  constructor(private readonly surgeryService: SurgeryService) {}

  @Get('schedule')
  @Roles(UserRole.DOCTOR, UserRole.ADMIN, UserRole.READ, UserRole.NURSE)
  @ApiOperation({ summary: '수술 스케줄 — 간호사는 환자 지정 조회만(환자 차트 수술 이력)' })
  async getSchedule(
    @CurrentUser('role') role: string,
    @Query('dateFrom') dateFrom?: string, @Query('dateTo') dateTo?: string, @Query('patientId') patientId?: string,
  ) {
    /**
     * 🔴 (2026-10-02) 환자 차트 '수술 이력' 탭이 간호사에게 403 이었다 — 수술 후 환자를 보는 간호사가 그 환자의 수술 이력을 못 봤다.
     *    수술 일정 화면(/surgery)은 설계상 의사·관리자 몫이라 **병원 전체 일정은 계속 막고**, 환자를 지정한 조회만 연다.
     */
    if (role === UserRole.NURSE && !patientId) throw new ForbiddenException('간호사는 환자를 지정한 수술 이력만 조회할 수 있습니다');
    return { data: await this.surgeryService.getSchedule(dateFrom, dateTo, patientId) };
  }

  @Post()
  @Roles(UserRole.DOCTOR, UserRole.ADMIN)
  @ApiOperation({ summary: '수술 예약' })
  async schedule(@Body() dto: CreateSurgeryDto) { return { data: await this.surgeryService.schedule(dto) }; }

  @Get(':id')
  @ApiOperation({ summary: '수술 상세 (Op Note)' })
  async findOne(@Param('id', ParseUUIDPipe) id: string) { return { data: await this.surgeryService.findById(id) }; }

  @Patch(':id/start')
  @Roles(UserRole.DOCTOR)
  @ApiOperation({ summary: '수술 시작' })
  async start(@Param('id', ParseUUIDPipe) id: string) { return { data: await this.surgeryService.start(id) }; }

  @Patch(':id/complete')
  @Roles(UserRole.DOCTOR)
  @ApiOperation({ summary: '수술 완료 + Op Note 작성' })
  async complete(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CompleteSurgeryDto) { return { data: await this.surgeryService.complete(id, dto as unknown as Record<string, unknown>) }; }

  @AuditAiRead('AiSurgeryRisk')

  @Get(':id/ai-risk')
  @ApiOperation({ summary: 'AI 수술 합병증 위험도 예측' })
  async predictRiskAI(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.surgeryService.predictRiskAI(id) };
  }

  // 2026-10-05 제거: GET :id/ai-opnote(AI 수술 기록 초안) — 부르는 화면 0 · 수술명·시작/종료 시각만으로 "수술 기록"을 만들게 해
  //   소견·술기를 지어낼 수밖에 없었다. 수술 중 기록에서 센 사실로 쓰는 경과 요약 초안은 POST surgery/:id/intraop/ai-narrative.
}
