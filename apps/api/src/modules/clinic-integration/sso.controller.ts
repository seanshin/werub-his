import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  Res,
  Logger,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Response } from 'express';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { RedisService } from '../../infrastructure/redis/redis.service';
import { ClinicApiService, ClinicUser } from './clinic-api.service';
import { VerifySsoDto } from './dto/clinic-integration.dto';

import { EVERY_STAFF_ROLE } from '@hospital-run/shared';
import { devSwitchOn } from '../../common/release-security';
/**
 * Clinic role -> HIS UserRole mapping
 */
export function mapClinicRoleToHisRole(clinicRole: string, hisUserRole?: string, hisRole?: string): { role: string; unknown?: string } {
  // 우선순위: hisUserRole (Prisma enum) > hisRole (display) > clinicRole
  //
  // 🔴 종전에는 상대가 보낸 문자열을 **그대로 대문자로 바꿔 돌려줬다.** Clinic 은 매핑이 없으면
  //    'STAFF' 를, 미지 역할은 대문자 변환('SUPPORT' 등)을 보내는데 둘 다 HIS UserRole 에 없다
  //    → `user.create` 가 터져 **Clinic 에서 처음 들어오는 직원은 로그인 자체가 실패**한다
  //    (2026-09-11 외부 코드 대조 · HEAD 재현).
  // 🔴 모르는 값을 임의의 임상 역할로 바꾸지도 않는다(기본값 'NURSE' 는 모르는 사람에게 임상 권한을 준다).
  //    **모르면 안전측으로 접는다** — 최소권한 READ 로 만들고, 무엇이 미지였는지 호출부가 기록한다.
  const wanted = (hisUserRole ?? hisRole)?.toUpperCase();
  if (wanted) {
    return EVERY_STAFF_ROLE.includes(wanted as (typeof EVERY_STAFF_ROLE)[number])
      ? { role: wanted }
      : { role: 'READ', unknown: wanted };
  }
  switch (clinicRole) {
    case 'OWNER':
      return { role: 'ADMIN' };
    case 'MANAGER':
      return { role: 'DOCTOR' };
    case 'REGULAR':
      return { role: 'NURSE' };
    default:
      return { role: 'NURSE' };
  }
}

/**
 * 외부 SSO 로 **새로 만드는** HIS 계정의 역할 — 🔴
 *
 * HIS 가 Clinic 에 직원을 올릴 때 분류(MEDICAL/ADMIN)를 역할 어휘('Doctor'/'Admin')로 잘못 옮겼고,
 * Clinic 이 그 값을 대문자로 돌려주면 `mapClinicRoleToHisRole` 은 'ADMIN' 을 유효 역할로 채택한다
 * → **행정직이 외부 로그인 한 번으로 시스템 관리자 계정**을 얻는 경로였다.
 * 시스템 관리 권한은 외부 시스템의 주장만으로 주지 않는다 — 최소권한 READ 로 만들고 관리자가 승격한다.
 * **기존 계정의 역할은 건드리지 않는다**(이 함수는 신규 생성에만 쓰인다 · 소급 금지).
 */
export const SSO_JIT_WITHHELD_ROLES: readonly string[] = ['ADMIN'];
export function jitRoleForNewSsoUser(mappedRole: string): { role: string; withheld?: string } {
  return SSO_JIT_WITHHELD_ROLES.includes(mappedRole) ? { role: 'READ', withheld: mappedRole } : { role: mappedRole };
}

@ApiTags('SSO (Clinic Integration)')
@Controller()
export class SsoController {
  private readonly logger = new Logger(SsoController.name);

  constructor(
    private readonly clinicApi: ClinicApiService,
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly redis: RedisService,
  ) {}

