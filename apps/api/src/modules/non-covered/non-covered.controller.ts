import { Controller, Get, Post, Put, Patch, Delete, Body, Param, Query, UseGuards, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { NonCoveredService } from './non-covered.service';

const CATS = ['ROOM', 'PROCEDURE', 'EXAM', 'THERAPY', 'MATERIAL', 'CERTIFICATE', 'OTHER'];

class NonCoveredDto {
  @IsString() code!: string;
  @IsString() name!: string;
  @IsIn(CATS) category!: string;
  @IsInt() @Min(0) price!: number;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsBoolean() requiresConsent?: boolean;
}
class NonCoveredUpdateDto {
  @IsOptional() @IsString() code?: string;
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsIn(CATS) category?: string;
  @IsOptional() @IsInt() @Min(0) price?: number;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsBoolean() requiresConsent?: boolean;
}

@ApiTags('Non-Covered')
@Controller('api/v1/non-covered')
export class NonCoveredController {
  constructor(private readonly svc: NonCoveredService) {}

  // 공개 — 비급여 진료비용 고지(의료법 §45). activeOnly=true 시 활성만.
  @Get()
  @ApiOperation({ summary: '비급여 항목 목록(공개 고지)' })
  async list(@Query('category') category?: string, @Query('activeOnly') activeOnly?: string) {
    return { data: await this.svc.list(category, activeOnly === 'true') };
  }

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  async create(@Body() dto: NonCoveredDto) {
    return { data: await this.svc.create(dto) };
  }

  @Put(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  async update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: NonCoveredUpdateDto) {
    return { data: await this.svc.update(id, dto) };
  }

  @Patch(':id/toggle')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  async toggle(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.svc.toggle(id) };
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.svc.remove(id) };
  }
}
