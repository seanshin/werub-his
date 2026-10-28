import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { RedisService } from '../../../infrastructure/redis/redis.service';
import { touchSessionActivity } from '../session-activity';

export interface JwtPayload {
  sub: string;
  email: string;
  role: string;
  aud?: string;
  /** 세션(기기) 식별자 — 이 토큰이 **어느 세션에서 났는지**. 레거시 토큰에는 없다 */
  sid?: string;
  /** 발급 클라이언트 — WEB | IOS_NATIVE */
  client?: string;
  /** 승인 기기(스탭 네이티브) */
  sdid?: string;
  /** 앱 설치 개별키 */
  akid?: string;
  /** 보증 수준 */
  al?: string;
}

// P0-4: 메인 액세스 허용 audience — 'his'(정규) + 없음(레거시·마이그레이션 호환).
// aud를 단 외래 토큰(edu/sign/pacs/erp-sso)은 메인 API 거부(토큰 confusion 격리).
// 주의: 무aud 내부 토큰(clinic SSO refresh·SMART 등)은 이 단계에선 통과 — strict 플립(무aud 거부)에서 최종 폐쇄.
const ACCESS_AUDIENCE = 'his';

// FR-19: idle timeout (역할별). 행정/CRM 60분, 임상 등 30분.
export const idleSeconds = (role: string) =>
  role === 'ADMIN' || role.startsWith('CRM') ? 3600 : 1800;
/**
 * 유휴 키 보존 기간 — 🔴 세션(refresh 7일)보다 길어야 한다(2026-10-12 결정 `auth.staffIdleTimeout` = ENFORCE_ALL · 사용자 지시).
 * 종전 `EX ttl+60` 은 기준을 60초 넘기면 키가 사라져 31분 쉰 요청이 **그냥 통과**했다(유휴 만료 사실상 무동작).
 */
export const IDLE_KEY_RETENTION_SEC = 8 * 24 * 3600;

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.getOrThrow<string>('AUTH_SECRET'),
    });
  }

  async validate(payload: JwtPayload) {
    // P0-4 audience 격리: aud가 있으면 'his'만 허용(없으면 레거시 호환). edu 등 외래 self-mint 토큰 차단.
    if (payload.aud && payload.aud !== ACCESS_AUDIENCE) {
      throw new UnauthorizedException('허용되지 않은 토큰 audience입니다.');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      // department: 스마트 환자리스트 등 부서 컨텍스트 소비처용 (미포함 시 user.department가 항상 undefined)
      select: { id: true, email: true, familyName: true, givenName: true, role: true, department: true, isActive: true, accountStage: true },
    });

    if (!user || !user.isActive) {
      throw new UnauthorizedException('User not found or inactive');
    }
    // 온보딩 임시계정(PRE_BOARD)은 staff 세션으로 일반 API 접근 차단(§5.6 격리, defense-in-depth)
    if (user.accountStage === 'PRE_BOARD') {
      throw new UnauthorizedException('입사 승인 전 계정입니다.');
    }

    /**
     * 🔴 세션 폐기 즉시 반영 — `sid` 가 있는 토큰은 **세션이 살아 있어야** 통과한다.
     *
     * 종전에는 access token 에 `sid` 가 없어 로그아웃·기기 폐기·권한 회수가
     * **토큰 만료(최대 8시간)까지 늦었다**. 요청서 AUTH-S-02/S-07 이 지적한 지점이다.
     * 레거시 토큰(`sid` 없음)은 종전대로 통과시킨다 — 막으면 배포 순간 전원이 튕긴다.
     * Redis 장애에는 fail-open(락아웃 방지) 하되, 그 사실을 로그로 남긴다.
     */
    let sessionRevoked = false;
    if (payload.sid) {
      try {
        const alive = await this.redis.get(`session:${payload.sid}`);
        if (!alive) sessionRevoked = true;
        // '마지막 활동' — sid 하나만·TTL 불변·60초 스로틀(근거 session-activity.ts). 쓰기 실패는 아래 catch 로 fail-open.
        else await touchSessionActivity(this.redis, payload.sid, alive, user.id);
      } catch {
        /* Redis 오류 → 세션 검사 생략(가용성 우선) */
      }
    }
    if (sessionRevoked) {
      throw new UnauthorizedException({ code: 'SESSION_REVOKED', message: '세션이 종료되었습니다. 다시 로그인해 주세요.' });
    }

    // FR-19: 비활성 만료 검사 (fail-open — Redis 오류 시 검사 생략, 락아웃 방지)
    // 🔴 idle 키를 **세션 단위**로 가른다. 종전 `idle:{userId}` 는 한 기기의 활동이
    //    다른 기기의 idle 만료를 연장했다(요청서 AUTH-S-02 지적 — 실측 확인).
    const idleKey = `idle:${payload.sid ?? user.id}`;
    let idleExpired = false;
    try {
      const last = await this.redis.get(idleKey);
      const ttl = idleSeconds(user.role);
      if (last && Date.now() - Number(last) > ttl * 1000) {
        idleExpired = true;
      } else {
        await this.redis.set(idleKey, String(Date.now()), 'EX', IDLE_KEY_RETENTION_SEC);
      }
    } catch {
      /* Redis 오류 → idle 검사 생략 */
    }
    if (idleExpired) {
      /**
       * 🔴 유휴 만료 = 그 세션을 끝낸다(2026-10-12 결정 ENFORCE_ALL — 웹·네이티브 직원 앱 모두).
       *    종전엔 판정한 키를 **지워** 다음 요청이 통과했다. 이제 세션(refresh 포함)을 폐기한다 —
       *    다음 요청은 세션 폐기로, refresh 는 세션 없음으로 막혀 다시 로그인해야 한다(웹 클라이언트는 refresh 실패 → 로그인 화면).
       *    `sid` 없는 레거시 토큰은 사용자 단위 키를 지우지 않고 남겨 다음 요청도 막는다(새 로그인은 sid 를 받는다).
       */
      if (payload.sid) {
        await this.redis.multi()
          .del(`refresh:sess:${payload.sid}`).del(`refresh:used:sess:${payload.sid}`).del(`session:${payload.sid}`)
          .srem(`sessions:${user.id}`, payload.sid).del(idleKey)
          .exec()
          .catch(() => undefined); // 폐기 실패여도 이 요청은 거부한다(아래) — 키가 남아 다음 요청도 유휴로 막힌다
      }
      throw new UnauthorizedException({ code: 'SESSION_IDLE_EXPIRED', message: '세션이 비활성으로 만료되었습니다. 다시 로그인해 주세요.' });
    }

    // 세션·기기·보증 수준을 요청 컨텍스트로 넘긴다(고위험 EP 가 되물을 수 있게)
    return {
      ...user,
      sessionId: payload.sid,
      client: payload.client,
      staffDeviceId: payload.sdid,
      appKeyId: payload.akid,
      assuranceLevel: payload.al,
    };
  }
}
