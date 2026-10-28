/**
 * AI 스트림 읽기.
 *  · 청크 경계에 걸친 줄을 잇는다 · 중간 오류 이벤트에서 멈추고 앞부분을 돌려주지 않는다 · 바쁨/그 밖 오류 구분
 *  · SOAP 패널이 이 읽기를 쓰고, 시작 429 는 바쁨 문구로(구조 가드)
 * 재주입: 위 규칙 하나를 되돌리면 실패한다.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { readAiTextStream, soapFromStreamText } from '@/lib/ai-stream-read';

const body = (chunks: string[]) => new ReadableStream<Uint8Array>({
  start(c) { for (const x of chunks) c.enqueue(new TextEncoder().encode(x)); c.close(); },
});

describe('readAiTextStream', () => {
  it('🔴 청크 경계에 걸친 줄도 잇는다', async () => {
    const seen: string[] = [];
    const r = await readAiTextStream(body(['{"respo', 'nse":"A: 폐렴"}\n{"response":"\\nP: 항생제"}']), 'response', (t) => seen.push(t));
    expect(r).toEqual({ ok: true, text: 'A: 폐렴\nP: 항생제' });
    expect(seen.at(-1)).toBe('A: 폐렴\nP: 항생제');
  });
  it('🔴 중간 server_busy 이벤트 → 바쁨 · 받은 앞부분은 돌려주지 않는다', async () => {
    const r = await readAiTextStream(body(['{"response":"A: 폐"}\n', 'data: {"error":"server busy","code":"server_busy","status":429,"retry_after":5}\n', '{"response":"렴"}\n']), 'response');
    expect(r).toEqual({ ok: false, busy: true, retryAfterSec: 5 });
  });
  it('바쁨 아닌 오류 이벤트는 busy=false', async () => {
    expect(await readAiTextStream(body(['{"error":"generation_failed","status":502}\n']), 'response')).toMatchObject({ ok: false, busy: false });
  });
});

describe('soapFromStreamText — 상류 JSON 형식(운영 실측)', () => {
  const real = '{"summary": {"subjective":"3일 전부터 기침","objective":"수포음","assessment":"상기도감염, ICD-10 코드 J06.9","plan":"발열 및 증상 관찰"},"icd_codes":["J06.9"],"urgency":"medium"}';
  it('🔴 JSON 의 summary.assessment·plan 을 읽는다(종전 A:/P: 줄 찾기는 초안 0)', () => {
    expect(soapFromStreamText(real)).toEqual({ assessment: '상기도감염, ICD-10 코드 J06.9', plan: '발열 및 증상 관찰' });
  });
  it('대조군 — 글 형식 A:/P: 도 읽는다', () => {
    expect(soapFromStreamText('S: 기침\nA: 폐렴\nP: 항생제')).toEqual({ assessment: '폐렴', plan: '항생제' });
  });
  it('🔴 둘 다 없으면 null — 빈 초안을 만들지 않는다', () => {
    expect(soapFromStreamText('{"summary":{"subjective":"x"}}')).toBeNull();
    expect(soapFromStreamText('')).toBeNull();
  });
});

describe('SOAP 스트리밍 패널 배선', () => {
  const src = readFileSync(resolve(__dirname, '../../src/app/(main)/patients/[id]/encounter/new/components/AiAssistantPanel.tsx'), 'utf8');
  it('🔴 정본 읽기를 쓰고(자체 JSON.parse 줄 루프 없음) · 시작 429 는 바쁨 문구', () => {
    expect(src).toMatch(/readAiTextStream\(response\.body!/);
    expect(src).not.toMatch(/chunk\.split\('\\n'\)/);
    expect(src).toMatch(/soapFromStreamText\(streamed\.text\)/);
    expect(src).not.toMatch(/fullText\.match\(/);
    expect(src).toMatch(/response\.status === 429\)[\s\S]{0,80}AI 서버가 바쁩니다/);
  });
});
