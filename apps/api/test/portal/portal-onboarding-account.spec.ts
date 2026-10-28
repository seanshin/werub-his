/**
 * 포털 첫 안내(온보딩) — 계정 단위 기록(2026-10-20).
 *  · 🔴 종전: 기기 localStorage 하나 — 같은 계정도 기기마다 다시 떴다 · 서버는 아무것도 몰랐다
 *  · 계정 세션 → `PatientAccount.onboardingCompletedAt`(처음 한 번만 · 멱등) · 보호자 위임은 보는 사람(보호자) 계정
 *  · 계정 없는 등록번호 세션 → DEVICE(서버에 남길 곳 없음 · 오류 아님)
 */
import { readFileSync } from 'node:fs';
import { describe, it, expect, vi } from 'vitest';
import { PortalService } from '../../src/modules/portal/portal.service';

const T = new Date('2026-10-01T01:00:00Z');
function svc(account: { onboardingCompletedAt: Date | null } | null, updated = 1) {
  const s = Object.create(PortalService.prototype) as any;
  s.prisma = { patientAccount: { findUnique: vi.fn().mockResolvedValue(account), updateMany: vi.fn().mockResolvedValue({ count: updated }) } };
  return s;
}

describe('🔴 첫 안내 — 계정 단위', () => {
  it('계정 없는 세션 → DEVICE · DB 를 보지 않는다 · 완료 기록도 남기지 않는다(오류 아님)', async () => {
    const s = svc(null);
    expect(await s.getOnboardingState(null)).toEqual({ scope: 'DEVICE', completedAt: null });
    expect(await s.completeOnboarding(null)).toEqual({ recorded: false, scope: 'DEVICE', completedAt: null });
    expect(s.prisma.patientAccount.findUnique).not.toHaveBeenCalled();
    expect(s.prisma.patientAccount.updateMany).not.toHaveBeenCalled();
  });
  it('계정 세션 → 계정 기록 그대로(본 적 없으면 null · 봤으면 시각)', async () => {
    expect(await svc({ onboardingCompletedAt: null }).getOnboardingState('acc1')).toEqual({ scope: 'ACCOUNT', completedAt: null });
    expect(await svc({ onboardingCompletedAt: T }).getOnboardingState('acc1')).toEqual({ scope: 'ACCOUNT', completedAt: T.toISOString() });
  });
  it('완료 = 처음 한 번만(조건부 갱신) · 이미 있으면 바꾸지 않고 처음 시각을 돌려준다', async () => {
    const first = svc(null, 1);
    const r = await first.completeOnboarding('acc1');
    expect(r).toMatchObject({ recorded: true, scope: 'ACCOUNT' });
    expect(first.prisma.patientAccount.updateMany.mock.calls[0][0].where).toEqual({ id: 'acc1', onboardingCompletedAt: null });
    const again = svc({ onboardingCompletedAt: T }, 0);
    expect(await again.completeOnboarding('acc1')).toEqual({ recorded: false, scope: 'ACCOUNT', completedAt: T.toISOString() });
  });
  it('구조 — 능력표·완료 EP 가 보는 사람의 계정(본인 → 없으면 보호자)을 쓴다', () => {
    const src = readFileSync('src/modules/portal/portal.controller.ts', 'utf8');
    expect(src.match(/req\.patientAccountId \?\? req\.guardianAccountId \?\? null/g)?.length).toBe(2);
    expect(src).toMatch(/@Post\('onboarding\/complete'\)/);
  });
});
