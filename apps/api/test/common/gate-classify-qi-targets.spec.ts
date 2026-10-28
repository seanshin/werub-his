import { describe, expect, it } from 'vitest';
import { classifyGateEntry } from '../../src/common/gate-mode';
import { ascendingBoundsOr, mergeTargetMap, nonEmptyStringArrayOr, positiveNumberOr } from '../../src/common/qi-targets';

/**
 * §7 P1 표면화 계약(2026-08-04) — 게이트 분류기와 qi.targets 소비 헬퍼의 baseline.
 * 분류기는 안전 게이트 관제 수집과 거버넌스 헬스체크(D13)가 공유한다 — 판정이 갈리면 관제 사각이 재발한다.
 */
describe('classifyGateEntry — 관제 수집 분류기', () => {
  it('3상 문자열 게이트(TRI) — 파이프·슬래시 표기 모두 수집(nursing.bcma.enforce 슬래시 누락 갭 봉합)', () => {
    expect(classifyGateEntry({ key: 'duty.constraint.enforce', value: 'OFF', description: '당직 근무 규칙 강제 수준(OFF|WARN|BLOCK)' })).toBe('TRI');
    expect(classifyGateEntry({ key: 'nursing.bcma.enforce', value: 'OFF', description: '투약 전 BCMA 스캔 — OFF/WARN/BLOCK(기본 OFF)' })).toBe('TRI');
  });

  it('Map형 게이트(MAP) — formulary/preauth/diagnosis 3종이 수집망에 든다(종전 누락 갭)', () => {
    expect(classifyGateEntry({ key: 'formulary.enforce', value: {}, description: '영역별 OFF|WARN|BLOCK 맵' })).toBe('MAP');
    expect(classifyGateEntry({ key: 'preauth.enforce', value: {}, description: '사전승인 발행 게이트(유형별 OFF|WARN|BLOCK)' })).toBe('MAP');
    expect(classifyGateEntry({ key: 'diagnosis.restrictionEnforce', value: { sex: 'OFF' }, description: '규칙별 OFF|WARN|BLOCK' })).toBe('MAP');
  });

  it('boolean 게이트(BOOL) — 게이트성 신호(key enforce/gate/require 또는 설명 필수/차단/게이트)가 있어야 수집', () => {
    expect(classifyGateEntry({ key: 'inpatient.dischargeGate', value: false, description: '퇴원 전 퇴원요약 서명 필수' })).toBe('BOOL');
    expect(classifyGateEntry({ key: 'queue.completeRequiresSign', value: true, description: '대기 완료 처리 전 진료기록 서명 필수' })).toBe('BOOL');
    // 게이트가 아닌 boolean(기능 토글)은 관제에 안 끌려온다
    expect(classifyGateEntry({ key: 'dev.demoDateRoll', value: true, description: '데모 날짜 롤포워드' })).toBeNull();
  });

  it('3상 설명이 없는 문자열/객체는 게이트 아님', () => {
    expect(classifyGateEntry({ key: 'hospital.name', value: '병원', description: '기관명' })).toBeNull();
    expect(classifyGateEntry({ key: 'preauth.imaging', value: {}, description: '고가·특수 검사 판정 조건' })).toBeNull();
  });
});

describe('qi.targets 소비 헬퍼 — 형식 위반은 코드 기본(fail-safe)', () => {
  const base = { LEVEL_1: 15, LEVEL_2: 15, LEVEL_3: 30 };

  it('mergeTargetMap — 부분 병합·base 밖 키 무시·비수치/0 이하 무시', () => {
    expect(mergeTargetMap(base, { LEVEL_1: 10 })).toEqual({ LEVEL_1: 10, LEVEL_2: 15, LEVEL_3: 30 });
    expect(mergeTargetMap(base, { LEVEL_9: 5, LEVEL_2: 'x', LEVEL_3: 0 })).toEqual(base);
    expect(mergeTargetMap(base, null)).toEqual(base);
    expect(mergeTargetMap(base, [1, 2])).toEqual(base);
  });

  it('positiveNumberOr — 유한 양수만 채택', () => {
    expect(positiveNumberOr(45, 30)).toBe(45);
    expect(positiveNumberOr('45', 30)).toBe(45);
    expect(positiveNumberOr(0, 30)).toBe(30);
    expect(positiveNumberOr('abc', 30)).toBe(30);
    expect(positiveNumberOr(null, 30)).toBe(30);
  });

  it('nonEmptyStringArrayOr — 유효 문자열 배열만 전량 대체(좌우 키워드 등 목록 마스터)', () => {
    const fb = ['슬관절', '고관절'];
    expect(nonEmptyStringArrayOr(['안구', '망막'], fb)).toEqual(['안구', '망막']);
    expect(nonEmptyStringArrayOr([], fb)).toEqual(fb); // 빈 배열=기본
    expect(nonEmptyStringArrayOr(['안구', ''], fb)).toEqual(fb); // 빈 문자열 섞이면 통째 거부(부분 채택 없음)
    expect(nonEmptyStringArrayOr(['안구', 1], fb)).toEqual(fb); // 비문자열 거부
    expect(nonEmptyStringArrayOr('안구', fb)).toEqual(fb);
  });

  it('ascendingBoundsOr — 길이·수치·순증 전부 만족해야 채택(NEDOCS 경계 역전 방지)', () => {
    const fb = [20, 60, 100, 140, 180];
    expect(ascendingBoundsOr([10, 50, 90, 130, 170], fb)).toEqual([10, 50, 90, 130, 170]);
    expect(ascendingBoundsOr([10, 50, 90, 130], fb)).toEqual(fb); // 길이 불일치
    expect(ascendingBoundsOr([10, 50, 90, 130, 'x'], fb)).toEqual(fb); // 비수치
    expect(ascendingBoundsOr([10, 50, 90, 90, 170], fb)).toEqual(fb); // 순증 위반
    expect(ascendingBoundsOr(null, fb)).toEqual(fb);
  });
});
