import { describe, it, expect, vi } from 'vitest';
import { PATIENT_SENSITIVE_OMIT } from '../../src/common/patient-select';
import { IcuService } from '../../src/modules/icu/icu.service';

/**
 * 환자 응답 과잉노출 위생 계약 — `include: { patient: true }` 가 암호화 PID·재무 필드를
 * 응답 body 에 통째로 실어 나르던 것을 omit 으로 막았다(전수 실측: 소비처 0).
 *
 * 이 스펙이 깨지면 = 정본 omit 에서 민감 필드가 빠졌거나, 상세 조회가 omit 없이 patient 를
 * 통째 반환하도록 회귀한 것이다. 둘 다 ciphertext 저장형 노출로 이어진다.
 */

describe('PATIENT_SENSITIVE_OMIT — 암호화 PID·재무 필드 전량 커버', () => {
  it('스키마의 모든 암호화/민감 필드가 omit 대상이다', () => {
    // Patient 모델의 AES-256-GCM / HMAC / 민감 재무 필드(스키마 주석 기준)
    for (const field of [
      'nationalId', 'nationalIdHash', 'ci',
      'passportNumber', 'alienRegistrationNo', 'insuranceNumber', 'incomeDecile',
    ]) {
      expect(PATIENT_SENSITIVE_OMIT[field as keyof typeof PATIENT_SENSITIVE_OMIT]).toBe(true);
    }
  });

  it('omit 값은 전부 true(부분 omit 로 새는 필드 없음)', () => {
    for (const v of Object.values(PATIENT_SENSITIVE_OMIT)) expect(v).toBe(true);
  });
});

describe('IcuService.getPatientDetail — 상세 조회가 omit 을 건다', () => {
  function makeSvc() {
    const findUnique = vi.fn().mockResolvedValue({
      id: 'a1', patient: { id: 'p1', mrn: 'HR-1', familyName: '홍', givenName: '길동' },
      icuBed: { id: 'b1' }, records: [],
    });
    const prisma = { icuAdmission: { findUnique } };
    return { svc: new IcuService(prisma as never, {} as never), findUnique };
  }

  it('findUnique include.patient 에 정본 omit 이 걸린다(통째 반환 금지)', async () => {
    const { svc, findUnique } = makeSvc();
    await svc.getPatientDetail('a1');
    const arg = findUnique.mock.calls[0][0];
    expect(arg.include.patient).toEqual({ omit: PATIENT_SENSITIVE_OMIT });
    // 회귀 감지: patient: true(통째) 로 되돌아가면 실패
    expect(arg.include.patient).not.toBe(true);
  });
});
