import {
  Controller, Get, Post, Patch, Param, Body,
  UseGuards, ParseUUIDPipe, Request,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { DepositService } from './deposit.service';
import { CreateDepositDto } from './dto/deposit.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';

@ApiTags('Deposit')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/v1/deposits')
export class DepositController {
  constructor(private readonly depositService: DepositService) {}

  @Post()
  @Roles(UserRole.ADMIN, UserRole.RECEPTIONIST, UserRole.CHECKUP)
  @ApiOperation({ summary: '예치금 등록' })
  async create(@Body() dto: CreateDepositDto, @Request() req: { user: { id?: string; sub?: string } }) {
    const deposit = await this.depositService.create(dto, (req.user.id ?? req.user.sub)!);
    return { data: deposit };
  }

  @Get('patient/:patientId')
  @Roles(UserRole.ADMIN, UserRole.NURSE, UserRole.RECEPTIONIST, UserRole.CHECKUP)
  @ApiOperation({ summary: '환자별 예치금 목록' })
  async findByPatient(@Param('patientId', ParseUUIDPipe) patientId: string) {
    const deposits = await this.depositService.findByPatient(patientId);
    return { data: deposits };
  }

  @Patch(':id/refund')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '예치금 환불' })
  async refund(@Param('id', ParseUUIDPipe) id: string, @Request() req: { user: { id?: string; sub?: string } }) {
    const deposit = await this.depositService.refund(id, (req.user.id ?? req.user.sub)!);
    return { data: deposit };
  }
}
