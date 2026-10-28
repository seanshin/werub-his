import {
  Controller, Get, Post, Patch, Param, Body,
  UseGuards, ParseUUIDPipe, ParseIntPipe,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { InstallmentService } from './installment.service';
import { CreateInstallmentDto } from './dto/installment.dto';
import { PayInstallmentDto } from '../billing/dto/pay-installment.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';

@ApiTags('Installment')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/v1')
export class InstallmentController {
  constructor(private readonly installmentService: InstallmentService) {}

  @Post('billing/:billingId/installment')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '분할 납부 계획 생성' })
  async createPlan(
    @Param('billingId', ParseUUIDPipe) billingId: string,
    @Body() dto: CreateInstallmentDto,
  ) {
    const plan = await this.installmentService.createPlan(billingId, dto.installments);
    return { data: plan };
  }

  @Patch('installment/:planId/pay/:seqNo')
  @Roles(UserRole.ADMIN, UserRole.NURSE)
  @ApiOperation({ summary: '분할 납부 결제' })
  async payInstallment(
    @Param('planId', ParseUUIDPipe) planId: string,
    @Param('seqNo', ParseIntPipe) seqNo: number,
    @Body() dto: PayInstallmentDto,
  ) {
    const plan = await this.installmentService.payInstallment(planId, seqNo, dto?.method);
    return { data: plan };
  }

  @Get('billing/:billingId/installment')
  @Roles(UserRole.ADMIN, UserRole.NURSE)
  @ApiOperation({ summary: '수납별 분할 납부 계획 목록' })
  async getPlans(@Param('billingId', ParseUUIDPipe) billingId: string) {
    const plans = await this.installmentService.getPlans(billingId);
    return { data: plans };
  }

  @Get('installment/:planId')
  @Roles(UserRole.ADMIN, UserRole.NURSE)
  @ApiOperation({ summary: '분할 납부 계획 상세' })
  async getPlanDetail(@Param('planId', ParseUUIDPipe) planId: string) {
    const plan = await this.installmentService.getPlanDetail(planId);
    return { data: plan };
  }
}
