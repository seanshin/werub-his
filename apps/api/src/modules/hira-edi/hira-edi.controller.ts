import { Controller, Get, Post, Param, Body, Query, UseGuards, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { HiraEdiService } from './hira-edi.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('HIRA EDI (건강보험 청구)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@Controller('api/v1/hira-edi')
export class HiraEdiController {
  constructor(private readonly hiraEdiService: HiraEdiService) {}

  @Post('generate/:claimId')
  @ApiOperation({ summary: 'EDI 문서 생성' })
  async generateDocument(
    @Param('claimId', ParseUUIDPipe) claimId: string,
    @CurrentUser('id') userId: string,
  ) {
    return { data: await this.hiraEdiService.generateDocument(claimId, userId) };
  }

  @Get('stats')
  @ApiOperation({ summary: 'EDI 청구 통계' })
  async getStats() {
    return { data: await this.hiraEdiService.getStats() };
  }

  @Get(':id')
  @ApiOperation({ summary: 'EDI 문서 조회' })
  async getDocument(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.hiraEdiService.getDocument(id) };
  }

  @Get()
  @ApiOperation({ summary: 'EDI 문서 목록' })
  async getDocuments(
    @Query('status') status?: string,
    @Query('patientId') patientId?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    return { data: await this.hiraEdiService.getDocuments({ status, patientId, dateFrom, dateTo }) };
  }

  @Post(':id/validate')
  @ApiOperation({ summary: 'EDI 문서 유효성 검증' })
  async validateDocument(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.hiraEdiService.validateDocument(id) };
  }

  @Post(':id/submit')
  @ApiOperation({ summary: 'EDI 문서 제출' })
  async submitDocument(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.hiraEdiService.submitDocument(id) };
  }

  @Post(':id/response')
  @ApiOperation({ summary: 'EDI 심사 결과 기록' })
  async recordResponse(@Param('id', ParseUUIDPipe) id: string, @Body() responseData: Record<string, unknown>) {
    return { data: await this.hiraEdiService.recordResponse(id, responseData) };
  }

  @Post(':id/regenerate')
  @ApiOperation({ summary: 'EDI 문서 재생성' })
  async regenerate(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.hiraEdiService.regenerate(id) };
  }
}
