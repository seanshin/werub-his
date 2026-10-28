import { describe, it, expect, vi } from 'vitest';
import { OpeningService } from '../../src/modules/opening/opening.service';
import { PreAuthGateService } from '../../src/modules/pre-auth/pre-auth-gate.service';
import { ProtocolService } from '../../src/modules/protocol/protocol.service';
import { ErpEapprovalService } from '../../src/modules/clinic-integration/erp-eapproval.service';
import { resolveEncounterForDur } from '../../src/modules/medical-ai/drug-verdict';

/**
 * N4(2026-09-15) — `.catch(() => 기본값)` 실결함 교정의 **동작** 계약. 인벤토리 가드(`catch-default-inventory.spec.ts`)는
 * 모양의 수를 동결하고, 여기서는 "실패가 '없음'으로 번역되지 않는다"를 실제 호출로 본다. 각 건에 대조군(진짜 없음)을 둔다.
 */
const boom = () => Promise.reject(new Error('DB down'));

describe('opening taskTitle — 없는 항목(404)만 null, 조회 실패는 전파', () => {
  const mk = (findUnique: () => Promise<unknown>) =>
    new OpeningService({ openingCustomTask: { findUnique } } as never, {} as never, {} as never);

  it('🔴 DB 조회 실패 → 전파(판독이 조용히 "행정 증빙 문서"로 떨어지지 않는다)', async () => {
    await expect(mk(boom).taskTitle('inst.x')).rejects.toThrow('DB down');
  });
  it('대조군 — 진짜 없는 기관 항목은 null', async () => {
    await expect(mk(() => Promise.resolve(null)).taskTitle('inst.x')).resolves.toBeNull();
  });
});

describe('사전승인 고가영상 판정 — 판정기준 조회 실패를 "고가 아님"(게이트 통과)으로 접지 않는다', () => {
  it('🔴 설정 조회 실패 → 전파', async () => {
    const svc = new PreAuthGateService({ procedureCode: { findUnique: vi.fn() } } as never, { get: boom } as never);
    await expect(svc.isHighCostImaging('pc-1')).rejects.toThrow('DB down');
  });
  it('대조군 — 판정기준 미설정(null)이면 고가 아님', async () => {
    const svc = new PreAuthGateService({ procedureCode: { findUnique: vi.fn() } } as never, { get: () => Promise.resolve(null) } as never);
    await expect(svc.isHighCostImaging('pc-1')).resolves.toBe(false);
  });
});

describe('프로토콜 조건 분기 컨텍스트 — 환자 조회 실패를 "조건 없음"으로 만들지 않는다', () => {
  const mk = (patientFind: () => Promise<unknown>) =>
    new ProtocolService({ patient: { findUnique: patientFind }, emergencyVisit: { findUnique: vi.fn() } } as never, {} as never, {} as never, {} as never) as unknown as
      { buildConditionContext: (i: { patientId: string }) => Promise<Record<string, unknown>> };

  it('🔴 조회 실패 → 전파(무조건 전이로 떨어지지 않는다)', async () => {
    await expect(mk(boom).buildConditionContext({ patientId: 'p' })).rejects.toThrow('DB down');
  });
  it('대조군 — 조회 성공이면 성별을 싣는다', async () => {
    const ctx = await mk(() => Promise.resolve({ dateOfBirth: null, gender: 'F' })).buildConditionContext({ patientId: 'p' });
    expect(ctx.gender).toBe('F');
  });
});

describe('DUR 진료 해석 — 조회 실패와 진료 없음을 다른 사유로 말한다', () => {
  it('🔴 조회 실패 → "조회 실패" 사유(진료 미특정이라 말하지 않는다)', async () => {
    const r = await resolveEncounterForDur({ encounter: { findFirst: boom } } as never, 'p');
    expect(r.note).toContain('조회 실패');
    expect(r.note).not.toContain('미특정');
  });
  it('대조군 — 진짜 진료 없음은 "진료 미특정"', async () => {
    const r = await resolveEncounterForDur({ encounter: { findFirst: () => Promise.resolve(null) } } as never, 'p');
    expect(r.note).toContain('미특정');
  });
});

describe('ERP 전자결재 멱등 조회 — 조회 실패를 "중복 아님"으로 접어 재상신하지 않는다', () => {
  const data = {
    doc_type: 'HR_LEAVE', title: 't', drafter_clinic_user_id: 'u', content: {}, ref: { source_module: 'hr', source_ref: 'r1' },
    callback_url: 'https://erp.example.com/cb',
  };
  it('🔴 멱등 조회 실패 → 전파(생성 경로에 도달하지 않는다)', async () => {
    const create = vi.fn();
    const svc = new ErpEapprovalService({ eApprovalRelay: { findUnique: boom, create } } as never, {} as never, { get: () => undefined } as never);
    (svc as unknown as { isCallbackUrlSafe: () => boolean }).isCallbackUrlSafe = () => true;
    await expect(svc.submit(data as never)).rejects.toThrow('DB down');
    expect(create).not.toHaveBeenCalled();
  });
});
