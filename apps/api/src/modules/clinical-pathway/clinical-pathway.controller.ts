import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Query,
  Body,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { PublishPathwayDto } from './dto/publish-pathway.dto';
import {
  AssignPathwayDto, CreateMilestoneDto, CreatePathwayDto, RecordMilestoneOutcomeDto, UpdateMilestoneDto, UpdatePathwayDto,
} from './dto/clinical-pathway-write.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ClinicalPathwayService } from './clinical-pathway.service';

@ApiTags('Clinical Pathway (임상경로)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/v1/pathways')
export class ClinicalPathwayController {
  constructor(private readonly service: ClinicalPathwayService) {}

  // ── 경로 관리 ──

  @Get()
  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE)
  @ApiOperation({ summary: '임상경로 목록 조회' })
  async findAll(
    @Query('dept') dept?: string,
    @Query('status') status?: string,
  ) {
    return { data: await this.service.findAll(dept, status) };
  }

  @Post()
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '임상경로 생성' })
  async create(
    @Body() body: CreatePathwayDto,
    @CurrentUser('id') userId: string,
  ) {
    return { data: await this.service.create({ ...body }, userId) };
  }

  @Get('analytics')
  // 🔴 /clinical-pathway 화면(의사 nav)이 로드 시 부르는데 ADMIN 단독이라 의사에게 상시 403 이었다
  @Roles(UserRole.ADMIN, UserRole.DOCTOR)
  @ApiOperation({ summary: '임상경로 분석 (완료율/이탈율/평균재원일)' })
  async getAnalytics(@Query('dept') dept?: string) {
    return { data: await this.service.getAnalytics(dept) };
  }

  @Get('assignments')
  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE)
  @ApiOperation({ summary: '경로 배정 목록 조회 (deviated=true 면 이탈 발생분만)' })
  async getAssignments(
    @Query('status') status?: string,
    @Query('patientId') patientId?: string,
    @Query('deviated') deviated?: string,
  ) {
    return { data: await this.service.getAssignments(status, patientId, deviated === 'true') };
  }

  @Get('assignments/:id')
  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE)
  @ApiOperation({ summary: '경로 배정 상세 조회' })
  async getAssignment(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.service.getAssignment(id) };
  }

  @Post('assignments/:id/outcome')
  @Roles(UserRole.DOCTOR, UserRole.NURSE)
  @ApiOperation({ summary: '마일스톤 결과 기록 (DONE/SKIPPED/DELAYED/DEVIATED)' })
  async recordOutcome(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: RecordMilestoneOutcomeDto,
    @CurrentUser('id') userId: string,
  ) {
    return { data: await this.service.recordOutcome(id, { ...body }, userId) };
  }

  @Patch('assignments/:id/cancel')
  @Roles(UserRole.DOCTOR, UserRole.ADMIN)
  @ApiOperation({ summary: '경로 배정 취소' })
  async cancelAssignment(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.service.cancelAssignment(id) };
  }

  @Get(':id')
  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE)
  @ApiOperation({ summary: '임상경로 상세 조회' })
  async findOne(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.service.findOne(id) };
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '임상경로 수정' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdatePathwayDto,
  ) {
    return { data: await this.service.update(id, { ...body }) };
  }

  @Post(':id/publish')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '임상경로 발행 (DRAFT → ACTIVE)' })
  async publish(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: PublishPathwayDto,
    @CurrentUser('id') userId: string,
  ) {
    // 🔴 누가 눌렀는지가 남는다 — 종전엔 발행자 컬럼 자체가 없었다
    return { data: await this.service.publish(id, { userId, decisionNo: body?.decisionNo ?? null }) };
  }

  @Post(':id/retire')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '임상경로 폐기 (ACTIVE → RETIRED)' })
  async retire(@Param('id', ParseUUIDPipe) id: string, @Body() body?: PublishPathwayDto) {
    // 공개판: 폐기도 발행처럼 의결 번호(decisionNo)를 함께 받을 수 있다
    return { data: await this.service.retire(id, { decisionNo: body?.decisionNo ?? null }) };
  }

  @Post(':id/clone')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '임상경로 복제 (새 버전)' })
  async clone(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') userId: string,
  ) {
    return { data: await this.service.clone(id, userId) };
  }

  @Post(':id/milestones')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '마일스톤 추가' })
  async addMilestone(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: CreateMilestoneDto,
  ) {
    return { data: await this.service.addMilestone(id, { ...body }) };
  }

  @Patch('milestones/:id')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '마일스톤 수정' })
  async updateMilestone(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateMilestoneDto,
  ) {
    return { data: await this.service.updateMilestone(id, { ...body }) };
  }

  @Delete('milestones/:id')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '마일스톤 삭제' })
  async deleteMilestone(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.service.deleteMilestone(id) };
  }

  @Post(':id/assign')
  @Roles(UserRole.DOCTOR, UserRole.ADMIN)
  @ApiOperation({ summary: '환자에게 경로 배정' })
  async assign(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: AssignPathwayDto,
    @CurrentUser('id') userId: string,
  ) {
    return { data: await this.service.assign(id, { ...body }, userId) };
  }
}
