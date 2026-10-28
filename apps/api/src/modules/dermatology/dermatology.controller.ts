import { Controller, Get, Post, Patch, Param, Body, UseGuards, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { DermatologyService } from './dermatology.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import {
  CreateLesionDto, UpdateLesionDto, CreateTreatmentDto,
  CreateBodyMapDto, SubmitPathologyDto, ReceivePathologyResultDto,
} from './dto/dermatology.dto';
import { specialtyPatientResponse } from '../../common/specialty-board';

@ApiTags('Dermatology (피부과)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.DOCTOR, UserRole.ADMIN)
@Controller('api/v1/dermatology')
export class DermatologyController {
  constructor(private readonly service: DermatologyService) {}

  @Get('patients')
  @ApiOperation({ summary: '피부과 환자 목록' })
  async getPatients() {
    // 최근 기록 순 상한 — 전체 수·잘림은 meta(2026-10-10)
    return specialtyPatientResponse(await this.service.getPatients());
  }

  @Post('lesions')
  @ApiOperation({ summary: '병변 기록' })
  async createLesion(
    @Body() dto: CreateLesionDto,
    @CurrentUser('id') userId: string,
  ) {
    return { data: await this.service.createLesion({ ...dto, recordedBy: userId }) };
  }

  @Get('lesions/:patientId')
  @ApiOperation({ summary: '환자 병변 목록' })
  async getLesions(@Param('patientId', ParseUUIDPipe) patientId: string) {
    return { data: await this.service.getLesions(patientId) };
  }

  /**
   * 🔴 종전 경로는 `lesions/:id` 였다 — 바로 위 `lesions/:patientId` 와 **세그먼트 모양이 같아**
   *    NestJS 가 `GET /lesions/<uuid>` 를 전부 먼저 선언된 쪽으로 보냈다(환자 UUID·병변 UUID 는
   *    구분할 수 없다). 이 핸들러는 개통 이래 **한 번도 실행된 적이 없다.**
   *    같은 모양으로는 공존이 불가능하므로 세그먼트를 하나 늘려 분리한다.
   *    (현재 이 EP 를 부르는 화면은 없다 — 라우트 도달성만 회복시킨 것이다.)
   */
  @Get('lesions/detail/:id')
  @ApiOperation({ summary: '병변 상세' })
  async getLesionDetail(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.service.getLesionDetail(id) };
  }

  @Patch('lesions/:id')
  @ApiOperation({ summary: '병변 업데이트 (경과)' })
  async updateLesion(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateLesionDto,
  ) {
    return { data: await this.service.updateLesion(id, dto) };
  }

  @Post('treatments')
  @ApiOperation({ summary: '시술 기록' })
  async createTreatment(
    @Body() dto: CreateTreatmentDto,
    @CurrentUser('id') userId: string,
  ) {
    return { data: await this.service.createTreatment({ ...dto, treatedBy: userId }) };
  }

  @Get('treatments/:patientId')
  @ApiOperation({ summary: '시술 이력' })
  async getTreatments(@Param('patientId', ParseUUIDPipe) patientId: string) {
    return { data: await this.service.getTreatments(patientId) };
  }

  @Post('body-map/:patientId')
  @ApiOperation({ summary: '전신 바디맵 기록' })
  async createBodyMap(
    @Param('patientId', ParseUUIDPipe) patientId: string,
    @Body() dto: CreateBodyMapDto,
    @CurrentUser('id') userId: string,
  ) {
    return { data: await this.service.createBodyMap(patientId, { ...dto, recordedBy: userId }) };
  }

  @Get('body-map/:patientId')
  @ApiOperation({ summary: '바디맵 조회' })
  async getBodyMap(@Param('patientId', ParseUUIDPipe) patientId: string) {
    return { data: await this.service.getBodyMap(patientId) };
  }

  @Get('today')
  @ApiOperation({ summary: '오늘 피부과 일정' })
  async getToday() {
    return { data: await this.service.getToday() };
  }

  @Get('stats')
  @ApiOperation({ summary: '통계' })
  async getStats() {
    return { data: await this.service.getStats() };
  }

  /* ───── Pathology Integration (Phase 2) ───── */

  @Post('lesions/:id/pathology')
  @ApiOperation({ summary: '병리검사 의뢰' })
  async submitPathology(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SubmitPathologyDto,
    @CurrentUser('id') userId: string,
  ) {
    return { data: await this.service.submitPathology(id, { ...dto, requestedBy: userId }) };
  }

  @Patch('lesions/:id/pathology-result')
  @ApiOperation({ summary: '병리검사 결과 수신' })
  async receivePathologyResult(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReceivePathologyResultDto,
  ) {
    return { data: await this.service.receivePathologyResult(id, dto) };
  }

  @Get('pathology/:patientId')
  @ApiOperation({ summary: '환자 병리검사 이력' })
  async getPathologyHistory(@Param('patientId', ParseUUIDPipe) patientId: string) {
    return { data: await this.service.getPathologyHistory(patientId) };
  }
}
