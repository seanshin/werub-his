import { describe, it, expect } from 'vitest';
import { buildInternalMedicineSoap, labSummary, chronicSummary, hba1cOf, type LabEntry, type ChronicEntry } from './im-note';

/**
 * 내과 진료 입력 보관 가드 — 2026-08-18.
 *
 * 재주입 대상(실제로 있던 코드): 화면이 받은 현병력·검사값·만성질환 목표를
 * 서버가 버리는 키로 보내고 화면은 "저장되었습니다"라고 말하던 것.
 * 여기서는 **입력이 진료기록 문단에 반드시 실린다**는 것과,
 * **의사가 직접 쓴 SOAP 을 덮어쓰지 않는다**는 것을 고정한다.
 */

const labs: LabEntry[] = [
  { key: 'wbc', label: 'WBC', value: '11.2', unit: '×10³/μL' },
  { key: 'hgb', label: 'Hgb', value: '', unit: 'g/dL' },
  { key: 'hba1c', label: 'HbA1c', value: '7.4', unit: '%' },
];

const conditions: ChronicEntry[] = [
  { key: 'diabetes', label: '당뇨', checked: true, targetValue: '6.5', currentValue: '7.4', unit: 'HbA1c %' },
  { key: 'hypertension', label: '고혈압', checked: true, targetValue: '', currentValue: '', unit: 'mmHg' },
  { key: 'dyslipidemia', label: '고지혈증', checked: false, targetValue: '100', currentValue: '150', unit: 'LDL mg/dL' },
];

describe('labSummary', () => {
  it('입력한 검사값만 담는다 — 빈 칸을 0 이나 "-" 로 만들지 않는다', () => {
    const s = labSummary(labs);
    expect(s).toContain('WBC 11.2 ×10³/μL');
    expect(s).toContain('HbA1c 7.4 %');
    expect(s).not.toContain('Hgb');
  });

  it('아무 값도 없으면 빈 문자열이다(빈 문단을 만들지 않는다)', () => {
    expect(labSummary([{ key: 'wbc', label: 'WBC', value: '  ', unit: '' }])).toBe('');
  });

  it('정상/이상 판정을 붙이지 않는다 — 값만 사실이다', () => {
    expect(labSummary(labs)).not.toMatch(/정상|이상|높음|낮음|초과|미달/);
  });
});

describe('chronicSummary', () => {
  it('체크한 질환만 담고, 비어 있는 목표·현재값은 지어내지 않는다', () => {
    const s = chronicSummary(conditions);
    expect(s).toContain('당뇨 (현재 7.4 / 목표 6.5 HbA1c %)');
    expect(s).toContain('고혈압');
    expect(s).not.toContain('고지혈증'); // 체크하지 않음
    expect(s).not.toContain('고혈압 (');  // 값이 없으면 괄호 자체가 없다
  });

  it('체크한 질환이 없으면 빈 문자열이다', () => {
    expect(chronicSummary(conditions.map((c) => ({ ...c, checked: false })))).toBe('');
  });
});

describe('buildInternalMedicineSoap', () => {
  const soap = { subjective: '3일 전부터 기침', objective: '흉부 청진 정상', assessment: 'URI 의심', plan: '대증치료' };

  it('현병력·소견·검사값·만성질환이 모두 진료기록에 실린다', () => {
    const out = buildInternalMedicineSoap({ soap, hpi: '발열 동반', findings: '경부 림프절 촉지', labs, conditions });
    expect(out.subjective).toContain('발열 동반');
    expect(out.objective).toContain('경부 림프절 촉지');
    expect(out.objective).toContain('WBC 11.2');
    expect(out.plan).toContain('당뇨');
  });

  it('🔴 의사가 직접 쓴 SOAP 을 덮어쓰지 않는다 — 원문이 앞에 남는다', () => {
    const out = buildInternalMedicineSoap({ soap, hpi: '발열 동반', findings: '', labs: [], conditions: [] });
    expect(out.subjective!.startsWith('3일 전부터 기침')).toBe(true);
    expect(out.objective).toBe('흉부 청진 정상');
    expect(out.assessment).toBe('URI 의심');
    expect(out.plan).toBe('대증치료');
  });

  it('입력이 하나도 없는 칸은 빈 문자열이 아니라 undefined 다', () => {
    const out = buildInternalMedicineSoap({
      soap: { subjective: '', objective: '', assessment: '', plan: '' },
      hpi: '', findings: '', labs: [], conditions: [],
    });
    expect(out.subjective).toBeUndefined();
    expect(out.objective).toBeUndefined();
    expect(out.assessment).toBeUndefined();
    expect(out.plan).toBeUndefined();
  });
});

describe('hba1cOf', () => {
  it('저장 컬럼이 있는 HbA1c 만 숫자로 꺼낸다', () => {
    expect(hba1cOf(labs)).toBe(7.4);
  });

  it('미입력·비수치는 보내지 않는다(0 으로 만들지 않는다)', () => {
    expect(hba1cOf([{ key: 'hba1c', label: 'HbA1c', value: '', unit: '%' }])).toBeUndefined();
    expect(hba1cOf([{ key: 'hba1c', label: 'HbA1c', value: '미측정', unit: '%' }])).toBeUndefined();
    expect(hba1cOf([])).toBeUndefined();
  });
});
