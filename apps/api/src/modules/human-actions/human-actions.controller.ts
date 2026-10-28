import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { HumanActionsService } from './human-actions.service';

@ApiTags('Human Actions')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/v1/admin/human-actions')
export class HumanActionsController {
  constructor(private readonly svc: HumanActionsService) {}

  /** 사람 몫 할 일 — 항목·확인 항목 상태(정본에서 파생 · 코드와 값만 · 라벨은 shared human-actions) */
  @Get()
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '사람 몫 할 일 H1~H10 — 결정 기록·설정·원장에서 파생한 상태(체크박스 원장 없음 · 확인 항목별 실패는 UNKNOWN)' })
  async list() {
    return { data: await this.svc.list() };
  }
}
