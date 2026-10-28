import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * 대기열 상태 버킷 커버리지 — 2026-08-12 (화면 점검 W1 · 패턴 P3).
 *
 * 🔴 상태를 if/else 체인으로 **버킷에 누적**할 때 한 값을 빠뜨리면 그 환자는 어느 칸에도 안 잡힌다.
 *    병상 보드가 그랬고(`CLEANING`·`ISOLATION` 이 총계에서 사라짐), 대기열 표시도 같은 형태였다
 *    (`CASHIER_WAITING` — 진료를 마쳤는데 '오늘 완료'에도 '대기'에도 안 들어갔다).
 *
 * `waiting_queue.status` 는 Prisma enum 이 아니라 VarChar 라 타입 검사가 막아주지 못한다
 * → 이 테스트가 대신 막는다. **상태를 추가하면 여기서 실패한다.**
 */

/**
 * 🔴 **손으로 베낀 목록은 침묵하는 가드가 된다**(2026-09-02).
 *    이 목록이 2026-08-12 수기 스냅샷이라 그 뒤 쓰이는 `PHARMACY_WAITING`·`VISIT_COMPLETED`·`NO_SHOW`
 *    셋을 몰랐고, 그래서 **집계가 그 둘을 어느 칸에도 안 넣는데도 초록이었다.**
 *    `billing.service.ts` 는 수납(PAID) 시 CASHIER_WAITING 을 처방 유무에 따라 그 둘로 바꾼다 —
 *    즉 **수납한 환자는 전부** 이 상태가 되고, 전광판 '오늘 완료'는 수납 순간 오히려 줄어들었다.
 *    (운영 DB 에 아직 0행인 것은 시드가 그 전이를 태우지 않아서다 — 결함이 없어서가 아니다)
 *
 *    → 상태 목록을 **모듈 소스에서 뽑는다**. 새 상태가 코드에 들어오면 여기서 실패한다.
 */
const MODULE_DIR = path.join(__dirname, '..', '..', 'src', 'modules', 'waiting-queue');
function statusesFromSource(): string[] {
  const files = fs.readdirSync(MODULE_DIR).filter((f) => f.endsWith('.ts'));
  const found = new Set<string>();
  for (const f of files) {
    const src = fs.readFileSync(path.join(MODULE_DIR, f), 'utf-8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const m of src.matchAll(/'([A-Z][A-Z_]{3,})'/g)) {
      // 대기열 상태 어휘만 — 다른 대문자 상수(역할·권한 등)는 접두로 걸러낸다
      if (/^(WAITING|CALLED|IN_CONSULTATION|CASHIER_WAITING|PHARMACY_WAITING|VISIT_COMPLETED|COMPLETED|CANCELLED|NO_SHOW)$/.test(m[1])) found.add(m[1]);
    }
  }
  return [...found].sort();
}
const QUEUE_STATUSES = statusesFromSource();

/** 어느 버킷에도 넣지 않는 것이 옳은 상태 — 근거를 남긴다 */
const NOT_BUCKETED: string[] = [
  'CANCELLED', // 취소는 대기도 완료도 아니다
  'NO_SHOW',   // 미방문도 대기도 완료도 아니다(취소와 같은 취급)
];

const SRC = fs.readFileSync(
  path.join(__dirname, '..', '..', 'src', 'modules', 'waiting-queue', 'queue-display.service.ts'),
  'utf-8',
);

/** if/else 체인으로 버킷에 누적하는 블록들 */
function bucketChains(src: string): string[] {
  return src.match(/(?:(?:else\s+)?if\s*\([^)]*q\.status[^)]*\)\s*[\w.]+\+\+;\s*(?:\/\/[^\n]*\n\s*)*){3,}/g) ?? [];
}

describe('대기열 표시 — 상태 버킷 커버리지', () => {
  const chains = bucketChains(SRC);

  it('버킷 체인이 존재한다(구조 변경 감지)', () => {
    expect(chains.length).toBeGreaterThan(0);
  });

  it('🔴 상태 추출이 살아 있다 — 0개나 소수로 조용히 통과하지 않는다', () => {
    expect(QUEUE_STATUSES.length, `추출 상태 ${QUEUE_STATUSES.length}개 — 소스 구조가 바뀌었습니다`).toBeGreaterThanOrEqual(9);
  });

  it('🔴 모든 대기열 상태가 어느 버킷에 들어가거나 명시 제외다', () => {
    for (const [i, chain] of chains.entries()) {
      const covered = QUEUE_STATUSES.filter((s) => chain.includes(`'${s}'`));
      const missing = QUEUE_STATUSES.filter((s) => !covered.includes(s) && !NOT_BUCKETED.includes(s));
      expect(missing, `체인 #${i + 1} 누락 상태: ${missing.join(', ')}`).toEqual([]);
    }
  });

  it('🔴 수납 이후 상태는 전부 "진료 완료"로 센다 — 수납하면 실적이 줄면 안 된다', () => {
    for (const chain of chains) {
      // 완료 카운터와 같은 분기에 있어야 한다(대기로 세거나 빠뜨리면 안 된다)
      for (const st of ['CASHIER_WAITING', 'PHARMACY_WAITING', 'VISIT_COMPLETED']) {
        expect(chain, `${st} 가 완료 분기에 없다`).toMatch(new RegExp(`completedToday\\+\\+|q\\.status === '${st}'`));
        expect(chain, `${st} 누락`).toContain(`'${st}'`);
      }
    }
  });

  it('취소는 어느 버킷에도 넣지 않는다', () => {
    for (const chain of chains) expect(chain).not.toContain("'CANCELLED'");
  });
});
