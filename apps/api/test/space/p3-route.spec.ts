import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SpaceModelService } from '../../src/modules/space-model/space-model.service';
import { WaitingQueueService } from '../../src/modules/waiting-queue/waiting-queue.service';
import { DateQueryPipe } from '../../src/common/pipes/date-query.pipe';

/**
 * 길안내(P3) — 서비스 이유 코드 · 공개 대기표 경로의 조건.
 *   ① 확정 도면 없음/REAL 합성 → NO_GEOMETRY · 도면에 없는 도착 → TARGET_NOT_IN_DRAWING · 모르는 출발 → START_UNKNOWN
 *   ② 기본 출발 = 주출입구 · 걷기 거리는 정수 m · 단계는 구조화(문장 없음)
 *   ③ 환자용 출입구 목록은 통제 출입구 제외
 *   ④ 대기표: 진료실 미연결 → ROOM_NOT_LINKED · 연결 → 통제 구역 통과 없이 경로 + 지나는 층 기하
 */
const FIX = JSON.parse(readFileSync(join(__dirname, '../../prisma/fixtures/floorplans-synthetic/space-import.v1.json'), 'utf8'));

function nodes() {
  const out: any[] = [];
  let i = 0;
  for (const F of FIX.floors) {
    out.push({ id: `00000000-0000-4000-8000-f0000000000${F.level + 1}`, code: F.spaceNodeCode, nodeType: 'FLOOR', floor: F.level, name: F.title, isActive: true, metadata: null });
    for (const s of F.spaces) if (s.spaceNodeCode)
      out.push({ id: `00000000-0000-4000-8000-${String(++i).padStart(12, '0')}`, code: s.spaceNodeCode, nodeType: 'ZONE', floor: F.level, name: s.name, isActive: true, metadata: null });
  }
  return out;
}
const N = nodes();
const idOf = (code: string) => N.find((n) => n.code === code)!.id;

function svc(opts: { mode?: string; imp?: any } = {}) {
  const prisma: any = {
    spaceNode: { findMany: vi.fn(async () => N) },
    spaceImport: { findFirst: vi.fn(async () => (opts.imp === undefined ? { id: 'i', status: 'CONFIRMED', source: 'SYNTHETIC', payload: FIX, confirmedAt: new Date() } : opts.imp)) },
  };
  return new SpaceModelService(prisma, { effective: vi.fn(async () => opts.mode ?? 'REHEARSAL') } as any);
}

describe('① 이유 코드', () => {
  it('도면 없음 · REAL 합성 · 도면에 없는 도착 · 모르는 출발', async () => {
    expect(await svc({ imp: null }).route({ to: idOf('F2-IM-201'), accessibleOnly: false, allowRestricted: false })).toMatchObject({ available: false, reason: 'NO_GEOMETRY' });
    expect(await svc({ mode: 'REAL' }).route({ to: idOf('F2-IM-201'), accessibleOnly: false, allowRestricted: false })).toMatchObject({ reason: 'NO_GEOMETRY' });
    expect(await svc().route({ to: '00000000-0000-4000-8000-999999999999', accessibleOnly: false, allowRestricted: false })).toMatchObject({ reason: 'TARGET_NOT_IN_DRAWING' });
    expect(await svc().route({ to: idOf('F2-IM-201'), from: 'entrance:nope', accessibleOnly: false, allowRestricted: false })).toMatchObject({ reason: 'START_UNKNOWN' });
  });
  it('통제 출입구는 환자 경로 출발점이 아니다', async () => {
    const rx = FIX.entrances.find((e: any) => e.restricted);
    expect(await svc().route({ to: idOf('F2-IM-201'), from: `entrance:${rx.id}`, accessibleOnly: false, allowRestricted: false })).toMatchObject({ reason: 'START_UNKNOWN' });
  });
});

