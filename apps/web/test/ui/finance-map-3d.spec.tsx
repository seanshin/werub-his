import { describe, it, expect, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as THREE from 'three';
import KoreaMap3D, { CAM_MAX, CAM_MIN, buildingSize, panPose, proj3d, rotatePose, zoomPose } from '../../src/app/(main)/executive/finance-benchmark/KoreaMap3D';

/**
 * 경영성과 3D 지도(2026-09-29 · 기획 finance-map-visual-3d §3-2).
 * 🔴 WebGL 을 만들 수 없으면 조용히 빈 판을 두지 않고 `onUnavailable` 로 알린다(부모가 2D 로 돌아가 그 사실을 말한다).
 */
describe('3D 지도', () => {
  it('투영 — 기준점은 원점 · 동쪽은 +x · 북쪽은 −z(화면 안쪽)', () => {
    const [x0, z0] = proj3d(127.7, 36.1);
    expect(Math.abs(x0) + Math.abs(z0)).toBe(0);
    const [xE] = proj3d(128.7, 36.1);
    const [, zN] = proj3d(127.7, 37.1);
    expect(xE).toBeGreaterThan(0);
    expect(zN).toBeLessThan(0);
  });
  it('건물 치수 — 규모가 클수록 높고 굵다 · 규모 모름(null)은 최소(지어내지 않는다)', () => {
    const lo = buildingSize(null), mid = buildingSize(0.5), hi = buildingSize(1);
    expect(lo).toEqual(buildingSize(0));
    expect(mid.h).toBeGreaterThan(lo.h);
    expect(hi.h).toBeGreaterThan(mid.h);
    expect(hi.w).toBeGreaterThan(lo.w);
  });
  it('🔴 WebGL 불가(jsdom) → onUnavailable 호출', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ provinces: [], sido: {} }) })));
    const onUnavailable = vi.fn();
    render(
      <QueryClientProvider client={new QueryClient()}>
        <KoreaMap3D points={[]} sido="" selected={null} onPick={() => {}} onUnavailable={onUnavailable} />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(onUnavailable).toHaveBeenCalled());
    vi.unstubAllGlobals();
  });
});

describe('3D 조작 도구 — 상하좌우 이동·확대/축소·회전(카메라 목표 계산)', () => {
  // 남쪽 위에서 북쪽을 비스듬히 본다: 카메라 (0,100,100) → 목표 (0,0,0)
  const p = { pos: new THREE.Vector3(0, 100, 100), target: new THREE.Vector3(0, 0, 0) };
  it('위 = 화면 위쪽(보는 방향을 땅에 투영 · 북쪽 −z) · 오른쪽 = 동쪽 +x · 높이는 그대로 · 카메라와 목표가 같이 움직인다', () => {
    const up = panPose(p, 'up'), right = panPose(p, 'right'), down = panPose(p, 'down');
    expect(up.target.z).toBeLessThan(0);
    expect(up.target.x).toBeCloseTo(0);
    expect(up.pos.y).toBeCloseTo(100);
    expect(right.target.x).toBeGreaterThan(0);
    expect(down.target.z).toBeGreaterThan(0);
    expect(up.pos.clone().sub(up.target).length()).toBeCloseTo(p.pos.clone().sub(p.target).length());
  });
  it('위에서 내려다볼 때(보는 방향이 수직)도 위 = 북쪽', () => {
    const top = { pos: new THREE.Vector3(0, 300, 0), target: new THREE.Vector3(0, 0, 0) };
    expect(panPose(top, 'up').target.z).toBeLessThan(0);
  });
  it('확대/축소는 거리만 바꾸고 한계(최소·최대 거리) 안에서 멈춘다', () => {
    const d0 = p.pos.distanceTo(p.target);
    expect(zoomPose(p, 0.5).pos.distanceTo(p.target)).toBeCloseTo(d0 * 0.5);
    expect(zoomPose(p, 0.0001).pos.distanceTo(p.target)).toBeCloseTo(CAM_MIN);
    expect(zoomPose(p, 1000).pos.distanceTo(p.target)).toBeCloseTo(CAM_MAX);
  });
  it('회전은 목표를 축으로 돌고 거리·높이는 그대로', () => {
    const r = rotatePose(p, Math.PI / 2);
    expect(r.target.equals(p.target)).toBe(true);
    expect(r.pos.y).toBeCloseTo(100);
    expect(r.pos.distanceTo(r.target)).toBeCloseTo(p.pos.distanceTo(p.target));
    expect(Math.abs(r.pos.x)).toBeCloseTo(100);
  });
  it('WebGL 이 없어도 조작 도구가 그려지고(키보드 포커스 가능) 눌러도 오류가 없다', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ provinces: [], sido: {} }) })));
    const { container, getByLabelText } = render(
      <QueryClientProvider client={new QueryClient()}>
        <KoreaMap3D points={[]} sido="" selected={null} onPick={() => {}} />
      </QueryClientProvider>,
    );
    expect(container.querySelector('[data-controls="3d"]')).toBeTruthy();
    for (const l of ['위로 이동', '아래로 이동', '왼쪽으로 이동', '오른쪽으로 이동', '확대', '축소', '전체 맞춤', '왼쪽으로 회전', '오른쪽으로 회전']) getByLabelText(l).click();
    expect((container.firstChild as HTMLElement).getAttribute('tabindex')).toBe('0');
    vi.unstubAllGlobals();
  });
});
