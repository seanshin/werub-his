import { describe, it, expect } from 'vitest';
import {
  applyChartValuesToSoap, chartMappingSummary, composeChartNarrative, formatChartValue,
  slotOfField, unmappedBlockHeader, type ChartSectionDef, type SoapDraft,
} from './chart-values';

/**
 * W8-R7 가드 — 차트 에디터 "입력값의 41%가 저장되지 않는다"의 재발 방지.
 *
 * 🔴 원 결함(2026-08-14 운영 실측 26템플릿 250필드)
 *   E1 진료 화면이 `chartValues` 를 어떤 요청에도 싣지 않음 → 매핑 없는 102필드(41%) 소실
 *   E2 같은 SOAP 슬롯끼리 대입으로 덮어씀 → 내과 외래 초진 objective 6필드 중 1개만 생존
 *   E3 에디터는 `soapMapping`, 저장은 `mappedTo` — 두 키가 갈라짐
 */

const EMPTY_SOAP: SoapDraft = { subjective: '', objective: '', assessment: '', plan: '' };

/** 운영 '내과 외래 초진'(실사용 12회)과 같은 모양 — objective 6필드 충돌 */
const IM_FIRST_VISIT: ChartSectionDef[] = [
  {
    id: 's1', title: '주관적',
    fields: [
      { id: 'f1', type: 'textarea', label: '주소(Chief Complaint)', mappedTo: 'subjective' },
      { id: 'f2', type: 'textarea', label: '현병력(HPI)', mappedTo: 'subjective' },
    ],
  },
  {
    id: 's2', title: '객관적',
    fields: [
      { id: 'f3', type: 'number', label: '혈압(mmHg)', mappedTo: 'objective' },
      { id: 'f4', type: 'number', label: '맥박(회/분)', mappedTo: 'objective' },
      { id: 'f5', type: 'number', label: '체온(℃)', mappedTo: 'objective' },
      { id: 'f6', type: 'number', label: '호흡수(회/분)', mappedTo: 'objective' },
      { id: 'f7', type: 'number', label: 'SpO2(%)', mappedTo: 'objective' },
      { id: 'f8', type: 'textarea', label: '이학적 소견', mappedTo: 'objective' },
    ],
  },
  {
    id: 's3', title: '기타(매핑 없음)',
    fields: [
      { id: 'f9', type: 'text', label: '흡연력' },
      { id: 'f10', type: 'select', label: '음주력' },
    ],
  },
];

describe('slotOfField — 매핑 키는 mappedTo 하나(soapMapping 은 읽기 폴백)', () => {
  it('mappedTo 가 SOAP 슬롯이면 그 슬롯', () => {
    expect(slotOfField({ id: 'a', type: 'text', label: 'A', mappedTo: 'plan' })).toBe('plan');
  });

  it('🔴 E3 — mappedTo 가 없고 레거시 soapMapping 만 있어도 값을 잃지 않는다', () => {
    expect(slotOfField({ id: 'a', type: 'text', label: 'A', soapMapping: 'assessment' })).toBe('assessment');
  });

  it('mappedTo 가 정본 — 레거시 키가 덮어쓰지 못한다', () => {
    expect(slotOfField({ id: 'a', type: 'text', label: 'A', mappedTo: 'plan', soapMapping: 'subjective' })).toBe('plan');
  });

  it('SOAP 슬롯이 아닌 매핑 경로(FHIR 경로 등)는 슬롯이 아니다 — 미지정으로 취급해 블록에 저장', () => {
    expect(slotOfField({ id: 'a', type: 'text', label: 'A', mappedTo: 'Observation.valueQuantity' })).toBeNull();
    expect(slotOfField({ id: 'a', type: 'text', label: 'A', mappedTo: 'vitals' })).toBeNull();
  });
});

describe('🔴 E1 — mappedTo 없는 필드가 조용히 버려지지 않는다', () => {
  it('매핑 없는 필드도 라벨과 함께 객관적 소견(O)에 저장된다', () => {
    const out = composeChartNarrative(IM_FIRST_VISIT, { f9: '20갑년', f10: '주 2회' }, '내과 외래 초진');
    expect(out.objective).toContain(unmappedBlockHeader('내과 외래 초진'));
    expect(out.objective).toContain('흡연력: 20갑년');
    expect(out.objective).toContain('음주력: 주 2회');
  });

  it('입력한 모든 필드가 어느 슬롯에든 나타난다(유실 0)', () => {
    const values: Record<string, unknown> = {
      f1: '두통', f2: '3일 전부터', f3: '120/80', f4: 88, f5: 36.8, f6: 18, f7: 98,
      f8: '심음 정상', f9: '20갑년', f10: '주 2회',
    };
    const out = composeChartNarrative(IM_FIRST_VISIT, values, '내과 외래 초진');
    const all = Object.values(out).join('\n');
    for (const v of ['두통', '3일 전부터', '120/80', '88', '36.8', '18', '98', '심음 정상', '20갑년', '주 2회']) {
      expect(all).toContain(v);
    }
  });

  it('값이 없는 필드는 줄을 만들지 않는다(빈 라벨 나열 금지)', () => {
    const out = composeChartNarrative(IM_FIRST_VISIT, { f3: '120/80' }, '내과 외래 초진');
    expect(out.objective).toContain('혈압(mmHg): 120/80');
    expect(out.objective).not.toContain('맥박');
    expect(out.subjective).toBeUndefined();
  });

  it('요약이 미지정 필드를 정확히 센다(화면 고지용)', () => {
    const s = chartMappingSummary(IM_FIRST_VISIT);
    expect(s.totalFields).toBe(10);
    expect(s.unmapped.map((f) => f.label)).toEqual(['흡연력', '음주력']);
    expect(s.sharedSlots).toEqual(['subjective', 'objective']);
  });
});

