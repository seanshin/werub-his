import { Controller, Get, Param, Query, UseGuards, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { BillingAdvancedService } from './billing-advanced.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';

@ApiTags('Billing Advanced (수가 정밀)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.NURSE, UserRole.ADMIN)
@Controller('api/v1/billing-advanced')
export class BillingAdvancedController {
  constructor(private readonly service: BillingAdvancedService) {}

  @Get('ffs/:encounterId')
  @ApiOperation({ summary: '행위별 수가 계산 (FFS)' })
  async calculateFFS(@Param('encounterId', ParseUUIDPipe) id: string) { return { data: await this.service.calculateFFS(id) }; }

  @Get('drg/:encounterId')
  @ApiOperation({ summary: 'DRG 포괄수가 계산' })
  async calculateDRG(@Param('encounterId', ParseUUIDPipe) id: string, @Query('drgCode') drgCode: string) { return { data: await this.service.calculateDRG(id, drgCode) }; }
}
