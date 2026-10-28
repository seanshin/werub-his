import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 🔴 **거짓 경보는 진짜 경보를 죽인다** (2026-08-30 · 발굴 29회차 운영 실측).
 *
 * 운영 에러 로그를 종류별로 세다가 `🔴 체인 변조 의심` 이 **70회**(검진권 10장 × 매일 06:00)
 * 반복되고 있는 것을 봤다. 조사 결과:
 *   · `prevHash` **연결은 전건 완벽**했다(ISSUE→ALLOCATE)
 *   · `checkup_vouchers.genesis_hash` 와 ISSUE 이벤트 `hash` 도 **전건 일치**
 *   · 즉 저장은 일관되고 **재계산만 어긋난다** — 데이터를 지운 흔적이 아니다
 * 🔴 **원인은 특정하지 못했다.** payload·ts(±2초)·actorId·programId 후보를 모두 대입해
 *    재현에 실패했다. 그래서 **"변조"라고 단정하지 않고** 불일치 **종류만** 사실대로 말한다.
 *
 * 두 가지를 고쳤다:
 *   ① `LINK_BROKEN`(연결 끊김) / `HASH_MISMATCH`(재계산 불일치) 를 구분해서 말한다
 *   ② 이미 표시된 건은 **매일 다시 외치지 않는다** — 새로 깨진 것만 알린다
 */
const src = (p: string) => readFileSync(join(process.cwd(), 'src/modules/voucher', p), 'utf8');

describe('🔴 체인 검증이 원인을 단정하지 않는다', () => {
  const ledger = src('voucher-ledger.service.ts');

  it('세 종류를 구분해 돌려준다 — 형식 아님 / 연결 끊김 / 재계산 불일치', () => {
    expect(ledger).toMatch(/reason\?: 'NOT_A_HASH' \| 'LINK_BROKEN' \| 'HASH_MISMATCH'/);
    expect(ledger).toMatch(/reason: 'NOT_A_HASH'/);
    expect(ledger).toMatch(/reason: 'LINK_BROKEN'/);
    expect(ledger).toMatch(/reason: 'HASH_MISMATCH'/);
  });

  it('🔴 형식 검사 → 연결 → 재계산 순서다 — 뒤바뀌면 원인이 뒤바뀐다', () => {
    const f = ledger.indexOf("reason: 'NOT_A_HASH'");
    const l = ledger.indexOf("reason: 'LINK_BROKEN'");
    expect(f, 'NOT_A_HASH 판정이 없다').toBeGreaterThan(-1);
    expect(f, '형식 검사가 연결 검사보다 뒤다').toBeLessThan(l);
  });

  it('🔴 해시 형식 상수가 실제 해시만 통과시킨다', () => {
    const m = ledger.match(/const HEX64 = (\/[^\n]+\/);/);
    expect(m, 'HEX64 상수가 없다').toBeTruthy();
    const re = new RegExp(m![1].slice(1, -1));
    expect(re.test('a'.repeat(64))).toBe(true);
    expect(re.test('g'.repeat(64)), '운영에 실재한 g×64 를 통과시킨다').toBe(false);
    expect(re.test('A'.repeat(64)), '대문자를 통과시킨다(해시는 소문자 hex)').toBe(false);
  });

  it('🔴 연결 검사를 재계산보다 먼저 한다 — 순서가 바뀌면 원인이 뒤바뀐다', () => {
    const i = ledger.indexOf("reason: 'LINK_BROKEN'");
    const j = ledger.indexOf('const recomputed = eventHash');
    expect(i, 'LINK_BROKEN 판정이 없다').toBeGreaterThan(-1);
    expect(i, '재계산이 연결 검사보다 먼저다').toBeLessThan(j);
  });

  it('정상 체인은 그대로 valid 다(대조군)', () => {
    expect(ledger).toMatch(/return \{ valid: true, events: events\.length \};/);
  });

  /**
   * 🔴 **소스 문자열만 보는 가드는 `if (false)` 를 못 잡는다** — 재주입이 그것을 드러냈다.
   *    실제 서비스를 돌려 **행동으로** 확인한다(운영에 실재한 `g`×64 를 그대로 쓴다).
   */
  it('🔴 행동 검증 — 운영에 실재한 g×64 를 NOT_A_HASH 로 판정한다', async () => {
    const { VoucherLedgerService } = await import('../../src/modules/voucher/voucher-ledger.service');
    const ev = (over: Record<string, unknown>) => ({
      id: 'e1', serial: 'S', type: 'REDEEM', payload: {}, actorId: null,
      createdAt: new Date('2026-06-18T02:10:52.263Z'), prevHash: 'g'.repeat(64), hash: 'f'.repeat(64), ...over,
    });
    const svc = new VoucherLedgerService({
      voucherEvent: { findMany: async () => [ev({})] },
    } as never);
    const r = await svc.verifyChain('S');
    expect(r.valid).toBe(false);
    expect(r.reason, '해시 형식이 아닌 값을 연결 문제로 뭉갠다').toBe('NOT_A_HASH');
  });

  it('🔴 행동 검증 — 형식은 맞고 연결만 어긋나면 LINK_BROKEN 이다(대조군)', async () => {
    const { VoucherLedgerService } = await import('../../src/modules/voucher/voucher-ledger.service');
    const svc = new VoucherLedgerService({
      voucherEvent: { findMany: async () => [{
        id: 'e1', serial: 'S', type: 'REDEEM', payload: {}, actorId: null,
        createdAt: new Date('2026-06-18T02:10:52.263Z'),
        prevHash: 'a'.repeat(64), hash: 'b'.repeat(64),
      }] },
    } as never);
    const r = await svc.verifyChain('S');
    expect(r.reason).toBe('LINK_BROKEN');
  });
});

describe('🔴 같은 위반을 매일 다시 외치지 않는다', () => {
  const cron = src('voucher-cron.service.ts');

  it('이미 표시된 건은 조용히 세고, 새로 깨진 것만 로그로 외친다', () => {
    expect(cron).toMatch(/const alreadyFlagged = new Set\(/);
    expect(cron).toMatch(/if \(!alreadyFlagged\.has\(v\.id\)\)/);
  });

  it('새 위반이 없으면 CRITICAL 상신을 보내지 않는다', () => {
    expect(cron).toMatch(/const fresh = broken\.filter\(\(b\) => !alreadyFlagged\.has\(b\.id\)\)/);
    expect(cron).toMatch(/if \(fresh\.length === 0\)/);
  });

  it('🔴 조용해지되 숨기지 않는다 — 누적 건수와 조사 대기 사실을 남긴다', () => {
    expect(cron).toContain('전부 기존 상신분');
    expect(cron).toContain('누적 ${broken.length}건');
  });

  it('🔴 "변조"라고 단정하지 않는다 — 종류를 적고 판단은 사람이 한다', () => {
    expect(cron, '원인을 단정하는 문구가 남아 있다').not.toContain('체인 변조 의심');
    expect(cron).toContain('체인 불일치');
    expect(cron).toContain('LINK_BROKEN=연결 끊김');
  });

  it('🔴 자동 복구하지 않는다(대조군 — 재해시는 증거 인멸)', () => {
    expect(cron).toContain('자동 복구');
    expect(cron, '체인을 다시 써서 덮는다').not.toMatch(/eventHash\(|headHash:\s*recomputed/);
  });

  it('🔴 상신 실패를 조용히 넘기지 않는다(대조군 — 탐지와 상신은 분리 불가)', () => {
    expect(cron).toMatch(/if \(sent === 0\)/);
  });
});
