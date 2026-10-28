import { Controller, Get, Post, Patch, Param, Body, Query, UseGuards, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { ObGynService } from './obgyn.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CreateObGynExamDto } from './dto/obgyn.dto';
import { CreateDeliveryDto, UpdateDeliveryDto, CreateNewbornDto, AddLaborProgressDto, VerifyNewbornMatchDto } from './dto/delivery.dto';
import { specialtyPatientResponse } from '../../common/specialty-board';

@ApiTags('ObGyn (산부인과)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.DOCTOR, UserRole.ADMIN)
@Controller('api/v1/obgyn')
export class ObGynController {
  constructor(private readonly service: ObGynService) {}

  @Get('patients')
  @ApiOperation({ summary: '산부인과 환자 목록' })
  async getPatients() {
    // 최근 기록 순 상한 — 전체 수·잘림은 meta(2026-10-10)
    return specialtyPatientResponse(await this.service.getPatients());
  }

  @Get('exams/:patientId')
  @ApiOperation({ summary: '환자 검사 이력' })
  async getExams(
    @Param('patientId', ParseUUIDPipe) patientId: string,
    @Query('examType') examType?: string,
  ) {
    return { data: await this.service.getExams(patientId, examType) };
  }

  @Post('exams')
  @ApiOperation({ summary: '검사 기록 생성' })
  async createExam(
    @Body() body: CreateObGynExamDto,
    @CurrentUser('id') userId: string,
  ) {
    return { data: await this.service.createExam({ ...body, examinedBy: userId }) };
  }

  @Get('today')
  @ApiOperation({ summary: '오늘 산부인과 일정' })
  async getToday() {
    return { data: await this.service.getToday() };
  }

  @Get('stats')
  @ApiOperation({ summary: '산부인과 통계' })
  async getStats() {
    return { data: await this.service.getStats() };
  }

  // ── 분만(Labor & Delivery) ──

  @Get('deliveries/board')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: 'L&D 보드(진행 중 분만·오늘 분만)' })
  async getBoard() {
    return { data: await this.service.getBoard() };
  }

  @Get('deliveries/:id')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: '분만 상세(신생아·파토그램)' })
  async getDelivery(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.service.getDeliveryDetail(id) };
  }

  @Post('deliveries')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: '분만 개시(진통 입원)' })
  async createDelivery(@Body() dto: CreateDeliveryDto) {
    return { data: await this.service.createDelivery(dto) };
  }

  @Patch('deliveries/:id')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: '분만 갱신(완료·산욕)' })
  async updateDelivery(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateDeliveryDto, @CurrentUser('id') userId: string) {
    return { data: await this.service.updateDelivery(id, dto, userId) };
  }

  @Post('deliveries/:id/newborn')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: '신생아 기록(Apgar·NICU)' })
  async addNewborn(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CreateNewbornDto) {
    return { data: await this.service.addNewborn(id, dto) };
  }

  /**
   * 🔴 권한이 뒤집혀 있었다 — 클래스 `@Roles(DOCTOR, ADMIN)` 만 걸려 있어 **수유·투약 전 대조를
   *    실제로 수행하는 간호사가 이 EP 를 부를 수 없었다.** 형제 핸들러는 전부 NURSE 를 명시한다.
   *    (호출부가 0이라 아무도 403 을 만난 적이 없어 드러나지 않았다 — 2026-08-26 F3)
   */
  @Post('newborns/:id/verify-match')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: '모아 식별밴드 대조(수유·투약 전 이중 확인)' })
  async verifyMatch(@Param('id', ParseUUIDPipe) id: string, @Body() dto: VerifyNewbornMatchDto, @CurrentUser('id') userId: string) {
    // 확인자는 로그인 사용자다 — 원장에 누가 대조했는지 남는다(본문이 정하지 않는다)
    return { data: await this.service.verifyMotherBabyMatch(id, dto.motherBand, dto.babyBand, userId) };
  }

  @Post('deliveries/:id/progress')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: '분만 진행 기록(파토그램)' })
  async addProgress(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AddLaborProgressDto, @CurrentUser('id') userId: string) {
    return { data: await this.service.addLaborProgress(id, dto, userId) };
  }
}
