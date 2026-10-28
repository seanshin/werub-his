import { getItem, setItem, deleteItem } from './secure-storage';

const API_BASE_URL =
  process.env.EXPO_PUBLIC_API_URL ?? 'https://his.example.org';

interface RequestOptions extends RequestInit {
  skipAuth?: boolean;
}

interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

let isRefreshing = false;
let refreshQueue: Array<{
  resolve: (token: string) => void;
  reject: (error: Error) => void;
}> = [];

function processQueue(error: Error | null, token: string | null) {
  refreshQueue.forEach(({ resolve, reject }) => {
    if (error) reject(error);
    else resolve(token!);
  });
  refreshQueue = [];
}

async function getAccessToken(): Promise<string | null> {
  return getItem('accessToken');
}

async function getRefreshToken(): Promise<string | null> {
  return getItem('refreshToken');
}

async function saveTokens(tokens: TokenPair): Promise<void> {
  await setItem('accessToken', tokens.accessToken);
  await setItem('refreshToken', tokens.refreshToken);
}

async function clearTokens(): Promise<void> {
  await deleteItem('accessToken');
  await deleteItem('refreshToken');
}

async function refreshAccessToken(): Promise<string> {
  const refreshToken = await getRefreshToken();
  if (!refreshToken) {
    throw new Error('NO_REFRESH_TOKEN');
  }

  const response = await fetch(`${API_BASE_URL}/api/v1/patient-auth/token/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken }),
  });

  if (!response.ok) {
    await clearTokens();
    throw new Error('REFRESH_FAILED');
  }

  const { data } = await response.json();
  /**
   * 🔴 2026-08-14(W9). 서버 `POST /patient-auth/token/refresh` 는
   *    `{ accessToken, expiresAt }` 만 돌려준다 — **refreshToken 은 재발급하지 않는다**
   *    (patient-auth.service.refreshToken 반환 타입으로 확인).
   *    종전 코드는 `!data?.refreshToken` 이면 INVALID_TOKEN_RESPONSE 를 던졌으므로
   *    **토큰 갱신이 100% 실패**했다. accessToken TTL 이 1시간이라, 환자는 한 시간마다
   *    화면이 오류로 떨어지고 다시 로그인해야 했다.
   *    → accessToken 만 필수로 보고, refreshToken 은 서버가 줄 때만 교체한다(회전 대비).
   */
  if (!data?.accessToken) {
    throw new Error('INVALID_TOKEN_RESPONSE');
  }
  await setItem('accessToken', data.accessToken);
  if (data.refreshToken) {
    await setItem('refreshToken', data.refreshToken);
  }

  return data.accessToken;
}

async function request<T = unknown>(
  endpoint: string,
  options: RequestOptions = {},
): Promise<T> {
  const { skipAuth = false, headers: customHeaders, ...rest } = options;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(customHeaders as Record<string, string>),
  };

  if (!skipAuth) {
    const token = await getAccessToken();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
  }

  let response = await fetch(`${API_BASE_URL}${endpoint}`, {
    ...rest,
    headers,
  });

  // 401 → 토큰 갱신 후 재시도
  if (response.status === 401 && !skipAuth) {
    if (isRefreshing) {
      const newToken = await new Promise<string>((resolve, reject) => {
        refreshQueue.push({ resolve, reject });
      });
      headers['Authorization'] = `Bearer ${newToken}`;
      response = await fetch(`${API_BASE_URL}${endpoint}`, {
        ...rest,
        headers,
      });
    } else {
      isRefreshing = true;
      try {
        const newToken = await refreshAccessToken();
        processQueue(null, newToken);
        headers['Authorization'] = `Bearer ${newToken}`;
        response = await fetch(`${API_BASE_URL}${endpoint}`, {
          ...rest,
          headers,
        });
      } catch (err) {
        processQueue(err as Error, null);
        throw err;
      } finally {
        isRefreshing = false;
      }
    }
  }

  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}));
    const error = new Error(
      errorBody?.error?.message ?? `요청 실패 (${response.status})`,
    );
    (error as any).status = response.status;
    (error as any).code = errorBody?.error?.code;
    throw error;
  }

  if (response.status === 204) return {} as T;
  return response.json();
}

export const apiClient = {
  get: <T = unknown>(endpoint: string, options?: RequestOptions) =>
    request<T>(endpoint, { ...options, method: 'GET' }),

  post: <T = unknown>(endpoint: string, body?: unknown, options?: RequestOptions) =>
    request<T>(endpoint, {
      ...options,
      method: 'POST',
      body: body ? JSON.stringify(body) : undefined,
    }),

  put: <T = unknown>(endpoint: string, body?: unknown, options?: RequestOptions) =>
    request<T>(endpoint, {
      ...options,
      method: 'PUT',
      body: body ? JSON.stringify(body) : undefined,
    }),

  patch: <T = unknown>(endpoint: string, body?: unknown, options?: RequestOptions) =>
    request<T>(endpoint, {
      ...options,
      method: 'PATCH',
      body: body ? JSON.stringify(body) : undefined,
    }),

  delete: <T = unknown>(endpoint: string, options?: RequestOptions) =>
    request<T>(endpoint, { ...options, method: 'DELETE' }),

  saveTokens,
  clearTokens,
  getAccessToken,
};
