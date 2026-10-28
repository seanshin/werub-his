import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { PharmacyBoardService } from './pharmacy-board.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';

@ApiTags('약국 보드')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.PHARMACIST)
@Controller('api/v1/pharmacy-board')
export class PharmacyBoardController {
  constructor(private readonly svc: PharmacyBoardService) {}

  @Get()
  @ApiOperation({ summary: '약국 보드 — 조제 대기·검수 대기·금일 조제·재고 부족' })
  async board() {
    return { data: await this.svc.getBoard() };
  }
}
