import { Controller, Post, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { ScheduleReminderCronService } from './schedule-reminder.cron';

// /api/v1/admin 프리픽스 — AuditInterceptor 자동 커버
@ApiTags('치료일정 관리')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@Controller('api/v1/admin/treatment-schedule')
export class AdminScheduleController {
  constructor(private readonly reminderCron: ScheduleReminderCronService) {}

  @Post('reminder-run')
  @ApiOperation({ summary: 'D-1 리마인더 수동 트리거 (config 게이트 준수 — 크론과 동일 경로)' })
  async runReminder() {
    return { data: await this.reminderCron.sendReminders() };
  }
}
