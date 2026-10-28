import { describe, it, expect } from 'vitest';
import {
  HIS_MODES, HIS_MODE_FALLBACK, parseHisMode, resolveHisMode, isRuntimeModeEffective,
  allowsSeedLogin, allowsOutboundSend, showsSeedBadge, isSeedUuid, HIS_MODE_META,
} from './his-mode';

describe('운영 모드 — 런타임은 좁히기만 한다', () => {
  it('모드는 셋뿐이고 기본값은 가장 제한적인 REAL 이다', () => {
    expect([...HIS_MODES]).toEqual(['DEV', 'REHEARSAL', 'REAL']);
    expect(HIS_MODE_FALLBACK).toBe('REAL');
  });

  it('모르는 값은 만들어내지 않고 null 이다', () => {
    expect(parseHisMode('demo')).toBeNull();
    expect(parseHisMode(undefined)).toBeNull();
    expect(parseHisMode('rehearsal')).toBe('REHEARSAL'); // 대소문자는 관대하게
  });

  it('🔴 런타임이 빌드보다 넓히려 해도 넓어지지 않는다', () => {
    // 리얼 빌드에는 시드 모듈이 아예 없다 — 런타임으로 살아나면 화면이 거짓말을 한다
    expect(resolveHisMode('REAL', 'DEV')).toBe('REAL');
    expect(resolveHisMode('REAL', 'REHEARSAL')).toBe('REAL');
    expect(isRuntimeModeEffective('REAL', 'DEV')).toBe(false);
  });

  it('런타임이 더 좁히면 그대로 적용된다', () => {
    expect(resolveHisMode('REHEARSAL', 'REAL')).toBe('REAL');
    expect(resolveHisMode('DEV', 'REHEARSAL')).toBe('REHEARSAL');
    expect(isRuntimeModeEffective('DEV', 'REHEARSAL')).toBe(true);
  });

  it('런타임 미설정이면 빌드 모드를 그대로 쓴다(모르는 값으로 넓히지 않는다)', () => {
    expect(resolveHisMode('REHEARSAL', null)).toBe('REHEARSAL');
    expect(resolveHisMode(null, null)).toBe('REAL');
  });

  it('🔴 시드 로그인은 리얼에서 언제나 막힌다 — 대조군 포함', () => {
    expect(allowsSeedLogin('REAL')).toBe(false);
    expect(allowsSeedLogin('REHEARSAL')).toBe(true);   // 리허설에서 막으면 검수를 못 한다
    expect(allowsSeedLogin('DEV')).toBe(true);
  });

  it('🔴 대외 발신은 리얼에서만 나간다(리허설 중 실제 문자 사고 방지)', () => {
    expect(allowsOutboundSend('REHEARSAL')).toBe(false);
    expect(allowsOutboundSend('DEV')).toBe(false);
    expect(allowsOutboundSend('REAL')).toBe(true);     // 대조군 — 리얼까지 막으면 개통이 안 된다
  });

  it('리얼에는 상시 배너가 없다(거짓 경보가 진짜 경보를 죽인다)', () => {
    expect(HIS_MODE_META.REAL.banner).toBe('');
    expect(HIS_MODE_META.REHEARSAL.banner).toContain('실환자 데이터가 아닙니다');
    // 🔴 상시 노출 표기는 짧아야 한다 — 길면 자리를 잡아먹고, 길어서 안 읽히면 배너가 없는 것과 같다
    //    (2026-08-25 사람 신고: 배너 설명이 화면 한 칸을 통째로 먹었다)
    for (const m of ['DEV', 'REHEARSAL'] as const) {
      expect(HIS_MODE_META[m].short.length, `${m} short 가 길다`).toBeLessThanOrEqual(24);
      expect(HIS_MODE_META[m].label.length, `${m} label 이 길다`).toBeLessThanOrEqual(6);
      expect(HIS_MODE_META[m].short, `${m} short 에 라벨을 중복해 적지 않는다`).not.toContain(HIS_MODE_META[m].label);
    }
    expect(HIS_MODE_META.REAL.short).toBe('');
    expect(showsSeedBadge('REAL')).toBe(false);
    expect(showsSeedBadge('REHEARSAL')).toBe(true);
  });

  it('시드 UUID 표식은 접두 하나만 판정한다(한계를 넓혀 말하지 않는다)', () => {
    expect(isSeedUuid('00000000-0000-4000-8000-000000000001')).toBe(true);
    expect(isSeedUuid('3f2a1c4e-0000-4000-8000-000000000001')).toBe(false); // 해시 UUID 는 못 잡는다
    expect(isSeedUuid(null)).toBe(false);
  });
});
