import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ONSITE_QUEUE_STATUSES } from '../../src/modules/patient/onsite-filter';
import { OPD_ACTIVE, OPD_DONE_TODAY } from '../../src/modules/journey-console/flow-canon';

/**
 * '아직 원내' 상태 집합 — 정본은 하나다(2026-09-02).
 *
 * 🔴 같은 개념을 두 곳이 각자 정의하고 있었다. `onsite-filter` 는 `PHARMACY_WAITING` 을 포함하고
 *    `flow-canon.OPD_ACTIVE` 는 빠뜨려, **약국에서 조제를 기다리는 환자가 관제의 활성 집계와
 *    보드 목록에서 사라졌다.** 같은 날 전광판 집계에서도 같은 누락을 고쳤다 —
 *    한 곳만 고치면 갈라진다는 것이 이 축에서 두 번 확인됐다.
 */
describe('원내 체류 상태 — 정본이 하나다', () => {
  it('🔴 흐름 정본이 원내 정본에서 파생된다(따로 적지 않는다)', () => {
    expect(OPD_ACTIVE).toEqual(ONSITE_QUEUE_STATUSES);
  });

  it('🔴 수납 이후 원내 상태가 활성에 들어 있다 — 사라지면 안 된다', () => {
    // billing.service 는 수납 시 CASHIER_WAITING → PHARMACY_WAITING(처방 있음)으로 바꾼다
    expect(OPD_ACTIVE, '수납 대기').toContain('CASHIER_WAITING');
    expect(OPD_ACTIVE, '약국 대기 — 아직 원내다').toContain('PHARMACY_WAITING');
  });

  it('🔴 끝난 상태는 활성에 없고 당일 완료에 있다', () => {
    for (const done of ['COMPLETED', 'VISIT_COMPLETED', 'CANCELLED', 'NO_SHOW']) {
      expect(OPD_ACTIVE, `${done} 는 활성이 아니다`).not.toContain(done);
    }
    expect(OPD_DONE_TODAY).toContain('COMPLETED');
    expect(OPD_DONE_TODAY, '처방 없이 수납한 건').toContain('VISIT_COMPLETED');
  });

  it('🔴 흐름 정본이 상태를 다시 손으로 나열하지 않는다', () => {
    const src = readFileSync(join(process.cwd(), 'src/modules/journey-console/flow-canon.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(src, "OPD_ACTIVE 를 리터럴 배열로 다시 적으면 또 갈라진다")
      .not.toMatch(/OPD_ACTIVE\s*(:[^=]*)?=\s*\[/);
  });

  it('대조군 — 원내 정본 자체는 비어 있지 않다(파생이 0개로 통과하지 않게)', () => {
    expect(ONSITE_QUEUE_STATUSES.length).toBeGreaterThanOrEqual(5);
  });
});
