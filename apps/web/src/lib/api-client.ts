import { isServerMessage, type ServerMessage } from '@hospital-run/shared';
import { promptDailyPin } from './daily-pin-prompt';
import { promptStepUp } from './step-up-push';

const API_URL = process.env.NEXT_PUBLIC_API_URL || '';

interface FetchOptions extends RequestInit {
  params?: Record<string, string | number | boolean | undefined>;
}

class ApiClient {
  private accessToken: string | null = null;

  constructor() {
    // localStorage에서 토큰 자동 복원 (새 탭/새로고침 시)
    if (typeof window !== 'undefined') {
      this.accessToken = localStorage.getItem('accessToken');
    }
  }

  setToken(token: string | null) {
    this.accessToken = token;
    if (typeof window !== 'undefined') {
      if (token) {
        localStorage.setItem('accessToken', token);
      } else {
        localStorage.removeItem('accessToken');
      }
    }
  }

  getToken() {
    return this.accessToken;
  }

  async fetch<T>(path: string, options: FetchOptions = {}): Promise<T> {
    const { params, ...init } = options;

    let url = `${API_URL}${path}`;
    if (params) {
      const searchParams = new URLSearchParams();
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== '') {
          searchParams.set(key, String(value));
        }
      });
      const qs = searchParams.toString();
      if (qs) url += `?${qs}`;
    }

    const headers: Record<string, string> = {
      // 🔴 `FormData` 에는 Content-Type 을 **붙이지 않는다** — 브라우저가 multipart
      //    boundary 를 넣어야 서버가 파일을 파싱한다. 여기서 박으면 업로드가 통째로 실패한다.
      ...(init.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      ...(init.headers as Record<string, string>),
    };

    if (this.accessToken) {
      headers['Authorization'] = `Bearer ${this.accessToken}`;
    }

    const res = await fetch(url, { ...init, headers, credentials: 'include' });

    // step-up(생체 재인증) 경로의 401 은 세션 만료가 아니라 재인증 실패다.
    // 이 경로의 assertion 은 1회용(서버가 챌린지를 소비)이라 자동 refresh-재시도하면
    // 두 번째 시도에서 "재인증 세션 만료"로 실제 원인이 가려진다 → 재시도 제외, 실제 오류 노출.
    const isStepUpPath = path.includes('/auth/step-up/');
    // 🔴 (2026-10-19 환자 포털 세션) 환자 포털·환자 계정 경로의 401 은 **직원 토큰 갱신**(`/auth/refresh` — 직원 쿠키)으로
    //    풀지 않는다. 같은 브라우저에 직원이 로그인돼 있으면 직원 토큰이 포털 탭에 실려 다시 불렸다. 환자 세션은 끝난 것이다.
    const isPatientPath = path.startsWith('/api/v1/portal') || path.startsWith('/api/v1/patient-auth');
    if (res.status === 401 && path !== '/api/v1/auth/refresh' && !isStepUpPath) {
      const refreshed = isPatientPath ? false : await this.refreshToken();
      if (refreshed) {
        headers['Authorization'] = `Bearer ${this.accessToken}`;
        const retryRes = await fetch(url, { ...init, headers, credentials: 'include' });
        if (!retryRes.ok) throw await this.parseError(retryRes);
        return retryRes.status === 204 ? (null as T) : retryRes.json();
      }
      // 🔴 refresh 까지 실패했으면 **세션은 확정적으로 끝났다.**
      //    종전에는 오류만 던지고 인증 상태를 그대로 뒀다 — 그래서 화면은 "재시도" 버튼을 남겼고,
      //    눌러도 같은 401 로 돌아왔다(2026-08-28 사람 신고: "시간이 한참 지나면 재시도는 의미가 없다").
      //    될 수 없는 행동을 권하지 않는다 — 세션을 정리하고 화면 전환을 알린다.
      notifySessionExpired();
      throw new ApiError('UNAUTHORIZED', '세션이 만료되었습니다. 다시 로그인해주세요.');
    }

    // 데일리 PIN 승인 게이트 — 403 DAILY_PIN_REQUIRED 시 PIN 입력 후 x-daily-pin 헤더로 재시도.
    // (BE 잠금 5회와 정합되게 최대 5회 재입력. 미입력/취소 시 DAILY_PIN_CANCELLED.)
    if (res.status === 403) {
      const body = await res.clone().json().catch(() => null);
      let code = body?.error?.code as string | undefined;
      if (code === 'DAILY_PIN_REQUIRED' || code === 'DAILY_PIN_INVALID') {
        for (let attempt = 0; attempt < 5; attempt++) {
          const pin = await promptDailyPin({ invalid: code === 'DAILY_PIN_INVALID' });
          if (!pin) throw new ApiError('DAILY_PIN_CANCELLED', '승인이 취소되었습니다.');
          const retry = await fetch(url, {
            ...init,
            headers: { ...headers, 'x-daily-pin': pin },
            credentials: 'include',
          });
          if (retry.status === 403) {
            const rb = await retry.clone().json().catch(() => null);
            code = rb?.error?.code as string | undefined;
            if (code === 'DAILY_PIN_INVALID') continue; // 재입력
          }
          if (!retry.ok) throw await this.parseError(retry);
          return retry.status === 204 ? (null as T) : retry.json();
        }
        throw new ApiError('DAILY_PIN_INVALID', 'PIN 시도 횟수를 초과했습니다.');
      }

      // Tier2 — 생명직결 작업: 스마트폰 푸시 생체승인. 폰 승인 후 x-step-up-token 으로 재시도.
      if (code === 'STEPUP_REQUIRED') {
        const details = body?.error?.details as { action?: string; resourceId?: string } | undefined;
        if (details?.action) {
          const token = await promptStepUp({ action: details.action, resourceId: details.resourceId });
          if (!token) throw new ApiError('STEPUP_CANCELLED', '승인이 취소되었습니다.');
          const retry = await fetch(url, {
            ...init,
            headers: { ...headers, 'x-step-up-token': token },
            credentials: 'include',
          });
          if (!retry.ok) throw await this.parseError(retry);
          return retry.status === 204 ? (null as T) : retry.json();
        }
      }
    }

    if (!res.ok) throw await this.parseError(res);
    return res.status === 204 ? (null as T) : res.json();
  }

  private async refreshToken(): Promise<boolean> {
    try {
      const res = await fetch(`${API_URL}/api/v1/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok) return false;
      const data = await res.json();
      // setToken 으로 localStorage 까지 동기화 — 메모리만 갱신하면 새 탭/새 창이 만료 토큰을 읽어 401.
      this.setToken(data.data.accessToken);
      return true;
    } catch {
      return false;
    }
  }

  private async parseError(res: Response): Promise<ApiError> {
    try {
      const body = await res.json();
      return new ApiError(
        body.error?.code || 'UNKNOWN',
        body.error?.message || 'An error occurred',
        body.error?.details,
        // 예외 문장 `{ k, params }`(서버 `msgException`) — 형태가 아니면 버린다(화면은 message 를 그린다)
        isServerMessage(body.error?.msg) ? body.error.msg : undefined,
      );
    } catch {
      return new ApiError('NETWORK_ERROR', `HTTP ${res.status}`);
    }
  }

  // Convenience methods
  get<T>(path: string, params?: Record<string, string | number | boolean | undefined>) {
    return this.fetch<T>(path, { method: 'GET', params });
  }

  post<T>(path: string, body?: unknown, headers?: Record<string, string>) {
    return this.fetch<T>(path, { method: 'POST', body: body ? JSON.stringify(body) : undefined, headers });
  }

  put<T>(path: string, body?: unknown) {
    return this.fetch<T>(path, { method: 'PUT', body: body ? JSON.stringify(body) : undefined });
  }

  patch<T>(path: string, body?: unknown) {
    return this.fetch<T>(path, { method: 'PATCH', body: body ? JSON.stringify(body) : undefined });
  }

  /**
   * 파일 업로드 — 🔴 화면마다 raw `fetch` 를 쓰면 **토큰 갱신·세션 만료 처리를 못 탄다**
   *    (실측: 상담 첨부·포털이 각자 fetch 를 쓰고 있었다). 정본을 통과시킨다.
   */
  postForm<T>(path: string, form: FormData) {
    return this.fetch<T>(path, { method: 'POST', body: form });
  }

  del<T>(path: string) {
    return this.fetch<T>(path, { method: 'DELETE' });
  }
}

/**
 * 🔴 세션 만료 통지 — **한 번만** 보낸다.
 *
 * 화면 하나에 쿼리가 여러 개 물려 있어 401 이 동시에 터진다. 매번 알리면 이동이 중첩되고
 * 토스트가 쏟아진다. 정리(토큰 제거)는 즉시 하되 통지는 한 번이다.
 *
 * 🔴 여기서 직접 라우팅하지 않는다 — `api-client` 가 라우터를 알면 순환이 생기고,
 *    "지금 이 화면을 떠나도 되는가"는 화면 쪽이 판단할 일이다(작성 중인 내용이 있을 수 있다).
 */
let sessionExpiredNotified = false;
export const SESSION_EXPIRED_EVENT = 'auth:session-expired';
export function notifySessionExpired(): void {
  if (typeof window === 'undefined') return;
  try { localStorage.removeItem('accessToken'); } catch { /* 저장소 접근 불가여도 진행한다 */ }
  if (sessionExpiredNotified) return;
  sessionExpiredNotified = true;
  window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT));
}
/** 로그인에 성공하면 다시 알릴 수 있게 되돌린다 */
export function resetSessionExpiredNotice(): void { sessionExpiredNotified = false; }

export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public details?: unknown,
    /**
     * 예외 문장 `{ k, params }`(2026-09-15 I4) — 있으면 화면이 카탈로그로 조립한다(`extractErrorMessage`·`QueryErrorFallback`).
     * 🔴 `message` 는 종전과 같은 서버 한국어 문장 그대로다(하위 호환 — msg 없는 서버·구 응답은 message 만).
     */
    public msg?: ServerMessage,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export const apiClient = new ApiClient();
