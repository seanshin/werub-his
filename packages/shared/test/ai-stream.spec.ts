import { describe, it, expect } from 'vitest';
import { parseAiStreamLine, createAiStreamLineBuffer } from '../src/ai-stream';

describe('AI 스트림 한 줄 해석', () => {
  it('🔴 SSE 오류 이벤트 server_busy → busy·retry_after', () => {
    expect(parseAiStreamLine('data: {"error":"server busy","code":"server_busy","status":429,"retry_after":5}')).toEqual({ kind: 'error', busy: true, code: 'server_busy', retryAfterSec: 5, message: 'server busy' });
  });
  it('🔴 AI 서버 회신 형식 그대로 — event:error · 상태 없이 event 만 있어도 오류', () => {
    expect(parseAiStreamLine('data: {"event": "error", "code": "server_busy", "status": 429, "retry_after": 5}')).toEqual({ kind: 'error', busy: true, code: 'server_busy', retryAfterSec: 5, message: null });
    expect(parseAiStreamLine('{"event":"error","code":"generation_failed"}')).toMatchObject({ kind: 'error', busy: false, code: 'generation_failed' });
    expect(parseAiStreamLine('{"event":"token","response":"x"}').kind).toBe('data');
  });
  it('🔴 NDJSON 오류 줄도 같은 판정 · 바쁨 아닌 오류는 busy=false', () => {
    expect(parseAiStreamLine('{"code":"server_busy","status":429}')).toMatchObject({ kind: 'error', busy: true, retryAfterSec: null });
    expect(parseAiStreamLine('{"error":"generation_failed","status":502}')).toMatchObject({ kind: 'error', busy: false, code: null });
  });
  it('대조군 — 내용 줄은 data · error:false·빈 문자열은 오류 아님', () => {
    expect(parseAiStreamLine('{"response":"S: 기침"}')).toEqual({ kind: 'data', obj: { response: 'S: 기침' } });
    expect(parseAiStreamLine('data: {"response":"x","error":null}').kind).toBe('data');
    expect(parseAiStreamLine('{"done":true,"error":""}').kind).toBe('data');
  });
  it('event·주석·[DONE]·비JSON 은 건너뜀', () => {
    for (const l of ['event: error', ': ping', 'data: [DONE]', 'hello', '', '[1,2]']) expect(parseAiStreamLine(l).kind).toBe('skip');
  });
  it('🔴 청크 경계에 걸친 줄을 잇는다', () => {
    const b = createAiStreamLineBuffer();
    expect(b.push('{"respon')).toEqual([]);
    expect(b.push('se":"a"}\n{"response":"b"}')).toEqual(['{"response":"a"}']);
    expect(b.flush()).toEqual(['{"response":"b"}']);
  });
});
