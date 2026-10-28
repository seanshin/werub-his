import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { CareTeamService } from './care-team.service';
import { CreateCareTeamDto, UpdateCareTeamDto } from './dto/care-team.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('Care Team')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
/**
 * 🔴 (2026-09-16 D4) 진료팀 **읽기 3EP 가 무역할**이었다 — 환자 담당 구성이 인증된 전 직원에게 열려 있었다.
 *    소비 화면은 `/admin/care-teams`(ADMIN)와 `/clinic-queue`(ADMIN·DOCTOR·NURSE·RECEPTIONIST)라 그 합집합을 둔다.
 */
@Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE, UserRole.RECEPTIONIST)
@Controller('api/v1/care-teams')
export class CareTeamController {
  constructor(private readonly service: CareTeamService) {}

  @Get()
  @ApiOperation({ summary: '케어팀 목록 조회' })
  async findAll(
    @Query('department') department?: string,
    @Query('type') type?: string,
  ) {
    return { data: await this.service.findAll(department, type) };
  }

  @Post()
  @Roles(UserRole.ADMIN, UserRole.NURSE)
  @ApiOperation({ summary: '케어팀 생성' })
  async create(@Body() dto: CreateCareTeamDto) {
    return { data: await this.service.create(dto) };
  }

  @Get('my')
  @ApiOperation({ summary: '내 케어팀 조회' })
  async getMyTeam(@CurrentUser('id') userId: string) {
    return { data: await this.service.getMyTeam(userId) };
  }

  @Get('doctor/:doctorId')
  @ApiOperation({ summary: '의사별 케어팀 조회' })
  async getByDoctor(@Param('doctorId', ParseUUIDPipe) doctorId: string) {
    return { data: await this.service.getByDoctor(doctorId) };
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN, UserRole.NURSE)
  @ApiOperation({ summary: '케어팀 수정' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCareTeamDto,
  ) {
    return { data: await this.service.update(id, dto) };
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '케어팀 비활성화' })
  async deactivate(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.service.deactivate(id) };
  }
}
