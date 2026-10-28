import { Controller, Get, Put, Delete, Body, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { IsIn, IsObject, IsString } from 'class-validator';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { DashboardConfigService } from './dashboard-config.service';

class TemplateUpsertDto {
  @IsIn(['ROLE', 'DEPARTMENT']) scope!: string;
  @IsString() scopeRef!: string;
  @IsObject() config!: Record<string, unknown>;
}

// 관리자 — 역할/부서별 기본 대시보드 템플릿 관리
@ApiTags('Dashboard Template')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@Controller('api/v1/dashboard/templates')
export class DashboardTemplateController {
  constructor(private readonly svc: DashboardConfigService) {}

  @Get()
  @ApiOperation({ summary: '대시보드 템플릿 목록' })
  async list() {
    return { data: await this.svc.listTemplates() };
  }

  @Put()
  @ApiOperation({ summary: '대시보드 템플릿 저장(역할/부서)' })
  async upsert(@CurrentUser() user: { id: string }, @Body() dto: TemplateUpsertDto) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { data: await this.svc.upsertTemplate(dto.scope, dto.scopeRef, dto.config as any, user.id) };
  }

  @Delete()
  @ApiOperation({ summary: '대시보드 템플릿 삭제' })
  async remove(@Query('scope') scope: string, @Query('scopeRef') scopeRef: string) {
    return { data: await this.svc.deleteTemplate(scope, scopeRef) };
  }
}
