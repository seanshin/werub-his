import { Controller, Post, Get, Body, Headers, Param, Query, Req, Res, UseGuards, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { SmartAuthService } from './smart-auth.service';
import { AuditService } from '../audit/audit.service';
import { NoAudit } from '../audit/no-audit.decorator';
import { SmartLaunchDto } from './dto/smart-launch.dto';
import { OAuth2TokenDto } from './dto/oauth2-token.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { publicBaseUrl } from '../../common/util/public-url';
import { UserRole } from '@prisma/client';

@ApiTags('SMART-on-FHIR Auth')
@Controller()
export class SmartAuthController {
  constructor(
    private readonly smartAuthService: SmartAuthService,
    private readonly audit: AuditService,
  ) {}

  @Get('oauth2/authorize')
  @ApiOperation({ summary: 'SMART-on-FHIR 인가 (EHR Launch / Standalone Launch)' })
  async authorize(
    @Query('response_type') responseType: string,
    @Query('client_id') clientId: string,
    @Query('redirect_uri') redirectUri: string,
    @Query('scope') scope: string,
    @Query('state') state: string,
    @Query('aud') aud?: string,
    @Query('launch') launch?: string,
    @Query('code_challenge') codeChallenge?: string,
    @Query('code_challenge_method') codeChallengeMethod?: string,
    @Res() res?: Response,
  ) {
    if (responseType !== 'code') {
      throw new BadRequestException('response_type must be "code"');
    }
    if (!clientId || !redirectUri) {
      throw new BadRequestException('client_id and redirect_uri are required');
    }

    // 🔴 standalone launch(유효한 launch 문맥 없음)는 **사용자 인증 없이 코드를 발급하지 않는다**.
    //    종전엔 무인증 즉시 발급이라 토큰에 사용자 신원(fhirUser)이 없었고, "의료진 본인 권한 범위"
    //    전제도 성립하지 않았다. HIS 로그인·동의 화면으로 보내 본인 확인 후 발급한다.
    // 🔴 `await` 를 빠뜨리면 `!Promise` 가 **항상 false** 라 이 분기가 통째로 죽는다(무인증 발급).
    //    tsc 는 이것을 잡지 못한다 — 2026-09-21 Redis 이관 중 실제로 한 번 그렇게 됐다.
    if (!(await this.smartAuthService.hasLaunchContext(launch))) {
      const q = new URLSearchParams({
        client_id: clientId, redirect_uri: redirectUri, scope: scope ?? '', state: state ?? '',
        ...(codeChallenge ? { code_challenge: codeChallenge } : {}),
        ...(codeChallengeMethod ? { code_challenge_method: codeChallengeMethod } : {}),
      });
      return res!.redirect(302, `${publicBaseUrl()}/smart/authorize?${q.toString()}`);
    }

    // EHR launch — launch 토큰이 HIS 가 발급한 1회용 문맥(환자+의료진)이므로 그 자체가 사용자 바인딩
    const authCode = await this.smartAuthService.issueAuthorizationCode(clientId, redirectUri, scope, state, launch, codeChallenge, codeChallengeMethod);

    // redirect_uri로 리다이렉트
    const url = new URL(redirectUri);
    url.searchParams.set('code', authCode.code);
    url.searchParams.set('state', state ?? '');

    res!.redirect(302, url.toString());
  }

  @Post('oauth2/token')
  @ApiOperation({ summary: 'SMART-on-FHIR 토큰 발급 (Client Credentials / Authorization Code)' })
  async issueToken(
    @Body() body: OAuth2TokenDto,
    @Headers('authorization') authHeader?: string,
  ) {
    // Authorization Code Grant (PKCE code_verifier 전달)
    if (body.grant_type === 'authorization_code') {
      if (!body.code) throw new UnauthorizedException('code is required');
      return this.smartAuthService.exchangeAuthorizationCode(body.code, body.client_id, body.redirect_uri, body.code_verifier);
    }

    // Client Credentials Grant
    if (body.grant_type !== 'client_credentials') {
      throw new UnauthorizedException('Unsupported grant_type. Supported: client_credentials, authorization_code');
    }

    let clientId = body.client_id;
    let clientSecret = body.client_secret;

    // Basic Auth 지원
    if (authHeader?.startsWith('Basic ')) {
      const decoded = Buffer.from(authHeader.slice(6), 'base64').toString('utf-8');
      const [id, secret] = decoded.split(':');
      clientId = clientId ?? id;
      clientSecret = clientSecret ?? secret;
    }

    if (!clientId || !clientSecret) {
      throw new UnauthorizedException('client_id and client_secret are required');
    }

    return this.smartAuthService.issueToken(clientId, clientSecret, body.scope);
  }


  /**
   * standalone launch 동의 확정 — **로그인 의료진 본인**을 fhirUser 로 바인딩해 코드 발급.
   * 화면(/smart/authorize)이 호출하고, 응답의 redirectTo 로 앱에 돌려보낸다.
   */
  @Post('api/v1/smart/authorize/consent')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'SMART standalone launch 동의 확정(의료진 인증 필수)' })
  async authorizeConsent(
    @Body() body: { clientId: string; redirectUri: string; scope: string; state?: string; patientId?: string; codeChallenge?: string; codeChallengeMethod?: string },
    @CurrentUser('id') userId: string,
  ) {
    const { code } = await this.smartAuthService.issueAuthorizationCodeForUser(
      body.clientId, body.redirectUri, body.scope, userId,
      { patientId: body.patientId, codeChallenge: body.codeChallenge, codeChallengeMethod: body.codeChallengeMethod },
    );
    const url = new URL(body.redirectUri);
    url.searchParams.set('code', code);
    url.searchParams.set('state', body.state ?? '');
    return { data: { redirectTo: url.toString() } };
  }

  /** 동의 화면이 표시할 클라이언트 정보(이름·요청 스코프 검증) — 인증 필수 */
  @Get('api/v1/smart/authorize/client/:clientId')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '동의 화면용 클라이언트 정보' })
  async authorizeClientInfo(@Param('clientId') clientId: string) {
    return { data: await this.smartAuthService.clientInfoForConsent(clientId) };
  }

  /** 차트 런처가 띄울 앱 목록(환자 문맥 주면 동의 여부 포함) */
  @Get('api/v1/smart/launch-apps')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE)
  @ApiBearerAuth()
  @ApiOperation({ summary: '차트에서 실행 가능한 SMART 앱 목록' })
  async launchApps(@Query('patientId') patientId?: string) {
    return { data: await this.smartAuthService.listLaunchApps(patientId) };
  }

  /**
   * EHR launch 발급 — 차트에서 외부 SMART 앱을 환자·의료진 문맥으로 실행.
   * 변이가 아니라 **열람 문맥 발급**이므로 기본 변이 감사(CREATE) 대신 PHI READ 로 명시 기록한다.
   */
  @Post('api/v1/smart/launch')
  // PHI 문맥을 외부 앱에 넘기는 발급 — 임상 역할만(시계열 열람과 동일 기준). JwtAuthGuard 만으로는
  // 원무·행정 계정도 임의 환자 launch 를 만들 수 있었다(검토 보완 2026-07-30).
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE)
  @ApiBearerAuth()
  @NoAudit()
  @ApiOperation({ summary: 'SMART EHR launch URL 발급(환자+의료진 바인딩·5분·1회용)' })
  async launchApp(@Body() body: SmartLaunchDto, @CurrentUser('id') userId: string) {
    const out = await this.smartAuthService.buildEhrLaunch(body.clientId, body.patientId, userId);
    void this.audit
      .log({
        userId,
        action: 'READ',
        resourceType: 'SmartAppLaunch',
        resourceId: body.patientId,
        changes: { app: { old: null, new: out.appName } },
      })
      .catch(() => {});
    return { data: out };
  }

  @Get('.well-known/smart-jwks.json')
  @ApiOperation({ summary: 'SMART id_token 검증용 공개 JWKS (RS256·개인키 미노출)' })
  async smartJwks() {
    return this.smartAuthService.idTokenJwks();
  }

  @Get('.well-known/smart-configuration')
  @ApiOperation({ summary: 'SMART-on-FHIR Configuration' })
  getSmartConfiguration(@Req() req: Request) {
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    return this.smartAuthService.getSmartConfiguration(baseUrl);
  }
}
