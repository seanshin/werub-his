/**
 * AI 서버 스트리밍 응답 한 줄 해석.
 *
 * 🔴 스트림은 헤더(200)를 먼저 보내므로 **중간에 오는 오류는 HTTP 상태로 드러나지 않는다** — 줄 안의 오류 이벤트를 읽어야 한다.
 *    종전 소비처는 오류 줄을 "비JSON·내용 없음"으로 조용히 건너뛰어, 바쁨·생성 실패가 "짧은(빈) 결과"로 보였다.
 * 형식은 NDJSON(`{...}`)과 SSE(`data: {...}`) 둘 다 받는다 · `event:`·주석(`:`)·빈 줄은 무시.
 * 오류 판정은 상류가 실은 필드만 본다(code·status·error) — 모르는 오류도 오류다(내용으로 바꿔 말하지 않는다).
 */
export type AiStreamLine =
  | { kind: 'skip' }
  | { kind: 'data'; obj: Record<string, unknown> }
  | { kind: 'error'; busy: boolean; code: string | null; retryAfterSec: number | null; message: string | null };

export const AI_STREAM_BUSY_CODE = 'server_busy';

export function parseAiStreamLine(raw: string): AiStreamLine {
  let line = raw.trim();
  if (!line || line.startsWith(':') || line.startsWith('event:') || line.startsWith('id:') || line.startsWith('retry:')) return { kind: 'skip' };
  if (line.startsWith('data:')) line = line.slice(5).trim();
  if (!line || line === '[DONE]') return { kind: 'skip' };
  let obj: unknown;
  try { obj = JSON.parse(line); } catch { return { kind: 'skip' }; }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return { kind: 'skip' };
  const o = obj as Record<string, unknown>;
  const code = typeof o.code === 'string' ? o.code : null;
  const status = typeof o.status === 'number' ? o.status : null;
  const errField = o.error;
  // AI 서버 회신(10-07) 형식: `{"event": "error", "code": "server_busy", "status": 429, "retry_after": 5}`
  const isError = o.event === 'error' || code === AI_STREAM_BUSY_CODE || (status != null && status >= 400) || (errField != null && errField !== false && errField !== '');
  if (!isError) return { kind: 'data', obj: o };
  const ra = typeof o.retry_after === 'number' && Number.isFinite(o.retry_after) && o.retry_after > 0 ? o.retry_after : null;
  const message = typeof errField === 'string' ? errField : typeof o.message === 'string' ? o.message : null;
  return { kind: 'error', busy: code === AI_STREAM_BUSY_CODE || status === 429, code, retryAfterSec: ra, message };
}

/** 청크 경계에 걸친 줄을 잇는 버퍼 — 마지막 미완성 줄은 다음 청크까지 들고 있는다 */
export function createAiStreamLineBuffer() {
  let rest = '';
  return {
    push(chunk: string): string[] {
      const parts = (rest + chunk).split('\n');
      rest = parts.pop() ?? '';
      return parts;
    },
    flush(): string[] {
      const last = rest;
      rest = '';
      return last.trim() ? [last] : [];
    },
  };
}
