import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { DiagnosticsBoardService } from './diagnostics-board.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';

@ApiTags('진단검사 보드')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.LAB_TECH, UserRole.DOCTOR, UserRole.NURSE)
@Controller('api/v1/diagnostics')
export class DiagnosticsBoardController {
  constructor(private readonly svc: DiagnosticsBoardService) {}

  @Get('board')
  @ApiOperation({ summary: '검사·영상 위험값 보드 — 위험값 미보고·검사 대기·영상 판독대기' })
  async board() {
    return { data: await this.svc.getBoard() };
  }
}
