import { Injectable, CanActivate, ExecutionContext, SetMetadata, ForbiddenException, Optional } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { SmartAuthService, SmartTokenPayload } from './smart-auth.service';
import { ConfigRuntimeService } from '../config/config-runtime.service';
import {
  canAccessFhirAsStaff,
  parseFhirStaffRoles,
  FHIR_STAFF_ROLES_DEFAULT,
  FHIR_STAFF_ROLES_CONFIG_KEY,
} from '@hospital-run/shared';

/** Scope 데코레이터 — @FhirScope('Patient', 'read') */
export const FHIR_SCOPE_KEY = 'fhir_scope';
export const FhirScope = (resourceType: string, action: 'read' | 'write') =>
  SetMetadata(FHIR_SCOPE_KEY, { resourceType, action });

/**
 * SMART-on-FHIR OR 내부 JWT 인증 Guard
 * - Bearer 토큰이 SMART 토큰이면 Scope 검사
 * - 내부 JWT 토큰이면 기존 JwtAuthGuard처럼 통과 (의사/관리자)
 */
@Injectable()
export class SmartAuthGuard implements CanActivate {
  constructor(
    private readonly smartAuthService: SmartAuthService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const authHeader: string = request.headers.authorization;

    if (!authHeader?.startsWith('Bearer ')) {
      return false;
    }

    const token = authHeader.slice(7);

    // SMART 토큰 시도
    try {
      const payload: SmartTokenPayload = await this.smartAuthService.validateToken(token);

      // Scope 검사
      const scopeMeta = this.reflector.get<{ resourceType: string; action: 'read' | 'write' }>(
        FHIR_SCOPE_KEY,
        context.getHandler(),
      );

      if (scopeMeta) {
        if (!this.smartAuthService.hasScope(payload, scopeMeta.resourceType, scopeMeta.action)) {
          return false;
        }
      }

      request.smartClient = payload;
      return true;
    } catch {
      // SMART 토큰이 아니면 false (Fallback은 JwtAuthGuard가 처리)
      return false;
    }
  }
}

/**
 * 이중 인증 Guard — 내부 직원 JWT **또는** SMART 토큰(스코프 필수)을 단일 가드로 허용.
 * - SMART 토큰: @FhirScope 메타가 반드시 있어야 하며 스코프 충족 시 통과(무스코프 라우트는 SMART 거부 = 직원 전용).
 * - 그 외(내부 직원 JWT): 기존 JwtAuthGuard로 위임(aud·활성·idle 등 전 검증 그대로).
 * FhirController의 읽기 EP에 적용해 LIS 등 system/* 클라이언트가 표준 FHIR read를 사용하도록 함.
 */
@Injectable()
export class FhirDualAuthGuard implements CanActivate {
  private readonly jwtGuard = new JwtAuthGuard();

