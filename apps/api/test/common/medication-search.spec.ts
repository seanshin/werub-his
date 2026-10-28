import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { buildMedicationSearchWhere, medicationSearchOrTerms, MEDICATION_SEARCH_ORDER } from '../../src/common/medication-search';

/** 약물 검색 정본(한/영 병용 P1·D2) — 빌더 규약 + EP 채택 계약 */

describe('buildMedicationSearchWhere', () => {
  it('4항 OR — code startsWith(대문자)·nameKo/nameEn/ingredient contains(insensitive)', () => {
    const w = buildMedicationSearchWhere('amox');
    expect(w.OR).toEqual([
      { code: { startsWith: 'AMOX' } },
      { nameKo: { contains: 'amox', mode: 'insensitive' } },
      { nameEn: { contains: 'amox', mode: 'insensitive' } },
      { ingredient: { contains: 'amox', mode: 'insensitive' } },
    ]);
  });

  it('빈/공백 질의는 {} — 호출부 take 가 제한(브라우징)', () => {
    expect(buildMedicationSearchWhere('')).toEqual({});
    expect(buildMedicationSearchWhere('   ')).toEqual({});
  });

  it('trim 적용·정렬 규약은 nameKo asc 단일', () => {
    const w = buildMedicationSearchWhere('  타이레놀 ');
    expect((w.OR as { nameKo?: { contains: string } }[])[1].nameKo?.contains).toBe('타이레놀');
    expect(MEDICATION_SEARCH_ORDER).toEqual([{ nameKo: 'asc' }]);
  });

  it('medicationSearchOrTerms 는 합성용 배열(formulary category 합성 경로)', () => {
    expect(medicationSearchOrTerms('a')).toHaveLength(4);
    expect(medicationSearchOrTerms('')).toHaveLength(0);
  });
});

describe('EP 정본 채택 계약 — 약물 검색 경로는 공용 빌더만 쓴다(EP 별 재정의 금지)', () => {
  const ROOT = join(__dirname, '../../src');
  const ADOPTERS = [
    'modules/doctor-code/doctor-code.service.ts', // 처방 입력 주경로(useCodeSearch)
    'modules/code-master/code-master.service.ts', // useCodeSearch 폴백·TopBar
    'modules/voice-emr/voice-emr.service.ts', // 음성(+fuzzy 동의어 nameEn/ingredient)
    'modules/medical-terminology/medical-terminology.service.ts',
    'modules/order-set/order-set.service.ts',
    'modules/agent-session/agent-session.service.ts',
    'modules/formulary/formulary.service.ts', // OR 항 합성(medicationSearchOrTerms)
    'modules/fhir/fhir.controller.ts', // Medication 검색 name 파라미터
  ];

  it.each(ADOPTERS)('%s → medication-search 빌더 참조', (rel) => {
    const src = readFileSync(join(ROOT, rel), 'utf8');
    expect(/buildMedicationSearchWhere|medicationSearchOrTerms/.test(src)).toBe(true);
  });

  it('voice-emr 은 fuzzy 동의어에 nameEn·ingredient 를 주입한다(D9)', () => {
    const src = readFileSync(join(ROOT, 'modules/voice-emr/voice-emr.service.ts'), 'utf8');
    expect(src).toContain('getSynonyms');
    expect(/getSynonyms:\s*\(r\)\s*=>\s*\[r\.nameEn,\s*r\.ingredient\]/.test(src)).toBe(true);
  });

  it('포털 약설명은 완전일치 유지(오매칭 방지 설계 — contains 승격은 별도 판단)', () => {
    const src = readFileSync(join(ROOT, 'modules/portal/drug-explain.service.ts'), 'utf8');
    expect(src).toContain("nameKo: name");
  });
});
