import { Controller, Get, Post, Body, Req, Headers, Query, UseGuards, UnauthorizedException } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { SignIntegrationService } from './sign-integration.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { IntegrationAuthService } from '../integration/integration-auth.service';
import { EnrollStaffBulkDto, RequestDocumentSignDto, SubmitSignRequestDto } from './dto/sign-integration-write.dto';

/** 인증 필요 — 직원 콘솔/서명 클라이언트용 */
@ApiTags('Sign Integration')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/v1/sign-integration')
export class SignIntegrationController {
  constructor(private readonly svc: SignIntegrationService) {}

  @Get('status')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '외부 서명서비스 연동 상태(모드·시크릿 슬롯 구성여부 — 값 미노출)' })
  async status() {
    return { data: await this.svc.status() };
  }

  @Get('mode')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: '서명 모드(FE 배선용) — SIMULATION|EXTERNAL' })
  async mode() {
    return { data: { mode: await this.svc.getMode() } };
  }

  @Get('staff-token')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: '의료진 서명 JWT(RS256) 발급 — 신원 바인딩. aud=sign(기본)|pacs(SSO)' })
  async staffToken(@CurrentUser('id') userId?: string, @Query('aud') aud?: string) {
    return { data: await this.svc.issueStaffToken(userId, aud) };
  }

  @Get('edu-sso-token')
  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE, UserRole.PHARMACIST, UserRole.LAB_TECH, UserRole.CRM_MANAGER, UserRole.CRM_STAFF, UserRole.EXECUTIVE)
  @ApiOperation({ summary: '사내교육 SSO 토큰(aud=edu·전 직원) — edu가 공개 JWKS로 검증' })
  async eduSsoToken(@CurrentUser('id') userId?: string) {
    return { data: await this.svc.issueStaffToken(userId, 'edu') };
  }

  @Post('enroll-staff')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: '#2 본인 sign 인증서 enroll(1회) — serialNumber 영속·재사용(staff-token·PACS SSO)' })
  async enrollStaff(@CurrentUser('id') userId: string) {
    return { data: await this.svc.ensureStaffCert(userId) };
  }

  @Post('enroll-portal-patients')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '포털 계정 환자 일괄 sign enroll(테스트/셋업) — 미발급자만' })
  async enrollPortalPatients() {
    return { data: await this.svc.enrollPortalPatients() };
  }

  @Post('enroll-staff-bulk')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '활성 의료진 일괄 sign enroll(미발급자만) — 기본 DOCTOR. roles 로 확장 가능' })
  async enrollStaffBulk(@Body() body?: EnrollStaffBulkDto) {
    return { data: await this.svc.enrollAllStaff(body?.roles?.length ? body.roles : undefined) };
  }

  @Post('rotate-key')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '서명 키 무중단 회전(Phase 2) — 새 키 발급 + 직전 키 JWKS 병행 게시' })
  async rotateKey() {
    return { data: await this.svc.rotateSigningKey() };
  }

  @Post('drop-prev-key')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '회전 윈도우 종료 — 직전 키 JWKS 제거(구 staff-token 10분 만료 후)' })
  async dropPrevKey() {
    return { data: await this.svc.dropPreviousSigningKey() };
  }

  @Post('submit')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: 'EXTERNAL 서명요청 제출(P1·게이트) — 병행(DIRECT/PORTAL)·PDF바이트해시·externalSignerRef=sub·CI재사용' })
  async submit(
    @CurrentUser('id') userId: string,
    @Body() body: SubmitSignRequestDto,
  ) {
    // externalSignerRef=sub = 요청자 본인(의료진). PORTAL(B)은 환자 deep-link+보유 CI 재사용. requiredIdentityLevel은 종류별 자동 매핑.
    return { data: await this.svc.submitSignRequest({
      issueNo: body.issueNo, signerUserId: userId, consentFormId: body.consentFormId,
      documentType: body.documentType, channel: body.channel, patientId: body.patientId,
      consentType: body.consentType, inPerson: body.inPerson,
    }) };
  }

  @Post('request-sign')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: '제네릭 외부서명 배선 — 발급+서명요청 일괄(문서타입 무관·동의서=계약서)' })
  async requestSign(
    @CurrentUser('id') userId: string,
    @Body() body: RequestDocumentSignDto,
  ) {
    return { data: await this.svc.requestDocumentSign({
      signerUserId: userId, issueNo: body.issueNo, documentType: body.documentType, sourceId: body.sourceId,
      snapshot: body.snapshot, consentFormId: body.consentFormId, channel: body.channel,
      patientId: body.patientId, consentType: body.consentType, inPerson: body.inPerson,
    }) };
  }
}

