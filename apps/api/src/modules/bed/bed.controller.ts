import { Controller, Get, Patch, Param, Query, Body, UseGuards, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { BedService } from './bed.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { Permission } from '../auth/rbac/permission.types';
import { BedStatus } from '@prisma/client';
import { UpdateBedStatusDto } from './dto/bed.dto';

@ApiTags('Bed Management')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/v1/beds')
export class BedController {
  constructor(private readonly bedService: BedService) {}

  @Get('list')
  @RequirePermission(Permission.PATIENT_VIEW)
  @ApiOperation({ summary: '병상 목록' })
  @ApiResponse({ status: 200, description: '병상 목록 조회 성공' })
  async listBeds(@Query('wardId') wardId?: string) {
    return { data: await this.bedService.listBeds(wardId) };
  }

  @Get('wards')
  @RequirePermission(Permission.PATIENT_VIEW)
  @ApiOperation({ summary: '병동별 병상 현황' })
  async getWards() {
    return { data: await this.bedService.getWardsWithBeds() };
  }

  @Get('status')
  @RequirePermission(Permission.PATIENT_VIEW)
  @ApiOperation({ summary: '병상 상태 통계' })
  async getBedStatus() {
    return { data: await this.bedService.getBedStatusSummary() };
  }

  @Patch(':bedId/status')
  @RequirePermission(Permission.PATIENT_EDIT)
  @ApiOperation({ summary: '병상 상태 변경' })
  @ApiResponse({ status: 200, description: '병상 상태 변경 성공' })
  async updateBedStatus(
    @Param('bedId', ParseUUIDPipe) bedId: string,
    @Body() body: UpdateBedStatusDto
  ) {
    return { data: await this.bedService.updateBedStatus(bedId, body.status) };
  }

  @Get('available')
  @RequirePermission(Permission.PATIENT_VIEW)
  @ApiOperation({ summary: '가용 병상' })
  @ApiResponse({ status: 200, description: '가용 병상 조회 성공' })
  async getAvailableBeds(@Query('wardId') wardId?: string) {
    return { data: await this.bedService.getAvailableBeds(wardId) };
  }

  @Get('ward/:wardId/beds')
  @RequirePermission(Permission.PATIENT_VIEW)
  @ApiOperation({ summary: '병동별 병상' })
  @ApiResponse({ status: 200, description: '병동별 병상 조회 성공' })
  async getBedsByWard(@Param('wardId', ParseUUIDPipe) wardId: string) {
    return { data: await this.bedService.getBedsByWard(wardId) };
  }

  @Get(':bedId')
  @RequirePermission(Permission.PATIENT_VIEW)
  @ApiOperation({ summary: '병상 상세 조회' })
  @ApiResponse({ status: 200, description: '병상 상세 조회 성공' })
  async getBedDetail(@Param('bedId', ParseUUIDPipe) bedId: string) {
    return { data: await this.bedService.getBedDetail(bedId) };
  }

  @Get('ward/:wardId/occupancy')
  @RequirePermission(Permission.PATIENT_VIEW)
  @ApiOperation({ summary: '병동 점유율' })
  @ApiResponse({ status: 200, description: '병동 점유율 조회 성공' })
  async calculateWardOccupancy(@Param('wardId', ParseUUIDPipe) wardId: string) {
    return { data: await this.bedService.calculateWardOccupancy(wardId) };
  }
}
