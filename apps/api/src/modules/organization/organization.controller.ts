import { Controller, Get, Post, Patch, Param, Body, UseGuards, ParseUUIDPipe, BadRequestException } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { OrganizationService } from './organization.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CreateOrganizationDto, UpdateOrganizationDto } from './dto/organization.dto';

@ApiTags('Organization (외부기관)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@Controller('api/v1/organizations')
export class OrganizationController {
  constructor(private readonly organizationService: OrganizationService) {}

  @Get()
  // 🔴 전원 요청 화면(/transfer/request·의사 nav)이 수신 기관 목록을 여기서 읽는다 — ADMIN 단독이라 상시 403 이었다.
  //    목록 조회만 연다(등록·수정·연결 테스트는 관리 업무 그대로).
  @Roles(UserRole.ADMIN, UserRole.DOCTOR)
  @ApiOperation({ summary: '기관 목록 조회' })
  async findAll() {
    return { data: await this.organizationService.findAll() };
  }

  @Post()
  @ApiOperation({ summary: '기관 등록' })
  async create(@Body() dto: CreateOrganizationDto) {
    // 관리 화면은 유형을 `type` 으로 보낸다 — 정본 키 `orgType` 으로 옮기고 별칭은 저장하지 않는다
    const { type, ...rest } = dto;
    const orgType = rest.orgType ?? type;
    if (!orgType) throw new BadRequestException('기관 유형(orgType)을 지정하세요');
    return { data: await this.organizationService.create({ ...rest, orgType }) };
  }

  @Get(':id')
  @ApiOperation({ summary: '기관 상세 조회' })
  async findOne(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.organizationService.findOne(id) };
  }

  @Patch(':id')
  @ApiOperation({ summary: '기관 수정' })
  async update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateOrganizationDto) {
    return { data: await this.organizationService.update(id, dto) };
  }

  @Get(':id/test')
  @ApiOperation({ summary: 'FHIR 연결 테스트' })
  async testConnection(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.organizationService.testConnection(id) };
  }
}
