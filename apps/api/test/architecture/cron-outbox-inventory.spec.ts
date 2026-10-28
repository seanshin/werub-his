import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { scanCrons, swallowingByFile, unhandledByFile } from './cron-scan';
import {
  CRON_SWALLOW_BASELINE,
  CRON_TOTAL_BASELINE,
  CRON_UNHANDLED_TOTAL_BASELINE,
} from './cron-outbox-inventory.baseline';

/**
 * 🔴 크론 실패 처리 기준선(2026-09-16 E4) — **삼키는 자리가 늘지 않는다**.
 *
 * 분모: `@Cron` 핸들러 전수. 분류는 **catch 블록 안**을 본다(본문 전체가 아니다 —
 * 그렇게 세면 DB 를 쓰기만 해도 '원장 기록'이 되어 audit 앵커링이 잘못 분류됐다).
 *
 * 🔴 **`unhandled`(try/catch 없음)가 곧 결함은 아니다.** 스케줄러가 받아 unhandledRejection 으로
 *    로그에는 남는다. 다만 작업이 중간에 끊기므로, 되돌릴 수 없는 일을 하는 크론은 한 건씩 봐야 한다.
 *    이 가드가 지키는 것은 수가 **늘지 않는다** 하나다.
 */
const SRC = path.resolve(__dirname, '../../src');

describe('🔴 크론 실패 처리 — 삼키는 자리는 늘지 않는다', () => {
  const rows = scanCrons(SRC);

  it('대조군 — 스캐너가 실제로 크론을 찾았다(0개면 아래가 전부 자동 통과한다)', () => {
    expect(rows.length).toBeGreaterThan(40);
    expect(rows.every((r) => r.name !== '?'), '메서드명을 못 읽은 행이 있다').toBe(true);
  });

  it('전체 @Cron 수가 기준선과 같다(늘면 새 크론 · 줄면 사라진 것)', () => {
    expect(rows.length).toBe(CRON_TOTAL_BASELINE);
  });

  it('파일별 "실패를 삼키는" 크론 수가 기준선과 정확히 같다', () => {
    expect(swallowingByFile(rows)).toEqual(CRON_SWALLOW_BASELINE);
  });

  it('try/catch 없는 크론 수가 기준선을 넘지 않는다', () => {
    const n = Object.values(unhandledByFile(rows)).reduce((a, b) => a + b, 0);
    expect(n).toBeLessThanOrEqual(CRON_UNHANDLED_TOTAL_BASELINE);
  });

  it('🔴 E4 가 고친 자리는 더 이상 삼키지 않는다(기준선이 아니라 이름으로 못박는다)', () => {
    const swallowed = new Set(Object.keys(swallowingByFile(rows)));
    for (const f of [
      'modules/ess/ess-approval-reminder.cron.ts',
      'modules/gld/governance.service.ts',
      'modules/schedule/schedule.service.ts',
    ]) {
      expect(swallowed.has(f), `${f} 가 다시 실패를 삼킨다`).toBe(false);
    }
  });
});
