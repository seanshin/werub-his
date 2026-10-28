/**
 * 결정 영역·위원회 결정 과정 단계 정본(2026-10-10).
 *  · 영역 순서 = 기본 설정부터 · 모든 축이 영역을 가짐 · 예외 키는 기본 매핑을 이긴다
 *  · 🔴 개발 시드는 실결정이 아니다(단계를 앞당기지 않는다) · 🔴 확인(VERIFIED)은 판정하지 않는다
 *  · 🔴 안건 조회 실패('UNKNOWN')를 "안건 없음"으로 접지 않는다
 */
import { describe, it, expect } from 'vitest';
import {
  DECISION_DOMAINS, DECISION_TRACK_DOMAIN, DECISION_DOMAIN_OVERRIDES, decisionDomainOf,
  COMMITTEE_DECISION_STAGES, decisionStageOf, type DecisionStageInput,
} from '../src/decision-domains';

const base: DecisionStageInput = { layer: 'INTERNAL_COMMITTEE', seeded: false, decided: false, readyToDecide: true, agenda: null, enactmentState: 'UNDECIDED' };

describe('영역', () => {
  it('순서 = 기본 설정 → 의료 → 운영 → 행정 → 정보보호·보안', () => {
    expect(DECISION_DOMAINS.map((d) => d.label)).toEqual(['기본 설정', '의료', '운영', '행정', '정보보호·보안']);
    expect(DECISION_DOMAINS.every((d) => d.description.length > 0)).toBe(true);
  });
  it('축 14종 전부 영역이 있다 · 매핑 값은 정의된 영역만', () => {
    const keys = new Set(DECISION_DOMAINS.map((d) => d.key));
    expect(Object.keys(DECISION_TRACK_DOMAIN)).toHaveLength(14);
    for (const v of [...Object.values(DECISION_TRACK_DOMAIN), ...Object.values(DECISION_DOMAIN_OVERRIDES)]) expect(keys.has(v)).toBe(true);
  });
  it('예외 키는 축 매핑을 이긴다 · 대조군: 예외 없는 키는 축을 따른다', () => {
    expect(decisionDomainOf('qi.docIssuance.slaHours', 'QUALITY')).toBe('ADMIN');
    expect(decisionDomainOf('billing.institutionType', 'BILLING')).toBe('FOUNDATION');
    expect(decisionDomainOf('qi.autoMeasure.enable', 'QUALITY')).toBe('MEDICAL');
    expect(decisionDomainOf('x', 'NOPE')).toBeNull();
  });
});

describe('위원회 결정 과정 단계', () => {
  it('7단계 순서', () => {
    expect(COMMITTEE_DECISION_STAGES.map((s) => s.key)).toEqual(['PREPARE', 'SUBMITTED', 'DELIBERATION', 'RESOLVED', 'RECORDED', 'ENACTED', 'VERIFIED']);
    expect(COMMITTEE_DECISION_STAGES.map((s) => s.no)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });
  it('판정 표 — 안건 상태·실결정·집행', () => {
    expect(decisionStageOf(base).stage).toBe('PREPARE');
    expect(decisionStageOf({ ...base, readyToDecide: false }).flags).toContain('BLOCKED');
    expect(decisionStageOf({ ...base, agenda: 'SUBMITTED' }).stage).toBe('SUBMITTED');
    expect(decisionStageOf({ ...base, agenda: 'SCHEDULED' }).stage).toBe('DELIBERATION');
    expect(decisionStageOf({ ...base, agenda: 'DEFERRED' }).stage).toBe('DELIBERATION');
    expect(decisionStageOf({ ...base, agenda: 'RESOLVED' }).stage).toBe('RESOLVED');
    expect(decisionStageOf({ ...base, agenda: 'REJECTED' })).toEqual({ stage: 'PREPARE', flags: ['REJECTED'] });
    expect(decisionStageOf({ ...base, agenda: 'WITHDRAWN' }).flags).toContain('WITHDRAWN');
    expect(decisionStageOf({ ...base, decided: true, enactmentState: 'ENACTED' }).stage).toBe('ENACTED');
    expect(decisionStageOf({ ...base, decided: true, enactmentState: 'MANUAL_CONFIRMED' }).stage).toBe('ENACTED');
    expect(decisionStageOf({ ...base, decided: true, enactmentState: 'PENDING' })).toEqual({ stage: 'RECORDED', flags: ['ENACT_PENDING'] });
    expect(decisionStageOf({ ...base, decided: true, enactmentState: 'FAILED' }).flags).toContain('ENACT_FAILED');
  });
  it('🔴 개발 시드는 단계를 앞당기지 않는다 — 실결정이 없으면 시드여도 PREPARE(표식만)', () => {
    const r = decisionStageOf({ ...base, seeded: true, enactmentState: 'ENACTED' });
    expect(r.stage).toBe('PREPARE');
    expect(r.flags).toContain('SEEDED');
  });
  it('🔴 안건 조회 실패는 표식 — 안건 없음과 구분', () => {
    expect(decisionStageOf({ ...base, agenda: 'UNKNOWN' }).flags).toContain('AGENDA_UNKNOWN');
    expect(decisionStageOf(base).flags).not.toContain('AGENDA_UNKNOWN');
  });
  it('🔴 VERIFIED 는 어떤 입력으로도 판정되지 않는다', () => {
    const states = ['UNDECIDED', 'ENACTED', 'PENDING', 'FAILED', 'MANUAL_CONFIRMED'] as const;
    const ags = [null, 'SUBMITTED', 'SCHEDULED', 'RESOLVED', 'REJECTED', 'DEFERRED', 'WITHDRAWN', 'UNKNOWN'] as const;
    for (const e of states) for (const a of ags) for (const dec of [true, false])
      expect(decisionStageOf({ ...base, decided: dec, agenda: a, enactmentState: e }).stage).not.toBe('VERIFIED');
  });
});
