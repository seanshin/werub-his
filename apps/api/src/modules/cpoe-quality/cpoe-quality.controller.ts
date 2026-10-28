import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { Permission } from '../auth/rbac/permission.types';
import { CpoeQualityService } from './cpoe-quality.service';
import { CpoeImprovementService } from './cpoe-improvement.service';
import { CpoeAgendaService } from './cpoe-agenda.service';
import {
  CpoeQiAgendaDto, CpoeQualityQueryDto, CpoeSpcQueryDto, CreateImprovementDto, ImprovementCheckDto, ImprovementListQueryDto, ImprovementNoteDto,
  RecordCpoeMeasurementDto, TransitImprovementDto,
} from './cpoe-quality.dto';

@ApiTags('Orders (오더)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/v1/orders/quality')
export class CpoeQualityController {
  constructor(
    private readonly service: CpoeQualityService,
    private readonly improvements: CpoeImprovementService,
    private readonly agendas: CpoeAgendaService,
  ) {}

  private uid(user: { id?: string; sub?: string }) { return (user.id ?? user.sub)!; }

  @Get()
  // 관리자 = 병원 전체·처방의별 · 의사 = 본인 처방만(서버가 강제)
  @Roles(UserRole.ADMIN, UserRole.DOCTOR)
  @ApiOperation({ summary: 'CPOE 질 지표 — 처방·오더 원장의 분자·분모·문제 건·주별 추이·소요 시간·질 지표 원장 연결' })
  async get(@Query() q: CpoeQualityQueryDto, @CurrentUser() user: { id?: string; sub?: string; role: string }) {
    return { data: await this.service.getQuality(q, { id: (user.id ?? user.sub)!, role: user.role }) };
  }

  @Get('spc')
  @Roles(UserRole.ADMIN, UserRole.DOCTOR)
  @ApiOperation({ summary: 'CPOE 지표 월별 p 관리도 — 중심선·관리 한계·신호(한계 밖·한쪽 8점 연속) · 진행 중인 달은 중심선에서 제외' })
  async spc(@Query() q: CpoeSpcQueryDto, @CurrentUser() user: { id?: string; sub?: string; role: string }) {
    return { data: await this.service.getSpc(q, { id: (user.id ?? user.sub)!, role: user.role }) };
  }

  @Get('alerts')
  @Roles(UserRole.ADMIN, UserRole.DOCTOR)
  @ApiOperation({ summary: '경고 부담 — DUR 경고 유형별(경고 난 처방·경고 수·무시·사유 없는 무시)·잦은 약·CDSS 수준별 · 의사는 본인 처방만' })
  async alerts(@Query() q: CpoeQualityQueryDto, @CurrentUser() user: { id?: string; sub?: string; role: string }) {
    return { data: await this.service.getAlertBurden(q, { id: this.uid(user), role: user.role }) };
  }

  // ── 질 개선 활동(PDCA) — 조회는 관리자·의사 · 쓰기는 관리자(질 지표 정의와 같은 층) ──

  @Get('improvements')
  @Roles(UserRole.ADMIN, UserRole.DOCTOR)
  @ApiOperation({ summary: '개선 활동 목록(OPEN·상태·지표) — 기준선·마지막 효과 확인·차이(95% 구간)' })
  async listImprovements(@Query() q: ImprovementListQueryDto) {
    return { data: await this.improvements.list(q) };
  }

  @Get('improvements/:id')
  @Roles(UserRole.ADMIN, UserRole.DOCTOR)
  @ApiOperation({ summary: '개선 활동 상세 — 경과(덧붙이기만)·효과' })
  async getImprovement(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.improvements.get(id) };
  }

  @Post('improvements')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '개선 활동 시작 — 기준선은 서버가 그 기간을 병원 전체로 센다(표본 0 거절)' })
  async createImprovement(@Body() dto: CreateImprovementDto, @CurrentUser() user: { id?: string; sub?: string }) {
    return { data: await this.improvements.create(dto, this.uid(user)) };
  }

  @Post('improvements/:id/transition')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '개선 활동 단계 전이(PDCA) — 정해진 전이만 · 종결·취소는 사유 · CHECK→ACT 는 효과 확인 기록 필요' })
  async transitImprovement(@Param('id', ParseUUIDPipe) id: string, @Body() dto: TransitImprovementDto, @CurrentUser() user: { id?: string; sub?: string }) {
    return { data: await this.improvements.transition(id, dto, this.uid(user)) };
  }

  @Post('improvements/:id/notes')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '개선 활동 메모(덧붙이기)' })
  async noteImprovement(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ImprovementNoteDto, @CurrentUser() user: { id?: string; sub?: string }) {
    return { data: await this.improvements.addNote(id, dto.note, this.uid(user)) };
  }

  @Post('improvements/:id/checks')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '효과 확인 — 기준선 이후 기간을 서버가 다시 센다 · 차이·95% 구간(판정어 없음)' })
  async checkImprovement(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ImprovementCheckDto, @CurrentUser() user: { id?: string; sub?: string }) {
    return { data: await this.improvements.check(id, dto, this.uid(user)) };
  }

  @Post('agenda')
  // 안건 제안은 전 직원(거버넌스 정본) — 이 화면을 보는 관리자·의사
  @Roles(UserRole.ADMIN, UserRole.DOCTOR)
  @ApiOperation({ summary: 'CPOE 지표 원장 등록·목표를 위원회 안건으로 — 후보 1~3 + "정하지 않음" · 의결되면 엔진이 원장에 반영(화면은 바꾸지 않는다)' })
  async proposeAgenda(@Body() dto: CpoeQiAgendaDto, @CurrentUser() user: { id?: string; sub?: string }) {
    return { data: await this.agendas.propose(dto, this.uid(user)) };
  }

  @Post('measurements')
  // 질 지표 측정 입력과 같은 권한 — 값은 서버가 원장에서 다시 센다
  @RequirePermission(Permission.QI_MEASURE_WRITE)
  @ApiOperation({ summary: 'CPOE 지표 한 달 측정을 질 지표 원장에 기록(병원 전체·끝난 달·원장 등재 지표만)' })
  async record(@Body() dto: RecordCpoeMeasurementDto, @CurrentUser() user: { id?: string; sub?: string }) {
    return { data: await this.service.recordMonth(dto.key, dto.period, new Date(), this.uid(user)) };
  }
}
