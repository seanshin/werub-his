import { Controller, Get, Post, Put, Param, Body, Res, Query, UseGuards, ParseUUIDPipe } from '@nestjs/common';
import { Response } from 'express';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { RegistrationConsentService } from './registration-consent.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CreateRegistrationConsentsDto, HIS_CONSENT_SIGN_METHOD, UpdateRegistrationConsentDto } from './dto/registration-consent-write.dto';

@ApiTags('Registration Consent')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/v1')
export class RegistrationConsentController {
  constructor(private readonly service: RegistrationConsentService) {}

  // ── HIS 원무과 API ──

  @Get('consent-types')
  @Roles(UserRole.ADMIN, UserRole.NURSE, UserRole.DOCTOR, UserRole.RECEPTIONIST)
  @ApiOperation({ summary: '동의서 10종 메타 정보' })
  async getConsentTypes() {
    return { data: this.service.getConsentTypes() };
  }

  @Get('patients/:id/registration-consents')
  @Roles(UserRole.ADMIN, UserRole.NURSE, UserRole.DOCTOR, UserRole.RECEPTIONIST)
  @ApiOperation({ summary: '환자 동의 현황 (10종 상태)' })
  async getConsents(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.service.getConsents(id) };
  }

  @Post('patients/:id/registration-consents')
  @Roles(UserRole.ADMIN, UserRole.NURSE, UserRole.RECEPTIONIST)
  @ApiOperation({ summary: '동의서 일괄 등록 (접수 시)' })
  async createBulk(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: CreateRegistrationConsentsDto,
    @CurrentUser('id') userId: string,
  ) {
    // 🔴 (2026-09-15 N4) 서명 방식은 서버가 정한다 — 창구 경로는 HIS
    return { data: await this.service.createBulk(id, {
      consents: body.consents.map((c) => ({ ...c, signMethod: HIS_CONSENT_SIGN_METHOD })),
    }, userId) };
  }

  @Put('patients/:id/registration-consents/:type')
  @Roles(UserRole.ADMIN, UserRole.NURSE, UserRole.DOCTOR, UserRole.RECEPTIONIST)
  @ApiOperation({ summary: '개별 동의 업데이트' })
  async updateConsent(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('type') type: string,
    @Body() body: UpdateRegistrationConsentDto,
  ) {
    // 🔴 (2026-09-15 N4) 종전엔 본문이 비면 서비스 기본값 PORTAL(환자 포털 서명)로 적혔다 — 창구 경로는 HIS
    return { data: await this.service.updateConsent(id, type, {
      agreed: body.agreed, signedBy: body.signedBy, signatureData: body.signatureData, signMethod: HIS_CONSENT_SIGN_METHOD,
    }) };
  }

  @Post('patients/:id/registration-consents/send-portal')
  @Roles(UserRole.ADMIN, UserRole.NURSE, UserRole.RECEPTIONIST)
  @ApiOperation({ summary: '포털 동의 요청 알림 발송' })
  async sendPortalRequest(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.service.sendPortalRequest(id) };
  }

  @Get('patients/:id/registration-consents/print')
  @Roles(UserRole.ADMIN, UserRole.NURSE, UserRole.DOCTOR, UserRole.RECEPTIONIST)
  @ApiOperation({ summary: '동의서 출력용 HTML' })
  async print(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('types') types: string,
    @Res() res: Response,
  ) {
    const patient = await this.service['prisma'].patient.findUnique({
      where: { id },
      select: { familyName: true, givenName: true },
    });
    const name = patient ? `${patient.familyName}${patient.givenName}` : '';
    const typeList = types ? types.split(',') : undefined;
    const html = this.service.generatePrintHtml(name, typeList);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  }

  @Post('patients/:id/registration-consents/check-complete')
  @Roles(UserRole.ADMIN, UserRole.NURSE, UserRole.RECEPTIONIST)
  @ApiOperation({ summary: '필수 동의 완료 확인' })
  async checkComplete(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.service.checkComplete(id) };
  }

  // ── Portal API ──
  // 포털 동의서 엔드포인트(get/sign/revoke)는 portal.controller(PortalOrPatientGuard)로 이전됨.
  // staff JwtAuthGuard 하에서는 portal 토큰의 patientId 해석 불가(User 조회 실패→401)하여
  // 동일 경로 중복 라우트가 staff 핸들러로 매칭되면 일괄/개별 서명이 실패하던 버그를 제거.
}
