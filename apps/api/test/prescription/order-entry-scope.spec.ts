import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PrescriptionService } from '../../src/modules/prescription/prescription.service';

/**
 * 직종별 오더 입력 범위 — 실행 계약(2026-09-29 · 정본 shared `order-entry-scope`).
 *
 *  1. 간호사의 **간호 오더(NURSING)는 본인 권한** — 지정 의사·승인 없이 저장되고 책임자=본인
 *  2. 간호사의 약 처방은 종전대로 지정 의사 + 승인(fail-closed) — 규칙 OFF 여도
 *  3. 물리치료사(LAB_TECH+직종)는 치료 오더만(의사 승인) · 약은 거부(ORDER_SCOPE_DENIED)
 *  4. 🔴 승인 **요청**이 규칙 OFF 면 무조건 거부되던 것 — 저장은 토큰을 요구하는데 요청은 못 해 대리입력이 저장 불가였다
 *  5. 역할과 맞지 않는 직종(LAB_TECH + '의사')으로 권한을 올릴 수 없다
 */
function build(user: { role: string; profession?: string | null }, cfg: Record<string, unknown> = {}) {
  const svc = Object.create(PrescriptionService.prototype) as PrescriptionService & Record<string, unknown>;
  const users: Record<string, { id: string; role: string; profession: string | null; isActive?: boolean }> = {
    actor: { id: 'actor', role: user.role, profession: user.profession ?? null },
    doc: { id: 'doc', role: 'DOCTOR', profession: null, isActive: true },
  };
  Object.assign(svc, {
    prisma: {
      user: { findUnique: vi.fn(async ({ where }: { where: { id: string } }) => users[where.id] ?? null) },
      encounter: { findUnique: vi.fn(async () => ({ id: 'enc', admissionId: null })) },
    },
    config: { get: vi.fn(async (k: string) => cfg[k] ?? null) },
    stepUp: { consume: vi.fn(async () => ({ bodyHash: 'h' })) },
    pushApproval: { requestDelegate: vi.fn(async () => ({ requestId: 'r1', expiresAt: 'x' })) },
  });
  // 자격 검증은 이 스펙의 관심 밖(별도 계약) — 통과로 둔다
  (svc as unknown as { assertPrescriberEligible: () => Promise<void> }).assertPrescriberEligible = vi.fn(async () => {});
  return svc;
}
const resolve = (svc: PrescriptionService, type: string, designated?: string, token?: string) =>
  (svc as unknown as { resolvePrescriber: (...a: unknown[]) => Promise<string> }).resolvePrescriber(
    { id: 'enc', admissionId: null }, 'actor', designated, token, { type }, type);
const request = (svc: PrescriptionService, type: string, prescriberId = 'doc') =>
  svc.requestPrescriberDelegate('enc', 'actor', prescriberId, { type } as never);

describe('직종별 오더 입력 — 저장(resolvePrescriber)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('간호사 간호 오더 = 본인 권한 · 책임자 본인 · 승인 토큰 소비 없음', async () => {
    const svc = build({ role: 'NURSE' });
    await expect(resolve(svc, 'NURSING')).resolves.toBe('actor');
    expect((svc as unknown as { stepUp: { consume: ReturnType<typeof vi.fn> } }).stepUp.consume).not.toHaveBeenCalled();
  });

  it('간호사 약 처방 = 지정 의사 없으면 거부 · 있으면 그 의사 승인으로 의사 명의(규칙 OFF 여도)', async () => {
    const svc = build({ role: 'NURSE' });
    await expect(resolve(svc, 'MEDICATION')).rejects.toMatchObject({ response: { code: 'PRESCRIBER_REQUIRED' } });
    await expect(resolve(svc, 'MEDICATION', 'doc')).rejects.toMatchObject({ response: { code: 'PRESCRIBER_AUTH_REQUIRED' } });
    await expect(resolve(svc, 'MEDICATION', 'doc', 'tok')).resolves.toBe('doc');
  });

  it('물리치료사: 치료 오더는 의사 승인 흐름 · 약 처방은 거부', async () => {
    const svc = build({ role: 'LAB_TECH', profession: 'PHYSICAL_THERAPIST' });
    await expect(resolve(svc, 'THERAPY', 'doc', 'tok')).resolves.toBe('doc');
    await expect(resolve(svc, 'MEDICATION', 'doc', 'tok')).rejects.toMatchObject({ response: { code: 'ORDER_SCOPE_DENIED' } });
  });

  it('🔴 LAB_TECH 에 직종 "의사"를 적어도 약 처방 본인 권한이 되지 않는다', async () => {
    const svc = build({ role: 'LAB_TECH', profession: 'DOCTOR' });
    await expect(resolve(svc, 'MEDICATION', 'doc', 'tok')).rejects.toMatchObject({ response: { code: 'ORDER_SCOPE_DENIED' } });
  });

  it('🔴 원내 설정으로 간호사 약 처방을 본인 권한으로 올릴 수 없다(상한)', async () => {
    const svc = build({ role: 'NURSE' }, { 'order.entryScope': { NURSE: { MEDICATION: 'SELF' } } });
    await expect(resolve(svc, 'MEDICATION')).rejects.toMatchObject({ response: { code: 'PRESCRIBER_REQUIRED' } });
  });

  it('의사는 종전대로 본인(규칙 OFF)', async () => {
    const svc = build({ role: 'DOCTOR' });
    await expect(resolve(svc, 'MEDICATION')).resolves.toBe('actor');
  });
});

describe('직종별 오더 입력 — 승인 요청(requestPrescriberDelegate)', () => {
  it('🔴 규칙 OFF 여도 간호사의 약 처방 승인 요청은 나간다(저장이 토큰을 요구하므로)', async () => {
    const svc = build({ role: 'NURSE' });
    await expect(request(svc, 'MEDICATION')).resolves.toMatchObject({ requestId: 'r1' });
  });

  it('본인 권한 유형(간호 오더)은 승인 요청이 필요 없다고 말한다', async () => {
    const svc = build({ role: 'NURSE' });
    await expect(request(svc, 'NURSING')).rejects.toMatchObject({ response: { code: 'DELEGATE_NOT_NEEDED' } });
  });

  it('범위 밖(치료사의 약 처방)은 요청도 거부', async () => {
    const svc = build({ role: 'LAB_TECH', profession: 'PHYSICAL_THERAPIST' });
    await expect(request(svc, 'MEDICATION')).rejects.toMatchObject({ response: { code: 'ORDER_SCOPE_DENIED' } });
  });

  it('대조군 — 의사 간 위임은 여전히 규칙 ON 이어야 한다', async () => {
    const svc = build({ role: 'DOCTOR' });
    await expect(request(svc, 'MEDICATION')).rejects.toMatchObject({ response: { code: 'PRESCRIBER_RULES_DISABLED' } });
  });
});

describe('내 입력 범위(getEntryScope)', () => {
  it('직종 출처를 밝힌다 — 지정/역할 기본/역할 불일치로 무시', async () => {
    expect((await build({ role: 'LAB_TECH', profession: 'PHYSICAL_THERAPIST' }).getEntryScope('actor')).professionSource).toBe('SET');
    expect((await build({ role: 'NURSE' }).getEntryScope('actor')).professionSource).toBe('ROLE_DEFAULT');
    const mis = await build({ role: 'LAB_TECH', profession: 'DOCTOR' }).getEntryScope('actor');
    expect(mis.professionSource).toBe('MISMATCH_IGNORED');
    expect(mis.modes.MEDICATION).toBe('NONE');
  });
});
