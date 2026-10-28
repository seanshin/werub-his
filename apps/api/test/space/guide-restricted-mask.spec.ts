/**
 * 공개 길안내 — 통제 구역 가림(2026-10-12 사용자 지시 · 결정 `wayfinding.patientExposure` = QR_GUIDE_MASK_RESTRICTED).
 *  · 🔴 무인증 대기표 QR 응답에 통제 구역(관계자 외)의 이름·번호·사각형이 그대로 나갔다 — 경로는 통제 구역을 지나지 않는데도
 *  · 통제 구역·통제 출입구는 응답에서 뺀다 · 뺀 수만 남긴다(빈 자리를 "없는 공간"으로 읽지 않게 화면이 말한다)
 *  · 대조군: 직원 뷰어(geometry)는 그대로 통제 구역을 본다 · 공개 층에 일반 공간은 남는다
 */
import { describe, it, expect } from 'vitest';
import { SpaceModelService } from '../../src/modules/space-model/space-model.service';

const GEO = {
  importId: 'i', source: 'UPLOAD', synthetic: false, notice: null, confirmedAt: null,
  floors: [
    { key: '1F', level: 1, title: '1층', elevationM: 0, heightM: 4, footprint: { w: 40, h: 30 }, spaceNodeId: null,
      spaces: [
        { id: 's1', name: '내과 진료실', number: '101', type: 'CLINIC', rect: { x: 0, y: 0, w: 5, h: 5 }, open: true, restricted: false, verticalCore: null, spaceNodeId: 'n1' },
        { id: 's2', name: '마약류 보관실', number: '109', type: 'STORAGE', rect: { x: 10, y: 0, w: 4, h: 4 }, open: false, restricted: true, verticalCore: null, spaceNodeId: null },
        { id: 's3', name: '전산실', number: '110', type: 'IT', rect: { x: 20, y: 0, w: 4, h: 4 }, open: false, restricted: true, verticalCore: null, spaceNodeId: null },
      ],
      connections: [
        { id: 'c1', kind: 'EXTERIOR', at: [0, 15], widthM: 2, restricted: false },
        { id: 'c2', kind: 'EXTERIOR', at: [40, 15], widthM: 1, restricted: true },
        { id: 'c3', kind: 'DOOR', at: [5, 2], widthM: 1, restricted: false },
      ] },
    { key: '2F', level: 2, title: '2층', elevationM: 4, heightM: 4, footprint: { w: 40, h: 30 }, spaceNodeId: null, spaces: [], connections: [] },
  ],
};
const svc = () => { const s = Object.create(SpaceModelService.prototype) as SpaceModelService; (s as any).geometry = async () => GEO; return s; };

describe('🔴 공개 길안내 응답 — 통제 구역을 싣지 않는다', () => {
  it('통제 구역 이름·번호·사각형이 응답 어디에도 없다 · 뺀 수를 남긴다 · 통제 출입구도 뺀다', async () => {
    const floors = await svc().floorsForRoute(['1F']);
    expect(floors).toHaveLength(1);
    const json = JSON.stringify(floors);
    for (const t of ['마약류 보관실', '전산실', '"109"', '"110"', '"s2"', '"s3"']) expect(json, t).not.toContain(t);
    expect(floors[0].restrictedHidden).toBe(2);
    expect(floors[0].connections.map((c) => c.id)).toEqual(['c1']);
  });
  it('대조군 — 일반 공간은 남고, 경로가 지나지 않는 층은 싣지 않는다 · 직원 뷰어(geometry)는 통제 구역을 그대로 본다', async () => {
    const s = svc();
    const floors = await s.floorsForRoute(['1F']);
    expect(floors[0].spaces.map((x) => x.name)).toEqual(['내과 진료실']);
    expect((await s.geometry())!.floors[0].spaces.filter((x) => x.restricted)).toHaveLength(2);
  });
});
