import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { QuestionnaireAdminService } from './questionnaire-admin.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CreateQuestionnaireMappingDto, UpdateQuestionnaireMappingDto, SendQuestionnaireDto } from './dto/questionnaire.dto';

@ApiTags('Questionnaire Admin')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/v1/admin/questionnaire')
export class QuestionnaireAdminController {
  constructor(private readonly service: QuestionnaireAdminService) {}

  // ── 진료과-양식 매핑 ──

  @Get('mappings')
  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE)
  @ApiOperation({ summary: '진료과-양식 매핑 목록' })
  async getMappings(@Query('department') department?: string) {
    return { data: await this.service.getMappings(department) };
  }

  @Post('mappings')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '매핑 생성' })
  async createMapping(@Body() dto: CreateQuestionnaireMappingDto, @CurrentUser('id') userId: string) {
    return { data: await this.service.createMapping({ ...dto, createdBy: userId }) };
  }

  @Put('mappings/:id')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '매핑 수정' })
  async updateMapping(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateQuestionnaireMappingDto) {
    return { data: await this.service.updateMapping(id, dto) };
  }

  @Delete('mappings/:id')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '매핑 삭제' })
  async deleteMapping(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.service.deleteMapping(id) };
  }

  // ── 통계/현황 ──

  @Get('stats')
  @Roles(UserRole.ADMIN, UserRole.NURSE)
  @ApiOperation({ summary: '문진표 통계' })
  async getStats() {
    return { data: await this.service.getStats() };
  }

  @Get('pending')
  @Roles(UserRole.ADMIN, UserRole.NURSE)
  @ApiOperation({ summary: '미작성 목록' })
  async getPending(@Query('date') date?: string, @Query('limit') limit?: string) {
    return { data: await this.service.getPending({ date: date as any, limit: limit ? parseInt(limit) : undefined }) };
  }

  // ── 발송 ──

  @Post('send')
  @Roles(UserRole.ADMIN, UserRole.NURSE)
  @ApiOperation({ summary: '수동 발송' })
  async send(@Body() dto: SendQuestionnaireDto, @CurrentUser('id') userId: string) {
    return { data: await this.service.sendToPatient({ ...dto, createdBy: userId }) };
  }

  @Post('resend/:id')
  @Roles(UserRole.ADMIN, UserRole.NURSE)
  @ApiOperation({ summary: '재발송 (만료 연장)' })
  async resend(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.service.resend(id) };
  }

  // ── 검토 ──

  @Put('review/:id')
  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE)
  @ApiOperation({ summary: '문진표 검토 완료' })
  async markReviewed(@Param('id', ParseUUIDPipe) id: string, @CurrentUser('id') userId: string) {
    return { data: await this.service.markReviewed(id, userId) };
  }

  @Post('reminders')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '미작성 리마인더 일괄 발송' })
  async sendReminders() {
    return { data: await this.service.sendReminders() };
  }
}
