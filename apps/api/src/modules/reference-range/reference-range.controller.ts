import { Controller, Get, Post, Patch, Delete, Param, Body, Query, UseGuards, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { ReferenceRangeService } from './reference-range.service';
import { CreateReferenceRangeDto, UpdateReferenceRangeDto } from './dto/reference-range.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';

@ApiTags('Reference Range (검사 기준치 마스터)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/v1/reference-ranges')
export class ReferenceRangeController {
  constructor(private readonly service: ReferenceRangeService) {}

  @Get()
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.LAB_TECH, UserRole.ADMIN)
  @ApiOperation({ summary: '기준치 목록' })
  async list(@Query('testCode') testCode?: string, @Query('loincCode') loincCode?: string, @Query('q') q?: string) {
    return { data: await this.service.list({ testCode, loincCode, q }) };
  }

  @Get('resolve')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.LAB_TECH, UserRole.ADMIN)
  @ApiOperation({ summary: '기준치 해소(성별·연령 반영)' })
  async resolve(
    @Query('testCode') testCode?: string,
    @Query('loincCode') loincCode?: string,
    @Query('sex') sex?: string,
    @Query('ageYears') ageYears?: string,
    @Query('ageMonths') ageMonths?: string,
  ) {
    const resolved = await this.service.resolve({
      testCode,
      loincCode,
      sex: (sex as never) ?? null,
      ageYears: ageYears != null ? Number(ageYears) : null,
      ageMonths: ageMonths != null ? Number(ageMonths) : null,
    });
    return { data: resolved };
  }

  @Post()
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '기준치 등록' })
  async create(@Body() dto: CreateReferenceRangeDto) {
    return { data: await this.service.create(dto) };
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '기준치 수정' })
  async update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateReferenceRangeDto) {
    return { data: await this.service.update(id, dto) };
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '기준치 비활성화' })
  async deactivate(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.service.deactivate(id) };
  }
}
