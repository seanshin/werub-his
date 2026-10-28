import { describe, it, expect } from 'vitest';
import { TranscriptStitcher, stripOverlap } from '../../src/modules/voice-emr/transcript-stitcher';
import { sinoToNumber, normalizeKoreanNumber, normalizeNumeric } from '../../src/modules/voice-emr/korean-number';
import { parseIntent } from '../../src/modules/voice-emr/intent-parser';

describe('스티처', () => {
  it('연속 final append(공백 결합)', () => {
    const s = new TranscriptStitcher();
    s.onFinal({ text: '환자분이 흉통을 호소합니다' });
    const r = s.onFinal({ text: '이 주 전부터 지속됩니다' });
    expect(r.note).toBe('환자분이 흉통을 호소합니다 이 주 전부터 지속됩니다');
  });
  it('경계 1초 겹침 어절 중복 제거', () => {
    expect(stripOverlap('환자분이 흉통을 호소합니다', '흉통을 호소합니다 이 주 전부터')).toBe('이 주 전부터');
    const s = new TranscriptStitcher();
    s.onFinal({ text: '고혈압과 이상지질혈증으로' });
    const r = s.onFinal({ text: '이상지질혈증으로 약물 복용 중입니다' });
    expect(r.note).toBe('고혈압과 이상지질혈증으로 약물 복용 중입니다');
  });
  it('dropped_s>0 → 갭 마커+불완전+서명 차단(G5)', () => {
    const s = new TranscriptStitcher();
    s.onFinal({ text: '첫 문장' });
    const r = s.onFinal({ text: '유실 후 문장', dropped_s: 5.0 });
    expect(r.incomplete).toBe(true);
    expect(r.gaps).toContain(5.0);
    expect(r.note).toContain('누락');
    expect(s.canSign()).toBe(false);
  });
  it('저신뢰 final 보류(append 안 함)', () => {
    const s = new TranscriptStitcher();
    s.onFinal({ text: '정상 문장' });
    const r = s.onFinal({ text: '잡음', confidence: 0.3 });
    expect(r.held).toBe(true);
    expect(r.note).toBe('정상 문장');
  });
});

describe('수사 엣지케이스', () => {
  it('천 단위', () => expect(sinoToNumber('천이백')).toBe(1200));
  it('digit 통과(이미 숫자)', () => expect(normalizeKoreanNumber('혈압 130에 80')).toBe('혈압 130에 80'));
  it('자릿값 없는 일반 단어 보존(오변환 방지)', () => {
    expect(normalizeKoreanNumber('정맥주사')).toBe('정맥주사'); // 사=4 오변환 금지
    expect(normalizeKoreanNumber('이사 준비')).toBe('이사 준비'); // 이·사 오변환 금지
  });
  it('오백/이십', () => {
    expect(normalizeKoreanNumber('오백')).toBe('500');
    expect(normalizeKoreanNumber('이십')).toBe('20');
  });
});

describe('적대적 파서 케이스', () => {
  const many = (t: string, o?: any) => parseIntent(t, o);
  const one = (t: string, o?: any) => parseIntent(t, o)[0] as any;

  it('복합 처방 2건 분절', () => {
    const r = many('메트포르민 오백 밀리그램 하고 리피토 이십 밀리그램 처방');
    const rxs = r.filter((x: any) => x.sub === 'RX');
    expect(rxs).toHaveLength(2);
    expect(rxs.map((x: any) => x.drug)).toEqual(['메트포르민', '리피토']);
  });
  it('LAB 나열(하고 구분)', () => {
    const r = one('당화혈색소하고 크레아티닌하고 소변검사 나가고');
    expect(r).toMatchObject({ sub: 'LAB' });
    expect(r.labs).toEqual(expect.arrayContaining(['당화혈색소', '크레아티닌', '소변검사']));
  });
  it('mg 없이 하루 빈도만 있어도 RX', () => {
    expect(one('메트포르민 오백 하루 두 번')).toMatchObject({ sub: 'RX', drug: '메트포르민', freq: 'bid' });
  });
  it('혈압 에 없이 두 숫자', () => {
    expect(one('혈압 백삼십 팔십')).toMatchObject({ metric: 'BP', values: [130, 80] });
  });
  it('빈 입력 → DICTATE', () => {
    expect(one('').intent).toBe('DICTATE');
  });
});
