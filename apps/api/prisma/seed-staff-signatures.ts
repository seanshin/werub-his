import { assertSeedAllowed } from './seed-mode-guard';
assertSeedAllowed(__filename, 'DEMO'); // 🔴 가상 병원 데모·기관 특정 데이터 — REAL 에서 중단(상용 릴리즈 T2-3)
/**
 * 전 직원 샘플 서명 이미지 생성 (일회성)
 * 실행: npx ts-node prisma/seed-staff-signatures.ts
 * - 서명 미등록 직원에게 이름 기반 SVG 서명(data URL) 부여. 이미 등록된 직원은 유지.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function sigSvg(name: string): string {
  const w = 240, h = 90;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
    `<text x="22" y="54" font-family="'Brush Script MT','Apple Chancery','Noto Serif KR',cursive,serif" font-size="40" font-style="italic" fill="#1e293b" transform="rotate(-4 22 54)">${esc(name)}</text>` +
    `<path d="M16 68 C 60 60, 120 76, 224 62" stroke="#334155" stroke-width="2" fill="none" stroke-linecap="round"/>` +
    `</svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg, 'utf-8').toString('base64')}`;
}

async function main() {
  const staff = await prisma.user.findMany({
    where: { isActive: true },
    select: { id: true, familyName: true, givenName: true, signatureImage: true },
  });
  let created = 0, kept = 0;
  for (const s of staff) {
    if (s.signatureImage) { kept++; continue; }
    const name = `${s.familyName ?? ''}${s.givenName ?? ''}`.trim() || '서명';
    await prisma.user.update({ where: { id: s.id }, data: { signatureImage: sigSvg(name) } });
    created++;
  }
  console.log(`샘플 서명 생성: ${created}명 / 기존 등록 유지: ${kept}명 / 전체 ${staff.length}명`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
