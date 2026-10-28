'use client';

import { useEffect, useRef, useState } from 'react';
import { apiClient } from '@/lib/api-client';
import { T } from '@/components/ui/i18n-text';

/**
 * FR-10 관제 실시간 갱신 — `GET /api/v1/journey-console/stream`(SSE) 구독.
 *
 * 🔴 폴링은 **끄지 않는다** — 스트림은 "지금 바뀌었다" 힌트일 뿐이고, 끊겨도 보드는 폴링으로 갱신된다.
 *    그래서 끊김은 경보가 아니라 사실 표시다("실시간 연결 끊김 — 주기 갱신 중").
 * 🔴 인증·권한 실패(401·403)는 **재시도하지 않고** 그 사실을 말한다 — 서버는 가드로 응답 전에 거절한다(200+빈 스트림 아님).
 * EventSource 는 헤더 인증이 안 돼 fetch + ReadableStream 을 쓴다(통합 상황판과 같은 방식).
 */
export type LiveStreamStatus = 'connecting' | 'live' | 'disconnected' | 'unauthorized';

export function useJourneyConsoleStream(onRefresh: () => void): LiveStreamStatus {
  const [status, setStatus] = useState<LiveStreamStatus>('connecting');
  const onRefreshRef = useRef(onRefresh);
  onRefreshRef.current = onRefresh;

  useEffect(() => {
    const abort = new AbortController();
    let stopped = false;
    (async function connect() {
      while (!stopped) {
        try {
          const token = apiClient.getToken();
          if (!token) { setStatus('unauthorized'); return; }
          const res = await fetch('/api/v1/journey-console/stream', {
            headers: { Authorization: `Bearer ${token}`, Accept: 'text/event-stream' },
            signal: abort.signal,
          });
          if (res.status === 401 || res.status === 403) { setStatus('unauthorized'); return; }
          if (!res.ok || !res.body) throw new Error(`stream ${res.status}`);
          setStatus('live');
          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let buffer = '';
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const parts = buffer.split('\n\n');
            buffer = parts.pop() ?? '';
            for (const part of parts) {
              const line = part.split('\n').find((l) => l.startsWith('data:'));
              if (!line) continue;
              let msg: { type?: string } | null = null;
              try { msg = JSON.parse(line.slice(5)); } catch { msg = null; }
              if (msg?.type === 'refresh') onRefreshRef.current();
            }
          }
          if (!stopped) setStatus('disconnected');
        } catch {
          if (stopped) return;
          setStatus('disconnected');
        }
        if (!stopped) await new Promise((r) => setTimeout(r, 5000));
      }
    })();
    return () => { stopped = true; abort.abort(); };
  }, []);

  return status;
}

export function LiveStreamBadge({ status }: { status: LiveStreamStatus }) {
  if (status === 'live') {
    return <span className="text-emerald-600" data-testid="jc-live" data-status="live">● <T k="실시간 연결됨" /></span>;
  }
  if (status === 'unauthorized') {
    return <span className="text-gray-500" data-testid="jc-live" data-status="unauthorized"><T k="실시간 갱신 권한 없음 — 주기 갱신만" /></span>;
  }
  if (status === 'disconnected') {
    return <span className="text-amber-600" data-testid="jc-live" data-status="disconnected"><T k="실시간 연결 끊김 — 주기 갱신 중" /></span>;
  }
  return <span className="text-gray-400" data-testid="jc-live" data-status="connecting"><T k="실시간 연결 중" /></span>;
}
