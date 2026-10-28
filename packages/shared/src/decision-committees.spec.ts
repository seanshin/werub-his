/**
 * 결정 ↔ 위원회 정본(2026-10-11) — 결정권한자 표·배정 모양.
 * 등록부와의 대조(전 키 배정·시드 이름/정족수·표면 담당 일치)는 api `decision-committees-link.spec.ts`.
 */
import { describe, it, expect } from 'vitest';
import {
  COMMITTEE_AUTHORITIES, COMMITTEE_CODES, DECISION_COMMITTEE_ASSIGNMENT, NON_COMMITTEE_AUTHORITIES,
  committeeMayDecide, decisionCommitteeOf,
  committeeAuthoritySeedRecord, committeeAuthoritySourceOf, readCommitteeAuthorityRecord, committeeAuthorityConfigKey,
} from './decision-committees';

describe('결정권한자 표', () => {
  it('9곳 전부 · 위원장·간사·당연직·의결 요건·확인 담당이 비어 있지 않다 · 의결 요건이 정족수를 말한다', () => {
    expect(Object.keys(COMMITTEE_AUTHORITIES).sort()).toEqual([...COMMITTEE_CODES].sort());
    for (const c of COMMITTEE_CODES) {
      const a = COMMITTEE_AUTHORITIES[c];
      expect(a.code).toBe(c);
      for (const f of [a.name, a.scope, a.chair, a.secretary, a.votingRule, a.verifier]) expect(f.trim().length, c).toBeGreaterThan(1);
      expect(a.exOfficio.length, c).toBeGreaterThan(1);
      expect(a.votingRule).toContain(`${a.quorum}명`);
    }
  });
  it('허가권자·직원 층은 위원회 표에 없다(위원회가 그 층을 대신 정하지 못한다)', () => {
    expect(NON_COMMITTEE_AUTHORITIES.LICENSE_HOLDER.rule).toContain('위원회 의결로 대신할 수 없다');
  });
});

describe('배정', () => {
  it('[주관, ...합동] · 9곳 코드만 · 중복 없음', () => {
    for (const [k, codes] of Object.entries(DECISION_COMMITTEE_ASSIGNMENT)) {
      expect(codes.length, k).toBeGreaterThan(0);
      for (const c of codes) expect(COMMITTEE_CODES as readonly string[], k).toContain(c);
      expect(new Set(codes).size, k).toBe(codes.length);
    }
  });
  it('조회 — 주관·합동 · 없는 키는 null · 상정 가능 판정(주관·합동 참 · 그 밖·코드 없음 거짓)', () => {
    const [k, codes] = Object.entries(DECISION_COMMITTEE_ASSIGNMENT).find(([, c]) => c.length > 1)!;
    expect(decisionCommitteeOf(k)).toEqual({ lead: codes[0], joint: codes.slice(1) });
    expect(decisionCommitteeOf('no.such')).toBeNull();
    expect(committeeMayDecide(k, codes[0])).toBe(true);
    expect(committeeMayDecide(k, codes[1])).toBe(true);
    expect(committeeMayDecide(k, COMMITTEE_CODES.find((c) => !codes.includes(c)))).toBe(false);
    expect(committeeMayDecide(k, null)).toBe(false);
    expect(committeeMayDecide('no.such', codes[0])).toBe(false);
  });
});

describe('결정권한자 표 기록(개발 시드 확정)', () => {
  it('시드 기록 = 정의 그대로 · DEV-SEED 표식 · 키', () => {
    const r = committeeAuthoritySeedRecord('QPS', '2026-10-11T00:00:00.000Z');
    const a = COMMITTEE_AUTHORITIES.QPS;
    expect(r).toMatchObject({ chair: a.chair, secretary: a.secretary, exOfficio: a.exOfficio, votingRule: a.votingRule, verifier: a.verifier });
    expect(r.exOfficio).not.toBe(a.exOfficio); // 사본 — 정의를 함께 바꾸지 않는다
    expect(committeeAuthoritySourceOf(r)).toBe('DEV_SEED');
    expect(committeeAuthorityConfigKey('QPS')).toBe('governance.committeeAuthority.QPS');
  });
  it('🔴 출처 4상태 — 없음·시드·원내 채택·모양 다름(지어내지 않는다)', () => {
    const r = committeeAuthoritySeedRecord('MRC', '2026-10-11T00:00:00.000Z');
    expect(committeeAuthoritySourceOf(null)).toBe('NONE');
    expect(committeeAuthoritySourceOf({ ...r, basisRef: '위원회 규정 제12호' })).toBe('RECORDED');
    expect(committeeAuthoritySourceOf({ ...r, chair: '' })).toBe('INVALID');
    expect(committeeAuthoritySourceOf({ ...r, exOfficio: 'x' })).toBe('INVALID');
    expect(readCommitteeAuthorityRecord('문자열')).toBeNull();
  });
});
