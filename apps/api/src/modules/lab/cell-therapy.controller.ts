import { Controller, Get, Post, Patch, Param, Body, Query, UseGuards, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { CellTherapyService } from './cell-therapy.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import {
  CreateCellTherapyBatchDto, UpdateBatchStatusDto,
  AddEnvironmentLogDto, AddQcTestDto, AddDocumentDto,
} from './dto/cell-therapy.dto';

@ApiTags('Cell Therapy (세포치료)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.LAB_TECH, UserRole.DOCTOR, UserRole.ADMIN)
@Controller('api/v1/lab/cell-therapy')
export class CellTherapyController {
  constructor(private readonly service: CellTherapyService) {}

  @Get('batches')
  @ApiOperation({ summary: '세포치료 배치 목록' })
  async getBatches(@Query('status') status?: string, @Query('patientId') patientId?: string) {
    return { data: await this.service.getBatches({ status, patientId }) };
  }

  @Post('batches')
  @ApiOperation({ summary: '세포치료 배치 생성' })
  async createBatch(@Body() dto: CreateCellTherapyBatchDto) {
    return { data: await this.service.createBatch(dto) };
  }

  @Get('batches/:id')
  @ApiOperation({ summary: '배치 상세 (환경+QC+문서 포함)' })
  async getBatchDetail(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.service.getBatchDetail(id) };
  }

  @Patch('batches/:id/status')
  @ApiOperation({ summary: '배치 상태 변경' })
  async updateStatus(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateBatchStatusDto) {
    return { data: await this.service.updateBatchStatus(id, dto.status) };
  }

  @Post('batches/:id/environment')
  @ApiOperation({ summary: '환경 모니터링 로그 기록' })
  async addEnvironmentLog(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddEnvironmentLogDto,
    @CurrentUser('id') userId: string,
  ) {
    return { data: await this.service.addEnvironmentLog(id, { ...dto, recordedBy: userId }) };
  }

  @Post('batches/:id/qc')
  @ApiOperation({ summary: 'QC 검사 기록' })
  async addQcTest(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddQcTestDto,
    @CurrentUser('id') userId: string,
  ) {
    return { data: await this.service.addQcTest(id, { ...dto, testedBy: userId }) };
  }

  @Post('batches/:id/documents')
  @ApiOperation({ summary: 'GMP 문서 첨부' })
  async addDocument(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddDocumentDto,
    @CurrentUser('id') userId: string,
  ) {
    return { data: await this.service.addDocument(id, { ...dto, uploadedBy: userId }) };
  }

  @Patch('batches/:id/release')
  @Roles(UserRole.DOCTOR, UserRole.ADMIN)
  @ApiOperation({ summary: '출하 승인 (QC 전체 PASS 필수)' })
  async releaseBatch(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.service.releaseBatch(id) };
  }
}
