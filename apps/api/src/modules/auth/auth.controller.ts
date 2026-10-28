import {
  Controller,
  Post,
  Get,
  Body,
  Res,
  Req,
  UseGuards,
  HttpCode,
  HttpStatus,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Response, Request } from 'express';
import { randomUUID } from 'node:crypto';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { mobileHomeFor } from './mobile/mobile-capabilities';
import { PermissionService } from './rbac/permission.service';
import { UserRole } from '@prisma/client';
import { ConfigRuntimeService } from '../config/config-runtime.service';
import { authContextFromRequest } from './auth-audit';

import { cookieSecure } from '../../common/release-security';
import { ChangePasswordDto } from './dto/change-password.dto';
import { PASSWORD_MAX_AGE_DAYS } from './password-policy';
@ApiTags('Auth')
@Controller('api/v1/auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(
    private readonly authService: AuthService,
    private readonly configRuntime: ConfigRuntimeService,
    private readonly permissions: PermissionService,
  ) {}

  @Post('login')
  @Throttle({ auth: { ttl: 60000, limit: 30 } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '로그인 (JWT 발급)' })
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    // 접속기록(의료법 §23④) — 접속지 IP·단말을 서비스로 넘긴다(기록 자체는 auth 모듈이 남긴다)
    const result = await this.authService.login(dto, authContextFromRequest(req, 'PASSWORD'));

    // Set refresh token as httpOnly cookie
    res.cookie('refreshToken', result.refreshToken, {
      httpOnly: true,
      secure: cookieSecure(), // 🔴 T4-2 — REAL 은 항상 secure(NODE_ENV=development 로 평문 쿠키가 열리지 않는다)
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      path: '/api/v1/auth',
    });

    return {
      data: {
        accessToken: result.accessToken,
        expiresIn: result.expiresIn,
      },
    };
  }

  /**
   * ERP 접근 게이트 — 활성화 + (허용 역할 ∪ 개별 허용 사용자). 접근 권한 관리→외부 시스템 접근 설정.
   *
   * 🔴 두 핸드오프(쿠키·토큰)가 **같은 게이트**를 지난다.
   *    종전 token 방식은 화면이 버튼을 숨기는 것이 전부였고, 서버 게이트를 지나지 않았다.
   */
  private async assertErpAccess(user: { id: string; role: string }): Promise<void> {
    const enabled = await this.configRuntime.get('erp.enabled');
    if (enabled === false) throw new ForbiddenException('ERP 연동이 비활성화되어 있습니다.');
    const allowedRoles = (await this.configRuntime.get('erp.allowedRoles')) as string[] | null;
    const allowedUserIds = (await this.configRuntime.get('erp.allowedUserIds')) as string[] | null;
    const roleAllowed = Array.isArray(allowedRoles) ? allowedRoles.includes(user.role) : true;
    const userAllowed = Array.isArray(allowedUserIds) && allowedUserIds.includes(user.id);
    if (!roleAllowed && !userAllowed) throw new ForbiddenException('ERP 접근 권한이 없습니다.');
  }

  /**
   * ERP SSO 핸드오프 **토큰** 발급(방식 token — 다른 호스트에 ERP 가 있어 쿠키를 쓸 수 없는 설치).
   *
   * 🔴 종전 화면은 **메인 access 토큰(8시간)을 URL 쿼리**에 실어 보냈다.
   *    ① 8시간짜리 자격이 ERP 접근 로그·브라우저 기록에 남고 ② `aud`·`jti` 가 없어 ERP 의 audience 검증과
   *    재생 방지가 둘 다 동작하지 않으며 ③ **서버 게이트를 지나지 않아** 허용 역할 밖(NURSE)도 ERP 계정이 생겼다.
   *    이제 쿠키 방식과 같은 **전용 60초 토큰(aud=erp-sso · jti)** 을 같은 게이트 뒤에서 발급한다.
   */
  @Post('erp-sso-token')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'ERP SSO 핸드오프 단기 토큰 발급(aud=erp-sso · 60초)' })
  async erpSsoToken(@CurrentUser() user: { id: string; email: string; role: string }) {
    await this.assertErpAccess(user);
    const token = this.authService.issueErpSsoToken({ id: user.id, email: user.email, role: user.role });
    const handoffId = randomUUID().slice(0, 8);
    this.logger.log(`ERP SSO 토큰 발급 — handoff=${handoffId} user=${user.id} role=${user.role} aud=erp-sso ttlSec=60`);
    return { data: { token, expiresInSec: 60, handoffId } };
  }

  // ERP SSO(방식 C: 동일 호스트 쿠키) — 현재 HIS 토큰을 /erp 스코프 단기 httpOnly 쿠키로 발급.
  // ERP가 his_sso 쿠키를 읽어 검증·세션 발급. URL에 토큰 노출 없음.
  @Post('erp-sso')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'ERP SSO 핸드오프 쿠키 발급(/erp 스코프, 단기)' })
  async erpSso(@CurrentUser() user: { id: string; email: string; role: string }, @Res({ passthrough: true }) res: Response) {
    await this.assertErpAccess(user);
    // 전용 단기 SSO 토큰(aud:erp-sso + jti) — access 토큰 직접 노출 대신
    const token = this.authService.issueErpSsoToken({ id: user.id, email: user.email, role: user.role });
    const cookie = {
      httpOnly: true,
      secure: cookieSecure(), // 🔴 T4-2 — REAL 은 항상 secure(NODE_ENV=development 로 평문 쿠키가 열리지 않는다)
      sameSite: 'lax' as const,
      maxAge: 60 * 1000, // 60초 — 핸드오프 직후 ERP가 소비
      path: '/erp',
    };
    res.cookie('his_sso', token, cookie);
    /**
     * 🔴 **발급 사실을 서버에 남긴다**(2026-09-09 · ERP 요청 2).
     *    ERP 로그는 "랜딩 요청이 도착하지 않았다"까지만 말할 수 있어서,
     *    다음 재현 때 **"발급됐는데 전송되지 않았다"와 "발급 자체가 없었다"** 를 가를 수 없었다.
     *    이 한 줄이 그 갈림을 만든다.
     * 🔴 토큰 값은 남기지 않는다(쿠키 자체가 자격증명이다). 상관용 `handoffId` 만 응답에 실어
     *    브라우저/ERP 로그와 맞춰 볼 수 있게 한다.
     */
    const handoffId = randomUUID().slice(0, 8);
    this.logger.log(
      `ERP SSO 쿠키 발급 — handoff=${handoffId} user=${user.id} role=${user.role} ` +
        `cookie=his_sso path=${cookie.path} sameSite=${cookie.sameSite} secure=${cookie.secure} maxAgeSec=${cookie.maxAge / 1000}`,
    );
    return {
      data: { ok: true, handoffId },
      meta: {
        // 🔴 발급 사실과 쿠키 속성을 응답이 말한다 — 브라우저에서 Set-Cookie 를 못 읽는(httpOnly) 자리를 메운다
        cookie: { name: 'his_sso', path: cookie.path, sameSite: cookie.sameSite, secure: cookie.secure, maxAgeSec: cookie.maxAge / 1000 },
        note: '쿠키를 발급했습니다. 이 응답은 "발급했다"까지만 말합니다 — 브라우저가 실제로 저장·전송했는지는 ERP 랜딩 로그가 말합니다.',
      },
    };
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '토큰 갱신' })
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const refreshToken = req.cookies?.refreshToken;
    if (!refreshToken) {
      return res.status(HttpStatus.UNAUTHORIZED).json({
        error: { code: 'UNAUTHORIZED', message: 'No refresh token' },
      });
    }

    const result = await this.authService.refresh(refreshToken);

    res.cookie('refreshToken', result.refreshToken, {
      httpOnly: true,
      secure: cookieSecure(), // 🔴 T4-2 — REAL 은 항상 secure(NODE_ENV=development 로 평문 쿠키가 열리지 않는다)
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000,
      path: '/api/v1/auth',
    });

    return {
      data: {
        accessToken: result.accessToken,
        expiresIn: result.expiresIn,
      },
    };
  }

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth()
  @ApiOperation({ summary: '로그아웃 (토큰 무효화)' })
  async logout(
    @CurrentUser('id') userId: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    // refresh 쿠키의 sid 로 해당 기기 세션만 종료(다른 기기 로그인 유지)
    await this.authService.logout(userId, req.cookies?.refreshToken, authContextFromRequest(req));
    res.clearCookie('refreshToken', { path: '/api/v1/auth' });
    // 🔴 ERP 핸드오프 쿠키도 같이 지운다 — 로그아웃 뒤 남아 있던 핸드오프가
    //    다른 사용자의 브라우저에서 소비되면 **바뀐 사용자 대신 앞 사람 권한으로** ERP 세션이 열린다.
    //    🔴 이것으로 ERP **세션 자체**가 끝나지는 않는다(그 쿠키는 ERP 도메인의 것이다) — 그 연동은 ERP 몫이다.
    res.clearCookie('his_sso', { path: '/erp' });
  }

  @Post('change-password')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '비밀번호 변경' })
  async changePassword(
    @CurrentUser('id') userId: string,
    @Body() body: ChangePasswordDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.changePassword(userId, body.currentPassword, body.newPassword);
    res.clearCookie('refreshToken', { path: '/api/v1/auth' });
    return { data: result };
  }

  @Get('password-status')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '비밀번호 만료 확인' })
  async passwordStatus(@CurrentUser('id') userId: string) {
    const expired = await this.authService.isPasswordExpired(userId);
    return { data: { expired, maxAgeDays: PASSWORD_MAX_AGE_DAYS } };
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '현재 사용자 정보 (권한 목록 포함)' })
  async me(@CurrentUser() current: MeContext) {
    const userId = current.id;
    const profile = await this.authService.getProfile(userId);
    const roleKey = (profile as any)?.role as UserRole;
    // 🔴 코드 기본 매트릭스(ROLE_PERMISSIONS)를 그대로 내려주면 `/admin/rbac` 오버라이드가
    //    화면에만 반영되지 않는다. 판정 정본은 RolesGuard 가 부르는 `PermissionService`(오버라이드 우선)이고,
    //    이 응답은 그 정본을 **읽기만** 한다 — 화면이 여는 것과 API 가 허용하는 것이 갈라지지 않게.
    //    (넓히는 방향도 안전하다: 오버라이드 허용은 RolesGuard 의 @RequirePermission 게이트에도 똑같이 걸린다.
    //     @Roles 역할 게이트는 이 목록과 무관하며 오버라이드로 넓어지지 않는다.)
    const permissions = this.permissions
      .effectivePermissions(roleKey)
      .filter((p) => p.allowed)
      .map((p) => p.key);
    /**
     * 모바일이 필요한 사실들 — AUTH-S-04.
     *
     * 🔴 앱은 role 문자열로 메뉴를 열지 않는다. 웹이 하던 `department.startsWith(...)` 분기를
     *    서버 매핑(`mobileHomeFor`)으로 옮겨, 화면이 여는 것과 서버가 허용하는 것이 갈라지지 않게 한다.
     * 🔴 `deviceState`·`appKeyState`·`assuranceLevel` 은 **토큰에 실제로 실린 사실**에서만 나온다.
     *    웹 세션에는 없는 값이라 `null` 이다 — 모르는 것을 'ACTIVE' 로 채우지 않는다.
     */
    const home = mobileHomeFor(String((profile as { role?: string })?.role ?? ''));
    const staff = current.id
      ? await this.authService.staffContextOf(current.id)
      : null;
    return {
      data: {
        ...profile,
        permissions,
        employeeId: staff?.employeeNumber ?? null,
        ...home,
        sessionId: current.sessionId ?? null,
        client: current.client ?? 'WEB',
        deviceState: current.staffDeviceId ? 'ACTIVE' : null,
        appKeyState: current.appKeyId ? 'ACTIVE' : null,
        assuranceLevel: current.assuranceLevel ?? null,
      },
    };
  }
}

/** JwtStrategy 가 실어 보내는 요청 주체 — 세션·기기·보증 수준까지 */
interface MeContext {
  id: string;
  sessionId?: string;
  client?: string;
  staffDeviceId?: string;
  appKeyId?: string;
  assuranceLevel?: string;
}
