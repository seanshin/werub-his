import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * 🔴 **시드 구성과 실제 임명은 다른 사실이다** (2026-08-28).
 *
 *    리허설을 돌리려면 위원 명부가 있어야 한다. 그런데 시드로 채운 명부를
 *    "임명 완료"로 세면 개원 화면이 **거짓 안심**을 준다 — 이 저장소에는 전례가 있다:
 *    Go-Live 준비율이 시드 결재 3건을 실결재로 세어 65%(실제 45%)를 표시했다.
 */
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const SVC = strip(readFileSync(join(process.cwd(), 'src/modules/opening/opening.service.ts'), 'utf-8'));
const SEED = strip(readFileSync(join(process.cwd(), 'prisma/seed-committee-members.ts'), 'utf-8'));
const GLD = strip(readFileSync(join(process.cwd(), 'src/modules/gld/gld.service.ts'), 'utf-8'));

describe('개원 화면이 시드를 임명으로 세지 않는다', () => {
  it('🔴 전원 시드면 완료로 읽지 않는다', () => {
    expect(SVC).toMatch(/appointed = c\.members\.filter\(\(m\) => m\.source !== 'SEED'\)\.length/);
    expect(SVC, '명부가 차도 실제 임명이 0이면 READY 가 아니다').toMatch(/status: filled && appointed > 0 \? 'READY'/);
  });

  it('🔴 그 사실을 화면 문구로 말한다 — 조용하면 "위원 5명"만 보인다', () => {
    expect(SVC).toContain('전원 시드 구성(실제 임명 기록 없음)');
  });

  it('일부만 임명됐으면 몇 명인지 말한다', () => {
    // 문장은 `serverMsg` 키 + 값(2026-09-15 I2 — 화면이 조립)
    expect(SVC).toMatch(/serverMsg\('실제 임명 \{임명\}명', \{ 임명: appointed \}\)/);
  });
});

describe('시드 스크립트가 지켜야 하는 것', () => {
  it('🔴 시드는 source=SEED · appointedBy=null 로 넣는다 — 쓰기 두 경로 모두', () => {
    // 🔴 `update`/`create` 중 하나만 봐도 통과해선 안 된다(create 가 대신 통과시켰다).
    const writes = SEED.match(/source: 'SEED', appointedBy: null/g) ?? [];
    expect(writes.length, 'upsert 의 update·create 양쪽').toBe(2);
    // 시드가 MANUAL 로 쓰면 시드와 임명이 구분되지 않는다
    expect(SEED, '시드는 MANUAL 로 쓰지 않는다').not.toMatch(/source: 'MANUAL',\s*appointedBy/);
    // 임명자를 지어내면 "누가 임명했는가"가 거짓이 된다
    expect(SEED).not.toMatch(/appointedBy: '[0-9a-f-]{36}'/);
  });

  it('🔴 사람이 손댄 위원회를 덮지 않는다', () => {
    expect(SEED).toMatch(/manual = c\.members\.filter\(\(m\) => m\.source === 'MANUAL'\)/);
    expect(SEED).toMatch(/if \(manual\.length > 0\)/);
  });

  it('🔴 난수를 쓰지 않는다 — 실행마다 위원이 바뀌면 명부가 아니다', () => {
    expect(SEED).not.toContain('Math.random');
    expect(SEED).toMatch(/localeCompare/);
  });

  it('🔴 정족수를 못 채우면 채운 척하지 않는다', () => {
    expect(SEED).toMatch(/정족수 \$\{c\.quorum\} 미달/);
    expect(SEED).toContain('채우지 못한 자리');
  });

  it('🔴 위원장을 분산한다 — 한 사람이 전 위원회 위원장이 되면 아무도 안 믿는다', () => {
    // 첫 실행에서 한 사람이 7개 위원회 위원장이 됐다(결정적 선택의 부작용)
    expect(SEED).toMatch(/const chairing = new Set<string>\(\);/);
    expect(SEED).toMatch(/slot\.as === 'CHAIR'/);
    expect(SEED).toMatch(/\.\.\.chairing/);
  });

  it('🔴 옛 시드 배정을 지운다 — 그것도 SEED 행만', () => {
    expect(SEED).toMatch(/m\.source === 'SEED' && !keep\.has\(m\.userId\)/);
    // 사람이 임명한 행을 지우면 임명 기록이 사라진다
    expect(SEED, '삭제 대상은 SEED 로 한정한다').not.toMatch(/deleteMany\(\{ where: \{ committeeId/);
  });

  it('🔴 정족수를 시드가 다시 정의하지 않는다 — 정본은 위원회다', () => {
    // COMPOSITION 안에 quorum 을 적으면 정본이 둘이 된다
    expect(SEED).not.toMatch(/quorum:\s*\d/);
  });
});

describe('화면에서 임명하면 시드가 아니게 된다', () => {
  it('🔴 addMember 는 MANUAL 로 쓰고 임명자를 남긴다', () => {
    // 🔴 갱신·신규 **두 경로 모두** — 하나만 보면 다른 쪽이 조용히 비어도 통과한다
    const writes = GLD.match(/source: 'MANUAL', appointedBy: actorId \?\? null/g) ?? [];
    expect(writes.length, '기존 위원 갱신과 신규 임명 양쪽').toBe(2);
  });
});
