import {
  Controller, Get, Post, Patch, Param, Body, Query,
  UseGuards, ParseUUIDPipe,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { NursingNoteService } from './nursing-note.service';
import { CreateNursingNoteDto, UpdateNursingNoteDto } from './dto/nursing-note.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('Universal Nursing Notes')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/v1/nursing-notes')
export class NursingNoteController {
  constructor(private readonly service: NursingNoteService) {}

  /** POST / — 간호기록 생성 */
  @Post()
  @Roles(UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: '범용 간호기록 생성' })
  async create(
    @Body() dto: CreateNursingNoteDto,
    @CurrentUser('id') nurseId: string,
  ) {
    const data = await this.service.create(dto, nurseId);
    return { data };
  }

  /** GET / — 간호기록 목록 (필터) */
  @Get()
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: '범용 간호기록 목록 조회' })
  async findAll(
    @Query('contextType') contextType?: string,
    @Query('contextId') contextId?: string,
    @Query('patientId') patientId?: string,
    @Query('noteType') noteType?: string,
  ) {
    const data = await this.service.findAll({ contextType, contextId, patientId, noteType });
    return { data };
  }

  /** GET /stats — 오늘 기록 통계 */
  @Get('stats')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: '오늘 간호기록 통계 (contextType별)' })
  async getStats(@Query('nurseId') nurseId?: string) {
    const data = await this.service.getStats(nurseId);
    return { data };
  }

  /** GET /patient/:patientId — 환자별 간호기록 */
  @Get('patient/:patientId')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: '환자별 간호기록 조회' })
  async findByPatient(@Param('patientId', ParseUUIDPipe) patientId: string) {
    const data = await this.service.findByPatient(patientId);
    return { data };
  }

  /** GET /context/:contextType/:contextId — 컨텍스트별 간호기록 */
  @Get('context/:contextType/:contextId')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: '컨텍스트별 간호기록 조회' })
  async findByContext(
    @Param('contextType') contextType: string,
    @Param('contextId', ParseUUIDPipe) contextId: string,
  ) {
    const data = await this.service.findByContext(contextType, contextId);
    return { data };
  }

  /** GET /:id — 간호기록 단건 조회 */
  @Get(':id')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: '간호기록 단건 조회' })
  async findById(@Param('id', ParseUUIDPipe) id: string) {
    const data = await this.service.findById(id);
    return { data };
  }

  /** PATCH /:id — 간호기록 수정 */
  @Patch(':id')
  @Roles(UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: '간호기록 수정' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateNursingNoteDto,
  ) {
    const data = await this.service.update(id, dto);
    return { data };
  }
}
