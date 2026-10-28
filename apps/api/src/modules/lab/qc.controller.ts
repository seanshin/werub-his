import { Controller, Get, Post, Body, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { QcService } from './qc.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AddQcRecordDto } from './dto/qc.dto';

@ApiTags('Lab QC (정도관리)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.LAB_TECH, UserRole.ADMIN)
@Controller('api/v1/lab/qc')
export class QcController {
  constructor(private readonly service: QcService) {}

  @Get('records')
  @ApiOperation({ summary: 'QC 기록 조회' })
  async getRecords(@Query('instrumentId') instrumentId?: string, @Query('date') date?: string) {
    return { data: await this.service.getRecords({ instrumentId, date }) };
  }

  @Post('records')
  @ApiOperation({ summary: 'QC 기록 추가 (자동 z-score + Westgard 판정)' })
  async addRecord(
    @Body() dto: AddQcRecordDto,
    @CurrentUser('id') userId: string,
  ) {
    return { data: await this.service.addRecord({ ...dto, performedBy: userId }) };
  }

  @Get('dashboard')
  @ApiOperation({ summary: '오늘 QC 대시보드 (장비별 요약)' })
  async getDashboard(@Query('instrumentId') instrumentId?: string) {
    return { data: await this.service.getDashboard(instrumentId) };
  }
}
