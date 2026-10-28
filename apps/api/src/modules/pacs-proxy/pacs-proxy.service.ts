import { Injectable, Logger, Optional, ServiceUnavailableException, NotFoundException, BadGatewayException, HttpException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ModuleRef } from '@nestjs/core';
import { SignIntegrationService } from '../sign-integration/sign-integration.service';
import { DEV_PACS_USER, DEV_SECRET_LITERALS, isRealBuild } from '../../common/release-security';

/** SSO 사용자 컨텍스트 (컨트롤러에서 주입) */
export interface PacsSsoContext {
  hisUserId: string;
  hisUserEmail: string;
  hisUserRole: string;
  hisJwt: string;
}

/** 서비스 호출 용도 — OpenPACS 역할을 용도별 최소 권한으로 고른다(조회 / 환자 업로드) */
export type PacsServicePurpose = 'read' | 'upload';

@Injectable()
export class PacsProxyService {
  private readonly logger = new Logger(PacsProxyService.name);
  private readonly baseUrl: string;
  private readonly pacsUser: string;
  private readonly pacsPass: string;
  private readonly ssoEnabled: boolean;
  /** 서비스 계정 자격이 **설정으로** 주어졌는가 — 없으면 로그인을 시도하지 않는다 */
  private readonly serviceAccountConfigured: boolean;
  /** 기관이 OPENPACS_USER/PASS 를 **명시로** 넣었는가 — 넣었으면 그 계정이 서명 토큰보다 우선한다 */
  private readonly passwordAccountExplicit: boolean;
  private serviceToken: string | null = null;
  private serviceTokenExpiry = 0;

  /** 서명 토큰 캐시 — 직원 id·서비스 용도별(10분 토큰을 만료 1분 전까지 재사용) */
  private readonly signedTokens = new Map<string, { token: string; exp: number }>();

  constructor(
    private readonly config: ConfigService,
    // 🔴 서명 서비스는 ModuleRef 로 늦게 찾는다 — SignIntegrationModule 을 import 하면 모듈 그래프가 크게 번진다
    @Optional() private readonly moduleRef?: ModuleRef,
  ) {
    this.baseUrl = this.config.get<string>('OPENPACS_API_URL', 'http://127.0.0.1:8000');
    // 🔴 서비스 계정 자격은 **설정에서만** 온다.
    //    종전엔 미설정이면 저장소에 적힌 `admin`/`pacs1234!` 로 로그인을 시도했다 — 판매본이 그 자격을
    //    그대로 들고 나간다는 뜻이다. REAL 은 폴백하지 않고 **서비스 계정을 비활성**한다(503 으로 말한다).
    //    DEV·REHEARSAL 은 종전 동작 그대로 + 경고 — 운영(REHEARSAL)이 지금 이 폴백으로 돌고 있다(실측 2026-09-22).
    const cfgUser = (this.config.get<string>('OPENPACS_USER') ?? '').trim();
    const cfgPass = (this.config.get<string>('OPENPACS_PASS') ?? '').trim();
    const real = isRealBuild();
    this.pacsUser = cfgUser || (real ? '' : DEV_PACS_USER);
    this.pacsPass = cfgPass || (real ? '' : DEV_SECRET_LITERALS.OPENPACS_PASS);
    this.serviceAccountConfigured = this.pacsUser !== '' && this.pacsPass !== '';
    this.passwordAccountExplicit = cfgUser !== '' && cfgPass !== '';
    if (!cfgUser || !cfgPass) {
      this.logger.warn(
        real
          ? 'OPENPACS_USER/OPENPACS_PASS 미설정 — PACS 서비스 계정을 비활성한다(포털·배치 경로는 503 으로 말한다)'
          : 'OPENPACS_USER/OPENPACS_PASS 미설정 — 개발용 기본 자격으로 동작한다(REAL 빌드에서는 비활성된다)',
      );
    }
    this.ssoEnabled = this.config.get<string>('PACS_SSO_ENABLED', 'true') === 'true';
  }

