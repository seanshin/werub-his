import { describe, it, expect, vi } from 'vitest';
import { EligibilityService } from '../../src/modules/eligibility/eligibility.service';

/**
 * FR-5 본인확인 기록 계약 — **실패를 남길 수 있어야 한다**(2026-08-18).
 *
 * 봉합한 결함:
 *  ① `result: exception ? 'PASS' : 'PASS'` — 삼항 양쪽이 같아 무엇을 보내든 PASS.
 *     환자안전 화면의 "식별 오류율"(`result === 'FAIL'` 집계)이 **구조적으로 영구 0%**.
 *  ② FE 가 `verifiedItems` 를 보내지 않는데 서버가 `{name:true, dob:true}` 를 무조건 주입 —
 *     아무도 확인하지 않은 항목이 "확인 완료"로 법정기록에 남았다.
 *
 * 🔴 이 가드는 결함을 되돌리면 반드시 실패해야 한다(재주입 역검증 완료).
 */

const build = () => {
  const created: Record<string, unknown>[] = [];
  const prisma: any = {
    patientIdentificationCheck: {
      create: vi.fn(async ({ data }: any) => { created.push(data); return { id: 'c1', ...data }; }),
    },
    waitingQueue: { update: vi.fn().mockResolvedValue({}) },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
  };
  const cfg: any = { get: vi.fn().mockResolvedValue(undefined) };
  const svc = new EligibilityService(prisma, cfg, {} as never, {} as never);
  return { svc, prisma, created };
};

describe('EligibilityService.verifyIdentity — 확인한 것만 기록한다', () => {
  it('대조 항목이 전부 true 면 PASS', async () => {
    const { svc, created } = build();
    await svc.verifyIdentity('p1', { method: 'ID_CARD', verifiedItems: { name: true, dob: true } }, 'u1');
    expect(created[0].result).toBe('PASS');
    expect(created[0].verifiedItems).toEqual({ name: true, dob: true });
  });

  it('🔴 대조 항목 중 하나라도 false 면 FAIL — 종전엔 어떤 입력에도 PASS 였다', async () => {
    const { svc, created } = build();
    await svc.verifyIdentity('p1', { method: 'ID_CARD', verifiedItems: { name: true, dob: false }, failureReason: '생년월일 불일치' }, 'u1');
    expect(created[0].result).toBe('FAIL');
    expect(created[0].failureReason).toBe('생년월일 불일치');
  });

  it('🔴 명시 result=FAIL 도 FAIL 로 기록된다', async () => {
    const { svc, created } = build();
    await svc.verifyIdentity('p1', { method: 'TWO_IDENTIFIER', result: 'FAIL', failureReason: '타인 신분증 제시', verifiedItems: { name: true } }, 'u1');
    expect(created[0].result).toBe('FAIL');
  });

  it('FAIL 은 사유 없이 기록할 수 없다', async () => {
    const { svc, prisma } = build();
    await expect(svc.verifyIdentity('p1', { method: 'ID_CARD', result: 'FAIL' }, 'u1')).rejects.toThrow();
    expect(prisma.patientIdentificationCheck.create).not.toHaveBeenCalled();
  });

  it('🔴 대조 항목이 없으면 기록하지 않고 거절한다 — 기본값(name/dob=true) 주입 금지', async () => {
    const { svc, prisma } = build();
    await expect(svc.verifyIdentity('p1', { method: 'ID_CARD' }, 'u1')).rejects.toThrow();
    expect(prisma.patientIdentificationCheck.create).not.toHaveBeenCalled();
  });

  it('🔴 FAIL 이면 대기열에 "본인확인 완료" 시각을 찍지 않는다', async () => {
    const { svc, prisma } = build();
    await svc.verifyIdentity('p1', { method: 'ID_CARD', verifiedItems: { name: false }, failureReason: '성명 불일치', queueId: 'q1' }, 'u1');
    expect(prisma.waitingQueue.update).not.toHaveBeenCalled();
  });

  it('PASS 면 대기열에 확인 시각을 찍는다', async () => {
    const { svc, prisma } = build();
    await svc.verifyIdentity('p1', { method: 'ID_CARD', verifiedItems: { name: true, dob: true }, queueId: 'q1' }, 'u1');
    expect(prisma.waitingQueue.update).toHaveBeenCalled();
  });

  it('구두확인 예외는 오류(FAIL)로 세지 않는다 — 거짓 경보 금지. 사유는 [예외] 로 표식', async () => {
    const { svc, created } = build();
    await svc.verifyIdentity('p1', { method: 'VERBAL_EXCEPTION', verifiedItems: { name: true, dob: true }, exceptionReason: '신분증 미지참' }, 'u1');
    expect(created[0].result).toBe('PASS');
    expect(String(created[0].failureReason)).toContain('[예외]');
  });
});

