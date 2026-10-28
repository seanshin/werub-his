import { describe, it, expect } from 'vitest';
import {
  pickIsoDate, pickText, extractedCount, evidenceUnavailable, EVIDENCE_EGRESS_NOTICE,
} from './evidence-extract';

/**
 * 🔴 증빙 판독의 위험은 **그럴듯한 값을 만드는 것**이다.
 *    번호를 지어내면 그 번호가 원장에 박히고, 나중에 아무도 가짜인 줄 모른다.
 */
describe('날짜는 형식이 맞을 때만 통과한다', () => {
  it('YYYY-MM-DD 만', () => {
    expect(pickIsoDate('2026-03-01')).toBe('2026-03-01');
  });

  it('🔴 다른 형식을 고쳐 맞추지 않는다 — 고치면 날짜를 지어내는 것이다', () => {
    for (const bad of ['2026.03.01', '2026/3/1', '26-03-01', '2026년 3월 1일', '3/1/2026']) {
      expect(pickIsoDate(bad), bad).toBeUndefined();
    }
  });

  it('🔴 없는 날짜는 버린다', () => {
    expect(pickIsoDate('2026-02-30')).toBeUndefined();
    expect(pickIsoDate('2026-13-01')).toBeUndefined();
    expect(pickIsoDate('2026-00-10')).toBeUndefined();
  });

  it('문자열이 아니면 버린다', () => {
    expect(pickIsoDate(20260301)).toBeUndefined();
    expect(pickIsoDate(null)).toBeUndefined();
  });
});

describe('🔴 빈 값과 미판독을 뭉개지 않는다', () => {
  it('공백뿐이면 키를 만들지 않는다', () => {
    expect(pickText('   ')).toBeUndefined();
    expect(pickText('')).toBeUndefined();
  });

  it('읽은 값은 그대로(길이만 자른다)', () => {
    expect(pickText('  제2026-1호  ')).toBe('제2026-1호');
    expect(pickText('가'.repeat(300), 200)).toHaveLength(200);
  });

  it('채운 칸 수를 셀 수 있다 — 화면이 "채운 칸 없음"을 말할 수 있어야 한다', () => {
    expect(extractedCount({})).toBe(0);
    expect(extractedCount({ evidenceRef: '제2026-1호', evidenceDate: '2026-03-01' })).toBe(2);
  });
});

describe('🔴 이유 없는 판독 불가를 만들 수 없다', () => {
  it('UNAVAILABLE 에는 항상 이유가 있다', () => {
    const r = evidenceUnavailable('PDF 는 판독할 수 없습니다', 'a.pdf');
    expect(r.source).toBe('UNAVAILABLE');
    expect(r.reason).toBeTruthy();
    expect(r.fields).toEqual({});
    expect(r.fileName).toBe('a.pdf');
  });

  it('🔴 이 축에 FALLBACK 은 없다 — 규칙으로 번호를 추정하는 것은 대체가 아니라 날조다', () => {
    const src: string = evidenceUnavailable('x').source;
    expect(['AI', 'UNAVAILABLE']).toContain(src);
  });
});

describe('🔴 문서가 어디로 가는지 말한다', () => {
  it('전송 고지에 전송 사실과 초안임이 둘 다 있다', () => {
    expect(EVIDENCE_EGRESS_NOTICE).toContain('전송');
    expect(EVIDENCE_EGRESS_NOTICE).toContain('초안');
    expect(EVIDENCE_EGRESS_NOTICE).toContain('저장되지 않습니다');
  });
});
