import { Controller, Get, Post, Param, Body, Query, UseGuards, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { HieService } from './hie.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('HIE (진료정보교류)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.DOCTOR, UserRole.ADMIN)
@Controller('api/v1/hie')
export class HieController {
  constructor(private readonly hieService: HieService) {}

  @Post('send/:patientId')
  @ApiOperation({ summary: '진료정보 전송 (CDA R2 변환 + 교류 이력 저장)' })
  async send(
    @Param('patientId', ParseUUIDPipe) patientId: string,
    @Body() body: { targetOrgId: string; documentType: string; format?: 'CDA_R2' | 'FHIR_R4' },
    @CurrentUser('id') userId: string,
  ) {
    return { data: await this.hieService.sendPatientSummary(patientId, { ...body, requestedBy: userId }) };
  }

  @Post('receive')
  @ApiOperation({ summary: '외부 진료정보 수신 (CDA/FHIR)' })
  async receive(@Body() dto: { cdaDocument?: string; fhirBundle?: Record<string, unknown>; sourceOrgId?: string }) {
    return { data: await this.hieService.receiveExternalRecord(dto) };
  }

  @Get('log')
  @ApiOperation({ summary: '교류 이력 목록' })
  async getLog(
    @Query('patientId') patientId?: string,
    @Query('direction') direction?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return { data: await this.hieService.getExchangeLog(patientId, direction, parseInt(page ?? '1'), parseInt(limit ?? '20')) };
  }

  @Get('log/:id')
  @ApiOperation({ summary: '교류 이력 상세' })
  async getDetail(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.hieService.getExchangeDetail(id) };
  }

  @Get('stats')
  @ApiOperation({ summary: '교류 통계' })
  async getStats() {
    return { data: await this.hieService.getStats() };
  }
}