describe('🔴 E2 — 같은 슬롯은 덮어쓰지 않고 라벨과 함께 누적', () => {
  it('objective 6필드가 전부 남는다(종전엔 마지막 하나만 생존)', () => {
    const values = { f3: '120/80', f4: 88, f5: 36.8, f6: 18, f7: 98, f8: '심음 정상' };
    const out = composeChartNarrative(IM_FIRST_VISIT, values, '내과 외래 초진');
    const lines = (out.objective ?? '').split('\n');
    expect(lines).toHaveLength(6);
    expect(lines[0]).toBe('혈압(mmHg): 120/80');
    expect(lines[5]).toBe('이학적 소견: 심음 정상');
  });

  it('한 슬롯에 필드가 하나뿐이면 원문 그대로(불필요한 라벨을 붙이지 않는다)', () => {
    const single: ChartSectionDef[] = [{
      id: 's', title: 's', fields: [{ id: 'a', type: 'textarea', label: '주호소', mappedTo: 'subjective' }],
    }];
    expect(composeChartNarrative(single, { a: '두통' }, 'T').subjective).toBe('두통');
  });

  it('연속 입력에서 값이 중복 누적되지 않는다(합성분 교체)', () => {
    let soap = EMPTY_SOAP;
    let composed = {};
    ({ soap, composed } = applyChartValuesToSoap(soap, composed, IM_FIRST_VISIT, { f3: '120/80' }, 'T'));
    ({ soap, composed } = applyChartValuesToSoap(soap, composed, IM_FIRST_VISIT, { f3: '120/80', f4: 88 }, 'T'));
    ({ soap, composed } = applyChartValuesToSoap(soap, composed, IM_FIRST_VISIT, { f3: '130/85', f4: 88 }, 'T'));

    expect(soap.objective).toBe('혈압(mmHg): 130/85\n맥박(회/분): 88');
    expect(soap.objective.match(/혈압/g)).toHaveLength(1);
  });

  it('의사가 직접 친 문장은 다시 합성해도 보존된다', () => {
    let soap: SoapDraft = { ...EMPTY_SOAP };
    let composed = {};
    ({ soap, composed } = applyChartValuesToSoap(soap, composed, IM_FIRST_VISIT, { f3: '120/80' }, 'T'));
    soap = { ...soap, objective: `${soap.objective}\n\n수기: 청진상 특이소견 없음` };
    ({ soap, composed } = applyChartValuesToSoap(soap, composed, IM_FIRST_VISIT, { f3: '130/85' }, 'T'));

    expect(soap.objective).toContain('수기: 청진상 특이소견 없음');
    expect(soap.objective).toContain('혈압(mmHg): 130/85');
    expect(soap.objective).not.toContain('120/80');
  });

  it('다른 슬롯은 건드리지 않는다', () => {
    const soap: SoapDraft = { ...EMPTY_SOAP, plan: '경과 관찰' };
    const r = applyChartValuesToSoap(soap, {}, IM_FIRST_VISIT, { f3: '120/80' }, 'T');
    expect(r.soap.plan).toBe('경과 관찰');
  });
});

describe('formatChartValue — 값은 변형하지 않는다', () => {
  it('숫자는 반올림·자릿수 가공 없이 그대로', () => {
    expect(formatChartValue(36.85)).toBe('36.85');
    expect(formatChartValue(0)).toBe('0');
  });

  it('배열(다중 선택·체크리스트)은 모두 남는다', () => {
    expect(formatChartValue(['발열', '기침', '두통'])).toBe('발열, 기침, 두통');
  });

  it('진단 검색 선택값은 코드+명칭', () => {
    expect(formatChartValue({ code: 'J06.9', name: '급성 상기도 감염' })).toBe('J06.9 급성 상기도 감염');
  });

  it('점수 계산기는 총점', () => {
    expect(formatChartValue({ selections: { 0: 25, 1: 15 }, total: 40 })).toBe('총점 40');
  });

  it('임상도구 결과는 라벨·값·등급', () => {
    expect(formatChartValue({ chartId: 'GCS', inputs: {}, result: { label: 'GCS 13', value: 13, level: '경증' } }))
      .toBe('GCS 13 · 13 · 경증');
  });

  it('활력징후 객체는 항목별로 남는다', () => {
    expect(formatChartValue({ hr: '88', systolicBp: '120', spo2: '98' })).toBe('HR 88, SBP 120, SpO2 98');
  });

  it('처방/오더 항목은 줄 단위로 남는다(빈 칸은 생략)', () => {
    expect(formatChartValue({ items: [{ name: '타이레놀', dosage: '500mg', frequency: '1일 3회', duration: '' }] }))
      .toBe('타이레놀, 용량 500mg, 횟수 1일 3회');
  });

  it('빈 값은 빈 문자열(폴백을 만들지 않는다)', () => {
    expect(formatChartValue(null)).toBe('');
    expect(formatChartValue('')).toBe('');
    expect(formatChartValue([])).toBe('');
  });

  it('false 체크박스도 값이다(모르는 것과 아니오를 구분한다)', () => {
    expect(formatChartValue(false)).toBe('아니오');
    expect(formatChartValue(true)).toBe('예');
  });
});
