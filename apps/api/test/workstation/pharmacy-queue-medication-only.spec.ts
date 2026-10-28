import { describe, it, expect, vi } from 'vitest';
import { WorkstationService } from '../../src/modules/workstation/workstation.service';

/**
 * 약국 조제 큐 계약 — 2026-08-12 (화면 점검 W1 · 패턴 P4 친척).
 *
 * 🔴 `TYPE_TO_DEPARTMENT` 는 제 부서가 없는 처방 3종(DIET·ACTIVITY·NURSING)을 **PHARMACY 로 대체**한다
 *    (`OrderDepartment` enum 에 간호·영양 값이 없어서다). 그래서 약국 조제 큐에
 *    `병실 내 보행`·`침상머리 30° 거상`·`체위 변경`·`기본식사-경관영양유동식`·`BUN 외 7종` 이 섰다
 *    — 운영 실측 19건 중 **8건이 비약물**이었다. 약사는 보행을 조제할 수 없다.
 *
 * 규약: **약국 큐는 `department` 가 아니라 `prescription.type='MEDICATION'` 으로 거른다.**
 * 부서 값이 늘어나더라도 이 조건은 유지되어야 한다.
 */

function svc() {
  const findMany = vi.fn().mockResolvedValue([]);
  return { s: new WorkstationService({ order: { findMany }, workstationConfig: { findUnique: vi.fn().mockResolvedValue(null) } } as never), findMany };
}

describe('약국 조제 큐', () => {
  it('🔴 약(MEDICATION)만 조제 큐에 올린다 — 간호 지시·식이·검사 제외', async () => {
    const { s, findMany } = svc();
    await s.getQueue('pharmacy');
    const where = findMany.mock.calls[0][0].where;
    expect(where.prescription?.type, '비약물 처방이 조제 큐에 섞인다').toBe('MEDICATION');
  });

  it('🔴 ACTIVE 조건은 "아직 조제 전" 절에만 걸린다 — 최상위면 취소 처방의 조제 중 건이 사라진다', async () => {
    // 2026-08-26: 종전엔 최상위 `prescription: { status: 'ACTIVE' }` 였다. 그래서 처방이 취소되면
    // 조제 중·검수 대기·불출 대기 건이 **통지 없이 목록에서 증발**했다(Dispensing 은 미완결로 원장에 남는다).
    // `prescription.cancel` 은 진행 중 오더를 의도적으로 보존하는데, 정작 그것을 처리할 화면에서 사라졌다.
    const { s, findMany } = svc();
    await s.getQueue('pharmacy');
    const where = findMany.mock.calls[0][0].where;
    expect(where.prescription?.status, '최상위 ACTIVE 필터가 되살아났다').toBeUndefined();
    // 조제 전 단계에는 여전히 ACTIVE 가 걸려 있어야 한다(취소된 처방을 새로 조제하지 않는다)
    // 2026-09-30: 활성·중단 처방 — 취소(CANCELLED)는 여전히 새로 조제하지 않는다
    expect(JSON.stringify(where.OR)).toContain('"status":{"in":["ACTIVE","DISCONTINUED"]}');
    // 이미 조제가 시작된 것은 처방 상태와 무관하게 남는다
    expect(JSON.stringify(where.OR)).toContain('PENDING');
  });

  it('조제 완료분(검수·불출 대기)은 계속 보인다(2026-08-12 오전 계약 회귀 방지)', async () => {
    const { s, findMany } = svc();
    await s.getQueue('pharmacy');
    const or = findMany.mock.calls[0][0].where.OR;
    expect(JSON.stringify(or)).toMatch(/DISPENSED/);
  });
});
