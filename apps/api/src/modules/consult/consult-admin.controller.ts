import { Controller, Get, Post, Patch, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { IsString, IsOptional, IsArray, IsBoolean, IsInt, IsIn, MaxLength, Min, Max } from 'class-validator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ConsultAgentGuard } from './consult-agent.guard';
import { ConsultRole, ConsultSelfProbe } from './consult-role.decorator';
import { ConsultTeamService } from './consult-team.service';
import { ConsultAgentService } from './consult-agent.service';

class TeamDto {
  @IsOptional() @IsString() @MaxLength(40) name?: string;
  @IsOptional() @IsString() @MaxLength(200) description?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) categories?: string[];
  @IsOptional() @IsArray() @IsString({ each: true }) locales?: string[];
  @IsOptional() @IsIn(['AUTO', 'SUGGEST', 'OFF']) defaultAiMode?: string;
  @IsOptional() @IsBoolean() isDefault?: boolean;
  @IsOptional() @IsBoolean() active?: boolean;
}
class MemberDto {
  @IsString() userId!: string;
  @IsIn(['AGENT', 'LEAD', 'ADMIN']) role!: string;
  @IsOptional() @IsInt() @Min(1) @Max(50) maxConcurrent?: number;
}
class StatusDto { @IsIn(['ONLINE', 'AWAY', 'BUSY', 'OFFLINE']) status!: string; }

// 팀 세팅(ADMIN) + 상담원 본인 프로필/상태
@ApiTags('Consult Admin')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, ConsultAgentGuard)
@Controller('api/v1/consult')
export class ConsultAdminController {
  constructor(private readonly teams: ConsultTeamService, private readonly agents: ConsultAgentService) {}

  // ── 내 프로필/상태 (AGENT 이상) ──
  @Get('agents/me')
  @ConsultSelfProbe()
  @ApiOperation({ summary: '내 상담 프로필·상태·소속팀(미등록이면 enrolled:false)' })
  async me(@CurrentUser() user: { id: string; role: string }) {
    return { data: await this.agents.getMe(user.id, user.role === 'ADMIN') };
  }

  @Patch('agents/me/status')
  @ApiOperation({ summary: '내 상태 변경' })
  async setStatus(@CurrentUser('id') userId: string, @Body() dto: StatusDto) {
    return { data: await this.agents.setStatus(userId, dto.status) };
  }

  // ── 팀 세팅 (ADMIN) ──
  @Get('teams')
  @ConsultRole('ADMIN')
  @ApiOperation({ summary: '팀 목록' })
  async listTeams() {
    return { data: await this.teams.listTeams() };
  }

  @Post('teams')
  @ConsultRole('ADMIN')
  @ApiOperation({ summary: '팀 생성' })
  async createTeam(@Body() dto: TeamDto) {
    return { data: await this.teams.createTeam(dto) };
  }

  @Patch('teams/:id')
  @ConsultRole('ADMIN')
  @ApiOperation({ summary: '팀 수정' })
  async updateTeam(@Param('id') id: string, @Body() dto: TeamDto) {
    return { data: await this.teams.updateTeam(id, dto) };
  }

  @Delete('teams/:id')
  @ConsultRole('ADMIN')
  @ApiOperation({ summary: '팀 비활성화' })
  async deleteTeam(@Param('id') id: string) {
    return { data: await this.teams.deleteTeam(id) };
  }

  @Get('teams/:id/members')
  @ConsultRole('LEAD')
  @ApiOperation({ summary: '팀 멤버' })
  async members(@Param('id') id: string) {
    return { data: await this.teams.listMembers(id) };
  }

  @Post('teams/:id/members')
  @ConsultRole('ADMIN')
  @ApiOperation({ summary: '멤버 배정/수정' })
  async upsertMember(@Param('id') id: string, @Body() dto: MemberDto) {
    return { data: await this.teams.upsertMember(id, dto.userId, dto.role, dto.maxConcurrent) };
  }

  @Delete('teams/:id/members/:userId')
  @ConsultRole('ADMIN')
  @ApiOperation({ summary: '멤버 해제' })
  async removeMember(@Param('id') id: string, @Param('userId') userId: string) {
    return { data: await this.teams.removeMember(id, userId) };
  }
}
