import { describe, it, expect } from 'vitest';
import { dietTypeText, dietTextureText, DIET_TYPE_LABEL, isCanonicalDietCode } from '../src/diet';

/**
 * 식이 표기 계약 — 2026-08-12 (화면 점검 W2 · 패턴 P4·P12).
 *
 * 🔴 라벨표가 두 파일에 각자 있고 내용이 달랐다(급식 7종 / 영양관리 15종).
 *    급식 화면에는 `HIGH_PROTEIN` 이 **없어서** 고단백식이 영문으로 샐 수 있었다.
 * 🔴 질감(texture) 라벨은 **아예 없어** `SOFT`·`REGULAR` 가 그대로 떴다.
 * 🔴 DB 에 영문 코드와 한글이 섞여 있다(`DIABETIC` 과 `일반식`·`저단백식(CKD)` 이 공존).
 */

describe('식이 표기', () => {
  it('코드를 한글로 말한다 — 두 화면이 같은 답을 낸다', () => {
    expect(dietTypeText('HIGH_PROTEIN')).toBe('고단백식');
    expect(dietTypeText('RENAL')).toBe('신장식');
    expect(dietTypeText('DIABETIC')).toBe('당뇨식');
  });

  it('🔴 한글로 저장된 값도 그대로 인정한다(DB 에 실재한다)', () => {
    expect(dietTypeText('일반식')).toBe('일반식');
    expect(dietTypeText('저염식')).toBe('저염식');
  });

  it('🔴 코드 체계에 없는 임상 기재는 지우지 않는다', () => {
    expect(dietTypeText('저단백식(CKD)')).toBe('저단백식(CKD)');
    expect(isCanonicalDietCode('저단백식(CKD)')).toBe(false);
  });

  it('🔴 질감도 한글로 — 연하장애 안전과 직결된다', () => {
    expect(dietTextureText('SOFT')).toBe('연식');
    expect(dietTextureText('REGULAR')).toBe('일반');
    expect(dietTextureText('PUREED')).toBe('갈은식');
    expect(dietTextureText('THICKENED')).toBe('점도증진');
  });

  it('없으면 폴백', () => {
    expect(dietTypeText(null)).toBe('-');
    expect(dietTextureText('  ')).toBe('-');
  });

  it('금식(NPO)은 반드시 등재돼 있다 — 빠지면 영문이 새어 오연 위험', () => {
    expect(DIET_TYPE_LABEL.NPO).toBe('금식');
  });
});
