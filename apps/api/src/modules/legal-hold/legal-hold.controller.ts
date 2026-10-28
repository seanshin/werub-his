import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { LegalHoldService } from './legal-hold.service';
import { RequestLegalHoldReleaseDto, SetLegalHoldDto } from './dto/legal-hold.dto';

/**
 * 법적 보존명령 — 상용 릴리즈 T10-7.
 *
 * 권한: 관리자 + 의무기록사(기록 보존·발급 담당 — 임상 작성 권한은 없다). 최소로 연다.
 * 🔴 감사: 변이는 전역 인터셉터가 **경로의 마지막 UUID** 를 resourceId 로 남긴다 — 그래서 변이 경로는 전부
 *    `…/patients/:patientId` 로 **환자로 끝나게** 설계했다(환자별 접근 이력에 귀속). 서비스는 경로의 환자와
 *    보존명령의 환자가 다르면 거부한다(엉뚱한 환자 이력에 기록이 남지 않게).
 */
@ApiTags('legal-hold')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.MEDICAL_RECORDS)
@Controller('api/v1/legal-holds')
export class LegalHoldController {
  constructor(private readonly legalHold: LegalHoldService) {}

  @Get()
  @ApiOperation({ summary: '보존명령 목록(활성·해제 이력) — 활성 여부는 해제 기록으로 파생' })
  async list(@Query('patientId') patientId?: string, @Query('activeOnly') activeOnly?: string) {
    return { data: await this.legalHold.list({ patientId: patientId || undefined, activeOnly: activeOnly === 'true' }) };
  }

  @Get('approvals')
  @ApiOperation({ summary: '대기 중 보존명령 해제 승인 요청' })
  async approvals() {
    return { data: await this.legalHold.pendingReleases() };
  }

  @Post('patients/:patientId')
  @ApiOperation({ summary: '보존명령 설정(1인) — 파기·익명화·아카이브 이동을 막는다' })
  async set(
    @Param('patientId', ParseUUIDPipe) patientId: string,
    @Body() body: SetLegalHoldDto,
    @CurrentUser('id') userId: string,
  ) {
    return { data: await this.legalHold.setHold({ patientId, ...body }, userId) };
  }

  @Post(':holdId/patients/:patientId/release-request')
  @ApiOperation({ summary: '보존명령 해제 요청(4-eyes 대기 생성 · 사유 필수)' })
  async requestRelease(
    @Param('holdId', ParseUUIDPipe) holdId: string,
    @Param('patientId', ParseUUIDPipe) patientId: string,
    @Body() body: RequestLegalHoldReleaseDto,
    @CurrentUser('id') userId: string,
  ) {
    return { data: await this.legalHold.requestRelease(holdId, patientId, userId, body.reason) };
  }

  @Post('approvals/:approvalId/patients/:patientId/approve')
  @ApiOperation({ summary: '보존명령 해제 승인 — 요청자·설정자와 다른 사람만' })
  async approve(
    @Param('approvalId', ParseUUIDPipe) approvalId: string,
    @Param('patientId', ParseUUIDPipe) patientId: string,
    @CurrentUser('id') userId: string,
  ) {
    return { data: await this.legalHold.approveRelease(approvalId, patientId, userId) };
  }

  @Post(':holdId/patients/:patientId/release')
  @ApiOperation({ summary: '보존명령 해제 실행 — 승인을 소비한 뒤에만 해제 기록 생성' })
  async release(
    @Param('holdId', ParseUUIDPipe) holdId: string,
    @Param('patientId', ParseUUIDPipe) patientId: string,
    @CurrentUser('id') userId: string,
  ) {
    return { data: await this.legalHold.executeRelease(holdId, patientId, userId) };
  }
}
