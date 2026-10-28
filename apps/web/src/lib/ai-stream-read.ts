import { createAiStreamLineBuffer, parseAiStreamLine } from '@hospital-run/shared';

/**
 * AI 스트림(NDJSON·SSE) 본문을 끝까지 읽어 `field` 글자를 이어 붙인다.
 *  · 청크 경계에 걸친 줄을 잇는다(종전엔 경계에서 잘린 줄을 버렸다)
 *  · 중간 오류 이벤트(server_busy 등 — 헤더는 200 이라 줄 안에만 있다)를 만나면 읽기를 멈추고 오류로 돌려준다
 *    → 받은 앞부분은 돌려주지 않는다(끊긴 글을 완결된 결과로 쓰지 않는다)
 */
export type AiTextStreamResult = { ok: true; text: string } | { ok: false; busy: boolean; retryAfterSec: number | null };

export async function readAiTextStream(body: ReadableStream<Uint8Array>, field: string, onText?: (text: string) => void): Promise<AiTextStreamResult> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const buf = createAiStreamLineBuffer();
  let text = '';
  let failure: AiTextStreamResult | null = null;
  const take = (lines: string[]) => {
    for (const line of lines) {
      const p = parseAiStreamLine(line);
      if (p.kind === 'error') { failure = { ok: false, busy: p.busy, retryAfterSec: p.retryAfterSec }; return; }
      const v = p.kind === 'data' ? p.obj[field] : null;
      if (typeof v === 'string' && v) { text += v; onText?.(text); }
    }
  };
  while (!failure) {
    const { done, value } = await reader.read();
    if (done) { take(buf.flush()); break; }
    take(buf.push(decoder.decode(value, { stream: true })));
  }
  if (failure) {
    // 남은 본문은 받지 않는다 — 취소 실패는 이미 끝난 스트림이라 결과에 영향이 없다
    await reader.cancel().catch(() => undefined);
    return failure;
  }
  return { ok: true, text };
}

/**
 * SOAP 스트림 완결 텍스트 → A·P (2026-10-07 운영 실측).
 * 🔴 상류는 `{"summary":{"subjective","objective","assessment","plan"}, ...}` **JSON 문자열**을 흘려보낸다 —
 *    종전 화면은 `A:`·`P:` 로 시작하는 줄만 찾아 **초안이 한 번도 만들어지지 않았다**(P11).
 * JSON 이 우선 · 아니면 종전 `A:/P:` 글 형식 · 둘 다 없으면 null(빈 초안을 만들지 않는다).
 */
export function soapFromStreamText(text: string): { assessment: string; plan: string } | null {
  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  const t = text.trim();
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try {
      const o = JSON.parse(t.slice(start, end + 1)) as Record<string, unknown>;
      const s = (o.summary && typeof o.summary === 'object' ? o.summary : o) as Record<string, unknown>;
      const assessment = str(s.assessment);
      const plan = str(s.plan);
      if (assessment || plan) return { assessment, plan };
    } catch { /* JSON 이 아니면 글 형식으로 읽는다 */ }
  }
  const a = t.match(/(?:^|\n)(?:A|Assessment)[:\s]*([\s\S]+?)(?=\n(?:P|Plan)[:\s]|$)/i);
  const p = t.match(/(?:^|\n)(?:P|Plan)[:\s]*([\s\S]+?)$/i);
  const assessment = a ? a[1].trim() : '';
  const plan = p ? p[1].trim() : '';
  return assessment || plan ? { assessment, plan } : null;
}
