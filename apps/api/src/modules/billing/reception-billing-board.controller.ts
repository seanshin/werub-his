import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { ReceptionBillingBoardService } from './reception-billing-board.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';

@ApiTags('원무·수납 보드')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.NURSE, UserRole.DOCTOR, UserRole.RECEPTIONIST)
@Controller('api/v1/reception-billing')
export class ReceptionBillingBoardController {
  constructor(private readonly svc: ReceptionBillingBoardService) {}

  @Get('board')
  @ApiOperation({ summary: '원무·수납 보드 — 접수 대기·자격 미확인·금일 수납·미수금·증명서 대기' })
  async board() {
    return { data: await this.svc.getBoard() };
  }
}
