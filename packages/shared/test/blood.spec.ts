import { describe, it, expect } from 'vitest';
import { rhSign, bloodTypeText } from '../src/blood';

/**
 * Rh 표기 정본 계약 (2026-08-13 · 화면 점검 W3).
 *
 * 🔴 원결함: 출고 화면이 `rh === 'NEGATIVE' ? '-' : '+'` 로 판정 — DB 정본은 POS/NEG
 * (VarChar(3)·'NEGATIVE'는 저장 불가)라 삼항이 영원히 거짓 → O− 혈액이 "O+"로 표시됐다.
 * 워크스테이션의 `rh === 'POS' ? '+' : '-'` 는 미입력(null)을 음성으로 단정(P10).
 */
describe('rhSign', () => {
  it('🔴 NEG 는 음성(-) — DB 정본 값으로 판정한다', () => {
    expect(rhSign('NEG')).toBe('-');
  });
  it('POS 는 양성(+)', () => {
    expect(rhSign('POS')).toBe('+');
  });
  it('🔴 모르는 값(null·미상 문자열)은 단정하지 않는다 — 혈액형에서 추정 금지', () => {
    expect(rhSign(null)).toBe('?');
    expect(rhSign(undefined)).toBe('?');
    expect(rhSign('NEGATIVE')).toBe('?'); // 구 결함이 쓰던 존재 불가 값 — 양성으로도 음성으로도 안 만든다
    expect(rhSign('')).toBe('?');
  });
});

describe('bloodTypeText', () => {
  it('ABO+Rh 합성', () => {
    expect(bloodTypeText('O', 'NEG')).toBe('O-');
    expect(bloodTypeText('AB', 'POS')).toBe('AB+');
  });
  it('ABO 미상도 ? 로 정직하게', () => {
    expect(bloodTypeText(null, 'POS')).toBe('?+');
    expect(bloodTypeText('A', null)).toBe('A?');
  });
});
