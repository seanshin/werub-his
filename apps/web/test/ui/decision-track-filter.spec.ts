/**
 * 결정 등록부 화면의 **거르기**(2026-09-08) — 항목이 38 → 56 이 되면서 층 셋만으로는 못 찾는다.
 *
 * 이 가드가 지키는 것:
 *  · 축·상태가 실제로 거른다(거르는 척하지 않는다)
 *  · 🔴 **요약 분모는 필터에 흔들리지 않는다** — 거른 뒤 수만 보면 "남은 일이 줄었다"는 거짓 안심이 생긴다
 *  · 🔴 축 라벨을 화면이 다시 적지 않는다(정본은 서버 등록부 하나 — 사본을 두면 축을 늘릴 때 갈라진다)
 *  · 🔴 자르면 잘랐다고 말한다
 *
 * 재주입: 필터 정본을 무조건 true 로 만들거나, 요약을 `visible` 로 계산하게 바꾸면 실패한다.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { matchesDecisionFilter, STATUS_FILTER_LABEL, type DecisionItem } from
  '../../src/app/(main)/admin/decisions/types';

const SRC = fs.readFileSync(
  path.join(__dirname, '../../src/app/(main)/admin/decisions/page.tsx'), 'utf-8');

type Row = Pick<DecisionItem, 'track' | 'decided' | 'readyToDecide' | 'blockedBy'>;
const row = (p: Partial<Row>): Row =>
  ({ track: 'I18N', decided: false, readyToDecide: true, blockedBy: [], ...p });

const READY = row({});
const BLOCKED = row({ readyToDecide: false, blockedBy: [{ key: 'x', title: 'x', reason: '아직 결정되지 않음' }] });
const DECIDED = row({ decided: true, readyToDecide: false });

describe('거르기 정본 — 실제로 거른다', () => {
  it('축이 다르면 어떤 상태든 빠진다', () => {
    expect(matchesDecisionFilter(READY, 'COUNTRY', 'ALL')).toBe(false);
    expect(matchesDecisionFilter(READY, 'I18N', 'ALL')).toBe(true);
    expect(matchesDecisionFilter(DECIDED, 'COUNTRY', 'DECIDED')).toBe(false);
  });

  it('🔴 상태 셋이 서로 배타다 — 선행 대기를 미결과 같이 세면 "왜 아무도 안 하지"로 읽힌다', () => {
    expect(matchesDecisionFilter(READY, 'ALL', 'READY')).toBe(true);
    expect(matchesDecisionFilter(READY, 'ALL', 'BLOCKED')).toBe(false);
    expect(matchesDecisionFilter(BLOCKED, 'ALL', 'BLOCKED')).toBe(true);
    expect(matchesDecisionFilter(BLOCKED, 'ALL', 'READY')).toBe(false);
    expect(matchesDecisionFilter(DECIDED, 'ALL', 'DECIDED')).toBe(true);
    expect(matchesDecisionFilter(DECIDED, 'ALL', 'READY')).toBe(false);
  });

  it('대조군: 전체는 아무것도 거르지 않는다(전부 막는 가드가 아니다)', () => {
    for (const r of [READY, BLOCKED, DECIDED]) {
      expect(matchesDecisionFilter(r, 'ALL', 'ALL')).toBe(true);
    }
  });

  it('상태 라벨이 네 가지 전부 있다', () => {
    expect(Object.keys(STATUS_FILTER_LABEL).sort()).toEqual(['ALL', 'BLOCKED', 'DECIDED', 'READY']);
  });
});

describe('화면 계약 — 분모와 정본', () => {
  it('🔴 층별 요약·개시 전 필수는 **서버 집계**를 쓴다(필터로 줄어들지 않는다)', () => {
    expect(SRC).toMatch(/payload\?\.summary\?\.byLayer/);
    expect(SRC).toMatch(/payload\.summary\.goLiveRequired/);
    // 요약을 거른 목록으로 다시 계산하면 분모가 흔들린다
    expect(SRC, '요약을 visible 로 계산하면 안 된다').not.toMatch(/summary[\s\S]{0,80}visible\./);
  });

  it('🔴 전체 건수를 항상 함께 낸다 — 거른 수만 보여주지 않는다', () => {
    expect(SRC).toMatch(/\{visible\.length\}/);
    expect(SRC).toMatch(/\/ \{items\.length\}/);
  });

  it('🔴 축 라벨은 서버(등록부)에서 온다 — 화면이 사본을 두지 않는다', () => {
    expect(SRC).toMatch(/payload\?\.tracks\?\.\[/);
    expect(SRC, '화면이 축 라벨 표를 자체 선언하면 등록부와 갈라진다')
      .not.toMatch(/const\s+TRACK_LABEL\s*[:=]/);
  });

  it('🔴 거르기는 정본 함수를 쓴다(화면이 규칙을 다시 적지 않는다)', () => {
    expect(SRC).toMatch(/matchesDecisionFilter\(i, track, status\)/);
  });

  it('🔴 자르면 잘랐다고 말한다 — "지금 가능" 목록의 나머지 행방까지', () => {
    expect(SRC).toMatch(/readyHere\.length > readyShown\.length/);
    expect(SRC).toMatch(/아래 층별 목록에 전부 있습니다/);
  });

  it('🔴 필터로 빈 층과 원래 없는 층을 구분해 말한다', () => {
    expect(SRC).toMatch(/고른 조건에 맞는 항목이 없습니다/);
    expect(SRC).toMatch(/layerTotal/);
  });
});