/**
 * 🔴 (2026-09-15 P2) 명시 `result:'PASS'` 는 "항목 없으면 400" 을 우회해 `verifiedItems: {}` PASS 를 남겼다.
 *    같은 구멍이 `POST /safety/identification-check` 에도 있었다(본문 result 를 그대로 기록).
 *    판정 정본 `common/identity-check-verdict.ts` 가 대조 항목에서 유도한다.
 */
describe('🔴 PASS 선언은 근거가 아니다 — 대조 항목에서 서버가 판정한다', () => {
  it('result:PASS 만 오면 기록하지 않고 400(IDENTITY_ITEMS_REQUIRED)', async () => {
    const { svc, prisma } = build();
    await expect(svc.verifyIdentity('p1', { method: 'ID_CARD', result: 'PASS' }, 'u1')).rejects.toMatchObject({ status: 400 });
    expect(prisma.patientIdentificationCheck.create).not.toHaveBeenCalled();
  });

  it('result:PASS + 빈 항목 {} 도 400', async () => {
    const { svc, prisma } = build();
    await expect(svc.verifyIdentity('p1', { method: 'ID_CARD', result: 'PASS', verifiedItems: {} }, 'u1')).rejects.toMatchObject({ status: 400 });
    expect(prisma.patientIdentificationCheck.create).not.toHaveBeenCalled();
  });

  it('result:PASS 를 선언해도 불일치 항목이 있으면 FAIL — 선언보다 대조가 이긴다', async () => {
    const { svc, created } = build();
    await svc.verifyIdentity('p1', { method: 'ID_CARD', result: 'PASS', verifiedItems: { name: true, dob: false }, failureReason: '생년월일 다름' }, 'u1');
    expect(created[0].result).toBe('FAIL');
  });

  it('문자열 "true" 는 대조 항목으로 세지 않는다 — PASS 근거가 되지 못한다', async () => {
    const { svc, prisma } = build();
    await expect(svc.verifyIdentity('p1', { method: 'ID_CARD', result: 'PASS', verifiedItems: { name: 'true' } as never }, 'u1')).rejects.toMatchObject({ status: 400 });
    expect(prisma.patientIdentificationCheck.create).not.toHaveBeenCalled();
  });

  it('대조군 — 불일치 신고(명시 FAIL+사유)는 항목 없이도 기록된다(발견 즉시 남긴다)', async () => {
    const { svc, created } = build();
    await svc.verifyIdentity('p1', { method: 'TWO_IDENTIFIER', result: 'FAIL', failureReason: '타인 신분증' }, 'u1');
    expect(created[0].result).toBe('FAIL');
    expect(created[0].verifiedItems).toEqual({});
  });
});

describe('🔴 환자안전 식별 체크(POST /safety/identification-check) — 같은 정본', () => {
  const buildSafety = async () => {
    const { PatientSafetyService } = await import('../../src/modules/patient-safety/patient-safety.service');
    const created: Record<string, unknown>[] = [];
    const prisma: any = { patientIdentificationCheck: { create: vi.fn(async ({ data }: any) => { created.push(data); return { id: 'x', ...data }; }) } };
    const svc = Object.create(PatientSafetyService.prototype) as any;
    svc.prisma = prisma;
    return { svc, prisma, created };
  };
  const base = { patientId: 'p1', checkType: 'MEDICATION', method: 'WRISTBAND', verifiedBy: 'u1' };

  it('result:PASS + 빈 항목 → 기록하지 않는다(400)', async () => {
    const { svc, prisma } = await buildSafety();
    await expect(svc.createIdCheck({ ...base, verifiedItems: {}, result: 'PASS' })).rejects.toMatchObject({ status: 400 });
    expect(prisma.patientIdentificationCheck.create).not.toHaveBeenCalled();
  });

  it('result:PASS + {name:false} → FAIL 로 기록(사유 있음)', async () => {
    const { svc, created } = await buildSafety();
    await svc.createIdCheck({ ...base, verifiedItems: { name: false, mrn: true }, result: 'PASS', failureReason: '팔찌 이름 다름' });
    expect(created[0].result).toBe('FAIL');
  });

  it('대조군 — 전부 일치하면 PASS · 본문 키를 컬럼에 펼치지 않는다', async () => {
    const { svc, created } = await buildSafety();
    await svc.createIdCheck({ ...base, verifiedItems: { name: true, mrn: true }, result: 'PASS', id: 'evil' } as never);
    expect(created[0].result).toBe('PASS');
    expect(created[0]).not.toHaveProperty('id');
  });
});
