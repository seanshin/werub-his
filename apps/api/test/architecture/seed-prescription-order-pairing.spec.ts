import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { scanSeedPrescriptions, unpairedByFile, stripComments, stripSqlComments } from './seed-prescription-order-scan';

/**
 * 🔴 시드가 만든 처방에는 오더가 딸려야 한다 (2026-09-16 G1).
 *
 * **실측**: 운영 `prescriptions` 1,772 중 오더 없는 것 250. 부모 세션은 이를 "전부 비시드"로 읽었으나,
 * 그 판정은 `id LIKE '00000000-%'` 휴리스틱이었다 — **결정적 시드 UUID 만** 잡는다. 실제로는 네 시드가
 * SHA-256 파생 id(`makeId`)를 쓰고 있어 비시드처럼 보였을 뿐, 250 전건이 시드 산출물이다:
 *   · `seed-chart-richness.ts`      182 (cr-rx 170 · cr-imrx 12) — id 계산해 전건 대조
 *   · `seed-chronic-followup.ts`     60 (instructions '만성질환 추적 처방')
 *   · `seeds/inpatient-e2e-test.seed.sql` 5 (id 'e2e10000…')
 *   · `seed-timeline-history.ts`      3 (dosage/frequency/duration 조합 일치)
 * 런타임 발행 경로 8곳(prescription.service ×4 · workstation ×2 · pre-order · remote-consultation,
 * pre-auth 는 서비스 위임)은 **모두 같은 트랜잭션에서 오더를 만든다** — 런타임 결함이 아니다.
 *
 * **왜 중요한가**: 조제 큐·불출(`dispensings.order_id`)·오더 서명 원장·완료 경로가 전부 `orders` 기준이라,
 * 오더 없는 처방은 그 어디에도 뜨지 않는다. 운영에서 244건이 ACTIVE MEDICATION 으로 떠 있고 그중 81건은
 * 투약기록(MAR)까지 있는데 조제는 구조적으로 불가능하다. 정합성 스캔 07(⚪)이 244 로 보고하고 있었으나
 * 원인이 특정되지 않아 방치됐다.
 *
 * **소급하지 않는다** — 과거 250건에 오더를 만들어 넣지 않는다(일어난 사실은 소급하지 않는다 · 원무·약제 판단).
 * 고치는 것은 **생성기**다(CLAUDE.md: 데이터를 코드로 교정하지 않는다).
 */
const PRISMA = path.resolve(process.cwd(), 'prisma');

/**
 * 헬퍼 간접 호출이라 스캐너가 토큰을 못 잇는 자리 — **이름만 두지 않는다**.
 * E2 의 교훈: 면제를 이름으로만 두면 그 자리의 실제 페어링을 지워도 가드가 통과한다.
 * 그래서 면제마다 `evidence`(오더를 실제로 만드는 코드)를 달고, 그 표식이 사라지면 실패한다.
 */
const HELPER_PAIRED: { file: string; count: number; evidence: RegExp; why: string }[] = [
  {
    file: 'seeds/clinical-volume-imaging.ts',
    count: 1,
    evidence: /for \(const x of rows\) await prisma\.order\.upsert\(upsertArgs\(x\.order\)\);/,
    why: 'rows 가 처방·오더를 한 벌로 들고 upsertArgs 로 함께 넣는다(운영 대조: 이 시드에서 나온 결손 0)',
  },
  {
    file: 'seeds/clinical-volume-inpatient.ts',
    count: 1,
    evidence: /await prisma\.order\.upsert\(upsertArgs\(m\.order\)\);/,
    why: '같은 모양 — 행 묶음(m)에 order 가 함께 담긴다(운영 대조: 결손 0)',
  },
];

describe('🔴 시드 처방에는 오더가 딸린다 — 오더 없는 처방은 조제 큐에 영영 안 뜬다', () => {
  const rows = scanSeedPrescriptions(PRISMA);

  it('대조군 — 스캐너가 실제로 시드 처방 생성 자리를 찾았다(0건이면 아래 단언은 증거가 아니다)', () => {
    expect(rows.length, '처방 생성 자리를 하나도 못 찾았다 — 스캐너가 죽었다').toBeGreaterThanOrEqual(15);
    expect(new Set(rows.map((r) => r.file)).size, '한 파일만 훑었다').toBeGreaterThanOrEqual(5);
    // SQL 경로도 살아 있는지(정규식이 .sql 을 놓치면 e2e 시드가 통째로 빠진다)
    expect(rows.some((r) => r.file.endsWith('.sql')), 'SQL 시드를 하나도 못 읽었다').toBe(true);
  });

  it('오더 없이 처방만 만드는 시드가 없다 (헬퍼 간접 호출만 면제 · 면제는 근거로 잠근다)', () => {
    const unpaired = unpairedByFile(rows);
    const exempt = Object.fromEntries(HELPER_PAIRED.map((e) => [e.file, e.count]));
    expect(unpaired, '시드가 오더 없는 처방을 만든다 — 그 처방은 조제 큐·서명 원장에 안 뜬다').toEqual(exempt);
  });

  it('🔴 면제는 근거가 코드에 실재할 때만 유효하다 (오더 생성을 지우면 면제가 깨진다)', () => {
    for (const e of HELPER_PAIRED) {
      const src = readFileSync(path.join(PRISMA, e.file), 'utf-8');
      expect(stripComments(src), `${e.file}: 면제 근거(${e.why})가 코드에 없다`).toMatch(e.evidence);
    }
  });

  it('G1 이 고친 네 시드는 처방마다 오더를 만든다 (되돌리면 위 기준선이 깨진다)', () => {
    const fixed = ['seed-chart-richness.ts', 'seed-chronic-followup.ts', 'seed-timeline-history.ts'];
    for (const f of fixed) {
      expect(unpairedByFile(rows)[f], `${f}: 오더 없는 처방 생성이 되살아났다`).toBeUndefined();
    }
    const sql = stripSqlComments(readFileSync(path.join(PRISMA, 'seeds/inpatient-e2e-test.seed.sql'), 'utf-8'));
    expect(sql, 'e2e SQL 이 오더를 넣지 않는다').toMatch(/INSERT\s+INTO\s+orders/i);
    // FK 순서 — 오더가 처방을 물므로 정리는 오더부터
    expect(sql.indexOf('DELETE FROM orders'), '멱등 정리에서 오더를 처방보다 먼저 지우지 않는다')
      .toBeLessThan(sql.indexOf('DELETE FROM prescriptions'));
  });

  it('정합성 스캔이 이 결손을 계속 관측한다 (07번 불변식이 사라지지 않았다)', () => {
    const scan = readFileSync(path.resolve(process.cwd(), '../../infra/scripts/data-integrity-scan.sql'), 'utf-8');
    expect(scan, "'ACTIVE 처방인데 오더 없음' 불변식이 스캔에서 사라졌다").toMatch(/ACTIVE 처방인데 오더 없음/);
  });
});