  /** 서비스 계정 토큰 (Webhook/배치용 — SSO 불가 시 폴백) */
  private async getServiceToken(): Promise<string> {
    // 🔴 자격이 없으면 **아무 자격으로도 시도하지 않는다** — 빈 헤더로 부르면 PACS 401 이 오고,
    //    그 401 은 "인증 실패"로만 보여 설치가 덜 됐다는 사실이 화면에 드러나지 않는다.
    if (!this.serviceAccountConfigured) {
      throw new ServiceUnavailableException({
        error: 'PACS_SERVICE_ACCOUNT_UNCONFIGURED',
        message: '영상 보관 시스템 서비스 계정이 설정되지 않았습니다. 자료가 없는 것이 아닙니다.',
        details: { keys: ['OPENPACS_USER', 'OPENPACS_PASS'] },
      });
    }
    if (this.serviceToken && Date.now() < this.serviceTokenExpiry) return this.serviceToken;
    try {
      const res = await fetch(`${this.baseUrl}/api/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: this.pacsUser, password: this.pacsPass }),
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) {
        const data = await res.json() as { access_token?: string; token?: string };
        this.serviceToken = data.access_token ?? data.token ?? '';
        this.serviceTokenExpiry = Date.now() + 3500_000; // ~1시간
        return this.serviceToken!;
      }
    } catch (e) {
      this.logger.warn(`PACS service auth failed: ${(e as Error).message}`);
    }
    return '';
  }

  /** PACS 호출 인증 헤더 — SSO(HIS JWT) 우선, 없으면 서비스 계정 폴백. JSON·바이너리 공통. */
  /**
   * 🔴 서비스 계정 인증 헤더(포털 등 **환자 세션** 경로용).
   *
   * 환자 토큰을 PACS 에 넘길 수는 없다 — 포털의 PACS 조회는 서비스 계정으로 나가야 한다.
   * 종전 포털 컨트롤러는 **Authorization 헤더 없이** PACS 를 불러 운영에서 전부 401 이었고,
   * 그 실패가 "영상 없음"으로 보이거나(구) 상시 503(현)이 됐다. 자격은 한 곳에서만 만든다.
   */
  async serviceAuthHeaders(purpose: PacsServicePurpose = 'read'): Promise<Record<string, string>> {
    return this.authHeaders(undefined, purpose);
  }

  private signer(): SignIntegrationService | null {
    try {
      return this.moduleRef?.get(SignIntegrationService, { strict: false }) ?? null;
    } catch {
      return null;
    }
  }

  /**
   * 🔴 (2026-10-19) OpenPACS 가 믿는 HIS 서명 토큰(RS256 · JWKS · aud=pacs). 사용자 신고 "PACS 연동이 안 됨" —
   *    직원 경로는 HIS 직원 JWT(HS256)를 그대로 넘겼고 포털 경로는 비밀번호 서비스 계정(설정 없음 → 개발 자격)을 썼는데,
   *    OpenPACS 재구성 뒤 둘 다 401 이었다. OpenPACS 는 HIS JWKS 를 이미 믿고(`HIS_JWKS_URL`) 있어 비밀번호가 필요 없다.
   *    서명 서비스를 못 찾거나 서명이 실패하면 null — 호출부가 종전 경로로 간다(조용히 빈 헤더로 부르지 않는다).
   */
  private async signedToken(key: string, issue: (s: SignIntegrationService) => Promise<{ token: string; expiresAt: string }>): Promise<string | null> {
    const hit = this.signedTokens.get(key);
    if (hit && Date.now() < hit.exp) return hit.token;
    const s = this.signer();
    if (!s) return null;
    try {
      const { token, expiresAt } = await issue(s);
      this.signedTokens.set(key, { token, exp: new Date(expiresAt).getTime() - 60_000 });
      return token;
    } catch (e) {
      this.logger.warn(`PACS 서명 토큰 발급 실패 key=${key} — ${(e as Error).message}`);
      return null;
    }
  }

  /**
   * 서비스 계정 자격이 있는가 — 상태 EP 가 "설정됨/미설정"을 **갈라 말하기** 위한 읽기.
   * 🔴 DEV·REHEARSAL 의 개발 폴백 자격도 "있음"이다(그 경로로 실제 로그인이 나간다) — REAL 미설정만 false.
   *    (같은 이름의 private 필드가 정본이라 메서드 이름을 `is…` 로 둔다.)
   */
  isServiceAccountConfigured(): boolean {
    return this.serviceAccountConfigured || this.signer() !== null;
  }

  private async authHeaders(sso?: PacsSsoContext, purpose: PacsServicePurpose = 'read'): Promise<Record<string, string>> {
    if (this.ssoEnabled && sso?.hisJwt) {
      // SSO 모드: 그 직원 이름으로 서명한 aud=pacs 토큰 + 사용자 컨텍스트 헤더(서명 불가 시 종전대로 HIS JWT)
      const signed = sso.hisUserId
        ? await this.signedToken(`staff:${sso.hisUserId}`, (s) => s.issueStaffToken(sso.hisUserId, 'pacs'))
        : null;
      return {
        Authorization: `Bearer ${signed ?? sso.hisJwt}`,
        'X-HIS-User-Id': sso.hisUserId,
        'X-HIS-User-Email': sso.hisUserEmail,
        'X-HIS-User-Role': sso.hisUserRole,
        'X-Auth-Source': 'his-sso',
      };
    }
    // 서비스 모드 (포털/Webhook/배치) — 기관이 넣은 비밀번호 계정이 있으면 그것, 없으면 HIS 서명 토큰, 둘 다 없으면 종전 경로
    if (!this.passwordAccountExplicit) {
      const identity = purpose === 'upload' ? 'pacs-upload' : 'pacs-read';
      const signed = await this.signedToken(`service:${identity}`, (s) => s.issueServiceToken(identity));
      if (signed) return { Authorization: `Bearer ${signed}` };
    }
    const token = await this.getServiceToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  /**
   * WADO 이미지 바이트 중계 (판독 워크스테이션용).
   *
   * 🔴 화면이 `/pacs-api/wado` 를 직접 부르면 HIS 의 JWT·RBAC·감사를 통째로 우회한다.
   *    그리고 여기서 **실패를 null 로 돌려주면 안 된다** — 호출부가 "영상 없음"으로 표시해
   *    판독의가 존재하는 영상을 없다고 읽는다(간호 영상 조회에서 이미 겪었다).
   *    실패는 예외로 올린다.
   */
  async fetchWadoImage(
    params: { studyUID: string; seriesUID?: string; objectUID?: string },
    sso?: PacsSsoContext,
  ): Promise<{ contentType: string; body: Buffer }> {
    const qs = new URLSearchParams();
    qs.set('studyUID', params.studyUID);
    if (params.seriesUID) qs.set('seriesUID', params.seriesUID);
    if (params.objectUID) qs.set('objectUID', params.objectUID);

    const url = `${this.baseUrl}/wado?${qs.toString()}`;
    const res = await fetch(url, {
      headers: await this.authHeaders(sso),
      signal: AbortSignal.timeout(30000),
    }).catch((e: Error) => {
      this.logger.warn(`PACS WADO unreachable: ${e.message}`);
      return null;
    });

    if (res && res.status === 404) {
      throw new NotFoundException({ error: 'IMAGE_NOT_FOUND', message: '해당 검사의 영상을 찾을 수 없습니다.' });
    }
    if (!res || !res.ok) {
      if (res?.status === 401) { this.serviceToken = null; this.serviceTokenExpiry = 0; }
      this.logger.warn(`PACS WADO error: ${res ? `${res.status} ${res.statusText}` : 'unreachable'} for ${params.studyUID}`);
      throw new ServiceUnavailableException({
        error: 'PACS_UNAVAILABLE',
        message: '영상 보관 시스템에서 영상을 불러오지 못했습니다. 영상이 없는 것이 아닙니다.',
      });
    }

    // 이미지가 아닌 응답(오류 HTML 등)을 그대로 흘리지 않는다.
    const contentType = res.headers.get('content-type') ?? '';
    if (!contentType.startsWith('image/') && !contentType.startsWith('application/dicom')) {
      throw new BadGatewayException({
        error: 'PACS_BAD_RESPONSE',
        message: '영상 보관 시스템이 영상이 아닌 응답을 보냈습니다.',
      });
    }
    return { contentType, body: Buffer.from(await res.arrayBuffer()) };
  }

  /**
   * PACS API 요청
   * @param sso - SSO 컨텍스트가 있으면 HIS JWT를 전달, 없으면 서비스 계정 사용
   */
  /**
   * PACS 호출.
   *
   * 🔴 기본은 실패 시 `null` 반환(조회는 조용히 비어도 화면이 버틴다)이지만, **쓰기 작업은
   * 반드시 `throwOnError` 를 켠다.** 종전에는 워크리스트 등록이 401 로 실패해도 이 함수가
   * null 을 돌려줘 호출부의 try/catch 가 발동하지 않았고, 그래서 "등록 성공" 로그와 REGISTERED
   * 상태가 남았다(실측: PACS 401 → worklist_status=REGISTERED).
   *
   * 🔴 **조회도 마찬가지다.** 종전 기본값(`null` → 호출부가 `{count:0}` 로 대체)은
   *    "조회에 실패했다"를 "자료가 없다"로 바꿔 말했다 — 다른 사실이다.
   *    2026-08-18 운영 실측: OpenPACS 가 HIS JWT 를 거부(401)하는데 `/api/v1/pacs/studies`·
   *    `/reports`·`/worklist`·`/dashboard/today` 는 전부 **200 + 0건**을 돌려줬고,
   *    간호 영상 조회 화면은 (실패 분기를 갖췄는데도) "등록된 영상이 없습니다"를 띄웠다.
   *    → 목록·요약 조회는 `strictRead` 로 404(없음)와 그 외 실패(못 불러옴)를 갈라 던진다.
   */
  private async request<T = any>(
    method: string,
    path: string,
    body?: unknown,
    params?: Record<string, string | undefined>,
    sso?: PacsSsoContext,
    opts?: { throwOnError?: boolean; strictRead?: boolean },
  ): Promise<T | null> {
    // 🔴 **쓰기(비-GET)는 기본이 '예외'다.** 호출부가 `throwOnError` 를 적는 것을 잊으면
    //    PACS 401 이 `null` 이 되고 컨트롤러가 `201 {data:null}` 을 돌려줘 화면이
    //    "리포트 서명이 완료되었습니다"를 띄운다(2026-09-15 외부 실호출로 확인 · 판독·오더·
    //    재촬영·긴급판독 등 11자리). 위 주석이 약속한 규칙을 호출부 기억에 맡기지 않는다.
    const failLoudly = opts?.throwOnError ?? method.toUpperCase() !== 'GET';
    let url = `${this.baseUrl}${path}`;

    if (params) {
      const qs = new URLSearchParams();
      Object.entries(params).forEach(([k, v]) => {
        if (v !== undefined && v !== '') qs.set(k, v);
      });
      const qsStr = qs.toString();
      if (qsStr) url += `?${qsStr}`;
    }

    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json', ...(await this.authHeaders(sso)) };

      this.logger.debug(`PACS ${method} ${url} [${sso ? 'SSO:' + sso.hisUserEmail : 'SERVICE'}]`);

      const res = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(10000),
      });

      if (!res.ok) {
        this.logger.warn(`PACS API error: ${res.status} ${res.statusText} for ${method} ${path}`);
        if (res.status === 401) { this.serviceToken = null; this.serviceTokenExpiry = 0; this.signedTokens.clear(); }
        if (opts?.strictRead) throw this.readFailure(res.status);
        if (failLoudly) throw this.writeFailure(method, path, res.status);
        return null;
      }

      return (await res.json()) as T;
    } catch (error) {
      // strictRead 로 우리가 던진 HTTP 예외는 그대로 올린다(아래 unreachable 메시지로 덮지 않게)
      if (error instanceof HttpException) throw error;
      this.logger.warn(`PACS API unreachable: ${method} ${path} — ${(error as Error).message}`);
      if (opts?.strictRead) throw this.readFailure();
      if (failLoudly) throw this.writeFailure(method, path, undefined, (error as Error).message);
      return null;
    }
  }

  /**
   * 조회 실패를 "없음"으로 바꿔 말하지 않기 위한 예외.
   *
   * 404 = "그런 자료가 없다"(사실) / 그 외·연결 실패 = "불러오지 못했다"(다른 사실).
   * 둘을 섞으면 화면이 "영상이 없습니다"로 위장한다(P17).
   */
  /**
   * 쓰기 실패를 "성공"으로 바꿔 말하지 않기 위한 예외.
   *
   * 🔴 종전에는 `null` 을 돌려줘 컨트롤러가 `{data: null}` 을 **201** 로 내보냈고,
   *    화면은 onSuccess 에서 "리포트 서명이 완료되었습니다"를 띄웠다(P16 — 실행하지 않고
   *    성공 상태만 기록). 상류 상태 코드는 메시지에 남긴다(운영이 401/422 를 갈라 보게).
   */
  private writeFailure(method: string, path: string, status?: number, reason?: string): HttpException {
    // 🔴 문장을 **조립하지 않는다** — 서버가 한국어를 조립하면 화면 언어를 바꿔도 그 줄은 한국어다
    //    (가드 `test/architecture/server-composed-display-text.spec.ts`). 값은 details 로 내려보내고
    //    화면이 조립한다. 상류 상태 코드는 운영이 401/422 를 갈라 보는 근거라 반드시 싣는다.
    return new ServiceUnavailableException({
      error: 'PACS_WRITE_FAILED',
      message: '영상 보관 시스템에 전달하지 못했습니다 — 저장되지 않았습니다.',
      details: { method, path, status: status ?? null, reason: reason ?? null },
    });
  }

  /**
   * 🔴 r1 11-5 (2026-09-28): 상류 상태를 `details.upstreamStatus` 로 싣는다 — 회신 G절 C3 이 상대에게
   *    "503(`details.upstreamStatus=401`)이면 공유 시크릿 미설정·불일치"로 가르라고 안내했는데 그 필드가 없었다.
   *    401(인증 실패 — 공유 시크릿)과 403(권한 거부 — PACS 역할 매핑)은 다른 사실이라 문장도 가른다.
   *    연결 실패(상태 없음)는 `upstreamStatus: null`(모르는 것을 숫자로 지어내지 않는다).
   */
  private readFailure(status?: number): HttpException {
    if (status === 404) {
      return new NotFoundException({ error: 'NOT_FOUND', message: '영상 보관 시스템에 해당 자료가 없습니다.' });
    }
    return new ServiceUnavailableException({
      error: 'PACS_UNAVAILABLE',
      message: status === 401
        ? '영상 보관 시스템 인증에 실패해 조회하지 못했습니다. 자료가 없는 것이 아닙니다.'
        : status === 403
          ? '영상 보관 시스템이 이 계정의 조회 권한을 거부했습니다. 자료가 없는 것이 아닙니다.'
          : '영상 보관 시스템에서 자료를 불러오지 못했습니다. 자료가 없는 것이 아닙니다.',
      details: { upstreamStatus: status ?? null },
    });
  }

  // ── Study (DICOMweb) ──

  async getStudies(filters: {
    patientId?: string;
    studyDate?: string;
    modality?: string;
  }, sso?: PacsSsoContext): Promise<any> {
    return this.request('GET', '/api/v1/dicomweb/studies', undefined, {
      PatientID: filters.patientId,
      StudyDate: filters.studyDate,
      ModalitiesInStudy: filters.modality,
    }, sso, { strictRead: true });
  }

  async getStudySeries(studyUid: string, sso?: PacsSsoContext): Promise<any> {
    return this.request('GET', `/api/v1/dicomweb/studies/${encodeURIComponent(studyUid)}/series`, undefined, undefined, sso, { strictRead: true });
  }

  // ── Worklist ──

  async getWorklist(filters: {
    scheduledDate?: string;
    status?: string;
    modality?: string;
  }, sso?: PacsSsoContext): Promise<any> {
    return this.request('GET', '/api/v1/worklist', undefined, {
      scheduled_date: filters.scheduledDate,
      status: filters.status,
      modality: filters.modality,
    }, sso, { strictRead: true });
  }

  /** 워크리스트 등록 — 실패를 삼키면 촬영실에 오더가 안 떠도 아무도 모른다 */
  async createWorklistItem(data: any, sso?: PacsSsoContext): Promise<any> {
    return this.request('POST', '/api/v1/worklist', data, undefined, sso, { throwOnError: true });
  }

  // ── Reports ──

  async getReports(filters: {
    patientId?: string;
    studyUid?: string;
    status?: string;
  }, sso?: PacsSsoContext): Promise<any> {
    return this.request('GET', '/api/v1/reports', undefined, {
      patient_id: filters.patientId,
      study_uid: filters.studyUid,
      status: filters.status,
    }, sso, { strictRead: true });
  }

  async createReport(data: any, sso?: PacsSsoContext): Promise<any> {
    return this.request('POST', '/api/v1/reports', data, undefined, sso);
  }

  // ── Orders (영상 오더) ──

  async createOrder(data: {
    patient_id: string;
    patient_name: string;
    accession_number: string;
    requested_procedure_id: string;
    requested_procedure_description: string;
    modality: string;
    scheduled_date: string;
    referring_physician: string;
    clinical_info?: string;
    priority?: string;
  }, sso?: PacsSsoContext): Promise<any> {
    return this.request('POST', '/api/v1/orders', data, undefined, sso);
  }

  async getOrderStatus(accessionNumber: string, sso?: PacsSsoContext): Promise<any> {
    const result = await this.request('GET', `/api/v1/orders/${encodeURIComponent(accessionNumber)}/status`, undefined, undefined, sso);
    return result ?? { status: 'unknown' };
  }

  // ── Patient Reports (환자별 리포트) ──

  async getPatientReports(patientId: string, sso?: PacsSsoContext): Promise<any> {
    return this.request('GET', `/api/v1/patients/${encodeURIComponent(patientId)}/reports`, undefined, undefined, sso, { strictRead: true });
  }

  // ── Report Detail + Sign (리포트 상세/서명/수정) ──

  async getReportDetail(reportId: string, sso?: PacsSsoContext): Promise<any> {
    return this.request('GET', `/api/v1/reports/${encodeURIComponent(reportId)}`, undefined, undefined, sso, { strictRead: true });
  }

  async updateReport(reportId: string, data: any, sso?: PacsSsoContext): Promise<any> {
    return this.request('PATCH', `/api/v1/reports/${encodeURIComponent(reportId)}`, data, undefined, sso);
  }

  async signReport(reportId: string, asPreliminary: boolean = false, sso?: PacsSsoContext): Promise<any> {
    return this.request('POST', `/api/v1/reports/${encodeURIComponent(reportId)}/sign`, undefined, {
      as_preliminary: String(asPreliminary),
    }, sso);
  }

  // ── AI Inference (AI 추론) ──

  async getAiModels(sso?: PacsSsoContext): Promise<any> {
    return this.request('GET', '/api/v1/ai/models', undefined, undefined, sso, { strictRead: true });
  }

  async requestAiInference(data: {
    study_instance_uid: string;
    model_id: string;
    priority?: string;
  }, sso?: PacsSsoContext): Promise<any> {
    return this.request('POST', '/api/v1/ai/inference', data, undefined, sso);
  }

  async getAiJobStatus(jobId: string, sso?: PacsSsoContext): Promise<any> {
    const result = await this.request('GET', `/api/v1/ai/jobs/${encodeURIComponent(jobId)}`, undefined, undefined, sso);
    return result ?? { status: 'unknown' };
  }

  // ── Dashboard (대시보드 통계) ──

  async getDashboardToday(sso?: PacsSsoContext): Promise<any> {
    return this.request('GET', '/api/v1/dashboard/today', undefined, undefined, sso, { strictRead: true });
  }

  async getReadingQueue(sso?: PacsSsoContext): Promise<any> {
    return this.request('GET', '/api/v1/dashboard/reading-queue', undefined, undefined, sso, { strictRead: true });
  }

  // ── Templates (리포트 템플릿) ──

  async getTemplates(sso?: PacsSsoContext): Promise<any> {
    return this.request('GET', '/api/v1/templates', undefined, undefined, sso, { strictRead: true });
  }

  // ── Health ──

  async checkHealth(): Promise<any> {
    const result = await this.request('GET', '/health');
    return result ?? { status: 'unavailable', message: 'OpenPACS 서버에 연결할 수 없습니다.' };
  }

  // ── HIS Integration ──

  async retakeRequest(body: Record<string, unknown>, sso?: PacsSsoContext): Promise<any> {
    return this.request('POST', '/api/v1/his/retake-request', body, undefined, sso);
  }

  /** 오더 취소 통지 — 실패를 삼키면 촬영실에 **취소된 검사가 계속 떠 있는다** */
  async cancelOrder(body: Record<string, unknown>, sso?: PacsSsoContext): Promise<any> {
    return this.request('POST', '/api/v1/his/cancel-order', body, undefined, sso, { throwOnError: true });
  }

  async additionalView(body: Record<string, unknown>, sso?: PacsSsoContext): Promise<any> {
    return this.request('POST', '/api/v1/his/additional-view', body, undefined, sso);
  }

  async urgentReading(body: Record<string, unknown>, sso?: PacsSsoContext): Promise<any> {
    return this.request('POST', '/api/v1/his/urgent-reading', body, undefined, sso);
  }

  async patientUpdate(body: Record<string, unknown>, sso?: PacsSsoContext): Promise<any> {
    return this.request('POST', '/api/v1/his/patient-update', body, undefined, sso);
  }

  async clinicalInfo(body: Record<string, unknown>, sso?: PacsSsoContext): Promise<any> {
    return this.request('POST', '/api/v1/his/clinical-info', body, undefined, sso);
  }

  async reportStatus(accessionNumber: string, sso?: PacsSsoContext): Promise<any> {
    const result = await this.request('GET', '/api/v1/his/report-status', undefined, {
      accession_number: accessionNumber,
    }, sso);
    return result ?? { status: 'unknown' };
  }

  async studyStatus(accessionNumber: string, sso?: PacsSsoContext): Promise<any> {
    const result = await this.request('GET', '/api/v1/his/study-status', undefined, {
      accession_number: accessionNumber,
    }, sso);
    return result ?? { status: 'unknown' };
  }

  async scheduleChange(body: Record<string, unknown>, sso?: PacsSsoContext): Promise<any> {
    return this.request('POST', '/api/v1/his/schedule-change', body, undefined, sso);
  }

  async availableSlots(modality?: string, date?: string, sso?: PacsSsoContext): Promise<any> {
    return this.request('GET', '/api/v1/his/available-slots', undefined, {
      modality,
      date,
    }, sso, { strictRead: true });
  }

  async getRequests(limit?: number, sso?: PacsSsoContext): Promise<any> {
    return this.request('GET', '/api/v1/his/requests', undefined, {
      limit: limit !== undefined ? String(limit) : '50',
    }, sso, { strictRead: true });
  }

  // ── Viewer URL (SSO 토큰 포함) ──

  getViewerUrl(studyUid: string, hisJwt?: string): string {
    const base = `/viewer/?StudyInstanceUIDs=${encodeURIComponent(studyUid)}`;
    return hisJwt ? `${base}&token=${encodeURIComponent(hisJwt)}` : base;
  }
}
