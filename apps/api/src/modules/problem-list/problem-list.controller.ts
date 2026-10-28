import {
  Controller, Get, Post, Put, Patch, Param, Body, Query,
  UseGuards, ParseUUIDPipe,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { ProblemListService } from './problem-list.service';
import { CreateProblemDto } from './dto/create-problem.dto';
import { UpdateProblemDto, ResolveProblemDto } from './dto/update-problem.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('Problem List')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/v1/patients/:patientId/problems')
export class ProblemListController {
  constructor(private readonly problemListService: ProblemListService) {}

  @Post()
  @Roles(UserRole.DOCTOR, UserRole.ADMIN)
  @ApiOperation({ summary: '문제목록 추가' })
  async create(
    @Param('patientId', ParseUUIDPipe) patientId: string,
    @Body() dto: CreateProblemDto,
    @CurrentUser('id') userId: string,
  ) {
    const problem = await this.problemListService.create(patientId, dto, userId);
    return { data: problem };
  }

  @Get()
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: '환자 문제목록 조회' })
  async findByPatient(
    @Param('patientId', ParseUUIDPipe) patientId: string,
    @Query('status') status?: string,
  ) {
    const problems = await this.problemListService.findByPatient(patientId, status);
    return { data: problems };
  }

  @Get(':id')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: '문제목록 상세' })
  async findById(
    @Param('patientId', ParseUUIDPipe) patientId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const problem = await this.problemListService.findById(patientId, id);
    return { data: problem };
  }

  @Put(':id')
  @Roles(UserRole.DOCTOR, UserRole.ADMIN)
  @ApiOperation({ summary: '문제목록 수정' })
  async update(
    @Param('patientId', ParseUUIDPipe) patientId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateProblemDto,
  ) {
    const problem = await this.problemListService.update(patientId, id, dto);
    return { data: problem };
  }

  @Patch(':id/resolve')
  @Roles(UserRole.DOCTOR, UserRole.ADMIN)
  @ApiOperation({ summary: '문제 해결 (RESOLVED 처리)' })
  async resolve(
    @Param('patientId', ParseUUIDPipe) patientId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResolveProblemDto,
  ) {
    const problem = await this.problemListService.resolve(patientId, id, dto);
    return { data: problem };
  }
}
