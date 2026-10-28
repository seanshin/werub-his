import { Body, Controller, Get, Headers, Param, Patch, Post, Query, UseGuards, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiHeader } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { UserRole } from '@prisma/client';
import { PatientFlowService } from './patient-flow.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RegisterStationDto, IssueTokenDto, CheckinDto, SetStationActiveDto } from './dto/patient-flow.dto';

@ApiTags('Patient Flow (QR 동선)')
@Controller('api/v1')
export class PatientFlowController {
  constructor(private readonly svc: PatientFlowService) {}

  // ── 체크인(스테이션 — JWT 아닌 X-Station-Key 인증) ──
  @Post('patient-flow/checkin')
  @SkipThrottle()
  @ApiHeader({ name: 'X-Station-Key' })
  @ApiOperation({ summary: '장소 스테이션 스캔 체크인(환자 QR) → 동선 기록' })
  async checkin(@Headers('x-station-key') key: string, @Body() dto: CheckinDto) {
    return { data: await this.svc.checkin(key, dto.plt) };
  }

  // ── 환자 위치 QR 발급(직원) ──
  @Post('patient-flow/qr')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: '환자 위치 QR(plt) 발급 — 당일/입원 모드, 멀티포맷, 동의 수집' })
  async issue(@CurrentUser() user: { id: string; familyName?: string; givenName?: string }, @Body() dto: IssueTokenDto) {
    const by = `${user.familyName ?? ''}${user.givenName ?? ''}`.trim() || user.id;
    return { data: await this.svc.issueToken(dto.patientId, dto.mode, dto.issuedVia, dto.consent, by) };
  }

  @Get('patient-flow/zone-stats')
  @UseGuards(JwtAuthGuard, RolesGuard)
  /**
   * 🔴 검진 데스크(CHECKUP)는 nav 에 '동선 모니터'가 있는데 여기서 403 이었다(운영 실측).
   *    구역별 인원·평균 체류시간은 **집계**라 환자 식별정보가 없다 — 수진자 동선 파악은 검진 원무 업무다.
   */
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN, UserRole.CHECKUP)
  @ApiBearerAuth()
  @ApiOperation({ summary: '구역별 현재 인원·평균 체류시간(동선 모니터)' })
  async zoneStats() {
    return { data: await this.svc.zoneStats() };
  }

  @Get('patient-flow/patient/:id/timeline')
  @UseGuards(JwtAuthGuard, RolesGuard)
  // 동선 타임라인은 구역·체류시간(위치)이고 임상 내용이 아니다 — 같은 화면의 상세라 함께 연다
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN, UserRole.CHECKUP)
  @ApiBearerAuth()
  @ApiOperation({ summary: '환자 동선 타임라인(구역·체류시간)' })
  async timeline(@Param('id', ParseUUIDPipe) id: string, @Query('limit') limit?: string) {
    return { data: await this.svc.patientTimeline(id, limit ? Number(limit) : undefined) };
  }

  @Get('patient-flow/zones')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: '스테이션 등록용 구역(SpaceNode) 목록' })
  async zones() {
    return { data: await this.svc.zones() };
  }

  // ── 스테이션 관리(ADMIN) ──
  @Post('admin/location-stations')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: '장소 스테이션(기기) 위치 등록 — 키 1회 발급' })
  async register(@Body() dto: RegisterStationDto) {
    return { data: await this.svc.registerStation(dto.zoneId, dto.label, dto.deviceType) };
  }

  @Get('admin/location-stations')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: '스테이션 목록·상태' })
  async list() {
    return { data: await this.svc.listStations() };
  }

  @Patch('admin/location-stations/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: '스테이션 활성/비활성' })
  async setActive(@Param('id', ParseUUIDPipe) id: string, @Body() body: SetStationActiveDto) {
    return { data: await this.svc.setStationActive(id, body.isActive) };
  }
}
