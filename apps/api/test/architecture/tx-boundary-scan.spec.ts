import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

import { scanTxBoundaries, TX_WRAPPERS } from './tx-boundary-scan';

/**
 * 🔴 **스캐너 자신을 먼저 검사한다.** 이 저장소는 계측기가 틀려 결론이 통째로 거짓이 된 적이 세 번 있다:
 *  · D4 — 문자열 속 `(system/​*)` 를 주석 시작으로 읽고 9,057자를 지워 라우트 4개가 분모에서 증발
 *  · E4 — **자기 주석 속** `.catch(() => undefined)` 를 코드로 세어 "고친 파일이 여전히 삼킨다"고 판정
 *  · F3(이 축) — `$transaction(rows.map(…))` 배열형을 콜백형으로 읽어 **정상 코드 5자리**를
 *    "트랜잭션을 빠져나간다"고 셌다(첫 판 escape 8 → 실제 1).
 *
 * 그래서 픽스처로 못박는다 — 규칙을 넓히거나 좁힐 때 이 테스트가 먼저 말한다.
 */
function scanFixture(files: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), 'tx-scan-'));
  try {
    for (const [name, body] of Object.entries(files)) {
      const full = join(dir, name);
      mkdirSync(join(full, '..'), { recursive: true });
      writeFileSync(full, body);
    }
    return scanTxBoundaries(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('🔴 트랜잭션 경계 스캐너 자체 검사', () => {
  it('트랜잭션 밖 다중 쓰기를 잡는다(대조군 — 기본 동작)', () => {
    const { rows } = scanFixture({
      'a/a.service.ts': `
export class A {
  async half() {
    await this.prisma.order.update({ where: { id }, data: { status: 'IN_PROGRESS' } });
    await this.prisma.dispensing.create({ data: { orderId: id } });
  }
}`,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ method: 'half', writes: 2, models: ['order', 'dispensing'] });
  });

  it('콜백형 `$transaction(async (tx) => …)` 안의 `tx.` 쓰기는 세지 않는다', () => {
    const { rows } = scanFixture({
      'a/a.service.ts': `
export class A {
  async atomic() {
    return this.prisma.$transaction(async (tx) => {
      await tx.order.update({ where: { id }, data: { status: 'IN_PROGRESS' } });
      return tx.dispensing.create({ data: { orderId: id } });
    });
  }
}`,
    });
    expect(rows).toHaveLength(0);
  });

  it('🔴 배열형 — `.map()` 으로 만든 배열도 트랜잭션이다(첫 판이 여기서 틀렸다)', () => {
    const { rows, escapes } = scanFixture({
      'a/a.service.ts': `
export class A {
  async bulk() {
    await this.prisma.$transaction(
      affected.map((c) => this.prisma.chemoCycle.update({ where: { id: c.id }, data: { plannedDate: c.d } })),
    );
    await this.prisma.$transaction([
      this.prisma.a.update({ where: { id }, data: { x: 1 } }),
      this.prisma.b.update({ where: { id }, data: { y: 2 } }),
    ]);
  }
}`,
    });
    expect(rows).toHaveLength(0);
    expect(escapes).toHaveLength(0);
  });

  it('🔴 콜백 안에서 바깥 `prisma` 로 쓰면 그 쓰기만 빠져나간 것으로 센다', () => {
    const { escapes } = scanFixture({
      'a/a.service.ts': `
export class A {
  async leak() {
    return this.prisma.$transaction(async (tx) => {
      await tx.order.update({ where: { id }, data: { status: 'X' } });
      await this.prisma.gateViolationLog.create({ data: { gateKey: 'g' } });
      await tx.dispensing.create({ data: { orderId: id } });
    });
  }
}`,
    });
    expect(escapes).toHaveLength(1);
    expect(escapes[0].model).toBe('gateViolationLog');
  });

  it('🔴 주석·문자열 속 쓰기 호출은 코드가 아니다(E4·D4 가 여기서 틀렸다)', () => {
    const { rows } = scanFixture({
      'a/a.service.ts': `
export class A {
  /**
   * 종전: await this.prisma.order.update({ data: { status: 'X' } });
   *       await this.prisma.dispensing.create({ data: {} });
   * 경로 설명 (system/*) 안의 별표도 주석 시작이 아니다.
   */
  async documented() {
    const sql = "await this.prisma.a.update({}) await this.prisma.b.create({})";
    const t = \`await this.prisma.c.update({})\`;
    await this.prisma.order.update({ where: { id }, data: { status: 'DONE' } });
    return sql + t;
  }
}`,
    });
    // 실제 쓰기는 1회뿐 — 주석 2 + 문자열 3 을 셌다면 다중쓰기로 잡혔을 것이다
    expect(rows).toHaveLength(0);
  });

  it('🔴 `$transaction` 밖의 `tx.` 는 그 메서드가 tx 를 받을 때만 트랜잭션이다', () => {
    const { rows } = scanFixture({
      // 트랜잭션을 통째로 벗겼는데 파라미터 이름만 `tx` 인 경우 — 재주입이 여기서 가드를 뚫었다
      'a/a.service.ts': `
export class A {
  async stripped() {
    return (async (tx) => {
      await tx.order.update({ where: { id }, data: { status: 'X' } });
      return tx.dispensing.create({ data: { orderId: id } });
    })(this.prisma);
  }

  private async helper(tx: Prisma.TransactionClient, id: string) {
    await tx.order.update({ where: { id }, data: { status: 'X' } });
    return tx.dispensing.create({ data: { orderId: id } });
  }
}`,
    });
    // 벗긴 쪽만 잡히고, tx 를 받는 헬퍼는 정당
    expect(rows.map((r) => r.method)).toEqual(['stripped']);
  });

  it('🔴 트랜잭션 래퍼 면제는 근거가 있어야 한다(래퍼가 실제로 `$transaction` 을 감싼다)', () => {
    expect(TX_WRAPPERS.length).toBeGreaterThan(0);
    for (const w of TX_WRAPPERS) {
      const src = readFileSync(resolve(process.cwd(), w.source), 'utf8');
      // 호출부가 아니라 **정의**를 찾는다(첫 등장은 호출부일 수 있다 — 실제로 그래서 한 번 틀렸다)
      const def = new RegExp(String.raw`(?:export\s+function|export\s+async\s+function|private\s+async|private|async)\s+${w.fn}\s*[<(]`);
      const at = src.search(def);
      expect(at, `${w.fn} 정의를 ${w.source} 에서 찾지 못했다 — 죽은 면제`).toBeGreaterThan(-1);
      expect(src.slice(at, at + 600), `${w.fn} 이 더는 \$transaction 을 감싸지 않는다 — 면제가 구멍이 된다`)
        .toContain('$transaction(');
    }
  });

  it('메서드 경계를 넘어 합치지 않는다(다른 메서드의 쓰기는 다른 메서드다)', () => {
    const { rows } = scanFixture({
      'a/a.service.ts': `
export class A {
  async one() {
    await this.prisma.order.update({ where: { id }, data: { status: 'A' } });
  }

  async two() {
    await this.prisma.dispensing.create({ data: { orderId: id } });
  }
}`,
    });
    expect(rows).toHaveLength(0);
  });
});
