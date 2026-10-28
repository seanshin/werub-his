/**
 * "지금 어디 있나" 판정 정본(2026-10-03 · `floor/current-location.ts`).
 *  🔴 종전: 8개 읽기 경로(층 보드 4·메타버스 3·환자 흐름 1)가 열린 위치를 전부 "현재"로 셌다 — 7~9월 추정 위치가 지금처럼 ·
 *     3D 상황판만 화면에서 "오늘만" 걸렀다(정본 둘 — 여러 날 재원 중인 입원 환자를 숨겼다)
 *  · 현재 = 열린 기록 중 오늘(KST) 들어왔거나 재원 중(ADMITTED)·응급 진행 중(COMPLETED 아님) 환자
 *  · 오래된 열린 기록은 싣지 않고 수(staleOpen)로 · 떠난 시각을 지어내 닫지 않는다
 *  · 구조 가드: "현재"를 `leftAt: null` 로 직접 읽는 자리는 쓰기·이동 경로뿐(새 읽기 경로가 정본을 우회하면 실패)
 * 재주입: 재원/응급 포함·오늘 경계·오래된 기록 제외·소비처 배선·meta 를 되돌리면 실패한다.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { currentLocationScope } from '../../src/modules/floor/current-location';
import { MetaverseService } from '../../src/modules/metaverse/metaverse.service';

const NOW = new Date('2026-10-03T05:00:00Z'); // KST 14:00
const prismaOf = (adm: string[], er: string[]) => ({
  admission: { findMany: vi.fn(async () => adm.map((patientId) => ({ patientId }))) },
  emergencyVisit: { findMany: vi.fn(async () => er.map((patientId) => ({ patientId }))) },
});

describe('판정 규칙', () => {
  it('🔴 현재 = 열린 기록 ∧ (오늘 KST 들어옴 ∨ 재원·응급 진행 중 환자) · 오래된 = 열린 기록 ∧ 오늘 이전 ∧ 그 환자들이 아님', async () => {
    const p = prismaOf(['p-in', 'p-both'], ['p-er', 'p-both']);
    const s = await currentLocationScope(p as never, NOW);
    expect(s.since.getTime()).toBe(new Date(2026, 9, 3, 0, 0, 0, 0).getTime()); // 서버 로컬(=KST) 자정
    expect(s.current).toEqual({ leftAt: null, OR: [{ enteredAt: { gte: s.since } }, { patientId: { in: ['p-in', 'p-both', 'p-er'] } }] });
    expect(s.stale).toEqual({ leftAt: null, enteredAt: { lt: s.since }, patientId: { notIn: ['p-in', 'p-both', 'p-er'] } });
    expect(s.activeStayPatients).toBe(3);
    // 재원 = ADMITTED · 응급 = COMPLETED 아님
    expect((p.admission.findMany.mock.calls[0] as any)[0].where).toEqual({ status: 'ADMITTED' });
    expect((p.emergencyVisit.findMany.mock.calls[0] as any)[0].where).toEqual({ status: { not: 'COMPLETED' } });
  });

  it('대조군 — 재원·응급이 없으면 오늘 기록만 현재 · 오래된 조건에 빈 notIn 을 넣지 않는다', async () => {
    const s = await currentLocationScope(prismaOf([], []) as never, NOW);
    expect(s.current).toEqual({ leftAt: null, OR: [{ enteredAt: { gte: s.since } }] });
    expect(s.stale).toEqual({ leftAt: null, enteredAt: { lt: s.since } });
  });
});

describe('메타버스 현재 위치 — 오래된 기록은 수로', () => {
  it('🔴 정본 조건으로 조회하고 오래된 열린 기록 수·잘림을 meta 로 말한다', async () => {
    const prisma: any = {
      ...prismaOf(['p-in'], []),
      patientLocation: {
        findMany: vi.fn(async () => [{ id: 'l1', patientId: 'p-in', zoneId: 'z1', status: 'resting', enteredAt: new Date('2026-07-25T00:00:00Z'), source: 'INFERRED_EVENT', granularity: 'ZONE' }]),
        count: vi.fn(async (a: any) => (a.where.enteredAt?.lt ? 7 : 600)),
      },
      patient: { findMany: vi.fn(async () => []) },
      spaceNode: { findMany: vi.fn(async () => []) },
    };
    const r = await new MetaverseService(prisma).getPatientLocations();
    expect((prisma.patientLocation.findMany.mock.calls[0] as any)[0].where.OR).toBeDefined();
    expect(r.items).toHaveLength(1);
    expect(r.meta).toMatchObject({ rule: 'TODAY_OR_ACTIVE_STAY', staleOpen: 7, truncated: true, total: 600 });
  });

  it('컨트롤러는 배열을 data 에, 판정 정보를 meta 에(화면들이 data 를 배열로 읽는다)', () => {
    const c = readFileSync(join(__dirname, '../../src/modules/metaverse/metaverse.controller.ts'), 'utf8');
    expect(c).toMatch(/return \{ data: r\.items, meta: r\.meta \};/);
  });
});

describe('구조 가드 — "현재"를 직접 읽지 않는다', () => {
  const ROOT = join(__dirname, '../../src/modules');
  const files: string[] = [];
  const walk = (d: string) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (p.endsWith('.ts') && !p.endsWith('.spec.ts')) files.push(p); } };
  walk(ROOT);

  it('🔴 `leftAt: null` 을 쓰는 자리는 쓰기·이동 경로뿐 — 위치 열기·닫기(floor.service)·QR 직전 구역(patient-flow)', () => {
    const hits: string[] = [];
    for (const f of files) {
      // 주석은 걷어내고 센다 — 종전 결함을 설명하는 주석이 문자열 검사에 걸리지 않게
      const src = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      const n = (src.match(/leftAt: null\b/g) ?? []).length;
      if (n) hits.push(`${relative(ROOT, f)}:${n}`);
    }
    // current-location.ts 는 정본 자체(현재·오래된 조건 2)
    // dev-demo/demo-movement.service — 데모 이동 시뮬레이터(쓰기 경로 · 이동할 환자의 열린 위치를 읽어 바꿀지 정한다 · 2026-10-09)
    // wifi-location/wifi-positioning.service — 무선 측위가 방을 확인했을 때 지금 열린 위치와 비교(쓰기 경로 · 2026-10-09)
    expect(hits.sort()).toEqual(['dev-demo/demo-movement.service.ts:1', 'floor/current-location.ts:2', 'floor/floor.service.ts:2', 'patient-flow/patient-flow.service.ts:1', 'wifi-location/wifi-positioning.service.ts:1']);
  });

  it('🔴 현재 위치를 읽던 8자리가 정본을 쓴다(층 보드 4 · 메타버스 3 · 환자 흐름 1)', () => {
    const count = (rel: string) => (readFileSync(join(ROOT, rel), 'utf8').match(/scope\.current/g) ?? []).length;
    expect(count('floor/floor.service.ts')).toBeGreaterThanOrEqual(4);
    expect(count('metaverse/metaverse.service.ts')).toBeGreaterThanOrEqual(3);
    expect(count('patient-flow/patient-flow.service.ts')).toBeGreaterThanOrEqual(1);
  });
});
