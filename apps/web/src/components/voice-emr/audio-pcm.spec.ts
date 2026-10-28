import { describe, it, expect } from 'vitest';
import { pcmHasSpeech, floatToInt16, downsampleTo16k } from './audio-pcm';

function sine(amp: number, len = 16000, freq = 200, rate = 16000): Int16Array {
  const a = new Int16Array(len);
  for (let i = 0; i < len; i++) a[i] = Math.round(amp * Math.sin((2 * Math.PI * freq * i) / rate));
  return a;
}

describe('pcmHasSpeech (클라이언트 VAD)', () => {
  it('완전 무음은 false(전송 안 함)', () => {
    expect(pcmHasSpeech(new Int16Array(16000))).toBe(false);
  });
  it('낮은 마이크 노이즈(RMS<180)는 false', () => {
    const a = new Int16Array(16000);
    for (let i = 0; i < a.length; i++) a[i] = i % 2 ? 60 : -60; // RMS 60
    expect(pcmHasSpeech(a)).toBe(false);
  });
  it('명확한 발화(사인 amp3000)는 true', () => {
    expect(pcmHasSpeech(sine(3000))).toBe(true);
  });
  it('조용한 발화(사인 amp300·RMS~212)도 통과(실 발화 미탈락)', () => {
    expect(pcmHasSpeech(sine(300))).toBe(true);
  });
  it('너무 짧은 청크(<50ms@16k)는 false', () => {
    expect(pcmHasSpeech(sine(3000, 400))).toBe(false);
  });
  it('임계 조정 가능(엄격 임계면 조용한 발화 탈락)', () => {
    expect(pcmHasSpeech(sine(300), 400, 20000)).toBe(false); // rms 212<400 & peak 300<20000
  });
});

describe('audio-pcm 변환 유틸', () => {
  it('floatToInt16 클리핑', () => {
    const out = floatToInt16(new Float32Array([0, 1, -1, 2, -2]));
    expect(out[0]).toBe(0);
    expect(out[1]).toBe(32767);
    expect(out[2]).toBe(-32768);
    expect(out[3]).toBe(32767); // 클램프
    expect(out[4]).toBe(-32768);
  });
  it('downsampleTo16k: 48k→16k 길이 1/3', () => {
    const out = downsampleTo16k(new Float32Array(4800), 48000);
    expect(out.length).toBe(1600);
  });
  it('downsampleTo16k: 이미 16k 이하면 그대로', () => {
    const inp = new Float32Array(1600);
    expect(downsampleTo16k(inp, 16000)).toBe(inp);
  });
});
