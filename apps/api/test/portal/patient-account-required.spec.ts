/**
 * 계정 전용 기능(patient-auth/*) — 살아 있는 등록번호·보호자 세션에 "세션 만료"라 하지 않는다(2026-10-19 v4.93.2 · 사용자 신고).
 *  · 🔴 종전: 등록번호 로그인의 내 정보 탭 — 주민번호·보호자/가족·가족 계정 조회가 401 → 화면 "세션이 만료되었습니다 · 다시 로그인"
 *  · 이제: 포털 세션이 살아 있으면 403 PATIENT_ACCOUNT_REQUIRED · 진짜 끝난 토큰은 그대로 401
 *  · 대조군: 계정 토큰은 통과
 */
import { describe, it, expect, vi } from 'vitest';
import { PatientAccountAuthGuard } from '../../src/modules/patient-auth/guards/patient-account-auth.guard';

const ctxOf = (token = 't') => {
  const req: any = { headers: { authorization: `Bearer ${token}` } };
  return { req, ctx: { switchToHttp: () => ({ getRequest: () => req }) } as any };
};
const mk = (accountOk: boolean, portalOk: boolean | 'absent') => {
  const auth: any = { verifyAccessToken: vi.fn(async () => { if (!accountOk) throw Object.assign(new Error('x'), { status: 401 }); return { accountId: 'a1', patientId: 'p1' }; }) };
  const portal = { resolveAuth: vi.fn(async () => { if (!portalOk) throw new Error('expired'); return { patientId: 'p1' }; }) };
  const moduleRef: any = { get: vi.fn(() => (portalOk === 'absent' ? undefined : portal)) };
  return new PatientAccountAuthGuard(auth, moduleRef);
};

describe('🔴 계정 전용 가드 — 401 은 세션 끝일 때만', () => {
  it('등록번호·보호자 세션(포털 토큰 유효) → 403 PATIENT_ACCOUNT_REQUIRED', async () => {
    const e: any = await mk(false, true).canActivate(ctxOf().ctx).catch((x) => x);
    expect(e.getStatus()).toBe(403);
    expect(e.getResponse()).toMatchObject({ code: 'PATIENT_ACCOUNT_REQUIRED' });
  });
  it('끝난 토큰(포털로도 안 풀림) → 원래 401 · 포털 서비스 못 찾으면 401', async () => {
    for (const p of [false, 'absent'] as const) {
      const e: any = await mk(false, p).canActivate(ctxOf().ctx).catch((x) => x);
      expect(e.status ?? e.getStatus?.()).toBe(401);
    }
  });
  it('대조군 — 계정 토큰은 통과 · 환자·계정 주입', async () => {
    const { req, ctx } = ctxOf();
    expect(await mk(true, true).canActivate(ctx)).toBe(true);
    expect(req).toMatchObject({ portalPatientId: 'p1', patientAccountId: 'a1' });
  });
});
