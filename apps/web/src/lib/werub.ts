import { useCallback, useState } from 'react';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';

/**
 * WeRU.B AI 엔드포인트 호출 표준화 — `/api/v1/ai/` 프리픽스·`{data}` 언랩·에러 토스트를 한 곳에.
 * 27+개 화면이 각자 구현하던 보일러플레이트를 대체(점진 적용). 스트리밍은 별도(원시 fetch 유지).
 *
 * 반환: 성공 시 표준 { data } envelope를 단일 언랩한 payload(T), 실패 시 null(기본 토스트). `silent:true`면 토스트 억제.
 * ⚠️ 이중 래핑({data:{data}})을 내는 비표준 EP는 호출부에서 별도 언랩(공용 유틸은 단일 언랩만).
 */
export interface WerubCallOptions {
  method?: 'POST' | 'GET';
  errorMsg?: string;
  silent?: boolean;
}

export async function callWerub<T>(endpoint: string, body?: unknown, opts: WerubCallOptions = {}): Promise<T | null> {
  const path = `/api/v1/ai/${endpoint.replace(/^\/+/, '')}`;
  try {
    const res =
      opts.method === 'GET'
        ? await apiClient.get<{ data: T }>(path)
        : await apiClient.post<{ data: T }>(path, body);
    // 표준 { data, meta } envelope 단일 언랩(apiClient는 body를 그대로 반환). 이중 언랩 금지 — data 키 가진 payload의 형제 필드 유실 방지.
    return (res?.data ?? null) as T | null;
  } catch {
    if (!opts.silent) toast.error(opts.errorMsg ?? 'WeRU.B AI 요청에 실패했습니다.');
    return null;
  }
}

/** 로딩 상태를 함께 관리하는 훅 버전. */
export function useWerub() {
  const [loading, setLoading] = useState(false);
  const call = useCallback(<T,>(endpoint: string, body?: unknown, opts?: WerubCallOptions): Promise<T | null> => {
    setLoading(true);
    return callWerub<T>(endpoint, body, opts).finally(() => setLoading(false));
  }, []);
  return { call, loading };
}
