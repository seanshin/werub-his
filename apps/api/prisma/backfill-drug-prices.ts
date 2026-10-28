/**
 * 약가(급여상한금액) 백필 — WeRU.B AI 서버 drug-substitution EP에서 품목별 price 조회.
 * 원천: AI 서버가 약제급여목록·약가마스터를 자체 동기화(price·suspended·ingredient 보유).
 * 인증: system_configs의 ai.server.url + ai.server.gpuKey(Bearer) — 하드코딩 없음.
 * 갱신: unitPrice(+비어 있으면 ingredient 성분 영문). 멱등 — 재실행 시 최신가로 갱신.
 * 실행(서버): npx ts-node --transpile-only prisma/backfill-drug-prices.ts
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const CONCURRENCY = Number(process.env.CONCURRENCY || 3); // AI 서버 레이트리밋 회피(1차 10동시 → 오류 다수)
const DELAY_MS = Number(process.env.DELAY_MS || 50);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const cfgs = await prisma.systemConfig.findMany({ where: { key: { in: ['ai.server.url', 'ai.server.gpuKey'] } } });
  const cfg = new Map(cfgs.map((c) => [c.key, c.value as string]));
  const baseUrl = cfg.get('ai.server.url');
  const gpuKey = cfg.get('ai.server.gpuKey');
  if (!baseUrl || !gpuKey) {
    console.error('system_configs에 ai.server.url / ai.server.gpuKey 필요');
    process.exit(1);
  }

  // ONLY_MISSING=1 → unitPrice 미보유만(재실행·레이트리밋 재시도용)
  const onlyMissing = process.env.ONLY_MISSING === '1';
  const meds = await prisma.medicationCode.findMany({
    where: onlyMissing ? { OR: [{ unitPrice: null }, { unitPrice: 0 }] } : undefined,
    select: { id: true, code: true, ingredient: true },
  });
  console.log('대상 품목:', meds.length, onlyMissing ? '(미보유만)' : '(전체)');

  let updated = 0, notFound = 0, noPrice = 0, errors = 0, done = 0;

  async function worker(items: typeof meds) {
    for (const m of items) {
      try {
        const res = await fetch(`${baseUrl}/api/notice/drug-substitution/${encodeURIComponent(m.code)}`, {
          headers: { Authorization: `Bearer ${gpuKey}` },
        });
        if (!res.ok) { errors++; continue; }
        const d = (await res.json()) as { found?: boolean; price?: number; ingredient?: string };
        if (!d.found) { notFound++; continue; }
        const price = typeof d.price === 'number' && d.price > 0 ? Math.round(d.price) : null;
        if (price === null && !d.ingredient) { noPrice++; continue; }
        await prisma.medicationCode.update({
          where: { id: m.id },
          data: {
            ...(price !== null ? { unitPrice: price } : {}),
            ...(!m.ingredient && d.ingredient ? { ingredient: String(d.ingredient).slice(0, 500) } : {}),
          },
        });
        if (price !== null) updated++; else noPrice++;
      } catch { errors++; }
      finally {
        done++;
        if (done % 2000 === 0) console.log(`  ${done}/${meds.length} (가격 ${updated})`);
        if (DELAY_MS) await sleep(DELAY_MS);
      }
    }
  }

  const chunks: (typeof meds)[] = Array.from({ length: CONCURRENCY }, () => []);
  meds.forEach((m, i) => chunks[i % CONCURRENCY].push(m));
  await Promise.all(chunks.map(worker));

  console.log(`완료 — 가격갱신 ${updated} / 미발견 ${notFound} / 가격없음 ${noPrice} / 오류 ${errors}`);
  const withPrice = await prisma.medicationCode.count({ where: { unitPrice: { gt: 0 } } });
  console.log('unitPrice 보유 품목:', withPrice);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
