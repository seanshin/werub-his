import { assertSeedAllowed } from './seed-mode-guard';
assertSeedAllowed(__filename, 'DEMO'); // 🔴 가상 병원 데모·기관 특정 데이터 — REAL 에서 중단(상용 릴리즈 T2-3)
// 병원 동선 시각화용 SpaceNode 메타데이터 시드 (재실행 가능)
// - 존별 bounds(그리드 자동배치)·door·sla(metadata) + connectedTo(허브 스타 토폴로지)
// - 층별 metadata.grid
// 실행: npx ts-node prisma/seed-floor-metadata.ts
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const WAIT: Record<string, number> = {
  WAITING: 15, RECEPTION: 10, CASHIER: 10, CLINIC: 20, LAB: 20,
  PHARMACY: 10, IMAGING: 25, ENDOSCOPY: 30, EKG: 15, PFT: 15, ER: 10,
};
const HUB_PRIORITY = ['RECEPTION', 'WAITING', 'NURSE_STATION', 'LOBBY'];

async function main() {
  const floors = await prisma.spaceNode.findMany({ where: { nodeType: 'FLOOR' } });
  let updatedZones = 0;

  for (const f of floors) {
    const children = await prisma.spaceNode.findMany({ where: { parentId: f.id, isActive: true } });
    const grand = children.length
      ? await prisma.spaceNode.findMany({ where: { parentId: { in: children.map((c) => c.id) }, isActive: true } })
      : [];
    const zones = [...children, ...grand].filter((z) => z.nodeType === 'ZONE' || z.nodeType === 'WING');
    if (!zones.length) continue;

    zones.sort((a, b) => (a.sortOrder - b.sortOrder) || (a.code ?? '').localeCompare(b.code ?? ''));

    const hub = zones.find((z) => HUB_PRIORITY.includes(z.spaceType)) ?? zones[0];
    const cols = 4, cw = 8, ch = 5, gx = 1, gy = 1;

    for (let i = 0; i < zones.length; i++) {
      const z = zones[i];
      const col = i % cols, row = Math.floor(i / cols);
      const x = col * (cw + gx), y = row * (ch + gy);
      const bounds = { x, y, w: cw, h: ch };
      const door = { x: x + cw / 2, y: y + ch / 2 };
      const existing = (z.metadata as Record<string, unknown>) ?? {};
      const sla = { targetWaitMinutes: WAIT[z.spaceType] ?? 15, targetThroughputPerHour: 40 };
      const connectedTo = z.id === hub.id
        ? zones.filter((o) => o.id !== hub.id).map((o) => o.code ?? o.id)
        : [hub.code ?? hub.id];

      await prisma.spaceNode.update({
        where: { id: z.id },
        // 🔴 geometrySource: 이 좌표는 격자 자동배치다(실도면 아님) — 뷰어·길안내가 확정 도면과 구분하게 표식을 남긴다
        // 🔴 walkTime 을 채우지 않는다 — 종전 `?? 3` 이 모든 구역에 걸음 3분을 지어내 토폴로지 거리로 쓰였다
        data: { metadata: { ...existing, bounds, door, sla, geometrySource: 'GRID_AUTO' }, connectedTo },
      });
      updatedZones++;
    }

    const rows = Math.ceil(zones.length / cols);
    const fe = (f.metadata as Record<string, unknown>) ?? {};
    await prisma.spaceNode.update({
      where: { id: f.id },
      data: { metadata: { ...fe, grid: { cols: cols * (cw + gx) + 2, rows: rows * (ch + gy) + 2 } } },
    });
    console.log(`  ${f.code}: ${zones.length} zones, hub=${hub.code}`);
  }

  console.log(`✅ floor metadata seeded: ${updatedZones} zones across ${floors.length} floors`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
