import { describe, it, expect, vi } from 'vitest';
import { WorkstationService } from '../../src/modules/workstation/workstation.service';

/**
 * 검사 코드 체계 다리 계약 — 2026-08-12 (화면 점검 W1).
 *
 * 🔴 시스템에 검사 코드 체계가 **둘** 있는데 잇는 다리가 없다.
 *    - `lab_test_templates.procedureCode` = `CBC`·`HbA1c`·`LFT` (결과 입력 양식용·8종)
 *    - `procedure_codes.code`             = `E6591`·`E6502`·`HE101` (처방·수가용)
 *    두 집합의 **교집합이 0**이다(운영 실측).
 *
 * 결과:
 *  1. 워크스테이션 큐 필터(`orderCodes`)가 항상 공집합 → 18스테이션 영구 0건
 *  2. `getLabTemplate(order.procedureCode.code)` 가 **항상 null** → 결과 입력 시 항목·단위·
 *     참고범위가 안 붙고 빈 행 하나로 떨어진다(참고범위 없는 자유 입력)
 *
 * 다리를 놓는 것은 임상 매핑이라 **사람 몫**이다(추정 금지). 이 테스트는 다리가 생겼는지를
 * 계약으로 지켜본다 — 매핑이 도입되면 `getLabTemplate` 이 처방코드로도 template 을 찾아야 한다.
 */

describe('검사 템플릿 ↔ 처방코드', () => {
  it('템플릿 조회는 주어진 코드를 그대로 찾는다(현행 계약)', async () => {
    const findUnique = vi.fn().mockResolvedValue(null);
    const s = new WorkstationService({ labTestTemplate: { findUnique } } as never);

    await s.getLabTemplate('E6591');
    expect(findUnique).toHaveBeenCalledWith({ where: { procedureCode: 'E6591' } });
  });

  it('🔴 처방코드로 못 찾으면 null 을 준다 — 화면은 이 null 을 "양식 없음"으로 밝혀야 한다', async () => {
    const s = new WorkstationService({
      labTestTemplate: { findUnique: vi.fn().mockResolvedValue(null) },
    } as never);

    // 종전엔 화면이 이 null 을 조용히 빈 행 하나로 바꿔, 검사기사가 참고범위 없이 자유 입력했다.
    // 지금은 lab 워크스테이션이 "자동으로 연결되지 않았습니다" 배너를 띄운다.
    expect(await s.getLabTemplate('E6591')).toBeNull();
  });

  it('템플릿 코드로 부르면 찾는다(수동 선택 경로는 살아 있다)', async () => {
    const tmpl = { procedureCode: 'HbA1c', testName: '당화혈색소', items: [{ name: 'HbA1c' }] };
    const s = new WorkstationService({
      labTestTemplate: { findUnique: vi.fn().mockResolvedValue(tmpl) },
    } as never);

    expect(await s.getLabTemplate('HbA1c')).toEqual(tmpl);
  });
});
