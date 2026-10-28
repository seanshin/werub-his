import { describe, it, expect } from 'vitest';
import { parseIntent } from '../../src/modules/voice-emr/intent-parser';
import { normalizeKoreanNumber, sinoToNumber, normalizeNumeric } from '../../src/modules/voice-emr/korean-number';

/**
 * VoiceEMR intent 파서 골든 (프로토타입·순수 로직)
 * 정본: docs/02-design/voice-emr-implementation-spec.md §B
 */
describe('한국어 수사 정규화', () => {
  it('한자어 수사', () => {
    expect(sinoToNumber('백삼십')).toBe(130);
    expect(sinoToNumber('삼십육')).toBe(36);
    expect(sinoToNumber('구십팔')).toBe(98);
    expect(sinoToNumber('백사십육')).toBe(146);
    expect(sinoToNumber('오백')).toBe(500);
    expect(sinoToNumber('이십')).toBe(20);
  });
  it('소수(점)', () => {
    expect(normalizeKoreanNumber('삼십육점팔')).toBe('36.8');
    expect(normalizeKoreanNumber('삼십육점오')).toBe('36.5');
  });
  it('단위 정규화', () => {
    expect(normalizeNumeric('오백 밀리그램')).toContain('mg');
    expect(normalizeNumeric('구십팔 퍼센트')).toContain('%');
  });
});

describe('parseIntent 골든', () => {
  const one = (t: string, o?: any) => parseIntent(t, o)[0] as any;

  it('#1 조회', () => expect(one('지난 검사 결과 보여줘')).toMatchObject({ intent: 'READ', target: 'lab' }));
  it('#2 조회+용어', () => expect(one('최근 당화혈색소 알려줘')).toMatchObject({ intent: 'READ', term: '당화혈색소' }));
  it('#3 약 조회', () => expect(one('복용 중인 약 보여줘')).toMatchObject({ intent: 'READ', target: 'medication' }));

  it('#4 혈압 2값(한자어)', () => expect(one('혈압 백삼십에 팔십')).toMatchObject({ intent: 'VITAL', metric: 'BP', values: [130, 80] }));
  it('#5 체온 소수', () => expect(one('체온 삼십육점팔')).toMatchObject({ intent: 'VITAL', metric: 'TEMP', values: [36.8] }));
  it('#6 산소포화도', () => expect(one('산소포화도 구십팔 퍼센트')).toMatchObject({ intent: 'VITAL', metric: 'SPO2', values: [98] }));
  it('#8 공복 혈당', () => expect(one('공복 혈당 백사십육')).toMatchObject({ intent: 'VITAL', metric: 'FBS', values: [146] }));

  it('#9 자기정정', () => expect(one('혈압 백삼십 말고 백사십에 구십')).toMatchObject({ intent: 'VITAL', metric: 'BP', values: [140, 90] }));
  it('#10 필러 제거', () => expect(one('어 혈압 그 백삼십에 팔십')).toMatchObject({ intent: 'VITAL', values: [130, 80] }));
  it('#11 복합 분절', () => {
    const r = parseIntent('혈압 백삼십에 팔십 하고 체온 삼십육점오');
    expect(r).toHaveLength(2);
    expect(r[0]).toMatchObject({ metric: 'BP', values: [130, 80] });
    expect(r[1]).toMatchObject({ metric: 'TEMP', values: [36.5] });
  });

  it('#12 영상 오더', () => expect(one('흉부 엑스레이 오더 낼게')).toMatchObject({ intent: 'ORDER', sub: 'IMAGING', modality: 'XR', bodyPart: '흉부' }));
  it('#13 CT(동음이의)', () => expect(one('상복부 시티 처방')).toMatchObject({ sub: 'IMAGING', modality: 'CT', bodyPart: '상복부' }));

  it('#15 처방 용량·빈도', () => expect(one('메트포르민 오백 밀리그램 하루 두 번')).toMatchObject({ sub: 'RX', drug: '메트포르민', dose: 500, freq: 'bid' }));
  it('#18 정맥주사', () => expect(one('라식스 이십 정맥주사 한 번')).toMatchObject({ sub: 'RX', drug: '라식스', dose: 20, route: 'IV' }));
  it('#19 용량 누락', () => expect(one('메트포르민 처방')).toMatchObject({ sub: 'RX', drug: '메트포르민' }));

  it('#20 의문=명령 아님', () => expect(one('흉부 엑스레이 낼까요').intent).not.toBe('ORDER'));

  it('#21 개인 HABIT', () => {
    const r = one('타이레놀 오백 처방', { customPhrases: { habits: [{ from: '타이레놀', to: '아세트아미노펜' }] } });
    expect(r).toMatchObject({ sub: 'RX', drug: '아세트아미노펜' });
  });
  it('#22 개인 ALIAS', () => {
    const r = one('내 고혈압 초진 세트', { customPhrases: { aliases: [{ pattern: '고혈압 초진 세트', action: { kind: 'order-set', ref: 'HTN' } }] } });
    expect(r).toMatchObject({ intent: 'ALIAS' });
  });

  it('#25 저신뢰 보류', () => expect(one('어쩌구', { confidence: 0.32 })).toMatchObject({ intent: 'HOLD' }));
  it('#26 예약어 취소', () => expect(one('취소')).toMatchObject({ intent: 'SYSTEM', action: 'cancel' }));

  it('오더는 자동실행 없음(needsConfirm)', () => {
    for (const t of ['흉부 엑스레이 오더 낼게', '메트포르민 오백 밀리그램 하루 두 번', '당화혈색소 검사 추가']) {
      const r = one(t);
      if (r.intent === 'ORDER') expect(r.needsConfirm).toBe(true);
    }
  });
});