  /**
   * GET /sso?token=xxx
   * SSO landing page: verifies token and redirects to dashboard with JWT
   */
  @Get('sso')
  @ApiOperation({ summary: 'SSO 랜딩 (Clinic -> HIS 리다이렉트)' })
  async ssoLanding(
    @Query('token') token: string,
    @Res() res: Response,
  ) {
    if (!token) {
      return res.status(400).json({
        error: { code: 'MISSING_TOKEN', message: 'SSO token is required' },
      });
    }

    try {
      // 1. Verify token with Clinic API
      const clinicUser = await this.clinicApi.verifySsoToken(token);
      if (!clinicUser) {
        return res.status(401).json({
          error: { code: 'INVALID_SSO_TOKEN', message: 'SSO token verification failed' },
        });
      }

      // 2. Find or create HIS user
      const user = await this.findOrCreateUser(clinicUser);

      // 3. Issue JWT
      const payload = { sub: user.id, email: user.email, role: user.role };
      const accessToken = this.jwt.sign(payload);
      const refreshToken = this.jwt.sign(payload, {
        expiresIn: '7d',
      });

      // 4. Store refresh token in Redis
      await this.redis.set(
        `refresh:${user.id}`,
        refreshToken,
        'EX',
        7 * 24 * 60 * 60,
      );

      // 5. Set cookie and redirect to dashboard
      res.cookie('refreshToken', refreshToken, {
        httpOnly: true,
        // 🔴 2026-08-25: `NODE_ENV === 'production'` 이었다 — 운영에 그 변수가 없어 **secure=false** 였다.
        //    refresh 토큰 쿠키가 평문(HTTP)으로도 전송될 수 있다는 뜻이다. 기본은 secure,
        //    HTTP 로 개발할 때만 명시적으로 끈다(위험한 쪽이 옵트인).
        secure: !devSwitchOn('ALLOW_INSECURE_COOKIES'), // 🔴 T4-3 — REAL 에서는 켜져 있어도 secure(부팅도 거부)
        sameSite: 'strict',
        maxAge: 7 * 24 * 60 * 60 * 1000,
        path: '/api/v1/auth',
      });

      // Redirect to frontend SSO page with token in query
      const dashboardUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
      return res.redirect(`${dashboardUrl}/sso?accessToken=${accessToken}&expiresIn=28800`);
    } catch (error) {
      // 판정된 거부(비활성 계정 등)는 그 상태로 돌려준다 — 500 으로 뭉개지 않는다
      if (error instanceof HttpException) {
        return res.status(error.getStatus()).json({ error: error.getResponse() });
      }
      this.logger.error(`SSO landing error: ${error instanceof Error ? error.message : error}`);
      return res.status(500).json({
        error: { code: 'SSO_ERROR', message: 'SSO processing failed' },
      });
    }
  }

  /**
   * POST /api/v1/sso/verify
   * Internal SSO verification endpoint (used by frontend)
   */
  @Post('api/v1/sso/verify')
  @ApiOperation({ summary: 'SSO 토큰 검증 (내부용)' })
  async verifySso(@Body() dto: VerifySsoDto) {
    if (!dto.token) {
      throw new HttpException(
        { code: 'MISSING_TOKEN', message: 'SSO token is required' },
        HttpStatus.BAD_REQUEST,
      );
    }

    // 1. Verify token with Clinic API
    const clinicUser = await this.clinicApi.verifySsoToken(dto.token);
    if (!clinicUser) {
      throw new HttpException(
        { code: 'INVALID_SSO_TOKEN', message: 'SSO token verification failed' },
        HttpStatus.UNAUTHORIZED,
      );
    }

    // 2. Find or create HIS user
    const user = await this.findOrCreateUser(clinicUser);

    // 3. Issue JWT
    const payload = { sub: user.id, email: user.email, role: user.role };
    const accessToken = this.jwt.sign(payload);
    const refreshToken = this.jwt.sign(payload, {
      expiresIn: '7d',
    });

    // 4. Store refresh token in Redis
    await this.redis.set(
      `refresh:${user.id}`,
      refreshToken,
      'EX',
      7 * 24 * 60 * 60,
    );

    this.logger.log(`SSO login successful for user: ${user.email} (clinicUserId: ${clinicUser.id})`);

    return {
      data: {
        accessToken,
        refreshToken,
        expiresIn: 28800,
        user: {
          id: user.id,
          email: user.email,
          familyName: user.familyName,
          givenName: user.givenName,
          role: user.role,
        },
      },
    };
  }

