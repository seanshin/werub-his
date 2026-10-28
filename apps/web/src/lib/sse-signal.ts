import { apiClient } from '@/lib/api-client';

// fetch-streaming SSE 신호 구독 — 이벤트 수신 시 onSignal() 호출(메시지 재조회용).
// EventSource는 헤더 인증 불가 → fetch + ReadableStream 사용.
export function subscribeSseSignal(path: string, onSignal: () => void): () => void {
  const ctrl = new AbortController();
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || '';
  let stopped = false;

  (async () => {
    while (!stopped) {
      try {
        const res = await fetch(`${apiUrl}${path}`, {
          headers: { Authorization: `Bearer ${apiClient.getToken() ?? ''}` },
          signal: ctrl.signal,
        });
        if (!res.ok || !res.body) throw new Error(`SSE ${res.status}`);
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let buf = '';
        while (!stopped) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          if (buf.includes('data:')) { buf = ''; onSignal(); }
        }
      } catch {
        if (stopped) break;
        await new Promise((r) => setTimeout(r, 3000)); // 재연결 백오프
      }
    }
  })();

  return () => { stopped = true; ctrl.abort(); };
}
