import { assertSeedAllowed, currentSeedMode } from './seed-mode-guard';
import { PrismaClient } from '@prisma/client';

/**
 * 데모·시드 데이터 **세어 보기 / 지우기** — 리허설 → 리얼 전환 전에 기관이 따르는 절차.
 *
 * 실행:
 *   cd apps/api && npx ts-node --transpile-only prisma/purge-demo-seed.ts             # 세기만(드라이런 · 기본)
 *   cd apps/api && npx ts-node --transpile-only prisma/purge-demo-seed.ts --apply --confirm=<DB이름>
 *
 * 🔴 왜 만들었나(2026-09-21 · 형제 프로젝트 인바운드 H3) — Go-Live 항목 `flag.demoSeedPurge` 는 `MANUAL`
 *    (사람이 체크박스를 누르는 자가신고)인데, **지울 명령도 절차도 저장소 어디에도 없었다.**
 *    체크박스는 검증이 아니다(CLAUDE.md §실서비스 전환 · `/admin/phase0-cutover` 는 대사 자동 검증 경로가 없다).
 *
 * 🔴 이 도구가 **말하지 않는 것**(먼저 읽을 것 — "0건 남음"을 전수 제거로 읽으면 안 된다):
 *    시드 표식은 **네 가지**이고(shared `isSeedUuid` 주석) 이 도구는 그중 **둘**만 본다.
 *      ① 결정적 시드 UUID 접두 `00000000-0000-4000-` — 본다(seed.ts `makeUuid` · seeds/ `CV_UUID_PREFIX`)
 *      ② 컬럼 표식(`source='seed'` 류) — **일부만** 본다(아래 `COLUMN_MARKERS` 에 적힌 것만)
 *      ③ 해시에서 만든 UUID — 못 본다
 *      ④ 시각 군집(같은 초에 몰려 만들어진 행) — 못 본다
 *    그래서 데모 시드 파일 중 `@default(uuid())` 로 행을 만드는 것들(대부분의 `seed-*-demo.ts`)은
 *    **여기서 한 건도 잡히지 않는다.** "배지가 없다"가 "실데이터다"라는 뜻은 아니다.
 *    → 전수 제거가 목표라면 **빈 DB 에 필수 마스터만 적재**하는 경로(`infra/install/install.sh`)가 정답이고,
 *      이 도구는 "데모 DB 를 실환자 DB 로 쓰려 할 때 얼마나 섞여 있는지"를 **재는** 것이 본업이다.
 *
 * 🔴 안전장치(셋 다 통과해야 지운다):
 *    ① **REAL 모드에서는 실행을 거부**한다(`assertSeedAllowed(..., 'DEMO')` — 시드와 같은 판정).
 *       모드 미설정도 REAL 로 접힌다. 실환자 DB 에 대량 삭제가 도는 경로를 없애는 것이 이 가드의 전부다.
 *    ② **기본은 드라이런**이다. `--apply` 없이는 한 행도 지우지 않는다.
 *    ③ `--apply` 는 `--confirm=<현재 접속한 DB 이름>` 을 요구한다. 지울 DB 이름을 직접 적게 한다.
 *
 * 🔴 지우지 못한 것은 **지운 척하지 않는다.** 실데이터가 참조하는 시드 행은 FK 때문에 남는다 —
 *    남은 표·건수·마지막 오류를 그대로 찍는다(그게 기관이 봐야 할 신호다).
 *
 * 🔴 실측(2026-09-22 · 빈 스크래치 DB 에 `seed.ts` 만 돌린 직후 `--apply`): 3,165행 중 **2,976행 삭제 · 185행 잔류**
 *    (users 88 · encounters 49 · patients 30 · checkup_programs 14 · surgeries 4). 실데이터가 하나도 없는 DB 에서도
 *    남는 이유는 시드 자신이 만든 **임의 UUID 자식 행**(prescriptions·checkup_visits·surgery_op_notes 등 `@default(uuid())`)이
 *    시드 UUID 부모를 FK 로 붙들기 때문이다 — 즉 이 도구는 **환자·진료 행을 못 지운다.** 자식을 따라가 지우는 방향은
 *    실데이터(예: 시드 관리자가 `created_by` 인 실환자)까지 끌려갈 수 있어 **일부러 넣지 않았다**(사람 판단 · 위 install.sh 경로).
 */

