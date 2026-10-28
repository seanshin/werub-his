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
import { MdtService } from './mdt.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import {
  AddMdtAttendeeDto, AddMdtCaseDto, CreateMdtConferenceDto, UpdateMdtAttendeeDto, UpdateMdtCaseDto, UpdateMdtConferenceDto,
} from './dto/mdt-write.dto';

@ApiTags('MDT Conference')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
/**
 * 🔴 (2026-09-16 D4) 다학제 회의 **읽기 3EP 가 무역할**이었다(회의 목록·상세·환자별 이력) —
 *    증례·요약·참석자 같은 환자 임상 논의가 인증된 전 직원에게 열려 있었다.
 *    화면(`/mdt`) nav 역할(ADMIN·DOCTOR)을 클래스 기본값으로 둔다. 참석자 갱신 등 NURSE 허용 쓰기는 핸들러가 덮는다.
 */
@Roles(UserRole.ADMIN, UserRole.DOCTOR)
@Controller('api/v1/mdt')
export class MdtController {
  constructor(private readonly mdtService: MdtService) {}

  /* ─── Conferences ─── */

  @Get('conferences')
  @ApiOperation({ summary: 'MDT 컨퍼런스 목록' })
  async findAll(
    @Query('dept') dept?: string,
    @Query('status') status?: string,
  ) {
    return { data: await this.mdtService.findAll(dept, status) };
  }

  @Post('conferences')
  @Roles(UserRole.DOCTOR, UserRole.ADMIN)
  @ApiOperation({ summary: 'MDT 컨퍼런스 생성' })
  async create(
    @Body() body: CreateMdtConferenceDto,
    @CurrentUser('id') userId: string,
  ) {
    return { data: await this.mdtService.create({ ...body }, userId) };
  }

  @Get('conferences/:id')
  @ApiOperation({ summary: 'MDT 컨퍼런스 상세' })
  async findOne(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.mdtService.findOne(id) };
  }

  @Patch('conferences/:id')
  @Roles(UserRole.DOCTOR, UserRole.ADMIN)
  @ApiOperation({ summary: 'MDT 컨퍼런스 수정' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateMdtConferenceDto,
  ) {
    return { data: await this.mdtService.update(id, { ...body }) };
  }

  @Post('conferences/:id/start')
  @Roles(UserRole.DOCTOR, UserRole.ADMIN)
  @ApiOperation({ summary: 'MDT 컨퍼런스 시작' })
  async start(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.mdtService.start(id) };
  }

  @Post('conferences/:id/complete')
  @Roles(UserRole.DOCTOR, UserRole.ADMIN)
  @ApiOperation({ summary: 'MDT 컨퍼런스 완료' })
  async complete(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.mdtService.complete(id) };
  }

  @Post('conferences/:id/generate-minutes')
  @Roles(UserRole.DOCTOR, UserRole.ADMIN)
  @ApiOperation({ summary: 'MDT 회의록 자동생성(참석자·증례·결정 구조화)' })
  async generateMinutes(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.mdtService.generateMinutes(id) };
  }

  /* ─── Cases ─── */

  @Post('conferences/:id/cases')
  @Roles(UserRole.DOCTOR, UserRole.ADMIN)
  @ApiOperation({ summary: 'MDT 케이스 추가' })
  async addCase(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: AddMdtCaseDto,
    @CurrentUser('id') userId: string,
  ) {
    // 발표자 미지정 시 등록자를 발표자로 — 화면에 발표자 칸이 없어 저장이 전부 실패하던 것 봉합
    return { data: await this.mdtService.addCase(id, { ...body }, userId) };
  }

  @Patch('cases/:id')
  @Roles(UserRole.DOCTOR, UserRole.ADMIN)
  @ApiOperation({ summary: 'MDT 케이스 수정 (결정 기록)' })
  async updateCase(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateMdtCaseDto,
  ) {
    return { data: await this.mdtService.updateCase(id, { ...body }) };
  }

  @Delete('cases/:id')
  @Roles(UserRole.DOCTOR, UserRole.ADMIN)
  @ApiOperation({ summary: 'MDT 케이스 삭제' })
  async deleteCase(@Param('id', ParseUUIDPipe) id: string) {
    await this.mdtService.deleteCase(id);
    return { data: { success: true } };
  }

  /**
   * 🔴 초안≠확정 — 이 EP 는 **저장하지 않는다**. `{ data: { draft, source, reason, model, proposalId } }` 만
   *    돌려주고 정본 `clinicalSummary` 는 사람이 `PATCH /api/v1/mdt/cases/:id` 로 검토·수정 후 저장한다.
   *    `proposalId` 는 제안 원장(AiProposal) id 다 — 화면이 노출(presented)·결정(수용/수정/거부)을 그 id 로 보고한다.
   */
  @Post('cases/:id/auto-summary')
  @Roles(UserRole.DOCTOR, UserRole.ADMIN)
  @ApiOperation({ summary: 'AI 임상 요약 초안 생성(저장 안 함 · 3상태 AI/UNAVAILABLE · 제안 원장 기록)' })
  async autoSummary(@Param('id', ParseUUIDPipe) id: string, @CurrentUser('id') userId: string) {
    // 누가 초안을 불렀는지는 제안 원장의 `createdBy` 로 남는다(검토시간 지표가 사람을 지어내지 않게)
    return { data: await this.mdtService.autoSummary(id, userId) };
  }

  /* ─── Attendees ─── */

  @Post('conferences/:id/attendees')
  @Roles(UserRole.DOCTOR, UserRole.ADMIN)
  @ApiOperation({ summary: 'MDT 참석자 추가' })
  async addAttendee(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: AddMdtAttendeeDto,
  ) {
    return { data: await this.mdtService.addAttendee(id, { ...body }) };
  }

  @Patch('attendees/:id')
  @Roles(UserRole.DOCTOR, UserRole.ADMIN, UserRole.NURSE)
  @ApiOperation({ summary: 'MDT 참석 여부 수정' })
  async updateAttendee(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateMdtAttendeeDto,
  ) {
    return { data: await this.mdtService.updateAttendee(id, { ...body }) };
  }

  /* ─── Patient History & Stats ─── */

  @Get('patient/:patientId')
  @ApiOperation({ summary: '환자 MDT 이력' })
  async getPatientHistory(@Param('patientId', ParseUUIDPipe) patientId: string) {
    return { data: await this.mdtService.getPatientHistory(patientId) };
  }

  @Get('stats')
  // 🔴 /mdt 화면(의사 nav)이 로드 시 부르는데 ADMIN 단독이라 의사에게 상시 403 이었다(2026-08-30 실측)
  @Roles(UserRole.ADMIN, UserRole.DOCTOR)
  @ApiOperation({ summary: 'MDT 통계' })
  async getStats(@Query('dept') dept?: string) {
    return { data: await this.mdtService.getStats(dept) };
  }
}
