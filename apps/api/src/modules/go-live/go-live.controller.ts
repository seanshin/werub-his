import { Controller, Get, Post, Patch, Body, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { IsOptional, IsString, IsIn, MaxLength } from 'class-validator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { GoLiveService } from './go-live.service';

class UpdateItemDto {
  @IsOptional() @IsIn(['NOT_READY', 'IN_PROGRESS', 'READY', 'DONE', 'BLOCKED']) status?: string;
  @IsOptional() @IsString() @MaxLength(2000) blocker?: string;
  @IsOptional() @IsString() @MaxLength(60) owner?: string;
  @IsOptional() @IsString() targetDate?: string;
}
class ApproveDto {
  @IsIn(['APPROVE', 'REVOKE']) action!: string;
  @IsString() @MaxLength(2000) reason!: string;
}

@ApiTags('Admin Go-Live')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/v1/admin/go-live')
export class GoLiveController {
  constructor(private readonly svc: GoLiveService) {}

  @Get()
  @Roles(UserRole.ADMIN, UserRole.EXECUTIVE) // EXECUTIVE=읽기전용 롤업
  @ApiOperation({ summary: '운영 전환 관제 롤업(준비도·영역·크리티컬 패스)' })
  async rollup() {
    return { data: await this.svc.rollup() };
  }

  @Get('trend')
  @Roles(UserRole.ADMIN, UserRole.EXECUTIVE)
  @ApiOperation({ summary: '준비도 추이(최근 N일 스냅샷)' })
  async trend() {
    return { data: await this.svc.trend(30) };
  }

  @Patch('items/:key')
  @Roles(UserRole.ADMIN) // 편집은 ADMIN 전용
  @ApiOperation({ summary: '수동 항목 상태/blocker/소유/목표일 갱신' })
  async update(@Param('key') key: string, @Body() dto: UpdateItemDto, @CurrentUser('id') userId: string) {
    return { data: await this.svc.updateItem(key, dto, userId) };
  }

  @Post('items/:key/approve')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '항목 승인/철회 기록(거버넌스·감사)' })
  async approve(@Param('key') key: string, @Body() dto: ApproveDto, @CurrentUser() user: { id: string; name?: string; familyName?: string; givenName?: string }) {
    const name = user.name || `${user.familyName ?? ''}${user.givenName ?? ''}` || '관리자';
    return { data: await this.svc.approve(key, dto.action as 'APPROVE' | 'REVOKE', user.id, name, dto.reason) };
  }

  @Get('items/:key/approvals')
  @Roles(UserRole.ADMIN, UserRole.EXECUTIVE)
  @ApiOperation({ summary: '항목 승인 이력' })
  async approvals(@Param('key') key: string) {
    return { data: await this.svc.getApprovals(key) };
  }
}
