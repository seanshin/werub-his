import { Controller, Get, Post, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { Phase0CutoverService } from './phase0-cutover.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ApproveCutoverDto } from './dto/phase0-cutover.dto';

@ApiTags('Phase0 Cutover (가명화 컷오버 승인)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/v1/admin/phase0-cutover')
export class Phase0CutoverController {
  constructor(private readonly svc: Phase0CutoverService) {}

  @Get('status')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '컷오버 현황 — 체크리스트·기술준비·승인·실행 상태' })
  async status() {
    return { data: await this.svc.status() };
  }

  @Post('approve')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '법무/CPO 승인 기록 — 체크리스트 전항 확인+사유 필수' })
  async approve(@Body() body: ApproveCutoverDto, @CurrentUser() user: { id?: string; sub?: string; name?: string }) {
    return { data: await this.svc.approve((user.id ?? user.sub)!, user.name ?? '관리자', body) };
  }

  @Post('revoke')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '승인 철회(실행 전만)' })
  async revoke(@CurrentUser('id') userId: string) {
    return { data: await this.svc.revoke(userId) };
  }

  @Post('execute')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '🔴 컷오버 실행 — 승인 게이팅 통과 시 가명화 게이트 ON(법무 승인 없이 차단)' })
  async execute(@CurrentUser('id') userId: string) {
    return { data: await this.svc.execute(userId) };
  }

  @Post('rollback')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '롤백 — 가명화 게이트 OFF 복귀' })
  async rollback(@CurrentUser('id') userId: string) {
    return { data: await this.svc.rollback(userId) };
  }
}
