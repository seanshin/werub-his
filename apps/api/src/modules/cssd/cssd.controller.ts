import { Controller, Get, Post, Patch, Param, Body, Query, UseGuards, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { CssdService } from './cssd.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CreateInstrumentSetDto, UpdateCssdStatusDto } from './dto/cssd.dto';

@ApiTags('CSSD (중앙공급실)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.NURSE, UserRole.ADMIN)
@Controller('api/v1/cssd')
export class CssdController {
  constructor(private readonly cssdService: CssdService) {}

  @Get('sets')
  @ApiOperation({ summary: '기구 세트 목록' })
  async getAllSets(@Query('status') status?: string) { return { data: await this.cssdService.getAllSets(status) }; }

  @Post('sets')
  @ApiOperation({ summary: '기구 세트 등록' })
  async createSet(@Body() dto: CreateInstrumentSetDto) { return { data: await this.cssdService.createSet(dto) }; }

  @Patch('sets/:id/status')
  @ApiOperation({ summary: '멸균 상태 변경 (세척→멸균→출고)' })
  async updateStatus(@Param('id', ParseUUIDPipe) id: string, @Body() body: UpdateCssdStatusDto, @CurrentUser('id') userId: string) {
    return { data: await this.cssdService.updateStatus(id, body.status as any, userId, body.notes, body.biResult, body.ciResult) };
  }

  @Get('sets/:id/logs')
  @ApiOperation({ summary: '멸균 이력' })
  async getLogs(@Param('id', ParseUUIDPipe) id: string) { return { data: await this.cssdService.getLogs(id) }; }

  @Get('expiring')
  @ApiOperation({ summary: '유효기간 만료 임박 세트' })
  async getExpiring() { return { data: await this.cssdService.getExpiringSoon() }; }

  @Get('stats')
  @ApiOperation({ summary: 'CSSD 대시보드 통계' })
  async getStats() { return { data: await this.cssdService.getStats() }; }
}