describe('② 경로', () => {
  it('기본 출발 = 주출입구 · 정수 m · 구조화 단계(문장 없음) · 휠체어는 엘리베이터', async () => {
    const r: any = await svc().route({ to: idOf('F2-IM-201'), accessibleOnly: true, allowRestricted: false });
    expect(r.available).toBe(true);
    expect(Number.isInteger(r.walkM)).toBe(true);
    expect(r.steps[0]).toMatchObject({ kind: 'START', space: '주출입구 풍제실' });
    expect(r.steps.find((s: any) => s.kind === 'VERTICAL')).toMatchObject({ mode: 'ELEVATOR', fromFloor: '1F', toFloor: '2F' });
    for (const s of r.steps) if (s.kind === 'WALK') expect(Number.isInteger(s.distanceM)).toBe(true);
    expect(r.notice).toMatch(/실제 건물 아님/);
  });
});

describe('③ 출입구 목록', () => {
  it('환자용은 통제 출입구 제외 · 직원용은 포함', async () => {
    const pub = await svc().entrances(false);
    const staff = await svc().entrances(true);
    expect(pub.some((e) => e.name === '물품 하역장')).toBe(false);
    expect(staff.some((e) => e.name === '물품 하역장')).toBe(true);
    expect(pub.find((e) => e.main)?.name).toBe('주출입구 풍제실');
  });
});

describe('④ 대기표 길안내', () => {
  function wq(room: any) {
    const prisma: any = { clinicRoom: { findUnique: vi.fn(async () => room) } };
    const s = new WaitingQueueService(prisma, {} as any, undefined, undefined, undefined, svc());
    vi.spyOn(s, 'getGuide').mockResolvedValue({ roomName: '내과 1진료실' } as any);
    return s;
  }
  it('진료실 미연결 → ROOM_NOT_LINKED(경로 없음) · 출입구 목록은 준다', async () => {
    const r: any = await wq({ spaceNodeId: null }).guideRoute('q', undefined, false);
    expect(r).toMatchObject({ available: false, reason: 'ROOM_NOT_LINKED' });
    expect(r.entrances.length).toBeGreaterThan(0);
  });
  it('연결됨 → 경로 + 지나는 층 기하(외부 출입구 표시만) + 도착 강조 id', async () => {
    const s = wq({ spaceNodeId: idOf('F2-IM-201') });
    const spy = vi.spyOn((s as any).spaceModel, 'route');
    const r: any = await s.guideRoute('q', undefined, false);
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ allowRestricted: false })); // 🔴 환자 경로는 통제 구역 통과 금지
    expect(r.available).toBe(true);
    expect(r.targetSpaceNodeId).toBe(idOf('F2-IM-201'));
    expect(r.floors.map((f: any) => f.key).sort()).toEqual([...new Set(r.segments.map((s: any) => s.floor))].sort());
    for (const f of r.floors) expect(f.connections.every((c: any) => c.kind === 'EXTERIOR')).toBe(true);
  });
  it('대기표가 없으면(만료·부존재) null', async () => {
    const s = wq({ spaceNodeId: idOf('F2-IM-201') });
    (s.getGuide as any).mockResolvedValue(null);
    expect(await s.guideRoute('q', undefined, false)).toBeNull();
  });
});

describe('⑤ 전역 날짜 파이프와 충돌하지 않는다(2026-09-28 운영 실측 — `to` 에 UUID 를 넣어 400)', () => {
  const strip = (f: string) => readFileSync(join(__dirname, '../../src/modules', f), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
  it('경로 컨트롤러는 날짜 예약 키(from·to·start·end)를 쿼리 이름으로 쓰지 않는다', () => {
    for (const f of ['space-model/space-model.controller.ts', 'waiting-queue/guide.controller.ts'])
      expect(strip(f)).not.toMatch(/@Query\('(from|to|start|end|date|since|until)'\)/);
  });
  it('실제 파이프: origin·dest 에 UUID/출입구 id 는 통과 · 대조군 to 는 400', () => {
    const pipe = new DateQueryPipe();
    const uuid = '4bf3a655-1511-470c-ab10-7e243a313703';
    expect(pipe.transform(uuid, { type: 'query', data: 'dest' } as any)).toBe(uuid);
    expect(pipe.transform('entrance:1F-C038', { type: 'query', data: 'origin' } as any)).toBe('entrance:1F-C038');
    expect(() => pipe.transform(uuid, { type: 'query', data: 'to' } as any)).toThrow();
  });
});
