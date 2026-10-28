import { BadRequestException, Controller, Get, Query, UseGuards } from '@nestjs/common';
import { isUUID } from 'class-validator';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { MedicalRecordSearchService } from './medical-record-search.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';

@ApiTags('Medical Record Search')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/v1/medical-records')
export class MedicalRecordSearchController {
  constructor(private readonly service: MedicalRecordSearchService) {}

  @Get('search')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN, UserRole.MEDICAL_RECORDS)
  @ApiOperation({ summary: '의무기록 전문검색' })
  async search(
    @Query('q') q: string,
    @Query('type') type?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('doctorId') doctorId?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('patientId') patientId?: string,
  ) {
    // 환자 지정 검색(차트 내 검색) — 형식이 틀린 id 를 조건 없이 흘리면 전 환자 검색이 된다: 400 으로 거부
    if (patientId !== undefined && !isUUID(patientId)) throw new BadRequestException('patientId must be a UUID');
    const result = await this.service.search(q, {
      type, dateFrom, dateTo, doctorId, patientId,
      page: page ? +page : undefined,
      limit: limit ? +limit : undefined,
    });
    return { data: result };
  }
}
