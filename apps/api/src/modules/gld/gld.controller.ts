import { Controller, Get, Post, Patch, Delete, Param, Body, Query, UseGuards, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { GldService } from './gld.service';
import {
  AddCommitteeMemberDto,
  CreateCommitteeDto,
  CreateMeetingDto,
  CreatePolicyDto,
  UpdateCommitteeDto,
  UpdateMeetingDto,
  UpdatePolicyDto,
} from './gld.dto';

// JCI GLD — 거버넌스·리더십·운영: 위원회·회의·정책 관리
@ApiTags('GLD (Governance)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/v1/gld')
export class GldController {
  constructor(private readonly svc: GldService) {}

  @Get('dashboard')
  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE)
  @ApiOperation({ summary: 'GLD 대시보드' })
  async dashboard() { return { data: await this.svc.getDashboard() }; }

  // 위원회
  @Get('committees')
  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE)
  async listCommittees() { return { data: await this.svc.listCommittees() }; }

  @Post('committees')
  @Roles(UserRole.ADMIN)
  async createCommittee(@Body() body: CreateCommitteeDto) {
    return { data: await this.svc.createCommittee(body) };
  }

  @Get('committees/:id')
  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE)
  async getCommittee(@Param('id', ParseUUIDPipe) id: string) { return { data: await this.svc.getCommittee(id) }; }

  @Patch('committees/:id')
  @Roles(UserRole.ADMIN)
  async updateCommittee(@Param('id', ParseUUIDPipe) id: string, @Body() body: UpdateCommitteeDto) { return { data: await this.svc.updateCommittee(id, body) }; }

  @Post('committees/:id/members')
  @Roles(UserRole.ADMIN)
  async addMember(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: AddCommitteeMemberDto,
    @CurrentUser('id') actorId: string,
  ) {
    // 🔴 누가 임명했는가를 남긴다 — 시드 구성(`source=SEED`)과 구분되는 지점이다
    return { data: await this.svc.addMember(id, body.userId, body.role ?? 'MEMBER', actorId) };
  }

  @Delete('members/:memberId')
  @Roles(UserRole.ADMIN)
  async removeMember(@Param('memberId', ParseUUIDPipe) memberId: string) { return { data: await this.svc.removeMember(memberId) }; }

  // 회의
  @Get('meetings')
  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE)
  async listMeetings(@Query('committeeId') committeeId?: string, @Query('status') status?: string) {
    return { data: await this.svc.listMeetings({ committeeId, status }) };
  }

  @Post('meetings')
  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE)
  async createMeeting(@Body() body: CreateMeetingDto, @CurrentUser('id') userId: string) {
    return { data: await this.svc.createMeeting({ ...body, createdBy: userId }) };
  }

  @Patch('meetings/:id')
  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE)
  async updateMeeting(@Param('id', ParseUUIDPipe) id: string, @Body() body: UpdateMeetingDto) { return { data: await this.svc.updateMeeting(id, body) }; }

  @Post('meetings/:id/seal-minutes')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '의사록 sign 봉인(D5) — 완료 회의의 의사록 해시를 his-governance 체인에 append·이후 불변' })
  async sealMinutes(@Param('id', ParseUUIDPipe) id: string, @CurrentUser('id') userId: string, @CurrentUser('role') role: string) {
    return { data: await this.svc.sealMeetingMinutes(id, userId, role) };
  }

  // 정책
  @Get('policies')
  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE)
  async listPolicies(@Query('category') category?: string, @Query('status') status?: string) {
    return { data: await this.svc.listPolicies({ category, status }) };
  }

  @Post('policies')
  @Roles(UserRole.ADMIN)
  async createPolicy(@Body() body: CreatePolicyDto) {
    return { data: await this.svc.createPolicy(body) };
  }

  @Patch('policies/:id')
  @Roles(UserRole.ADMIN)
  async updatePolicy(@Param('id', ParseUUIDPipe) id: string, @Body() body: UpdatePolicyDto) { return { data: await this.svc.updatePolicy(id, body) }; }

  @Post('policies/:id/approve')
  @Roles(UserRole.ADMIN)
  async approvePolicy(@Param('id', ParseUUIDPipe) id: string, @CurrentUser('id') userId: string) {
    return { data: await this.svc.approvePolicy(id, userId) };
  }
}
