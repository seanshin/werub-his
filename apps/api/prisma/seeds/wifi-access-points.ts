import { assertSeedAllowed } from '../seed-mode-guard';
/**
 * 데모 무선 AP 배치 시드(2026-10-09) — 확정 도면(space-import.v1) 각 층에 격자로 AP 를 놓는다.
 * 실행: HIS_MODE=DEV npx ts-node prisma/seeds/wifi-access-points.ts   (REHEARSAL 도 허용 · REAL 은 중단)
 *
 * 🔴 실제 설치가 아니다 — `dataOrigin: 'SEED'` · 라벨 끝에 "(데모)" · BSSID 는 로컬 관리 주소(02:…)라 실제 장비와 겹치지 않는다.
 *    교정값은 넣지 않는다(기본 전파 모델 → 화면이 "교정 안 됨"이라고 말한다).
 * 🔴 있으면 건드리지 않는다(BSSID 기준 create-only) — 관리자가 고친 좌표·교정을 시드가 되돌리지 않는다.
 * 배치 규칙: 층 윤곽 안을 AP_SPACING_M 간격 격자로 · 수직 코어(계단·엘리베이터) 안의 점은 뺀다 · 층마다 최소 3대(측위 POINT 조건).
 */
import { PrismaClient } from '@prisma/client';
import type { SpaceImportV1 } from '@hospital-run/shared';

export const AP_SPACING_M = 12;

export interface PlannedAp { bssid: string; label: string; floorKey: string; floorLevel: number; x: number; y: number; spaceNodeCode: string | null }

const hex2 = (n: number) => (n & 255).toString(16).padStart(2, '0');

/** 순수 배치 — 같은 도면이면 같은 AP(멱등) */
export function planDemoAccessPoints(payload: SpaceImportV1, spacing = AP_SPACING_M): PlannedAp[] {
  const out: PlannedAp[] = [];
  payload.floors.forEach((f, fi) => {
    const fp = f.footprint;
    const cores = f.spaces.filter((s) => s.verticalCore);
    const inCore = (x: number, y: number) => cores.some((s) => x >= s.rect.x && x <= s.rect.x + s.rect.w && y >= s.rect.y && y <= s.rect.y + s.rect.h);
    const pts: Array<[number, number]> = [];
    for (let y = fp.y + spacing / 2; y < fp.y + fp.h; y += spacing) {
      for (let x = fp.x + spacing / 2; x < fp.x + fp.w; x += spacing) if (!inCore(x, y)) pts.push([x, y]);
    }
    // 작은 층 — 격자가 3점 미만이면 윤곽의 세 모서리 안쪽에 둔다
    if (pts.length < 3) {
      const m = Math.min(3, fp.w / 4, fp.h / 4);
      pts.length = 0;
      pts.push([fp.x + m, fp.y + m], [fp.x + fp.w - m, fp.y + m], [fp.x + fp.w / 2, fp.y + fp.h - m]);
    }
    pts.forEach(([x, y], i) => {
      const space = f.spaces.filter((s) => x >= s.rect.x && x <= s.rect.x + s.rect.w && y >= s.rect.y && y <= s.rect.y + s.rect.h)
        .sort((a, b) => a.rect.w * a.rect.h - b.rect.w * b.rect.h)[0];
      out.push({
        bssid: `02:57:46:${hex2(fi)}:${hex2(i >> 8)}:${hex2(i)}`,
        label: `AP-${f.key}-${String(i + 1).padStart(2, '0')} (데모)`,
        floorKey: f.key, floorLevel: f.level, x, y, spaceNodeCode: space?.spaceNodeCode ?? null,
      });
    });
  });
  return out;
}

async function main() {
  const prisma = new PrismaClient();
  try {
    const imp = await prisma.spaceImport.findFirst({ where: { status: 'CONFIRMED' }, orderBy: { confirmedAt: 'desc' } });
    if (!imp) { console.log('확정 도면이 없습니다 — AP 를 놓을 층 좌표가 없어 아무것도 하지 않았습니다.'); return; }
    const plan = planDemoAccessPoints(imp.payload as unknown as SpaceImportV1);
    const codes = [...new Set(plan.map((p) => p.spaceNodeCode).filter((c): c is string => !!c))];
    const nodes = await prisma.spaceNode.findMany({ where: { code: { in: codes } }, select: { id: true, code: true } });
    const idByCode = new Map(nodes.map((n) => [n.code!, n.id]));
    const r = await prisma.wifiAccessPoint.createMany({
      data: plan.map((p) => ({
        bssid: p.bssid, label: p.label, floorKey: p.floorKey, floorLevel: p.floorLevel, x: p.x, y: p.y,
        zoneId: p.spaceNodeCode ? idByCode.get(p.spaceNodeCode) ?? null : null, vendor: 'DEMO', dataOrigin: 'SEED',
      })),
      skipDuplicates: true,
    });
    const perFloor = new Map<string, number>();
    for (const p of plan) perFloor.set(p.floorKey, (perFloor.get(p.floorKey) ?? 0) + 1);
    console.log(`데모 AP — 계획 ${plan.length}대 · 새로 넣음 ${r.count}대(이미 있던 것은 그대로) · 층별 ${[...perFloor].map(([k, n]) => `${k} ${n}`).join(' · ')}`);
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  assertSeedAllowed(__filename, 'DEMO');
  main().catch((e) => { console.error(e); process.exit(1); });
}
