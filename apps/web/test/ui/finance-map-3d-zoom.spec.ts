/**
 * 경영성과 3D 지도 — 확대에 따라 크기·묶음이 조정된다(2026-09-30 사람 보고).
 *  🔴 건물이 월드 크기 고정이라 확대해도 크기가 안 바뀌어 수도권·서울이 서로를 덮는 벽이 됐고, 앞의 큰 건물이 클릭을 다 가져가
 *     아무것도 누를 수 없었다. 3D 는 묶음도 없었다(2D 는 "n곳" 묶음이 확대하면 풀린다).
 *  1. zoomScale — 가까울수록 작게(화면 크기 일정) · 전국 맞춤 거리에서 1
 *  2. 묶음 판정 정본 groupMarkers 를 2D·3D 가 함께 쓴다
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { zoomScale, REF_DIST_DEFAULT } from '@/app/(main)/executive/finance-benchmark/KoreaMap3D';
import { groupMarkers, CLUSTER_OFF_PPD } from '@/app/(main)/executive/finance-benchmark/finance-map';

const DIR = join(process.cwd(), 'src/app/(main)/executive/finance-benchmark');
const code = (f: string) => readFileSync(join(DIR, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n');

describe('확대 배율', () => {
  it('전국 맞춤 거리에서 1 · 가까워질수록 작아진다 · 하한·상한', () => {
    expect(zoomScale(REF_DIST_DEFAULT, REF_DIST_DEFAULT)).toBe(1);
    const near = zoomScale(REF_DIST_DEFAULT / 10, REF_DIST_DEFAULT);
    expect(near).toBeLessThan(0.2);
    expect(near).toBeGreaterThan(0.1); // 지수 0.85 — 조금은 커진다(2D grow 와 같은 뜻)
    expect(zoomScale(1, REF_DIST_DEFAULT)).toBe(0.03);
    expect(zoomScale(REF_DIST_DEFAULT * 3, REF_DIST_DEFAULT)).toBe(1);
    expect(zoomScale(0, REF_DIST_DEFAULT)).toBe(1); // 모르면 원래 크기
  });
});

describe('묶음 판정 정본', () => {
  const it3 = (k: string, x: number, y: number, pinned = false) => ({ key: k, x, y, pinned, surplus: true });
  it('한 칸에 몰린 표식은 묶이고, 선택(고정)은 묶이지 않고, 풀림 기준 이상이면 모두 낱개', () => {
    const items = [it3('a', 10, 10), it3('b', 12, 11), it3('c', 13, 12, true)];
    const g = groupMarkers(items, 100);
    expect(g.clusters).toHaveLength(1);
    expect(g.clusters[0].n).toBe(2);
    expect(g.singles.map((s) => s.key)).toEqual(['c']);
    expect(groupMarkers(items, CLUSTER_OFF_PPD).clusters).toHaveLength(0);
    expect(groupMarkers(items, 100, true).clusters).toHaveLength(0);
  });
  it('2D·3D 가 같은 함수를 부른다(3D 가 자기 규칙을 두지 않는다)', () => {
    expect(code('KoreaBubbleMap.tsx')).toMatch(/groupMarkers\(bubbles, ppd, clusterOff\)/);
    expect(code('KoreaMap3D.tsx')).toMatch(/groupMarkers\(items, ppd\)/);
    expect(code('KoreaBubbleMap.tsx')).not.toMatch(/clusterByGrid\(/);
  });
});

describe('3D 건물 배치가 확대 배율을 쓴다', () => {
  const src = code('KoreaMap3D.tsx');
  it('몸체 크기에 S 를 곱한다 · 카메라가 멈추면 다시 배치한다', () => {
    expect(src).toMatch(/const S = zoomScale\(dist, core\.refDist\)/);
    expect(src).toMatch(/const bw = w \* f\.w \* S, bh = h \* f\.h \* S/);
    expect(src).toMatch(/relayoutRef\.current\(\)/);
    expect(src).toMatch(/\[ready, shown, selected, sido, sggQ\.data, layoutTick\]/);
  });
  it('묶음은 누를 수 있다 — 누르면 그 자리로 다가간다', () => {
    expect(src).toMatch(/core\.pick\.push\(\{ mesh: disc, clusters: grouped\.clusters \}\)/);
    expect(src).toMatch(/else if \(c\) \{/);
  });
});
