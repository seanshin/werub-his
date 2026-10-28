import { describe, it, expect } from 'vitest';
import {
  DEPT_QUEUES,
  allowedDeptQueues,
  blockedDeptQueues,
  canFetchDeptQueue,
  canFetchMyQueue,
} from './queue-access';

/**
 * `/clinic-queue` 역할 게이트 — 프로브가 센 403 을 그대로 케이스로 굳힌다.
 *   RECEPTIONIST 4/7 · NURSE 2/7 · DOCTOR 1/7
 *
 * 🔴 재주입: `canFetchDeptQueue` 를 `() => true`(역할 무관 호출)로 되돌리면
 *    아래 "RECEPTIONIST 는 부서 큐를 하나도 부르지 않는다" 부터 실패한다.
 */

describe('부서 큐 — 자기 역할이 받을 수 있는 것만', () => {
  it('🔴 RECEPTIONIST 는 부서 큐를 하나도 부르지 않는다(종전 3종 전부 403)', () => {
    expect(allowedDeptQueues('RECEPTIONIST')).toEqual([]);
    expect(blockedDeptQueues('RECEPTIONIST').map((d) => d.key)).toEqual(['lab', 'imaging', 'pharmacy']);
    expect(canFetchMyQueue('RECEPTIONIST')).toBe(false); // queue/my 도 403 이었다 → 합 4건
  });

  it('🔴 NURSE 는 검사실만 — 영상·약국은 403 이었다(2건)', () => {
    expect(allowedDeptQueues('NURSE').map((d) => d.key)).toEqual(['lab']);
    expect(blockedDeptQueues('NURSE').map((d) => d.key)).toEqual(['imaging', 'pharmacy']);
  });

  it('🔴 DOCTOR 는 약국만 막힌다(1건)', () => {
    expect(allowedDeptQueues('DOCTOR').map((d) => d.key)).toEqual(['lab', 'imaging']);
    expect(blockedDeptQueues('DOCTOR').map((d) => d.key)).toEqual(['pharmacy']);
  });

  /** 🔴 대조군 — 판정을 `() => false` 로 만들면(전부 접기) 여기서 실패한다 */
  it('대조군: ADMIN 은 세 큐를 다 부르고 접히는 것이 없다', () => {
    expect(allowedDeptQueues('ADMIN').map((d) => d.key)).toEqual(['lab', 'imaging', 'pharmacy']);
    expect(blockedDeptQueues('ADMIN')).toEqual([]);
    expect(canFetchMyQueue('ADMIN')).toBe(true);
  });

  it('대조군: 담당 직군은 자기 큐를 부른다', () => {
    expect(canFetchDeptQueue('PHARMACIST', 'pharmacy')).toBe(true);
    expect(canFetchDeptQueue('LAB_TECH', 'lab')).toBe(true);
    expect(canFetchDeptQueue('LAB_TECH', 'imaging')).toBe(true);
  });

  it('로그인 전(역할 미상)에는 아무 큐도 부르지 않는다', () => {
    expect(allowedDeptQueues(undefined)).toEqual([]);
    expect(canFetchMyQueue(null)).toBe(false);
  });
});

describe('접힌 것을 말할 재료', () => {
  it('막힌 큐마다 "누구의 권한인가"를 들고 있다 — 빈 화면으로 뭉개지 않는다', () => {
    for (const d of DEPT_QUEUES) {
      expect(d.whose.length).toBeGreaterThan(0);
      expect(d.label.length).toBeGreaterThan(0);
    }
  });
});
