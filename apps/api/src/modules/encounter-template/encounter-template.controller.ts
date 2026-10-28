import { Controller, Get, Post, Put, Param, Body, Query, UseGuards, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { EncounterTemplateService } from './encounter-template.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CreateEncounterTemplateDto, UpdateEncounterTemplateDto } from './dto/encounter-template.dto';

@ApiTags('Encounter Templates')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/v1/encounter-templates')
export class EncounterTemplateController {
  constructor(private readonly service: EncounterTemplateService) {}

  @Post()
  @Roles(UserRole.DOCTOR, UserRole.ADMIN)
  @ApiOperation({ summary: '진료기록 템플릿 생성' })
  async create(@Body() dto: CreateEncounterTemplateDto, @CurrentUser('id') userId: string) {
    return { data: await this.service.create(dto, userId) };
  }

  @Get()
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: '진료기록 템플릿 목록' })
  async findAll(@Query('department') department?: string) {
    return { data: await this.service.findAll(department) };
  }

  @Get(':id')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: '진료기록 템플릿 상세' })
  async findById(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.service.findById(id) };
  }

  @Put(':id')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '진료기록 템플릿 수정' })
  async update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateEncounterTemplateDto) {
    return { data: await this.service.update(id, dto) };
  }
}
