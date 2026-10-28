import { Controller, Get, Post, Query, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { SatisfactionService } from './satisfaction.service';

@ApiTags('Patient Satisfaction (환자 만족도)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/v1/satisfaction')
export class SatisfactionController {
  constructor(private readonly service: SatisfactionService) {}

  /* ── 설문 템플릿 ── */

  @Get('templates')
  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE)
  @ApiOperation({ summary: '설문 템플릿 목록' })
  async getTemplates() {
    return { data: await this.service.getTemplates() };
  }

  @Post('templates')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '설문 템플릿 생성' })
  async createTemplate(@Body() body: { name: string; description?: string; targetDepartment?: string; questions: { text: string; type: 'likert5' | 'nps' | 'text' }[] }) {
    return { data: await this.service.createTemplate(body) };
  }

  /* ── 설문 배포 / 응답 ── */

  @Post('dispatch')
  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE)
  @ApiOperation({ summary: '설문 발송 (토큰 — 포털/태블릿/SMS)' })
  async dispatch(@Body() body: { templateId: string; patientId?: string; patientName?: string; department?: string; channel?: 'PORTAL' | 'TABLET' | 'SMS' | 'KIOSK'; trigger?: 'MANUAL' | 'DISCHARGE' | 'OUTPATIENT'; deviceId?: string }) {
    return { data: await this.service.dispatchToken(body) };
  }

  @Get('dispatches')
  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE)
  @ApiOperation({ summary: '설문 발송 목록' })
  async listDispatches(@Query('status') status?: string) {
    return { data: await this.service.listDispatches(status) };
  }

  @Post('responses')
  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE)
  @ApiOperation({ summary: '환자 응답 제출' })
  async submitResponse(@Body() body: { templateId: string; patientId: string; department: string; answers: Record<string, number | string> }) {
    return { data: await this.service.submitResponse(body) };
  }

  /* ── 통계 / 분석 ── */

  @Get('stats/department')
  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE)
  @ApiOperation({ summary: '부서별 NPS 및 항목별 점수' })
  async getDepartmentStats(@Query('department') department?: string) {
    return { data: await this.service.getDepartmentStats(department) };
  }

  @Get('stats/trend')
  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE)
  @ApiOperation({ summary: '월별/분기별 만족도 추이' })
  async getTrend(@Query('period') period?: 'monthly' | 'quarterly') {
    return { data: await this.service.getTrend(period) };
  }

  @Get('stats/sentiment')
  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE)
  @ApiOperation({ summary: 'AI 감성 분석' })
  async getSentiment() {
    return { data: await this.service.getSentiment() };
  }

  @Get('benchmark')
  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE)
  @ApiOperation({ summary: '전국 평균 벤치마크 비교' })
  async getBenchmark() {
    return { data: await this.service.getBenchmark() };
  }

  /* ── 개선 과제 ── */

  @Get('actions')
  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE)
  @ApiOperation({ summary: '개선 과제 목록' })
  async getActions() {
    return { data: await this.service.getActions() };
  }

  @Post('actions')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '개선 과제 등록' })
  async createAction(@Body() body: { department: string; title: string; description: string; priority: 'HIGH' | 'MEDIUM' | 'LOW'; assignee?: string }) {
    return { data: await this.service.createAction(body) };
  }
}
