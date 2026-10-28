import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { SurgerySafetyService } from './surgery-safety.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';

/**
 * 수술 안전(IPSG.4) 미이행 워크리스트 — 상시 목록이 정본, 알림은 하루 1회 요약뿐.
 * 🔴 수술실 간호사가 못 보면 목록이 줄지 않는다 — NURSE 를 포함한다(환자 지목 조회라 감사 대상).
 */
@ApiTags('Quality Improvement')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/v1/qi/surgery-safety')
export class SurgerySafetyController {
  constructor(private readonly service: SurgerySafetyService) {}

  @Get('summary')
  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE)
  @ApiOperation({ summary: 'IPSG.4 수술 안전 요약 — 체크리스트 이행률·부위/좌우 확인 갭(분모 포함)' })
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  async getSummary(@Query('from') from?: string, @Query('to') to?: string) {
    return { data: await this.service.getSummary(from, to) };
  }

  @Get('worklist')
  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE)
  @ApiOperation({ summary: 'IPSG.4 미이행 워크리스트 — 체크리스트 미완료·좌우 미지정·계수 미해소' })
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  @ApiQuery({ name: 'kind', required: false, enum: ['ALL', 'CHECKLIST', 'SITE', 'COUNT'] })
  async getWorklist(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('kind') kind?: string,
  ) {
    return { data: await this.service.getWorklist({ from, to, kind }) };
  }
}
