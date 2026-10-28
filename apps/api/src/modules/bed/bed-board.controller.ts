import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { BedBoardService } from './bed-board.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';

@ApiTags('병상·입원 보드')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.NURSE, UserRole.DOCTOR)
@Controller('api/v1/bed-board')
export class BedBoardController {
  constructor(private readonly svc: BedBoardService) {}

  @Get()
  @ApiOperation({ summary: '병상·입원 보드 — 병동별 가동률·금일 입퇴원·재원일수·장기재원' })
  async board() {
    return { data: await this.svc.getBoard() };
  }
}