  /**
   * Find existing HIS user by Clinic user ID or email, or create a new one.
   */
  private async findOrCreateUser(clinicUser: ClinicUser) {
    // Try to find by clinicUserId in Staff table first
    const staffByClinicId = await this.prisma.staff.findUnique({
      where: { clinicUserId: clinicUser.id },
    });

    if (staffByClinicId?.userId) {
      const user = await this.prisma.user.findUnique({
        where: { id: staffByClinicId.userId },
      });
      if (user && !user.isActive) this.rejectInactive();
      if (user && user.isActive) {
        await this.prisma.user.update({
          where: { id: user.id },
          data: { lastLoginAt: new Date() },
        });
        return user;
      }
    }

    // Try to find by email
    let user = await this.prisma.user.findUnique({
      where: { email: clinicUser.email },
    });

    const mapped = mapClinicRoleToHisRole(clinicUser.role, clinicUser.hisUserRole, clinicUser.hisRole);
    const jit = jitRoleForNewSsoUser(mapped.role);
    const hisRole = jit.role;

    if (user) {
      // 🔴 이메일 경로는 isActive 를 보지 않았다 — 비활성(퇴직) 계정에
      //    lastLoginAt 갱신·"SSO login successful" 로그·clinicUserId 연결이 남았다(토큰은 JwtStrategy 가 막지만
      //    오프보딩 감사가 흐려진다). **쓰기 전에** 거부한다.
      if (!user.isActive) this.rejectInactive();
      // Update last login + department/specialty if provided
      user = await this.prisma.user.update({
        where: { id: user.id },
        data: {
          lastLoginAt: new Date(),
          ...(clinicUser.department && { department: clinicUser.department }),
          ...(clinicUser.specialties?.length && { specialty: clinicUser.specialties[0] }),
        },
      });

      // Link clinic user ID to staff record if not already linked
      const existingStaff = await this.prisma.staff.findUnique({
        where: { userId: user.id },
      });
      if (existingStaff && !existingStaff.clinicUserId) {
        await this.prisma.staff.update({
          where: { id: existingStaff.id },
          data: { clinicUserId: clinicUser.id },
        });
      }

      return user;
    }

    // Create new user from Clinic data
    // Parse username into family/given name (Korean: first char = family)
    const username = clinicUser.username || '';
    const familyName = username.length > 0 ? username.charAt(0) : '';
    const givenName = username.length > 1 ? username.substring(1) : '';

    // Generate a random password hash (user will use SSO, not password login)
    const bcrypt = await import('bcrypt');
    const randomPassword = require('crypto').randomBytes(32).toString('hex');
    const passwordHash = await bcrypt.hash(randomPassword, 10);

    user = await this.prisma.user.create({
      data: {
        email: clinicUser.email,
        passwordHash,
        familyName,
        givenName,
        role: hisRole as any,
        department: clinicUser.department ?? null,
        specialty: clinicUser.specialties?.[0] ?? null,
        isActive: true,
        lastLoginAt: new Date(),
      },
    });

    if (jit.withheld) {
      this.logger.warn(
        `Clinic SSO: withheld role ${jit.withheld} for new account ${clinicUser.email} - created as READ, an administrator must promote it`,
      );
    }
    if (mapped.unknown) {
      // 조용히 넘어가지 않는다 — 어느 값이 미지였는지 적어야 양쪽 어휘를 맞출 수 있다
      this.logger.warn(
        `Clinic SSO: 알 수 없는 역할 '${mapped.unknown}' — 최소권한 READ 로 계정을 만들었다(${clinicUser.email}). 역할 매핑을 양쪽에서 맞춰야 한다`,
      );
    }
    this.logger.log(`Created new HIS user for Clinic user: ${clinicUser.email} (role: ${hisRole})`);

    return user;
  }

  private rejectInactive(): never {
    throw new HttpException(
      { code: 'SSO_INACTIVE', message: 'This account is inactive' },
      HttpStatus.UNAUTHORIZED,
    );
  }
}