assertSeedAllowed(__filename, 'DEMO');

const prisma = new PrismaClient();

/** 결정적 시드 UUID — `00000000-0000-4000-a000-…`(seed.ts) · `…-b000-…`(seeds/clinical-volume) 둘 다 덮는다 */
const SEED_UUID_LIKE = '00000000-0000-4000-%';

/**
 * 🔴 지우면 안 되는 시드 UUID — 운영 코드가 이름으로 참조하는 행.
 *    `inventory.service.ts` `ERP_SYSTEM_USER` 가 이 접두 안의 값이다(접두 일괄 삭제의 함정).
 *    🔴 다만 `seed.ts` 는 이 행을 **만들지 않는다**(관리자는 `…-a000-000000a00001` · 스크래치 실측 0행) —
 *       보존은 "있으면 지우지 않는다"는 뜻이지 그 행이 존재한다는 뜻이 아니다. ERP 입고가 이 id 로 FK 를 만족하는지는
 *       재고 축의 별개 문제라 여기서 판정하지 않는다.
 */
const KEEP_IDS = new Set<string>(['00000000-0000-4000-a000-000000000001']);

/**
 * 컬럼 표식으로만 식별되는 데모 행 — **여기 적힌 것만** 센다(전부가 아니라는 사실을 위 머리말이 말한다).
 * 지우지는 않는다: 어느 것이 픽스처이고 어느 것이 사람이 만든 것인지 컬럼 하나로 가를 수 없다.
 */
const COLUMN_MARKERS: { table: string; where: string; note: string }[] = [
  { table: 'patients', where: `mrn LIKE 'TEST-MRG-%'`, note: 'LIS 종단검증 병합 픽스처' },
  { table: 'integration_gates', where: `evidence_ref = '개발 시드(DEV-SEED)'`, note: '개발 시드 결재(실결재 아님)' },
  { table: 'reference_ranges', where: `source IN ('seed', 'ped-ref')`, note: '시드 기준치' },
];

type TableCount = { table: string; rows: number };

