import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { NurseStationService } from './nurse-station.service';
import { RecordVitalsDto, SkipTaskDto, EducatePatientDto, AssignNursePatientDto, TakeOverAssignmentDto } from './dto/nurse-station.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('Nurse Station')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/v1/nurse-station')
export class NurseStationController {
  constructor(private readonly service: NurseStationService) {}

  // ── 대기열 ──

  @Get('queue')
  @Roles(UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: '간호사 담당 대기 환자 목록' })
  async getQueue(@CurrentUser('id') nurseId: string) {
    return { data: await this.service.getQueue(nurseId) };
  }

  @Get('queue/:nurseId')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '특정 간호사의 대기 환자 목록 (관리자)' })
  async getQueueByNurse(@Param('nurseId', ParseUUIDPipe) nurseId: string) {
    return { data: await this.service.getQueue(nurseId) };
  }

  // ── 업무 ──

  @Get('tasks/:queueId')
  @Roles(UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: '대기열 항목의 간호 업무 목록' })
  async getTasks(@Param('queueId', ParseUUIDPipe) queueId: string) {
    return { data: await this.service.getTasks(queueId) };
  }

  @Post('tasks/:queueId/generate')
  @Roles(UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: '진료 전 간호 업무 자동 생성' })
  async generateTasks(
    @Param('queueId', ParseUUIDPipe) queueId: string,
    @CurrentUser('id') nurseId: string,
  ) {
    return { data: await this.service.generateTasks(queueId, nurseId) };
  }

  @Patch('tasks/:taskId/complete')
  @Roles(UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: '업무 완료 처리' })
  async completeTask(@Param('taskId', ParseUUIDPipe) taskId: string) {
    return { data: await this.service.completeTask(taskId) };
  }

  @Patch('tasks/:taskId/skip')
  @Roles(UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: '업무 건너뛰기' })
  async skipTask(
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @Body() dto: SkipTaskDto,
  ) {
    return { data: await this.service.skipTask(taskId, dto.reason) };
  }

  // ── 통계 ──

  @Get('stats')
  @Roles(UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: '오늘의 간호 업무 통계' })
  async getStats(@CurrentUser('id') nurseId: string) {
    return { data: await this.service.getStats(nurseId) };
  }

  @Get('stats/:nurseId')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '특정 간호사의 업무 통계 (관리자)' })
  async getStatsByNurse(@Param('nurseId', ParseUUIDPipe) nurseId: string) {
    return { data: await this.service.getStats(nurseId) };
  }

  // ── 바이탈 ──

  @Post('vitals/:queueId')
  @Roles(UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: '바이탈 사인 기록' })
  async recordVitals(
    @Param('queueId', ParseUUIDPipe) queueId: string,
    @Body() dto: RecordVitalsDto,
    @CurrentUser('id') nurseId: string,
  ) {
    // 🔴 저장 여부와 사유를 `meta` 로 함께 낸다 — 종전엔 `data: null` 만 가서
    //    화면이 "왜 저장 안 됐는지"를 알 수 없었다(사실은 서버 로그에만 있었다).
    const r = await this.service.recordVitals(queueId, dto, nurseId);
    return { data: r.vitals, meta: { ingest: r.ingest } };
  }

  @Get('vitals/patient/:patientId')
  @Roles(UserRole.NURSE, UserRole.DOCTOR, UserRole.ADMIN)
  @ApiOperation({ summary: '환자별 바이탈 사인 이력 조회' })
  async getVitalsByPatient(@Param('patientId', ParseUUIDPipe) patientId: string) {
    // 행마다 flags(서버 정본 임계 판정) · meta.vitalsRule = 적용 임계의 출처(개정 반영/코드 기본)
    const r = await this.service.getVitalsByPatientWithRule(patientId);
    return { data: r.rows, meta: { vitalsRule: r.rule } };
  }

  @Get('vitals/:queueId')
  @Roles(UserRole.NURSE, UserRole.DOCTOR, UserRole.ADMIN)
  @ApiOperation({ summary: '바이탈 사인 조회' })
  async getVitals(@Param('queueId', ParseUUIDPipe) queueId: string) {
    return { data: await this.service.getVitals(queueId) };
  }

  // ── 진료 후 업무 ──

  @Post('post-visit/:encounterId/generate')
  @Roles(UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: '진료 후 간호 업무 자동 생성' })
  async generatePostVisitTasks(
    @Param('encounterId', ParseUUIDPipe) encounterId: string,
    @CurrentUser('id') nurseId: string,
  ) {
    return { data: await this.service.generatePostVisitTasks(encounterId, nurseId) };
  }

  @Get('post-visit/:encounterId/tasks')
  @Roles(UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: '진료 후 간호 업무 목록' })
  async getPostVisitTasks(@Param('encounterId', ParseUUIDPipe) encounterId: string) {
    return { data: await this.service.getPostVisitTasksByEncounter(encounterId) };
  }

  // ── 환자 교육 (Phase 6) ──

  @Post('educate/:encounterId')
  @Roles(UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: '진료 후 환자 교육 기록' })
  async recordEducation(
    @Param('encounterId', ParseUUIDPipe) encounterId: string,
    @Body() dto: EducatePatientDto,
    @CurrentUser('id') nurseId: string,
  ) {
    return { data: await this.service.recordEducation(encounterId, nurseId, dto) };
  }

  @Get('rx-guide/:encounterId')
  @Roles(UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: '처방 설명 가이드 — 처방·약품 마스터 값 그대로(용법·주의 문구 생성 없음·AI 미호출)' })
  async getRxGuide(@Param('encounterId', ParseUUIDPipe) encounterId: string) {
    return { data: await this.service.getRxGuide(encounterId) };
  }

  // ── 담당환자 배정 ──

  @Get('assignments/my')
  @Roles(UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: '내 담당 환자 목록' })
  async getMyAssignments(@CurrentUser('id') nurseId: string) {
    return { data: await this.service.getMyAssignments(nurseId) };
  }

  @Get('assignments/admission/:admissionId')
  @Roles(UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: '입원 건의 담당 간호사' })
  async getAssignmentsByAdmission(@Param('admissionId', ParseUUIDPipe) admissionId: string) {
    return { data: await this.service.getAssignmentsByAdmission(admissionId) };
  }

  @Post('assignments')
  @Roles(UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: '담당환자 배정' })
  async assignPatient(
    @Body() body: AssignNursePatientDto,
    @CurrentUser('id') assignedBy: string,
  ) {
    return { data: await this.service.assignPatient({ ...body, assignedBy }) };
  }

  @Post('assignments/take-over')
  @Roles(UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: '상번 인수 — 그 입원의 담당을 내가 넘겨받는다(다른 간호사 활성 배정은 같은 순간 해제)' })
  async takeOverAssignment(
    @Body() body: TakeOverAssignmentDto,
    @CurrentUser('id') nurseId: string,
  ) {
    return { data: await this.service.takeOverAssignment(nurseId, body.admissionId, body.shiftType) };
  }

  @Patch('assignments/:id/release')
  @Roles(UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: '담당환자 배정 해제' })
  async releaseAssignment(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.service.releaseAssignment(id) };
  }
}
