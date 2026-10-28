import { describe, it, expect, vi } from 'vitest';
import { PharmacyService } from '../../src/modules/pharmacy/pharmacy.service';

/**
 * 약국 큐 — 검수 단계 포함 계약 (2026-08-12).
 *
 * 🔴 조제가 끝나면 **오더는 COMPLETED** 로 닫힌다. 큐가 ORDERED/RECEIVED/IN_PROGRESS 만 반환하면
 *    **검수 단계(조제완료·미불출)가 통째로 빠진다.** 그래서 약국 화면의 '검수 대기' 탭은 데이터가
 *    있어도 **구조적으로 영원히 0건**이었다(운영 실측: 조제 5건인데 화면 0 · 보드는 5로 표시).
 *    검수는 약사가 실제로 해야 하는 작업이라 큐에 남아야 한다.
 */

function svcWith(capture: { where?: Record<string, unknown> }) {
  const prisma = {
    order: {
      findMany: vi.fn(async (args: { where: Record<string, unknown> }) => {
        capture.where = args.where;
        return [];
      }),
    },
  } as never;
  return new PharmacyService(prisma);
}

describe('약국 큐 — 검수 단계', () => {
  it('🔴 조제 완료(검수 대기)·검수 완료(불출 대기) 건이 큐 조건에 포함된다', async () => {
    const cap: { where?: Record<string, unknown> } = {};
    await svcWith(cap).getQueue();
    const or = cap.where?.OR as Record<string, unknown>[] | undefined;
    expect(or, '큐가 단일 status 필터면 검수·불출 단계가 빠진다').toBeTruthy();
    // VERIFIED 를 빼면 검수 확인 즉시 행이 사라져 불출(수령 확인) 경로가 화면에서 끊긴다(2026-08-13).
    // 🔴 2026-08-26: PENDING 추가 — 처방이 취소되면 **조제 중인 건이 통지 없이 목록에서 사라지던**
    //    결함 때문이다. 이 절은 이제 "이미 조제가 시작된 것은 처방 상태와 무관하게 남는다"를 뜻한다.
    expect(or).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ dispensing: { status: { in: ['PENDING', 'DISPENSED', 'VERIFIED'] } } }),
      ]),
    );
  });

  it('🔴 약(MEDICATION)만 큐에 올린다 — 간호 지시·식이·검사 제외 (2026-08-13 실측 14건 중 8건 비약물)', async () => {
    // department='PHARMACY' 에는 제 부서가 없는 처방(DIET·ACTIVITY·NURSING·LAB)이 대체 저장된다.
    // workstation getPharmacyWorklist 와 같은 계약 — 한쪽만 고치면 갈라진다.
    const cap: { where?: Record<string, unknown> } = {};
    await svcWith(cap).getQueue();
    const rx = cap.where?.prescription as Record<string, unknown> | undefined;
    expect(rx?.type, '비약물 처방이 조제 큐에 섞인다').toBe('MEDICATION');
    // 🔴 2026-08-26: `status: 'ACTIVE'` 는 **최상위에서 빠졌다.** 여기 걸려 있으면
    //    처방이 취소된 순간 조제 중·검수 대기·불출 대기 건이 큐에서 증발한다
    //    (`prescription.cancel` 은 진행 중 오더를 **의도적으로 보존**하는데, 정작 그것을
    //     처리할 화면에서 사라졌다). 이제 ACTIVE 는 "아직 조제 전" 절에만 걸린다.
    expect(rx?.status, '최상위 ACTIVE 필터가 되살아나면 취소 처방의 조제 중 건이 사라진다').toBeUndefined();
    const or = cap.where?.OR as Record<string, unknown>[];
    expect(or).toEqual(
      expect.arrayContaining([expect.objectContaining({ prescription: { status: { in: ['ACTIVE', 'DISCONTINUED'] } } })]), // 2026-09-30 중단 처방의 시작된 오더도 남는다
    );
  });

  it('조제 진행 단계도 그대로 유지된다(회귀 방지)', async () => {
    const cap: { where?: Record<string, unknown> } = {};
    await svcWith(cap).getQueue();
    const or = cap.where?.OR as Record<string, unknown>[];
    expect(or).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          prescription: { status: { in: ['ACTIVE', 'DISCONTINUED'] } },
          status: { in: ['ORDERED', 'RECEIVED', 'IN_PROGRESS'] },
        }),
      ]),
    );
  });

  it('불출 완료(ISSUED)는 큐에 넣지 않는다 — 끝난 작업이다', async () => {
    const cap: { where?: Record<string, unknown> } = {};
    await svcWith(cap).getQueue();
    expect(JSON.stringify(cap.where)).not.toContain('ISSUED');
  });

  it('원내/원외 구분은 그대로 적용된다', async () => {
    const cap: { where?: Record<string, unknown> } = {};
    await svcWith(cap).getQueue('INTERNAL');
    expect(cap.where?.pharmacyType).toBe('INTERNAL');
    expect(cap.where?.department).toBe('PHARMACY');
  });
});

describe('조제 상세 — FE 계약(최상위 prescription)', () => {
  it('🔴 dispensing 경로도 최상위 prescription 을 준다 — 없으면 상세 패널이 통째로 빈칸(2026-08-13)', async () => {
    // FE(pharmacy/page.tsx)는 detail.prescription?.* 를 읽는다. 접수 대기 폴백 경로만 최상위에
    // 담고 dispensing 경로는 order.prescription 아래에 숨겨, 조제중~불출대기 건이 전부 빈칸이었다.
    const prescription = { id: 'rx1', medicationCode: { nameKo: '세파렉신캡슐' } };
    const dispensing = { id: 'd1', orderId: 'o1', status: 'PENDING', order: { id: 'o1', prescription }, items: [], patient: null, pharmacist: null };
    const prisma = {
      dispensing: { findUnique: vi.fn(async () => dispensing), findFirst: vi.fn() },
      order: { findUnique: vi.fn() },
    } as never;
    const svc = new PharmacyService(prisma);
    const detail = await svc.getDispensingDetail('d1') as { prescription?: { id?: string } };
    expect(detail.prescription?.id, 'dispensing 경로에서 최상위 prescription 이 빠졌다').toBe('rx1');
  });
});
