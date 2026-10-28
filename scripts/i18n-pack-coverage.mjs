#!/usr/bin/env node
/**
 * 언어 팩 커버리지 계측 — **UI 크롬 언어 커버리지 수치의 재현 정본**.
 *
 * 사용: node scripts/i18n-pack-coverage.mjs [--json] [--area <code>]
 *
 * 🔴 **src 를 읽는다(dist 가 아니라).** `packages/shared/dist` 는 빌드 시점 스냅샷이라
 *    팩을 고친 직후에는 낡은 수치를 낸다 — 이 저장소에서 "소스가 같은 것 ≠ 배포된 것이
 *    같은 것"으로 한 번 크게 속은 축이다. 그래서 여기서는 esbuild 로 src 를 그 자리에서
 *    번들해 메모리에서만 집계한다(빌드 산출물을 남기지 않는다 — 형제 프로세스와 레이스 없음).
 *
 * 🔴 **분모를 병기한다.** 비율만 찍지 않는다. 분모는 코어 팩(en) 키 전집이며,
 *    코어가 비어 있으면 비율을 만들지 않고 '산출 불가'라고 말한다(0% 도 100% 도 아니다).
 *
 * 🔴 이 수치는 "화면이 몇 %나 그 언어로 보이는가"가 **아니다**. 카탈로그에 등재된 키
 *    기준이며, 아직 어느 카탈로그에도 안 들어간 화면 문구는 분모에도 없다.
 *    (분모가 스스로 밝히는 범위를 넘어서 말하지 않는다.)
 */
import { build } from 'esbuild';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SHARED = join(ROOT, 'packages/shared/src/i18n');
const args = process.argv.slice(2);
const asJson = args.includes('--json');

const tmp = mkdtempSync(join(tmpdir(), 'i18n-cov-'));
try {
  const entry = join(tmp, 'entry.ts');
  writeFileSync(
    entry,
    [
      `export { AREA_CATALOGS } from ${JSON.stringify(join(SHARED, 'messages/registry'))};`,
      `export * from ${JSON.stringify(join(SHARED, 'pack'))};`,
      `import ${JSON.stringify(join(SHARED, 'packs/index'))};`,
    ].join('\n'),
  );
  const out = join(tmp, 'bundle.mjs');
  await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'warning' });
  const m = await import(pathToFileURL(out).href);

  const core = m.getLocalePack(m.COVERAGE_CORE_LOCALE);
  if (!core) {
    console.error(`🔴 코어 팩(${m.COVERAGE_CORE_LOCALE})이 없다 — 분모가 없으므로 커버리지는 산출 불가.`);
    process.exit(1);
  }
  const coreKeys = Object.keys(core.messages).filter((k) => core.messages[k]);
  const coreTotal = coreKeys.length;
  const ctxKeys = coreKeys.filter((k) => k.lastIndexOf('@') > 0);

  // 영역별 — "9%" 라는 한 숫자가 가리는 것을 드러낸다(공통은 완주인데 도메인은 0일 수 있다)
  const areaOf = new Map();
  const seen = new Set();
  for (const { area, c } of m.AREA_CATALOGS) {
    for (const k of Object.keys(c.en ?? {})) {
      if (!c.en[k] || seen.has(k)) continue;
      seen.add(k);
      areaOf.set(k, area);
    }
  }

  const rows = m.allLocalePacks()
    .map((p) => {
      const cov = m.localeCoverage(p.code);
      const areas = {};
      for (const k of coreKeys) {
        const a = areaOf.get(k) ?? '(미분류)';
        areas[a] ??= { have: 0, total: 0 };
        areas[a].total++;
        if (p.messages[k]) areas[a].have++;
      }
      return {
        code: p.code,
        label: p.label,
        status: p.status,
        translated: cov.translated,
        coreTotal,
        verified: cov.verified,
        complete: cov.complete,
        contextKeys: { have: ctxKeys.filter((k) => p.messages[k]).length, total: ctxKeys.length },
        areas,
      };
    })
    .sort((a, b) => b.translated - a.translated);

  if (asJson) {
    console.log(JSON.stringify({ coreLocale: m.COVERAGE_CORE_LOCALE, coreTotal, contextKeyTotal: ctxKeys.length, packs: rows }, null, 2));
  } else {
    console.log(`코어 팩 ${m.COVERAGE_CORE_LOCALE} — 키 전집 ${coreTotal} (문맥 키 \`원문@문맥\` ${ctxKeys.length})`);
    console.log('─'.repeat(78));
    console.log('코드      상태       번역/전집            검수  문맥키   비고');
    for (const r of rows) {
      const ratio = `${r.translated} / ${r.coreTotal}`;
      const pct = coreTotal === 0 ? '산출 불가' : `${((r.translated / coreTotal) * 100).toFixed(1)}%`;
      const zero = Object.entries(r.areas).filter(([, v]) => v.have === 0).map(([a]) => a);
      const note = r.complete ? '완역' : `미착수 영역 ${zero.length}${zero.length ? ` (${zero.slice(0, 4).join('·')}${zero.length > 4 ? '…' : ''})` : ''}`;
      console.log(
        `${r.code.padEnd(9)} ${r.status.padEnd(9)} ${ratio.padEnd(15)} ${pct.padStart(6)}  ${String(r.verified).padStart(4)}  ${`${r.contextKeys.have}/${r.contextKeys.total}`.padStart(7)}  ${note}`,
      );
    }
    console.log('─'.repeat(78));
    console.log('🔴 "검수" 0 = 사람 검수를 거친 키가 없다(전량 AI 초안). 등재 수와 다른 지표다.');
    console.log('🔴 분모는 카탈로그에 등재된 키의 전집이다 — 아직 어느 카탈로그에도 없는 화면 문구는');
    console.log('   분모에도 없다. "화면의 몇 %가 그 언어로 보이는가"의 상한이지 그 값 자체가 아니다.');
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
