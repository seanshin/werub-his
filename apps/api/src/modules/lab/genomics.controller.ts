import { Controller, Get, Post, Patch, Param, Body, Query, UseGuards, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { GenomicsService } from './genomics.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import {
  CreateGenomicTestDto, UpdateGenomicTestStatusDto,
  AddVariantDto, AddGenomicReportDto, RecordCounselDto,
} from './dto/genomics.dto';

@ApiTags('Genomics (유전체)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.LAB_TECH, UserRole.DOCTOR, UserRole.ADMIN)
@Controller('api/v1/lab/genomics')
export class GenomicsController {
  constructor(private readonly service: GenomicsService) {}

  @Get('tests')
  @ApiOperation({ summary: '유전체 검사 목록' })
  async getTests(@Query('status') status?: string, @Query('patientId') patientId?: string) {
    return { data: await this.service.getTests({ status, patientId }) };
  }

  @Post('tests')
  @ApiOperation({ summary: '유전체 검사 오더' })
  async createTest(
    @Body() dto: CreateGenomicTestDto,
    @CurrentUser('id') userId: string,
  ) {
    return { data: await this.service.createTest({ ...dto, orderedBy: userId }) };
  }

  @Get('tests/:id')
  @ApiOperation({ summary: '유전체 검사 상세 (변이+보고서 포함)' })
  async getTestDetail(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.service.getTestDetail(id) };
  }

  @Patch('tests/:id/status')
  @ApiOperation({ summary: '검사 상태 변경 (9단계 워크플로우)' })
  async updateStatus(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateGenomicTestStatusDto) {
    return { data: await this.service.updateTestStatus(id, dto.status) };
  }

  @Post('tests/:id/variants')
  @ApiOperation({ summary: '변이 추가' })
  async addVariant(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddVariantDto,
  ) {
    return { data: await this.service.addVariant(id, dto) };
  }

  @Post('tests/:id/reports')
  @ApiOperation({ summary: '보고서 추가' })
  async addReport(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddGenomicReportDto,
    @CurrentUser('id') userId: string,
  ) {
    return { data: await this.service.addReport(id, { ...dto, reportedBy: userId }) };
  }

  @Patch('tests/:id/counsel')
  @Roles(UserRole.DOCTOR, UserRole.ADMIN)
  @ApiOperation({ summary: '유전상담 기록' })
  async recordCounsel(@Param('id', ParseUUIDPipe) id: string, @Body() dto: RecordCounselDto) {
    return { data: await this.service.recordCounsel(id, dto.notes) };
  }

  @Get('patient/:patientId/history')
  @ApiOperation({ summary: '환자 유전체 검사 이력' })
  async getPatientHistory(@Param('patientId', ParseUUIDPipe) patientId: string) {
    return { data: await this.service.getPatientGenomicHistory(patientId) };
  }
}
