import { Controller, Delete, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { DrugExplainService } from './drug-explain.service';

/**
 * F-7 약 설명 약사 승인 콘솔(2026-07-07 사용자 결정 — "약사가 판단한다"는 전제).
 * 생성 설명은 원내 약사 승인분만 환자 노출. 재생성(e약은요 개정) 시 승인 리셋 → 재검수.
 * 반려 = 삭제(다음 요청 시 재생성 → 재검수 큐).
 */
@ApiTags('drug-explain-admin')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.PHARMACIST, UserRole.ADMIN)
@Controller('api/v1/admin/drug-explain')
export class DrugExplainAdminController {
  constructor(private readonly drugExplain: DrugExplainService) {}

  @Get()
  @ApiOperation({ summary: '생성 설명 목록 (status=pending|approved|all)' })
  async list(@Query('status') status?: 'pending' | 'approved' | 'all') {
    return { data: await this.drugExplain.adminList(status ?? 'all') };
  }

  @Get(':medicationCodeId')
  @ApiOperation({ summary: '검수 상세 — 생성 내용 + e약은요 원문 대조' })
  async detail(@Param('medicationCodeId', ParseUUIDPipe) id: string) {
    return { data: await this.drugExplain.adminDetail(id) };
  }

  @Post(':medicationCodeId/approve')
  @ApiOperation({ summary: '승인 — 환자 노출 허용' })
  async approve(@Param('medicationCodeId', ParseUUIDPipe) id: string, @CurrentUser('id') userId: string) {
    return { data: await this.drugExplain.adminApprove(id, userId) };
  }

  @Delete(':medicationCodeId')
  @ApiOperation({ summary: '반려 — 삭제(재생성 시 재검수)' })
  async reject(@Param('medicationCodeId', ParseUUIDPipe) id: string) {
    return { data: await this.drugExplain.adminReject(id) };
  }
}
