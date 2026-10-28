import { describe, it, expect } from 'vitest';
import { extractClinicalEntities, entitiesToSoap } from '../../src/modules/scribe/clinical-ner';

/**
 * 스크라이브 S3 임상 NER 골든 — 활력(수사 정규화)·약물(용량/빈도/기간)·증상(부정)·계획.
 * 순수·결정적. STT 확정 후 SOAP 초안 품질에 반영될 추출 계약을 고정.
 */
describe('clinical-ner 활력징후', () => {
  it('혈압(구어 수사) 백이십에 팔십 → BP [120,80]', () => {
    const { vitals } = extractClinicalEntities('환자분 혈압은 백이십에 팔십입니다');
    expect(vitals.find((v) => v.type === 'BP')?.value).toEqual([120, 80]);
  });
  it('혈압 120/80 표기도 추출', () => {
    const { vitals } = extractClinicalEntities('BP 120/80 측정');
    expect(vitals.find((v) => v.type === 'BP')?.value).toEqual([120, 80]);
  });
  it('체온·맥박·산소포화도 동시 추출 + 범위 밖 오탐 배제', () => {
    const { vitals } = extractClinicalEntities('체온 37.5도, 맥박 72회, 산소포화도 98퍼센트');
    expect(vitals.find((v) => v.type === 'TEMP')?.value).toEqual([37.5]);
    expect(vitals.find((v) => v.type === 'HR')?.value).toEqual([72]);
    expect(vitals.find((v) => v.type === 'SPO2')?.value).toEqual([98]);
  });
  it('수축기<이완기 등 비정상 쌍은 BP로 채택하지 않음', () => {
    const { vitals } = extractClinicalEntities('혈압 80에 120'); // 뒤집힌 쌍
    expect(vitals.find((v) => v.type === 'BP')).toBeUndefined();
  });
});

describe('clinical-ner 약물', () => {
  it('타이레놀 500mg 하루 세 번 3일 → 구조화', () => {
    const { medications } = extractClinicalEntities('타이레놀 500mg 하루 세 번 식후 3일분 처방하겠습니다');
    const m = medications[0];
    expect(m.name).toBe('타이레놀');
    expect(m.dose).toBe(500);
    expect(m.doseUnit).toBe('mg');
    expect(m.frequency).toMatch(/하루\s*세\s*번/);
    expect(m.duration).toBe('3일분');
  });
  it('활력 수치는 약물로 오인하지 않음', () => {
    const { medications } = extractClinicalEntities('혈압 120에 80, 체온 37도');
    expect(medications.length).toBe(0);
  });
});

describe('clinical-ner 증상(부정 인식)', () => {
  it('있는 증상은 negated=false, 없는 증상은 negated=true', () => {
    const { symptoms } = extractClinicalEntities('기침이 있고 가래도 나오는데 두통은 없어요');
    const byTerm = Object.fromEntries(symptoms.map((s) => [s.term, s.negated]));
    expect(byTerm['기침']).toBe(false);
    expect(byTerm['가래']).toBe(false);
    expect(byTerm['두통']).toBe(true);
  });
  it('🔴 사전 용어와 동의어가 같은 증상을 두 이름으로 내지 않는다(2026-09-27 실제 대화 골든에서 발견)', () => {
    // '가슴 통증' 은 사전 '가슴통증' 과 동의어 /가슴통증/→흉통 에 동시에 걸려 두 항목이 됐다
    const { symptoms } = extractClinicalEntities('가슴 통증은 없어요. 숨이 차지도 않고요.');
    expect(symptoms.map((s) => s.term).sort()).toEqual(['호흡곤란', '흉통']);
    expect(symptoms.every((s) => s.negated)).toBe(true);
    const fever = extractClinicalEntities('고열이 있어요').symptoms.map((s) => s.term);
    expect(fever).toEqual(['발열']);
    const dizzy = extractClinicalEntities('어지러움이 심해요').symptoms.map((s) => s.term);
    expect(dizzy).toEqual(['어지럼']);
  });
  it('언급 없는 증상은 추출되지 않음', () => {
    const { symptoms } = extractClinicalEntities('컨디션은 괜찮습니다');
    expect(symptoms.find((s) => s.term === '복통')).toBeUndefined();
  });
});

describe('clinical-ner 계획', () => {
  it('영상·검사·처방·추적 계획 분류', () => {
    const { plan } = extractClinicalEntities('흉부 엑스레이 촬영하고, 혈액검사 나가겠습니다. 다음 주 재방문 하세요.');
    const kinds = plan.map((p) => p.kind);
    expect(kinds).toContain('IMAGING');
    expect(kinds).toContain('LAB');
    expect(kinds).toContain('FOLLOWUP');
  });
});

describe('clinical-ner 통합', () => {
  it('빈/무관 입력은 빈 결과', () => {
    const e = extractClinicalEntities('안녕하세요 반갑습니다');
    expect(e.vitals).toEqual([]);
    expect(e.medications).toEqual([]);
    expect(e.plan).toEqual([]);
  });
});

describe('entitiesToSoap (AI 미가용 저하 draft)', () => {
  it('증상→S(호소/부인)·활력→O·계획+약물→P, 평가는 비움', () => {
    const e = extractClinicalEntities('혈압 120에 80, 체온 37.5도. 두통이 있고 발열은 없어요. 타이레놀 500mg 하루 세 번 3일 처방하고 흉부 엑스레이 촬영하겠습니다.');
    const soap = entitiesToSoap(e);
    expect(soap.subjective).toMatch(/두통.*호소/);
    expect(soap.subjective).toMatch(/발열.*부인/);
    expect(soap.objective).toMatch(/BP 120\/80mmHg/);
    expect(soap.objective).toMatch(/BT 37\.5℃/);
    expect(soap.plan).toMatch(/타이레놀 500mg/);
    expect((soap as any).assessment).toBeUndefined(); // 평가는 의사 작성
  });
  it('빈 개체는 필드 없음', () => {
    const soap = entitiesToSoap(extractClinicalEntities('반갑습니다'));
    expect(soap.subjective).toBeUndefined();
    expect(soap.objective).toBeUndefined();
    expect(soap.plan).toBeUndefined();
  });
});