/** 오류 한 줄 — 🔴 Prisma 오류는 첫 줄이 빈 줄·호출 서명이라 `split('\n')[0]` 로는 이유가 빈 문자열이 된다(로컬 실측). 원문 DB 메시지까지 한 줄로 접는다 */
const errLine = (e: unknown, max: number) =>
  String((e as Error)?.message ?? e).replace(/\s+/g, ' ').trim().replace(/^Invalid `[^`]*` invocation:\s*/, '').slice(0, max);

function parseArgs(argv: string[]) {
  const apply = argv.includes('--apply');
  const confirm = argv.find((a) => a.startsWith('--confirm='))?.slice('--confirm='.length) ?? null;
  return { apply, confirm };
}

/** public 스키마에서 **uuid 형 `id`** 를 가진 표 — 시드 UUID 판정이 가능한 표만 대상이다 */
async function seedMarkedTables(): Promise<string[]> {
  const rows = await prisma.$queryRaw<{ table_name: string }[]>`
    SELECT c.table_name
      FROM information_schema.columns c
      JOIN information_schema.tables t
        ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE'
     WHERE c.table_schema = 'public' AND c.column_name = 'id' AND c.data_type = 'uuid'
     ORDER BY c.table_name`;
  // 🔴 식별자를 문자열로 이어 붙이기 전에 형태를 확인한다(정규식 밖 이름은 아예 다루지 않는다)
  return rows.map((r) => r.table_name).filter((n) => /^[a-z_][a-z0-9_]*$/.test(n));
}

async function countSeedRows(tables: string[]): Promise<TableCount[]> {
  const out: TableCount[] = [];
  for (const t of tables) {
    try {
      const r = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
        `SELECT count(*)::bigint AS n FROM "${t}" WHERE id::text LIKE $1`,
        SEED_UUID_LIKE,
      );
      const n = Number(r[0]?.n ?? 0);
      if (n > 0) out.push({ table: t, rows: n });
    } catch (e) {
      // 🔴 세지 못한 표를 0 으로 적지 않는다 — 음수로 표시해 "판정 불가"임을 드러낸다
      console.warn(`  ⚠️ ${t}: 셀 수 없음 — ${(e as Error).message.slice(0, 120)}`);
      out.push({ table: t, rows: -1 });
    }
  }
  return out.sort((a, b) => b.rows - a.rows);
}

async function countColumnMarkers() {
  const out: { table: string; note: string; rows: number | null; why?: string }[] = [];
  for (const m of COLUMN_MARKERS) {
    try {
      const r = await prisma.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*)::bigint AS n FROM "${m.table}" WHERE ${m.where}`);
      out.push({ table: m.table, note: m.note, rows: Number(r[0]?.n ?? 0) });
    } catch (e) {
      // null = 판정 불가 — 🔴 이유를 삼키지 않는다(표·컬럼이 없는 것과 권한·연결 문제는 다른 사실이다 · 로컬 실측에서 이유 없는 "판정불가"가 나왔다)
      out.push({ table: m.table, note: m.note, rows: null, why: errLine(e, 140) });
    }
  }
  return out;
}

/**
 * 지우기 — FK 때문에 한 번에 다 지워지지 않는다. **진전이 있는 동안만** 반복한다.
 * 각 문장은 독립 실행이라(한 표의 실패가 다른 표를 막지 않는다) 전체가 원자적이지 않다 —
 * 그래서 시작 전에 백업을 요구하고, 끝에 남은 것을 그대로 보고한다.
 */
async function purge(tables: string[]) {
  // 🔴 보존 목록은 **형태를 확인한 뒤** 문장에 리터럴로 넣는다(드라이버마다 배열 파라미터 취급이 달라
  //    `= ANY($n::text[])` 가 조용히 안 걸리면 보존 대상이 지워진다 — 그 실패는 되돌릴 수 없다).
  const keep = [...KEEP_IDS].filter((id) => /^[0-9a-f-]{36}$/i.test(id));
  if (keep.length !== KEEP_IDS.size) throw new Error('보존 목록에 UUID 형태가 아닌 값이 있다 — 중단한다');
  const keepSql = keep.length ? ` AND id::text NOT IN (${keep.map((id) => `'${id}'`).join(', ')})` : '';
  let remaining = new Set(tables);
  let deletedTotal = 0;
  const lastError = new Map<string, string>();

  for (let pass = 1; pass <= 12 && remaining.size; pass++) {
    let progressed = 0;
    for (const t of [...remaining]) {
      try {
        const n = await prisma.$executeRawUnsafe(`DELETE FROM "${t}" WHERE id::text LIKE $1${keepSql}`, SEED_UUID_LIKE);
        deletedTotal += n;
        progressed += n;
        lastError.delete(t);
        const left = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
          `SELECT count(*)::bigint AS n FROM "${t}" WHERE id::text LIKE $1`,
          SEED_UUID_LIKE,
        );
        if (Number(left[0]?.n ?? 0) === 0) remaining.delete(t);
      } catch (e) {
        lastError.set(t, errLine(e, 160));
      }
    }
    console.log(`  · ${pass}차: ${progressed}행 삭제 · 남은 표 ${remaining.size}`);
    if (progressed === 0) break; // 더 진전이 없다 — 남은 것은 실데이터가 참조하는 행이다
  }
  return { deletedTotal, remaining: [...remaining], lastError };
}

