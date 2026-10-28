import { Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { DevDemoService } from './dev-demo.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';

// 개발용 데모 데이터 날짜 롤포워드 — ADMIN 전용. 운영은 config dev.demoDateRoll=false 로 무동작.
@ApiTags('Dev Demo (개발용 데모 데이터)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/v1/dev/demo')
export class DevDemoController {
  constructor(private readonly svc: DevDemoService) {}

  @Get('status')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '데모 리프레시 미리보기(dry-run) — 날짜 시프트 + 검사/영상/약국 큐 현황·활성여부' })
  async status() {
    const [enabled, preview] = await Promise.all([this.svc.isEnabled(), this.svc.refreshAll(true)]);
    return { data: { enabled, ...preview } };
  }

  @Post('roll-forward')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '데모 리프레시(즉시) — 예약·접수 날짜 오늘로 롤포워드 + 검사/영상/약국 큐 신선화' })
  async rollForward() {
    return { data: await this.svc.refreshAll(false) };
  }
}
