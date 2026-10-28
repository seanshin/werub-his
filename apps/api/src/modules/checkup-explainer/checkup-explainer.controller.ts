import { Controller, Get, Post, Put, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { CheckupExplainerService } from './checkup-explainer.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UpsertExplainerDto, ReviewExplainerDto } from './dto/checkup-explainer.dto';

interface ReqUser { id: string; familyName?: string; givenName?: string }

/**
 * 검진결과 해석 감수 콘텐츠 — **직원 저작/감수 전용**(소비자 노출 아님).
 * 규제 게이트(웰니스 확정·감수 체계) 후 별도 소비자 EP에서 APPROVED 콘텐츠 연결.
 */
@ApiTags('Checkup Explainer (검진해석 감수 콘텐츠)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/v1/checkup-explainer')
export class CheckupExplainerController {
  constructor(private readonly svc: CheckupExplainerService) {}

  @Get()
  @Roles(UserRole.DOCTOR, UserRole.ADMIN)
  @ApiOperation({ summary: '해석 콘텐츠 목록(상태 필터)' })
  async findAll(@Query('status') status?: string) {
    return { data: await this.svc.findAll(status) };
  }

  @Get(':testCode')
  @Roles(UserRole.DOCTOR, UserRole.ADMIN)
  @ApiOperation({ summary: '검사코드별 해석 콘텐츠' })
  async findByCode(@Param('testCode') testCode: string) {
    return { data: await this.svc.findByCode(testCode) };
  }

  @Post()
  @Roles(UserRole.DOCTOR, UserRole.ADMIN)
  @ApiOperation({ summary: '해석 콘텐츠 저작/수정(가드레일 검증)' })
  async upsert(@Body() dto: UpsertExplainerDto, @CurrentUser() user: ReqUser) {
    return { data: await this.svc.upsert(dto, user) };
  }

  @Post(':id/submit')
  @Roles(UserRole.DOCTOR, UserRole.ADMIN)
  @ApiOperation({ summary: '감수 제출(DRAFT→IN_REVIEW)' })
  async submit(@Param('id') id: string) {
    return { data: await this.svc.submit(id) };
  }

  @Post(':id/review')
  @Roles(UserRole.DOCTOR, UserRole.ADMIN)
  @ApiOperation({ summary: '감수 결정(승인/반려)' })
  async review(@Param('id') id: string, @Body() dto: ReviewExplainerDto, @CurrentUser() user: ReqUser) {
    return { data: await this.svc.review(id, dto, user) };
  }
}