/** 공개 — sign 서비스가 호출(JWKS 조회·Webhook 수신). 인증 가드 없음(JWKS 공개·Webhook은 HMAC). */
@ApiTags('Sign Integration (Public)')
@SkipThrottle()
@Controller('api/v1/sign-integration')
export class SignPublicController {
  constructor(private readonly svc: SignIntegrationService, private readonly integrationAuth: IntegrationAuthService) {}

  // e-sign #6 — ERP 주도 의료계약 서명 발의(키 인증·X-Integration-Key=erp.signOriginationKey). JWT 아님(서버↔서버).
  // ERP가 계약 생성 후 호출 → HIS 발급(IssuedDocument)·sign 제출·signatureRequestId 바인딩. 완료 시 sign.completed(erpContractId) 자동.
  @Post('erp/request-sign')
  @ApiOperation({ summary: 'ERP 의료계약 서명 발의(키 인증) — documentType=ERP_*·sourceId=계약 PK·snapshot(HIS 렌더)' })
  async erpRequestSign(
    @Headers('x-integration-key') key: string,
    @Body() body: { sourceId: string | number; documentType?: string; snapshot?: Record<string, unknown>; channel?: 'DIRECT' | 'PORTAL'; signers?: unknown[] },
  ) {
    await this.integrationAuth.assertSignOriginationKey(key);
    return { data: await this.svc.originateErpContractSign({
      sourceId: body?.sourceId, documentType: body?.documentType, snapshot: body?.snapshot, channel: body?.channel, signers: body?.signers,
    }) };
  }

  @Get('jwks')
  @ApiOperation({ summary: 'JWKS 공개 — sign이 HIS 발급 의료진 JWT 검증' })
  async jwks() {
    return this.svc.jwks(); // JWKS 표준 형식(래핑 없이 {keys:[...]})
  }

  @Post('webhook')
  @ApiOperation({ summary: 'sign→HIS 서명 이벤트 수신(HMAC 검증·멱등·ConsentForm 반영)' })
  async webhook(
    @Req() req: { rawBody?: Buffer },
    @Headers('x-sign-signature') signature: string,
    @Body() body: Record<string, unknown>,
  ) {
    const ok = await this.svc.verifyWebhook(req.rawBody, signature);
    // 🔴 **거부는 4xx 로 말한다.** 종전에는 `{ error: ... }` 를 그냥 반환해 NestJS 가 POST 기본값
    //    **201** 로 내보냈고, sign 은 2xx 를 받아 `SENT` 로 처리했다 — 시크릿이 어긋나도 상대 쪽
    //    DEAD 로 드러나지 않아 재시도·경보가 한 번도 돌지 않는다(2026-09-14 외부 실호출로 재현:
    //    위조 HMAC 이 반영되지는 않았으나 응답은 201 이었다). 미구성(401 SIGN_WEBHOOK_SECRET_MISSING)과
    //    같은 층위로 맞춘다.
    if (!ok) throw new UnauthorizedException({ error: 'INVALID_SIGNATURE', message: 'HMAC 검증 실패' });
    return { data: await this.svc.handleWebhook(body) };
  }
}
