import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsInt, IsOptional, IsString, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { OrderGovernanceService } from './order-governance.service';
import { AttentionAgendaService } from './attention-agenda.service';
import { CommitteeAgendaService, SCREEN_AGENDA_SOURCES } from './committee-agenda.service';

class AttentionCandidateDto {
  @IsOptional() @IsInt() @Min(1) @Max(1440) STAT?: number;
  @IsOptional() @IsInt() @Min(1) @Max(1440) URGENT?: number;
  @IsOptional() @IsInt() @Min(1) @Max(1440) ROUTINE?: number;
}
class AttentionAgendaDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(3) @ValidateNested({ each: true }) @Type(() => AttentionCandidateDto)
  candidates!: AttentionCandidateDto[];

  @IsOptional() @IsString() @MaxLength(2000)
  note?: string;
}

@ApiTags('Orders (오더)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/v1/orders')
export class OrderGovernanceController {
  constructor(
    private readonly service: OrderGovernanceService,
    private readonly attention: AttentionAgendaService,
    private readonly agendas: CommitteeAgendaService,
  ) {}

  @Get('governance-check')
  // 오더 실시간 추적과 같은 역할 — 위원회 기준을 보는 것은 쓰기 권한이 아니다
  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE, UserRole.PHARMACIST, UserRole.LAB_TECH)
  @ApiOperation({ summary: '오더 위원회 기준 점검 — 오더에 걸리는 기준 표면별 담당 위원회·결정(3상태)·현재 값(출처)·점검(분자·분모·해당 오더)' })
  async check(@Query('date') date?: string) {
    return { data: await this.service.getCheck(date) };
  }

  @Post('governance/attention-agenda')
  // 안건 제안은 전 직원(거버넌스 정본과 같다) — 이 화면을 보는 역할 그대로
  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE, UserRole.PHARMACIST, UserRole.LAB_TECH)
  @ApiOperation({ summary: '오더 처리 주의 기준을 담당 위원회 안건으로 — 후보 1~3 + "정하지 않음" · 의결되면 집행 엔진이 설정에 반영(화면은 바꾸지 않는다)' })
  async proposeAttention(@Body() dto: AttentionAgendaDto, @CurrentUser() user: { id?: string; sub?: string }) {
    return { data: await this.attention.propose(dto as never, (user.id ?? user.sub)!) };
  }

  @Get('governance/agendas')
  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE, UserRole.PHARMACIST, UserRole.LAB_TECH)
  @ApiOperation({ summary: '오더·CPOE 화면에서 올린 위원회 안건(대상·상태·의결 번호)' })
  async agendaList() {
    return { data: await this.agendas.list(SCREEN_AGENDA_SOURCES) };
  }
}
