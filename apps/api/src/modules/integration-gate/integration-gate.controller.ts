import { Controller, Get, Post, Patch, Param, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { IntegrationGateService } from './integration-gate.service';
import { ConfirmGateDto } from './dto/confirm-gate.dto';

// /api/v1/admin 프리픽스 — AuditInterceptor(AdminConfig) 자동 커버
@ApiTags('연동 개통 게이트')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@Controller('api/v1/admin/integration-gates')
export class IntegrationGateController {
  constructor(private readonly svc: IntegrationGateService) {}

  @Get(':track')
  @ApiOperation({ summary: '트랙 게이트 현황 (자동 시드·개통 상태 동봉)' })
  async getTrack(@Param('track') track: string) {
    return { data: await this.svc.getTrack(track.toUpperCase()) };
  }

  @Get(':track/events')
  @ApiOperation({ summary: '트랙 이력 — 확인/회수/개통/중지 이벤트 (최근순)' })
  async getEvents(@Param('track') track: string) {
    return { data: await this.svc.getEvents(track.toUpperCase()) };
  }

  @Patch(':track/gates/:key/confirm')
  @ApiOperation({ summary: '결재 완료 기록 (구조화 근거 — 유형·문서번호 필수, 결재일·결재자·링크 권장)' })
  async confirm(
    @Param('track') track: string,
    @Param('key') key: string,
    @Body() dto: ConfirmGateDto,
    @CurrentUser('id') userId: string,
  ) {
    return { data: await this.svc.confirm(track.toUpperCase(), key.toUpperCase(), userId, dto) };
  }

  @Patch(':track/gates/:key/revoke')
  @ApiOperation({ summary: '확인 회수 (개통 중에는 불가 — 먼저 개통 중지)' })
  async revoke(
    @Param('track') track: string,
    @Param('key') key: string,
    @Body('note') note: string | undefined,
    @CurrentUser('id') userId: string,
  ) {
    return { data: await this.svc.revoke(track.toUpperCase(), key.toUpperCase(), userId, note) };
  }

  @Post(':track/activate')
  @ApiOperation({ summary: '개통 — 전 게이트 CONFIRMED일 때만 config ON' })
  async activate(@Param('track') track: string, @CurrentUser('id') userId: string) {
    return { data: await this.svc.activate(track.toUpperCase(), userId) };
  }

  @Post(':track/deactivate')
  @ApiOperation({ summary: '개통 중지 (게이트 기록 보존)' })
  async deactivate(@Param('track') track: string, @CurrentUser('id') userId: string) {
    return { data: await this.svc.deactivate(track.toUpperCase(), userId) };
  }
}
