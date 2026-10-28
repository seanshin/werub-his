import { assertSeedAllowed } from './seed-mode-guard';
assertSeedAllowed(__filename, 'MASTER'); // 🔴 기관과 무관한 표준 템플릿 — REAL 에서도 허용
/**
 * 전문과 표준 차트 템플릿 시드 (Track 1) — 추가·멱등(비파괴)
 * specialty-presets.ts(순수 데이터)를 그대로 공용 템플릿으로 생성 — 정의 중복 없음.
 * 실행: 서버에서  npx ts-node --transpile-only prisma/seed-specialty-templates.ts
 */
import { PrismaClient } from '@prisma/client';
import { SPECIALTY_PRESETS } from '../src/modules/chart-template/specialty-presets';

const prisma = new PrismaClient();

async function main() {
  const admin = await prisma.user.findFirst({ where: { role: 'ADMIN' } })
    ?? await prisma.user.findFirst();
  if (!admin) throw new Error('createdBy 로 쓸 사용자가 없습니다');

  let created = 0, updated = 0;
  for (const preset of Object.values(SPECIALTY_PRESETS)) {
    const existing = await prisma.chartTemplate.findFirst({
      where: { department: preset.department, name: preset.name, ownerId: null },
    });
    const sections = preset.sections as unknown as object;
    if (existing) {
      await prisma.chartTemplate.update({ where: { id: existing.id }, data: { sections, layout: preset.layout } });
      updated++;
    } else {
      await prisma.chartTemplate.create({
        data: {
          name: preset.name, department: preset.department, role: preset.role,
          category: preset.category, layout: preset.layout, sections,
          description: `${preset.department} 표준 외래 템플릿 (프리셋 시드)`,
          isDefault: false, isActive: true, ownerId: null, createdBy: admin.id,
        },
      });
      created++;
    }
  }
  console.log(`전문과 템플릿 시드 완료 — 생성 ${created} / 갱신 ${updated} (총 ${Object.keys(SPECIALTY_PRESETS).length})`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
