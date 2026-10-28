import { Injectable, UnauthorizedException, ForbiddenException, BadRequestException, NotFoundException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as crypto from 'crypto';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { RedisService } from '../../infrastructure/redis/redis.service';
import { KeyCustodyService } from '../../common/crypto/key-custody.service';
import { hashClientSecret, safeSecretEqual } from './smart-secret.util';
import { publicBaseUrl, fhirIssuer } from '../../common/util/public-url';

export interface SmartTokenPayload {
  sub: string;        // SmartClient.id
  client_id: string;  // SmartClient.clientId
  org_id?: string;    // 연결 기관
  scope: string;      // 공백 구분 scope
  token_type: 'smart'; // 내부 JWT와 구분
  patient?: string;   // 환자 스코프(launch context) — write-back IDOR 차단용
  fhirUser?: string;  // per-user launch 의 행위 주체(Practitioner/<userId>) — 접근 리포트·감사 귀속
}

/** 인가 코드 저장 형태 — Redis 에 JSON 으로 들어간다(정본은 이 타입 하나) */
interface AuthCodeRecord {
  clientId: string;
  scope: string;
  redirectUri: string;
  expiresAt: number;
  launch?: string;
  patient?: string;
  fhirUser?: string;
  codeChallenge?: string;
  codeChallengeMethod?: string;
}

/**
 * EHR launch 로 환자 문맥을 받아 그 환자의 기록을 읽는 스코프인가 — AI 활용 동의 게이트의 정본 판정.
 * 🔴 `patient/` 만 보면 `user/*.read` 앱이 launch 로 환자 문맥을 받아(토큰에 patient 클레임)
 *    **동의 없는 환자의 기록을 읽는다** — 읽기 가드는 patient/·user/ 를 같은 규칙으로 통과시키기 때문이다.
 *    `system/*` 은 launch 대상이 아니다(Backend Services).
 */
export function readsPatientData(scopes: readonly string[]): boolean {
  return scopes.some((s) => s.startsWith('patient/') || s.startsWith('user/'));
}

@Injectable()
export class SmartAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly keyCustody: KeyCustodyService, // id_token RS256 서명·JWKS(개인키 미취급)
    private readonly redis: RedisService, // 인가 코드·launch 문맥 정본(프로세스 메모리 금지 — 아래 주석)
  ) {}

  /** SMART-on-FHIR Client Credentials Grant */
  async issueToken(clientId: string, clientSecret: string, requestedScope?: string) {
    const client = await this.prisma.smartClient.findUnique({
      where: { clientId },
    });

    if (!client || !client.isActive) {
      throw new UnauthorizedException('Invalid client credentials');
    }

    // 시크릿 비교 — 저장 해시 우선. 레거시 평문 저장분은 매치 시 해시로 자동 업그레이드(lazy migration·무중단).
    const inputHash = hashClientSecret(clientSecret);
    let ok = safeSecretEqual(client.clientSecret, inputHash);
    if (!ok && safeSecretEqual(client.clientSecret, clientSecret)) {
      ok = true;
      await this.prisma.smartClient.update({ where: { id: client.id }, data: { clientSecret: inputHash } });
    }
    if (!ok) {
      throw new UnauthorizedException('Invalid client credentials');
    }

    // Scope 교차 — 요청된 scope 중 허가된 것만 발급
    const allowedScopes = client.scopes;
    const scopes = requestedScope
      ? requestedScope.split(/\s+/).filter((s) => allowedScopes.includes(s))
      : allowedScopes;

    if (scopes.length === 0) {
      throw new UnauthorizedException('No valid scopes');
    }

    const payload: SmartTokenPayload = {
      sub: client.id,
      client_id: client.clientId,
      org_id: client.orgId ?? undefined,
      scope: scopes.join(' '),
      token_type: 'smart',
    };

    const accessToken = this.jwtService.sign(payload);

    // lastUsedAt 갱신
    await this.prisma.smartClient.update({
      where: { id: client.id },
      data: { lastUsedAt: new Date() },
    });

    return {
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: 3600,
      scope: scopes.join(' '),
    };
  }

  /** 토큰 검증 (Guard에서 사용) */
  async validateToken(token: string): Promise<SmartTokenPayload> {
    try {
      const payload = this.jwtService.verify<SmartTokenPayload>(token);
      if (payload.token_type !== 'smart') {
        throw new UnauthorizedException('Not a SMART token');
      }
      return payload;
    } catch {
      throw new UnauthorizedException('Invalid or expired SMART token');
    }
  }

  /** Scope 검사 — "patient/Patient.read"·"system/DiagnosticReport.write"(Backend Services) 형식 */
  hasScope(payload: SmartTokenPayload, resourceType: string, action: 'read' | 'write'): boolean {
    const scopes = payload.scope.split(/\s+/);
    // system/* = SMART Backend Services(서버-서버·환자 launch 없음). LIS 등 외부 시스템 M2M.
    const patterns = [
      `patient/${resourceType}.${action}`,
      `patient/${resourceType}.*`,
      `patient/*.${action}`,
      `patient/*.*`,
      `user/${resourceType}.${action}`,
      `user/${resourceType}.*`,
      `user/*.${action}`,
      `user/*.*`,
      `system/${resourceType}.${action}`,
      `system/${resourceType}.*`,
      `system/*.${action}`,
      `system/*.*`,
    ];
    return scopes.some((s) => patterns.includes(s));
  }

  /**
   * system/* (SMART Backend Services) 스코프 보유 여부 — 환자 launch 컨텍스트 없는 서버-서버(M2M).
   * 인구단위(all-patients) 판독 허용 판정용. patient/·user/ 만으로는 false(환자 컨텍스트 결속 필요).
   */
  /**
   * 단건(:id) 조회 소유 검증 — 검색과 달리 subject 파라미터가 없어 가드에서 막을 수 없다.
   * 내부 직원 JWT(smartClient 없음)와 system/* 스코프는 통과, 환자 스코프 토큰은 소유 일치 필수.
   * 🔴 이 검증이 없으면 외부 클라이언트가 리소스 ID 만으로 타 환자 기록을 읽는다(IDOR).
   */
  assertPatientAccess(
    smartClient: SmartTokenPayload | undefined,
    resourceType: string,
    ownerPatientId: string | null | undefined,
    action: 'read' | 'write' = 'read',
  ): void {
    if (!smartClient) return;                                        // 내부 직원 경로
    if (this.hasSystemScope(smartClient, resourceType, action)) return; // 인구단위(LIS·트윈 M2M)
    const tokenPatient = smartClient.patient;
    if (!tokenPatient) throw new ForbiddenException('환자 스코프 토큰은 환자 컨텍스트가 필요합니다');
    if (!ownerPatientId || ownerPatientId !== tokenPatient) {
      throw new ForbiddenException('토큰 환자 스코프와 대상 환자가 일치하지 않습니다(IDOR 차단)');
    }
  }

  hasSystemScope(payload: SmartTokenPayload, resourceType: string, action: 'read' | 'write'): boolean {
    const scopes = payload.scope.split(/\s+/);
    return [
      `system/${resourceType}.${action}`,
      `system/${resourceType}.*`,
      `system/*.${action}`,
      `system/*.*`,
    ].some((s) => scopes.includes(s));
  }


  /** SMART id_token 서명 키(RS256) — sign 모듈과 분리된 전용 keyRef(용도 분리·독립 회전) */
  private static readonly ID_TOKEN_KEYREF = 'smart.idToken.jwks';

  /** id_token(RS256) 서명 — 개인키는 KeyCustody 안에만 존재(호출부는 PEM 미취급) */
  private async signIdTokenRs256(claims: Record<string, unknown>): Promise<string> {
    const kid = await this.keyCustody.kid(SmartAuthService.ID_TOKEN_KEYREF);
    const now = Math.floor(Date.now() / 1000);
    const header = { alg: 'RS256', typ: 'JWT', kid };
    const payload = { ...claims, iat: now, exp: now + 3600 };
    const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const signingInput = `${b64(header)}.${b64(payload)}`;
    const sig = await this.keyCustody.signRs256(SmartAuthService.ID_TOKEN_KEYREF, Buffer.from(signingInput));
    return `${signingInput}.${sig.toString('base64url')}`;
  }

  /** id_token 검증용 공개 JWKS(개인키 미노출·회전 윈도우 중 양키 게시) */
  async idTokenJwks(): Promise<{ keys: Array<Record<string, unknown>> }> {
    return this.keyCustody.publicJwks(SmartAuthService.ID_TOKEN_KEYREF);
  }

  /** SMART Configuration 메타데이터 */
  getSmartConfiguration(baseUrl: string) {
    return {
      issuer: baseUrl,
      authorization_endpoint: `${baseUrl}/oauth2/authorize`,
      token_endpoint: `${baseUrl}/oauth2/token`,
      token_endpoint_auth_methods_supported: ['client_secret_post', 'client_secret_basic'],
      grant_types_supported: ['client_credentials', 'authorization_code'],
      code_challenge_methods_supported: ['S256'],
      // id_token 은 RS256(비대칭) — 공개키는 jwks_uri 로 게시. 시크릿 해시 보관 정책과 충돌하지 않는다.
      id_token_signing_alg_values_supported: ['RS256'],
      jwks_uri: `${baseUrl}/.well-known/smart-jwks.json`,
      scopes_supported: [
        'launch',
        'openid',
        'fhirUser',
        'patient/Patient.read',
        'patient/Patient.write',
        'patient/Encounter.read',
        'patient/MedicationRequest.read',
        'patient/Condition.read',
        'patient/Observation.read',
        'patient/AllergyIntolerance.read',
        'patient/Procedure.read',
        'patient/Appointment.read',
        'patient/DiagnosticReport.read',
        'patient/ServiceRequest.read',
        'patient/Location.read',
        'patient/Bundle.write',
        'patient/CarePlan.read',
        'patient/DocumentReference.read',
        'patient/Immunization.read',
        'patient/Medication.read',
        'user/*.read',
        'user/*.write',
        // SMART Backend Services(system/*) — 서버-서버 연동(LIS 검사 · 디지털 트윈 위험점수 소싱)
        'system/Patient.read',
        'system/ServiceRequest.read',
        'system/DiagnosticReport.read',
        'system/DiagnosticReport.write',
        'system/Observation.read',
        'system/Observation.write',
        'system/Procedure.read',
        'system/Condition.read',
        'system/Bundle.write',
      ],
      response_types_supported: ['code', 'token'],
      capabilities: [
        'launch-ehr',
        'launch-standalone',
        'client-confidential-symmetric',
        'client-credentials',
        'permission-v1',
        'sso-openid-connect',
        'permission-patient',
        'permission-user',
      ],
    };
  }

  // ═══════════════════════════════════════
  // Authorization Code Grant (EHR Launch)
  // ═══════════════════════════════════════

  /**
   * 인가 코드·launch 문맥 저장 — **Redis 하나가 정본**이다(TTL 5분).
   *
   * 🔴 종전에는 프로세스 메모리 `Map` 이었다. API 가 여러 프로세스로 뜨면 launch 를 발급한
   *    프로세스와 authorize 를 처리하는 프로세스가 달라 "코드가 없다"로 끝난다
   *    (2026-09-11 외부 코드 대조로 지적 · HEAD 재현). 현재 운영(pm2 fork 1 프로세스)에서는
   *    드러나지 않지만 컨테이너 설치·수평 확장에서 깨진다 — 파는 패키지에서는 설치 형태를 고를 수 없다.
   *
   * 🔴 메모리 폴백을 두지 않는다. 두면 정본이 둘이 되고, **한 프로세스에서만 되는 상태가 "된다"로 보인다.**
   *    Redis 가 없으면 그 사실을 말하고 멈춘다(fail-closed).
   *
   * 🔴 코드는 `getdel` 로 **원자적으로 1회용**이다 — 종전 get→검증→delete 는 같은 코드를 동시에
   *    두 번 교환할 창이 있었다.
   */
  private static readonly CODE_TTL_SEC = 5 * 60;

  private async putAuthCode(code: string, rec: AuthCodeRecord): Promise<void> {
    await this.redis.set(this.codeKey(code), JSON.stringify(rec), 'EX', SmartAuthService.CODE_TTL_SEC);
  }

  private codeKey(code: string): string { return `smart:authcode:${code}`; }
  private launchKey(launch: string): string { return `smart:launch:${launch}`; }

  /** SMART launch context 생성 — 로그인 의료진(fhirUser)+환자 바인딩, 5분 유효 */
  async createLaunchContext(patient: string, fhirUser?: string): Promise<string> {
    const launch = crypto.randomBytes(24).toString('hex');
    await this.redis.set(this.launchKey(launch), JSON.stringify({ patient, fhirUser }), 'EX', SmartAuthService.CODE_TTL_SEC);
    return launch;
  }



  /**
   * 차트 런처에 노출할 SMART 앱 목록 — **launchUrl 이 등록된 활성 클라이언트만**.
   * (등록만 된 클라이언트는 standalone 으로만 들어오므로 런처에 띄우지 않는다)
   */
  async listLaunchApps(patientId?: string) {
    const apps = await this.prisma.smartClient.findMany({
      where: { isActive: true, launchUrl: { not: null } },
      select: { clientId: true, name: true, launchUrl: true, scopes: true },
      orderBy: { name: 'asc' },
    });
    // 환자 문맥이 주어지면 AI 활용 동의 여부를 함께 실어 보낸다(런처가 "동의 필요"를 미리 보여줌)
    const consented = patientId ? await this.hasAiConsent(patientId) : undefined;
    return apps.map((a) => ({
      clientId: a.clientId,
      name: a.name,
      scopeCount: a.scopes.length,
      patientScoped: readsPatientData(a.scopes),
      consentOk: consented,
    }));
  }

  /** 트윈/AI 활용 동의(PIPA §23 별도동의) — 외부 앱에 PHI 문맥을 넘기는 게이트 */
  private async hasAiConsent(patientId: string): Promise<boolean> {
    const c = await this.prisma.patientAiConsent.findUnique({ where: { patientId } });
    return !!(c && c.consented && !c.revokedAt);
  }

  /**
   * EHR launch URL 발급 — **환자 + 의료진 본인(Practitioner/<userId>)** 바인딩 launch 토큰(1회용·5분)을
   * 앱의 launch 엔드포인트에 붙인다. 앱은 이 토큰으로 authorize→code→token 을 무인증 대화 없이 완주한다.
   */
  async buildEhrLaunch(clientId: string, patientId: string, userId: string) {
    const client = await this.prisma.smartClient.findUnique({
      where: { clientId },
      select: { name: true, isActive: true, launchUrl: true, scopes: true },
    });
    if (!client || !client.isActive) throw new NotFoundException('등록되지 않은 SMART 앱입니다');
    if (!client.launchUrl) throw new BadRequestException('앱의 launch URL 이 등록되지 않았습니다(관리 > SMART 클라이언트)');

    const patient = await this.prisma.patient.findUnique({ where: { id: patientId }, select: { id: true } });
    if (!patient) throw new NotFoundException('환자를 찾을 수 없습니다');

    // 환자 기록을 읽는 앱(patient/·user/)은 PHI 를 받는다 → 동의 없으면 발급하지 않는다(트윈과 동일 게이트)
    if (readsPatientData(client.scopes) && !(await this.hasAiConsent(patientId))) {
      throw new ForbiddenException('환자의 AI 활용 동의가 필요합니다(PIPA §23 별도동의)');
    }

    const launch = await this.createLaunchContext(patientId, `Practitioner/${userId}`);
    const url = new URL(client.launchUrl);
    url.searchParams.set('iss', fhirIssuer());
    url.searchParams.set('launch', launch);
    return {
      url: url.toString(),
      launch,
      iss: fhirIssuer(),
      appName: client.name,
      expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    };
  }

  /** 동의 화면 표시용 클라이언트 정보(시크릿·해시 미노출) */
  async clientInfoForConsent(clientId: string) {
    const c = await this.prisma.smartClient.findUnique({
      where: { clientId },
      select: { name: true, clientId: true, scopes: true, redirectUris: true, isActive: true },
    });
    if (!c || !c.isActive) throw new UnauthorizedException('Invalid client_id');
    return c;
  }

  /** launch 토큰이 유효한 EHR launch 문맥인지 확인(소비하지 않음) — standalone 분기 판정용 */
  async hasLaunchContext(launch?: string): Promise<boolean> {
    if (!launch) return false;
    return (await this.redis.exists(this.launchKey(launch))) === 1;
  }

  /**
   * standalone launch — **로그인한 의료진 본인**을 fhirUser 로 바인딩해 코드를 발급한다.
   * 🔴 종전 authorize 는 무인증으로 즉시 코드를 발급해 토큰에 사용자 신원이 없었다(fhirUser undefined).
   *    사용자 신원이 없으면 "의료진 본인 권한 범위" 라는 전제도 성립하지 않으므로 인증을 필수화한다.
   */
  async issueAuthorizationCodeForUser(
    clientId: string,
    redirectUri: string,
    scope: string,
    userId: string,
    opts: { patientId?: string; codeChallenge?: string; codeChallengeMethod?: string } = {},
  ) {
    const client = await this.prisma.smartClient.findUnique({ where: { clientId } });
    if (!client || !client.isActive) throw new UnauthorizedException('Invalid client_id');
    if (client.redirectUris.length > 0 && !client.redirectUris.includes(redirectUri)) {
      throw new UnauthorizedException('redirect_uri not registered');
    }
    // 환자 스코프를 요청했다면 대상 환자 선택이 필수(없으면 어느 환자 컨텍스트인지 불명 → fail-closed)
    const wantsPatientScope = scope.split(/\s+/).some((x) => x.startsWith('patient/') || x === 'launch/patient');
    if (wantsPatientScope && !opts.patientId) {
      throw new BadRequestException('환자 스코프를 요청한 앱은 대상 환자 선택이 필요합니다');
    }
    if (opts.patientId) {
      const p = await this.prisma.patient.findUnique({ where: { id: opts.patientId }, select: { id: true } });
      if (!p) throw new BadRequestException('환자를 찾을 수 없습니다');
    }
    const code = crypto.randomBytes(32).toString('hex');
    await this.putAuthCode(code, {
      clientId, scope, redirectUri,
      expiresAt: Date.now() + SmartAuthService.CODE_TTL_SEC * 1000,
      patient: opts.patientId,
      fhirUser: `Practitioner/${userId}`,
      codeChallenge: opts.codeChallenge,
      codeChallengeMethod: opts.codeChallengeMethod,
    });
    return { code, expiresIn: SmartAuthService.CODE_TTL_SEC };
  }

  async issueAuthorizationCode(clientId: string, redirectUri: string, scope: string, state?: string, launch?: string, codeChallenge?: string, codeChallengeMethod?: string) {
    const client = await this.prisma.smartClient.findUnique({ where: { clientId } });
    if (!client || !client.isActive) {
      throw new UnauthorizedException('Invalid client_id');
    }

    // redirect_uri 검증
    if (client.redirectUris.length > 0 && !client.redirectUris.includes(redirectUri)) {
      throw new UnauthorizedException('redirect_uri not registered');
    }

    // launch 토큰 해소: launch context(환자+의료진) 우선, 없으면 launch=patientId(간이 fallback)
    const ctxRaw = launch ? await this.redis.getdel(this.launchKey(launch)) : null; // 1회용
    const ctx = ctxRaw ? (JSON.parse(ctxRaw) as { patient: string; fhirUser?: string }) : undefined;
    const patient = ctx?.patient ?? launch;
    const fhirUser = ctx?.fhirUser;

    const code = crypto.randomBytes(32).toString('hex');
    await this.putAuthCode(code, {
      clientId,
      scope: scope ?? '',
      redirectUri,
      expiresAt: Date.now() + SmartAuthService.CODE_TTL_SEC * 1000,
      launch,
      patient, // token에 patient context 반환
      fhirUser, // openid id_token에 fhirUser(Practitioner/{id}) 반환
      codeChallenge,
      codeChallengeMethod: codeChallengeMethod ?? (codeChallenge ? 'S256' : undefined),
    });
    // 만료 정리는 Redis TTL 이 한다(종전 Map 순회 제거)

    return { code };
  }

  /** Authorization Code → 토큰 교환 */
  async exchangeAuthorizationCode(code: string, clientId?: string, redirectUri?: string, codeVerifier?: string) {
    const raw = await this.redis.getdel(this.codeKey(code)); // 원자적 1회용
    const authCode = raw ? (JSON.parse(raw) as AuthCodeRecord) : null;
    if (!authCode || authCode.expiresAt < Date.now()) {
      throw new UnauthorizedException('Invalid or expired authorization code');
    }

    if (clientId && authCode.clientId !== clientId) {
      throw new UnauthorizedException('client_id mismatch');
    }
    if (redirectUri && authCode.redirectUri !== redirectUri) {
      throw new UnauthorizedException('redirect_uri mismatch');
    }

    // PKCE 검증(S256) — code_challenge 있으면 verifier 필수
    if (authCode.codeChallenge) {
      if (!codeVerifier) throw new UnauthorizedException('code_verifier required (PKCE)');
      const digest = crypto.createHash('sha256').update(codeVerifier).digest('base64')
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); // base64url
      if (digest !== authCode.codeChallenge) throw new UnauthorizedException('Invalid code_verifier (PKCE)');
    }

    // 삭제는 위 getdel 이 이미 했다(검증 실패해도 코드는 소모된다 — 재시도 브루트포스 차단)

    const client = await this.prisma.smartClient.findUnique({ where: { clientId: authCode.clientId } });
    if (!client) throw new UnauthorizedException('Client not found');

    // Scope 교차 — 요청 ∩ 등록.
    //
    // 🔴 종전에는 교집합이 비면 **등록 스코프 전부**를 부여했다(요청보다 넓게 준다).
    //    같은 판정을 하는 client_credentials 경로(:54)는 반대로 401 'No valid scopes' 로
    //    좁게 실패한다 — 같은 사실에 규칙이 둘이었고, 그중 하나가 여는 쪽으로 틀려 있었다.
    //    (2026-09-11 외부 코드 대조로 지적 · 요청 스코프가 등록과 표기만 달라도 전부가 나갔다.)
    //    지금은 둘 다 좁게 실패한다. 표기 불일치(system/* 미등록·비표준 표기)는
    //    관리 화면에서 등록 스코프를 고쳐야 하며, 그 사실을 오류가 말한다.
    const requestedScopes = authCode.scope ? authCode.scope.split(/\s+/) : client.scopes;
    const scopes = requestedScopes.filter(s => client.scopes.includes(s));
    if (scopes.length === 0) {
      throw new UnauthorizedException({
        error: 'invalid_scope',
        message: 'No valid scopes',
        details: { requested: requestedScopes, registered: client.scopes },
      });
    }

    const payload: SmartTokenPayload = {
      sub: client.id,
      client_id: client.clientId,
      org_id: client.orgId ?? undefined,
      scope: scopes.join(' '),
      token_type: 'smart',
      ...(authCode.patient ? { patient: authCode.patient } : {}), // 환자 스코프 토큰(write-back IDOR 차단)
      ...(authCode.fhirUser ? { fhirUser: authCode.fhirUser } : {}), // 접근 기록을 의료진 본인에게 귀속
    };

    const accessToken = this.jwtService.sign(payload);

    // OpenID Connect id_token — **RS256(JWKS)**.
    // 🔴 종전 HS256(client_secret 서명)은 원리적으로 검증 불가였다: 시크릿은 sha256 해시로만 저장돼
    //    서버가 해시로 서명했고 클라이언트는 평문을 갖고 있어 영원히 불일치(Cerno 실증).
    //    해시 보관 정책을 유지하면서 검증을 가능하게 하는 유일한 길은 비대칭 서명 → KeyCustody 재사용.
    const issuer = fhirIssuer();
    const idToken = scopes.includes('openid')
      ? await this.signIdTokenRs256({
          sub: authCode.fhirUser ?? client.id,   // 사용자 바인딩이 있으면 그 주체가 sub
          aud: client.clientId,
          iss: issuer,
          ...(authCode.fhirUser ? { fhirUser: authCode.fhirUser } : {}),
          ...(authCode.patient ? { patient: authCode.patient } : {}),
        })
      : undefined;

    await this.prisma.smartClient.update({
      where: { id: client.id },
      data: { lastUsedAt: new Date() },
    });

    return {
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: 3600,
      scope: scopes.join(' '),
      ...(authCode.patient ? { patient: authCode.patient } : {}), // SMART patient context
      ...(idToken ? { id_token: idToken } : {}),
      ...(authCode.launch ? { launch: authCode.launch } : {}),
    };
  }
}
