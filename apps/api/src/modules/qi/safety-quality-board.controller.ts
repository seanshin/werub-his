import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { SafetyQualityBoardService } from './safety-quality-board.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';

@ApiTags('감염·질·안전 보드')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.NURSE, UserRole.DOCTOR)
@Controller('api/v1/safety-quality-board')
export class SafetyQualityBoardController {
  constructor(private readonly svc: SafetyQualityBoardService) {}

  @Get()
  @ApiOperation({ summary: '감염·질·안전 보드 — 안전사건·활성 감염·손위생 준수율·QI 지표 달성' })
  async board() {
    return { data: await this.svc.getBoard() };
  }
}