async function main() {
  const { apply, confirm } = parseArgs(process.argv.slice(2));
  const { mode, source } = currentSeedMode();
  const dbName = (await prisma.$queryRaw<{ d: string }[]>`SELECT current_database() AS d`)[0]?.d ?? '(알 수 없음)';

  console.log('\n═══ 데모·시드 데이터 정리 ═══');
  console.log(`  모드: ${mode} (판정 출처: ${source})`);
  console.log(`  DB  : ${dbName}`);
  console.log(`  동작: ${apply ? '🔴 실제 삭제(--apply)' : '드라이런 — 세기만 한다(지우려면 --apply)'}\n`);

  const tables = await seedMarkedTables();
  console.log(`  uuid id 를 가진 표 ${tables.length}개를 본다.\n`);

  const counts = await countSeedRows(tables);
  const countable = counts.filter((c) => c.rows > 0);
  const unknown = counts.filter((c) => c.rows < 0);
  const total = countable.reduce((s, c) => s + c.rows, 0);

  console.log('── 결정적 시드 UUID 를 가진 행 ──');
  for (const c of countable) console.log(`  ${String(c.rows).padStart(7)}  ${c.table}`);
  if (!countable.length) console.log('  (없음)');
  if (unknown.length) console.log(`  🔴 판정 불가 ${unknown.length}개 표: ${unknown.map((u) => u.table).join(', ')}`);
  console.log(`  ── 합계 ${total}행 · 보존 대상 ${KEEP_IDS.size}건 제외\n`);

  console.log('── 컬럼 표식으로만 보이는 데모 행(참고 · 이 도구는 지우지 않는다) ──');
  for (const m of await countColumnMarkers()) {
    console.log(`  ${m.rows === null ? '   판정불가' : String(m.rows).padStart(7)}  ${m.table} — ${m.note}${m.why ? ` (이유: ${m.why})` : ''}`);
  }
  console.log('\n🔴 위 두 목록에 **안 잡히는 데모 행이 있다**(해시 UUID·시각 군집·임의 UUID 로 만든 데모 시드).');
  console.log('   이 수치는 "얼마나 섞여 있는가"의 하한이지 전량이 아니다.\n');

  if (!apply) {
    console.log('드라이런 — 한 행도 지우지 않았다.');
    console.log(`지우려면: npx ts-node --transpile-only prisma/purge-demo-seed.ts --apply --confirm=${dbName}`);
    console.log('🔴 그 전에 백업을 먼저 받는다(infra/scripts/backup.sh).');
    return;
  }

  if (confirm !== dbName) {
    console.error(`\n🔴 중단 — --confirm 이 접속한 DB 이름과 다르다(받은 값: ${confirm ?? '없음'} · 접속: ${dbName}).`);
    console.error('   지울 DB 이름을 직접 적어야 지운다.');
    process.exitCode = 2;
    return;
  }

  console.log('🔴 삭제를 시작한다 — 되돌리려면 백업이 필요하다.\n');
  const { deletedTotal, remaining, lastError } = await purge(countable.map((c) => c.table));
  console.log(`\n  삭제 ${deletedTotal}행.`);
  if (remaining.length) {
    console.log('\n🔴 남은 표 — **실데이터 또는 시드 자신의 임의 UUID 자식 행이 FK 로 참조하고 있다.** 지워진 척하지 않는다(머리말 실측: 새로 시드한 DB 에서도 5표 185행이 남는다):');
    for (const t of remaining) console.log(`  · ${t}${lastError.get(t) ? ` — ${lastError.get(t)}` : ''}`);
    process.exitCode = 1;
  } else {
    console.log('  결정적 시드 UUID 행은 남지 않았다 — 위 캐비아트(잡히지 않는 표식)는 그대로 유효하다.');
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
