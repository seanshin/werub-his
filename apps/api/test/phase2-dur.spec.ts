import { describe, it, expect } from 'vitest';

/**
 * 🔴 이 스펙은 **판정 가드가 아니다.** 아래 함수들은 DurService 를 부르지 않고 로직을 재구현했고,
 *    입력도 한글 성분명('와파린')이라 운영 어휘(영문 INN 'warfarin sodium')와 무관하다.
 *    그래서 2026-08-18 까지 55룰 중 42룰이 운영에서 한 번도 매칭되지 않는 동안 계속 초록이었다.
 *    실제 판정 가드는 test/prescription/dur-real-vocabulary.spec.ts (실제 서비스 × 실제 약품 어휘).
 *    이 파일은 룰 표(表)의 의도를 적어둔 문서로만 읽을 것.
 */

// DUR 상호작용 룰 (서비스에서 사용하는 것과 동일)
const INTERACTION_RULES = [
  { drugA: '와파린', drugB: '아스피린', severity: 'ERROR' },
  { drugA: '와파린', drugB: '이부프로펜', severity: 'ERROR' },
  { drugA: '메트포르민', drugB: '조영제', severity: 'WARNING' },
  { drugA: '아목시실린', drugB: '메토트렉세이트', severity: 'WARNING' },
  { drugA: 'ACE억제제', drugB: '칼륨보존이뇨제', severity: 'WARNING' },
  { drugA: '시프로플록사신', drugB: '테오필린', severity: 'ERROR' },
  { drugA: '클래리스로마이신', drugB: '스타틴', severity: 'ERROR' },
  { drugA: 'SSRI', drugB: 'MAO억제제', severity: 'ERROR' },
];

function checkInteraction(newDrug: string, existingDrugs: string[]) {
  const warnings: { severity: string; drugA: string; drugB: string }[] = [];
  for (const rule of INTERACTION_RULES) {
    const matchA = newDrug.includes(rule.drugA) && existingDrugs.some(d => d.includes(rule.drugB));
    const matchB = newDrug.includes(rule.drugB) && existingDrugs.some(d => d.includes(rule.drugA));
    if (matchA || matchB) {
      warnings.push({ severity: rule.severity, drugA: rule.drugA, drugB: rule.drugB });
    }
  }
  return warnings;
}

function checkDuplicate(newIngredient: string, existingIngredients: string[]) {
  return existingIngredients.filter(i => i === newIngredient).length > 0;
}

describe('DUR Check Logic', () => {
  describe('Drug Interaction', () => {
    it('와파린 + 아스피린 → ERROR', () => {
      const warnings = checkInteraction('와파린', ['아스피린']);
      expect(warnings).toHaveLength(1);
      expect(warnings[0].severity).toBe('ERROR');
    });

    it('SSRI + MAO억제제 → ERROR', () => {
      const warnings = checkInteraction('SSRI', ['MAO억제제']);
      expect(warnings).toHaveLength(1);
      expect(warnings[0].severity).toBe('ERROR');
    });

    it('메트포르민 + 조영제 → WARNING', () => {
      const warnings = checkInteraction('메트포르민', ['조영제']);
      expect(warnings).toHaveLength(1);
      expect(warnings[0].severity).toBe('WARNING');
    });

    it('아목시실린 + 타이레놀 → no interaction', () => {
      const warnings = checkInteraction('아목시실린', ['아세트아미노펜']);
      expect(warnings).toHaveLength(0);
    });

    it('multiple interactions detected', () => {
      const warnings = checkInteraction('와파린', ['아스피린', '이부프로펜']);
      expect(warnings.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('Duplicate Check', () => {
    it('same ingredient → duplicate', () => {
      expect(checkDuplicate('아세트아미노펜', ['아세트아미노펜', '아목시실린'])).toBe(true);
    });

    it('different ingredient → no duplicate', () => {
      expect(checkDuplicate('아목시실린', ['아세트아미노펜', '로사르탄'])).toBe(false);
    });
  });
});