  constructor(
    private readonly smartAuthService: SmartAuthService,
    private readonly reflector: Reflector,
    @Optional() private readonly config?: ConfigRuntimeService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const authHeader: string | undefined = request.headers?.authorization;

    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.slice(7);
      // 1) SMART 토큰 우선 시도(내부 JWT는 token_type!=='smart'이라 validateToken이 throw → JWT 분기로 폴백)
      let payload: SmartTokenPayload | null = null;
      try {
        payload = await this.smartAuthService.validateToken(token);
      } catch {
        payload = null; // SMART 토큰 아님 → 내부 JWT 경로
      }
      if (payload) {
        const scopeMeta = this.reflector.get<{ resourceType: string; action: 'read' | 'write' }>(
          FHIR_SCOPE_KEY,
          context.getHandler(),
        );
        // SMART 토큰은 명시적 스코프 요구 — 스코프 메타 없는 라우트는 직원 전용(사고성 노출 차단).
        if (!scopeMeta) throw new ForbiddenException('SMART 토큰은 이 엔드포인트에 허용되지 않습니다');
        if (!this.smartAuthService.hasScope(payload, scopeMeta.resourceType, scopeMeta.action)) {
          throw new ForbiddenException('scope 부족');
        }
        // 환자 컨텍스트 강제(P0 PHI/IDOR) — system/*(Backend Services·M2M)만 인구단위 판독 허용(LIS/트윈).
        // patient/·user/ 스코프는 launch 컨텍스트(patient 클레임) + 요청 대상 환자 일치 필수.
        // → patient/* client_credentials(클레임 없음)의 전체환자 판독 차단.
        if (!this.smartAuthService.hasSystemScope(payload, scopeMeta.resourceType, scopeMeta.action)) {
          const tokenPatient = payload.patient;
          if (!tokenPatient) {
            throw new ForbiddenException('환자 스코프 토큰은 환자 컨텍스트가 필요합니다(인구단위 판독은 system/* 필요)');
          }
          const q = request.query ?? {};
          const reqPatientRaw = q.patient ?? q.subject;
          const reqPatient = reqPatientRaw ? String(reqPatientRaw).replace(/^Patient\//, '') : null;
          if (reqPatient && reqPatient !== tokenPatient) {
            throw new ForbiddenException('토큰 환자 스코프와 요청 대상 환자가 일치하지 않습니다(IDOR 차단)');
          }
          // 🔴 검색에서 subject 를 생략하면 핸들러가 **전 환자**를 반환하던 구멍 → 토큰 환자를 강제 주입.
          //    (누락을 거부하는 대신 주입해 정상 사용을 막지 않으면서 fail-closed 를 달성)
          //
          // 🔴 Express 5 의 `req.query` 는 **getter 전용**이라 재대입하면
          //    `TypeError: Cannot set property query of #<IncomingMessage>` 로 500 이 난다
          //    (프로드 실측 2026-07-30 — 환자 스코프 FHIR 읽기 전량 500). 객체 자체를 갈아끼우지 않고
          //    getter 가 돌려주는 객체에 키만 얹는다.
          // 🔴 **두 이름을 함께 채운다.** 요청이 `subject` 로 왔어도 핸들러가 `patient` 만 읽으면
          //    (또는 그 반대) 필터가 통째로 사라져 전 환자가 나간다 — 대조만으로는 못 막는다
          //    (일치하면 주입하지 않으므로). 정본 `fhir/patient-search-param.util.ts`.
          {
            Object.assign(q, { subject: tokenPatient, patient: tokenPatient });
            if (request.query !== q) {
              // getter 가 매번 새 객체를 만드는 구현이면 위 대입이 사라진다 → 프로퍼티를 직접 재정의
              Object.defineProperty(request, 'query', { value: q, configurable: true, enumerable: true, writable: true });
            }
          }
        }
        request.smartClient = payload;
        return true;
      }
    }

    // 2) 내부 직원 JWT — 인증은 기존 가드로 위임하고, **역할은 여기서 판정한다.**
    //
    // 🔴 종전에는 이 분기에 역할 검사가 **아예 없었다**(2026-08-27 운영 실측):
    //    급양·원무·의무기록 계정으로도 `GET /fhir/R4/Patient` 가 200 · total 873 을 돌려줬고,
    //    엔트리에 성명·MRN·생년월일·전화·주소가 담겼다. 그 열람은 감사에도 남지 않았다.
    //    허용 역할은 설정 `security.fhir.staffRoles`(관리 → 시스템 설정)로 늘릴 수 있다.
    const ok = await (this.jwtGuard.canActivate(context) as Promise<boolean>);
    if (!ok) return false;
    const user = context.switchToHttp().getRequest()?.user;
    const allowed = await this.staffRoles();
    if (!canAccessFhirAsStaff(user?.role, allowed)) {
      throw new ForbiddenException(
        `FHIR 조회 권한이 없는 역할입니다(${user?.role ?? '역할 없음'}). 허용: ${allowed.join(', ')} — 변경은 시스템 설정 \`${FHIR_STAFF_ROLES_CONFIG_KEY}\``,
      );
    }
    return true;
  }

  /** 허용 역할 — 설정 정본. 🔴 못 읽으면 **기본값으로 좁힌다**(조용히 넓히지 않는다). */
  private async staffRoles(): Promise<string[]> {
    try {
      const raw = await this.config?.get(FHIR_STAFF_ROLES_CONFIG_KEY);
      return parseFhirStaffRoles(raw).roles;
    } catch {
      return [...FHIR_STAFF_ROLES_DEFAULT];
    }
  }
}
