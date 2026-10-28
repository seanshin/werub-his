import { describe, it, expect } from 'vitest';
import { anesthesiaText, isCanonicalAnesthesiaCode, isKoreanAnesthesiaForm } from '../src/anesthesia';

/**
 * 마취 종류 표기 계약 — 2026-08-12 (화면 점검 W2 · 패턴 P4).
 *
 * 🔴 수술방 관리가 `GENERAL`·`LOCAL` 을 그대로 찍고 있었다(라벨표는 post-op 에만 로컬로 존재).
 * 🔴 게다가 **DB 에 영문 코드와 한글이 섞여** 있다(`GENERAL` 1 / `전신마취` 5 · `LOCAL` 1 /
 *    `국소마취` 1 / `척추마취` 1). `anesthesia_type` 이 자유 문자열이라 입력 경로마다 다르게 넣는다.
 */

describe('마취 종류 표기', () => {
  it('영문 코드를 한글로 말한다', () => {
    expect(anesthesiaText('GENERAL')).toBe('전신마취');
    expect(anesthesiaText('LOCAL')).toBe('국소마취');
    expect(anesthesiaText('SPINAL')).toBe('척추마취');
  });

  it('🔴 한글로 저장된 값도 그대로 인정한다(DB 에 실재한다)', () => {
    expect(anesthesiaText('전신마취')).toBe('전신마취');
    expect(anesthesiaText('국소마취')).toBe('국소마취');
    expect(anesthesiaText('부분마취')).toBe('부분마취');
  });

  it('대소문자가 달라도 찾는다', () => {
    expect(anesthesiaText('general')).toBe('전신마취');
  });

  it('모르는 값은 뭉개지 않는다 — 임상 기재를 "기타"로 지우지 않는다', () => {
    expect(anesthesiaText('경부신경총차단')).toBe('경부신경총차단');
  });

  it('없으면 폴백', () => {
    expect(anesthesiaText(null)).toBe('-');
    expect(anesthesiaText('   ')).toBe('-');
    expect(anesthesiaText(undefined, '미기재')).toBe('미기재');
  });

  it('마이그레이션 대상(한글 저장분)을 식별할 수 있다', () => {
    expect(isCanonicalAnesthesiaCode('GENERAL')).toBe(true);
    expect(isCanonicalAnesthesiaCode('전신마취')).toBe(false);
    expect(isKoreanAnesthesiaForm('전신마취')).toBe(true);
    expect(isKoreanAnesthesiaForm('GENERAL')).toBe(false);
  });
});
