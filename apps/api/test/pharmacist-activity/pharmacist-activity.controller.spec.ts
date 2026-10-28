import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PharmacistActivityController } from '../../src/modules/pharmacist-activity/pharmacist-activity.controller';

/**
 * 컨트롤러 계약 가드 — 주체는 서버가 채우고, 목록은 절단 사실을 함께 준다.
 *
 * 되살아나면 안 되는 것:
 *  ① 클라이언트가 보낸 pharmacistId/requestedBy('ph-001')를 그대로 신뢰(주체 위조 + uuid 컬럼 저장 실패)
 *  ② 화면이 읽는 응답 키(data)가 사라짐
 */
describe('PharmacistActivityController 주체 바인딩 가드', () => {
  const USER_ID = '22222222-2222-4222-8222-222222222222';
  let controller: PharmacistActivityController;
  let service: any;

  beforeEach(() => {
    service = {
      getInterventions: vi.fn().mockResolvedValue({ items: [], truncated: false, limit: 200 }),
      createIntervention: vi.fn().mockResolvedValue({ id: 'i1' }),
      updateIntervention: vi.fn().mockResolvedValue({ id: 'i1' }),
      assertCanRespond: vi.fn().mockResolvedValue(undefined),
      getTdmRequests: vi.fn().mockResolvedValue({ items: [], truncated: true, limit: 200 }),
      createTdmRequest: vi.fn().mockResolvedValue({ id: 't1' }),
      recordTdmResult: vi.fn().mockResolvedValue({ id: 't1' }),
    };
    controller = new PharmacistActivityController(service);
  });

  it('중재 등록의 약사는 인증 사용자다(본문 ph-001 은 무시)', async () => {
    await controller.createIntervention(
      {
        pharmacistId: 'ph-001', pharmacistName: '임약사',
        patientId: 'p1', prescriptionDrug: 'Vancomycin', type: 'DOSE',
        reason: 'r', suggestion: 's',
      } as never,
      USER_ID,
    );
    const arg = service.createIntervention.mock.calls[0][0];
    expect(arg.pharmacistId).toBe(USER_ID);
    expect(arg).not.toHaveProperty('pharmacistName');
  });

  it('중재 처리의 응답자는 인증 사용자다', async () => {
    await controller.updateIntervention('i1', { status: 'ACCEPTED', doctorResponse: 'ok' }, { id: USER_ID, role: 'DOCTOR' as never });
    // 회신 권한 검사가 쓰기보다 먼저 불린다(의사는 자기 처방의 중재에만)
    expect(service.assertCanRespond).toHaveBeenCalledWith('i1', { id: USER_ID, role: 'DOCTOR' });
    expect(service.updateIntervention.mock.calls[0][1]).toMatchObject({
      status: 'ACCEPTED', respondedBy: USER_ID,
    });
  });

  it('TDM 요청자는 인증 사용자다(본문 requestedBy 무시)', async () => {
    await controller.createTdmRequest(
      { patientId: 'p1', drugName: 'Vancomycin', requestedBy: 'ph-001' } as never,
      USER_ID,
    );
    expect(service.createTdmRequest.mock.calls[0][0].requestedBy).toBe(USER_ID);
  });

  it('목록 응답은 data 키를 유지하고 절단 사실을 meta 로 알린다', async () => {
    const intv: any = await controller.getInterventions();
    expect(intv.data).toEqual([]);
    expect(intv.meta).toEqual({ truncated: false, limit: 200 });

    const tdm: any = await controller.getTdmRequests();
    expect(tdm.data).toEqual([]);
    expect(tdm.meta.truncated).toBe(true);
  });
});
