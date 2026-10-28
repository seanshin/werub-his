import { describe, it, expect } from 'vitest';
import { summarizeMapGate, gateMode } from '../../src/common/gate-mode';

/**
 * 영역별 맵 게이트 대표 모드 가드.
 *
 * 🔴 실측 결함 둘(2026-08-19):
 *   ① `gateMode({MEDICATION:'WARN'})` 은 `String(raw)` 가 `"[object Object]"` 라 **무조건 BLOCK**.
 *      → 안전 게이트 관제가 **전 영역 OFF 인 포뮬러리를 "BLOCK"** 으로 표시했다(정반대의 사실).
 *   ② 관제의 다른 경로는 "하나라도 BLOCK 이면 BLOCK"(최강)으로 접어,
 *      7영역 중 1개만 BLOCK 이어도 붉은 배지가 떠 **여섯 영역이 열린 사실이 가려졌다.**
 *   go-live 는 이미 최저 기준이었다 — **정본이 둘이었다.**
 */
describe('맵 게이트 — 최저 영역이 기준이다(안전은 가장 약한 고리로 정해진다)', () => {
  it('🔴 gateMode 는 맵을 접을 수 없다 — 그래서 맵에 쓰면 안 된다(무조건 BLOCK 이 된다)', () => {
    expect(gateMode({ MEDICATION: 'OFF' } as unknown)).toBe('BLOCK'); // 이 동작이 결함의 원인이었다
  });

  it('한 영역이라도 OFF 면 대표 모드는 OFF', () => {
    const s = summarizeMapGate({ MEDICATION: 'BLOCK', LAB: 'BLOCK', IMAGING: 'OFF' });
    expect(s.mode).toBe('OFF');
    expect(s.active).toBe(2);
    expect(s.total).toBe(3);
  });

  it('🔴 하나만 BLOCK 이어도 BLOCK 이라 말하지 않는다', () => {
    expect(summarizeMapGate({ MEDICATION: 'BLOCK', LAB: 'OFF' }).mode).not.toBe('BLOCK');
  });

  it('전부 BLOCK 일 때만 BLOCK · 섞이면 WARN', () => {
    expect(summarizeMapGate({ A: 'BLOCK', B: 'BLOCK' }).mode).toBe('BLOCK');
    expect(summarizeMapGate({ A: 'BLOCK', B: 'WARN' }).mode).toBe('WARN');
  });

  it('설정된 영역이 없으면 "전부 OFF"와 구분한다 — 다른 사실이다', () => {
    const s = summarizeMapGate({});
    expect(s.unset).toBe(true);
    expect(s.total).toBe(0);
    expect(s.detail).toContain('설정된 영역 없음');
  });

  it('커버리지를 분모와 함께 낸다', () => {
    const s = summarizeMapGate({ A: 'WARN', B: 'OFF', C: 'BLOCK' });
    expect(`${s.active}/${s.total}`).toBe('2/3');
    expect(s.detail).toContain('A:WARN');
    expect(s.detail).toContain('B:OFF');
  });
});
