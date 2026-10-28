import { describe, it, expect } from 'vitest';
import { floatToInt16, downsampleTo16k, frameToPcm16 } from './audio-pcm';
import { ChunkScheduler } from './chunk-scheduler';

describe('PCM 변환', () => {
  it('Float32→Int16 클램프', () => {
    const r = floatToInt16(new Float32Array([0, 1, -1, 2, -2, 0.5]));
    expect(r[0]).toBe(0);
    expect(r[1]).toBe(32767);
    expect(r[2]).toBe(-32768);
    expect(r[3]).toBe(32767); // 클램프
    expect(r[4]).toBe(-32768);
  });
  it('48k→16k 다운샘플(길이 1/3)', () => {
    const input = new Float32Array(48000).fill(0.5);
    const out = downsampleTo16k(input, 48000);
    expect(out.length).toBe(16000);
    expect(out[0]).toBeCloseTo(0.5, 5);
  });
  it('16k 이하는 그대로', () => {
    const input = new Float32Array([0.1, 0.2]);
    expect(downsampleTo16k(input, 16000)).toBe(input);
  });
  it('frameToPcm16 종단(48k→16k Int16)', () => {
    const out = frameToPcm16(new Float32Array(4800).fill(1), 48000);
    expect(out.length).toBe(1600);
    expect(out[0]).toBe(32767);
  });
});

describe('청크 스케줄러(25s 강제 final·sid 순환)', () => {
  it('start → sid 발급·chunkMs 주기 partial', () => {
    let n = 0;
    const s = new ChunkScheduler({ chunkMs: 1500, newId: () => `u${++n}` });
    const sid = s.start(0);
    expect(sid).toBe('u1');
    expect(s.tick(1000).type).toBe('none');   // 1s < 1.5s
    expect(s.tick(1500)).toMatchObject({ type: 'partial', sid: 'u1' });
    expect(s.tick(2000).type).toBe('none');
    expect(s.tick(3000)).toMatchObject({ type: 'partial', sid: 'u1' });
  });

  it('25초 도달 → 강제 final + 새 sid 로 이어감', () => {
    let n = 0;
    const s = new ChunkScheduler({ chunkMs: 1500, forceFinalMs: 25000, newId: () => `u${++n}` });
    s.start(0); // u1
    const a = s.tick(25000);
    expect(a).toMatchObject({ type: 'final', sid: 'u1', reason: 'forced', nextSid: 'u2' });
    expect(s.currentSid).toBe('u2'); // 즉시 새 발화 세션
    // 새 세션도 주기 동작
    expect(s.tick(26500)).toMatchObject({ type: 'partial', sid: 'u2' });
  });

  it('end → final(reason:end)·sid 소거', () => {
    const s = new ChunkScheduler();
    s.start(0);
    expect(s.end()).toMatchObject({ type: 'final', reason: 'end' });
    expect(s.tick(5000).type).toBe('none'); // 세션 종료 후 무동작
  });

  it('chunkMs 하한 1.5s 강제(과세분 금지)', () => {
    const s = new ChunkScheduler({ chunkMs: 500 }); // 500 요청해도 1500 하한
    s.start(0);
    expect(s.tick(800).type).toBe('none');
    expect(s.tick(1500).type).toBe('partial');
  });
});
