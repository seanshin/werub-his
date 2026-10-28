import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createHash, randomBytes } from 'crypto';
import { OnboardingService } from '../../src/modules/onboarding/onboarding.service';

/**
 * 🔴 W8(P16) — 온보딩 「📧 이메일 발송」이 **채널을 부르지 않고 이력만 적었다.**
 *    버튼은 늘 성공했고 입사예정자에게는 아무것도 가지 않았다.
 *    규약: **발송 시도 ≠ 도달** · provider 가 없으면 SENT 가 아니다(W6 CRM 과 같은 판정).
 */

const RAW = randomBytes(32).toString('hex');
const TOKEN_HASH = createHash('sha256').update(RAW).digest('hex');
const LINK = `https://his.example.kr/onboarding/${RAW}`;

function build(opts: { email?: string | null; sendResult?: { success: boolean; simulated?: boolean; error?: string } }) {
  const invite = {
    id: 'inv-1',
    tokenHash: TOKEN_HASH,
    email: opts.email === undefined ? 'new@hospital.example.org' : opts.email,
    candidateFamilyName: '김', candidateGivenName: '신입',
    expiresAt: new Date('2026-09-01T00:00:00Z'),
    status: 'INVITED',
    sends: [], documents: [], profile: null, contract: null,
  };
  const created: Record<string, unknown>[] = [];
  const prisma = {
    onboardingInvite: { findUnique: vi.fn().mockResolvedValue(invite) },
    onboardingSend: { create: vi.fn(async (a: { data: Record<string, unknown> }) => { created.push(a.data); return a.data; }) },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
  } as never;
  const channel = {
    send: vi.fn().mockResolvedValue(opts.sendResult ?? { success: true, simulated: true }),
    renderEmailTemplate: (s: string, b: string) => `${s}${b}`,
  } as never;
  const svc = new OnboardingService(prisma, {} as never, {} as never, {} as never, {} as never, channel);
  return { svc, channel: channel as unknown as { send: ReturnType<typeof vi.fn> }, created };
}

describe('OnboardingService.recordSend — 발송 판정', () => {
  let ctx: ReturnType<typeof build>;
  beforeEach(() => { ctx = build({}); });

  it('🔴 제공자가 없으면(SIMULATED) SENT 로 적지 않는다', async () => {
    const r = await ctx.svc.recordSend('inv-1', 'EMAIL', 'admin-1', LINK);
    expect(r.delivery).toBe('SIMULATED');
    expect(r.ok).toBe(false);
    expect(ctx.created[0].meta).toMatchObject({ delivery: 'SIMULATED', reason: 'NO_EMAIL_PROVIDER' });
    expect(r.message).toMatch(/보내지 않았습니다/);
  });

  it('실제로 나갔을 때만 SENT', async () => {
    const c = build({ sendResult: { success: true } });
    const r = await c.svc.recordSend('inv-1', 'EMAIL', 'admin-1', LINK);
    expect(r.delivery).toBe('SENT');
    expect(r.ok).toBe(true);
    expect(c.created[0].meta).toMatchObject({ delivery: 'SENT' });
  });

  it('🔴 받을 주소가 없으면 발송을 시도조차 하지 않고 FAILED', async () => {
    const c = build({ email: null });
    const r = await c.svc.recordSend('inv-1', 'EMAIL', 'admin-1', LINK);
    expect(r.delivery).toBe('FAILED');
    expect((c.created[0].meta as { reason: string }).reason).toBe('NO_CONTACT');
    expect(c.channel.send).not.toHaveBeenCalled();
  });

  it('🔴 이 초대의 토큰이 아닌 링크로는 보내지 않는다(임의 링크 주입 차단)', async () => {
    const c = build({});
    const r = await c.svc.recordSend('inv-1', 'EMAIL', 'admin-1', 'https://evil.example/onboarding/deadbeef');
    expect(r.delivery).toBe('FAILED');
    expect((c.created[0].meta as { reason: string }).reason).toBe('LINK_UNAVAILABLE');
    expect(c.channel.send).not.toHaveBeenCalled();
  });

  it('채널 예외도 성공으로 삼키지 않는다', async () => {
    const c = build({});
    (c.channel.send as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('smtp down'));
    const r = await c.svc.recordSend('inv-1', 'EMAIL', 'admin-1', LINK);
    expect(r.delivery).toBe('FAILED');
  });

  it('QR/링크는 발송이 아니라 "직접 전달"로 구분해 적는다', async () => {
    const c = build({});
    const r = await c.svc.recordSend('inv-1', 'LINK', 'admin-1');
    expect(r.delivery).toBe('HANDED_OVER');
    expect(c.channel.send).not.toHaveBeenCalled();
  });
});
