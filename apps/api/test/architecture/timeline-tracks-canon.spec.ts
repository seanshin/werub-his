import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TIMELINE_TRACKS } from '../../src/modules/record-timeline/record-timeline.service';

/**
 * 🔴 **트랙 정본은 `TIMELINE_TRACKS` 하나다** — 화면은 그것을 소비만 한다.
 *
 * 실제 소비 경로: 서버가 응답에 `tracks` 를 실어 보내고, FE 는 그 목록으로 필터 칩을 그린 뒤
 * **칩과 카드의 색·라벨을 `TRACK_UI[t.type]` 에서 꺼낸다**. 그래서 정본에만 트랙을 추가하고
 * FE 표를 잊으면 tsc·기존 테스트는 전부 통과하는데 **화면이 그 칩에서 죽는다**
 * (`ui.dot` 을 undefined 에서 읽는다). 집합 일치를 여기서 기계 대조한다.
 *
 * 기획서 §5 `timeline-tracks-canon.spec` 에 해당한다.
 */

const REPO_ROOT = join(__dirname, '..', '..', '..', '..');
const CARD = join(REPO_ROOT, 'apps/web/src/components/record-timeline/record-card.tsx');

/** FE `TRACK_UI` 의 키 집합 — 라벨·색을 실제로 꺼내 쓰는 표 */
function feTrackUiKeys(src: string): string[] {
  const m = /export const TRACK_UI: Record<TrackType, \{[^}]*\}> = \{([\s\S]*?)\n\};/.exec(src);
  if (!m) throw new Error('record-card.tsx 에서 TRACK_UI 표를 찾지 못했습니다 — 이 가드가 헛돌고 있습니다');
  return [...m[1].matchAll(/^\s{2}([A-Z_]+):/gm)].map((x) => x[1]);
}

/** FE `TrackType` 유니언의 멤버 집합 */
function feTrackTypeUnion(src: string): string[] {
  const m = /export type TrackType = ([^;]+);/.exec(src);
  if (!m) throw new Error('record-card.tsx 에서 TrackType 유니언을 찾지 못했습니다 — 이 가드가 헛돌고 있습니다');
  return [...m[1].matchAll(/'([A-Z_]+)'/g)].map((x) => x[1]);
}

describe('임상 기록 통합 시계열 — 트랙 정본과 화면 표가 갈라지지 않는다', () => {
  const src = readFileSync(CARD, 'utf-8');

  it('가드가 실제로 무언가를 세고 있다(대조군)', () => {
    // 🔴 파싱이 0을 뽑아도 "집합 일치"는 통과한다 — 그러면 이 파일은 아무것도 보증하지 않는다
    expect(TIMELINE_TRACKS.length, '정본 트랙을 하나도 못 읽었다').toBeGreaterThan(10);
    expect(feTrackUiKeys(src).length, 'FE TRACK_UI 를 하나도 못 읽었다').toBeGreaterThan(10);
    expect(feTrackTypeUnion(src).length, 'FE TrackType 을 하나도 못 읽었다').toBeGreaterThan(10);
  });

  it('🔴 정본 트랙 집합 = FE TRACK_UI 키 집합 (한쪽만 고치면 칩에서 화면이 죽는다)', () => {
    const canon = [...TIMELINE_TRACKS.map((t) => t.type)].sort();
    expect(feTrackUiKeys(src).sort()).toEqual(canon);
  });

  it('🔴 정본 트랙 집합 = FE TrackType 유니언', () => {
    const canon = [...TIMELINE_TRACKS.map((t) => t.type)].sort();
    expect(feTrackTypeUnion(src).sort()).toEqual(canon);
  });

  it('AI 제안이 12번째 트랙으로 등재돼 있다(기획 §2.3)', () => {
    expect(TIMELINE_TRACKS.map((t) => t.type)).toContain('AI_PROPOSAL');
    // 라벨은 비어 있으면 칩이 이름 없이 뜬다
    for (const t of TIMELINE_TRACKS) expect(t.label.length, t.type).toBeGreaterThan(0);
  });

  it('트랙 키가 중복되지 않는다(같은 칩이 둘이면 counts 가 갈라진다)', () => {
    const keys = TIMELINE_TRACKS.map((t) => t.type);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
